"""TRELLIS.2 (Microsoft, MIT) image -> 3D for the restyled heroes on Modal: A100-80GB, native bf16, the highest-detail
1536 cascade, 4K PBR texture bake, remeshed (manifold) output. The Kaggle T4 job (trellis2/trellis2.py) had to run fp16
at 1024 - this is the production-quality pass.

    modal run assetgen/modal_trellis2.py --heroes kaien                         # work/ow/pick/kaien.png
    modal run assetgen/modal_trellis2.py --heroes kaien,raijin --ptype 1024_cascade

In:  work/ow/pick/<hero>.png   (the chosen restyled concept)
Out: assetgen/out/trellis2-zz-ow/glb/<hero>.glb   (build_assets.py picks the newest trellis2* dir last: this one wins)
"""
import io, os, json
import modal

HERE = os.path.dirname(os.path.abspath(__file__))
PICK = os.path.join(HERE, "..", "work", "ow", "pick")
OUT = os.path.join(HERE, "out", "trellis2-zz-ow", "glb")

vol = modal.Volume.from_name("zu-hf", create_if_missing=True)
ARCH = "8.0;8.6;8.9;9.0"
image = (modal.Image.from_registry("nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04", add_python="3.10")
         .apt_install("git", "libgl1", "libglib2.0-0", "libegl1", "libgles2", "libxrender1", "build-essential", "ninja-build", "clang")   # the bundled python links extensions with clang++
         .env({"TORCH_CUDA_ARCH_LIST": ARCH, "MAX_JOBS": "8", "HF_HOME": "/hf", "HF_HUB_ENABLE_HF_TRANSFER": "1",
               "ATTN_BACKEND": "xformers", "SPARSE_ATTN_BACKEND": "xformers", "OPENCV_IO_ENABLE_OPENEXR": "1",
               "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True"})
         .pip_install("torch==2.6.0", "torchvision==0.21.0", index_url="https://download.pytorch.org/whl/cu124")
         .pip_install("xformers==0.0.29.post3", index_url="https://download.pytorch.org/whl/cu124")
         .pip_install("imageio", "imageio-ffmpeg", "tqdm", "easydict", "opencv-python-headless", "ninja", "trimesh", "transformers>=4.56",
                      "pandas", "zstandard", "kornia", "timm>=1.0.20", "rembg", "onnxruntime-gpu", "numpy<2", "pillow",
                      "huggingface_hub[hf_transfer]", "safetensors", "scipy", "setuptools", "wheel")
         .pip_install("git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8")
         .run_commands(
             "git clone -q --recursive https://github.com/microsoft/TRELLIS.2.git /opt/TRELLIS.2",
             "git clone -q -b v0.4.0 https://github.com/NVlabs/nvdiffrast.git /opt/ext/nvdiffrast && pip install --no-build-isolation /opt/ext/nvdiffrast",
             "git clone -q -b renderutils https://github.com/JeffreyXiang/nvdiffrec.git /opt/ext/nvdiffrec && (pip install --no-build-isolation /opt/ext/nvdiffrec || true)",
             "git clone -q --recursive https://github.com/JeffreyXiang/CuMesh.git /opt/ext/CuMesh && pip install --no-build-isolation /opt/ext/CuMesh",
             "git clone -q --recursive https://github.com/JeffreyXiang/FlexGEMM.git /opt/ext/FlexGEMM && pip install --no-build-isolation /opt/ext/FlexGEMM",
             "cp -r /opt/TRELLIS.2/o-voxel /opt/ext/o-voxel && pip install --no-build-isolation /opt/ext/o-voxel",
             gpu="A10G"))
app = modal.App("zu-trellis2", image=image)


@app.cls(gpu="A100-80GB", timeout=3600, volumes={"/hf": vol}, scaledown_window=60)
class Trellis:
    @modal.enter()
    def load(self):
        import sys
        sys.path.insert(0, "/opt/TRELLIS.2")
        import numpy as np, torch, torch.nn.functional as F
        from PIL import Image
        import timm
        from rembg import remove, new_session
        import trellis2.modules.image_feature_extractor as ife
        import trellis2.pipelines.rembg as trembg

        class TimmDinoV3:
            """DINOv3 ViT-L/16 from timm (the facebook repo is gated): [cls, registers, patches], layer-normed"""
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

        sess = new_session("birefnet-general")          # MIT (RMBG-2.0, the upstream default, is non-commercial)
        class Rembg:
            def __init__(self, *a, **k): pass
            def to(self, device): return self
            def cuda(self): return self
            def cpu(self): return self
            def __call__(self, image): return remove(image.convert("RGB"), session=sess)
        trembg.BiRefNet = Rembg

        from trellis2.pipelines import Trellis2ImageTo3DPipeline
        import o_voxel
        self.o_voxel = o_voxel
        self.pipe = Trellis2ImageTo3DPipeline.from_pretrained("microsoft/TRELLIS.2-4B")
        self.pipe.cuda()
        vol.commit()

    @modal.method()
    def run(self, hero: str, png: bytes, ptype: str = "1536_cascade", seed: int = 7, faces: int = 400000, tex: int = 4096) -> dict:
        import time, traceback, torch
        from PIL import Image
        t0 = time.time()
        img = Image.open(io.BytesIO(png))
        for pt in [ptype, "1024_cascade"]:
            try:
                mesh = self.pipe.run(img, seed=seed, pipeline_type=pt, max_num_tokens=65536)[0]
                mesh.simplify(8000000)
                glb = self.o_voxel.postprocess.to_glb(vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs, coords=mesh.coords,
                    attr_layout=mesh.layout, voxel_size=mesh.voxel_size, aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]], decimation_target=faces,
                    texture_size=tex, remesh=True, remesh_band=1, remesh_project=0, verbose=False)
                path = f"/tmp/{hero}.glb"; glb.export(path, extension_webp=False)
                return {"glb": open(path, "rb").read(), "ptype": pt, "secs": round(time.time() - t0)}
            except Exception:
                err = traceback.format_exc()[-2000:]
                print("FAILED", pt, err); torch.cuda.empty_cache()
        return {"error": err, "secs": round(time.time() - t0)}


@app.local_entrypoint()
def main(heroes: str, ptype: str = "1536_cascade", seed: int = 7, faces: int = 400000, tex: int = 4096):
    os.makedirs(OUT, exist_ok=True)
    names = [h for h in heroes.split(",") if h]
    jobs = [(h, open(os.path.join(PICK, f"{h}.png"), "rb").read(), ptype, seed, faces, tex) for h in names]
    for (h, *_), res in zip(jobs, Trellis().run.starmap(jobs, return_exceptions=True)):
        if isinstance(res, Exception): print("FAILED", h, repr(res)[:400]); continue
        if "glb" not in res: print("FAILED", h, res.get("error", "")[-800:]); continue
        p = os.path.join(OUT, f"{h}.glb"); open(p, "wb").write(res["glb"])
        print(f"saved {p} {len(res['glb']) / 1e6:.1f} MB ptype={res['ptype']} {res['secs']}s")
