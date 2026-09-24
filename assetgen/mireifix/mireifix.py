"""Kaggle job A: SDXL renders for every ZENITH//UMBRA image (see assets.py), both T4s in parallel.
Outputs /kaggle/working/img/<name>_<k>.png; progress via ntfy."""
import json, os, time, urllib.request, threading, traceback, zlib

TOPIC = os.environ.get("NTFY_TOPIC", "zu-mireifix")


def publish(phase, **extra):
    print("PHASE", phase, extra, flush=True)
    try:
        body = json.dumps({"topic": TOPIC, "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception as e:
        print("ntfy failed", e)


publish("boot")
import torch
from diffusers import StableDiffusionXLPipeline, DPMSolverMultistepScheduler

OUT = "/kaggle/working/img"
os.makedirs(OUT, exist_ok=True)
ONLY = [s for s in os.environ.get("ONLY", "").split(",") if s]
ALL = [j for j in jobs5() if not ONLY or j[0] in ONLY]
# balance the two GPUs by pixel count
ALL.sort(key=lambda j: -(j[4] * j[5] * j[6]))
halves, load = [[], []], [0, 0]
for j in ALL:
    g = 0 if load[0] <= load[1] else 1
    halves[g].append(j); load[g] += j[4] * j[5] * j[6]
LOAD_LOCK = threading.Lock()
done = []


def worker(dev, items):
    try:
        with LOAD_LOCK:
            pipe = StableDiffusionXLPipeline.from_pretrained("stabilityai/stable-diffusion-xl-base-1.0", torch_dtype=torch.float16, variant="fp16", use_safetensors=True)
            pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, use_karras_sigmas=True)
            pipe.to(f"cuda:{dev}")
        pipe.set_progress_bar_config(disable=True)
        pipe.enable_vae_tiling()
        for name, kind, prompt, neg, w, h, n in items:
            for k in range(n):
                g = torch.Generator(device=f"cuda:{dev}").manual_seed(int(os.environ.get("SEED_OFF", "0")) + 77 + k * 7919 + zlib.crc32(name.encode()) % 100000)
                img = pipe(prompt=prompt, negative_prompt=neg, num_inference_steps=30, guidance_scale=6.5 if kind in ("model", "prop") else 7.0,
                           width=w, height=h, generator=g).images[0]
                img.save(f"{OUT}/{name}_{k}.png")
            done.append(name)
            if len(done) % 6 == 0:
                publish("progress", done=len(done), total=len(ALL))
    except Exception:
        publish("error", dev=dev, trace=traceback.format_exc()[-1500:])


t0 = time.time()
threads = [threading.Thread(target=worker, args=(i, halves[i])) for i in range(2)]
for t in threads: t.start()
for t in threads: t.join()
publish("done", assets=len(done), of=len(ALL), minutes=round((time.time() - t0) / 60, 1))
