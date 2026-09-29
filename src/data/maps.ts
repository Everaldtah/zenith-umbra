import { building, spawnRoom, facade } from './build';
import { LITE_MAP, LITE_MAPS } from './maps_lite';

// Map layouts. Coordinates in metres: X is the long axis (Zenith spawn at -X, Umbra at +X), Z across, Y up.
// Each map lists half of its geometry; `mirror` adds the 180-degree rotated copy so both teams get the same map.

export type Mat = 'wall' | 'trim' | 'ground' | 'glass' | 'accent' | 'roof' | 'window' | 'wood';
export interface Box { x: number; z: number; w: number; d: number; h: number; y?: number; mat?: Mat; ramp?: 'x+' | 'x-' | 'z+' | 'z-'; }
export interface Prop { id: string; x: number; z: number; y?: number; rot?: number; s?: number; solid?: number; }
export interface Pad { x: number; z: number; y?: number; vx: number; vy: number; vz: number; }
/** health pack: small 75 HP (back in 10s) or large 250 HP (back in 15s); y = the surface it sits on (default: ground) */
export interface Pack { x: number; z: number; y?: number; big?: boolean; }

export interface MapDef {
  id: string;
  name: string;
  story: string;
  heroes: string[];            // whose backstory the map belongs to
  size: [number, number];      // half extents X, Z
  floors: Box[];               // walkable slabs; anywhere without a floor is a fatal fall
  boxes: Box[];
  props: Prop[];
  pads: Pad[];
  spawns: { zenith: [number, number]; umbra: [number, number] };
  point: [number, number, number];   // capture point x, y, z
  sun: { color: string; intensity: number; dir: [number, number, number] };
  ambient: [string, string, number];  // sky colour, ground colour, intensity
  fog: [string, number, number];
  tint: string;                // accent light colour
  particles: 'petals' | 'rain' | 'sparks' | 'embers' | 'motes' | 'none';
  killY: number;
  decor?: Box[];               // render-only detail: trim, frames, awnings, lit window panes (no collision)
  packs?: Pack[];              // health packs
  /** objective: 'control' (the capture point, best of 3 rounds) or 'push' (escort the float along `path`) */
  objective?: 'control' | 'push';
  path?: [number, number][];   // push: the float's route from the Zenith end (-X) to the Umbra end (+X), centre = start
  full?: boolean;              // desktop edition only
  retired?: boolean;           // kept for the engine cut / lite parity, off the desktop playlist (not Overwatch-shaped)
  water?: number;              // a water surface at this height (harbours): render only, killY sits below it
  bloom?: [number, number];    // bloom [threshold, strength] override (pale stone maps glare at the night default)
}

function mirror(list: Box[]): Box[] {
  const flip: Record<string, Box['ramp']> = { 'x+': 'x-', 'x-': 'x+', 'z+': 'z-', 'z-': 'z+' };
  return [...list, ...list.filter(b => b.x !== 0 || b.z !== 0).map(b => ({ ...b, x: -b.x, z: -b.z, ramp: b.ramp ? flip[b.ramp] : undefined }))];
}
function mirrorProps(list: Prop[]): Prop[] {
  return [...list, ...list.filter(p => p.x !== 0 || p.z !== 0).map(p => ({ ...p, x: -p.x, z: -p.z, rot: (p.rot ?? 0) + Math.PI }))];
}
function mirrorPads(list: Pad[]): Pad[] {
  return [...list, ...list.map(p => ({ ...p, x: -p.x, z: -p.z, vx: -p.vx, vz: -p.vz }))];
}
function mirrorPacks(list: Pack[]): Pack[] {
  return [...list, ...list.filter(p => p.x !== 0 || p.z !== 0).map(p => ({ ...p, x: -p.x, z: -p.z }))];
}
/** merge building-kit output (boxes + decor) into lists */
function kit(...parts: { boxes: Box[]; decor: Box[] }[]) { return { boxes: parts.flatMap(p => p.boxes), decor: parts.flatMap(p => p.decor) }; }
const border = (X: number, Z: number, h = 8): Box[] => [
  { x: 0, z: -Z - 0.5, w: 2 * X + 2, d: 1, h }, { x: 0, z: Z + 0.5, w: 2 * X + 2, d: 1, h },
  { x: -X - 0.5, z: 0, w: 1, d: 2 * Z, h }, { x: X + 0.5, z: 0, w: 1, d: 2 * Z, h },
];

/** a map half built from kit parts (and plain boxes), rotated into the other team's half */
function half(parts: { boxes: Box[]; decor: Box[] }[], extra: Box[] = [], extraDecor: Box[] = []) {
  const k = kit(...parts);
  return { boxes: mirror([...extra, ...k.boxes]), decor: mirror([...extraDecor, ...k.decor]) };
}

// ================================================================ the desktop edition's arenas
// Overwatch-style level design on every map: a main lane, flank routes (alleys, interiors, bridges), high ground with
// more than one way up (upper floors, roofs, terraces), cover that breaks the long sightlines, two-door spawn rooms, and
// health packs where the fighting is - inside buildings, on the high ground, along the flanks.

const AMATSU = (() => {
  // the prayer hall on the ring island: a second-floor gallery overlooking the shrine, doors on three sides
  const hall = building({ x: -18, z: 9, w: 8, d: 10, storeys: 2, storeyH: 4, doors: [{ side: 'x-', at: 0 }, { side: 'x+', at: -2.5 }, { side: 'z-', at: 1 }],
    windows: [{ side: 'x+', at: 2, level: 1 }, { side: 'z-', at: -2, level: 1 }, { side: 'x-', at: 2.5, level: 1 }], roof: 'gable-x', stair: 'z+' });
  return half([hall, spawnRoom(-46, 0, 1, 9, 14)], [
    { x: 0, z: 0, w: 12, d: 12, h: 1.4, mat: 'trim' },
    { x: -7.5, z: 0, w: 3, d: 5, h: 1.4, mat: 'trim', ramp: 'x+' },
    { x: -8, z: -9, w: 6, d: 1, h: 3, mat: 'wall' }, { x: -8, z: 9, w: 6, d: 1, h: 3, mat: 'wall' },
    { x: -18, z: -6, w: 4, d: 4, h: 2.2, mat: 'wall' },
    { x: -18, z: -12, w: 6, d: 3, h: 3.5, mat: 'wall' }, { x: -13, z: -12, w: 4, d: 3, h: 3.5, mat: 'wall', ramp: 'x-' },
    { x: -40, z: -7.5, w: 2, d: 2, h: 3, mat: 'accent' }, { x: -40, z: 7.5, w: 2, d: 2, h: 3, mat: 'accent' },
    { x: -10, z: 0, w: 1, d: 3, h: 1.2, mat: 'wall' },
  ]);
})();

