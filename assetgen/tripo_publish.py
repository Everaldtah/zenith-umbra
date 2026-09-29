#!/usr/bin/env python3
"""Publish Tripo Studio models: Mixamo-rigged exports -> game rig (blender/tripo_rig.py) -> web (2K) + desktop (4K) GLBs.

    python tripo_publish.py kaien raijin ...      (ids from TRIPO below; --skip-rig re-optimises out/rigged_tripo/<id>.glb)
Inputs  out/tripo/<id>_rig.glb (Tripo "Export" GLB, skeleton on, Mixamo preset), out/tripo/<id>_hd.glb (optional, HD source)
        out/tripo/prop_<name>.glb (props: no rig)
Outputs ../public/models/<id>.glb, out/models_hq/<id>.glb, ../public/models/manifest.json
"""
import json, subprocess, sys
from pathlib import Path
from build_assets import gltf, HERO_IDS, PUB, HQ

HERE = Path(__file__).resolve().parent
SRC = HERE / 'out' / 'tripo'
RIGGED = HERE / 'out' / 'rigged_tripo'
# id: (height m, tripo_rig.py flags). Chains per hero, checked with blender/chain_view.py (weights painted by type):
#   --chains skirt panels + coat tails / cape, --hair long hair grown from the scalp by colour (--hair-rgb when the
#   scalp sample hits a crown or horns), --crown topknots / buns / dreadlocks, --sleeves wide sleeves, --scarf seeds
#   the --hair chains at the neck (Hayate's scarf)
WHITE = ['--hair-rgb', '0.9,0.9,0.9']
# masks and shades: MediaPipe still finds a "face" on a skull mask or behind sunglasses, and skin lids would blink over them
NO_BLINK = {'hex', 'kagemaru', 'hibiki', 'hibiki_armor'}
TRIPO = {
    'tenkai': (3.3, ['--mech', '--tris', '70000']), 'gorgoth': (3.4, ['--mech', '--tris', '70000']),
    'mirei': (1.7, ['--wings']), 'nocturne': (1.75, ['--wings', '--chains', '--hair', *WHITE]),
    'kaien': (1.8, ['--chains', '--hair', '--crown', '--sleeves']), 'raijin': (1.8, ['--chains']), 'yuzu': (1.62, ['--crown']),
    'hex': (1.95, ['--chains']), 'kagemaru': (1.78, ['--chains']), 'enra': (2.05, ['--chains']), 'haruto': (1.75, []),
    'vorn': (1.85, ['--chains']), 'gantetsu': (2.4, ['--chains', '--crown']), 'hibiki': (1.82, ['--crown']),
    'tomoe': (2.0, ['--chains']), 'hayate': (1.78, ['--hair', '--scarf', '--hair-rgb', '0.153,0.416,0.384', '--hair-tol', '0.2']),
    'seiran': (1.84, ['--chains', '--hair']), 'hibiki_armor': (1.82, ['--crown']),
    'qelvaris': (2.3, ['--chains']), 'minion_lancer': (2.0, []), 'minion_sentinel': (2.2, ['--mech']),
    'bot_dummy': (1.9, []), 'bot_sentry': (1.7, ['--mech']),
    'boss_ironmaw': (14, ['--mech']), 'boss_leviathan': (16, ['--mech']), 'boss_reaper': (16, ['--mech']), 'boss_genesis': (18, ['--mech']),
}


def rig(aid):
    h, flags = TRIPO[aid]
    src = SRC / f'{aid}_rig.glb'
    if not src.exists(): print('missing', src); return None
    hd = SRC / f'{aid}_hd.glb'
    cmd = ['blender', '-b', '-P', str(HERE / 'blender' / 'tripo_rig.py'), '--', '--glb', str(src), '--out', str(RIGGED / f'{aid}.glb'), '--height', str(h), *flags]
    if hd.exists() and '--tris' in flags: cmd += ['--hd', str(hd)]
    elif '--tris' in flags: cmd = [c for i, c in enumerate(cmd) if not (c == '--tris' or (i and cmd[i - 1] == '--tris'))]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    line = next((l for l in r.stdout.splitlines() if l.startswith('RIG_DONE')), None)
    if not line: print(aid, 'RIG FAILED\n', r.stdout[-1500:], r.stderr[-1500:]); return None
    info = json.loads(line[9:])
    if '--mech' not in flags and aid not in NO_BLINK:
        # the painted eyes, for the runtime blink (blender/eyes.py: front render -> MediaPipe face landmarks -> raycast)
        e = subprocess.run(['blender', '-b', '-P', str(HERE / 'blender' / 'eyes.py'), '--', '--glb', str(RIGGED / f'{aid}.glb'), '--python', sys.executable],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        el = next((l for l in e.stdout.splitlines() if l.startswith('EYES_DONE')), None)
        ej = json.loads(el[10:]) if el else {'ok': False}
        info['eyes'] = ej.get('eyes') if ej.get('ok') else None
    print(aid, {k: v for k, v in info.items() if k != 'eyes'}, 'eyes:', bool(info.get('eyes'))); return info


def main():
    ids = [a for a in sys.argv[1:] if not a.startswith('--')]
    skip = '--skip-rig' in sys.argv
    RIGGED.mkdir(parents=True, exist_ok=True)
    manifest_p = PUB / 'manifest.json'
    manifest = json.loads(manifest_p.read_text())
    report_p = HERE / 'out' / 'rig_report_tripo.json'
    report = json.loads(report_p.read_text()) if report_p.exists() else {}
    for aid in ids:
        if aid.startswith('prop_'):
            p = SRC / f'{aid}.glb'
            held = any(aid.startswith(f'prop_{x}_') for x in HERO_IDS)
            ok = gltf(p, PUB / f'{aid}.glb', 1024 if held else 512, None if held else 0.3, 0.005) and gltf(p, HQ / f'{aid}.glb', 2048 if held else 1024, None if held else 0.45)
            if ok: manifest['props'][aid] = {'height': 1}
            print('prop', aid, ok); continue
        info = report.get(aid) if skip else rig(aid)
        if not info: continue
        report[aid] = info
        hero = aid in HERO_IDS
        src = RIGGED / f'{aid}.glb'
        ok = gltf(src, PUB / f'{aid}.glb', 2048 if hero or aid.startswith('boss_') else 1024) and gltf(src, HQ / f'{aid}.glb', 4096 if hero else 2048)
        if ok:
            manifest['models'][aid] = {'height': TRIPO[aid][0], 'tris': info.get('tris', 0), 'bones': ['humanoid'], 'source': 'tripo',
                                       'colliders': info.get('colliders', {}), **({'eyes': info['eyes']} if info.get('eyes') else {})}
            print(f"published {aid}: {(PUB / f'{aid}.glb').stat().st_size / 1e6:.2f} MB web, {(HQ / f'{aid}.glb').stat().st_size / 1e6:.2f} MB desktop")
    report_p.write_text(json.dumps(report, indent=1))
    manifest_p.write_text(json.dumps(manifest, indent=1))


if __name__ == '__main__':
    main()
