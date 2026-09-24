#!/usr/bin/env python3
"""Pick + convert generated 2D art into ../public (WebP): key art, portraits, map art, skies, textures."""
import glob, os, sys
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, '..', 'public')
SRC = [os.path.join(HERE, 'out', d, 'img') for d in ('campaign', 'models2', 'pilots', 'concepts')]
ARTFIX = os.path.join(HERE, 'out', 'artfix', 'img')
# art regenerated from each model's own concept (matches the 3D model): portrait pick, key-art pick
FIX = {'enra': (0, 0), 'gorgoth': (1, 0), 'haruto': (0, 1), 'hex': (0, 0), 'kagemaru': (0, 0), 'kaien': (0, 0), 'mirei': (1, 0), 'nocturne': (0, 1), 'qelvaris': (0, 1), 'raijin': (0, 1), 'tenkai': (0, 1), 'vorn': (0, 0), 'yuzu': (0, 0)}   # earlier dirs win
KEY_PICK = {'qelvaris': 1, 'enra': 0, 'gorgoth': 0, 'hex': 1, 'kagemaru': 0, 'kaien': 1, 'mirei': 1, 'nocturne': 0, 'raijin': 0, 'tenkai': 0, 'yuzu': 1, 'haruto': 0, 'vorn': 1}
MAP_PICK = {'amatsu': 0, 'cathedral': 1, 'hangar': 0, 'kurogane': 1, 'rift': 0, 'training': 0}

def find(name):
    for d in SRC:
        p = os.path.join(d, name + '.png')
        if os.path.exists(p): return p
    return None

HQ = os.path.join(HERE, 'out', 'hq')
# web tier (Vercel): smaller + lower quality for fast loads; desktop tier (Windows app): full resolution, high quality
WEB_MAX = {'img/key_': (640, 70), 'img/map_': (1024, 70), 'img/cine_': (1280, 72), 'img/portrait_': (256, 76), 'env/sky_': (1280, 70), 'env/tex_': (512, 72)}

def save(im, rel, q=84, size=None):
    if size: im = im.copy(); im.thumbnail(size, Image.LANCZOS)
    # desktop / HQ copy
    out = os.path.join(HQ, rel); os.makedirs(os.path.dirname(out), exist_ok=True)
    im.save(out, 'WEBP', quality=92, method=6)
    # web copy
    w = im
    for pre, (mx, wq) in WEB_MAX.items():
        if rel.startswith(pre):
            if max(w.size) > mx: w = w.copy(); w.thumbnail((mx, mx), Image.LANCZOS)
            q = min(q, wq); break
    out = os.path.join(PUB, rel); os.makedirs(os.path.dirname(out), exist_ok=True)
    w.save(out, 'WEBP', quality=q, method=6)

n = 0
for hid, k in KEY_PICK.items():
    p = find(f'key_{hid}_{k}') or find(f'key_{hid}_0')
    if not p: continue
    im = Image.open(p).convert('RGB'); W, H = im.size
    save(im, f'img/key_{hid}.webp', 82)
    s = int(W * 0.62); x0 = (W - s) // 2; y0 = int(H * 0.06)
    save(im.crop((x0, y0, x0 + s, y0 + s)), f'img/portrait_{hid}.webp', 85, (256, 256)); n += 2
for mid, k in MAP_PICK.items():
    p = find(f'map_{mid}_{k}')
    if p: save(Image.open(p).convert('RGB'), f'img/map_{mid}.webp', 80); n += 1
    p = find(f'sky_{mid}_0')
    if p: save(Image.open(p).convert('RGB'), f'env/sky_{mid}.webp', 82); n += 1
    for t in ('ground', 'wall'):
        p = find(f'tex_{mid}_{t}_0')
        if p: save(Image.open(p).convert('RGB'), f'env/tex_{mid}_{t}.webp', 82, (1024, 1024)); n += 1
# campaign art (all of it, if present)
for p in sorted(glob.glob(os.path.join(HERE, 'out', 'campaign', 'img', '*.png'))):
    b = os.path.basename(p)[:-4]; name, k = b.rsplit('_', 1)
    if name.startswith(('cine_', 'map_c', 'key_boss')) and k == '0': save(Image.open(p).convert('RGB'), f'img/{name}.webp', 82); n += 1
    elif name.startswith('sky_c'): save(Image.open(p).convert('RGB'), f'env/{name}.webp', 82); n += 1
    elif name.startswith('tex_c'): save(Image.open(p).convert('RGB'), f'env/{name}.webp', 82, (1024, 1024)); n += 1
    elif name == 'key_qelvaris' and k == '1':
        im = Image.open(p).convert('RGB'); W, H = im.size
        save(im, 'img/key_qelvaris.webp', 82); s = int(W * 0.62); x0 = (W - s) // 2
        save(im.crop((x0, int(H * .06), x0 + s, int(H * .06) + s)), 'img/portrait_qelvaris.webp', 85, (256, 256)); n += 2
for hid, (pk, kk) in FIX.items():
    pp, kp = os.path.join(ARTFIX, f'portrait_{hid}_{pk}.png'), os.path.join(ARTFIX, f'key_{hid}_{kk}.png')
    if os.path.exists(pp): save(Image.open(pp).convert('RGB'), f'img/portrait_{hid}.webp', 85, (512, 512)); n += 1
    if os.path.exists(kp):
        im = Image.open(kp).convert('RGB')
        # tighten the frame around the figure (the img2img canvas leaves wide margins)
        import numpy as np
        a = np.asarray(im).astype(int); bgc = a[5, 5]
        mask = (np.abs(a - bgc).sum(2) > 60)
        ys, xs = np.where(mask)
        if len(xs):
            x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
            pad = 40; w = x1 - x0 + 2 * pad; h = y1 - y0 + 2 * pad
            tw = max(w, int(h * 0.68)); cx = (x0 + x1) // 2
            box = (max(0, cx - tw // 2), max(0, y0 - pad), min(im.width, cx + tw // 2), min(im.height, y1 + pad))
            im = im.crop(box)
        save(im, f'img/key_{hid}.webp', 82); n += 1
print('published', n)
