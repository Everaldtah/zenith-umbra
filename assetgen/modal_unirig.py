"""Neural skin weights for the hero rigs on Modal (serverless GPU): UniRig (VAST-AI, MIT) predicts skinning weights for
OUR skeleton (rig_hero.py bone names, spring chains and all), trained on anime-style VRoid characters with hair / skirt
bones - a far better fit for layered TRELLIS cloth than the geodesic-voxel solve, which leaks sleeves into the hands
and robe panels into the hair chain.

    modal run assetgen/modal_unirig.py --heroes kaien                # one hero
    modal run assetgen/modal_unirig.py --heroes kaien,hex,raijin     # several (one container each)

In:  work/rig/<hero>_clean.fbx   (assetgen/blender/export_clean.py on public/models/<hero>.glb with Draco removed)
Out: work/rig/<hero>_unirig.fbx  (UniRig's skinned mesh; assetgen/blender/apply_skin.py transfers it onto our rig)
"""
import os
import modal

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "..", "work", "rig")
REPO = "/UniRig"


def download():
    from huggingface_hub import snapshot_download
    snapshot_download("VAST-AI/UniRig", local_dir="/weights")


image = (modal.Image.from_registry("nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04", add_python="3.11")
         .apt_install("git", "wget", "libgl1", "libglib2.0-0", "libxrender1", "libxi6", "libxkbcommon0", "libsm6", "libxfixes3", "libxxf86vm1", "libegl1")
         .pip_install("torch==2.3.1", "torchvision==0.18.1", index_url="https://download.pytorch.org/whl/cu121")
         .pip_install("transformers==4.51.3", "python-box", "einops", "omegaconf", "pytorch_lightning", "lightning", "addict", "timm",
                      "fast-simplification", "bpy==4.2.0", "trimesh", "open3d", "pyrender", "huggingface_hub", "wandb", "spconv-cu120")
         .pip_install("torch_scatter", "torch_cluster", find_links="https://data.pyg.org/whl/torch-2.3.0+cu121.html")
         .pip_install("https://github.com/Dao-AILab/flash-attention/releases/download/v2.6.3/flash_attn-2.6.3+cu123torch2.3cxx11abiFALSE-cp311-cp311-linux_x86_64.whl")
         .pip_install("numpy==1.26.4")
         .run_commands(f"git clone --depth 1 https://github.com/VAST-AI-Research/UniRig {REPO}")
         .run_function(download))
app = modal.App("zu-unirig", image=image)


@app.function(gpu="A10G", timeout=1800)
def skin(name: str, data: bytes) -> dict:
    import subprocess, glob, shutil
    os.chdir(REPO)
    # the scripts fetch checkpoints from the hub by repo path: point the cache at the baked copy
    # configs load experiments/<stage>/articulation-xl/model.ckpt; the hub repo holds <stage>/articulation-xl/model.ckpt
    os.makedirs("experiments", exist_ok=True)
    for d in os.listdir("/weights"):
        src, dst = os.path.join("/weights", d), os.path.join("experiments", d)
        if os.path.isdir(src) and not d.startswith(".") and not os.path.exists(dst): shutil.copytree(src, dst)
    inp = f"/tmp/in/{name}.fbx"; os.makedirs("/tmp/in", exist_ok=True); open(inp, "wb").write(data)
    out = f"/tmp/out/{name}_skin.fbx"; os.makedirs("/tmp/out", exist_ok=True)
    r = subprocess.run(["bash", "launch/inference/generate_skin.sh", "--input", inp, "--output", out], capture_output=True, text=True)
    log = (r.stdout[-6000:] + "\n--- stderr ---\n" + r.stderr[-6000:])
    res = {"log": log, "rc": r.returncode}
    if os.path.exists(out): res["fbx"] = open(out, "rb").read()
    npz = glob.glob(f"tmp/**/*.npz", recursive=True)
    res["npz_files"] = npz
    return res


@app.local_entrypoint()
def main(heroes: str = "kaien"):
    names = [h.strip() for h in heroes.split(",") if h.strip()]
    jobs = []
    for h in names:
        p = os.path.join(WORK, f"{h}_clean.fbx")
        if not os.path.exists(p): raise SystemExit(f"missing {p} (assetgen/blender/export_clean.py)")
        jobs.append((h, open(p, "rb").read()))
    for (h, _), res in zip(jobs, skin.starmap(jobs)):
        print(f"==== {h}: rc={res['rc']} npz={res['npz_files'][:3]}")
        print(res["log"][-2500:])
        if "fbx" in res:
            o = os.path.join(WORK, f"{h}_unirig.fbx"); open(o, "wb").write(res["fbx"]); print("saved", o, len(res["fbx"]))
