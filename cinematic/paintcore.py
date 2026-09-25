"""Recipe v2 on CUDA, shared by the Modal app (modal_paint.py) and the Kaggle GPU job (assetgen/cine2d, BACKEND=cuda).
Animagine XL 3.1 + ControlNet depth (the game model's pose) + IP-Adapter Plus (the character's key art) -> anime face redraw.
Inputs are tpu_prep.py's job list: jobs.json + <name>_d.png (depth on the 1152 canvas) + ref_<id>.png, lbpcascade_animeface.xml.
The depth map is cropped to the figure box and drawn at that size (rounded to 64), so outputs match the TPU's crops exactly.
"""
import os, time

NEG_EXTRA = ""


def load(device="cuda", fp8=False):
    import torch
    from transformers import CLIPVisionModelWithProjection
    from diffusers import (StableDiffusionXLControlNetPipeline, StableDiffusionXLImg2ImgPipeline, ControlNetModel, AutoencoderKL,
                           EulerAncestralDiscreteScheduler)
    f16 = torch.float16
    enc = CLIPVisionModelWithProjection.from_pretrained("h94/IP-Adapter", subfolder="models/image_encoder", torch_dtype=f16)
    cn = ControlNetModel.from_pretrained("diffusers/controlnet-depth-sdxl-1.0", torch_dtype=f16, variant="fp16")
    vae = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=f16)
    pipe = StableDiffusionXLControlNetPipeline.from_pretrained("cagliostrolab/animagine-xl-3.1", controlnet=cn, vae=vae, image_encoder=enc, torch_dtype=f16)
    pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
    pipe.load_ip_adapter("h94/IP-Adapter", subfolder="sdxl_models", weight_name="ip-adapter-plus_sdxl_vit-h.safetensors")
    if fp8:   # small cards (<12 GB): fp8 weight storage keeps UNet + ControlNet resident
        pipe.unet.enable_layerwise_casting(storage_dtype=torch.float8_e4m3fn, compute_dtype=f16)
        pipe.controlnet.enable_layerwise_casting(storage_dtype=torch.float8_e4m3fn, compute_dtype=f16)
    pipe.to(device); pipe.set_progress_bar_config(disable=True)
    i2i = StableDiffusionXLImg2ImgPipeline(**{k: v for k, v in pipe.components.items() if k in (
        "vae", "text_encoder", "text_encoder_2", "tokenizer", "tokenizer_2", "unet", "scheduler", "image_encoder", "feature_extractor")})
    i2i.set_progress_bar_config(disable=True)
    return pipe, i2i


def find_face(img, cas):
    """largest lbpcascade_animeface hit on the drawing (2x for small full-body faces), padded 1.8x, square"""
    import cv2, numpy as np
    from PIL import Image
    if cas is None: return None
    gr = cv2.equalizeHist(cv2.cvtColor(np.asarray(img.resize((img.width * 2, img.height * 2), Image.LANCZOS)), cv2.COLOR_RGB2GRAY))
    f = cas.detectMultiScale(gr, scaleFactor=1.05, minNeighbors=4, minSize=(40, 40))
    if not len(f): return None
    x, y, w, h = [v / 2 for v in max(f, key=lambda r: r[2] * r[3])]
    W, H = img.size; s = int(max(w, h) * 1.8); cx, cy = x + w / 2, y + h / 2 - h * 0.1
    x0, y0 = int(max(0, min(W - s, cx - s / 2))), int(max(0, min(H - s, cy - s / 2)))
    return x0, y0, x0 + s, y0 + s


