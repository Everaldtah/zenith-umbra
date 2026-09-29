#!/usr/bin/env python3
"""Publish the Koryu spirit koi-dragons: Tripo HD exports -> blender/rig_dragon.py (straightened, spine-rigged) -> web + desktop GLBs.

    python tripo_dragon.py [seiran_dragon] [hayate_dragon] [--head -x]
Inputs  out/tripo/<id>_hd.glb (Tripo "Export" GLB of the HD model; concept images were side-on, head left)
Outputs ../public/models/<id>.glb, out/models_hq/<id>.glb - loaded by src/render/SpiritDragon.ts (no manifest entry;
the web build drops them with the rest of the desktop-only Koryu brothers)
"""
import json, subprocess, sys
from pathlib import Path
from build_assets import gltf, PUB, HQ

HERE = Path(__file__).resolve().parent
SRC, RIGGED = HERE / 'out' / 'tripo', HERE / 'out' / 'rigged_tripo'
DRAGONS = {'seiran_dragon': 10.0, 'hayate_dragon': 10.0}   # rest length in metres (the game scales per use)
# which end is the snout: the blue dragon's koi fan tail is as deep as its head, so the depth test can't tell - pinned
HEAD = {'seiran_dragon': '-x', 'hayate_dragon': 'auto'}


def main():
    args = sys.argv[1:]
    head_arg = args[args.index('--head') + 1] if '--head' in args else None
    ids = [a for a in args if a in DRAGONS] or list(DRAGONS)
    RIGGED.mkdir(parents=True, exist_ok=True)
    for did in ids:
        src, out = SRC / f'{did}_hd.glb', RIGGED / f'{did}.glb'
        if not src.exists(): print('missing', src); continue
        r = subprocess.run(['blender', '-b', '-P', str(HERE / 'blender' / 'rig_dragon.py'), '--', '--glb', str(src), '--out', str(out),
                            '--length', str(DRAGONS[did]), '--bones', '28', '--tris', '16000', '--head', head_arg or HEAD[did]],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        line = next((l for l in r.stdout.splitlines() if l.startswith('RIG_DONE')), None)
        print(*[l for l in r.stdout.splitlines() if l.startswith('AXIS')])
        if not line: print(did, 'RIG FAILED\n', r.stdout[-1500:], r.stderr[-800:]); continue
        info = json.loads(line[9:])
        if not (gltf(out, PUB / f'{did}.glb', 1024) and gltf(out, HQ / f'{did}.glb', 2048)):
            print(did, 'PUBLISH FAILED'); continue
        print(f"published {did}: {info['tris']} tris, {info['bones']} joints, head {info['head']:+d}{info['axis']}, "
              f"{(PUB / f'{did}.glb').stat().st_size / 1e6:.2f} MB web", flush=True)


if __name__ == '__main__':
    main()
