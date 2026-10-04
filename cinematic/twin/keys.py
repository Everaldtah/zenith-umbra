#!/usr/bin/env python3
"""Paint the anchor sheets and every shot's keyframe with grok-imagine-image (xAI images/edits, references = key art/anchors).

    python keys.py anchors [ids..]      paint work/anchors/<id>.jpg
    python keys.py shots [ids..]        paint work/keys/<shot>.jpg (skips existing unless ids are named)
    python keys.py sheet [prefix]       contact sheet work/qc/keys_<prefix>.jpg
Every call is logged with its cost in work/ledger.json; budget.py refuses to go past the cap.
"""
import os, sys, json, concurrent.futures as cf
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import xai, budget
from script import S, CHAR, ANCHORS, STYLE

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
A, K, QC = (os.path.join(xai.W, d) for d in ('anchors', 'keys', 'qc'))
for d in (A, K, QC): os.makedirs(d, exist_ok=True)
DESC = {k: v[0] for k, v in CHAR.items()}


def ref_path(r):
    return os.path.join(ROOT, 'public', 'img', f'{r}.webp') if r.startswith('key_') else os.path.join(A, f'{r}.jpg')


def anchor(aid):
    refs, tmpl = ANCHORS[aid]
    prompt = tmpl.format(**DESC) + ' ' + STYLE
    budget.check(0.03)
    usd = xai.edit_image(prompt, [ref_path(r) for r in refs], os.path.join(A, f'{aid}.jpg'), shot=f'anchor:{aid}')
    print('anchor', aid, usd, flush=True)


def key_prompt(s):
    refs, parts = [], []
    for c in s['chars']:
        desc, r = CHAR[c]
        if r and r not in refs and len(refs) < 5:
            refs.append(r)
        if r and r in refs:
            parts.append(f'<IMAGE_{refs.index(r)}> shows {desc}')
        else:
            parts.append(desc)
    if refs:
        p = ('Reference images: ' + '; '.join(parts) + '. Keep each character\'s face, hair, costume and colours exactly as in '
             'their reference image, but draw a completely NEW scene (ignore the reference backgrounds and poses). Scene: '
             + s['key'] + ' ' + STYLE + '.')
    else:
        p = (('Characters: ' + '; '.join(parts) + '. ') if parts else '') + 'Scene: ' + s['key'] + ' ' + STYLE + '.'
    return p, [ref_path(r) for r in refs]


def paint(s):
    p, refs = key_prompt(s)
    budget.check(0.03)
    usd = xai.edit_image(p, refs, os.path.join(K, f"{s['id']}.jpg"), shot=s['id'])
    print('key', s['id'], len(refs), 'refs', usd, flush=True)


def sheet(prefix=''):
    from PIL import Image, ImageDraw
    fs = sorted(f for f in os.listdir(K) if f.startswith(prefix) and f.endswith('.jpg'))
    if not fs: return
    w, h, cols = 480, 270, 4
    W = Image.new('RGB', (w * cols, h * ((len(fs) + cols - 1) // cols)), (20, 20, 20))
    for i, f in enumerate(fs):
        im = Image.open(os.path.join(K, f)).convert('RGB').resize((w, h))
        ImageDraw.Draw(im).text((8, 6), f[:-4], fill=(255, 255, 0))
        W.paste(im, ((i % cols) * w, (i // cols) * h))
    out = os.path.join(QC, f'keys_{prefix or "all"}.jpg'); W.save(out, quality=82); print(out)


if __name__ == '__main__':
    cmd, ids = sys.argv[1], sys.argv[2:]
    if cmd == 'anchors':
        for aid in ids or list(ANCHORS):          # in order: later anchors reference earlier ones
            if ids or not os.path.exists(os.path.join(A, f'{aid}.jpg')): anchor(aid)
    elif cmd == 'shots':
        todo = [s for s in S if s['kind'] == 'clip' and (s['id'] in ids if ids else not os.path.exists(os.path.join(K, f"{s['id']}.jpg")))]
        with cf.ThreadPoolExecutor(4) as ex:
            for f in [ex.submit(paint, s) for s in todo]:
                try: f.result()
                except Exception as e: print('FAILED', e, flush=True)
    elif cmd == 'sheet':
        sheet(ids[0] if ids else '')
    print('spent so far $%.3f' % xai.spent())