def paint(pipe, i2i, j, D, neg, cas, steps=28):
    """one job -> PIL image (RGB, figure-box size)"""
    import torch
    from PIL import Image, ImageDraw, ImageFilter
    x0, y0, w, h = j["crop"]
    ctrl = Image.open(os.path.join(D, j["ctrl"])).convert("RGB").crop((x0, y0, x0 + w, y0 + h))
    ref = Image.open(os.path.join(D, j["ref"])).convert("RGB")
    pipe.set_ip_adapter_scale(j.get("ip", 0.35))
    gw, gh = max(64, round(w / 64) * 64), max(64, round(h / 64) * 64)
    g = torch.Generator("cpu").manual_seed(j["seed"])
    img = pipe(prompt=j["prompt"], negative_prompt=neg, image=ctrl.resize((gw, gh)), ip_adapter_image=ref, controlnet_conditioning_scale=0.8,
               guidance_scale=6.5, num_inference_steps=steps, width=gw, height=gh, generator=g).images[0].resize((w, h), Image.LANCZOS)
    box = find_face(img, cas) if j.get("facebox") else None
    if box:   # ADetailer-style: redraw the face at 1024, paste back through a feathered ellipse
        bx0, by0, bx1, by1 = box; crop = img.crop(box); cw, chh = crop.size
        out = i2i(prompt=j["faceprompt"], negative_prompt=neg, image=crop.resize((1024, 1024), Image.LANCZOS), ip_adapter_image=ref, strength=0.42,
                  guidance_scale=6.5, num_inference_steps=30, generator=g).images[0].resize((cw, chh), Image.LANCZOS)
        m = Image.new("L", (cw, chh), 0); ImageDraw.Draw(m).ellipse((cw * 0.08, chh * 0.05, cw * 0.92, chh * 0.95), fill=255)
        img.paste(out, (bx0, by0), m.filter(ImageFilter.GaussianBlur(cw * 0.06)))
    return img


def portrait(pipe, j, D, neg, steps=28):
    """close-up: an anime portrait from the key art (IP-Adapter), no depth trace of the low-detail 3D head"""
    import torch
    from PIL import Image
    pose = j["name"].split("_", 1)[1]
    ref = Image.open(os.path.join(D, j["ref"])).convert("RGB")
    pipe.set_ip_adapter_scale(j.get("ip", 0.35) + 0.1)
    view = "looking at viewer, facing viewer" if pose == "facefront" else "three-quarter view"
    prompt = j["faceprompt"].replace("portrait, face focus", f"portrait, upper body, face focus, {view}") + ", simple background"
    g = torch.Generator("cpu").manual_seed(j["seed"] + (1 if pose == "facefront" else 0))
    return pipe(prompt=prompt, negative_prompt=neg, image=Image.new("RGB", (1024, 1024)), controlnet_conditioning_scale=0.0, ip_adapter_image=ref,
                guidance_scale=6.5, num_inference_steps=steps, width=1024, height=1024, generator=g).images[0]


def face_jobs(jobs):
    return [j for j in jobs if j["name"].split("_", 1)[1].startswith("face")]


def body_jobs(jobs):
    """close-ups are painted separately as key-art portraits; GPU / TPU batches only draw the figures"""
    return [j for j in jobs if not j["name"].split("_", 1)[1].startswith("face")]


def run(jobs, D, neg, out_dir=None, device="cuda", fp8=False, on_done=None):
    """paint a list of jobs; saves to out_dir and/or calls on_done(name, img)"""
    import cv2
    pipe, i2i = load(device, fp8)
    cas = cv2.CascadeClassifier(os.path.join(D, "lbpcascade_animeface.xml"))
    if cas.empty(): cas = None
    for j in jobs:
        if out_dir and os.path.exists(os.path.join(out_dir, j["name"] + ".png")): continue
        t = time.time()
        try:
            img = paint(pipe, i2i, j, D, neg, cas)
        except Exception as e:
            print("FAILED", j["name"], repr(e)[:300], flush=True); continue
        if out_dir: img.save(os.path.join(out_dir, j["name"] + ".png"))
        if on_done: on_done(j["name"], img)
        print("done", j["name"], round(time.time() - t, 1), "s", flush=True)