const KUROGANE = (() => {
  // the arcade (two storeys, a walkable roof), a three-storey tower (a sniper's nest with more than one way up)
  const arcade = building({ x: -30, z: 18, w: 14, d: 13, storeys: 2, storeyH: 4.4, doors: [{ side: 'z-', at: -3 }, { side: 'z-', at: 3.5 }, { side: 'x+', at: -1.5 }, { side: 'x-', at: 1 }],
    windows: [{ side: 'z-', at: 0, level: 1, w: 2.6 }, { side: 'x+', at: 2, level: 1 }, { side: 'x-', at: -3, level: 1 }], roof: 'flat', stair: 'x+', awnings: ['z-'] });
  const tower = building({ x: -12, z: -20, w: 10, d: 11, storeys: 3, storeyH: 4.2, doors: [{ side: 'z+', at: 0 }, { side: 'x+', at: -2 }, { side: 'x-', at: 2 }],
    windows: [{ side: 'z+', at: -2, level: 1 }, { side: 'z+', at: 2, level: 2 }, { side: 'x+', at: 2, level: 2 }, { side: 'x-', at: -2, level: 1 }], roof: 'flat', stair: 'x-' });
  const blockA: Box = { x: -30, z: -18, w: 14, d: 14, h: 12, mat: 'wall' }, blockB: Box = { x: -12, z: 19, w: 10, d: 14, h: 9, mat: 'wall' };
  return half([arcade, tower, spawnRoom(-45, 0, 1, 8, 14)], [
    blockA, blockB,
    { x: 0, z: 0, w: 30, d: 5, h: 4, y: 0, mat: 'trim' },
    { x: -18, z: 0, w: 6, d: 4, h: 4, mat: 'trim', ramp: 'x+' },
    { x: -22, z: -6, w: 3, d: 3, h: 1.2, mat: 'accent' }, { x: -22, z: 6, w: 3, d: 3, h: 1.2, mat: 'accent' },
    { x: -40, z: -10, w: 4, d: 1, h: 2, mat: 'wall' }, { x: -40, z: 10, w: 4, d: 1, h: 2, mat: 'wall' },
    { x: -6, z: -9, w: 1, d: 5, h: 1.6, mat: 'glass' },
  ], [...facade(blockA), ...facade(blockB, 4.5)]);
})();

const HANGAR = (() => {
  // the control office: a glass-fronted upper floor over the assembly bay, a walkable roof
  const office = building({ x: -22, z: 14, w: 11, d: 8, storeys: 2, storeyH: 4, doors: [{ side: 'z-', at: -2.5 }, { side: 'x+', at: 1 }, { side: 'x-', at: -1 }],
    windows: [{ side: 'z-', at: 2, level: 1, w: 3.2 }, { side: 'x+', at: -1.5, level: 1, w: 2.4 }], roof: 'flat', stair: 'x-' });
  return half([office, spawnRoom(-43, 0, 1, 8, 14)], [
    { x: -20, z: -20, w: 30, d: 4, h: 4, mat: 'trim' },
    { x: -33, z: -15, w: 4, d: 6, h: 4, mat: 'trim', ramp: 'z-' },
    { x: -26, z: -4, w: 3, d: 3, h: 2, mat: 'accent' }, { x: -26, z: 4, w: 3, d: 3, h: 2, mat: 'accent' },
    { x: -14, z: -9, w: 6, d: 2, h: 3, mat: 'wall' }, { x: -14, z: 9, w: 2, d: 6, h: 3, mat: 'wall' },
    { x: -8, z: 0, w: 2, d: 5, h: 1.3, mat: 'wall' },
    { x: -38, z: 8.5, w: 6, d: 2, h: 2.5, mat: 'wall' },
  ]);
})();

const CATHEDRAL = (() => {
  // the bell house: a gallery over the graveyard flank, doors to the nave and the yard
  const bell = building({ x: -30, z: 16, w: 10, d: 9, storeys: 2, storeyH: 4.2, doors: [{ side: 'x+', at: -2 }, { side: 'z-', at: 2 }, { side: 'x-', at: 0 }],
    windows: [{ side: 'x+', at: 2, level: 1 }, { side: 'z-', at: -2, level: 1 }, { side: 'z+', at: 0, level: 1 }], roof: 'gable-z', stair: 'x-' });
  return half([bell, spawnRoom(-45, 0, 1, 8, 14)], [
    { x: -10, z: -8, w: 20, d: 1.2, h: 9, mat: 'wall' },
    { x: -10, z: 8, w: 12, d: 1.2, h: 9, mat: 'wall' },
    { x: 0, z: 0, w: 8, d: 8, h: 1.8, mat: 'trim' },
    { x: -5, z: 0, w: 2, d: 4, h: 1.8, mat: 'trim', ramp: 'x+' },
    { x: -28, z: -14, w: 8, d: 8, h: 5, mat: 'wall' }, { x: -21, z: -14, w: 6, d: 4, h: 5, mat: 'wall', ramp: 'x-' },
    { x: -40, z: -7.5, w: 2, d: 2, h: 3, mat: 'accent' }, { x: -40, z: 7.5, w: 2, d: 2, h: 3, mat: 'accent' },
  ]);
})();

const RIFT = (() => {
  // the ruined observatory: a hatch up to its roof, a doorway toward the centre
  const obs = building({ x: -30, z: 12, w: 8, d: 7, storeys: 1, storeyH: 4, doors: [{ side: 'x+', at: 0 }, { side: 'z-', at: -1.5 }],
    windows: [{ side: 'x-', at: 0 }, { side: 'z+', at: 1 }], roof: 'flat', stair: 'z+' });
  return half([obs, spawnRoom(-47, 0, 1, 8, 12)], [
    { x: 0, z: 0, w: 10, d: 10, h: 2, mat: 'trim' },
    { x: -6, z: 0, w: 2, d: 4, h: 2, mat: 'trim', ramp: 'x+' },
    { x: -8, z: -10, w: 3, d: 6, h: 3.5, mat: 'wall' }, { x: -8, z: 10, w: 3, d: 3, h: 2.2, mat: 'wall' },
    { x: -30, z: -14, w: 4, d: 3, h: 2.5, mat: 'wall' },
    { x: -46, z: -8.5, w: 3, d: 2, h: 2, mat: 'wall' },
  ]);
})();

// ---------------------------------------------------------------- new: Hanabi Harbor (Control)
const HANABI = (() => {
  const row = building({ x: -36, z: 22, w: 16, d: 9, storeys: 2, storeyH: 4.2, doors: [{ side: 'z-', at: -4 }, { side: 'z-', at: 4 }, { side: 'x+', at: 0 }],
    windows: [{ side: 'z-', at: 0, level: 1, w: 2.6 }, { side: 'x+', at: 2, level: 1 }], roof: 'gable-x', stair: 'x-', awnings: ['z-'] });
  const inn = building({ x: -16, z: 18, w: 10, d: 10, storeys: 2, storeyH: 4.2, doors: [{ side: 'z-', at: 0 }, { side: 'x-', at: 2 }, { side: 'x+', at: -2.5 }],
    windows: [{ side: 'x+', at: 2, level: 1, w: 2.4 }, { side: 'z-', at: -2.5, level: 1 }], roof: 'flat', stair: 'z+', awnings: ['z-'] });
  const market = building({ x: -34, z: -8, w: 14, d: 9, storeys: 1, storeyH: 5, doors: [{ side: 'x+', at: 0, w: 4 }, { side: 'x-', at: 1.5, w: 3 }, { side: 'z-', at: -3, w: 3 }, { side: 'z+', at: 3, w: 3 }],
    windows: [{ side: 'z+', at: -3 }], roof: 'gable-z', mat: 'wood' });
  const shop = building({ x: -14, z: -12, w: 7, d: 7, storeys: 1, storeyH: 4, doors: [{ side: 'x+', at: 0 }, { side: 'z+', at: -1.5 }], windows: [{ side: 'x-', at: 0 }], roof: 'gable-x' });
  return half([row, inn, market, shop, spawnRoom(-54, 6, 1, 10, 16)], [
    { x: -7.5, z: 0, w: 3, d: 5, h: 1.2, mat: 'wood', ramp: 'x+' },
    { x: -24, z: 4, w: 1, d: 6, h: 1.3, mat: 'trim' },
    { x: -8, z: 10, w: 2, d: 2, h: 1.6, mat: 'wood' }, { x: -44, z: -2, w: 2.5, d: 2.5, h: 1.4, mat: 'wood' },
    { x: -40, z: -17.5, w: 20, d: 1, h: 0.9, mat: 'trim' },
    { x: -6.5, z: 8.5, w: 0.6, d: 0.6, h: 3.5, mat: 'accent' }, { x: -9, z: -7.5, w: 0.6, d: 0.6, h: 3.5, mat: 'accent' },
  ]);
})();

