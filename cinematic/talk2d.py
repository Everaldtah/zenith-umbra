"""Lip-flap keys for the close-ups: redraw only the mouth of each portrait with an open mouth.
    python talk2d.py [names] [--test]      names default: every *_face in work/art_local (humans)
Writes <id>_facetalk.png next to the portrait; --test writes a strength sweep to work/talk_test/ instead.
"""
import argparse, json, os, zlib
from PIL import Image, ImageDraw, ImageFilter
from paint2d import HERE, NEG, MECH, prompt_for, FACE, find_face

ART = os.path.join(HERE, 'work', 'art_local')
REFD = os.path.join(HERE, 'work', 'tpu_in')


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('names', nargs='?', default=''); ap.add_argument('--test', action='store_true')
    ap.add_argument('--strength', type=float, default=0.75)
    a = ap.parse_args()
    import torch
    from transformers import CLIPVisionModelWithProjection
    from diffusers import StableDiffusionXLImg2ImgPipeline, AutoencoderKL, EulerAncestralDiscreteScheduler
    enc = CLIPVisionModelWithProjection.from_pretrained('h94/IP-Adapter', subfolder='models/image_encoder', torch_dtype=torch.float16)
    vae = AutoencoderKL.from_pretrained('madebyollin/sdxl-vae-fp16-fix', torch_dtype=torch.float16)
    i2i = StableDiffusionXLImg2ImgPipeline.from_pretrained('cagliostrolab/animagine-xl-3.1', vae=vae, image_encoder=enc, torch_dtype=torch.float16)
    i2i.scheduler = EulerAncestralDiscreteScheduler.from_config(i2i.scheduler.config)
    i2i.load_ip_adapter('h94/IP-Adapter', subfolder='sdxl_models', weight_name='ip-adapter-plus_sdxl_vit-h.safetensors')
    i2i.set_ip_adapter_scale(0.35)
    i2i.unet.enable_layerwise_casting(storage_dtype=torch.float8_e4m3fn, compute_dtype=torch.float16)
    i2i.enable_model_cpu_offload()
    jobs = {j['name']: j for j in json.load(open(os.path.join(REFD, 'jobs.json')))['jobs']}
    names = [n for n in a.names.split(',') if n] or sorted(f[:-4] for f in os.listdir(ART) if f.endswith('_face.png') and f.split('_')[0] not in MECH)
    strengths = [0.6, 0.75, 0.9] if a.test else [a.strength]
    os.makedirs(os.path.join(HERE, 'work', 'talk_test'), exist_ok=True)
    for name in names:
        cid = name.split('_')[0]
        img = Image.open(os.path.join(ART, f'{name}.png')).convert('RGB')
        ref = Image.open(os.path.join(REFD, jobs[name]['ref'])).convert('RGB')
        box = find_face(img) or (int(img.width * 0.3), int(img.height * 0.1), int(img.width * 0.7), int(img.height * 0.5))
        x0, y0, x1, y1 = box; crop = img.crop(box); w, h = crop.size
        for st in strengths:
            g = torch.Generator('cpu').manual_seed(zlib.crc32(cid.encode()) % 100000)
            prompt = "open mouth, talking, teeth, " + prompt_for(cid, f"portrait, face focus, {FACE}")
            out = i2i(prompt=prompt, negative_prompt=NEG + ', closed mouth, smile', image=crop.resize((1024, 1024), Image.LANCZOS), ip_adapter_image=ref,
                      strength=st, guidance_scale=7.5, num_inference_steps=30, generator=g).images[0].resize((w, h), Image.LANCZOS)
            m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).ellipse((w * 0.3, h * 0.5, w * 0.7, h * 0.84), fill=255)
            res = img.copy(); res.paste(out, (x0, y0), m.filter(ImageFilter.GaussianBlur(w * 0.03)))
            dst = os.path.join(HERE, 'work', 'talk_test', f'{name}_{st}.png') if a.test else os.path.join(ART, name.replace('_face', '_facetalk') + '.png')
            res.save(dst); print('done', name, st, 'box', box, flush=True)


if __name__ == '__main__':
    main()
