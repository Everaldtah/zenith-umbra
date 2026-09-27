"""Kaggle job: Tomoe's weapon props in her outfit's own design language - SDXL + IP-Adapter (h94/IP-Adapter, Apache-2.0)
conditioned on her chosen model sheet (dataset everaldtah/zu-tomoe-base: img/model_tomoe_7.png): white lacquer, gold
filigree, turquoise gems, sky blue glow. One object per image on a plain background, side-on, ready for TRELLIS.2.
Outputs /kaggle/working/img/prop_tomoe_<weapon>_<k>.png."""
import glob, json, os, time, urllib.request, threading, traceback

TOPIC = os.environ.get("NTFY_TOPIC", "zu-tomoeprops")
N = int(os.environ.get("TAKES", "6"))


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
from diffusers import StableDiffusionXLPipeline, DPMSolverMultistepScheduler, AutoencoderKL

OUT = "/kaggle/working/img"
os.makedirs(OUT, exist_ok=True)
refs = glob.glob("/kaggle/input/**/model_tomoe_7.png", recursive=True)
publish("ref", found=refs)
REF = Image.open(refs[0]).convert("RGB")

MAT = ("made of glossy white lacquered metal with ornate gold filigree scrollwork, inlaid turquoise gemstones, "
       "sky blue glowing energy accents")
STYLE = ("isolated product shot, single 3D game weapon prop render, the entire object fully visible with empty space around it, side view, "
         "centered, plain flat light grey background, soft even studio lighting, no shadows, polished AAA hero shooter asset, "
         "clean sculpted forms, hand-painted PBR textures, one object only")
NEG = ("person, woman, girl, warrior, figure, face, head, armor suit, hand, character, body, arm, legs, text, watermark, logo, multiple objects, collage, turnaround, cropped, cut off, "
       "blurry, lowres, deformed, busy background, scenery, rust, dirty, grunge")
PROPS = {
    "shotgun": f"weapon prop: a firearm, a heavy pump-action shotgun gun with a thick barrel, a pump and a stock, {MAT}, a flared gold muzzle crown, a gold-ringed pump grip, a turquoise gem set in the stock",
    "axe": f"weapon prop: a huge two-handed battle axe {MAT}, a wide crescent axe head with jagged edge teeth and two curved gold horn spikes, "
           f"a long white haft wrapped in gold bands, a glowing sky blue cutting edge",
    "blade": f"weapon prop: a jagged throwing knife, a short curved cleaver blade {MAT}, serrated edge, a short wrapped handle with a turquoise gem pommel "
             f"and a small crimson tassel",
}
JOBS = [(name, k) for name in PROPS for k in range(N)]


def worker(dev, items, lock):
    try:
        with lock:
            vae = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=torch.float16)
            pipe = StableDiffusionXLPipeline.from_pretrained("stabilityai/stable-diffusion-xl-base-1.0", vae=vae, torch_dtype=torch.float16, variant="fp16", use_safetensors=True)
            pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, use_karras_sigmas=True)
            pipe.load_ip_adapter("h94/IP-Adapter", subfolder="sdxl_models", weight_name="ip-adapter_sdxl.bin")
            style_only = {"up": {"block_0": [0.0, float(os.environ.get("IPA", "1.0")), 0.0]}}
            pipe.set_ip_adapter_scale(style_only)
            pipe.to(f"cuda:{dev}")
        pipe.set_progress_bar_config(disable=True)
        for name, k in items:
            pipe.set_ip_adapter_scale(style_only if k % 2 == 0 else 0.0)
            g = torch.Generator(device=f"cuda:{dev}").manual_seed(5300 + k * 7919 + len(name) * 31)
            img = pipe(prompt=f"{PROPS[name]}, {STYLE}", negative_prompt=NEG, ip_adapter_image=REF, num_inference_steps=32,
                       guidance_scale=7.0, width=1216, height=832 if name != "blade" else 1024, generator=g).images[0]
            img.save(f"{OUT}/prop_tomoe_{name}_{k}.png")
            publish("take", prop=name, k=k, gpu=dev)
    except Exception:
        publish("error", dev=dev, trace=traceback.format_exc()[-1500:])


t0 = time.time()
lock = threading.Lock()
ths = [threading.Thread(target=worker, args=(g, JOBS[g::2], lock)) for g in range(2)]
for t in ths: t.start()
for t in ths: t.join()
publish("done", minutes=round((time.time() - t0) / 60, 1), made=sorted(os.listdir(OUT)))
