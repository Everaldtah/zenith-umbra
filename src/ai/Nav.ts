// Layered navigation grid (0.5m cells): every walkable surface in a cell - the street, a building's upper floor, its
// roof - is its own node (up to LAYERS per cell), provided a hero can stand there (not buried inside a wall, 1.9m of
// headroom under the next slab). Climb / drop limits link surfaces between neighbouring cells, wall clearance costs,
// jump-pad links. A* with a binary heap; paths come back as world waypoints.
import { Level, STEP, type V3 } from '../engine/Physics';
import { G } from '../game/World';

const CELL = 0.5;
const CLIMB = STEP + 0.05;
const DROP = 4.5;
const LAYERS = 4;
const HEADROOM = 1.9;

export class Nav {
  nx: number; nz: number; x0: number; z0: number;
  /** surface height per node (cell * LAYERS + layer), NaN = no surface */
  h: Float32Array;
  cost: Float32Array;
  padLink = new Map<number, number>();

  constructor(public level: Level) {
    const [X, Z] = level.size;
    this.x0 = -X - 2; this.z0 = -Z - 2;
    this.nx = Math.ceil((2 * X + 4) / CELL); this.nz = Math.ceil((2 * Z + 4) / CELL);
    const n = this.nx * this.nz;
    this.h = new Float32Array(n * LAYERS).fill(NaN);
    this.cost = new Float32Array(n * LAYERS).fill(1);
    const all = [...level.floors, ...level.boxes];
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const x = this.x0 + (i + 0.5) * CELL, z = this.z0 + (j + 0.5) * CELL;
      // candidate surfaces: every floor / box top over this cell, highest first
      const here = all.filter(b => Level.top(b, x, z) !== null);
      const tops = here.map(b => Level.top(b, x, z)!).sort((a, b) => b - a);
      const keep: number[] = [];
      for (const t of tops) {
        if (keep.some(k => Math.abs(k - t) < 0.3)) continue;
        // buried inside another box (a floor under a wall), or no room to stand under the next slab
        let ok = true;
        for (const b of here) {
          const y0 = b.y ?? 0, bt = Level.top(b, x, z)!;
          if (y0 < t + 0.05 && bt > t + 0.05) { ok = false; break; }        // a box rising from (or through) this surface
          if (y0 > t + 0.05 && y0 < t + HEADROOM) { ok = false; break; }
        }
        if (!ok) continue;
        for (const s of level.solids) if (Math.hypot(x - s.x, z - s.z) < s.r + 0.25 && s.y1 > t + STEP && s.y0 < t + HEADROOM) { ok = false; break; }
        if (!ok) continue;
        keep.push(t);
        if (keep.length >= LAYERS) break;
      }
      keep.sort((a, b) => a - b);
      const c = j * this.nx + i;
      keep.forEach((t, l) => { this.h[c * LAYERS + l] = t; });
    }
    // wall clearance: nodes next to a big step up (or a drop into the void) cost more
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) for (let l = 0; l < LAYERS; l++) {
      const k = (j * this.nx + i) * LAYERS + l, hk = this.h[k];
      if (isNaN(hk)) continue;
      let near = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.nz) { near = Math.max(near, 1); continue; }
        if (this.layerNear(jj * this.nx + ii, hk) < 0) near = Math.max(near, Math.abs(di) <= 1 && Math.abs(dj) <= 1 ? 2 : 1);
      }
      this.cost[k] = near === 2 ? 6 : near === 1 ? 2.2 : 1;
    }
    // jump pads: simulate the launch arc to find where it lands
    for (const p of level.pads) {
      const k = this.nodeAt(p.x, level.groundAt(p.x, p.z, (p.y ?? 0) + 1), p.z);
      if (k < 0) continue;
      let x = p.x, y = this.h[k], z = p.z, vy = p.vy;
      for (let s = 0; s < 400; s++) {
        const dt = 1 / 60; x += p.vx * dt; z += p.vz * dt; vy -= G * dt; y += vy * dt;
        if (vy < 0) { const g = level.groundAt(x, z, y); if (g > -Infinity && y <= g) break; }
        if (y < level.killY) { x = NaN; break; }
      }
      const land = Number.isFinite(x) ? this.nodeAt(x, y, z) : -1;
      if (land >= 0) {
        // the pad footprint launches you, so walking across it isn't a normal edge
        const c = (k / LAYERS) | 0, ci = c % this.nx, cj = (c / this.nx) | 0;
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
          const cc = (cj + dj) * this.nx + ci + di, nk = this.layerNear(cc, this.h[k]);
          if (nk >= 0) this.padLink.set(nk, land);
        }
      }
    }
  }

  /** the node of cell `c` at a surface within a step of height y (-1: none) */
  private layerNear(c: number, y: number, up = CLIMB, down = CLIMB) {
    if (c < 0 || c >= this.nx * this.nz) return -1;
    let best = -1, bd = Infinity;
    for (let l = 0; l < LAYERS; l++) {
      const hv = this.h[c * LAYERS + l];
      if (isNaN(hv) || hv - y > up || y - hv > down) continue;
      const d = Math.abs(hv - y);
      if (d < bd) { bd = d; best = c * LAYERS + l; }
    }
    return best;
  }
  /** the node under a world point (the surface closest to its height, within a storey) */
  nodeAt(x: number, y: number, z: number) { return this.layerNear(this.cellOf(x, z), y, 1.2, 2.5); }

  cellOf(x: number, z: number) {
    const i = Math.floor((x - this.x0) / CELL), j = Math.floor((z - this.z0) / CELL);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }
  center(k: number): V3 {
    const c = (k / LAYERS) | 0, i = c % this.nx, j = (c / this.nx) | 0;
    return { x: this.x0 + (i + 0.5) * CELL, y: this.h[k], z: this.z0 + (j + 0.5) * CELL };
  }
  walkable(k: number) { return k >= 0 && k < this.h.length && !isNaN(this.h[k]); }

  /** nearest walkable node to a point, preferring the height the point is at */
  nearest(p: V3, maxR = 8): number {
    const k0 = this.nodeAt(p.x, p.y, p.z);
    if (k0 >= 0 && !this.padLink.has(k0)) return k0;
    const c0 = this.cellOf(p.x, p.z);
    const i0 = c0 >= 0 ? c0 % this.nx : Math.max(0, Math.min(this.nx - 1, Math.floor((p.x - this.x0) / CELL)));
    const j0 = c0 >= 0 ? (c0 / this.nx) | 0 : Math.max(0, Math.min(this.nz - 1, Math.floor((p.z - this.z0) / CELL)));
    let best = -1, bd = Infinity;
    const R = Math.ceil(maxR / CELL);
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
      for (let l = 0; l < LAYERS; l++) {
        const k = (j * this.nx + i) * LAYERS + l;
        if (!this.walkable(k) || this.padLink.has(k)) continue;
        const d = di * di + dj * dj + Math.abs(this.h[k] - p.y) * 4;
        if (d < bd) { bd = d; best = k; }
      }
    }
    return best;
  }

  /** the node reached by stepping from node `a` into cell `c` (climb up to a step, drop down to DROP) */
  private stepInto(a: number, c: number) {
    const ha = this.h[a];
    // prefer staying on the same level; else the highest surface we can drop onto
    const same = this.layerNear(c, ha);
    if (same >= 0) return same;
    let best = -1, bh = -Infinity;
    for (let l = 0; l < LAYERS; l++) {
      const k = c * LAYERS + l, hb = this.h[k];
      if (isNaN(hb) || hb - ha > CLIMB || ha - hb > DROP) continue;
      if (hb > bh) { bh = hb; best = k; }
    }
    return best;
  }

  /** A*; returns world waypoints (node centres), or null */
  find(from: V3, to: V3, maxIter = 60000): V3[] | null {
    const s = this.nearest(from, 4), g = this.nearest(to, 8);
    if (s < 0 || g < 0) return null;
    if (s === g) return [this.center(g)];
    const n = this.h.length;
    const gs = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new Heap();
    const gc = this.center(g);
    const hf = (k: number) => { const c = this.center(k); return Math.hypot(c.x - gc.x, c.z - gc.z) + Math.abs(c.y - gc.y) * 0.5; };
    gs[s] = 0; heap.push(s, hf(s));
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let it = 0;
    while (heap.size && it++ < maxIter) {
      const k = heap.pop();
      if (k === g) break;
      if (closed[k]) continue;
      closed[k] = 1;
      const c = (k / LAYERS) | 0, i = c % this.nx, j = (c / this.nx) | 0;
      const pl = this.padLink.get(k);
      if (pl !== undefined && k !== s) {
        const c0 = this.center(k), c1 = this.center(pl);
        const ng = gs[k] + Math.hypot(c1.x - c0.x, c1.z - c0.z) * CELL * 0.6;
        if (ng < gs[pl]) { gs[pl] = ng; came[pl] = k; heap.push(pl, ng + hf(pl)); }
        continue;
      }
      for (const [di, dj, dc] of D) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.nz) continue;
        const nk = this.stepInto(k, jj * this.nx + ii);
        if (nk < 0 || closed[nk]) continue;
        // no corner cutting through a wall
        if (di && dj && (this.stepInto(k, j * this.nx + ii) < 0 || this.stepInto(k, jj * this.nx + i) < 0)) continue;
        const drop = Math.max(0, this.h[k] - this.h[nk]);
        const ng = gs[k] + dc * CELL * this.cost[nk] + (drop > CLIMB ? drop * 0.6 : 0);
        if (ng < gs[nk]) { gs[nk] = ng; came[nk] = k; heap.push(nk, ng + hf(nk)); }
      }
    }
    if (came[g] < 0) return null;
    const nodes: number[] = [];
    for (let k = g; k !== -1 && k !== s; k = came[k]) nodes.push(k);
    nodes.reverse();
    // string-pull: drop intermediate nodes while the straight line stays walkable on the same surfaces
    const out: V3[] = [];
    let cur = s;
    let idx = 0;
    while (idx < nodes.length) {
      let far = idx;
      if (!this.padLink.has(cur)) {
        for (let m = Math.min(nodes.length - 1, idx + 24); m > idx; m--) {
          if (this.padLink.has(nodes[m - 1]) && m - 1 >= idx) continue;
          if (this.straight(cur, nodes[m])) { far = m; break; }
        }
      }
      out.push(this.center(nodes[far]));
      cur = nodes[far]; idx = far + 1;
    }
    return out;
  }

  /** can you walk straight between two nodes without big steps (following the surfaces along the line)? */
  straight(a: number, b: number) {
    const ca = this.center(a), cb = this.center(b);
    const d = Math.hypot(cb.x - ca.x, cb.z - ca.z), n = Math.ceil(d / (CELL * 0.5));
    let prev = a;
    for (let s = 1; s <= n; s++) {
      const x = ca.x + (cb.x - ca.x) * s / n, z = ca.z + (cb.z - ca.z) * s / n;
      const c = this.cellOf(x, z);
      if (c !== ((prev / LAYERS) | 0)) {
        const k = c < 0 ? -1 : this.layerNear(c, this.h[prev]);
        if (k < 0 || this.padLink.has(k) || this.cost[k] > 5) return false;
        prev = k;
      }
    }
    return prev === b || Math.abs(this.h[prev] - this.h[b]) < CLIMB;
  }
}

class Heap {
  k: number[] = []; p: number[] = [];
  get size() { return this.k.length; }
  push(k: number, p: number) {
    this.k.push(k); this.p.push(p);
    let i = this.k.length - 1;
    while (i > 0) { const q = (i - 1) >> 1; if (this.p[q] <= this.p[i]) break; this.sw(i, q); i = q; }
  }
  pop() {
    const top = this.k[0], lk = this.k.pop()!, lp = this.p.pop()!;
    if (this.k.length) {
      this.k[0] = lk; this.p[0] = lp;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < this.k.length && this.p[l] < this.p[m]) m = l;
        if (r < this.k.length && this.p[r] < this.p[m]) m = r;
        if (m === i) break;
        this.sw(i, m); i = m;
      }
    }
    return top;
  }
  private sw(a: number, b: number) { [this.k[a], this.k[b]] = [this.k[b], this.k[a]]; [this.p[a], this.p[b]] = [this.p[b], this.p[a]]; }
}
