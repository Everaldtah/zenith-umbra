"""2D anime key drawings from the game models - recipe v2.
pose + proportions: a depth map of the model frame (Depth-Anything V2 on the capture, masked to its silhouette) -> ControlNet depth
look + design:      the character's 2D anime key art through IP-Adapter Plus, and an Evangelion / Gurren Lagann cel-style prompt
drawing:            Animagine XL 3.1 text-to-image (nothing of the 3D render's pixels is kept), cut out with isnet-anime
    python paint2d.py <id_pose,...> [--steps 28]     -> work/art2d/<id>_<pose>.png (RGBA)
"""
import argparse, os, sys, zlib, json
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
IN, OUT, REF = os.path.join(HERE, 'work', 'in2d'), os.path.join(HERE, 'work', 'art2d'), os.path.join(HERE, '..', 'public', 'img')
os.makedirs(OUT, exist_ok=True)
QUAL = "masterpiece, best quality, very aesthetic, 1990s anime"   # first: SDXL's CLIP keeps only 77 tokens
STYLE = "evangelion style, gurren lagann style, cel shading, bold lineart, flat colors"
NEG = ("3d, cgi, 3d render, blender, photorealistic, realistic, blurry, lowres, jpeg artifacts, bad anatomy, bad hands, "
       "extra limbs, extra arms, deformed, mutated, watermark, text, signature, multiple views, soft shading, glossy, noise, sketch, "
       "scenery, city, building, glowing aura, outer glow, halo, navel, midriff, revealing clothes")
CHAR = {
    "haruto": "1boy, teenage boy, messy brown hair, brown eyes, white and red plugsuit, black chest panel, blue joint pads",
    "mirei": "1girl, short silver-white bob hair, violet eyes, white armored flight suit with sky blue panels, white mechanical feather wings, blue crystal blades",
    "kaien": "1boy, young monk, black hair in a topknot, white robe, blue hakama, gold sash, beige outer coat, wide sleeves",
    "raijin": "1boy, spiky yellow hair, blue eyes, navy blue long coat with gold trim, katana",
    "yuzu": "1girl, orange hair with twin buns, amber eyes, white and orange bodysuit with gold armor, orange boots, golden bow",
    "vorn": "1man, stern old man, slicked back white hair, scar, grey military greatcoat, red boots",
    "nocturne": "1girl, long white hair, small black horns, red eyes, black corset gown with crimson, crimson bat wings, vampire",
    "hex": "1man, tall thin man, white porcelain mask, black long coat with violet lining, white gloves, puppeteer",
    "kagemaru": "1boy, ninja, black hood with animal ears, white fox skull mask, black ninja outfit, purple sash",
    "enra": "oni, giant armored demon warrior, white bull horns, black and silver spiked armor, red tabard, white mane",
    "qelvaris": "alien, golden elongated head, four glowing eyes, black and violet robe with gold trim, mechanical tentacles",
    "tenkai": "mecha, white and gold armor, cyan chest core, golden crown crest, eva unit style, rocket hammer",
    "brother": "1boy, young boy, messy orange hair, amber eyes, white and orange academy uniform, orange sneakers",
    "gorgoth": "mecha, black and crimson armor, red horns, red glowing mono eye, spiked shoulders, eva unit style",
}


def depth_map(dpt, name):
    im = Image.open(os.path.join(IN, f'{name}.png')).convert('RGB')
    m = Image.open(os.path.join(IN, f'{name}_m.png')).convert('L').resize(im.size)
    d = np.asarray(dpt(im)['depth'].resize(im.size), dtype=np.float32)
    ma = np.asarray(m, dtype=np.float32) / 255
    d = d * ma
    fg = d[ma > 0.5]
    if fg.size: lo, hi = np.percentile(fg, 2), np.percentile(fg, 98); d = np.clip((d - lo) / max(1e-3, hi - lo), 0, 1) * 0.85 + 0.15
    d = d * ma
    return Image.fromarray((d * 255).astype(np.uint8)).convert('RGB'), im.size


MECH = {'tenkai', 'gorgoth'}
FACE = "detailed face, detailed eyes"