// ---------------------------------------------------------------- new: Cloudstep Terraces (Control)
const CLOUDSTEP = (() => {
  const tea = building({ x: -17.5, z: 14, y: 6, w: 7, d: 7, storeys: 1, storeyH: 4, doors: [{ side: 'z-', at: 0 }, { side: 'x+', at: -1 }], windows: [{ side: 'x+', at: 1.8 }, { side: 'z+', at: 0 }], roof: 'gable-x' });
  const station = building({ x: -44, z: -13, w: 10, d: 8, storeys: 2, storeyH: 4, doors: [{ side: 'x+', at: -2 }, { side: 'z+', at: 2 }],
    windows: [{ side: 'x+', at: 2, level: 1 }, { side: 'z+', at: -2, level: 1 }], roof: 'flat', stair: 'x-' });
  return half([tea, station, spawnRoom(-51, 0, 1, 8, 14)], [
    // terraces: a mid terrace (3m) up from the spawn street, the teahouse terrace (6m) above it, a long stair down to the square
    { x: -30, z: 9, w: 14, d: 14, h: 3, mat: 'wall' },
    { x: -38.5, z: 13, w: 3, d: 4, h: 3, mat: 'trim', ramp: 'x+' },
    { x: -27, z: 0.5, w: 4, d: 3, h: 3, mat: 'trim', ramp: 'z+' },
    { x: -17, z: 12, w: 12, d: 14, h: 6, mat: 'wall' },
    { x: -26, z: 8, w: 6, d: 3, y: 3, h: 3, mat: 'trim', ramp: 'x+' },
    { x: -8, z: 14, w: 6, d: 3, h: 6, mat: 'trim', ramp: 'x-' },
    // the market square (the point) and its steps
    { x: -8.5, z: 0, w: 3, d: 5, h: 1, mat: 'trim', ramp: 'x+' },
    // stone walls and planters breaking the sightlines across the square
    { x: -12, z: -6, w: 1, d: 5, h: 1.5, mat: 'wall' }, { x: -22, z: -10, w: 5, d: 1, h: 1.4, mat: 'wall' }, { x: -6, z: -12, w: 3, d: 3, h: 1.1, mat: 'trim' },
  ]);
})();

// ---------------------------------------------------------------- new: Kagura Avenue (Mikoshi Rush)
const KAGURA = (() => {
  const B = (x: number, z: number, o: Partial<Parameters<typeof building>[0]>) => building({ x, z, w: 12, d: 10, storeys: 2, storeyH: 4.2, roof: 'flat', ...o });
  const n1 = B(-55, 15, { doors: [{ side: 'z-', at: -2 }, { side: 'z+', at: 2 }, { side: 'x+', at: 0 }], windows: [{ side: 'z-', at: 2.5, level: 1 }, { side: 'x+', at: -2, level: 1 }], stair: 'x-', awnings: ['z-'] });
  const n2 = B(-35, 15, { w: 16, storeys: 3, storeyH: 4, doors: [{ side: 'z-', at: -4 }, { side: 'z-', at: 4 }, { side: 'z+', at: 0 }, { side: 'x-', at: 0 }],
    windows: [{ side: 'z-', at: 0, level: 1, w: 2.6 }, { side: 'z-', at: -4, level: 2 }, { side: 'z-', at: 4, level: 2 }, { side: 'x+', at: 2, level: 1 }], stair: 'x+', awnings: ['z-'] });
  const n3 = B(-14, 15, { doors: [{ side: 'z-', at: 0 }, { side: 'x+', at: 1 }, { side: 'x-', at: -2 }], windows: [{ side: 'z-', at: -3, level: 1 }, { side: 'z-', at: 3, level: 1 }], roof: 'gable-x', stair: 'x-', awnings: ['z-'] });
  const s1 = B(-47, -15, { doors: [{ side: 'z+', at: 0 }, { side: 'z-', at: 2 }, { side: 'x-', at: 0 }], windows: [{ side: 'z+', at: -3, level: 1 }, { side: 'z+', at: 3, level: 1 }], roof: 'gable-x', stair: 'x+', awnings: ['z+'] });
  const s2 = B(-27, -15, { w: 14, doors: [{ side: 'z+', at: -3 }, { side: 'z+', at: 3 }, { side: 'x-', at: 0 }, { side: 'x+', at: -2 }], windows: [{ side: 'z+', at: 0, level: 1, w: 2.6 }, { side: 'x+', at: 2, level: 1 }], stair: 'x+', awnings: ['z+'] });
  const s3 = B(-8, -15, { w: 10, storeys: 1, storeyH: 5, doors: [{ side: 'z+', at: 0 }, { side: 'x+', at: 1 }, { side: 'x-', at: -1 }], windows: [{ side: 'z-', at: 0 }], roof: 'gable-z' });
  return half([n1, n2, n3, s1, s2, s3, spawnRoom(-65, 0, 1, 8, 14)], [
    { x: -44, z: -6, w: 3, d: 1.5, h: 1.1, mat: 'trim' }, { x: -24, z: 7, w: 3, d: 1.5, h: 1.1, mat: 'trim' },
    { x: -12, z: -5, w: 2, d: 2, h: 1.4, mat: 'wood' }, { x: -34, z: -4, w: 1, d: 3, h: 1.3, mat: 'trim' },
  ]);
})();


// ================================================================ the Overwatch-style set (desktop edition)
// Built to the hero-shooter recipe the Overwatch maps follow: a spawn room with two exits; three lanes to the objective -
// a main lane with a chokepoint, and two flanks (one through an interior, one along an edge) that fan out as they near
// the point and are cross-connected so players can switch lanes before the fight; tiered high ground on both sides of
// the point with sightlines onto it (easy stairs for everyone, jump-only perches for mobile heroes); cover that breaks
// every long sightline; health packs on the flanks and the high ground, a big one inside a building; spawn-to-point
// runs of ~15-20 s. Every building is enterable.

