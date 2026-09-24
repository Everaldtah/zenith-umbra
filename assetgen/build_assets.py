#!/usr/bin/env python3
"""Rig heroes (Blender, parallel), optimise every GLB for web (1K WebP + Draco) and desktop (2K), write the manifest.

    python build_assets.py [--only id1,id2] [--jobs 3] [--skip-rig]
Inputs:  out/trellis-*/glb/model_<id>.glb, prop_<map>_<name>.glb
Outputs: ../public/models/<id>.glb (web), out/models_hq/<id>.glb (desktop), ../public/models/manifest.json, out/rig_report.json
"""
import argparse, glob, json, os, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
PUB = HERE.parent / 'public' / 'models'
HQ = HERE / 'out' / 'models_hq'
RIG = HERE / 'out' / 'rigged'
# id: (height m, flags)
HEROES = {
    'tenkai': (3.3, ['--mech', '--tris', '34000']), 'gorgoth': (3.4, ['--mech', '--tris', '34000']),
    'mirei': (1.65, ['--wings']), 'nocturne': (1.75, ['--wings']),
    'kaien': (1.8, []), 'raijin': (1.8, []), 'yuzu': (1.62, []), 'hex': (1.95, []), 'kagemaru': (1.78, []), 'enra': (2.05, []),
    'haruto': (1.75, []), 'vorn': (1.85, []),
    'bot_dummy': (1.9, ['--tris', '12000']), 'bot_sentry': (1.7, ['--mech', '--tris', '12000']),
    # campaign
    'qelvaris': (2.3, []), 'minion_lancer': (2.0, ['--tris', '12000']), 'minion_sentinel': (2.2, ['--mech', '--tris', '12000']),
    'boss_ironmaw': (14, ['--mech', '--tris', '40000']), 'boss_leviathan': (16, ['--mech', '--tris', '40000']), 'boss_reaper': (16, ['--mech', '--tris', '40000']), 'boss_genesis': (18, ['--mech', '--tris', '40000']),
}
STATIC = {'bot_drone': 1.0, 'minion_swarmer': 1.2, 'minion_bomber': 1.4, 'boss_phoenix': 15}


def sources():
    found = {}
    for f in sorted(glob.glob(str(HERE / 'out' / 'trellis-*' / 'glb' / '*.glb'))):
        stem = Path(f).stem
        found[stem.replace('model_', '', 1) if stem.startswith('model_') else stem] = Path(f)
    return found


def gltf(src: Path, dst: Path, tex: int, simplify: float | None = None, err: float = 0.002):
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = ['npx', '--yes', '@gltf-transform/cli', 'optimize', str(src), str(dst), '--compress', 'draco', '--texture-compress', 'webp', '--texture-size', str(tex)]
    if simplify: cmd += ['--simplify', 'true', '--simplify-ratio', str(simplify), '--simplify-error', str(err)]
    else: cmd += ['--simplify', 'false']
    r = subprocess.run(cmd, capture_output=True, text=True, shell=True, encoding='utf-8', errors='replace')
    if r.returncode: print(r.stdout[-500:], r.stderr[-500:])
    return r.returncode == 0


def rig(aid, src, height, flags):
    t = time.time()
    out = RIG / f'{aid}.glb'
    cmd = ['blender', '-b', '-P', str(HERE / 'blender' / 'rig_hero.py'), '--', '--glb', str(src), '--out', str(out), '--height', str(height), '--python', sys.executable, *flags]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    m = re.search(r'RIG_DONE (\{.*\})', r.stdout)
    if not m:
        print(f'ERR rig {aid}\n', (r.stdout + r.stderr)[-1500:]); return aid, None
    info = json.loads(m.group(1))
    print(f"rig {aid:16s} {time.time() - t:5.0f}s method={info.get('method')} weights={info.get('weights')} pose={info.get('pose_score')} deform={info.get('deform_max')}", flush=True)
    return aid, info


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--only', default=''); ap.add_argument('--jobs', type=int, default=3); ap.add_argument('--skip-rig', action='store_true')
    a = ap.parse_args()
    src = sources()
    only = set(a.only.split(',')) if a.only else None
    RIG.mkdir(parents=True, exist_ok=True)
    report_p = HERE / 'out' / 'rig_report.json'
    report = json.loads(report_p.read_text()) if report_p.exists() else {}
    todo = [(k, src[k], *HEROES[k]) for k in HEROES if k in src and (not only or k in only)]
    if not a.skip_rig:
        with ThreadPoolExecutor(a.jobs) as ex:
            for aid, info in ex.map(lambda x: rig(*x), todo):
                if info: report[aid] = info
        report_p.write_text(json.dumps(report, indent=1))
    manifest_p = PUB / 'manifest.json'
    manifest = json.loads(manifest_p.read_text()) if manifest_p.exists() else {'models': {}, 'props': {}, 'textures': []}
    jobs = []
    for aid, *_ in todo:
        if (RIG / f'{aid}.glb').exists(): jobs.append((aid, RIG / f'{aid}.glb', 'model', HEROES[aid][0]))
    for aid, h in STATIC.items():
        if aid in src and (not only or aid in only): jobs.append((aid, src[aid], 'static', h))
    for aid, p in src.items():
        if aid.startswith('prop_') and (not only or aid in only): jobs.append((aid, p, 'prop', 0))

    def opt(j):
        aid, p, kind, h = j
        big = aid.startswith('boss_')
        # web: props are background dressing -> heavy decimation; desktop keeps far more detail
        ok = gltf(p, PUB / f'{aid}.glb', 2048 if big else 1024 if kind != 'prop' else 512, 0.3 if kind == 'prop' else 0.5 if kind == 'static' else None, 0.005)
        gltf(p, HQ / f'{aid}.glb', 2048 if kind != 'prop' else 1024, 0.45 if kind == 'prop' else 0.7 if kind == 'static' else None)
        print(f"{'ok ' if ok else 'ERR'} {aid:24s} {(PUB / f'{aid}.glb').stat().st_size / 1e6 if ok else 0:5.2f} MB", flush=True)
        return j, ok
    with ThreadPoolExecutor(4) as ex:
        for (aid, p, kind, h), ok in ex.map(opt, jobs):
            if not ok: continue
            if kind == 'prop': manifest['props'][aid] = {'height': 1}
            else: manifest['models'][aid] = {'height': h, 'tris': report.get(aid, {}).get('tris', 0), 'bones': [] if kind == 'static' else ['humanoid']}
    envdir = HERE.parent / 'public'
    manifest['textures'] = sorted(str(p.relative_to(envdir)).replace('\\', '/') for p in (envdir / 'env').glob('*.webp'))
    manifest_p.write_text(json.dumps(manifest, indent=1))
    print('manifest:', len(manifest['models']), 'models,', len(manifest['props']), 'props')


if __name__ == '__main__':
    main()
