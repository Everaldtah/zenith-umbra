"""Watch Downloads for Tripo prop exports (prop_*.glb): move each into out/tripo/<id>_src.glb and decimate it to
out/tripo/<id>.glb (blender/decimate_prop.py), ready for `tripo_publish.py <id>`. Rigged hero exports (*_rig.glb) and
unrigged HD exports for tripo_mech.py (*_hd.glb) are just moved. Runs until nothing new arrives for --idle minutes.

    python tripo_watch.py [--idle 40]
"""
import subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
DL = Path.home() / 'Downloads'
OUT = HERE / 'out' / 'tripo'
HELD = ('prop_raijin_', 'prop_yuzu_', 'prop_seiran_', 'prop_hayate_')
GUNS = ('prop_gantetsu_',)                                    # twin chainguns: more hard-surface detail than a blade
idle = float(sys.argv[sys.argv.index('--idle') + 1]) if '--idle' in sys.argv else 40
last = time.time()
while time.time() - last < idle * 60:
    for f in sorted(DL.glob('*.glb')):
        if not (f.name.startswith('prop_') or f.name.endswith(('_rig.glb', '_hd.glb'))): continue
        s0 = f.stat().st_size; time.sleep(2)
        if f.stat().st_size != s0: continue                      # still being written
        last = time.time()
        if f.name.endswith(('_rig.glb', '_hd.glb')):
            f.replace(OUT / f.name); print('moved', f.name, flush=True); continue
        pid = f.stem
        src = OUT / f'{pid}_src.glb'
        f.replace(src)
        tris = '12000' if pid.startswith(GUNS) else '8000' if pid.startswith(HELD) else '14000'
        r = subprocess.run(['blender', '-b', '-P', str(HERE / 'blender' / 'decimate_prop.py'), '--', str(src), str(OUT / f'{pid}.glb'), tris],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        print(pid, next((l for l in r.stdout.splitlines() if l.startswith('DECIMATED')), 'FAILED ' + r.stdout[-300:]), flush=True)
    time.sleep(3)
print('idle, exiting')