// ---------------------------------------------------------------- Sakura Lantern District (Control)
// A hillside night market in the lantern quarter of Neo-Kurogane. The point: the festival stage under a lantern
// pavilion in the market square. Left flank: through the two-storey teahouse, whose balcony is the high ground on the
// point. Right flank: the canal lane past the noodle shop, whose roof and the stone terrace overlook the stage.
const LANTERN = (() => {
  const tea = building({ x: -25, z: 20, w: 16, d: 12, storeys: 2, storeyH: 4.2,
    doors: [{ side: 'z-', at: -4 }, { side: 'z-', at: 4 }, { side: 'x-', at: 0 }, { side: 'x+', at: -2.5 }, { side: 'x+', at: 3, level: 1 }],
    windows: [{ side: 'z-', at: 0, level: 1, w: 3 }, { side: 'x+', at: -2, level: 1, w: 2 }, { side: 'x-', at: 3, level: 1 }], roof: 'gable-x', stair: 'x-', awnings: ['z-'], mat: 'wood' });
  const shop = building({ x: -26, z: -21, w: 13, d: 10, storeys: 1, storeyH: 4.6,
    doors: [{ side: 'x-', at: 0 }, { side: 'x+', at: 2 }, { side: 'z+', at: -3 }, { side: 'z+', at: 3.5 }], windows: [{ side: 'x+', at: -2.5 }, { side: 'z-', at: 0 }], roof: 'flat', stair: 'z-', awnings: ['z+'] });
  const gatehouse = building({ x: -46, z: 13, w: 10, d: 9, storeys: 2, storeyH: 4, doors: [{ side: 'z-', at: 0 }, { side: 'x+', at: 2 }, { side: 'x-', at: -2 }],
    windows: [{ side: 'x+', at: -2, level: 1 }, { side: 'z-', at: 2, level: 1 }], roof: 'gable-z', stair: 'x-' });
  const blockN: Box = { x: -44, z: 29, w: 22, d: 12, h: 11, mat: 'wall' }, blockS: Box = { x: -46, z: -28, w: 18, d: 12, h: 10, mat: 'wall' };
  return half([tea, shop, gatehouse, spawnRoom(-60, 0, 1, 10, 16)], [
    blockN, blockS,
    // the main lane's chokepoint: two stone plinths narrow the market street to a gate 8m wide
    { x: -35, z: -7.5, w: 7, d: 5, h: 5, mat: 'wall' }, { x: -35, z: 7.5, w: 7, d: 5, h: 5, mat: 'wall' },
    // the teahouse balcony: high ground on the point (4.2m), reached from the upper floor or the stair on its end
    { x: -13.5, z: 17, w: 7, d: 6, h: 4.2, mat: 'wood' }, { x: -13.5, z: 11.5, w: 3, d: 5, h: 4.2, mat: 'wood', ramp: 'z+' },
    // the stone terrace on the canal side (3m) and its steps from the canal lane
    { x: -11, z: -16, w: 8, d: 6, h: 3, mat: 'wall' }, { x: -16.5, z: -16, w: 3, d: 4, h: 3, mat: 'trim', ramp: 'x+' },
    // the festival stage steps (the stage itself is shared, below)
    { x: -8.5, z: 0, w: 3, d: 5, h: 1.2, mat: 'wood', ramp: 'x+' }, { x: 0, z: -8.5, w: 5, d: 3, h: 1.2, mat: 'wood', ramp: 'z+' },
    // the pavilion's corner posts
    { x: -6.3, z: -6.3, w: 0.8, d: 0.8, h: 5.4, y: 1.2, mat: 'accent' }, { x: -6.3, z: 6.3, w: 0.8, d: 0.8, h: 5.4, y: 1.2, mat: 'accent' },
    // cover in the square and on the lanes (breaks the long sightlines)
    { x: -18, z: 5, w: 1, d: 4, h: 1.3, mat: 'wood' }, { x: -20, z: -5, w: 4, d: 1, h: 1.2, mat: 'wood' }, { x: -6, z: 12, w: 3, d: 1, h: 1.1, mat: 'trim' },
    { x: -40, z: -13, w: 1, d: 5, h: 1.4, mat: 'wall' }, { x: -30, z: -12, w: 3, d: 3, h: 1.6, mat: 'wood' },
    // a canal footbridge rail and a low wall along the canal (the right flank)
    { x: -20, z: -30, w: 22, d: 0.8, h: 1.1, mat: 'trim' },
  ], [...facade(blockN, 4.4), ...facade(blockS, 4.4)]);
})();

// ---------------------------------------------------------------- Starfall Observatory (Control, an indoor point)
// The Academy's mountaintop observatory above the snowline, where Yuzu trained. The point sits on the floor of the great
// hall under the telescope; a gallery ring 5m up looks down on it from every side (a Sanctum-style room). Three ways in
// per team - the main doors (main lane), the side doors via the courtyards (flanks), the balcony doors up the outside
// ramps onto the gallery (high ground) - and the roof for anyone who can fly or climb.
const STARFALL_HALL = building({ x: 0, z: 0, w: 26, d: 24, storeys: 2, storeyH: 5, atrium: [15, 13],
  doors: [{ side: 'x-', at: 0, w: 4.4 }, { side: 'x+', at: 0, w: 4.4 }, { side: 'z-', at: -6 }, { side: 'z+', at: 6 },
    { side: 'x-', at: -8, level: 1 }, { side: 'x+', at: 8, level: 1 }, { side: 'z-', at: 7, level: 1 }, { side: 'z+', at: -7, level: 1 }],
  windows: [{ side: 'x-', at: 6, level: 1, w: 3 }, { side: 'x+', at: -6, level: 1, w: 3 }, { side: 'z-', at: 2, level: 0, w: 3 }, { side: 'z+', at: -2, level: 0, w: 3 }],
  roof: 'flat', mat: 'wall' });
const STARFALL = (() => {
  const barracks = building({ x: -33, z: 16, w: 12, d: 9, storeys: 2, storeyH: 4.2, doors: [{ side: 'z-', at: -3 }, { side: 'x+', at: 1 }, { side: 'x-', at: -1 }],
    windows: [{ side: 'x+', at: -2, level: 1, w: 2.4 }, { side: 'z-', at: 3, level: 1 }], roof: 'flat', stair: 'x-' });
  const lab = building({ x: -30, z: -17, w: 10, d: 9, storeys: 1, storeyH: 4.4, doors: [{ side: 'z+', at: -2 }, { side: 'x+', at: 0 }, { side: 'x-', at: 2 }],
    windows: [{ side: 'z+', at: 2.5 }, { side: 'x+', at: 3 }], roof: 'gable-z' });
  return half([barracks, lab, spawnRoom(-54, 0, 1, 10, 16)], [
    // the balcony platform and the ramp up the outside of the hall to the gallery door (x- wall, level 1)
    { x: -14.5, z: -8, w: 3, d: 4, h: 5, mat: 'trim' }, { x: -14.5, z: -15.5, w: 3, d: 11, h: 5, mat: 'trim', ramp: 'z+' },
    // courtyard walls and snow drifts: the main approach splits around the old telescope pier
    { x: -22, z: 0, w: 4, d: 4, h: 2.4, mat: 'wall' },
    { x: -40, z: -7, w: 5, d: 1, h: 1.6, mat: 'wall' }, { x: -40, z: 8, w: 1, d: 5, h: 1.6, mat: 'wall' },
    { x: -20, z: 13, w: 6, d: 1, h: 1.4, mat: 'wall' }, { x: -19, z: -24, w: 1, d: 6, h: 1.4, mat: 'wall' },
    // the barracks rooftop links to a cliff ledge (jump-only high ground over the left courtyard)
    { x: -22, z: 24, w: 8, d: 4, h: 6, mat: 'wall' },
  ]);
})();