MECHSTYLE = "hard shadows, dark shading"
IP_HUMAN, IP_MECH = 0.35, 0.3   # key art keeps the design on-model; higher scales bleed its background + lighting in


def prompt_for(cid, framing):
    return f"{QUAL}, {STYLE}, " + (f"{MECHSTYLE}, " if cid in MECH else "") + f"{framing}, {CHAR[cid]}"


def ip_for(cid):
    return IP_MECH if cid in MECH else IP_HUMAN


def head_box(name, size):
    """the head, from the model silhouette: the top 1/7 of the figure, centred on its opaque columns"""
    m = np.asarray(Image.open(os.path.join(IN, f'{name}_m.png')).convert('L').resize(size)) > 128
    ys, xs = np.where(m)
    if not len(ys): return None
    top, bot = ys.min(), ys.max(); hh = (bot - top) / 7.0
    band = m[top:int(top + hh * 1.1)]
    cols = np.where(band.any(0))[0]
    cx = (cols.min() + cols.max()) / 2 if len(cols) else (xs.min() + xs.max()) / 2
    s = hh * 1.7
    return int(cx - s / 2), int(top - hh * 0.25), int(cx + s / 2), int(top - hh * 0.25 + s)


CAS_PATH = os.path.join(HERE, 'work', 'tpu_in', 'lbpcascade_animeface.xml')


def find_face(img):
    """the anime face on the drawing itself (never a blade or wing tip): largest lbpcascade_animeface hit, padded 1.8x, square"""
    import cv2
    cas = cv2.CascadeClassifier(CAS_PATH)
    gr = cv2.equalizeHist(cv2.cvtColor(np.asarray(img.resize((img.width * 2, img.height * 2), Image.LANCZOS)), cv2.COLOR_RGB2GRAY))
    f = cas.detectMultiScale(gr, scaleFactor=1.05, minNeighbors=4, minSize=(40, 40))   # 2x: small full-body faces too
    if not len(f): return None
    x, y, w, h = [v / 2 for v in max(f, key=lambda r: r[2] * r[3])]
    W, H = img.size; s = int(max(w, h) * 1.8); cx, cy = x + w / 2, y + h / 2 - h * 0.1
    x0, y0 = int(max(0, min(W - s, cx - s / 2))), int(max(0, min(H - s, cy - s / 2)))
    return x0, y0, x0 + s, y0 + s


