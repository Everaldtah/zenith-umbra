// Static level collision: axis-aligned boxes (optionally ramps), thin floor slabs, cylindrical prop solids.
// Characters are vertical capsules resolved against these; rays are used for hitscan, projectiles and line of sight.
import type { Box, MapDef, Pad } from '../data/maps';

export interface V3 { x: number; y: number; z: number; }
export interface RayHit { t: number; nx: number; ny: number; nz: number; }
interface Solid { x: number; z: number; r: number; y0: number; y1: number; }

export const STEP = 0.55;

export class Level {
  readonly boxes: Box[];
  readonly floors: Box[];
  readonly solids: Solid[] = [];
  readonly pads: Pad[];
  readonly killY: number;
  readonly size: [number, number];

  constructor(public map: MapDef) {
    this.boxes = map.boxes;
    this.floors = map.floors;
    this.pads = map.pads;
    this.killY = map.killY;
    this.size = map.size;
    for (const p of map.props) if (p.solid) {
      const y0 = (p.y ?? this.groundAt(p.x, p.z, 50));
      this.solids.push({ x: p.x, z: p.z, r: p.solid, y0, y1: y0 + (p.s ?? 2) * 0.9 });
    }
  }

  /** surface height of a box/ramp at (x,z), or null if outside its footprint */
  static top(b: Box, x: number, z: number): number | null {
    const hx = b.w / 2, hz = b.d / 2;
    if (x < b.x - hx || x > b.x + hx || z < b.z - hz || z > b.z + hz) return null;
    const y0 = b.y ?? 0;
    if (!b.ramp) return y0 + b.h;
    let f = 0;
    if (b.ramp === 'x+') f = (x - (b.x - hx)) / b.w;
    else if (b.ramp === 'x-') f = ((b.x + hx) - x) / b.w;
    else if (b.ramp === 'z+') f = (z - (b.z - hz)) / b.d;
    else f = ((b.z + hz) - z) / b.d;
    return y0 + b.h * Math.min(1, Math.max(0, f));
  }

  /** highest walkable surface at (x,z) not above `fromY` + STEP (so you can't snap onto a roof from below). -Infinity = void. */
  groundAt(x: number, z: number, fromY: number, radius = 0): number {
    let g = -Infinity;
    const lim = fromY + STEP;
    const probe = (px: number, pz: number) => {
      for (const f of this.floors) { const t = Level.top(f, px, pz); if (t !== null && t <= lim && t > g) g = t; }
      for (const b of this.boxes) { const t = Level.top(b, px, pz); if (t !== null && t <= lim && t > g) g = t; }
    };
    probe(x, z);
    if (radius > 0 && g === -Infinity) {
      // standing on an edge: count the footprint so heroes don't slip off ledges they visibly stand on
      const r = radius * 0.6;
      probe(x + r, z); probe(x - r, z); probe(x, z + r); probe(x, z - r);
    }
    return g;
  }

