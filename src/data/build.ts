// Building kit for the maps, in the hero-shooter tradition (every building a place to fight in, on and around):
// storeys with real interiors, ground-floor doorways, upper-storey window openings you can shoot through, interior stair
// ramps up through stairwells, walkable flat roofs behind a low parapet or walkable gable roofs, and render-only trim -
// eaves, awnings, window frames and glowing panes. Everything is axis-aligned boxes (the collision the engine speaks).
//
// Walls are 0.6m thick so the 0.5m navigation grid always sees them (a thinner wall can slip between cell centres).
import type { Box, Mat } from './maps';

export type Side = 'x-' | 'x+' | 'z-' | 'z+';
export interface Opening { side: Side; at?: number; w?: number; level?: number; h?: number; }
export interface BuildingSpec {
  x: number; z: number; w: number; d: number;         // outer footprint (centre, size along X / Z)
  storeys?: number; storeyH?: number;                 // default 1 storey, 4.2m
  y?: number;                                         // base height (a building on a terrace)
  doors?: Opening[];                                  // doorways (level 0) and balcony openings (level >= 1): 2.9m tall
  windows?: Opening[];                                // window openings, sill 1m, head 2.6m, per storey
  roof?: 'flat' | 'gable-x' | 'gable-z';               // flat: walkable, parapet; gable: walkable slopes, ridge along X / Z
  stair?: Side;                                       // interior stair ramps rise toward this side (needed for storeys > 1 or a flat roof)
  mat?: Mat; roofMat?: Mat; trim?: Mat;
  awnings?: Side[];                                   // shop awnings over the ground floor
  atrium?: [number, number];                          // a double-height void (w, d) through the upper floors: a gallery ring around a hall
}
const T = 0.6;           // wall thickness
// doorways clear the frame mechs (3.3m) - every hero fits through every door, as in Overwatch
const DOOR_H = 3.4, SILL = 1.0, HEAD = 2.6;

/** 1D interval subtraction: the solid runs of [lo, hi] left after cutting the openings out */
function runs(lo: number, hi: number, cuts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let cur = lo;
  for (const [a, b] of [...cuts].sort((p, q) => p[0] - q[0])) {
    if (a > cur + 0.05) out.push([cur, Math.min(a, hi)]);
    cur = Math.max(cur, b);
  }
  if (hi > cur + 0.05) out.push([cur, hi]);
  return out;
}

/** a box on one side's wall line, from `u0` to `u1` along the wall, between heights y0 and y1 */
function wallBox(s: BuildingSpec, side: Side, u0: number, u1: number, y0: number, y1: number, mat: Mat): Box {
  const along = side[0] === 'x' ? 'z' : 'x';
  const cx = s.x, cz = s.z, hw = s.w / 2, hd = s.d / 2;
  const off = side === 'x-' ? cx - hw + T / 2 : side === 'x+' ? cx + hw - T / 2 : side === 'z-' ? cz - hd + T / 2 : cz + hd - T / 2;
  const mid = (u0 + u1) / 2, len = u1 - u0;
  return along === 'z'
    ? { x: off, z: cz + mid, w: T, d: len, h: y1 - y0, y: y0, mat }
    : { x: cx + mid, z: off, w: len, d: T, h: y1 - y0, y: y0, mat };
}

/** rectangle minus a hole, as up to four rectangles (x0, z0, x1, z1) */
function minus(r: [number, number, number, number], h: [number, number, number, number] | null): [number, number, number, number][] {
  if (!h) return [r];
  const [x0, z0, x1, z1] = r, [a0, b0, a1, b1] = h;
  const out: [number, number, number, number][] = [];
  if (b0 > z0) out.push([x0, z0, x1, b0]);
  if (b1 < z1) out.push([x0, b1, x1, z1]);
  if (a0 > x0) out.push([x0, Math.max(z0, b0), a0, Math.min(z1, b1)]);
  if (a1 < x1) out.push([a1, Math.max(z0, b0), x1, Math.min(z1, b1)]);
  return out.filter(([p, q, r2, s2]) => r2 - p > 0.1 && s2 - q > 0.1);
}