// ---------------------------------------------------------------- Dawnforge Foundry (Push: escort the sun-core)
// The foundry where Tenkai-Oh's sun-reactor was forged, rebuilt as a working forge district. The sun-core cart is pushed
// down the foundry avenue between the casting halls; each side street has a hall you can run through, catwalks over
// the avenue (high ground with two ways up), and molten channels you can't stand in.
const FOUNDRY = (() => {
  const B = (x: number, z: number, o: Partial<Parameters<typeof building>[0]>) => building({ x, z, w: 12, d: 10, storeys: 2, storeyH: 4.4, roof: 'flat', mat: 'wall', ...o });
  const n1 = B(-56, 16, { doors: [{ side: 'z-', at: -3 }, { side: 'x+', at: 0 }, { side: 'x-', at: 1 }], windows: [{ side: 'z-', at: 2.5, level: 1 }, { side: 'x+', at: -2, level: 1 }], stair: 'x-' });
  const n2 = B(-36, 16, { w: 18, doors: [{ side: 'z-', at: -5 }, { side: 'z-', at: 5 }, { side: 'x-', at: 0 }, { side: 'x+', at: 0 }],
    windows: [{ side: 'z-', at: 0, level: 1, w: 3 }, { side: 'x+', at: 2, level: 1 }], stair: 'x+' });
  const n3 = B(-14, 16, { doors: [{ side: 'z-', at: 0 }, { side: 'x+', at: 1 }, { side: 'x-', at: -2 }], windows: [{ side: 'z-', at: -3, level: 1 }, { side: 'z-', at: 3, level: 1 }], roof: 'gable-x', stair: 'x-' });
  const s1 = B(-47, -16, { w: 14, doors: [{ side: 'z+', at: -3 }, { side: 'z+', at: 3 }, { side: 'x-', at: 0 }], windows: [{ side: 'z+', at: 0, level: 1, w: 2.6 }], roof: 'gable-x', stair: 'x+' });
  const s2 = B(-26, -16, { w: 14, storeys: 1, storeyH: 6, doors: [{ side: 'z+', at: 0, w: 4 }, { side: 'x+', at: -2 }, { side: 'x-', at: 2 }], windows: [{ side: 'z-', at: 0 }], roof: 'gable-z' });
  const s3 = B(-8, -16, { w: 10, doors: [{ side: 'z+', at: -2 }, { side: 'x+', at: 1 }, { side: 'x-', at: -1 }], windows: [{ side: 'z+', at: 2.5, level: 1 }, { side: 'x-', at: 2, level: 1 }], stair: 'x+' });
  return half([n1, n2, n3, s1, s2, s3, spawnRoom(-68, 0, 1, 8, 14)], [
    // catwalks over the avenue (4.4m, level with the halls' upper floors), each with a stair at its end
    { x: -45, z: 8, w: 10, d: 2.4, h: 0.4, y: 4.2, mat: 'trim' }, { x: -53.5, z: 8, w: 7, d: 2.4, h: 4.6, mat: 'trim', ramp: 'x+' },
    { x: -21, z: -8, w: 12, d: 2.4, h: 0.4, y: 4.2, mat: 'trim' }, { x: -11.5, z: -8, w: 7, d: 2.4, h: 4.6, mat: 'trim', ramp: 'x-' },
    // ingot stacks and crucible stands: cover along the payload route
    { x: -58, z: -6, w: 3, d: 2, h: 1.4, mat: 'accent' }, { x: -40, z: 5, w: 2, d: 3, h: 1.6, mat: 'trim' }, { x: -30, z: -5, w: 3, d: 1.5, h: 1.3, mat: 'accent' },
    { x: -17, z: 5, w: 1.5, d: 3, h: 1.4, mat: 'trim' }, { x: -4, z: -5, w: 2.5, d: 2.5, h: 1.5, mat: 'accent' },
  ]);
})();