  /** push a capsule (feet at p.y, height h) out of walls. Returns true if it touched a wall. */
  collide(p: V3, r: number, h: number): boolean {
    let hit = false;
    for (const b of this.boxes) {
      const y0 = b.y ?? 0;
      const hx = b.w / 2, hz = b.d / 2;
      const cx = Math.max(b.x - hx, Math.min(p.x, b.x + hx));
      const cz = Math.max(b.z - hz, Math.min(p.z, b.z + hz));
      // ramps are walkable up their slope but block like a wall wherever the local surface is above step height
      const top = b.ramp ? (Level.top(b, cx, cz) as number) : y0 + b.h;
      if (p.y >= top - STEP * 0.98 || p.y + h <= y0) continue;
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2), push = r - d;
        p.x += dx / d * push; p.z += dz / d * push;
      } else {
        // centre inside the box: exit along the shallowest axis
        const ex = [b.x + hx - p.x + r, p.x - (b.x - hx) + r, b.z + hz - p.z + r, p.z - (b.z - hz) + r];
        const m = Math.min(...ex), i = ex.indexOf(m);
        if (i === 0) p.x += m; else if (i === 1) p.x -= m; else if (i === 2) p.z += m; else p.z -= m;
      }
    }
    for (const s of this.solids) {
      if (p.y >= s.y1 || p.y + h <= s.y0) continue;
      const dx = p.x - s.x, dz = p.z - s.z, rr = r + s.r, d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1e-4;
      p.x = s.x + dx / d * rr; p.z = s.z + dz / d * rr; hit = true;
    }
    return hit;
  }

  /** ceiling above a point (bottom of the lowest box above headY) */
  ceilingAt(x: number, z: number, headY: number): number {
    let c = Infinity;
    for (const b of this.boxes) {
      const y0 = b.y ?? 0;
      if (y0 > headY - 0.05 && y0 < c && Level.top({ ...b, ramp: undefined }, x, z) !== null) c = y0;
    }
    return c;
  }

  /** ray vs level; dir must be normalised */
  ray(o: V3, d: V3, max: number): RayHit | null {
    let best: RayHit | null = null;
    const test = (b: Box, thick: number) => {
      const y0 = (b.y ?? 0) - thick, y1 = (b.y ?? 0) + b.h;
      const h = slab(o, d, b.x - b.w / 2, y0, b.z - b.d / 2, b.x + b.w / 2, y1, b.z + b.d / 2, best ? best.t : max);
      if (!h) return;
      if (b.ramp) {
        // walk the ray through the prism until it drops below the slope
        const n = 12;
        for (let i = 0; i <= n; i++) {
          const t = h.t + (Math.min(h.tExit, best ? best.t : max) - h.t) * (i / n);
          const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
          const top = Level.top(b, px, pz);
          if (top !== null && py <= top) { best = { t, nx: 0, ny: 1, nz: 0 }; return; }
        }
        return;
      }
      best = { t: h.t, nx: h.nx, ny: h.ny, nz: h.nz };
    };
    for (const b of this.boxes) test(b, 0);
    for (const f of this.floors) test(f, 1.5);
    for (const s of this.solids) {
      // vertical cylinder
      const ox = o.x - s.x, oz = o.z - s.z;
      const a = d.x * d.x + d.z * d.z;
      if (a < 1e-9) continue;
      const bq = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - s.r * s.r;
      const disc = bq * bq - 4 * a * c;
      if (disc < 0) continue;
      const t = (-bq - Math.sqrt(disc)) / (2 * a);
      if (t < 0 || t > (best ? (best as RayHit).t : max)) continue;
      const y = o.y + d.y * t;
      if (y < s.y0 || y > s.y1) continue;
      const hx = ox + d.x * t, hz = oz + d.z * t, l = Math.hypot(hx, hz) || 1;
      best = { t, nx: hx / l, ny: 0, nz: hz / l };
    }
    return best;
  }

  lineOfSight(a: V3, b: V3): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l = Math.hypot(dx, dy, dz);
    if (l < 1e-4) return true;
    return !this.ray(a, { x: dx / l, y: dy / l, z: dz / l }, l - 0.05);
  }

  padAt(x: number, z: number, y: number): Pad | null {
    for (const p of this.pads) if (Math.hypot(x - p.x, z - p.z) < 1.6 && Math.abs(y - (p.y ?? this.groundAt(p.x, p.z, y + 1))) < 0.4) return p;
    return null;
  }
}

function slab(o: V3, d: V3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, max: number) {
  let tmin = 0, tmax = max, nx = 0, ny = 0, nz = 0;
  const axes: [number, number, number, number, 0 | 1 | 2][] = [[o.x, d.x, x0, x1, 0], [o.y, d.y, y0, y1, 1], [o.z, d.z, z0, z1, 2]];
  for (const [oo, dd, lo, hi, ax] of axes) {
    if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return null; continue; }
    let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd, s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; nx = ax === 0 ? s : 0; ny = ax === 1 ? s : 0; nz = ax === 2 ? s : 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return { t: tmin, tExit: tmax, nx, ny, nz };
}