export function building(s: BuildingSpec): { boxes: Box[]; decor: Box[] } {
  const boxes: Box[] = [], decor: Box[] = [];
  const N = s.storeys ?? 1, H = s.storeyH ?? 4.2, base = s.y ?? 0, mat = s.mat ?? 'wall', trim = s.trim ?? 'trim';
  const roof = s.roof ?? 'flat', roofMat = s.roofMat ?? 'roof';
  const hw = s.w / 2, hd = s.d / 2;
  const sides: Side[] = ['x-', 'x+', 'z-', 'z+'];
  // ---- walls, storey by storey: solid runs, lintels over doors, sills and heads around windows
  for (let lv = 0; lv < N; lv++) {
    const y0 = base + lv * H, y1 = y0 + H;
    for (const side of sides) {
      const len = side[0] === 'x' ? s.d : s.w, lo = -len / 2, hi = len / 2;
      const dOpen = (s.doors ?? []).filter(o => o.side === side && (o.level ?? 0) === lv);
      const doors = dOpen.map(o => [(o.at ?? 0) - (o.w ?? 2.2) / 2, (o.at ?? 0) + (o.w ?? 2.2) / 2] as [number, number]);
      const wins = (s.windows ?? []).filter(o => o.side === side && (o.level ?? lv) === lv).map(o => [(o.at ?? 0) - (o.w ?? 1.6) / 2, (o.at ?? 0) + (o.w ?? 1.6) / 2] as [number, number]);
      for (const [a, b] of runs(lo, hi, [...doors, ...wins])) boxes.push(wallBox(s, side, a, b, y0, y1, mat));
      doors.forEach(([a, b], i) => {
        const dh = Math.min(H - 0.4, dOpen[i].h ?? DOOR_H);
        boxes.push(wallBox(s, side, a, b, y0 + dh, y1, mat));
        decor.push(...frame(s, side, a, b, y0, y0 + dh, trim, false));
      });
      for (const [a, b] of wins) {
        boxes.push(wallBox(s, side, a, b, y0, y0 + SILL, mat), wallBox(s, side, a, b, y0 + HEAD, y1, mat));
        decor.push(...frame(s, side, a, b, y0 + SILL, y0 + HEAD, trim, true));
      }
      // lit windows painted on the blank stretches of upper storeys (the buildings look lived-in, not hollow)
      if (lv > 0 || N === 1) for (const [a, b] of runs(lo + 0.8, hi - 0.8, [...doors, ...wins].map(([p, q]) => [p - 1.2, q + 1.2] as [number, number])))
        for (let u = a + 1.3; u + 0.6 < b; u += 3.2) decor.push(pane(s, side, u - 0.55, u + 0.55, y0 + 1.3, y0 + 2.6));
      // a trim band where the storeys meet (clear of the openings)
      if (lv > 0) for (const [a, b] of runs(lo, hi, doors)) decor.push(band(s, side, a, b, y0 - 0.15, y0 + 0.15, trim));
    }
  }
  // ---- floors inside (upper storeys and the flat roof) with a stairwell over each stair ramp
  const ix0 = s.x - hw + T, ix1 = s.x + hw - T, iz0 = s.z - hd + T, iz1 = s.z + hd - T;
  const flights = N - 1 + (roof === 'flat' ? 1 : 0);
  const stairW = 1.8, run = Math.min(H * 1.75, (s.stair && s.stair[0] === 'x' ? ix1 - ix0 : iz1 - iz0) - 2.2);
  for (let f = 1; f <= flights; f++) {
    const top = base + f * H;
    let hole: [number, number, number, number] | null = null;
    if (s.stair) {
      // the ramp hugs one wall (alternating walls per flight), rising toward s.stair; it ends at the hole's far edge
      const alt = f % 2 === 1;
      const st = s.stair, r = run;
      let bx: Box;
      if (st[0] === 'x') {
        const zc = alt ? iz0 + stairW / 2 : iz1 - stairW / 2;
        const x1 = st === 'x+' ? ix1 - 0.2 : ix0 + 0.2, x0 = st === 'x+' ? x1 - r : x1 + r;
        bx = { x: (x0 + x1) / 2, z: zc, w: r, d: stairW, h: H, y: top - H, mat: trim, ramp: st };
        // the hole opens over the ramp from 1.2m past its foot to its top (the foot is x0, the top x1)
        hole = st === 'x+' ? [x0 + 1.2, zc - stairW / 2, x1, zc + stairW / 2] : [x1, zc - stairW / 2, x0 - 1.2, zc + stairW / 2];
      } else {
        const xc = alt ? ix0 + stairW / 2 : ix1 - stairW / 2;
        const z1 = st === 'z+' ? iz1 - 0.2 : iz0 + 0.2, z0 = st === 'z+' ? z1 - r : z1 + r;
        bx = { x: xc, z: (z0 + z1) / 2, w: stairW, d: r, h: H, y: top - H, mat: trim, ramp: st };
        hole = st === 'z+' ? [xc - stairW / 2, z0 + 1.2, xc + stairW / 2, z1] : [xc - stairW / 2, z1, xc + stairW / 2, z0 - 1.2];
      }
      boxes.push(bx);
    }
    const slabMat: Mat = f === N ? roofMat : trim;
    let rects = minus([ix0, iz0, ix1, iz1], hole);
    // the atrium: upper floors are a gallery ring around a void (the roof stays whole)
    if (s.atrium && f < flights + (roof === 'flat' ? 0 : 1) && !(roof === 'flat' && f === flights)) {
      const [aw, ad] = s.atrium, at: [number, number, number, number] = [s.x - aw / 2, s.z - ad / 2, s.x + aw / 2, s.z + ad / 2];
      rects = rects.flatMap(r => minus(r, [Math.max(r[0], at[0]), Math.max(r[1], at[1]), Math.min(r[2], at[2]), Math.min(r[3], at[3])]).length && (at[0] < r[2] && at[2] > r[0] && at[1] < r[3] && at[3] > r[1]) ? minus(r, [Math.max(r[0], at[0]), Math.max(r[1], at[1]), Math.min(r[2], at[2]), Math.min(r[3], at[3])]) : [r]);
      // a waist-high rail around the drop (render + collision; hop it to drop into the hall)
      const ry = top, rh = 0.9;
      boxes.push({ x: s.x, z: at[1] - 0.15, w: aw + 0.3, d: 0.3, h: rh, y: ry, mat: trim }, { x: s.x, z: at[3] + 0.15, w: aw + 0.3, d: 0.3, h: rh, y: ry, mat: trim },
        { x: at[0] - 0.15, z: s.z, w: 0.3, d: ad, h: rh, y: ry, mat: trim }, { x: at[2] + 0.15, z: s.z, w: 0.3, d: ad, h: rh, y: ry, mat: trim });
    }
    for (const [x0, z0, x1, z1] of rects) boxes.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, h: 0.3, y: top - 0.3, mat: slabMat });
  }
  // ---- roof
  const top = base + N * H;
  if (roof === 'flat') {
    // walkable, a waist-high parapet (hop over it), wall tops capped
    for (const side of sides) {
      const len = side[0] === 'x' ? s.d : s.w;
      boxes.push(wallBox(s, side, -len / 2, len / 2, top, top + 1.0, trim));
    }
  } else {
    // gable: two walkable slopes over a solid attic, eaves overhanging the walls (decor)
    const ridge = Math.min(3, (roof === 'gable-x' ? s.d : s.w) * 0.32);
    if (roof === 'gable-x') {
      boxes.push({ x: s.x, z: s.z - hd / 2, w: s.w, d: hd, h: ridge, y: top, mat: roofMat, ramp: 'z+' }, { x: s.x, z: s.z + hd / 2, w: s.w, d: hd, h: ridge, y: top, mat: roofMat, ramp: 'z-' });
      decor.push({ x: s.x, z: s.z - hd / 2 - 0.35, w: s.w + 1.0, d: hd + 0.7, h: ridge + 0.25, y: top - 0.25, mat: roofMat, ramp: 'z+' }, { x: s.x, z: s.z + hd / 2 + 0.35, w: s.w + 1.0, d: hd + 0.7, h: ridge + 0.25, y: top - 0.25, mat: roofMat, ramp: 'z-' });
    } else {
      boxes.push({ x: s.x - hw / 2, z: s.z, w: hw, d: s.d, h: ridge, y: top, mat: roofMat, ramp: 'x+' }, { x: s.x + hw / 2, z: s.z, w: hw, d: s.d, h: ridge, y: top, mat: roofMat, ramp: 'x-' });
      decor.push({ x: s.x - hw / 2 - 0.35, z: s.z, w: hw + 0.7, d: s.d + 1.0, h: ridge + 0.25, y: top - 0.25, mat: roofMat, ramp: 'x+' }, { x: s.x + hw / 2 + 0.35, z: s.z, w: hw + 0.7, d: s.d + 1.0, h: ridge + 0.25, y: top - 0.25, mat: roofMat, ramp: 'x-' });
    }
  }
  // ---- base course (clear of the doorways) and awnings
  for (const side of sides) {
    const len = side[0] === 'x' ? s.d : s.w;
    const cuts = (s.doors ?? []).filter(o => o.side === side && !(o.level ?? 0)).map(o => [(o.at ?? 0) - (o.w ?? 2.2) / 2, (o.at ?? 0) + (o.w ?? 2.2) / 2] as [number, number]);
    for (const [a, b] of runs(-len / 2, len / 2, cuts)) decor.push(band(s, side, a, b, base, base + 0.35, trim));
  }
  for (const side of s.awnings ?? []) {
    const len = side[0] === 'x' ? s.d : s.w, out = 1.3;
    const aw: Box = side === 'x-' ? { x: s.x - hw - out / 2, z: s.z, w: out, d: len * 0.8, h: 0.14, y: base + 3.1 }
      : side === 'x+' ? { x: s.x + hw + out / 2, z: s.z, w: out, d: len * 0.8, h: 0.14, y: base + 3.1 }
        : side === 'z-' ? { x: s.x, z: s.z - hd - out / 2, w: len * 0.8, d: out, h: 0.14, y: base + 3.1 }
          : { x: s.x, z: s.z + hd + out / 2, w: len * 0.8, d: out, h: 0.14, y: base + 3.1 };
    decor.push({ ...aw, mat: 'accent' });
  }
  return { boxes, decor };
}

