"""Kaggle job: TRELLIS.2 (MIT, 4B) high-detail image->3D for the heroes (sharper faces / hair than TRELLIS v1).
Patches: DINOv3 from the ungated timm mirror (the facebook repo is gated), rembg isnet-anime instead of RMBG-2.0
(non-commercial), fp16 weights for the T4 (no bf16 tensor cores). Outputs /kaggle/working/glb/<id>.glb."""
import json, os, sys, time, subprocess, urllib.request, traceback, glob

TOPIC = os.environ.get("NTFY_TOPIC", "zu-trellis2")
PICKS = dict(p.split(":") for p in os.environ.get("PICKS", "").split(",") if p)
PTYPE = os.environ.get("PTYPE", "1024_cascade")
OUT = "/kaggle/working/glb"
os.makedirs(OUT, exist_ok=True)


def publish(phase, **extra):
    print("PHASE", phase, extra, flush=True)
    try:
        body = json.dumps({"topic": TOPIC, "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception as e:
        print("ntfy failed", e)


def sh(cmd, name, fatal=True, cwd=None):
    t = time.time()
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=cwd, env={**os.environ, "TORCH_CUDA_ARCH_LIST": "7.5", "MAX_JOBS": "4"})
    ok = r.returncode == 0
    publish("step", name=name, ok=ok, secs=round(time.time() - t), tail=(r.stdout + r.stderr)[-1200:] if not ok else "")
    if not ok and fatal:
        raise SystemExit(f"step failed: {name}")
    return ok


WORKER = r'''
import os, sys, json, time, traceback, urllib.request
os.environ["ATTN_BACKEND"] = os.environ.get("ATTN_BACKEND", "xformers")
os.environ["SPARSE_ATTN_BACKEND"] = "xformers"
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
sys.path.insert(0, "/tmp/TRELLIS.2")
TOPIC = os.environ["NTFY_TOPIC"]
def publish(phase, **extra):
    try:
        body = json.dumps({"topic": TOPIC, "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception: pass
import numpy as np, torch, torch.nn.functional as F
from PIL import Image
import timm
from rembg import remove, new_session
import trellis2.modules.image_feature_extractor as ife
import trellis2.pipelines.rembg as trembg

class TimmDinoV3:
    """DINOv3 ViT-L/16 from timm; returns [cls, registers, patches] of the last block, layer-normed (matches the HF path)."""
    def __init__(self, model_name=None, image_size=512):
        self.model = timm.create_model("vit_large_patch16_dinov3.lvd1689m", pretrained=True, dynamic_img_size=True).eval()
        self.image_size = image_size
        self.mean = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1); self.std = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)
    def to(self, device): self.model.to(device); return self
    def cuda(self): self.model.cuda(); return self
    def cpu(self): self.model.cpu(); return self
    @torch.no_grad()
    def __call__(self, image):
        if isinstance(image, list):
            image = [np.array(i.resize((self.image_size, self.image_size), Image.LANCZOS).convert("RGB")).astype(np.float32) / 255 for i in image]
            image = torch.stack([torch.from_numpy(i).permute(2, 0, 1) for i in image])
        image = ((image.cpu() - self.mean) / self.std).cuda().float()
        feats = self.model.forward_intermediates(image, indices=1, norm=False, output_fmt="NLC", intermediates_only=False, return_prefix_tokens=True)
        inter = feats[1][-1]
        spatial, prefix = inter if isinstance(inter, tuple) else (inter, None)
        if spatial.ndim == 4: spatial = spatial.flatten(2).transpose(1, 2)
        x = torch.cat([prefix, spatial], 1) if prefix is not None else spatial
        return F.layer_norm(x, x.shape[-1:])
ife.DinoV3FeatureExtractor = TimmDinoV3

_sess = new_session("isnet-anime")
class AnimeRembg:
    def __init__(self, *a, **k): pass
    def to(self, device): return self
    def cuda(self): return self
    def cpu(self): return self
    def __call__(self, image): return remove(image.convert("RGB"), session=_sess)
trembg.BiRefNet = AnimeRembg

from trellis2.pipelines import Trellis2ImageTo3DPipeline
import o_voxel
pipe = Trellis2ImageTo3DPipeline.from_pretrained("microsoft/TRELLIS.2-4B")
# T4 has no bf16 tensor cores: run every flow model / decoder in fp16
for k, m in pipe.models.items():
    try:
        m.to(torch.float16)
        if hasattr(m, "dtype"): m.dtype = torch.float16
        if hasattr(m, "convert_to_fp16"): m.convert_to_fp16()
    except Exception as e: print("fp16 convert", k, e)
pipe.cuda()
publish("loaded", gpu=os.environ.get("CUDA_VISIBLE_DEVICES"), mem=round(torch.cuda.memory_allocated() / 1e9, 2))
jobs = json.loads(os.environ["JOBS"])
for aid, path in jobs:
    t0 = time.time()
    for ptype in [os.environ.get("PTYPE", "1024_cascade"), "512"]:
        try:
            img = Image.open(path)
            mesh = pipe.run(img, seed=7, pipeline_type=ptype, max_num_tokens=int(os.environ.get("MAXTOK", "32768")))[0]
            mesh.simplify(4000000)
            glb = o_voxel.postprocess.to_glb(vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs, coords=mesh.coords, attr_layout=mesh.layout,
                voxel_size=mesh.voxel_size, aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]], decimation_target=120000, texture_size=2048,
                remesh=True, remesh_band=1, remesh_project=0, verbose=False)
            glb.export(f"/kaggle/working/glb/{aid}.glb", extension_webp=False)
            publish("asset", id=aid, ptype=ptype, secs=round(time.time() - t0), gpu=os.environ.get("CUDA_VISIBLE_DEVICES"))
            break
        except Exception:
            publish("asset-error", id=aid, ptype=ptype, trace=traceback.format_exc()[-1500:])
            torch.cuda.empty_cache()
    torch.cuda.empty_cache()
publish("worker-done", gpu=os.environ.get("CUDA_VISIBLE_DEVICES"))
'''

try:
    publish("boot")
    t0 = time.time()
    sh(f"{sys.executable} -m pip install -q uv", "uv")
    sh("uv venv -q -p 3.10 --seed /tmp/venv", "venv-py310")
    py = "/tmp/venv/bin/python"
    pip = f"{py} -m pip install -q"
    sh(f"{pip} torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124", "torch-2.6")
    sh(f"{pip} xformers==0.0.29.post3 --index-url https://download.pytorch.org/whl/cu124", "xformers")
    sh(f"{pip} imageio imageio-ffmpeg tqdm easydict opencv-python-headless ninja trimesh 'transformers>=4.56' pandas zstandard kornia timm>=1.0.20 rembg onnxruntime-gpu 'numpy<2' pillow huggingface_hub safetensors scipy", "basic-deps")
    sh(f"{pip} git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8", "utils3d")
    sh("git clone -q --recursive https://github.com/microsoft/TRELLIS.2.git /tmp/TRELLIS.2", "clone-trellis2")
    sh("mkdir -p /tmp/ext && git clone -q -b v0.4.0 https://github.com/NVlabs/nvdiffrast.git /tmp/ext/nvdiffrast", "clone-nvdiffrast")
    sh(f"{pip} --no-build-isolation /tmp/ext/nvdiffrast", "nvdiffrast")
    sh("git clone -q -b renderutils https://github.com/JeffreyXiang/nvdiffrec.git /tmp/ext/nvdiffrec", "clone-nvdiffrec")
    sh(f"{pip} --no-build-isolation /tmp/ext/nvdiffrec", "nvdiffrec", fatal=False)
    sh("git clone -q --recursive https://github.com/JeffreyXiang/CuMesh.git /tmp/ext/CuMesh", "clone-cumesh")
    sh(f"{pip} --no-build-isolation /tmp/ext/CuMesh", "cumesh")
    sh("git clone -q --recursive https://github.com/JeffreyXiang/FlexGEMM.git /tmp/ext/FlexGEMM", "clone-flexgemm")
    sh(f"{pip} --no-build-isolation /tmp/ext/FlexGEMM", "flexgemm")
    sh(f"cp -r /tmp/TRELLIS.2/o-voxel /tmp/ext/o-voxel && {pip} --no-build-isolation /tmp/ext/o-voxel", "o-voxel")
    publish("installed", minutes=round((time.time() - t0) / 60, 1))

    dirs = sorted([d for d in glob.glob("/kaggle/input/**/img", recursive=True) if os.path.isdir(d)], key=lambda d: "hexfix" in d)   # hexfix copies last (wins)
    cdir = "/tmp/allimg"; os.makedirs(cdir, exist_ok=True)
    for d in dirs: subprocess.run(f"cp {d}/*.png {cdir}/", shell=True)
    jobs = [(k.replace("model_", ""), f"{cdir}/{k}_{v}.png") for k, v in PICKS.items() if os.path.exists(f"{cdir}/{k}_{v}.png")]
    publish("inputs", n=len(jobs), dirs=dirs)
    open("/tmp/worker.py", "w").write(WORKER)
    # warm the model downloads once (two workers racing on the HF cache corrupts it)
    sh(f"cd /tmp && {py} -c \"from huggingface_hub import snapshot_download as s; s('microsoft/TRELLIS.2-4B'); s('microsoft/TRELLIS-image-large', allow_patterns=['ckpts/ss_dec*']); import timm; timm.create_model('vit_large_patch16_dinov3.lvd1689m', pretrained=True)\"", "download-models")
    procs = []
    for g in range(2):
        env = {**os.environ, "CUDA_VISIBLE_DEVICES": str(g), "JOBS": json.dumps(jobs[g::2]), "NTFY_TOPIC": TOPIC, "PTYPE": PTYPE}
        procs.append(subprocess.Popen([py, "/tmp/worker.py"], env=env, stdout=open(f"/tmp/worker{g}.log", "w"), stderr=subprocess.STDOUT))
    for p in procs: p.wait()
    made = sorted(os.path.basename(p) for p in glob.glob(f"{OUT}/*.glb"))
    logs = {g: open(f"/tmp/worker{g}.log").read()[-2500:] for g in range(2)}
    publish("done", made=made, minutes=round((time.time() - t0) / 60, 1), logs=logs if len(made) < len(jobs) else "")
    subprocess.run("rm -rf /tmp/TRELLIS.2 /tmp/ext", shell=True)
except SystemExit:
    raise
except Exception:
    publish("error", trace=traceback.format_exc()[-2000:])
