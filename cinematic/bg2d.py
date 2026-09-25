"""Painted anime backgrounds for the 2D film, on the local GPU (plain SDXL text-to-image fits a 6 GB card with offload).
Same set list as the Kaggle job (assetgen/cine2d BGS). Native SDXL bucket 1344x768; finish2d.py upscales + splits into layers.
    python bg2d.py [name,...]      -> work/bg2d/<name>.png
"""
import ast, os, sys, zlib
from paint2d import QUAL, NEG
# backgrounds are PAINTED (90s cel-era background art), unlike the flat-cel characters that sit on them
BGSTYLE = "anime background, painted background, detailed background, 1990s anime, evangelion style, retro anime, atmospheric perspective"

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'work', 'bg2d'); os.makedirs(OUT, exist_ok=True)
SRC = open(os.path.join(HERE, '..', 'assetgen', 'cine2d', 'cine2d.py'), encoding='utf-8').read()
BGS = ast.literal_eval(SRC[SRC.index('BGS = {') + 6:SRC.index('}\n', SRC.index('BGS = {')) + 1])


def main():
    import torch
    from diffusers import StableDiffusionXLPipeline, AutoencoderKL, EulerAncestralDiscreteScheduler
    names = [n for n in (sys.argv[1].split(',') if len(sys.argv) > 1 else BGS)]
    vae = AutoencoderKL.from_pretrained('madebyollin/sdxl-vae-fp16-fix', torch_dtype=torch.float16)
    pipe = StableDiffusionXLPipeline.from_pretrained('cagliostrolab/animagine-xl-3.1', vae=vae, torch_dtype=torch.float16)
    pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
    pipe.unet.enable_layerwise_casting(storage_dtype=torch.float8_e4m3fn, compute_dtype=torch.float16)   # 5.1 -> 2.6 GB: stays in 6 GB VRAM
    pipe.enable_model_cpu_offload(); pipe.vae.enable_tiling()
    for n in names:
        out = os.path.join(OUT, f'{n}.png')
        if os.path.exists(out): continue
        g = torch.Generator('cpu').manual_seed(500 + zlib.crc32(n.encode()) % 997)
        prompt = f"{QUAL}, scenery, no humans, wide shot, {BGS[n]}, {BGSTYLE}"
        pipe(prompt=prompt, negative_prompt=NEG + ", people, character, 1girl, 1boy, text, flat vector, abstract, poster, lineart", width=1344, height=768,
             num_inference_steps=30, guidance_scale=7.0, generator=g).images[0].save(out)
        print('done', n, flush=True)


if __name__ == '__main__':
    main()
