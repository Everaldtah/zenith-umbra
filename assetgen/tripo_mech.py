#!/usr/bin/env python3
"""Publish Tripo Studio mechs, bosses and drones: HD exports (no Tripo rig) -> blender/rig_hero.py -> web + desktop GLBs.

    python tripo_mech.py gorgoth boss_ironmaw ...     (ids from MECH below)
Tripo's humanoid auto-rig puts a mech's weight on the hips (hard-surface armour reads as one rigid body), so mechs are
rigged by rig_hero.py's silhouette skeleton + geodesic weights (--mech), and drones (no legs to rig) ship static.
Inputs  out/tripo/<id>_hd.glb (Tripo "Export" GLB of the HD model)
Outputs ../public/models/<id>.glb, out/models_hq/<id>.glb, ../public/models/manifest.json
"""
import json, subprocess, sys
from pathlib import Path
from build_assets import gltf, PUB, HQ

HERE = Path(__file__).resolve().parent
SRC, RIGGED = HERE / 'out' / 'tripo', HERE / 'out' / 'rigged_tripo'
# id: (height m, rig_hero flags)
MECH = {
    'gorgoth': (3.4, ['--mech', '--tris', '40000']),
    'boss_genesis': (18, ['--mech', '--tris', '40000']), 'boss_ironmaw': (14, ['--mech', '--tris', '40000']),
    'boss_leviathan': (16, ['--mech', '--tris', '40000']), 'boss_reaper': (16, ['--mech', '--tris', '40000']),
    'minion_lancer': (2.0, ['--mech', '--tris', '20000']), 'minion_sentinel': (2.2, ['--mech', '--tris', '20000']),
    'boss_phoenix': (15, ['--static', '--tris', '30000']),
    'minion_swarmer': (1.2, ['--static', '--tris', '12000']), 'minion_bomber': (1.4, ['--static', '--tris', '12000']),
    # the training range: the Sentry Walker is a stocky biped with cannon forearms, the Hover Seeker a drone
    'bot_sentry': (1.7, ['--mech', '--tris', '20000']), 'bot_drone': (1.0, ['--static', '--tris', '12000']),
}


def main():
    ids = sys.argv[1:] or list(MECH)
    RIGGED.mkdir(parents=True, exist_ok=True)
    man_p = PUB / 'manifest.json'
    for aid in ids:
        h, flags = MECH[aid]
        src, out = SRC / f'{aid}_hd.glb', RIGGED / f'{aid}.glb'
        if not src.exists(): print('missing', src); continue
        r = subprocess.run(['blender', '-b', '-P', str(HERE / 'blender' / 'rig_hero.py'), '--', '--glb', str(src), '--out', str(out),
                            '--height', str(h), *flags, '--python', sys.executable], capture_output=True, text=True, encoding='utf-8', errors='replace')
        line = next((l for l in r.stdout.splitlines() if l.startswith('RIG_DONE')), None)
        if not line: print(aid, 'RIG FAILED\n', r.stdout[-1200:], r.stderr[-800:]); continue
        info = json.loads(line[9:])
        big = aid.startswith('boss_') or aid == 'gorgoth'
        if not (gltf(out, PUB / f'{aid}.glb', 2048 if big else 1024) and gltf(out, HQ / f'{aid}.glb', 4096 if big else 2048)):
            print(aid, 'PUBLISH FAILED'); continue
        man = json.loads(man_p.read_text())                  # re-read: other publishers may have written meanwhile
        man['models'][aid] = {'height': h, 'tris': info.get('tris', 0), 'bones': [] if '--static' in flags else ['humanoid'], 'source': 'tripo'}
        man_p.write_text(json.dumps(man, indent=1))
        print(f"published {aid}: {info.get('method', 'static')} {info.get('tris')} tris, {(PUB / f'{aid}.glb').stat().st_size / 1e6:.2f} MB web", flush=True)


if __name__ == '__main__':
    main()
