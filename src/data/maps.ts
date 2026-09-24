// Map layouts. Coordinates in metres: X is the long axis (Zenith spawn at -X, Umbra at +X), Z across, Y up.
// Each map lists half of its geometry; `mirror` adds the 180-degree rotated copy so both teams get the same map.

export type Mat = 'wall' | 'trim' | 'ground' | 'glass' | 'accent';
export interface Box { x: number; z: number; w: number; d: number; h: number; y?: number; mat?: Mat; ramp?: 'x+' | 'x-' | 'z+' | 'z-'; }
export interface Prop { id: string; x: number; z: number; y?: number; rot?: number; s?: number; solid?: number; }
export interface Pad { x: number; z: number; y?: number; vx: number; vy: number; vz: number; }

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
const border = (X: number, Z: number, h = 8): Box[] => [
  { x: 0, z: -Z - 0.5, w: 2 * X + 2, d: 1, h }, { x: 0, z: Z + 0.5, w: 2 * X + 2, d: 1, h },
  { x: -X - 0.5, z: 0, w: 1, d: 2 * Z, h }, { x: X + 0.5, z: 0, w: 1, d: 2 * Z, h },
];

export const MAPS: MapDef[] = [
  {
    id: 'amatsu', name: 'Amatsu Sky Shrine', heroes: ['kaien', 'kagemaru', 'mirei'],
    story: 'Kaien kept this floating shrine for nine years - until Kagemaru set its sacred tree on fire. The islands still drift above the clouds, linked by old bridges and the ash of the burned tree.',
    size: [52, 30],
    floors: mirror([
      { x: -44, z: 0, w: 16, d: 22, h: 0.01, mat: 'ground' },          // spawn island
      { x: -28, z: -10, w: 18, d: 4, h: 0.01, mat: 'trim' },           // south bridge
      { x: -28, z: 10, w: 18, d: 4, h: 0.01, mat: 'trim' },            // north bridge
      { x: -18, z: 0, w: 10, d: 30, h: 0.01, mat: 'ground' },          // outer ring island
      { x: 0, z: 0, w: 28, d: 26, h: 0.01, mat: 'ground' },            // shrine island
    ]),
    boxes: mirror([
      { x: 0, z: 0, w: 12, d: 12, h: 1.4, mat: 'trim' },               // shrine dais (capture)
      { x: -7.5, z: 0, w: 3, d: 5, h: 1.4, mat: 'trim', ramp: 'x+' },  // dais steps
      { x: -8, z: -9, w: 6, d: 1, h: 3, mat: 'wall' }, { x: -8, z: 9, w: 6, d: 1, h: 3, mat: 'wall' },
      { x: -18, z: -6, w: 4, d: 4, h: 2.2, mat: 'wall' }, { x: -18, z: 6, w: 4, d: 4, h: 2.2, mat: 'wall' },
      { x: -18, z: -12, w: 6, d: 3, h: 3.5, mat: 'wall' }, { x: -13, z: -12, w: 4, d: 3, h: 3.5, mat: 'wall', ramp: 'x-' },
      { x: -40, z: -7, w: 2, d: 2, h: 3, mat: 'accent' }, { x: -40, z: 7, w: 2, d: 2, h: 3, mat: 'accent' },
      { x: -10, z: 0, w: 1, d: 3, h: 1.2, mat: 'wall' },
    ]),
    props: mirrorProps([
      { id: 'prop_amatsu_torii', x: -24, z: 10, rot: Math.PI / 2, s: 5.5 }, { id: 'prop_amatsu_torii', x: -24, z: -10, rot: Math.PI / 2, s: 5.5 },
      { id: 'prop_amatsu_lantern', x: -6, z: -6, s: 2.2, solid: 0.5 }, { id: 'prop_amatsu_lantern', x: -6, z: 6, s: 2.2, solid: 0.5 },
      { id: 'prop_amatsu_lantern', x: -36, z: -4, s: 2.2, solid: 0.5 },
      { id: 'prop_amatsu_sakura', x: -46, z: -8, s: 6, solid: 0.8 }, { id: 'prop_amatsu_sakura', x: -12, z: 11, s: 5, solid: 0.8 },
      { id: 'prop_amatsu_sakura', x: 0, z: 0, y: 1.4, s: 5.5, solid: 0.9 },
    ]),
    pads: mirrorPads([{ x: -22, z: 0, vx: 11, vy: 11, vz: 0 }]),
    spawns: { zenith: [-46, 0], umbra: [46, 0] }, point: [0, 1.4, 0],
    sun: { color: '#fff1d6', intensity: 2.6, dir: [-0.5, 0.8, 0.3] }, ambient: ['#bfe3ff', '#f3c9d4', 1.1],
    fog: ['#f6dcd8', 60, 190], tint: '#ff9ec4', particles: 'petals', killY: -30,
  },
  {
    id: 'kurogane', name: 'Neo-Kurogane Rainport', heroes: ['raijin', 'enra'],
    story: 'Raijin\'s home district, rebuilt over the crater where Enra broke free of his thousand-year seal. The rain never stops; neither does the neon.',
    size: [50, 28],
    floors: [{ x: 0, z: 0, w: 100, d: 56, h: 0.01, mat: 'ground' }],
    boxes: [...border(50, 28, 14), ...mirror([
      { x: -30, z: -18, w: 14, d: 14, h: 12, mat: 'wall' }, { x: -30, z: 18, w: 14, d: 14, h: 10, mat: 'wall' },
      { x: -12, z: -20, w: 10, d: 12, h: 14, mat: 'wall' }, { x: -12, z: 19, w: 10, d: 14, h: 9, mat: 'wall' },
      { x: 0, z: 0, w: 30, d: 5, h: 4, y: 0, mat: 'trim' },           // monorail platform
      { x: -18, z: 0, w: 6, d: 4, h: 4, mat: 'trim', ramp: 'x+' },     // stairs up
      { x: -22, z: -6, w: 3, d: 3, h: 1.2, mat: 'accent' }, { x: -22, z: 6, w: 3, d: 3, h: 1.2, mat: 'accent' },
      { x: -40, z: -10, w: 4, d: 1, h: 2, mat: 'wall' }, { x: -40, z: 10, w: 4, d: 1, h: 2, mat: 'wall' },
      { x: -6, z: -9, w: 1, d: 5, h: 1.6, mat: 'glass' },
    ])],
    props: mirrorProps([
      { id: 'prop_kurogane_vending', x: -24, z: -11, rot: Math.PI / 2, s: 2.3, solid: 0.7 }, { id: 'prop_kurogane_vending', x: -6, z: 12, rot: -Math.PI / 2, s: 2.3, solid: 0.7 },
      { id: 'prop_kurogane_stall', x: -36, z: 17, s: 4, solid: 1.6 }, { id: 'prop_kurogane_stall', x: -4, z: -13, rot: Math.PI, s: 4, solid: 1.6 },
      { id: 'prop_kurogane_sign', x: -20, z: -12, s: 7, solid: 0.4 }, { id: 'prop_kurogane_sign', x: -44, z: 22, s: 7, solid: 0.4 },
    ]),
    pads: [],
    spawns: { zenith: [-45, 0], umbra: [45, 0] }, point: [0, 4, 0],
    sun: { color: '#8fa8ff', intensity: 1.8, dir: [0.3, 0.9, -0.2] }, ambient: ['#8a6dcc', '#2a2848', 2.4],
    fog: ['#1b1433', 30, 130], tint: '#ff3dbb', particles: 'rain', killY: -20,
  },
  {
    id: 'hangar', name: 'Hangar Zero', heroes: ['tenkai', 'gorgoth'],
    story: 'Both Guardian Frames were born on this assembly floor. The night Vorn stole Gorgoth, he tore Tenkai-Oh\'s fist off on his way out. It still lies where it fell.',
    size: [48, 26],
    floors: [{ x: 0, z: 0, w: 96, d: 52, h: 0.01, mat: 'ground' }],
    boxes: [...border(48, 26, 16), ...mirror([
      { x: -20, z: -20, w: 30, d: 4, h: 4, mat: 'trim' },             // catwalk
      { x: -33, z: -15, w: 4, d: 6, h: 4, mat: 'trim', ramp: 'z-' },    // catwalk stairs
      { x: -26, z: -4, w: 3, d: 3, h: 2, mat: 'accent' }, { x: -26, z: 4, w: 3, d: 3, h: 2, mat: 'accent' },
      { x: -14, z: -9, w: 6, d: 2, h: 3, mat: 'wall' }, { x: -14, z: 9, w: 2, d: 6, h: 3, mat: 'wall' },
      { x: -8, z: 0, w: 2, d: 5, h: 1.3, mat: 'wall' },
      { x: -38, z: 8, w: 6, d: 2, h: 2.5, mat: 'wall' },
    ])],
    props: mirrorProps([
      { id: 'prop_hangar_fist', x: 0, z: 0, s: 5, solid: 2.4 },
      { id: 'prop_hangar_crane', x: -30, z: 20, s: 12, solid: 1.8 },
      { id: 'prop_hangar_crate', x: -20, z: 14, s: 2.6, solid: 1.3 }, { id: 'prop_hangar_crate', x: -32, z: -4, s: 2.6, solid: 1.3 },
      { id: 'prop_hangar_crate', x: -6, z: -16, s: 2.6, solid: 1.3 },
    ]),
    pads: [],
    spawns: { zenith: [-43, 0], umbra: [43, 0] }, point: [0, 0, 0],
    sun: { color: '#ffe0b0', intensity: 2.0, dir: [0.2, 1, 0.35] }, ambient: ['#9aa7b8', '#3a3026', 1.0],
    fog: ['#2a2622', 40, 150], tint: '#ffb020', particles: 'sparks', killY: -20,
  },
  {
    id: 'cathedral', name: 'Crimson Moon Cathedral', heroes: ['nocturne', 'mirei'],
    story: 'Where the Amatsu Star Choir\'s prima voice sold her light for eternity. Lady Nocturne still sings here every blood moon - and the graves sing back.',
    size: [50, 30],
    floors: [{ x: 0, z: 0, w: 100, d: 60, h: 0.01, mat: 'ground' }],
    boxes: [...border(50, 30, 12), ...mirror([
      { x: -10, z: -8, w: 20, d: 1.2, h: 9, mat: 'wall' },             // nave walls with gaps
      { x: -10, z: 8, w: 12, d: 1.2, h: 9, mat: 'wall' },
      { x: 0, z: 0, w: 8, d: 8, h: 1.8, mat: 'trim' },                  // altar
      { x: -5, z: 0, w: 2, d: 4, h: 1.8, mat: 'trim', ramp: 'x+' },
      { x: -28, z: -14, w: 8, d: 8, h: 5, mat: 'wall' }, { x: -21, z: -14, w: 6, d: 4, h: 5, mat: 'wall', ramp: 'x-' },
      { x: -30, z: 12, w: 2, d: 8, h: 2.2, mat: 'wall' },
      { x: -40, z: -6, w: 2, d: 2, h: 3, mat: 'accent' }, { x: -40, z: 6, w: 2, d: 2, h: 3, mat: 'accent' },
    ])],
    props: mirrorProps([
      { id: 'prop_cathedral_organ', x: 0, z: -24, s: 9, solid: 3 },
      { id: 'prop_cathedral_spire', x: -44, z: -22, s: 9, solid: 1.5 }, { id: 'prop_cathedral_spire', x: -18, z: 24, s: 8, solid: 1.5 },
      { id: 'prop_cathedral_grave', x: -34, z: 20, s: 1.8, solid: 0.6 }, { id: 'prop_cathedral_grave', x: -38, z: 22, s: 1.8, solid: 0.6 },
      { id: 'prop_cathedral_grave', x: -22, z: 18, s: 1.8, solid: 0.6 }, { id: 'prop_cathedral_grave', x: -30, z: -24, s: 1.8, solid: 0.6 },
    ]),
    pads: [],
    spawns: { zenith: [-45, 0], umbra: [45, 0] }, point: [0, 1.8, 0],
    sun: { color: '#ff6b6b', intensity: 1.5, dir: [-0.4, 0.7, -0.6] }, ambient: ['#6b1a3a', '#150a10', 1.2],
    fog: ['#2a0a16', 35, 140], tint: '#ff1e4a', particles: 'embers', killY: -20,
  },
  {
    id: 'rift', name: 'Eclipse Rift', heroes: ['hex', 'yuzu', 'kagemaru'],
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
    boxes: mirror([
      { x: 0, z: 0, w: 10, d: 10, h: 2, mat: 'trim' },
      { x: -6, z: 0, w: 2, d: 4, h: 2, mat: 'trim', ramp: 'x+' },
      { x: -8, z: -10, w: 3, d: 6, h: 3.5, mat: 'wall' }, { x: -8, z: 10, w: 3, d: 3, h: 2.2, mat: 'wall' },
      { x: -30, z: -14, w: 4, d: 3, h: 2.5, mat: 'wall' }, { x: -30, z: 14, w: 3, d: 3, h: 3.5, mat: 'accent' },
      { x: -46, z: -8, w: 3, d: 2, h: 2, mat: 'wall' },
    ]),
    props: mirrorProps([
      { id: 'prop_rift_crystal', x: -10, z: 13, s: 3.5, solid: 1.2 }, { id: 'prop_rift_crystal', x: -28, z: 9, s: 3, solid: 1 },
      { id: 'prop_rift_ruin', x: -4, z: -13, s: 4.5, solid: 0.8 }, { id: 'prop_rift_ruin', x: -48, z: 7, s: 4, solid: 0.8 },
      { id: 'prop_rift_obelisk', x: -22, z: 0, y: 3, s: 6 },
    ]),
    pads: mirrorPads([{ x: -38, z: 0, vx: 22.5, vy: 16, vz: 0 }]),
    spawns: { zenith: [-47, 0], umbra: [47, 0] }, point: [0, 2, 0],
    sun: { color: '#c9a2ff', intensity: 1.6, dir: [0.1, 0.9, 0.4] }, ambient: ['#4a2a7a', '#120a1f', 1.3],
    fog: ['#1a0f2e', 50, 180], tint: '#a64dff', particles: 'motes', killY: -30,
  },
  {
    id: 'training', name: 'Zenith Academy Proving Grounds', heroes: [],
    story: 'Where every Vanguard cadet learns to fight - and where the Syndicate\'s defectors are tested before anyone trusts them.',
    size: [40, 26],
    floors: [{ x: 0, z: 0, w: 80, d: 52, h: 0.01, mat: 'ground' }],
    boxes: [...border(40, 26, 10),
      { x: 10, z: -12, w: 1, d: 10, h: 1.4, mat: 'trim' }, { x: 10, z: 12, w: 1, d: 10, h: 1.4, mat: 'trim' },
      { x: 24, z: 0, w: 8, d: 8, h: 3, mat: 'wall' }, { x: 17.5, z: 0, w: 5, d: 4, h: 3, mat: 'wall', ramp: 'x+' },
      { x: -8, z: 18, w: 10, d: 6, h: 2, mat: 'accent' }, { x: -15, z: 18, w: 4, d: 4, h: 2, mat: 'accent', ramp: 'x+' },
      { x: -20, z: -14, w: 6, d: 1, h: 2.5, mat: 'wall' },
    ],
    props: [
      { id: 'prop_training_barrier', x: 0, z: -6, s: 3, solid: 1.2 }, { id: 'prop_training_barrier', x: 0, z: 6, s: 3, solid: 1.2 },
      { id: 'prop_training_target', x: 34, z: -16, s: 3 }, { id: 'prop_training_target', x: 34, z: 16, s: 3 },
    ],
    pads: [{ x: -26, z: 0, vx: 0, vy: 16, vz: 0 }],
    spawns: { zenith: [-32, 0], umbra: [32, 0] }, point: [0, 0, 0],
    sun: { color: '#ffffff', intensity: 2.8, dir: [-0.4, 1, 0.3] }, ambient: ['#dff1ff', '#b8c4d0', 1.2],
    fog: ['#d8ecff', 70, 200], tint: '#4fc3ff', particles: 'none', killY: -20,
  },
];

export const MAP: Record<string, MapDef> = Object.fromEntries(MAPS.map(m => [m.id, m]));
export const PLAY_MAPS = MAPS.filter(m => m.id !== 'training');
