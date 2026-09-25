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
STYLE = ("anime screencap, 1990s anime, neon genesis evangelion style, gurren lagann style, cel shading, hard cel shadows, "
         "thick bold black lineart, flat colors, retro anime, dynamic, sharp focus, masterpiece, best quality, very aesthetic")
NEG = ("3d, cgi, 3d render, blender, photorealistic, realistic, blurry, lowres, jpeg artifacts, bad anatomy, bad hands, "
       "extra limbs, extra arms, deformed, mutated, watermark, text, signature, multiple views, soft shading, glossy, noise, sketch")
CHAR = {
    "haruto": "1boy, teenage boy, messy brown hair, brown eyes, white and red plugsuit, black chest panel, blue joint pads",
    "mirei": "1girl, short silver-white bob hair, violet eyes, white armored flight suit with sky blue panels, large white mechanical feather wings, glowing blue crystal blades",
    "kaien": "1boy, young monk, black hair in a topknot, white robe, blue hakama, gold sash, beige outer coat, wide sleeves",
    "raijin": "1boy, spiky yellow hair, blue eyes, navy blue long coat with gold trim, katana",
    "yuzu": "1girl, orange hair with twin buns, amber eyes, white and orange bodysuit with gold armor, orange boots, golden bow",
    "vorn": "1man, stern old man, slicked back white hair, scar, grey military greatcoat, red boots",
    "nocturne": "1girl, long white hair, small black horns, red eyes, black corset gown with crimson, crimson bat wings, vampire",
    "hex": "1man, tall thin man, white porcelain mask, black long coat with violet lining, white gloves, puppeteer",
    "kagemaru": "1boy, ninja, black hood with animal ears, white fox skull mask, black ninja outfit, purple sash",
    "enra": "oni, giant armored demon warrior, white bull horns, black and silver spiked armor, red tabard, white mane",
    "qelvaris": "alien, golden elongated head, four glowing eyes, black and violet robe with gold trim, mechanical tentacles",
    "tenkai": "mecha, no humans, giant robot, white and gold armor, cyan chest core, golden crown crest, golden visor, eva unit style, rocket hammer",
    "brother": "1boy, young boy, messy orange hair, amber eyes, white and orange academy uniform, orange sneakers",
    "gorgoth": "mecha, no humans, giant robot, black and crimson armor, red horns, red glowing mono eye, spiked shoulders, eva unit style",
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
FACE = ("detailed face, beautiful detailed eyes, sharp eye highlights, defined eyelashes, clean facial lineart, expressive, "
        "anime face, symmetrical eyes")


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
    ap = argparse.ArgumentParser(); ap.add_argument('names'); ap.add_argument('--steps', type=int, default=28); ap.add_argument('--ip', type=float, default=0.5)
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
    pipe.enable_model_cpu_offload()
    from diffusers import StableDiffusionXLImg2ImgPipeline
    i2i = StableDiffusionXLImg2ImgPipeline(**{k: v for k, v in pipe.components.items() if k in ('vae', 'text_encoder', 'text_encoder_2', 'tokenizer', 'tokenizer_2', 'unet', 'scheduler', 'image_encoder', 'feature_extractor')})
    i2i.enable_model_cpu_offload()
    sess = new_session('isnet-anime')
    for name in a.names.split(','):
        cid, pose = name.split('_', 1)
        ctrl, size = depth_map(dpt, name)
        ctrl.save(os.path.join(OUT, f'{name}_depth.png'))
        ref_p = os.path.join(REF, f'key_{cid}.webp')
        ref = Image.open(ref_p).convert('RGB') if os.path.exists(ref_p) else Image.new('RGB', (224, 224), (128, 128, 128))
        face = pose.startswith('face')
        prompt = f"{CHAR[cid]}, {'portrait, close-up, face focus' if face else 'full body, standing'}, simple white background, {STYLE}"
        g = torch.Generator('cpu').manual_seed(zlib.crc32(cid.encode()) % 100000)
        w, h = (size[0] // 64) * 64, (size[1] // 64) * 64
        img = pipe(prompt=prompt, negative_prompt=NEG, image=ctrl.resize((w, h)), ip_adapter_image=ref, controlnet_conditioning_scale=0.8,
                   guidance_scale=6.5, num_inference_steps=a.steps, width=w, height=h, generator=g).images[0]
        if cid not in MECH and not face:
            box = head_box(name, (w, h))
            if box: img = detail_face(i2i, img, box, f"{CHAR[cid]}, portrait, face focus, {FACE}, {STYLE}", g, ref)
        img.save(os.path.join(OUT, f'{name}_raw.png'))
        remove(img, session=sess).save(os.path.join(OUT, f'{name}.png'))
        print('done', name, flush=True)


if __name__ == '__main__':
    main()
