#!/usr/bin/env python3
"""The hero-shooter finish for the TRELLIS.2 1536 rebuilds (modal_trellis2.py), before rigging:

  1. face   (heroes with a visible face) facebake.py projects the 4x-upscaled concept face (modal_upscale.py) onto
            the head - crisp eyes, brows and mouth where the reconstruction is soft
  2. paint  blender/owpaint.py bakes occlusion, painted edge highlights and the head-to-toe value gradient into the
            base colour

    python ow_finish.py [--only raijin,kaien] [--jobs 3]
In:  out/trellis2-zz-ow/glb/<id>.glb, ../work/ow/pick4x/<id>.png
Out: out/trellis2-zzzz-final/glb/<id>.glb   (sorts after every other trellis2* dir: build_assets.py rigs this one)
Then: python build_assets.py --only <ids> --unirig
"""
import argparse, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / 'out' / 'trellis2-zz-ow' / 'glb'
OUT = HERE / 'out' / 'trellis2-zzzz-final' / 'glb'
WORK = HERE.parent / 'work' / 'ow'
HEROES = ['tenkai', 'gorgoth', 'mirei', 'nocturne', 'kaien', 'raijin', 'yuzu', 'hex', 'kagemaru', 'enra', 'haruto']
# masks, helmets and mech visors keep their own sculpted faces
FACE = {'mirei', 'nocturne', 'kaien', 'raijin', 'yuzu', 'haruto'}
# hard-surface mechs: painted edges carry more of the read
PAINT = {'tenkai': ['--edge', '0.3', '--ao', '0.35'], 'gorgoth': ['--edge', '0.3', '--ao', '0.35']}


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return r.returncode, (r.stdout + r.stderr)[-1500:]


def finish(h):
    src = SRC / f'{h}.glb'
    if not src.exists(): return h, 'missing source'
    mid = src
    if h in FACE:
        mid = WORK / 'face' / f'{h}.glb'; mid.parent.mkdir(parents=True, exist_ok=True)
        rc, log = run([sys.executable, str(HERE / 'facebake.py'), str(src), str(WORK / 'pick4x' / f'{h}.png'), str(mid)])
        if rc: return h, f'face failed: {log}'
    OUT.mkdir(parents=True, exist_ok=True)
    rc, log = run(['blender', '-b', '-P', str(HERE / 'blender' / 'owpaint.py'), '--', str(mid), str(OUT / f'{h}.glb'), *PAINT.get(h, [])])
    if rc or 'OWPAINT_DONE' not in log: return h, f'paint failed: {log}'
    return h, 'ok'


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--only', default=''); ap.add_argument('--jobs', type=int, default=3)
    a = ap.parse_args()
    ids = [h for h in (a.only.split(',') if a.only else HEROES) if h]
    with ThreadPoolExecutor(a.jobs) as ex:
        for h, msg in ex.map(finish, ids): print(f'{h:10s} {msg}', flush=True)