def detail_face(i2i, img, box, prompt, g, ref):
    """ADetailer-style: redraw the face at 1024 px, paste back through a feathered ellipse"""
    from PIL import ImageDraw, ImageFilter
    x0, y0, x1, y1 = box
    crop = img.crop(box); w, h = crop.size
    big = crop.resize((1024, 1024), Image.LANCZOS)
    out = i2i(prompt=prompt, negative_prompt=NEG, image=big, ip_adapter_image=ref, strength=0.42, guidance_scale=6.5, num_inference_steps=30, generator=g).images[0]
    small = out.resize((w, h), Image.LANCZOS)
    mask = Image.new('L', (w, h), 0); ImageDraw.Draw(mask).ellipse((w * 0.08, h * 0.05, w * 0.92, h * 0.95), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(w * 0.06))
    img.paste(small, (x0, y0), mask)
    return img


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('names', nargs='?', default='')
    ap.add_argument('--jobs', action='store_true', help='paint the TPU job list (work/tpu_in/jobs.json) backwards -> work/art_local'); ap.add_argument('--steps', type=int, default=28); ap.add_argument('--ip', type=float, default=0.5); ap.add_argument('--max', type=int, default=1152)
    a = ap.parse_args()
    import torch
    from transformers import pipeline as hf_pipeline
    from transformers import CLIPVisionModelWithProjection
    from diffusers import StableDiffusionXLControlNetPipeline, ControlNetModel, AutoencoderKL, EulerAncestralDiscreteScheduler
    from rembg import remove, new_session
    dpt = hf_pipeline('depth-estimation', model='depth-anything/Depth-Anything-V2-Small-hf', device=0)
    enc = CLIPVisionModelWithProjection.from_pretrained('h94/IP-Adapter', subfolder='models/image_encoder', torch_dtype=torch.float16)
    cn = ControlNetModel.from_pretrained('diffusers/controlnet-depth-sdxl-1.0', torch_dtype=torch.float16, variant='fp16')
    vae = AutoencoderKL.from_pretrained('madebyollin/sdxl-vae-fp16-fix', torch_dtype=torch.float16)
    pipe = StableDiffusionXLControlNetPipeline.from_pretrained('cagliostrolab/animagine-xl-3.1', controlnet=cn, vae=vae, image_encoder=enc, torch_dtype=torch.float16)
    pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
    pipe.load_ip_adapter('h94/IP-Adapter', subfolder='sdxl_models', weight_name='ip-adapter-plus_sdxl_vit-h.safetensors')
    pipe.set_ip_adapter_scale(a.ip)
    # fp8 weight storage (compute stays fp16): UNet 5.1 -> 2.6 GB, ControlNet 2.5 -> 1.25 GB, so a 6 GB card never spills
    # into shared memory (24 s/step -> ~1.5 s/step on the RTX 3050)
    pipe.unet.enable_layerwise_casting(storage_dtype=torch.float8_e4m3fn, compute_dtype=torch.float16)
    pipe.controlnet.enable_layerwise_casting(storage_dtype=torch.float8_e4m3fn, compute_dtype=torch.float16)
    pipe.enable_model_cpu_offload(); pipe.vae.enable_tiling()
    from diffusers import StableDiffusionXLImg2ImgPipeline
    i2i = StableDiffusionXLImg2ImgPipeline(**{k: v for k, v in pipe.components.items() if k in ('vae', 'text_encoder', 'text_encoder_2', 'tokenizer', 'tokenizer_2', 'unet', 'scheduler', 'image_encoder', 'feature_extractor')})
    i2i.enable_model_cpu_offload()
    if a.jobs: return run_jobs(pipe, i2i, a)
    sess = new_session('isnet-anime')
    for name in a.names.split(','):
        cid, pose = name.split('_', 1)
        ctrl, size = depth_map(dpt, name)
        ctrl.save(os.path.join(OUT, f'{name}_depth.png'))
        ref_p = os.path.join(REF, f'key_{cid}.webp')
        ref = Image.open(ref_p).convert('RGB') if os.path.exists(ref_p) else Image.new('RGB', (224, 224), (128, 128, 128))
        pipe.set_ip_adapter_scale(ip_for(cid))
        face = pose.startswith('face')
        prompt = prompt_for(cid, f"{'portrait, face focus, ' + FACE if face else 'full body, standing, simple white background'}")
        g = torch.Generator('cpu').manual_seed(zlib.crc32(cid.encode()) % 100000)
        k = min(1.0, a.max / max(size)); w, h = int(size[0] * k) // 64 * 64, int(size[1] * k) // 64 * 64
        img = pipe(prompt=prompt, negative_prompt=NEG, image=ctrl.resize((w, h)), ip_adapter_image=ref, controlnet_conditioning_scale=0.8,
                   guidance_scale=6.5, num_inference_steps=a.steps, width=w, height=h, generator=g).images[0]
        if cid not in MECH and not face:
            img.save(os.path.join(OUT, f'{name}_preface.png'))
            box = find_face(img)
            print('face box', name, box, flush=True)
            if box: img = detail_face(i2i, img, box, prompt_for(cid, f"portrait, face focus, {FACE}"), g, ref)
        img.save(os.path.join(OUT, f'{name}_raw.png'))
        remove(img, session=sess).save(os.path.join(OUT, f'{name}.png'))
        print('done', name, flush=True)


def talk_frame(i2i, img, prompt, neg, ref, g):
    """lip-flap key: redraw ONLY the mouth (lower-middle of the detected face) with an open mouth; the rest of the drawing is
    untouched so the two keys flip cleanly on 3s"""
    from PIL import ImageDraw, ImageFilter
    box = find_face(img) or (int(img.width * 0.3), int(img.height * 0.1), int(img.width * 0.7), int(img.height * 0.5))
    x0, y0, x1, y1 = box; crop = img.crop(box); w, h = crop.size
    out = i2i(prompt=prompt + ', open mouth, talking, teeth', negative_prompt=neg + ', closed mouth', image=crop.resize((1024, 1024), Image.LANCZOS),
              ip_adapter_image=ref, strength=0.55, guidance_scale=7.0, num_inference_steps=30, generator=g).images[0].resize((w, h), Image.LANCZOS)
    m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).ellipse((w * 0.3, h * 0.52, w * 0.7, h * 0.82), fill=255)
    res = img.copy(); res.paste(out, (x0, y0), m.filter(ImageFilter.GaussianBlur(w * 0.03)))
    return res


