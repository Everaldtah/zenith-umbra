// Static level collision: axis-aligned boxes (optionally ramps), thin floor slabs, cylindrical prop solids.
// Characters are vertical capsules resolved against these; rays are used for hitscan, projectiles and line of sight.
import type { Box, MapDef, Pad } from '../data/maps';
import { GridIndex } from './Broadphase';

export interface V3 { x: number; y: number; z: number; }
export interface RayHit { t: number; nx: number; ny: number; nz: number; mat?: string; }
interface Solid { x: number; z: number; r: number; y0: number; y1: number; }

export const STEP = 0.55;
/** collide(): candidates are gathered this far beyond the capsule; a push sequence that carries it further re-runs
 *  over every box (so the result is always exactly the full loop's) */
const PUSH_PAD = 2;
const _cand: number[] = [];
const footprint = (b: Box): [number, number, number, number] => [b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2];

export class Level {
  readonly boxes: Box[];
  readonly floors: Box[];
  readonly solids: Solid[] = [];
  readonly pads: Pad[];
  readonly killY: number;
  readonly size: [number, number];
  // broadphase grids over the static geometry (src/engine/Broadphase.ts), built on first use
  private gBoxes: GridIndex | null = null;
  private gFloors: GridIndex | null = null;
  private gSolids: GridIndex | null = null;

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