/** push a wall-line box a little proud of the wall faces (both sides) so trim reads over the wall */
function proud(b: Box, side: Side, k = 0.14): Box {
  if (side[0] === 'x') b.w += k; else b.d += k;
  return b;
}
/** a door / window surround (render only): two posts and a head, plus a sill under windows - the opening stays open */
function frame(s: BuildingSpec, side: Side, a: number, b: number, y0: number, y1: number, trim: Mat, sill: boolean): Box[] {
  const k = 0.2;
  const out = [proud(wallBox(s, side, a - k, a, y0, y1 + k, trim), side), proud(wallBox(s, side, b, b + k, y0, y1 + k, trim), side), proud(wallBox(s, side, a - k, b + k, y1, y1 + k, trim), side)];
  if (sill) out.push(proud(wallBox(s, side, a - k, b + k, y0 - 0.12, y0, trim), side, 0.3));
  return out;
}
/** a glowing window pane set just proud of a blank wall (render only) */
function pane(s: BuildingSpec, side: Side, a: number, b: number, y0: number, y1: number): Box {
  return proud(wallBox(s, side, a, b, y0, y1, 'window'), side, 0.06);
}
function band(s: BuildingSpec, side: Side, a: number, b: number, y0: number, y1: number, trim: Mat): Box {
  return proud(wallBox(s, side, a, b, y0, y1, trim), side, 0.12);
}

