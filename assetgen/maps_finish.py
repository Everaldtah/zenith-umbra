#!/usr/bin/env python3
"""Map art from modal_maps.py (work/maps/*.png) -> game assets:
  <map>_key.png          -> public/img/map_<map>.webp (1024 wide) and the full-size desktop copy (out/hq/img)
  <map>_sky.png          -> public/env/sky_<map>.webp (1280x533 strip)
  <map>_{ground,wall,roof}.png -> seamless tiles: public/env/tex_<map>_<k>.webp (512) + out/hq/env (1024)
then lists the env textures in public/models/manifest.json (the renderer only asks for textures it lists).

    python assetgen/maps_finish.py [map ...]
Seamless tiles: the painted swatch's inner 76% (generated swatches often carry a frame), cross-faded with a half-offset
copy of itself so every edge continues into the opposite one.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SRC = ROOT / 'work' / 'maps'
PUB = ROOT / 'public'
HQ = HERE / 'out' / 'hq'
MAPS = sys.argv[1:] or ['hanabi', 'cloudstep', 'kagura']


def seamless(im: Image.Image, keep=0.76) -> Image.Image:
    w, h = im.size
    cw, ch = int(w * keep), int(h * keep)
    im = im.crop(((w - cw) // 2, (h - ch) // 2, (w + cw) // 2, (h + ch) // 2)).resize((1024, 1024), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    b = np.roll(np.roll(a, 512, 0), 512, 1)
    # weight: 1 in the middle of the tile, 0 at its edges (where the rolled copy - continuous across the wrap - takes over)
    x = np.abs(np.linspace(-1, 1, 1024))
    m1 = np.clip((1 - x) / 0.5, 0, 1)
    m = np.minimum(m1[None, :], m1[:, None])[..., None]
    out = a * m + b * (1 - m)
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))


def mirrored(im: Image.Image, keep=0.8) -> Image.Image:
    w, h = im.size
    cw, ch = int(w * keep), int(h * keep)
    q = im.crop(((w - cw) // 2, (h - ch) // 2, (w + cw) // 2, (h + ch) // 2)).resize((512, 512), Image.LANCZOS)
    out = Image.new('RGB', (1024, 1024))
    out.paste(q, (0, 0)); out.paste(q.transpose(Image.FLIP_LEFT_RIGHT), (512, 0))
    out.paste(q.transpose(Image.FLIP_TOP_BOTTOM), (0, 512)); out.paste(q.transpose(Image.ROTATE_180), (512, 512))
    return out


def main():
    (PUB / 'img').mkdir(exist_ok=True); (PUB / 'env').mkdir(exist_ok=True)
    (HQ / 'img').mkdir(parents=True, exist_ok=True); (HQ / 'env').mkdir(parents=True, exist_ok=True)
    for m in MAPS:
        k = SRC / f'{m}_key.png'
        if k.exists():
            im = Image.open(k).convert('RGB')
            if im.width / im.height < 1.6:             # square key art: centre-crop to the 16:9 map card
                h = int(im.width * 9 / 16); y = (im.height - h) // 2
                im = im.crop((0, y, im.width, y + h))
            im.resize((1024, int(im.height * 1024 / im.width)), Image.LANCZOS).save(PUB / 'img' / f'map_{m}.webp', quality=86)
            im.save(HQ / 'img' / f'map_{m}.webp', quality=92)
            print('key', m)
        s = SRC / f'{m}_sky.png'
        if s.exists():
            im = Image.open(s).convert('RGB').resize((1280, 533), Image.LANCZOS)
            im.save(PUB / 'env' / f'sky_{m}.webp', quality=86); im.save(HQ / 'env' / f'sky_{m}.webp', quality=92)
            print('sky', m)
        for t in ['ground', 'wall', 'roof']:
            p = SRC / f'{m}_{t}.png'
            if not p.exists(): continue
            src = Image.open(p).convert('RGB')
            # organic ground: cross-fade; structured walls / roofs (beams, windows, tile rows): a mirrored 2x2 (no ghosting)
            tile = seamless(src) if t == 'ground' else mirrored(src)
            tile.resize((512, 512), Image.LANCZOS).save(PUB / 'env' / f'tex_{m}_{t}.webp', quality=86)
            tile.save(HQ / 'env' / f'tex_{m}_{t}.webp', quality=92)
            print('tex', m, t)
    man_p = PUB / 'models' / 'manifest.json'
    man = json.loads(man_p.read_text())
    man['textures'] = sorted(str(p.relative_to(PUB)).replace('\\', '/') for p in (PUB / 'env').glob('*.webp'))
    man_p.write_text(json.dumps(man, indent=1))
    print('manifest textures', len(man['textures']))


if __name__ == '__main__':
    main()