export const MAPS: MapDef[] = [
  {
    id: 'amatsu', retired: true, name: 'Amatsu Sky Shrine', heroes: ['kaien', 'kagemaru', 'mirei'],
    story: 'Kaien kept this floating shrine for nine years - until Kagemaru set its sacred tree on fire. The islands still drift above the clouds, linked by old bridges and the ash of the burned tree.',
    size: [52, 30],
    floors: mirror([
      { x: -44, z: 0, w: 16, d: 22, h: 0.01, mat: 'ground' },
      { x: -28, z: -10, w: 18, d: 4, h: 0.01, mat: 'trim' },
      { x: -28, z: 10, w: 18, d: 4, h: 0.01, mat: 'trim' },
      { x: -18, z: 0, w: 10, d: 30, h: 0.01, mat: 'ground' },
      { x: 0, z: 0, w: 28, d: 26, h: 0.01, mat: 'ground' },
    ]),
    boxes: AMATSU.boxes, decor: AMATSU.decor,
    props: mirrorProps([
      { id: 'prop_amatsu_torii', x: -24, z: 10, rot: Math.PI / 2, s: 5.5 }, { id: 'prop_amatsu_torii', x: -24, z: -10, rot: Math.PI / 2, s: 5.5 },
      { id: 'prop_amatsu_lantern', x: -6, z: -6, s: 2.2, solid: 0.5 }, { id: 'prop_amatsu_lantern', x: -6, z: 6, s: 2.2, solid: 0.5 },
      { id: 'prop_amatsu_lantern', x: -36, z: -4, s: 2.2, solid: 0.5 },
      { id: 'prop_amatsu_sakura', x: -46, z: -9, s: 6, solid: 0.8 }, { id: 'prop_amatsu_sakura', x: -12, z: 12, s: 5, solid: 0.8 },
      { id: 'prop_amatsu_sakura', x: 0, z: 0, y: 1.4, s: 5.5, solid: 0.9 },
    ]),
    pads: mirrorPads([{ x: -22, z: 0, vx: 11, vy: 11, vz: 0 }]),
    packs: mirrorPacks([{ x: -30, z: 10 }, { x: -16, z: 11, y: 0, big: true }, { x: -10, z: -11 }]),
    spawns: { zenith: [-46, 0], umbra: [46, 0] }, point: [0, 1.4, 0],
    sun: { color: '#fff1d6', intensity: 2.6, dir: [-0.5, 0.8, 0.3] }, ambient: ['#bfe3ff', '#f3c9d4', 1.1],
    fog: ['#f6dcd8', 60, 190], tint: '#ff9ec4', particles: 'petals', killY: -30,
  },
  {
    id: 'kurogane', retired: true, name: 'Neo-Kurogane Rainport', heroes: ['raijin', 'enra'],
    story: 'Raijin\'s home district, rebuilt over the crater where Enra broke free of his thousand-year seal. The rain never stops; neither does the neon.',
    size: [50, 28],
    floors: [{ x: 0, z: 0, w: 100, d: 56, h: 0.01, mat: 'ground' }],
    boxes: [...border(50, 28, 14), ...KUROGANE.boxes], decor: KUROGANE.decor,
    props: mirrorProps([
      { id: 'prop_kurogane_vending', x: -24, z: -11, rot: Math.PI / 2, s: 2.3, solid: 0.7 }, { id: 'prop_kurogane_vending', x: -6, z: 12, rot: -Math.PI / 2, s: 2.3, solid: 0.7 },
      { id: 'prop_kurogane_stall', x: -44, z: 20, s: 4, solid: 1.6 }, { id: 'prop_kurogane_stall', x: -4, z: -13, rot: Math.PI, s: 4, solid: 1.6 },
      { id: 'prop_kurogane_sign', x: -20, z: -12, s: 7, solid: 0.4 }, { id: 'prop_kurogane_sign', x: -47, z: 24, s: 7, solid: 0.4 },
    ]),
    pads: [],
    packs: mirrorPacks([{ x: -26, z: 21, y: 0, big: true }, { x: -26, z: -5 }, { x: -10, z: -17, y: 0 }, { x: -8, z: 6 }]),
    spawns: { zenith: [-45, 0], umbra: [45, 0] }, point: [0, 4, 0],
    sun: { color: '#8fa8ff', intensity: 1.8, dir: [0.3, 0.9, -0.2] }, ambient: ['#8a6dcc', '#2a2848', 2.4],
    fog: ['#1b1433', 30, 130], tint: '#ff3dbb', particles: 'rain', killY: -20,
  },
  {
    id: 'hangar', retired: true, name: 'Hangar Zero', heroes: ['tenkai', 'gorgoth'],
    story: 'Both Guardian Frames were born on this assembly floor. The night Vorn stole Gorgoth, he tore Tenkai-Oh\'s fist off on his way out. It still lies where it fell.',
    size: [48, 26],
    floors: [{ x: 0, z: 0, w: 96, d: 52, h: 0.01, mat: 'ground' }],
    boxes: [...border(48, 26, 16), ...HANGAR.boxes], decor: HANGAR.decor,
    props: mirrorProps([
      { id: 'prop_hangar_fist', x: 0, z: 0, s: 5, solid: 2.4 },
      { id: 'prop_hangar_crane', x: -31, z: 21, s: 12, solid: 1.8 },
      { id: 'prop_hangar_crate', x: -10, z: 20, s: 2.6, solid: 1.3 }, { id: 'prop_hangar_crate', x: -32, z: -4, s: 2.6, solid: 1.3 },
      { id: 'prop_hangar_crate', x: -6, z: -16, s: 2.6, solid: 1.3 },
    ]),
    pads: [],
    packs: mirrorPacks([{ x: -19, z: 16, y: 0, big: true }, { x: -30, z: 1 }, { x: -12, z: -14 }]),
    spawns: { zenith: [-43, 0], umbra: [43, 0] }, point: [0, 0, 0],
    sun: { color: '#ffe0b0', intensity: 2.0, dir: [0.2, 1, 0.35] }, ambient: ['#9aa7b8', '#3a3026', 1.0],
    fog: ['#2a2622', 40, 150], tint: '#ffb020', particles: 'sparks', killY: -20,
  },
  {
    id: 'cathedral', retired: true, name: 'Crimson Moon Cathedral', heroes: ['nocturne', 'mirei'],
    story: 'Where the Amatsu Star Choir\'s prima voice sold her light for eternity. Lady Nocturne still sings here every blood moon - and the graves sing back.',
    size: [50, 30],
    floors: [{ x: 0, z: 0, w: 100, d: 60, h: 0.01, mat: 'ground' }],
    boxes: [...border(50, 30, 12), ...CATHEDRAL.boxes], decor: CATHEDRAL.decor,
    props: mirrorProps([
      { id: 'prop_cathedral_organ', x: 0, z: -24, s: 9, solid: 3 },
      { id: 'prop_cathedral_spire', x: -44, z: -22, s: 9, solid: 1.5 }, { id: 'prop_cathedral_spire', x: -18, z: 24, s: 8, solid: 1.5 },
      { id: 'prop_cathedral_grave', x: -40, z: 24, s: 1.8, solid: 0.6 }, { id: 'prop_cathedral_grave', x: -38, z: 20, s: 1.8, solid: 0.6 },
      { id: 'prop_cathedral_grave', x: -22, z: 18, s: 1.8, solid: 0.6 }, { id: 'prop_cathedral_grave', x: -30, z: -24, s: 1.8, solid: 0.6 },
    ]),
    pads: [],
    packs: mirrorPacks([{ x: -28, z: 18, y: 0, big: true }, { x: -14, z: 12 }, { x: -24, z: -4 }]),
    spawns: { zenith: [-45, 0], umbra: [45, 0] }, point: [0, 1.8, 0],
    sun: { color: '#ff6b6b', intensity: 1.5, dir: [-0.4, 0.7, -0.6] }, ambient: ['#6b1a3a', '#150a10', 1.2],
    fog: ['#2a0a16', 35, 140], tint: '#ff1e4a', particles: 'embers', killY: -20,
  },
  {
    id: 'rift', retired: true, name: 'Eclipse Rift', heroes: ['hex', 'yuzu', 'kagemaru'],
    story: 'The Syndicate\'s fractured home dimension, orbiting a black sun. Hex\'s "classroom" drifts here; Yuzu\'s brother vanished here during a training exercise.',
    size: [54, 32],
    floors: mirror([
      { x: -46, z: 0, w: 14, d: 20, h: 0.01, mat: 'ground' },
      { x: -30, z: -12, w: 12, d: 10, h: 0.01, mat: 'ground' }, { x: -30, z: 12, w: 12, d: 10, h: 0.01, mat: 'ground' },
      { x: -38, z: 0, w: 4, d: 3, h: 0.01, mat: 'trim' },
      { x: -38, z: -8, w: 6, d: 6, h: 0.01, mat: 'trim' }, { x: -38, z: 8, w: 6, d: 6, h: 0.01, mat: 'trim' },
      { x: -18, z: -12, w: 12, d: 3, h: 0.01, mat: 'trim' }, { x: -18, z: 12, w: 12, d: 3, h: 0.01, mat: 'trim' },
      { x: 0, z: 0, w: 26, d: 32, h: 0.01, mat: 'ground' },
    ]),
    boxes: RIFT.boxes, decor: RIFT.decor,
    props: mirrorProps([
      { id: 'prop_rift_crystal', x: -10, z: 13, s: 3.5, solid: 1.2 },
      { id: 'prop_rift_ruin', x: -4, z: -13, s: 4.5, solid: 0.8 }, { id: 'prop_rift_ruin', x: -48, z: 7.5, s: 4, solid: 0.8 },
      { id: 'prop_rift_obelisk', x: -22, z: 0, y: 3, s: 6 },
    ]),
    pads: mirrorPads([{ x: -38, z: 0, vx: 22.5, vy: 16, vz: 0 }]),
    packs: mirrorPacks([{ x: -28, z: 11, y: 0, big: true }, { x: -30, z: -11 }, { x: -9, z: -4 }]),
    spawns: { zenith: [-47, 0], umbra: [47, 0] }, point: [0, 2, 0],
    sun: { color: '#c9a2ff', intensity: 1.6, dir: [0.1, 0.9, 0.4] }, ambient: ['#4a2a7a', '#120a1f', 1.3],
    fog: ['#1a0f2e', 50, 180], tint: '#a64dff', particles: 'motes', killY: -30,
  },
  {
    id: 'hanabi', name: 'Hanabi Harbor', heroes: ['gantetsu'], full: true, objective: 'control',
    story: 'Gantetsu\'s home port on the night of the summer festival: lanterns strung over every street, the drum tower thundering, fireworks over the water - and the festival stage everyone wants to hold.',
    size: [60, 34],
    floors: mirror([
      { x: -30, z: 6, w: 60, d: 48, h: 0.01, mat: 'ground' },
      { x: -24, z: -24, w: 5, d: 12, h: 0.01, mat: 'wood' },
    ]),
    boxes: [{ x: 0, z: 0, w: 12, d: 12, h: 1.2, mat: 'wood' }, ...HANABI.boxes], decor: HANABI.decor,
    props: mirrorProps([
      { id: 'prop_hanabi_stall', x: -24, z: 12, rot: Math.PI / 2, s: 3.2, solid: 1.3 }, { id: 'prop_hanabi_stall', x: -6, z: 26, rot: Math.PI, s: 3.2, solid: 1.3 },
      { id: 'prop_hanabi_stall', x: -46, z: 12, s: 3.2, solid: 1.3 },
      { id: 'prop_hanabi_yagura', x: -10, z: -8, s: 7.5, solid: 1.2 },
      { id: 'prop_hanabi_boat', x: -31, z: -27, y: -0.9, rot: 0.4, s: 3.2 }, { id: 'prop_hanabi_boat', x: -16, z: -25, y: -0.9, rot: -0.3, s: 2.8 },
      { id: 'prop_amatsu_lantern', x: -20, z: -2, s: 2, solid: 0.5 },
    ]),
    pads: [],
    packs: mirrorPacks([{ x: -46, z: 4 }, { x: -37, z: -6, y: 0, big: true }, { x: -14, z: 20, y: 8.4 }, { x: -40, z: 23, y: 0 }]),
    spawns: { zenith: [-54, 6], umbra: [54, -6] }, point: [0, 1.2, 0],
    sun: { color: '#ffb27a', intensity: 1.6, dir: [-0.6, 0.45, 0.3] }, ambient: ['#8a6dd8', '#40304a', 1.6],
    fog: ['#4a3368', 55, 180], tint: '#ff9a3c', particles: 'embers', killY: -6, water: -0.7,
  },
  {
    id: 'cloudstep', name: 'Cloudstep Terraces', heroes: ['kaien', 'yuzu'], full: true, objective: 'control',
    story: 'A tea village clinging to terraced cliffs high above the clouds, where the cable cars never stop. Hold the market square - and mind the edges.',
    size: [58, 30],
    floors: mirror([
      { x: -29, z: 0, w: 58, d: 40, h: 0.01, mat: 'ground' },
      { x: -10, z: -20.5, w: 3, d: 2.4, h: 0.01, mat: 'trim' },
      { x: -10, z: -25, w: 10, d: 8, h: 0.01, mat: 'ground' },
    ]),
    boxes: [{ x: 0, z: 0, w: 14, d: 14, h: 1, mat: 'trim' }, ...CLOUDSTEP.boxes], decor: CLOUDSTEP.decor,
    props: mirrorProps([
      { id: 'prop_cloud_pagoda', x: -53, z: 13, s: 7, solid: 1.6 },
      { id: 'prop_cloud_teatree', x: -30, z: -6, s: 3.5, solid: 1.2 }, { id: 'prop_cloud_teatree', x: -34, z: 14, y: 3, s: 3.2, solid: 1.1 },
      { id: 'prop_cloud_teatree', x: -12, z: -26, s: 3.2, solid: 1.1 },
      { id: 'prop_cloud_gondola', x: -46, z: -4, y: 7, s: 3.6 }, { id: 'prop_cloud_gondola', x: -2, z: -24, y: 9, rot: 1.2, s: 3.4 },
      { id: 'prop_amatsu_lantern', x: -9, z: 8, s: 2, solid: 0.5 },
    ]),
    pads: [],
    packs: mirrorPacks([{ x: -46, z: 6 }, { x: -41, z: -12, y: 0, big: true }, { x: -13, z: 7, y: 6 }, { x: -8, z: -26 }, { x: -33, z: 5, y: 3 }]),
    spawns: { zenith: [-51, 0], umbra: [51, 0] }, point: [0, 1, 0],
    sun: { color: '#fff4dc', intensity: 2.1, dir: [-0.4, 0.85, 0.25] }, ambient: ['#cfe6ff', '#6f8f5e', 0.85],
    fog: ['#d6e6f4', 80, 240], tint: '#7fe07a', particles: 'petals', killY: -25,
  },
  {
    id: 'kagura', name: 'Kagura Avenue', heroes: ['mirei', 'raijin'], full: true, objective: 'push',
    story: 'Once a year the Mikoshi of the Dawn is carried the length of Kagura Avenue. This year both the Vanguard and the Syndicate mean to carry it home - through the other side\'s gate.',
    size: [70, 26],
    floors: [{ x: 0, z: 0, w: 140, d: 52, h: 0.01, mat: 'ground' }],
    boxes: [...border(70, 26, 12), ...KAGURA.boxes], decor: KAGURA.decor,
    props: mirrorProps([
      { id: 'prop_kagura_gate', x: -61, z: 0, rot: Math.PI / 2, s: 11 },
      { id: 'prop_kagura_lamp', x: -50, z: 8.5, s: 4.5, solid: 0.35 }, { id: 'prop_kagura_lamp', x: -38, z: -8.5, s: 4.5, solid: 0.35 },
      { id: 'prop_kagura_lamp', x: -26, z: 8.5, s: 4.5, solid: 0.35 }, { id: 'prop_kagura_lamp', x: -14, z: -8.5, s: 4.5, solid: 0.35 },
      { id: 'prop_amatsu_sakura', x: -40, z: 8, s: 5, solid: 0.7 }, { id: 'prop_amatsu_sakura', x: -18, z: -8, s: 5, solid: 0.7 },
      { id: 'prop_hanabi_stall', x: -30, z: 6, rot: Math.PI, s: 3, solid: 1.2 }, { id: 'prop_hanabi_stall', x: -52, z: -6, s: 3, solid: 1.2 },
    ]),
    pads: [],
    packs: mirrorPacks([{ x: -52, z: 5 }, { x: -39, z: 16, y: 0, big: true }, { x: -31, z: -14, y: 0 }, { x: -16, z: -4 }]),
    path: [[-60, 0], [-44, 2.5], [-24, -2.5], [0, 0], [24, 2.5], [44, -2.5], [60, 0]],
    spawns: { zenith: [-65, 0], umbra: [65, 0] }, point: [0, 0, 0],
    sun: { color: '#fff0d8', intensity: 2.1, dir: [-0.3, 0.9, 0.35] }, ambient: ['#bfe3ff', '#b89f8c', 0.85],
    fog: ['#dcd6ea', 90, 260], tint: '#ff5a7a', particles: 'petals', killY: -20,
  },

  {
    id: 'lantern', name: 'Sakura Lantern District', heroes: ['raijin', 'hayate', 'seiran'], full: true, objective: 'control',
    story: 'The lantern quarter of Neo-Kurogane on festival night: a hillside market of teahouses, noodle shops and canals under ten thousand paper lanterns. Take the festival stage - the Koryu brothers last met on this square.',
    size: [66, 36],
    floors: [{ x: 0, z: 0, w: 132, d: 72, h: 0.01, mat: 'ground' }],
    boxes: [...border(66, 36, 12), { x: 0, z: 0, w: 14, d: 14, h: 1.2, mat: 'wood' }, { x: 0, z: 0, w: 15, d: 15, h: 0.5, y: 6.6, mat: 'roof' }, ...LANTERN.boxes],
    decor: LANTERN.decor,
    props: mirrorProps([
      { id: 'prop_lantern_gate', x: -35, z: 0, rot: Math.PI / 2, s: 8 },
      { id: 'prop_lantern_stall', x: -21, z: 10, rot: Math.PI, s: 3.4, solid: 1.3 }, { id: 'prop_lantern_stall', x: -44, z: -6, s: 3.4, solid: 1.3 },
      { id: 'prop_lantern_post', x: -8, z: 10, s: 3.2, solid: 0.4 }, { id: 'prop_lantern_post', x: -8, z: -10, s: 3.2, solid: 0.4 }, { id: 'prop_lantern_post', x: -30, z: 3, s: 3.2, solid: 0.4 },
      { id: 'prop_lantern_koi', x: -52, z: -12, s: 4.5, solid: 1.2 },
      { id: 'prop_amatsu_sakura', x: -16, z: -9, s: 5, solid: 0.7 },
    ]),
    pads: [],
    packs: mirrorPacks([{ x: -25, z: 20, y: 0, big: true }, { x: -38, z: -13 }, { x: -13.5, z: 17, y: 4.2 }, { x: -11, z: -16, y: 3 }, { x: -46, z: 13, y: 0 }]),
    spawns: { zenith: [-60, 0], umbra: [60, 0] }, point: [0, 1.2, 0],
    sun: { color: '#9fb4ff', intensity: 0.95, dir: [0.35, 0.8, -0.4] }, ambient: ['#6a4aa0', '#2e1c30', 1.25],
    fog: ['#2c1a3c', 55, 180], tint: '#ff6a3c', particles: 'embers', killY: -20,
  },
  {
    id: 'starfall', name: 'Starfall Observatory', heroes: ['yuzu', 'mirei'], full: true, objective: 'control',
    story: "Zenith Academy's observatory on the snowline, where Yuzu learned to shoot the stars. The point lies on the floor of the great telescope hall; the gallery above it is the best seat in the house.",
    size: [60, 32],
    floors: [{ x: 0, z: 0, w: 120, d: 64, h: 0.01, mat: 'ground' }],
    boxes: [...border(60, 32, 14), ...STARFALL_HALL.boxes, ...STARFALL.boxes], decor: [...STARFALL_HALL.decor, ...STARFALL.decor],
    props: mirrorProps([
      { id: 'prop_star_telescope', x: 0, z: 0, y: 5, s: 7 },
      { id: 'prop_star_pine', x: -44, z: -22, s: 6, solid: 1 }, { id: 'prop_star_pine', x: -24, z: 26, s: 7, solid: 1 }, { id: 'prop_star_pine', x: -50, z: 24, s: 6, solid: 1 },
      { id: 'prop_star_dish', x: -40, z: 16, y: 8.4, s: 4 },
      { id: 'prop_star_orrery', x: -22, z: 0, y: 2.4, s: 2.5 },
    ]),
    pads: [],
    packs: mirrorPacks([{ x: -33, z: 16, y: 0, big: true }, { x: -30, z: -17 }, { x: -14.5, z: -8, y: 5 }, { x: -8, z: -9 }]),
    spawns: { zenith: [-54, 0], umbra: [54, 0] }, point: [0, 0, 0],
    // late afternoon above the snowline: a low warm sun for long shadows across the pale stone, cool shade, blue haze
    sun: { color: '#ffd6a8', intensity: 1.35, dir: [-0.6, 0.45, 0.32] }, ambient: ['#8fa9d6', '#56607a', 0.55],
    fog: ['#b8c8e2', 85, 250], tint: '#6fb8ff', particles: 'motes', killY: -20, bloom: [0.97, 0.3],
  },
  {
    id: 'foundry', name: 'Dawnforge Foundry', heroes: ['tenkai', 'gorgoth', 'hayate'], full: true, objective: 'push',
    story: "Where Tenkai-Oh's sun-reactor was cast - and where Hayate was rebuilt. Escort the sun-core cart down the foundry avenue, past the casting halls and under the catwalks, through the other side's gate.",
    size: [74, 28],
    floors: [{ x: 0, z: 0, w: 148, d: 56, h: 0.01, mat: 'ground' }],
    boxes: [...border(74, 28, 14), ...FOUNDRY.boxes], decor: FOUNDRY.decor,
    props: mirrorProps([
      { id: 'prop_forge_crucible', x: -26, z: 6, s: 4.5, solid: 1.6 }, { id: 'prop_forge_crucible', x: -2, z: 8, s: 4, solid: 1.4 },
      { id: 'prop_forge_press', x: -46, z: -6, s: 5, solid: 1.8 },
      { id: 'prop_forge_crate', x: -36, z: -7, s: 2.2, solid: 1.1 }, { id: 'prop_forge_crate', x: -12, z: 7, s: 2.2, solid: 1.1 },
      { id: 'prop_hangar_crane', x: -60, z: 18, s: 12, solid: 1.8 },
    ]),
    pads: [],
    packs: mirrorPacks([{ x: -36, z: 16, y: 0, big: true }, { x: -26, z: -16 }, { x: -45, z: 8, y: 4.6 }, { x: -8, z: -16, y: 0 }]),
    path: [[-62, 0], [-46, 2], [-30, -2], [-14, 1.5], [0, 0], [14, -1.5], [30, 2], [46, -2], [62, 0]],
    spawns: { zenith: [-68, 0], umbra: [68, 0] }, point: [0, 0, 0],
    sun: { color: '#ffd6a0', intensity: 1.8, dir: [-0.2, 0.9, 0.4] }, ambient: ['#b89a80', '#3a2a22', 1.3],
    fog: ['#3a2a24', 45, 170], tint: '#ff8a2a', particles: 'sparks', killY: -20,
  },
  LITE_MAP.training,
];

export const MAP: Record<string, MapDef> = Object.fromEntries(MAPS.map(m => [m.id, m]));
export const PLAY_MAPS = MAPS.filter(m => m.id !== 'training' && !m.retired);
/** the web edition plays the original arenas; the desktop edition the rebuilt set (plus its new maps) */
export const mapsFor = (full: boolean) => (full ? PLAY_MAPS : LITE_MAPS.filter(m => m.id !== 'training'));
export const mapFor = (id: string, full: boolean): MapDef => (full ? MAP[id] : LITE_MAP[id]) ?? MAP[id];