def run_jobs(pipe, i2i, a):
    """The TPU's job list, painted from the END so the TPU (which starts at the front) and this PC meet in the middle.
    Same prompts / seeds / refs / crops as the TPU; the depth map is cropped to the figure box (cheaper than the 1152 canvas).
    A job is skipped once either side has drawn it (work/art_local or the downloaded TPU output work/tpu_out/art)."""
    import torch, time
    D = os.path.join(HERE, 'work', 'tpu_in'); J = json.load(open(os.path.join(D, 'jobs.json')))
    out_dir = os.path.join(HERE, 'work', 'art_local'); tpu_dir = os.path.join(HERE, 'work', 'tpu_out', 'art')
    os.makedirs(out_dir, exist_ok=True)
    order = [j for j in J['jobs'] if j['name'].split('_', 1)[1].startswith('face')] + list(reversed(J['jobs']))   # close-ups are local-only: first
    for j in order:
        name = j['name']
        if any(os.path.exists(os.path.join(d, f'{name}.png')) for d in (out_dir, tpu_dir)): continue
        t = time.time()
        cid, pose = name.split('_', 1)
        if pose.startswith('face'):   # close-ups: a real anime portrait from the key art, not a trace of the low-detail 3D head
            ref = Image.open(os.path.join(D, j['ref'])).convert('RGB')
            pipe.set_ip_adapter_scale(j.get('ip', 0.35) + 0.1)
            view = 'looking at viewer, facing viewer' if pose == 'facefront' else 'three-quarter view'
            prompt = prompt_for(cid, f"portrait, upper body, face focus, {view}, {FACE}, simple background")
            g = torch.Generator('cpu').manual_seed(j['seed'] + (1 if pose == 'facefront' else 0))
            img = pipe(prompt=prompt, negative_prompt=J['neg'], image=Image.new('RGB', (1024, 1024)), controlnet_conditioning_scale=0.0, ip_adapter_image=ref,
                       guidance_scale=6.5, num_inference_steps=a.steps, width=1024, height=1024, generator=g).images[0]
            if j['talk']:
                talk_frame(i2i, img, prompt, J['neg'], ref, g).save(os.path.join(out_dir, name.replace('_face', '_facetalk') + '.png'))
            img.save(os.path.join(out_dir, f'{name}.png'))
            print('done', name, round(time.time() - t), 's', flush=True)
            continue
        x0, y0, w, h = j['crop']
        ctrl = Image.open(os.path.join(D, j['ctrl'])).convert('RGB').crop((x0, y0, x0 + w, y0 + h))
        ref = Image.open(os.path.join(D, j['ref'])).convert('RGB')
        pipe.set_ip_adapter_scale(j.get('ip', 0.35))
        gw, gh = max(64, round(w / 64) * 64), max(64, round(h / 64) * 64)
        g = torch.Generator('cpu').manual_seed(j['seed'])
        img = pipe(prompt=j['prompt'], negative_prompt=J['neg'], image=ctrl.resize((gw, gh)), ip_adapter_image=ref, controlnet_conditioning_scale=0.8,
                   guidance_scale=6.5, num_inference_steps=a.steps, width=gw, height=gh, generator=g).images[0].resize((w, h), Image.LANCZOS)
        if j['facebox']:
            box = find_face(img)
            if box: img = detail_face(i2i, img, box, j['faceprompt'], g, ref)
        if j['talk']:
            talk_frame(i2i, img, j['faceprompt'], J['neg'], ref, g).save(os.path.join(out_dir, name.replace('_face', '_facetalk') + '.png'))
        img.save(os.path.join(out_dir, f'{name}.png'))
        print('done', name, round(time.time() - t), 's', flush=True)


if __name__ == '__main__':
    main()
