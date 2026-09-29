#!/usr/bin/env python3
"""Check map props against their placements before (or after) they are published.

    python assetgen/prop_check.py [prop_id ...]        # default: every prop the maps place

For each prop: where its GLB is (public/models, else assetgen/out/tripo), its proportions and long axis, and how the maps
place it (height s, collision radius `solid`, rot). MapScene scales a prop to its placement height and centres it, so
export scale doesn't matter; what needs a human eye is FACING (a vehicle, a sign, a gate) and a collision radius that
suits the footprint. Flags:
  NO MODEL    nothing to draw: the game shows the crystal stand-in
  LONG x / z  a long prop: check which way it lies against its `rot` (the game's forward is +z)
  SOLID?      the collision radius is under 35% or over 75% of the footprint's half-width at that height
"""
import json, re, struct, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAPS = (ROOT / 'src' / 'data' / 'maps.ts').read_text(encoding='utf-8')


def extent(glb: Path):
    b = glb.read_bytes()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    lo, hi, tris = [1e9] * 3, [-1e9] * 3, 0
    for m in j.get('meshes', []):
        for p in m['primitives']:
            a = j['accessors'][p['attributes']['POSITION']]
            for i in range(3):
                lo[i] = min(lo[i], a['min'][i]); hi[i] = max(hi[i], a['max'][i])
            tris += (j['accessors'][p['indices']]['count'] if 'indices' in p else a['count']) // 3
    return [hi[i] - lo[i] for i in range(3)], tris


def placements(pid: str):
    out = []
    for m in re.finditer(r"\{ id: '" + re.escape(pid) + r"',([^}]*)\}", MAPS):
        f = m.group(1)
        g = lambda k: (re.search(r"\b" + k + r": ([^,]+)", f) or [None, None])[1]
        out.append({'s': float(g('s') or 2), 'solid': float(g('solid')) if g('solid') else None, 'rot': g('rot') or '0'})
    return out


def main():
    ids = sys.argv[1:] or sorted(set(re.findall(r"id: '(prop_[a-z_]+)'", MAPS)) | set(re.findall(r"payload: '(prop_[a-z_]+)'", MAPS)))
    for pid in ids:
        glb = next((p for p in (ROOT / 'public' / 'models' / f'{pid}.glb', ROOT / 'assetgen' / 'out' / 'tripo' / f'{pid}.glb') if p.exists()), None)
        pl = placements(pid)
        if not glb:
            print(f'{pid:28s} NO MODEL   placed {len(pl)}x'); continue
        (x, y, z), tris = extent(glb)
        flags = []
        if max(x, z) > 1.6 * min(x, z): flags.append('LONG ' + ('x' if x > z else 'z'))
        for p in pl:
            half = max(x, z) / y * p['s'] / 2
            if p['solid'] is not None and not (0.35 * half <= p['solid'] <= 0.75 * half):
                flags.append(f"SOLID? {p['solid']} vs half-width {half:.2f} at s={p['s']}")
        where = 'published' if 'public' in glb.parts else 'waiting  '
        rots = sorted({p['rot'] for p in pl})
        print(f"{pid:28s} {where} {tris:6d} tris  x:y:z = {x / y:.2f} : 1 : {z / y:.2f}  placed {len(pl)}x rot {rots}  {' | '.join(dict.fromkeys(flags))}")


if __name__ == '__main__':
    main()
