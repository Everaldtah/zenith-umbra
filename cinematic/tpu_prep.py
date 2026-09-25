"""Prepare the TPU painting batch (recipe v2) on this PC, so the TPU session spends its time drawing only.
For every pose capture: Depth-Anything-V2 depth masked to the silhouette, padded onto the fixed 1152 canvas (XLA compiles
one graph), the head box for the face redraw, the key-art reference for IP-Adapter, prompt + seed.
Extra characters with no model of their own are drawn over a stand-in's pose (Yuzu's little brother over Haruto's poses).
    python tpu_prep.py      -> work/tpu_in/{<name>_d.png, ref_<id>.png, jobs.json}   (upload as Kaggle dataset zu-paint2d)
"""
import os, json, zlib, glob
import numpy as np
from PIL import Image
from paint2d import IN, REF, CHAR, STYLE, NEG, FACE, MECH

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'work', 'tpu_in'); os.makedirs(OUT, exist_ok=True)
S = 1152
STANDIN = {'brother': ('haruto', 'yuzu', ['idle', 'hit', 'front', 'face'])}   # new id -> (pose source, IP-Adapter ref, poses)


def head_box(mask):
    ys, xs = np.where(mask)
    if not len(ys): return None
    top, bot = ys.min(), ys.max(); hh = (bot - top) / 7.0
    band = mask[top:int(top + hh * 1.1)]; cols = np.where(band.any(0))[0]
    cx = (cols.min() + cols.max()) / 2 if len(cols) else (xs.min() + xs.max()) / 2
    s = hh * 1.7; y0 = max(0, int(top - hh * 0.25))
    return [int(cx - s / 2), y0, int(cx + s / 2), int(y0 + s)]


def main():
    from transformers import pipeline as hf_pipeline
    dpt = hf_pipeline('depth-estimation', model='depth-anything/Depth-Anything-V2-Small-hf', device=-1)
    names = sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(IN, '*.png')) if not p.endswith('_m.png'))
    work = [(n, n.split('_', 1)[0], n.split('_', 1)[1], n.split('_', 1)[0]) for n in names]
    for nid, (src, ref, poses) in STANDIN.items():
        work += [(f'{src}_{p}', nid, p, ref) for p in poses if f'{src}_{p}' in names]
    jobs, refs = [], set()
    for i, (src, cid, pose, ref) in enumerate(work):
        name = f'{cid}_{pose}'
        im = Image.open(os.path.join(IN, f'{src}.png')).convert('RGB')
        m = Image.open(os.path.join(IN, f'{src}_m.png')).convert('L').resize(im.size)
        d = np.asarray(dpt(im)['depth'].resize(im.size), dtype=np.float32)
        ma = np.asarray(m, dtype=np.float32) / 255
        fg = d[ma > 0.5]
        if fg.size: lo, hi = np.percentile(fg, 2), np.percentile(fg, 98); d = np.clip((d - lo) / max(1e-3, hi - lo), 0, 1) * 0.85 + 0.15
        d = d * ma
        k = min(1.0, S / max(im.size)); w, h = round(im.width * k), round(im.height * k)
        pad = Image.new('L', (S, S), 0); x0, y0 = (S - w) // 2, (S - h) // 2
        pad.paste(Image.fromarray((d * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS), (x0, y0))
        pad.convert('RGB').save(os.path.join(OUT, f'{name}_d.png'))
        mk = np.zeros((S, S), bool); mk[y0:y0 + h, x0:x0 + w] = np.asarray(m.resize((w, h))) > 128
        face = pose.startswith('face')
        human = cid not in MECH
        prompt = f"{CHAR[cid]}, {'portrait, close-up, face focus, ' + FACE if face else 'full body, standing'}, simple white background, {STYLE}"
        jobs.append({'name': name, 'ctrl': f'{name}_d.png', 'ref': f'ref_{ref}.png', 'crop': [x0, y0, w, h],
                     'seed': zlib.crc32(cid.encode()) % 100000, 'prompt': prompt,
                     'facebox': head_box(mk) if human and not face else None,
                     'faceprompt': f"{CHAR[cid]}, portrait, face focus, {FACE}, {STYLE}",
                     'talk': human and pose == 'face'})
        refs.add(ref)
        if i % 20 == 0: print(i, len(work), name, flush=True)
    for r in refs:
        p = os.path.join(REF, f'key_{r}.webp')
        (Image.open(p).convert('RGB') if os.path.exists(p) else Image.new('RGB', (512, 512), (200, 200, 200))).save(os.path.join(OUT, f'ref_{r}.png'))
    json.dump({'neg': NEG, 'canvas': S, 'jobs': jobs}, open(os.path.join(OUT, 'jobs.json'), 'w'), indent=0)
    json.dump({'title': 'zu-paint2d', 'id': 'everaldtah/zu-paint2d', 'licenses': [{'name': 'CC0-1.0'}]}, open(os.path.join(OUT, 'dataset-metadata.json'), 'w'))
    print('jobs', len(jobs), 'refs', sorted(refs))


if __name__ == '__main__':
    main()
