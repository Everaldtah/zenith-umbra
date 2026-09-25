"""Kaggle job: the 2D anime film's drawings.
 A) every model pose capture (dataset zu-poses2d) repainted as 90s cel animation - Neon Genesis Evangelion / Gurren Lagann
    look - by Animagine XL 3.1 + ControlNet canny (img2img, strength ~0.6): the pose, proportions and design come from the
    game model, the drawing style from the prompt. One seed per character keeps frames consistent.
 B) painted anime backgrounds for every set.
Outputs /kaggle/working/art/<id>_<pose>.png and /kaggle/working/bg/<name>_<k>.png; progress via ntfy."""
import glob, json, os, sys, subprocess, threading, time, traceback, urllib.request, zlib

TOPIC = os.environ.get("NTFY_TOPIC", "zu-cine2d")
ONLY = [x for x in os.environ.get("ONLY", "").split(",") if x]
PART = os.environ.get("PART", "AB")
ART, BGD = "/kaggle/working/art", "/kaggle/working/bg"
os.makedirs(ART, exist_ok=True); os.makedirs(BGD, exist_ok=True)


def publish(phase, **extra):
    print("PHASE", phase, extra, flush=True)
    try:
        body = json.dumps({"topic": TOPIC, "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception as e:
        print("ntfy failed", e)


STYLE = ("anime screencap, 1990s anime, neon genesis evangelion style, gurren lagann style, cel shading, hard cel shadows, "
         "bold black lineart, flat colors, retro anime, sharp focus, masterpiece, best quality, very aesthetic")
NEG = ("3d, cgi, 3d render, blender, photorealistic, realistic, blurry, lowres, jpeg artifacts, bad anatomy, bad hands, "
       "extra limbs, deformed, mutated, watermark, text, signature, multiple views, gradient shading, glossy")
CHAR = {
    "haruto": "1boy, teenage pilot, messy brown hair, brown eyes, white and red plugsuit, black chest panel, blue joint pads",
    "mirei": "1girl, short silver-white bob hair, violet eyes, white armored flight suit with sky blue panels, large white mechanical feather wings, glowing blue crystal blades",
    "kaien": "1boy, young monk, black hair in a topknot, white robe, blue hakama, gold sash, beige outer coat, wide sleeves",
    "raijin": "1boy, spiky yellow hair, blue eyes, navy blue long coat with gold trim, katana",
    "yuzu": "1girl, orange hair with twin buns, amber eyes, white and orange bodysuit with gold armor, orange boots, golden bow",
    "vorn": "1man, stern older man, slicked back white hair, scar, grey military greatcoat, red boots",
    "nocturne": "1girl, long white hair, small black horns, red eyes, black corset gown with crimson, crimson bat wings, vampire",
    "hex": "tall thin man, white porcelain mask, black long coat with violet lining, white gloves, puppeteer",
    "kagemaru": "ninja, black hood with animal ears, white fox skull mask, black ninja outfit, purple sash",
    "enra": "giant oni warrior, white bull horns, black and silver spiked armor, red tabard, white mane",
    "qelvaris": "alien, golden elongated head, four glowing eyes, black and violet robe with gold trim, mechanical tentacles",
    "tenkai": "mecha, no humans, giant white and gold super robot, cyan chest core, golden crown crest, golden visor, rocket hammer, eva unit style armor",
    "gorgoth": "mecha, no humans, black and crimson evil robot, red horns, red glowing mono eye, spiked shoulders, eva unit style armor",
}
BGS = {
    "amatsu_dawn": "floating sky islands above a sea of clouds at sunrise, japanese shrine, pagoda, torii gates, stone bridges, orange and pink sunrise sky",
    "amatsu_night": "floating shrine island at night, starry sky, glowing constellations, stone lanterns, torii gate, sea of clouds below",
    "shrine_gate": "red torii gate on a cliff above the clouds at dusk, paper talismans on ropes, purple and orange sky",
    "sacred_tree": "enormous sacred cherry blossom tree on a shrine island, sacred rope, paper seals, glowing spirit lights, night",
    "sacred_tree_fire": "enormous sacred tree engulfed in fire at night, burning paper seals flying, embers, red sky",
    "shrine_steps": "endless stone stairs descending from a floating shrine into the clouds, morning mist",
    "kurogane_street": "neon cyberpunk japanese city street at night, heavy rain, glowing neon signs, wet asphalt reflections, crowds with umbrellas",
    "kurogane_skyline": "neon cyberpunk city skyline at night seen from above, rain, purple clouds, skyscrapers with lit windows",
    "dueling_ring": "underground fighting ring under a city, chain fence, neon lights, rain dripping through a grate, crowd silhouettes",
    "seal_cavern": "dark cavern deep under a city, a huge ancient stone carved with glowing red seal runes, chains",
    "burned_district": "burned ruins of a neon district at night, rain, smoke, broken signs, ash",
    "hangar": "gigantic mecha hangar interior, scaffolding, catwalks, welding sparks, work lights, industrial",
    "hangar_fire": "mecha hangar interior on fire, explosions, alarm lights, debris, smoke",
    "academy_sunset": "futuristic academy training field at sunset, archery targets, white domed buildings, orange sky",
    "academy_night": "futuristic academy campus under attack at night, purple portals in the sky, explosions, fire",
    "eclipse_city": "city skyline under a black solar eclipse, burning red corona, blood red sky, people silhouettes",
    "rift_sky": "violet sky cracked open like glass, a huge rift, purple lightning, floating rocks, wasteland",
    "cathedral": "ruined gothic cathedral interior, huge blood red moon through a broken rose window, candles",
    "void": "dark violet void dimension, floating puppet strings, faint glowing threads, mist",
    "cockpit": "inside a giant robot cockpit, glowing orange screens, control sticks, golden light, entry plug",
    "dawn_ruins": "sunrise over the ruins of a futuristic academy, golden light breaking through smoke, hill",
    "space_lab": "alien laboratory on a space station, violet lights, holographic robot blueprints, earth in the window",
    "orbit_colossus": "enormous robot under construction in orbit above the earth, construction drones, black sun",
    "eclipse_title": "black eclipse sun with a golden dawn breaking on one side, deep space, stars",
    "red_sky": "blood red sky, huge cross shaped explosion of light on the horizon, sea",
    "stars": "deep space starfield, galaxy spiral, cosmic clouds, stars",
}

publish("boot")
t0 = time.time()

# ================================================================ TPU backend (Kaggle TPU v5e-8, PyTorch/XLA) - recipe v2
# Inputs come pre-built from cinematic/tpu_prep.py (dataset zu-paint2d): padded 1152 depth maps + key-art refs + jobs.json.
# Per chip: Animagine XL 3.1 + ControlNet depth + IP-Adapter Plus (the character's key art) -> ADetailer-style face redraw at
# 1024 -> for talking faces an open-mouth variant. Fixed canvases (1152 / 1024) so XLA compiles each graph once per process.
TPU_WORKER = r"""
import os, sys, json, time, traceback, urllib.request
os.environ.setdefault("PJRT_DEVICE", "TPU")
import torch, cv2, numpy as np
from PIL import Image, ImageDraw, ImageFilter
import torch_xla, torch_xla.runtime as xr
from transformers import CLIPVisionModelWithProjection
from diffusers import StableDiffusionXLControlNetPipeline, StableDiffusionXLImg2ImgPipeline, StableDiffusionXLPipeline, ControlNetModel, EulerAncestralDiscreteScheduler
C = json.load(open("/tmp/tpu_cfg.json"))
def publish(phase, **extra):
    try:
        body = json.dumps({"topic": C["topic"], "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception: pass
def run(index):
    rank = -1
    try:
        dev = torch_xla.device(); rank, world = xr.global_ordinal(), xr.world_size()
        bf = torch.bfloat16
        enc = CLIPVisionModelWithProjection.from_pretrained("h94/IP-Adapter", subfolder="models/image_encoder", torch_dtype=bf)
        cn = ControlNetModel.from_pretrained("diffusers/controlnet-depth-sdxl-1.0", torch_dtype=bf, variant="fp16")
        pipe = StableDiffusionXLControlNetPipeline.from_pretrained("cagliostrolab/animagine-xl-3.1", controlnet=cn, image_encoder=enc, torch_dtype=bf)
        pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
        pipe.load_ip_adapter("h94/IP-Adapter", subfolder="sdxl_models", weight_name="ip-adapter-plus_sdxl_vit-h.safetensors")
        pipe.set_ip_adapter_scale(C["ip"])
        pipe.to(dev); pipe.set_progress_bar_config(disable=True)
        i2i = StableDiffusionXLImg2ImgPipeline(**{k: v for k, v in pipe.components.items() if k in ("vae", "text_encoder", "text_encoder_2", "tokenizer", "tokenizer_2", "unet", "scheduler", "image_encoder", "feature_extractor")})
        i2i.set_progress_bar_config(disable=True)
        S, D, neg = C["canvas"], C["dir"], C["neg"]
        mine = C["jobs"][rank::world]
        CAS = cv2.CascadeClassifier(D + "/lbpcascade_animeface.xml")
        def find_face(img):   # the anime face on the drawing itself (never a blade or a wing tip): largest hit, padded 1.8x, square
            gr = cv2.equalizeHist(cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2GRAY))
            f = CAS.detectMultiScale(gr, scaleFactor=1.05, minNeighbors=4, minSize=(48, 48))
            if not len(f): return None
            x, y, w, h = max(f, key=lambda r: r[2] * r[3])
            s = int(max(w, h) * 1.8); cx, cy = x + w / 2, y + h / 2 - h * 0.1
            x0, y0 = int(max(0, min(S - s, cx - s / 2))), int(max(0, min(S - s, cy - s / 2)))
            return [x0, y0, x0 + s, y0 + s]
        def redraw(img, prompt, ref, g, strength):
            return i2i(prompt=prompt, negative_prompt=neg, image=img.resize((1024, 1024), Image.LANCZOS), ip_adapter_image=ref, strength=strength,
                       guidance_scale=6.5, num_inference_steps=30, generator=g).images[0]
        for i, j in enumerate(mine):
            t = time.time(); out = C["out"] + "/" + j["name"]
            if os.path.exists(out + ".png"): continue
            ctrl, ref = Image.open(D + "/" + j["ctrl"]).convert("RGB"), Image.open(D + "/" + j["ref"]).convert("RGB")
            g = torch.Generator("cpu").manual_seed(j["seed"])
            img = pipe(prompt=j["prompt"], negative_prompt=neg, image=ctrl, ip_adapter_image=ref, controlnet_conditioning_scale=0.8,
                       guidance_scale=6.5, num_inference_steps=28, width=S, height=S, generator=g).images[0]
            box = find_face(img) if j["facebox"] else None
            if box:
                x0, y0, x1, y1 = box; crop = img.crop((x0, y0, x1, y1)); w, h = crop.size
                small = redraw(crop, j["faceprompt"], ref, g, 0.42).resize((w, h), Image.LANCZOS)
                m = Image.new("L", (w, h), 0); ImageDraw.Draw(m).ellipse((w * 0.08, h * 0.05, w * 0.92, h * 0.95), fill=255)
                img.paste(small, (x0, y0), m.filter(ImageFilter.GaussianBlur(w * 0.06)))
            x0, y0, w, h = j["crop"]
            if j["talk"]:
                talk = redraw(img, j["prompt"] + ", open mouth, talking", ref, g, 0.3).resize((S, S), Image.LANCZOS)
                talk.crop((x0, y0, x0 + w, y0 + h)).save(out.replace("_face", "_facetalk") + ".png")
            img.crop((x0, y0, x0 + w, y0 + h)).save(out + ".png")
            if rank == 0 and (i < 3 or i % 5 == 0): publish("art", rank=rank, i=i, of=len(mine), secs=round(time.time() - t, 1))
        publish("art-done", rank=rank, n=len(mine))
        if C["bgs"]:
            t2i = StableDiffusionXLPipeline(**{k: v for k, v in pipe.components.items() if k in ("vae", "text_encoder", "text_encoder_2", "tokenizer", "tokenizer_2", "unet", "scheduler")})
            t2i.set_progress_bar_config(disable=True)
            for b in C["bgs"][rank::world]:
                if os.path.exists(b["out"]): continue
                g = torch.Generator("cpu").manual_seed(b["seed"])
                t2i(prompt=b["prompt"], negative_prompt=neg + ", people, character, 1girl, 1boy", width=1536, height=864, num_inference_steps=32, guidance_scale=7.0,
                    generator=g).images[0].save(b["out"])
            publish("bg-done", rank=rank)
    except Exception:
        publish("error", rank=rank, trace=traceback.format_exc()[-1500:])
if __name__ == "__main__":
    torch_xla.launch(run, args=())
"""

if os.environ.get("BACKEND") == "tpu":
    try:
        r = subprocess.run(f"{sys.executable} -c 'import torch_xla'", shell=True, capture_output=True)
        if r.returncode:
            subprocess.run(f"{sys.executable} -m pip install -q torch==2.6.0 'torch_xla[tpu]==2.6.0' -f https://storage.googleapis.com/libtpu-releases/index.html "
                           "-f https://storage.googleapis.com/libtpu-wheels/index.html", shell=True)
        subprocess.run(f"{sys.executable} -m pip install -q -U diffusers transformers accelerate huggingface_hub opencv-python-headless", shell=True, capture_output=True, text=True)
        chk = subprocess.run(f"{sys.executable} -c 'import torch, torch_xla, diffusers; print(torch.__version__, torch_xla.__version__, diffusers.__version__)'", shell=True, capture_output=True, text=True)
        publish("runtime", ok=chk.returncode == 0, versions=chk.stdout.strip(), err=chk.stderr[-600:])
        from huggingface_hub import snapshot_download
        snapshot_download("cagliostrolab/animagine-xl-3.1", allow_patterns=["*.json", "*.txt", "*.safetensors", "*.model"], ignore_patterns=["*.fp32*", "*pytorch_model*"])
        snapshot_download("diffusers/controlnet-depth-sdxl-1.0", allow_patterns=["*.json", "*.fp16.safetensors"])
        snapshot_download("h94/IP-Adapter", allow_patterns=["models/image_encoder/*", "sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors"])
        publish("weights", minutes=round((time.time() - t0) / 60, 1))
        cfgs = glob.glob("/kaggle/input/**/jobs.json", recursive=True)
        D = os.path.dirname(cfgs[0])
        J = json.load(open(cfgs[0]))
        NAMES = [x for x in os.environ.get("NAMES", "").split(",") if x]
        jobs = [j for j in J["jobs"] if (not ONLY or j["name"].split("_")[0] in ONLY) and (not NAMES or j["name"] in NAMES)] if "A" in PART else []
        bgs = [{"out": f"{BGD}/{n}.png", "seed": 500 + zlib.crc32(n.encode()) % 997,
                "prompt": f"{BGS[n]}, scenery, no humans, background art, anime background painting, {STYLE}"} for n in BGS if not os.environ.get("BGN") or n in os.environ["BGN"].split(",")] if "B" in PART else []
        json.dump({"topic": TOPIC, "neg": J["neg"], "canvas": J["canvas"], "dir": D, "out": ART, "ip": float(os.environ.get("IP", "0.5")), "jobs": jobs, "bgs": bgs},
                  open("/tmp/tpu_cfg.json", "w"))
        publish("inputs", n=len(jobs), bgs=len(bgs))
        open("/tmp/tpu_worker.py", "w").write(TPU_WORKER)
        r = subprocess.run([sys.executable, "/tmp/tpu_worker.py"], capture_output=True, text=True)
        publish("done", art=len(os.listdir(ART)), bg=len(os.listdir(BGD)), minutes=round((time.time() - t0) / 60, 1), tail=(r.stdout + r.stderr)[-1500:] if r.returncode else "")
    except Exception:
        publish("error", trace=traceback.format_exc()[-1500:])
    sys.exit(0)

subprocess.run(f"{sys.executable} -m pip install -q -U diffusers transformers accelerate opencv-python-headless", shell=True)
import torch, numpy as np, cv2
from PIL import Image
from diffusers import StableDiffusionXLControlNetImg2ImgPipeline, StableDiffusionXLPipeline, ControlNetModel, AutoencoderKL, EulerAncestralDiscreteScheduler

src = sorted(p for p in glob.glob("/kaggle/input/**/*.png", recursive=True) if "zu-poses2d" in p or "/in2d/" in p)
jobs = [p for p in src if not p.endswith("_m.png") and (not ONLY or os.path.basename(p).split("_")[0] in ONLY)]
publish("inputs", n=len(jobs))
LOCK = threading.Lock()
done = [0]


def load(dev):
    with LOCK:
        vae = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=torch.float16)
        cn = ControlNetModel.from_pretrained("xinsir/controlnet-canny-sdxl-1.0", torch_dtype=torch.float16)
        pipe = StableDiffusionXLControlNetImg2ImgPipeline.from_pretrained("cagliostrolab/animagine-xl-3.1", controlnet=cn, vae=vae, torch_dtype=torch.float16)
        pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
        pipe.to(f"cuda:{dev}")
    return pipe


def worker(dev, items, bgs):
    try:
        pipe = load(dev)
        for p in items:
            name = os.path.basename(p)[:-4]
            cid, pose = name.split("_", 1)
            im = Image.open(p).convert("RGB")
            edges = cv2.Canny(np.asarray(im), 60, 160)
            ctrl = Image.fromarray(np.stack([edges] * 3, -1))
            face = pose.startswith("face")
            prompt = f"{CHAR.get(cid, cid)}, {'portrait, close-up, face focus' if face else 'full body'}, simple grey background, {STYLE}"
            g = torch.Generator(f"cuda:{dev}").manual_seed(zlib.crc32(cid.encode()) % 100000)
            out = pipe(prompt=prompt, negative_prompt=NEG, image=im, control_image=ctrl, strength=0.62 if not face else 0.55,
                       controlnet_conditioning_scale=0.7, guidance_scale=7.0, num_inference_steps=30, width=im.width, height=im.height, generator=g).images[0]
            out.save(f"{ART}/{name}.png")
            done[0] += 1
            if done[0] % 10 == 0: publish("art", done=done[0], total=len(jobs))
        if "B" in PART:
            t2i = StableDiffusionXLPipeline(**{k: v for k, v in pipe.components.items() if k in ("vae", "text_encoder", "text_encoder_2", "tokenizer", "tokenizer_2", "unet", "scheduler")})
            t2i.to(f"cuda:{dev}")
            for name in bgs:
                for k in range(2):
                    g = torch.Generator(f"cuda:{dev}").manual_seed(500 + k * 71 + zlib.crc32(name.encode()) % 997)
                    img = t2i(prompt=f"{BGS[name]}, scenery, no humans, background art, anime background painting, {STYLE}", negative_prompt=NEG + ", people, character",
                              width=1536, height=864, num_inference_steps=30, guidance_scale=7.0, generator=g).images[0]
                    img.save(f"{BGD}/{name}_{k}.png")
                publish("bg", name=name, dev=dev)
    except Exception:
        publish("error", dev=dev, trace=traceback.format_exc()[-1500:])


items = jobs if "A" in PART else []
names = list(BGS) if "B" in PART else []
th = [threading.Thread(target=worker, args=(g, items[g::2], names[g::2])) for g in range(2)]
for x in th: x.start()
for x in th: x.join()
publish("done", art=len(os.listdir(ART)), bg=len(os.listdir(BGD)), minutes=round((time.time() - t0) / 60, 1))
