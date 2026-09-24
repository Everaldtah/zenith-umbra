"""Kaggle job: Mirei v2 concepts by SDXL img2img from her old full-body A-pose concept.
Text-to-image kept framing the realistic redesign as a portrait (cut at the thighs); starting from a full-body image
locks the composition (head-to-boots, A-pose, wings) while the prompt repaints the design.
Outputs /kaggle/working/img/model_mireiv4_<k>.png; progress via ntfy."""
import glob, json, os, threading, traceback, urllib.request

TOPIC = os.environ.get("NTFY_TOPIC", "zu-mireire")


def publish(phase, **extra):
    print("PHASE", phase, extra, flush=True)
    try:
        body = json.dumps({"topic": TOPIC, "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception as e:
        print("ntfy failed", e)


publish("boot")
import torch
from PIL import Image
from diffusers import StableDiffusionXLImg2ImgPipeline, DPMSolverMultistepScheduler

OUT = "/kaggle/working/img"
os.makedirs(OUT, exist_ok=True)
INIT = os.environ.get("INIT", "model_mirei_1")
src = [p for p in glob.glob(f"/kaggle/input/**/img/{INIT}.png", recursive=True)]
publish("inputs", found=src)
init = Image.open(src[0]).convert("RGB").resize((1024, 1024), Image.LANCZOS)
PROMPTS = [MIREI_V2[0][2], MIREI_V2[1][2]]
# (prompt, strength, seed): high strength repaints the design, the layout survives
JOBS = [(p, s, seed) for p in PROMPTS for s in (0.8, 0.88) for seed in (11, 23)]
LOAD_LOCK = threading.Lock()


def worker(dev, items):
    try:
        with LOAD_LOCK:
            pipe = StableDiffusionXLImg2ImgPipeline.from_pretrained("stabilityai/stable-diffusion-xl-base-1.0", torch_dtype=torch.float16, variant="fp16", use_safetensors=True)
            pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, use_karras_sigmas=True)
            pipe.to(f"cuda:{dev}")
        for k, (prompt, strength, seed) in items:
            g = torch.Generator(f"cuda:{dev}").manual_seed(seed)
            img = pipe(prompt=prompt, negative_prompt=REAL_NEG, image=init, strength=strength, guidance_scale=7.5, num_inference_steps=40, generator=g).images[0]
            img.save(f"{OUT}/model_mireiv4_{k}.png")
            publish("img", k=k, strength=strength, dev=dev)
    except Exception:
        publish("error", dev=dev, trace=traceback.format_exc()[-1500:])


items = list(enumerate(JOBS))
ths = [threading.Thread(target=worker, args=(i, items[i::2])) for i in range(2)]
for t in ths: t.start()
for t in ths: t.join()
publish("done", made=sorted(os.listdir(OUT)))