  private boxGrid() {
    if (!this.gBoxes || this.gBoxes.count !== this.boxes.length) this.gBoxes = new GridIndex(this.boxes.length, i => footprint(this.boxes[i]));
    return this.gBoxes;
  }
  private floorGrid() {
    if (!this.gFloors || this.gFloors.count !== this.floors.length) this.gFloors = new GridIndex(this.floors.length, i => footprint(this.floors[i]));
    return this.gFloors;
  }
  private solidGrid() {
    if (!this.gSolids || this.gSolids.count !== this.solids.length) this.gSolids = new GridIndex(this.solids.length, i => { const s = this.solids[i]; return [s.x - s.r, s.z - s.r, s.x + s.r, s.z + s.r]; });
    return this.gSolids;
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

  /** the material of the surface groundAt() would stand on (footsteps and landings sound like what they hit) */
  matAt(x: number, z: number, fromY: number): string | undefined {
    let g = -Infinity, m: string | undefined;
    const lim = fromY + STEP;
    const fl = this.floorGrid().at(x, z), bl = this.boxGrid().at(x, z);
    for (let k = 0; k < fl.length; k++) { const b = this.floors[fl[k]], t = Level.top(b, x, z); if (t !== null && t <= lim && t > g) { g = t; m = b.mat ?? 'ground'; } }
    for (let k = 0; k < bl.length; k++) { const b = this.boxes[bl[k]], t = Level.top(b, x, z); if (t !== null && t <= lim && t > g) { g = t; m = b.mat ?? 'ground'; } }
    return m;
  }

  /** highest walkable surface at (x,z) not above `fromY` + STEP (so you can't snap onto a roof from below). -Infinity = void. */
  groundAt(x: number, z: number, fromY: number, radius = 0): number {
    const lim = fromY + STEP;
    let g = this.probe(x, z, lim, -Infinity);
    if (radius > 0 && g === -Infinity) {
      // standing on an edge: count the footprint so heroes don't slip off ledges they visibly stand on
      const r = radius * 0.6;
      g = this.probe(x + r, z, lim, g); g = this.probe(x - r, z, lim, g); g = this.probe(x, z + r, lim, g); g = this.probe(x, z - r, lim, g);
    }
    return g;
  }

  /** highest surface top at (px,pz) that is <= lim and above g */
  private probe(px: number, pz: number, lim: number, g: number): number {
    const fl = this.floorGrid().at(px, pz), bl = this.boxGrid().at(px, pz);
    for (let k = 0; k < fl.length; k++) { const t = Level.top(this.floors[fl[k]], px, pz); if (t !== null && t <= lim && t > g) g = t; }
    for (let k = 0; k < bl.length; k++) { const t = Level.top(this.boxes[bl[k]], px, pz); if (t !== null && t <= lim && t > g) g = t; }
    return g;
  }

  /** push a capsule (feet at p.y, height h) out of walls. Returns true if it touched a wall. */
  collide(p: V3, r: number, h: number): boolean {
    // Only boxes within r + PUSH_PAD of the start can be touched while every push keeps the capsule within PUSH_PAD
    // of it - anything further fails the distance test anyway - so the candidates give the full loop's exact answer.
    // A push that carries it further aborts, and the whole pass re-runs over everything.
    const x0 = p.x, z0 = p.z, R = r + PUSH_PAD;
    let hit = this.collideBoxes(p, r, h, this.boxGrid().rect(x0 - R, z0 - R, x0 + R, z0 + R, _cand), x0, z0);
    if (hit === null) { p.x = x0; p.z = z0; hit = this.collideBoxes(p, r, h, null, x0, z0) as boolean; }
    const x1 = p.x, z1 = p.z;
    let sh = this.collideSolids(p, r, h, this.solidGrid().rect(x1 - R, z1 - R, x1 + R, z1 + R, _cand), x1, z1);
    if (sh === null) { p.x = x1; p.z = z1; sh = this.collideSolids(p, r, h, null, x1, z1) as boolean; }
    return hit || sh;
  }

  /** collide()'s box pass over candidate indices (ascending) - null = moved past PUSH_PAD - or over every box */
  private collideBoxes(p: V3, r: number, h: number, cand: number[] | null, x0: number, z0: number): boolean | null {
    let hit = false;
    const n = cand ? cand.length : this.boxes.length;
    for (let k = 0; k < n; k++) {
      const b = this.boxes[cand ? cand[k] : k];
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
      if (cand && (Math.abs(p.x - x0) > PUSH_PAD || Math.abs(p.z - z0) > PUSH_PAD)) return null;
    }
    return hit;
  }

  /** the same for the cylindrical prop solids (binned by their radius, so the same margin argument holds) */
  private collideSolids(p: V3, r: number, h: number, cand: number[] | null, x0: number, z0: number): boolean | null {
    let hit = false;
    const n = cand ? cand.length : this.solids.length;
    for (let k = 0; k < n; k++) {
      const s = this.solids[cand ? cand[k] : k];
      if (p.y >= s.y1 || p.y + h <= s.y0) continue;
      const dx = p.x - s.x, dz = p.z - s.z, rr = r + s.r, d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1e-4;
      p.x = s.x + dx / d * rr; p.z = s.z + dz / d * rr; hit = true;
      if (cand && (Math.abs(p.x - x0) > PUSH_PAD || Math.abs(p.z - z0) > PUSH_PAD)) return null;
    }
    return hit;
  }

  /** ceiling above a point (bottom of the lowest box above headY) */
  ceilingAt(x: number, z: number, headY: number): number {
    let c = Infinity;
    const bl = this.boxGrid().at(x, z);
    for (let k = 0; k < bl.length; k++) {
      const b = this.boxes[bl[k]], y0 = b.y ?? 0;
      if (y0 > headY - 0.05 && y0 < c && !(x < b.x - b.w / 2 || x > b.x + b.w / 2 || z < b.z - b.d / 2 || z > b.z + b.d / 2)) c = y0;
    }
    return c;
  }

  /** ray vs level; dir must be normalised */
  ray(o: V3, d: V3, max: number): RayHit | null {
    // candidates = what lies in the grid cells under the ray's path, tested in the original order (boxes, floors,
    // solids; ascending), so ties and the ramp march resolve exactly as a test of every item would
    let best: RayHit | null = null;
    const test = (b: Box, thick: number) => {
      const y0 = (b.y ?? 0) - thick, y1 = (b.y ?? 0) + b.h;
      const h = slab(o, d, b.x - b.w / 2, y0, b.z - b.d / 2, b.x + b.w / 2, y1, b.z + b.d / 2, best ? best.t : max);
      if (!h) return;
      if (b.ramp) {
        // walk the ray through the prism until it drops below the slope
        const n = 12, t0 = h.t, t1 = h.tExit;
        for (let i = 0; i <= n; i++) {
          const t = t0 + (Math.min(t1, best ? best.t : max) - t0) * (i / n);
          const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
          const top = Level.top(b, px, pz);
          if (top !== null && py <= top) { best = { t, nx: 0, ny: 1, nz: 0, mat: b.mat }; return; }
        }
        return;
      }
      best = { t: h.t, nx: h.nx, ny: h.ny, nz: h.nz, mat: b.mat };
    };
    const bl = this.boxGrid().segment(o.x, o.z, d.x, d.z, max, _cand);
    for (let k = 0; k < bl.length; k++) test(this.boxes[bl[k]], 0);
    const fl = this.floorGrid().segment(o.x, o.z, d.x, d.z, max, _cand);
    for (let k = 0; k < fl.length; k++) test(this.floors[fl[k]], 1.5);
    const sl = this.solidGrid().segment(o.x, o.z, d.x, d.z, max, _cand);
    for (let k = 0; k < sl.length; k++) {
      const s = this.solids[sl[k]];
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

/** ray vs axis-aligned box (slabs, x then y then z); the result is a shared scratch object, read it before the next call */
const _slab = { t: 0, tExit: 0, nx: 0, ny: 0, nz: 0 };
function slab(o: V3, d: V3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, max: number) {
  _slab.t = 0; _slab.tExit = max; _slab.nx = 0; _slab.ny = 0; _slab.nz = 0;
  return slabAxis(o.x, d.x, x0, x1, 0) && slabAxis(o.y, d.y, y0, y1, 1) && slabAxis(o.z, d.z, z0, z1, 2) ? _slab : null;
}
function slabAxis(oo: number, dd: number, lo: number, hi: number, ax: 0 | 1 | 2): boolean {
  if (Math.abs(dd) < 1e-9) return !(oo < lo || oo > hi);
  let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd, s = -1;
  if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
  if (t1 > _slab.t) { _slab.t = t1; _slab.nx = ax === 0 ? s : 0; _slab.ny = ax === 1 ? s : 0; _slab.nz = ax === 2 ? s : 0; }
  if (t2 < _slab.tExit) _slab.tExit = t2;
  return !(_slab.t > _slab.tExit);
}
