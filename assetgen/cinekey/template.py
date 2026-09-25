
# ---------------------------------------------------------------- keyframes for the lore cinematic
# (the screenplay above is inlined by cinematic/prepare.py). Animagine XL 3.1 + IP-Adapter Plus: the hero's key art
# from the live site is the identity reference, the prompt sets the new composition. 2 candidates per shot.
import json, os, time, threading, traceback, urllib.request, io, subprocess, sys

TOPIC = os.environ.get("NTFY_TOPIC", "zu-cinekey")
SITE = "https://zenith-umbra.vercel.app/"
OUT = "/kaggle/working/key"; os.makedirs(OUT, exist_ok=True)
ONLY = [x for x in os.environ.get("ONLY", "").split(",") if x]
N = int(os.environ.get("CANDIDATES", "2"))


def publish(phase, **extra):
    print("PHASE", phase, extra, flush=True)
    try:
        body = json.dumps({"topic": TOPIC, "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception as e:
        print("ntfy failed", e)


publish("boot")
subprocess.run(f"{sys.executable} -m pip install -q -U diffusers transformers accelerate", shell=True)
import torch
from PIL import Image
from diffusers import StableDiffusionXLPipeline, AutoencoderKL, EulerAncestralDiscreteScheduler
from transformers import CLIPVisionModelWithProjection


def ref_image(ref):
    if not ref: return None
    path = f"img/key_{ref}.webp" if not ref.startswith(("map_", "sky_")) else (f"img/{ref}.webp" if ref.startswith("map_") else "env/sky_rift.webp")
    try:
        data = urllib.request.urlopen(SITE + path, timeout=30).read()
        im = Image.open(io.BytesIO(data)).convert("RGB")
        # characters: head and shoulders only, so the reference lends a face and colours but not its pose / backdrop
        if not ref.startswith(("map_", "sky_")): im = im.crop((int(im.width * 0.15), 0, int(im.width * 0.85), int(im.height * 0.5)))
        return im
    except Exception as e:
        publish("ref-missing", ref=ref, err=str(e)[:200]); return None


jobs = [(bi, s) for bi, s in shots() if not ONLY or s["id"] in ONLY]
refs = {}
for _, s in jobs:
    if s["ref"] and s["ref"] not in refs: refs[s["ref"]] = ref_image(s["ref"])
publish("inputs", shots=len(jobs), refs={k: v is not None for k, v in refs.items()})
LOCK = threading.Lock()
done = []


def worker(dev, items):
    try:
        with LOCK:
            enc = CLIPVisionModelWithProjection.from_pretrained("h94/IP-Adapter", subfolder="models/image_encoder", torch_dtype=torch.float16)
            vae = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=torch.float16)
            pipe = StableDiffusionXLPipeline.from_pretrained("cagliostrolab/animagine-xl-3.1", vae=vae, image_encoder=enc, torch_dtype=torch.float16)
            pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
            pipe.load_ip_adapter("h94/IP-Adapter", subfolder="sdxl_models", weight_name="ip-adapter-plus_sdxl_vit-h.safetensors")
            pipe.to(f"cuda:{dev}")
        blank = Image.new("RGB", (224, 224), (128, 128, 128))
        for bi, s in items:
            ref = refs.get(s["ref"]) if s["ref"] else None
            character = bool(s["ref"]) and not s["ref"].startswith(("map_", "sky_"))
            if character and s["ref"] in NOREF: ref = None
            tags = CHAR.get(s["ref"], "") if character else ""
            # characters: strong identity; locations: a light touch (palette / architecture) so the prompt leads
            pipe.set_ip_adapter_scale(0.3 if character and ref is not None else 0.25 if ref is not None else 0.0)
            for k in range(N):
                g = torch.Generator(f"cuda:{dev}").manual_seed(1000 + k * 77 + bi)
                prompt = f"{s['prompt']}, {tags}, detailed scenery background, {STYLE}" if tags else f"{s['prompt']}, {STYLE}"
                img = pipe(prompt=prompt, negative_prompt=NEG, ip_adapter_image=ref or blank, width=1344, height=768,
                           num_inference_steps=28, guidance_scale=6.5, generator=g).images[0]
                img.save(f"{OUT}/{s['id']}_{k}.png")
            done.append(s["id"])
            publish("progress", id=s["id"], done=len(done), total=len(jobs))
    except Exception:
        publish("error", dev=dev, trace=traceback.format_exc()[-1500:])


t0 = time.time()
th = [threading.Thread(target=worker, args=(g, jobs[g::2])) for g in range(2)]
for x in th: x.start()
for x in th: x.join()
publish("done", n=len(done), minutes=round((time.time() - t0) / 60, 1))
