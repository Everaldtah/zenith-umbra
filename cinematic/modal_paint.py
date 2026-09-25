"""The 2D film's figure drawings on Modal (serverless GPUs, free $30/month credit): recipe v2 via paintcore.py, fanned out
over up to 10 A10G containers. Weights + the tpu_prep inputs are baked into the image, so each container only loads.
    modal run modal_paint.py                  # every figure job not yet drawn anywhere
    modal run modal_paint.py --limit 4        # a quick look first
Results land in work/gpu_out/art/<name>.png as they finish.
"""
import io, json, os
import modal

HERE = os.path.dirname(os.path.abspath(__file__))
IN = os.path.join(HERE, "work", "tpu_in")
OUT = os.path.join(HERE, "work", "gpu_out", "art")
DONE_ELSEWHERE = [os.path.join(HERE, "work", d) for d in ("art_local", os.path.join("tpu_out", "art"))]


def download():
    from huggingface_hub import snapshot_download
    snapshot_download("cagliostrolab/animagine-xl-3.1", allow_patterns=["*.json", "*.txt", "*.safetensors", "*.model"],
                      ignore_patterns=["*.fp32*", "*pytorch_model*", "animagine-xl-3.1.safetensors"])
    snapshot_download("diffusers/controlnet-depth-sdxl-1.0", allow_patterns=["*.json", "*.fp16.safetensors"])
    snapshot_download("madebyollin/sdxl-vae-fp16-fix", allow_patterns=["*.json", "*.safetensors"])
    snapshot_download("h94/IP-Adapter", allow_patterns=["models/image_encoder/*", "sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors"])


image = (modal.Image.debian_slim(python_version="3.11")
         .apt_install("libgl1", "libglib2.0-0")
         .pip_install("torch==2.6.0", "diffusers==0.40.0", "transformers==5.17.0", "tokenizers==0.23.2", "accelerate==1.15.0",
                      "huggingface_hub==1.33.0", "safetensors==0.8.0", "opencv-python-headless<5",
                      "pillow", "sentencepiece==0.2.2")
         .run_function(download)
         .add_local_dir(IN, "/in")
         .add_local_python_source("paintcore"))
app = modal.App("zu-paint2d", image=image)


@app.cls(gpu="A10G", timeout=3600, scaledown_window=60)
class Painter:
    @modal.enter()
    def setup(self):
        import cv2, paintcore
        self.pc = paintcore
        self.pipe, self.i2i = paintcore.load("cuda")
        self.cas = cv2.CascadeClassifier("/in/lbpcascade_animeface.xml")
        self.neg = json.load(open("/in/jobs.json"))["neg"]

    @modal.method()
    def paint(self, j):
        face = j["name"].split("_", 1)[1].startswith("face")
        img = self.pc.portrait(self.pipe, j, "/in", self.neg) if face else self.pc.paint(self.pipe, self.i2i, j, "/in", self.neg, self.cas)
        b = io.BytesIO(); img.save(b, "PNG")
        return j["name"], b.getvalue()


@app.local_entrypoint()
def main(limit: int = 0, names: str = "", portraits: bool = False):
    import paintcore
    os.makedirs(OUT, exist_ok=True)
    J = json.load(open(os.path.join(IN, "jobs.json")))["jobs"]
    jobs = paintcore.face_jobs(J) if portraits else paintcore.body_jobs(J)
    drawn = lambda n: any(os.path.exists(os.path.join(d, n + ".png")) for d in [OUT, *DONE_ELSEWHERE])
    jobs = [j for j in jobs if not drawn(j["name"]) and (not names or j["name"] in names.split(","))]
    if limit: jobs = jobs[:limit]
    print(f"painting {len(jobs)} drawings on Modal", flush=True)
    n = 0
    for r in Painter().paint.map(jobs, order_outputs=False, return_exceptions=True):
        if isinstance(r, Exception): print("FAILED", repr(r)[:300], flush=True); continue
        name, png = r
        open(os.path.join(OUT, name + ".png"), "wb").write(png); n += 1
        print("done", name, f"{n}/{len(jobs)}", flush=True)
