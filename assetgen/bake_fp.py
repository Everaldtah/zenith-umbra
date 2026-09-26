#!/usr/bin/env python3
"""Bake every hero's first-person clip set (blender/fp_choreo.py -> blender/fp_arms.py) onto its published rig and
register it in public/anim/manifest.json. Tenkai-Oh stays procedural (his hammer is a procedural prop).

    python bake_fp.py [--only raijin,kaien] [--jobs 3]
Writes ../work/fp/fp_<hero>.blend (open it to polish by hand, then re-export) and ../public/anim/fp_<hero>.glb.
"""
import argparse, subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
PUB = HERE.parent / 'public'
WORK = HERE.parent / 'work' / 'fp'
HEROES = ['raijin', 'yuzu', 'kaien', 'mirei', 'nocturne', 'hex', 'kagemaru', 'enra', 'haruto', 'gorgoth']
FP = HERE / 'blender' / 'fp_arms.py'


def bake(h):
    WORK.mkdir(parents=True, exist_ok=True)
    blend = WORK / f'fp_{h}.blend'
    r = subprocess.run(['blender', '-b', '-P', str(FP), '--', '--hero', h, '--model', str(PUB / 'models' / f'{h}.glb'), '--setup', str(blend)], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if 'authoring scene' not in r.stdout: return h, 'setup failed: ' + (r.stdout + r.stderr)[-800:]
    r = subprocess.run(['blender', '-b', str(blend), '-P', str(FP), '--', '--hero', h, '--export', str(PUB / 'anim')], capture_output=True, text=True, encoding='utf-8', errors='replace')
    line = next((l for l in r.stdout.splitlines() if 'clips (' in l), '')
    return h, line or 'export failed: ' + (r.stdout + r.stderr)[-800:]


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--only', default=''); ap.add_argument('--jobs', type=int, default=1)
    a = ap.parse_args()
    ids = [h for h in (a.only.split(',') if a.only else HEROES) if h]
    # the exports all rewrite public/anim/manifest.json: one at a time unless you know better
    with ThreadPoolExecutor(a.jobs) as ex:
        for h, msg in ex.map(bake, ids): print(f'{h:10s} {msg}', flush=True)
