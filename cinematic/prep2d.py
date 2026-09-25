"""Prepare the model pose captures for the 2D anime repaint.
work/poses/<id>_<pose>.png (RGBA, 2048^2) ->
  work/in2d/<id>_<pose>.png   RGB on flat grey, one crop box per character (every frame shares it, so the drawings line up)
  work/in2d/<id>_<pose>_m.png the silhouette mask (the painted frame is cut out with it: identical outline frame to frame)
  work/in2d/<id>_face.png     head close-up from the front / 3/4 idle, upscaled
  work/in2d/index.json        crop boxes + sizes, used by the film to place the drawings
"""
import glob, json, os
from collections import defaultdict
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, OUT = os.path.join(HERE, 'work', 'poses'), os.path.join(HERE, 'work', 'in2d')
os.makedirs(OUT, exist_ok=True)
BG = (168, 168, 176)
files = defaultdict(list)
for f in sorted(glob.glob(os.path.join(SRC, '*.png'))):
    cid, pose = os.path.basename(f)[:-4].split('_', 1)
    files[cid].append((pose, f))
index = {}
for cid, lst in files.items():
    boxes = [Image.open(f).getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox() for _, f in lst]
    boxes = [b for b in boxes if b]
    x0, y0, x1, y1 = min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)
    pad = 40
    x0, y0, x1, y1 = max(0, x0 - pad), max(0, y0 - pad), x1 + pad, y1 + pad
    w, h = x1 - x0, y1 - y0
    # generation size: longest side 1152, multiples of 64
    k = 1152 / max(w, h)
    gw, gh = max(512, round(w * k / 64) * 64), max(512, round(h * k / 64) * 64)
    index[cid] = {'box': [x0, y0, x1, y1], 'gen': [gw, gh], 'poses': [p for p, _ in lst]}
    for pose, f in lst:
        im = Image.open(f).convert('RGBA').crop((x0, y0, x1, y1)).resize((gw, gh), Image.LANCZOS)
        flat = Image.new('RGB', im.size, BG); flat.paste(im, mask=im.getchannel('A'))
        flat.save(os.path.join(OUT, f'{cid}_{pose}.png'))
        im.getchannel('A').save(os.path.join(OUT, f'{cid}_{pose}_m.png'))
    # face close-up: the top of the idle / front frames (the head), enlarged
    for src in ('idle', 'front'):
        f = dict(lst).get(src)
        if not f: continue
        im = Image.open(f).convert('RGBA')
        bb = im.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox()
        if not bb: continue
        hh = (bb[3] - bb[1]) * (0.26 if cid not in ('tenkai', 'gorgoth', 'enra') else 0.3)
        cx = (bb[0] + bb[2]) / 2
        # locate the head: the topmost 26% of the figure, centred on its opaque columns
        top = im.crop((bb[0], bb[1], bb[2], int(bb[1] + hh))).getchannel('A').getbbox()
        if top: cx = bb[0] + (top[0] + top[2]) / 2
        s = hh * 1.35
        box = (int(cx - s / 2), int(bb[1] - s * 0.08), int(cx + s / 2), int(bb[1] - s * 0.08 + s))
        c = im.crop(box).resize((1024, 1024), Image.LANCZOS)
        flat = Image.new('RGB', c.size, BG); flat.paste(c, mask=c.getchannel('A'))
        flat.save(os.path.join(OUT, f'{cid}_face{"" if src == "idle" else "front"}.png'))
        c.getchannel('A').save(os.path.join(OUT, f'{cid}_face{"" if src == "idle" else "front"}_m.png'))
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), indent=1)
n = len([f for f in os.listdir(OUT) if f.endswith('.png') and not f.endswith('_m.png')])
print('characters', len(index), 'inputs', n)
