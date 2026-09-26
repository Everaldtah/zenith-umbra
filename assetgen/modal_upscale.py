"""4x detail upscale of the picked hero concepts on Modal (Real-ESRGAN x4plus, BSD-3, via spandrel): the face
projection (facebake.py) paints faces from the concept, and a ~80 px face is too soft for a close-up.

    modal run assetgen/modal_upscale.py                      # every work/ow/pick/*.png -> work/ow/pick4x/*.png
"""
import io, os, glob
import modal

HERE = os.path.dirname(os.path.abspath(__file__))
PICK = os.path.join(HERE, "..", "work", "ow", "pick")
OUT = os.path.join(HERE, "..", "work", "ow", "pick4x")
URL = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth"

image = (modal.Image.debian_slim(python_version="3.11")
         .pip_install("torch==2.6.0", index_url="https://download.pytorch.org/whl/cu124")
         .pip_install("spandrel", "pillow", "numpy")
         .run_commands(f"python -c \"import urllib.request; urllib.request.urlretrieve('{URL}', '/x4.pth')\""))
app = modal.App("zu-upscale", image=image)


@app.function(gpu="T4", timeout=1200)
def up(name: str, png: bytes) -> bytes:
    import numpy as np, torch
    from PIL import Image
    from spandrel import ModelLoader
    m = ModelLoader().load_from_file("/x4.pth").cuda().eval()
    img = np.asarray(Image.open(io.BytesIO(png)).convert("RGB")).astype(np.float32) / 255
    x = torch.from_numpy(img).permute(2, 0, 1)[None].cuda()
    out = torch.zeros(1, 3, x.shape[2] * 4, x.shape[3] * 4, device="cuda")
    T = 384   # tiles with overlap (T4 memory)
    with torch.no_grad():
        for y0 in range(0, x.shape[2], T - 32):
            for x0 in range(0, x.shape[3], T - 32):
                t = x[:, :, y0:y0 + T, x0:x0 + T]
                o = m(t)
                out[:, :, y0 * 4:y0 * 4 + o.shape[2], x0 * 4:x0 * 4 + o.shape[3]] = o
    res = (out[0].clamp(0, 1).permute(1, 2, 0).cpu().numpy() * 255).round().astype(np.uint8)
    b = io.BytesIO(); Image.fromarray(res).save(b, "PNG"); return b.getvalue()


@app.local_entrypoint()
def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = [(os.path.basename(p)[:-4], open(p, "rb").read()) for p in sorted(glob.glob(os.path.join(PICK, "*.png")))]
    for (n, _), png in zip(jobs, up.starmap(jobs)):
        p = os.path.join(OUT, f"{n}.png"); open(p, "wb").write(png); print("saved", p)
