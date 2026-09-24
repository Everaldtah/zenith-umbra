"""Kaggle job: key art + face portraits that MATCH each 3D model. SDXL img2img from the exact concept image the model was
built from: (1) key art = the concept re-painted as an anime splash, (2) portrait = head crop upscaled and refined.
Outputs /kaggle/working/img/key_<id>_<k>.png and portrait_<id>_<k>.png."""
import json, os, time, urllib.request, traceback, glob, threading, subprocess

TOPIC = os.environ.get("NTFY_TOPIC", "zu-artfix")


def publish(phase, **extra):
    print("PHASE", phase, extra, flush=True)
    try:
        body = json.dumps({"topic": TOPIC, "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception as e:
        print("ntfy failed", e)


publish("boot")
subprocess.run("pip install -q rembg onnxruntime", shell=True)
import numpy as np, torch
from PIL import Image
from diffusers import StableDiffusionXLImg2ImgPipeline, DPMSolverMultistepScheduler
from rembg import remove, new_session

PICKS = dict(p.split(":") for p in os.environ.get("PICKS", "").split(",") if p)
SUBJ = {k: v[1] for k, v in MODELS2.items()}
SUBJ["qelvaris"] = CAMPAIGN["qelvaris"][1]
SUBJ["mireiv4"] = ("angelic combat medic heroine Mirei, adult woman with short silver-white hair, sleek white armored flight suit with sky blue panels, "
                   "large mechanical wings of white and crystal-blue metal feathers")
REAL = os.environ.get("REAL") == "1"      # stylized-realistic hero shooter look instead of anime cel shading
SCENE = {
    "tenkai": "raising a blazing sun sword above a city at dawn, golden light rays", "gorgoth": "in a burning hangar, sparks and red light",
    "mirei": "flying through a starry night sky casting starlight", "mireiv4": "soaring above a starlit city at night, wings spread wide, healing starlight streaming from her hand", "nocturne": "singing in a gothic cathedral under a blood red moon",
    "kaien": "on a floating mountain shrine surrounded by glowing talismans and cherry blossoms", "kagemaru": "emerging from shadow smoke on a moonlit rooftop",
    "raijin": "mid-dash in a rainy neon city, blue lightning trailing the katana", "enra": "roaring amid a violet eclipse storm with burning gauntlets",
    "yuzu": "drawing her bow on a rooftop at sunrise", "hex": "in a dark twisted puppet theater with glowing violet strings",
    "haruto": "in the glowing cockpit of a white and gold super robot", "vorn": "in the dark red cockpit of a black mecha", "qelvaris": "in a violet laboratory full of giant robot schematics",
}
OUT = "/kaggle/working/img"; os.makedirs(OUT, exist_ok=True)
dirs = sorted([d for d in glob.glob("/kaggle/input/**/img", recursive=True) if os.path.isdir(d)], key=lambda d: "hexfix" in d)
src = {}
for d in dirs:
    for aid, k in PICKS.items():
        p = f"{d}/model_{aid}_{k}.png"
        if os.path.exists(p): src[aid] = p
publish("inputs", n=len(src), missing=[a for a in PICKS if a not in src])
sess = new_session("isnet-anime")


def head_crop(img: Image.Image, mech: bool):
    rgba = remove(img.convert("RGB"), session=sess)
    a = np.array(rgba)[..., 3] > 100
    ys, xs = np.where(a)
    y0, y1 = ys.min(), ys.max()
    hb = int((y1 - y0) * (0.2 if mech else 0.17))
    band = a[y0:y0 + hb]
    cols = np.where(band.any(0))[0]
    cx = int(np.average(np.arange(band.shape[1]), weights=band.sum(0) + 1e-6)) if cols.size else img.width // 2
    side = int(hb * 1.9)
    top = max(0, y0 - int(hb * 0.25))
    box = (max(0, cx - side // 2), top, min(img.width, cx + side // 2), min(img.height, top + side))
    c = img.convert("RGB").crop(box)
    return c.resize((1024, 1024), Image.LANCZOS)


def keyart_canvas(img: Image.Image):
    rgba = remove(img.convert("RGB"), session=sess)
    bg = Image.new("RGB", (832, 1216), (40, 44, 70))
    fig = rgba.crop(rgba.getbbox())
    fig.thumbnail((760, 1150), Image.LANCZOS)
    bg.paste(fig, ((832 - fig.width) // 2, 1216 - fig.height - 20), fig)
    return bg


LOAD = threading.Lock()
jobs = sorted(src.items())
done = []


def worker(dev, items):
    try:
        with LOAD:
            pipe = StableDiffusionXLImg2ImgPipeline.from_pretrained("stabilityai/stable-diffusion-xl-base-1.0", torch_dtype=torch.float16, variant="fp16", use_safetensors=True)
            pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, use_karras_sigmas=True)
            pipe.to(f"cuda:{dev}")
        pipe.set_progress_bar_config(disable=True)
        for aid, path in items:
            img = Image.open(path)
            mech = aid in ("tenkai", "gorgoth")
            subj = SUBJ.get(aid, aid)
            for k in range(2):
                g = torch.Generator(f"cuda:{dev}").manual_seed(900 + k * 31)
                face = head_crop(img, mech)
                prompt = (f"stylized realistic 3D game character portrait, close-up of the face and shoulders of {subj}, detailed natural face, soft rim light, "
                          "hero shooter character select portrait, high quality render") if REAL else (f"anime character portrait, close-up of the {'robot head and helmet' if mech else 'face and shoulders'} of {subj}, "
                          "highly detailed face, expressive eyes, clean crisp lineart, detailed cel shading, soft rim light, game character select portrait, masterpiece")
                neg = "blurry, lowres, deformed face, extra eyes, bad anatomy, text, watermark, cropped, multiple people"
                pipe(prompt=prompt, negative_prompt=neg, image=face, strength=0.5 if not mech else 0.45, guidance_scale=7, num_inference_steps=36, generator=g).images[0].save(f"{OUT}/portrait_{aid}_{k}.png")
                canvas = keyart_canvas(img)
                kp = (f"stylized realistic hero shooter key art of {subj}, {SCENE.get(aid, '')}, dynamic heroic composition, dramatic cinematic lighting, "
                      "high quality 3D game splash art") if REAL else (f"anime key visual illustration of {subj}, {SCENE.get(aid, '')}, dynamic heroic composition, dramatic lighting, "
                      "detailed cel shading, vibrant colors, high quality anime game splash art, masterpiece")
                pipe(prompt=kp, negative_prompt=neg, image=canvas, strength=float(os.environ.get("KEYSTR", "0.68")), guidance_scale=7.5, num_inference_steps=40, generator=g).images[0].save(f"{OUT}/key_{aid}_{k}.png")
            done.append(aid)
            publish("progress", id=aid, done=len(done), total=len(jobs))
    except Exception:
        publish("error", dev=dev, trace=traceback.format_exc()[-1500:])


t0 = time.time()
ths = [threading.Thread(target=worker, args=(i, jobs[i::2])) for i in range(2)]
for t in ths: t.start()
for t in ths: t.join()
publish("done", n=len(done), minutes=round((time.time() - t0) / 60, 1))
