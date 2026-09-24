// 2.5D navigation grid (0.5m cells) built from the level: top-most walkable surface per cell,
// climb/drop limits, wall clearance cost, jump-pad links. A* with a binary heap.
import { Level, STEP, type V3 } from '../engine/Physics';
import { G } from '../game/World';

const CELL = 0.5;
const CLIMB = STEP + 0.05;
const DROP = 4.5;

export class Nav {
  nx: number; nz: number; x0: number; z0: number;
  h: Float32Array;          // surface height, NaN = void / blocked
  cost: Float32Array;
  padLink = new Map<number, number>();

  constructor(public level: Level) {
    const [X, Z] = level.size;
    this.x0 = -X - 2; this.z0 = -Z - 2;
    this.nx = Math.ceil((2 * X + 4) / CELL); this.nz = Math.ceil((2 * Z + 4) / CELL);
    const n = this.nx * this.nz;
    this.h = new Float32Array(n).fill(NaN);
    this.cost = new Float32Array(n).fill(1);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const x = this.x0 + (i + 0.5) * CELL, z = this.z0 + (j + 0.5) * CELL;
      let top = -Infinity, hasFloor = false;
      for (const f of level.floors) { const t = Level.top(f, x, z); if (t !== null) { hasFloor = true; top = Math.max(top, t); } }
      for (const b of level.boxes) { const t = Level.top(b, x, z); if (t !== null) { hasFloor = true; top = Math.max(top, t); } }
      if (!hasFloor) continue;
      let blocked = false;
      for (const s of level.solids) if (Math.hypot(x - s.x, z - s.z) < s.r + 0.25 && s.y1 > top + STEP) blocked = true;
      if (!blocked) this.h[j * this.nx + i] = top;
    }
    // wall clearance: cells next to a big step up (or a drop into the void) cost more
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const k = j * this.nx + i, hk = this.h[k];
      if (isNaN(hk)) continue;
      let near = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.nz) { near = Math.max(near, 1); continue; }
        const hn = this.h[jj * this.nx + ii];
        if (isNaN(hn) || hn - hk > CLIMB) near = Math.max(near, Math.abs(di) <= 1 && Math.abs(dj) <= 1 ? 2 : 1);
      }
      this.cost[k] = near === 2 ? 6 : near === 1 ? 2.2 : 1;
    }
    // jump pads: simulate the launch arc to find where it lands
    for (const p of level.pads) {
      const k = this.cellOf(p.x, p.z);
      if (k < 0 || isNaN(this.h[k])) continue;
      let x = p.x, y = this.h[k], z = p.z, vy = p.vy;
      for (let s = 0; s < 400; s++) {
        const dt = 1 / 60; x += p.vx * dt; z += p.vz * dt; vy -= G * dt; y += vy * dt;
        if (vy < 0) { const g = level.groundAt(x, z, y); if (g > -Infinity && y <= g) break; }
        if (y < level.killY) { x = NaN; break; }
      }
      const land = this.cellOf(x, z);
      if (land >= 0 && !isNaN(this.h[land])) {
        // the 3x3 pad footprint launches you, so walking across it isn't a normal edge
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) this.padLink.set(k + dj * this.nx + di, land);
      }
    }
  }

  cellOf(x: number, z: number) {
    const i = Math.floor((x - this.x0) / CELL), j = Math.floor((z - this.z0) / CELL);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }
  center(k: number): V3 {
    const i = k % this.nx, j = (k / this.nx) | 0;
    return { x: this.x0 + (i + 0.5) * CELL, y: this.h[k], z: this.z0 + (j + 0.5) * CELL };
  }
  walkable(k: number) { return k >= 0 && !isNaN(this.h[k]); }

  /** nearest walkable cell to a point, preferring the height the point is at */
  nearest(p: V3, maxR = 8): number {
    const k0 = this.cellOf(p.x, p.z);
    if (this.walkable(k0) && Math.abs(this.h[k0] - p.y) < 2.5) return k0;
    const i0 = k0 % this.nx, j0 = (k0 / this.nx) | 0;
    let best = -1, bd = Infinity;
    const R = Math.ceil(maxR / CELL);
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
      const k = j * this.nx + i;
      if (!this.walkable(k) || this.padLink.has(k)) continue;
      const d = di * di + dj * dj + Math.abs(this.h[k] - p.y) * 4;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  private step(a: number, b: number) {
    const ha = this.h[a], hb = this.h[b];
    if (isNaN(hb)) return false;
    return hb - ha <= CLIMB && ha - hb <= DROP;
  }

  /** A*; returns world waypoints (cell centres), or null */
  find(from: V3, to: V3, maxIter = 40000): V3[] | null {
    const s = this.nearest(from, 4), g = this.nearest(to, 8);
    if (s < 0 || g < 0) return null;
    if (s === g) return [this.center(g)];
    const n = this.nx * this.nz;
    const gs = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new Heap();
    const gc = this.center(g);
    const hf = (k: number) => { const c = this.center(k); return Math.hypot(c.x - gc.x, c.z - gc.z); };
    gs[s] = 0; heap.push(s, hf(s));
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let it = 0;
    while (heap.size && it++ < maxIter) {
      const k = heap.pop();
      if (k === g) break;
      if (closed[k]) continue;
      closed[k] = 1;
      const i = k % this.nx, j = (k / this.nx) | 0;
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
        const nk = jj * this.nx + ii;
        if (closed[nk] || !this.step(k, nk)) continue;
        if (di && dj && (!this.step(k, j * this.nx + ii) || !this.step(k, jj * this.nx + i))) continue;
        const ng = gs[k] + dc * CELL * this.cost[nk];
        if (ng < gs[nk]) { gs[nk] = ng; came[nk] = k; heap.push(nk, ng + hf(nk)); }
      }
    }
    if (came[g] < 0) return null;
    const cells: number[] = [];
    for (let k = g; k !== -1 && k !== s; k = came[k]) cells.push(k);
    cells.reverse();
    // string-pull: drop intermediate cells while the straight line stays walkable
    const out: V3[] = [];
    let cur = s;
    let idx = 0;
    while (idx < cells.length) {
      let far = idx;
      if (!this.padLink.has(cur)) {
        for (let m = Math.min(cells.length - 1, idx + 24); m > idx; m--) {
          if (this.padLink.has(cells[m - 1]) && m - 1 >= idx) continue;
          if (this.straight(cur, cells[m])) { far = m; break; }
        }
      }
      out.push(this.center(cells[far]));
      cur = cells[far]; idx = far + 1;
    }
    return out;
  }

  /** can you walk straight between two cells without big steps? */
  straight(a: number, b: number) {
    const ca = this.center(a), cb = this.center(b);
    const d = Math.hypot(cb.x - ca.x, cb.z - ca.z), n = Math.ceil(d / (CELL * 0.5));
    let prev = a;
    for (let s = 1; s <= n; s++) {
      const x = ca.x + (cb.x - ca.x) * s / n, z = ca.z + (cb.z - ca.z) * s / n;
      const k = this.cellOf(x, z);
      if (k !== prev) {
        if (!this.walkable(k) || this.padLink.has(k) || !this.step(prev, k) || this.cost[k] > 5) return false;
        prev = k;
      }
    }
    return true;
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
