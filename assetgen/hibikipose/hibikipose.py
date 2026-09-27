"""Kaggle job: Hibiki's rig-ready model sheet - SDXL + an OpenPose ControlNet (xinsir, Apache-2.0) held to a drawn
full-body A-pose skeleton, so every take is head-to-skates, front view, arms out (plain SDXL drew waist-up portraits).
Both T4s in parallel. Outputs /kaggle/working/img/model_hibiki_<k>.png (+ the pose map)."""
import json, os, time, urllib.request, threading, traceback, math

TOPIC = os.environ.get("NTFY_TOPIC", "zu-hibikipose")
N = int(os.environ.get("TAKES", "6"))       # per GPU


def publish(phase, **extra):
    print("PHASE", phase, extra, flush=True)
    try:
        body = json.dumps({"topic": TOPIC, "message": json.dumps({"phase": phase, **extra})[:3800]}).encode()
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh", data=body, headers={"Content-Type": "application/json"}), timeout=15).read()
    except Exception as e:
        print("ntfy failed", e)


publish("boot")
import numpy as np, torch
from PIL import Image, ImageDraw
from diffusers import StableDiffusionXLControlNetPipeline, ControlNetModel, DPMSolverMultistepScheduler, AutoencoderKL

W, H = 832, 1216
OUT = "/kaggle/working/img"
os.makedirs(OUT, exist_ok=True)

# OpenPose-18 A-pose, front view (the character's right is image left), normalised to the canvas
KP = [(0.500, 0.112), (0.500, 0.188), (0.402, 0.196), (0.338, 0.322), (0.290, 0.448), (0.598, 0.196), (0.662, 0.322), (0.710, 0.448),
      (0.452, 0.498), (0.442, 0.692), (0.438, 0.884), (0.548, 0.498), (0.558, 0.692), (0.562, 0.884),
      (0.486, 0.100), (0.514, 0.100), (0.468, 0.110), (0.532, 0.110)]
LIMBS = [[2, 3], [2, 6], [3, 4], [4, 5], [6, 7], [7, 8], [2, 9], [9, 10], [10, 11], [2, 12], [12, 13], [13, 14], [2, 1], [1, 15], [15, 17], [1, 16], [16, 18]]
COLS = [[255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0], [0, 255, 85], [0, 255, 170],
        [0, 255, 255], [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255], [170, 0, 255], [255, 0, 255], [255, 0, 170], [255, 0, 85]]


def pose_map():
    """the standard OpenPose render (coloured limb ellipses at 60% over black, then joint dots)"""
    base = Image.new("RGB", (W, H), (0, 0, 0))
    pts = [(x * W, y * H) for x, y in KP]
    sw = 4 * H / 512
    for i, (a, b) in enumerate(LIMBS):
        (x1, y1), (x2, y2) = pts[a - 1], pts[b - 1]
        mx, my, L = (x1 + x2) / 2, (y1 + y2) / 2, math.hypot(x2 - x1, y2 - y1) / 2
        ang = math.atan2(y2 - y1, x2 - x1)
        poly = [(mx + L * math.cos(ang) * math.cos(t) - sw * math.sin(ang) * math.sin(t), my + L * math.sin(ang) * math.cos(t) + sw * math.cos(ang) * math.sin(t))
                for t in np.linspace(0, 2 * math.pi, 40)]
        layer = Image.new("RGB", (W, H), (0, 0, 0)); ImageDraw.Draw(layer).polygon(poly, fill=tuple(COLS[i]))
        base = Image.composite(Image.blend(base, layer, 0.6), base, layer.convert("L").point(lambda v: 255 if v else 0))
    d = ImageDraw.Draw(base)
    for i, (x, y) in enumerate(pts):
        d.ellipse([x - sw, y - sw, x + sw, y + sw], fill=tuple(COLS[i]))
    return base


DESIGN = ("full body 3D character model of an energetic street DJ hero named Hibiki, young adult Black man with dark brown skin, friendly grin, "
          "short twisted locs with gold-dyed tips tied up high on his head, big white over-ear DJ headphones with glowing sky blue rings around his neck, "
          "cropped white and gold tech bomber jacket with sky blue equalizer stripes on the sleeves, fitted black shirt, gold chain with a small vinyl record pendant, "
          "black joggers with white knee guards, chunky white and gold inline roller skates with glowing sky blue wheels, a compact turntable speaker rig on his back, "
          "black fingerless gloves, empty open hands")
STYLE = ("stylized 3D game character render, polished AAA hero shooter art style, clean sculpted forms, hand-painted PBR textures, "
         "standing in a symmetrical A-pose with arms held out from the body, front view, the entire figure from the top of the head to the wheels "
         "of the skates visible, plain flat light grey background, soft even studio lighting, no shadows, one character only")
NEG = ("cropped, cut off feet, cut off legs, waist up, half body, portrait, close-up, headshot, sitting, crouching, action pose, background scenery, city, "
       "text, watermark, logo, multiple views, turnaround, two characters, weapon, gun, microphone, holding an object, extra limbs, extra fingers, deformed hands, "
       "blurry, lowres, anime screenshot, flat 2D illustration, sketch, lineart, sunglasses")
PROMPTS = [f"{DESIGN}, {STYLE}", f"{DESIGN}, bright clean colours, {STYLE}, full length shot"]


def worker(dev, seeds, lock):
    try:
        with lock:
            cn = ControlNetModel.from_pretrained("xinsir/controlnet-openpose-sdxl-1.0", torch_dtype=torch.float16)
            vae = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=torch.float16)
            pipe = StableDiffusionXLControlNetPipeline.from_pretrained("stabilityai/stable-diffusion-xl-base-1.0", controlnet=cn, vae=vae,
                                                                       torch_dtype=torch.float16, variant="fp16", use_safetensors=True)
            pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, use_karras_sigmas=True)
            pipe.to(f"cuda:{dev}")
        pipe.set_progress_bar_config(disable=True); pipe.enable_vae_tiling()
        pm = pose_map()
        for k in seeds:
            g = torch.Generator(device=f"cuda:{dev}").manual_seed(4200 + k * 7919)
            img = pipe(prompt=PROMPTS[k % 2], negative_prompt=NEG, image=pm, controlnet_conditioning_scale=0.95, control_guidance_end=0.8,
                       num_inference_steps=32, guidance_scale=6.5, width=W, height=H, generator=g).images[0]
            img.save(f"{OUT}/model_hibiki_{k}.png")
            publish("take", k=k, gpu=dev)
    except Exception:
        publish("error", dev=dev, trace=traceback.format_exc()[-1500:])


t0 = time.time()
pose_map().save(f"{OUT}/pose_apose.png")
lock = threading.Lock()
ths = [threading.Thread(target=worker, args=(g, list(range(g, 2 * N, 2)), lock)) for g in range(2)]
for t in ths: t.start()
for t in ths: t.join()
publish("done", minutes=round((time.time() - t0) / 60, 1), made=sorted(os.listdir(OUT)))