/**
 * Spawn room (Overwatch style): a closed hall at the team's end with two wide exits toward the fight, so one ability
 * can't seal the team in; heroes inside heal quickly (World) and choose their route out.
 */
export function spawnRoom(x: number, z: number, facing: 1 | -1, w = 12, d = 16, mat: Mat = 'wall'): { boxes: Box[]; decor: Box[] } {
  const side: Side = facing > 0 ? 'x+' : 'x-';
  return building({ x, z, w, d, storeys: 1, storeyH: 5.2, roof: 'flat', mat, doors: [{ side, at: -d * 0.28, w: 3.6, h: 4.6 }, { side, at: d * 0.28, w: 3.6, h: 4.6 }] });
}

/** lit window rows painted on a solid backdrop block (a city tower you can't enter still looks lived-in) */
export function facade(b: Box, storeyH = 4.2, sides: Side[] = ['x-', 'x+', 'z-', 'z+']): Box[] {
  const s: BuildingSpec = { x: b.x, z: b.z, w: b.w, d: b.d, y: b.y };
  const out: Box[] = [];
  const base = b.y ?? 0, rows = Math.floor(b.h / storeyH);
  for (const side of sides) {
    const len = side[0] === 'x' ? b.d : b.w;
    for (let r = 1; r < rows; r++) for (let u = -len / 2 + 1.6; u + 0.6 < len / 2 - 0.6; u += 3.2) out.push(pane(s, side, u - 0.55, u + 0.55, base + r * storeyH + 1.1, base + r * storeyH + 2.5));
  }
  return out;
}
