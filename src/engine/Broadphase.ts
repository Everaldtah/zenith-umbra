// Uniform-grid broadphase over the level's static geometry (engine core). Every Level query used to walk every box of
// the map - groundAt and collide per hero per 120 Hz step, a ray per bot sight check, camera pull-in, hitscan,
// ragdoll bone - so their cost grew with map detail. Items are binned by their XZ footprint into square cells; a query
// visits only the cells it touches. Results come back as item indices in ascending order, so callers can run their
// original loop over the candidates in the original order and get bit-identical answers (ties, sequential pushes).

const EMPTY = new Int32Array(0);

export class GridIndex {
  private x0 = 0; private z0 = 0; private inv = 1; private nx = 0; private nz = 0;
  private cells: Int32Array[] = [];
  private stamp: Uint32Array;
  private q = 0;
  readonly count: number;

  /** @param bounds item i's XZ footprint [minX, minZ, maxX, maxZ] */
  constructor(count: number, bounds: (i: number) => [number, number, number, number], private cell = 6) {
    this.count = count;
    this.stamp = new Uint32Array(count);
    if (!count) return;
    let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity;
    const bb: [number, number, number, number][] = [];
    for (let i = 0; i < count; i++) {
      // a hair of padding: a point exactly on a footprint's edge (or a ray through a cell corner) still finds it
      const [x0, z0, x1, z1] = bounds(i), e = 1e-3;
      bb.push([x0 - e, z0 - e, x1 + e, z1 + e]);
      ax = Math.min(ax, x0 - e); az = Math.min(az, z0 - e); bx = Math.max(bx, x1 + e); bz = Math.max(bz, z1 + e);
    }
    this.inv = 1 / cell;
    this.x0 = ax; this.z0 = az;
    this.nx = Math.max(1, Math.ceil((bx - ax) * this.inv));
    this.nz = Math.max(1, Math.ceil((bz - az) * this.inv));
    const lists: number[][] = Array.from({ length: this.nx * this.nz }, () => []);
    for (let i = 0; i < count; i++) {
      const [x0, z0, x1, z1] = bb[i];
      const cx0 = this.cx(x0), cx1 = this.cx(x1), cz0 = this.cz(z0), cz1 = this.cz(z1);
      for (let z = cz0; z <= cz1; z++) for (let x = cx0; x <= cx1; x++) lists[z * this.nx + x].push(i);   // ascending i
    }
    this.cells = lists.map(l => (l.length ? Int32Array.from(l) : EMPTY));
  }

  private cx(x: number) { return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.x0) * this.inv))); }
  private cz(z: number) { return Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.z0) * this.inv))); }
  private inside(x: number, z: number) { return x >= this.x0 && z >= this.z0 && x <= this.x0 + this.nx * this.cell && z <= this.z0 + this.nz * this.cell; }

  /** items whose cell holds the point (ascending; empty outside the grid) */
  at(x: number, z: number): Int32Array {
    if (!this.count || !this.inside(x, z)) return EMPTY;
    return this.cells[this.cz(z) * this.nx + this.cx(x)];
  }

  /** items in the cells a rectangle overlaps (deduplicated, ascending) */
  rect(x0: number, z0: number, x1: number, z1: number, out: number[]): number[] {
    out.length = 0;
    if (!this.count || x1 < this.x0 || z1 < this.z0 || x0 > this.x0 + this.nx * this.cell || z0 > this.z0 + this.nz * this.cell) return out;
    const s = this.next();
    const cx0 = this.cx(x0), cx1 = this.cx(x1), cz0 = this.cz(z0), cz1 = this.cz(z1);
    for (let z = cz0; z <= cz1; z++) for (let x = cx0; x <= cx1; x++) this.take(this.cells[z * this.nx + x], s, out);
    if (cx1 > cx0 || cz1 > cz0) out.sort(byNum);
    return out;
  }

  /** items in the cells the segment o + d*t, t in [0, max], passes over in XZ (deduplicated, ascending) */
  segment(ox: number, oz: number, dx: number, dz: number, max: number, out: number[]): number[] {
    out.length = 0;
    if (!this.count) return out;
    const s = this.next();
    const W = this.nx * this.cell, H = this.nz * this.cell;
    // clip the segment to the grid rectangle
    _span[0] = 0; _span[1] = max;
    if (!clip(ox, dx, this.x0, this.x0 + W) || !clip(oz, dz, this.z0, this.z0 + H)) return out;
    const t0 = _span[0], t1 = _span[1];
    // Amanatides & Woo grid walk from the entry point
    const px = ox + dx * t0, pz = oz + dz * t0;
    let x = this.cx(px), z = this.cz(pz);
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const ddx = Math.abs(dx) < 1e-12 ? Infinity : this.cell / Math.abs(dx);
    const ddz = Math.abs(dz) < 1e-12 ? Infinity : this.cell / Math.abs(dz);
    const bxn = this.x0 + (x + (sx > 0 ? 1 : 0)) * this.cell, bzn = this.z0 + (z + (sz > 0 ? 1 : 0)) * this.cell;
    let tx = ddx === Infinity ? Infinity : t0 + (bxn - px) / dx;
    let tz = ddz === Infinity ? Infinity : t0 + (bzn - pz) / dz;
    for (let guard = 0; guard < this.nx + this.nz + 2; guard++) {
      this.take(this.cells[z * this.nx + x], s, out);
      if (tx <= tz) { if (tx > t1) break; x += sx; tx += ddx; } else { if (tz > t1) break; z += sz; tz += ddz; }
      if (x < 0 || z < 0 || x >= this.nx || z >= this.nz) break;
    }
    out.sort(byNum);
    return out;
  }

  private next() { if (++this.q === 0xffffffff) { this.stamp.fill(0); this.q = 1; } return this.q; }
  private take(list: Int32Array, s: number, out: number[]) {
    for (let k = 0; k < list.length; k++) { const i = list[k]; if (this.stamp[i] !== s) { this.stamp[i] = s; out.push(i); } }
  }
}

const byNum = (a: number, b: number) => a - b;
const _span = new Float64Array(2);
/** narrow _span (t range) to where o + d*t lies within [lo, hi]; false when it empties */
function clip(o: number, d: number, lo: number, hi: number) {
  if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
  let a = (lo - o) / d, b = (hi - o) / d;
  if (a > b) { const t = a; a = b; b = t; }
  if (a > _span[0]) _span[0] = a;
  if (b < _span[1]) _span[1] = b;
  return _span[0] <= _span[1];
}
