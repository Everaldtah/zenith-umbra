"""Kaggle job B: TRELLIS (MIT) image -> textured GLB for every picked concept, one worker per T4.
Inputs: concept PNGs from the nd-assetgen-concepts kernel output. Outputs /kaggle/working/glb/<id>.glb."""
import json, os, sys, time, subprocess, urllib.request, traceback, glob

TOPIC = os.environ.get("NTFY_TOPIC", "zu-trellis")
PICKS = dict(p.split(":") for p in os.environ.get("PICKS", "").split(",") if p)
ONLY = [s for s in os.environ.get("ONLY", "").split(",") if s]
OUT = "/kaggle/working/glb"
os.makedirs(OUT, exist_ok=True)


def publish(phase, **extra):
    print("PHASE", phase, extra, flush=True)
    try:
        body = json.dumps({"topic": TOPIC, "title": "trellis " + phase, "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception as e:
        print("ntfy failed", e)


def sh(cmd, name, fatal=True, cwd=None):
    t = time.time()
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=cwd, env={**os.environ, "TORCH_CUDA_ARCH_LIST": "7.5", "MAX_JOBS": "4"})
    ok = r.returncode == 0
    publish("step", name=name, ok=ok, secs=round(time.time() - t), tail=(r.stdout + r.stderr)[-900:] if not ok else "")
    if not ok and fatal:
        raise SystemExit(f"step failed: {name}")
    return ok


WORKER = r'''
import os, sys, json, time, traceback, urllib.request
os.environ["ATTN_BACKEND"] = "xformers"
os.environ["SPCONV_ALGO"] = "native"
sys.path.insert(0, "/tmp/TRELLIS")
TOPIC = os.environ["NTFY_TOPIC"]
def publish(phase, **extra):
    try:
        body = json.dumps({"topic": TOPIC, "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception: pass
import torch
from PIL import Image
from trellis.pipelines import TrellisImageTo3DPipeline
from trellis.utils import postprocessing_utils
pipe = TrellisImageTo3DPipeline.from_pretrained("JeffreyXiang/TRELLIS-image-large")
pipe.cuda()
jobs = json.loads(os.environ["JOBS"])
for aid, path in jobs:
    t0 = time.time()
    try:
        img = Image.open(path)
        out = pipe.run(img, seed=1, sparse_structure_sampler_params={"steps": 25, "cfg_strength": 7.5}, slat_sampler_params={"steps": 25, "cfg_strength": 3.0})
        glb = postprocessing_utils.to_glb(out["gaussian"][0], out["mesh"][0], simplify=0.85, texture_size=int(os.environ.get("TEX", "2048")), verbose=False)
        glb.export(f"/kaggle/working/glb/{aid}.glb")
        publish("asset", id=aid, secs=round(time.time() - t0), gpu=os.environ.get("CUDA_VISIBLE_DEVICES"))
    except Exception:
        publish("asset-error", id=aid, trace=traceback.format_exc()[-1200:])
    torch.cuda.empty_cache()
publish("worker-done", gpu=os.environ.get("CUDA_VISIBLE_DEVICES"))
'''

try:
    publish("boot")
    t0 = time.time()
    sh(f"{sys.executable} -m pip install -q uv", "uv")
    sh("uv venv -q -p 3.10 --seed /tmp/venv", "venv-py310")
    py = "/tmp/venv/bin/python"
    sh(f"{py} -m pip install -q torch==2.4.0 torchvision==0.19.0 --index-url https://download.pytorch.org/whl/cu121", "torch-2.4")
    sh(f"{py} -m pip install -q xformers==0.0.27.post2 --index-url https://download.pytorch.org/whl/cu121", "xformers")
    sh(f"{py} -m pip install -q 'numpy<2' pillow imageio imageio-ffmpeg tqdm easydict opencv-python-headless scipy ninja rembg onnxruntime trimesh xatlas pyvista pymeshfix igraph plyfile open3d 'transformers<4.50' huggingface_hub safetensors", "basic-deps")
    sh(f"{py} -m pip install -q git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8", "utils3d")
    sh(f"{py} -m pip install -q spconv-cu120", "spconv")
    sh(f"{py} -m pip install -q kaolin==0.17.0 -f https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.4.0_cu121.html", "kaolin", fatal=False)
    # the pinned FlexiCubes submodule (MaxtirError/FlexiCubes) was deleted from GitHub; use NVIDIA's official repo
    sh("git clone -q https://github.com/microsoft/TRELLIS.git /tmp/TRELLIS", "clone-trellis")
    # TRELLIS needs its modified fork (voxelgrid_colors API), so take the copy vendored in ComfyUI-3D-Pack
    FX = "https://raw.githubusercontent.com/MrForExample/ComfyUI-3D-Pack/main/Gen_3D_Modules/TRELLIS/trellis/representations/mesh/flexicubes"
    sh(f"D=/tmp/TRELLIS/trellis/representations/mesh/flexicubes; rm -rf $D && mkdir -p $D && curl -fsSL {FX}/flexicubes.py -o $D/flexicubes.py && curl -fsSL {FX}/tables.py -o $D/tables.py && touch $D/__init__.py && grep -q voxelgrid_colors $D/flexicubes.py", "fetch-flexicubes")
    sh("git clone -q https://github.com/NVlabs/nvdiffrast.git /tmp/nvdiffrast", "clone-nvdiffrast")
    sh(f"{py} -m pip install -q --no-build-isolation /tmp/nvdiffrast", "nvdiffrast")
    sh("git clone -q https://github.com/autonomousvision/mip-splatting.git /tmp/mip-splatting", "clone-mip")
    sh(f"{py} -m pip install -q --no-build-isolation /tmp/mip-splatting/submodules/diff-gaussian-rasterization/", "diff-gaussian-rasterization")
    publish("installed", minutes=round((time.time() - t0) / 60, 1))

    dirs = [d for d in glob.glob("/kaggle/input/**/img", recursive=True) if os.path.isdir(d)]
    publish("inputs", dirs=dirs)
    cdir = "/tmp/allimg"; os.makedirs(cdir, exist_ok=True)
    for d in dirs: subprocess.run(f"cp -n {d}/*.png {cdir}/", shell=True)
    ids = sorted({os.path.basename(p).rsplit("_", 1)[0] for p in glob.glob(f"{cdir}/*.png")})
    ids = [i for i in ids if i.startswith("model_") or i.startswith("prop_")]
    if ONLY:
        ids = [i for i in ids if i in ONLY]
    # auto-pick: the candidate whose cut-out is one clean, well-framed object
    pick_code = r"""
import sys, json, glob, os
import numpy as np
from PIL import Image
from rembg import remove, new_session
from scipy import ndimage
sess = new_session("u2net")
cdir, ids, picks = sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3])
out = {}
for i in ids:
    if i in picks: out[i] = picks[i]; continue
    best, bs = "0", -1e9
    for p in sorted(glob.glob(f"{cdir}/{i}_*.png")):
        k = p.rsplit("_", 1)[1][:-4]
        a = np.array(remove(Image.open(p).convert("RGB").resize((384, 384)), session=sess))[..., 3] > 128
        cov = a.mean()
        lab, n = ndimage.label(a)
        sizes = np.bincount(lab.ravel())[1:] if n else np.array([0])
        main = sizes.max() / max(1, sizes.sum())
        big = (sizes > 0.05 * sizes.sum()).sum()
        edge = a[:6].mean() + a[-6:].mean() + a[:, :6].mean() + a[:, -6:].mean()
        score = main * 3 - (big - 1) * 2 - edge * 8 - abs(cov - 0.32) * 3
        if score > bs: bs, best = score, k
    out[i] = best
print(json.dumps(out))
"""
    open("/tmp/pick.py", "w").write(pick_code)
    r = subprocess.run([py, "/tmp/pick.py", cdir, json.dumps(ids), json.dumps(PICKS)], capture_output=True, text=True)
    try:
        chosen = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        chosen = {}
        publish("pick-failed", tail=(r.stdout + r.stderr)[-800:])
    publish("picks", picks=chosen)
    for i in ids:
        os.makedirs("/kaggle/working/picked", exist_ok=True)
        subprocess.run(f"cp {cdir}/{i}_{chosen.get(i, '0')}.png /kaggle/working/picked/{i}.png", shell=True)
    jobs = [(i, f"{cdir}/{i}_{chosen.get(i, PICKS.get(i, '0'))}.png") for i in ids]
    open("/tmp/worker.py", "w").write(WORKER)
    # warm the DINOv2 hub cache once: two workers unpacking it at the same time corrupts it
    sh(f"{py} -c \"import torch; torch.hub.load('facebookresearch/dinov2', 'dinov2_vitl14_reg', pretrained=True)\"", "dinov2-cache")
    procs = []
    for g in range(2):
        env = {**os.environ, "CUDA_VISIBLE_DEVICES": str(g), "JOBS": json.dumps(jobs[g::2]), "NTFY_TOPIC": TOPIC, "ATTN_BACKEND": "xformers", "SPCONV_ALGO": "native", "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True"}
        procs.append(subprocess.Popen([py, "/tmp/worker.py"], env=env, stdout=open(f"/tmp/worker{g}.log", "w"), stderr=subprocess.STDOUT))
    for p in procs:
        p.wait()
    logs = {g: open(f"/tmp/worker{g}.log").read()[-3000:] for g in range(2)}
    made = sorted(os.path.basename(p) for p in glob.glob(f"{OUT}/*.glb"))
    publish("done", made=len(made), of=len(jobs), minutes=round((time.time() - t0) / 60, 1), logs=logs if len(made) < len(jobs) else "")
    subprocess.run("rm -rf /tmp/TRELLIS", shell=True)
except SystemExit:
    raise
except Exception:
    publish("error", trace=traceback.format_exc()[-2000:])
