#!/usr/bin/env python3
"""Publish Tripo Studio models: Mixamo-rigged exports -> game rig (blender/tripo_rig.py) -> web (2K) + desktop (4K) GLBs.

    python tripo_publish.py kaien raijin ...      (ids from TRIPO below; --skip-rig re-optimises out/rigged_tripo/<id>.glb)
Inputs  out/tripo/<id>_rig.glb (Tripo "Export" GLB, skeleton on, Mixamo preset), out/tripo/<id>_hd.glb (optional, HD source:
        the original generation, unskinned - mechs use it for both editions, humanoid heroes for the desktop edition)
        out/tripo/prop_<name>.glb (props: no rig)
Outputs ../public/models/<id>.glb, out/models_hq/<id>.glb, out/models_hd/<id>.glb (desktop close-ups), ../public/models/manifest.json
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
# ...and the masks' sockets glow instead (the detected eyes are stored as glowEyes; CharacterView's EyeGlow)
GLOW_EYES = {'hex', 'kagemaru'}
# desktop close-ups (the first-person viewmodel, the Hero Viewer): the original high-detail generation (real fingers, folds,
# 4K maps with normals) decimated to this budget, skinned with the retopo rig's weights. Ten of them in a match halved the
# frame rate (55 -> 27 fps), so heroes in the match stay on the retopo mesh - the way Overwatch ships a separate
# first-person model
HD_TRIS = 90000
HD_OUT = HERE / 'out' / 'models_hd'
# first-person hand models: the arms + hands of the full-resolution HD generation (fingers re-skinned per joint), capped
FP_TRIS = 80000
FP_OUT = HERE / 'out' / 'models_fp'
# per hero: how close to the hand joints geometry must be to stay hand (x height; default 0.07 keeps bulky gauntlets) -
# Kaien's generation holds a paper-hung staff right against his fingers
FP_HELD_CUT = {'kaien': 0.045, 'tomoe': 0.04}     # Tomoe's generation holds her knife tight in the left fist
TRIPO = {
    'tenkai': (3.3, ['--mech', '--tris', '70000']), 'gorgoth': (3.4, ['--mech', '--tris', '70000']),
    'mirei': (1.7, ['--wings']), 'nocturne': (1.75, ['--wings', '--chains', '--hair', *WHITE]),
    'kaien': (1.8, ['--chains', '--hair', '--crown', '--sleeves']), 'raijin': (1.8, ['--chains']), 'yuzu': (1.62, ['--crown']),
    'hex': (1.95, ['--chains']), 'kagemaru': (1.78, ['--chains']), 'enra': (2.05, ['--chains']), 'haruto': (1.75, []),
    'vorn': (1.85, ['--chains']), 'gantetsu': (2.4, ['--chains', '--no-cape', '--crown']), 'hibiki': (1.82, ['--crown']),
    'tomoe': (2.0, ['--chains']), 'hayate': (1.78, ['--hair', '--scarf', '--hair-rgb', '0.153,0.416,0.384', '--hair-tol', '0.2']),
    'seiran': (1.84, ['--chains', '--hair']), 'hibiki_armor': (1.82, ['--crown']),
    'qelvaris': (2.3, ['--chains']), 'minion_lancer': (2.0, []), 'minion_sentinel': (2.2, ['--mech']),
    'bot_dummy': (1.9, []), 'bot_sentry': (1.7, ['--mech']),
    'boss_ironmaw': (14, ['--mech']), 'boss_leviathan': (16, ['--mech']), 'boss_reaper': (16, ['--mech']), 'boss_genesis': (18, ['--mech']),
}


def rig(aid, hq=False, fp=False):
    h, flags = TRIPO[aid]
    src = SRC / f'{aid}_rig.glb'
    if not src.exists(): print('missing', src); return None
    hd = SRC / f'{aid}_hd.glb'
    out = RIGGED / f'{aid}_fp.glb' if fp else RIGGED / f'{aid}_hq.glb' if hq else RIGGED / f'{aid}.glb'
    cmd = ['blender', '-b', '-P', str(HERE / 'blender' / 'tripo_rig.py'), '--', '--glb', str(src), '--out', str(out), '--height', str(h), *flags]
    if fp: cmd += ['--hd', str(hd), '--tris', str(FP_TRIS), '--hd-late', '--fp-arms', '--held-cut', str(FP_HELD_CUT.get(aid, 0.07))]
    elif hq: cmd += ['--hd', str(hd), '--tris', str(HD_TRIS), '--hd-late']
    elif hd.exists() and '--tris' in flags: cmd += ['--hd', str(hd)]
    elif '--tris' in flags: cmd = [c for i, c in enumerate(cmd) if not (c == '--tris' or (i and cmd[i - 1] == '--tris'))]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    line = next((l for l in r.stdout.splitlines() if l.startswith('RIG_DONE')), None)
    if not line: print(aid, 'HQ ' if hq else '', 'RIG FAILED\n', r.stdout[-1500:], r.stderr[-1500:]); return None
    info = json.loads(line[9:])
    if hq or fp: print(aid, 'FP' if fp else 'HQ', {k: info.get(k) for k in ('hd_fit', 'hd_tris', 'fp_full_tris', 'tris', 'fp_hand_L', 'fp_hand_R', 'unweighted_hd', 'deform_max')}); return info
    if '--mech' not in flags and (aid not in NO_BLINK or aid in GLOW_EYES):
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
        # desktop close-ups: the high-detail generation, when there is one (same skeleton, eyes and colliders as the retopo)
        hd = False
        if hero and '--mech' not in TRIPO[aid][1] and (SRC / f'{aid}_hd.glb').exists() and '--no-hq' not in sys.argv:
            if (skip and (RIGGED / f'{aid}_hq.glb').exists()) or rig(aid, hq=True):
                HD_OUT.mkdir(parents=True, exist_ok=True)
                hd = gltf(RIGGED / f'{aid}_hq.glb', HD_OUT / f'{aid}.glb', 4096)
        fp_ok = False
        if hero and '--mech' not in TRIPO[aid][1] and (SRC / f'{aid}_hd.glb').exists() and '--no-fp' not in sys.argv:
            if (skip and (RIGGED / f'{aid}_fp.glb').exists() and '--fp' not in sys.argv) or rig(aid, fp=True):
                FP_OUT.mkdir(parents=True, exist_ok=True)
                fp_ok = gltf(RIGGED / f'{aid}_fp.glb', FP_OUT / f'{aid}.glb', 4096)
        ok = gltf(src, PUB / f'{aid}.glb', 2048 if hero or aid.startswith('boss_') else 1024) and gltf(src, HQ / f'{aid}.glb', 4096 if hero else 2048)
        if ok:
            eyes = info.get('eyes') or info.get('glowEyes')
            key = 'glowEyes' if aid in GLOW_EYES else 'eyes'
            manifest['models'][aid] = {'height': TRIPO[aid][0], 'tris': info.get('tris', 0), 'bones': ['humanoid'], 'source': 'tripo',
                                       'colliders': info.get('colliders', {}), **({key: eyes} if eyes else {}), **({'hd': True} if hd else {}), **({'fpArms': True} if fp_ok else {})}
            print(f"published {aid}: {(PUB / f'{aid}.glb').stat().st_size / 1e6:.2f} MB web, {(HQ / f'{aid}.glb').stat().st_size / 1e6:.2f} MB desktop")
    report_p.write_text(json.dumps(report, indent=1))
    manifest_p.write_text(json.dumps(manifest, indent=1))


if __name__ == '__main__':
    main()
