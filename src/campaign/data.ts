// OPERATION STARFALL - campaign content: the Star-Forger's robots, five levels, bosses and story beats.
import type { AbilityDef, HeroDef } from '../data/heroes';
import type { MapDef, Box, Pad } from '../data/maps';

const none = (id = 'none'): AbilityDef => ({ id, name: '-', key: '-', cooldown: 999, desc: '' });
const E = {
  team: 'umbra' as const, rival: '', armor: 0, secondary: none(), ability1: none(), ability2: none(), ult: { ...none(), charge: 1e9 },
  passive: { name: '', desc: '' }, inspiration: '', voice: [200, 0.5] as [number, number], lore: '',
};

export const ENEMIES: Record<string, HeroDef> = {
  minion_swarmer: { ...E, id: 'minion_swarmer', name: 'Swarmer', title: 'Forge Drone', role: 'dps', frame: 'drone', hp: 90, speed: 7, height: 1.2, radius: 0.6, color: '#b56dff', glow: '#c77dff',
    primary: { kind: 'projectile', damage: 9, rate: 1.6, range: 30, speed: 34, sfx: 'blaster', fx: 'hex' } },
  minion_lancer: { ...E, id: 'minion_lancer', name: 'Lancer', title: 'Forge Soldier', role: 'dps', frame: 'human', hp: 180, speed: 5.2, height: 2.0, radius: 0.5, color: '#b56dff', glow: '#c77dff',
    primary: { kind: 'melee', damage: 24, rate: 1.1, range: 3.4, sfx: 'fang', fx: 'hex' } },
  minion_sentinel: { ...E, id: 'minion_sentinel', name: 'Sentinel', title: 'Forge Bulwark', role: 'tank', frame: 'mech', hp: 380, armor: 120, speed: 3.2, height: 2.2, radius: 0.85, color: '#b56dff', glow: '#c77dff',
    primary: { kind: 'projectile', damage: 16, splash: 1.2, rate: 1, range: 40, speed: 30, sfx: 'cannon', fx: 'hex' } },
  minion_bomber: { ...E, id: 'minion_bomber', name: 'Bomber', title: 'Forge Mine', role: 'dps', frame: 'drone', hp: 70, speed: 8.5, height: 1.4, radius: 0.7, color: '#ff4d6d', glow: '#ff2d55',
    primary: { kind: 'melee', damage: 0, rate: 1, range: 2, sfx: 'none', fx: 'hex' } },
};

export interface BossDef extends HeroDef { attacks: string[]; hpPerPlayer: number; summon: string; weak: string; }
const boss = (o: Partial<BossDef> & Pick<BossDef, 'id' | 'name' | 'title' | 'hp' | 'height' | 'radius' | 'frame' | 'attacks' | 'summon' | 'weak' | 'glow'>): BossDef => ({
  ...E, role: 'tank', speed: 3.2, color: o.glow, hpPerPlayer: 0.45,
  primary: { kind: 'projectile', damage: 18, splash: 2, rate: 0.8, range: 80, speed: 38, sfx: 'cannon', fx: 'void' }, ...o,
} as BossDef);

export const BOSSES: Record<string, BossDef> = {
  boss_ironmaw: boss({ id: 'boss_ironmaw', name: 'IRONMAW', title: 'Colossus Mk-I · the Grinder', hp: 5200, armor: 800, height: 14, radius: 3.6, frame: 'mech', glow: '#ff8a3d',
    attacks: ['stomp', 'charge', 'barrage', 'bite', 'summon'], summon: 'minion_swarmer', weak: 'the violet reactor in its chest' }),
  boss_reaper: boss({ id: 'boss_reaper', name: 'CRESCENT REAPER', title: 'Colossus Mk-II · the Harvester', hp: 5600, armor: 600, height: 16, radius: 3, frame: 'mech', glow: '#d6d6ff', speed: 4,
    attacks: ['sweep', 'crescents', 'blink', 'stomp', 'summon'], summon: 'minion_lancer', weak: 'its single eye' }),
  boss_leviathan: boss({ id: 'boss_leviathan', name: 'HIVE LEVIATHAN', title: 'Colossus Mk-III · the Deep Coil', hp: 6000, armor: 500, height: 16, radius: 3.4, frame: 'mech', glow: '#2de0c8',
    attacks: ['dive', 'barrage', 'sweep', 'shockwave', 'summon'], summon: 'minion_bomber', weak: 'the glowing vents on its hood' }),
  boss_phoenix: boss({ id: 'boss_phoenix', name: 'SOLAR PHOENIX', title: 'Colossus Mk-IV · the Sunburner', hp: 6200, armor: 400, height: 15, radius: 3.2, frame: 'drone', glow: '#ff9d2a', speed: 6,
    attacks: ['beam', 'firerain', 'divebomb', 'shockwave', 'summon'], summon: 'minion_swarmer', weak: 'the burning core between its wings' }),
  boss_genesis: boss({ id: 'boss_genesis', name: 'OMEGA GENESIS', title: "Qel'Varis's Throne Colossus", hp: 8000, armor: 1200, height: 18, radius: 4, frame: 'mech', glow: '#b56dff',
    attacks: ['stomp', 'sweep', 'barrage', 'beam', 'halo', 'shockwave', 'summon'], summon: 'minion_sentinel', weak: 'the throne cockpit in its chest' }),
  qelvaris: boss({ id: 'qelvaris', name: "ARCHON QEL'VARIS", title: 'The Star-Forger', hp: 3600, armor: 0, height: 2.3, radius: 0.55, frame: 'human', glow: '#ffd24a', speed: 6.5, hpPerPlayer: 0.5,
    primary: { kind: 'projectile', damage: 22, rate: 2.2, range: 60, speed: 45, sfx: 'star', fx: 'hex' },
    attacks: ['warp', 'gravity', 'orbs', 'summon', 'shockwave'], summon: 'minion_swarmer', weak: 'his orbiting halo' }),
};

export interface Encounter { at: [number, number]; r: number; waves: [string, number][][]; }
export interface Level {
  id: string; name: string; boss: string; map: MapDef; encounters: Encounter[]; arena: [number, number];
  intro: { img: string; text: string }[]; outro: { img: string; text: string }[];
}

// ---------------------------------------------------------------- level geometry helpers: floating space platforms
const plat = (x: number, z: number, w: number, d: number, mat: Box['mat'] = 'ground'): Box => ({ x, z, w, d, h: 0.01, mat });
const cover = (x: number, z: number, w = 3, d = 1, h = 1.6, mat: Box['mat'] = 'wall'): Box => ({ x, z, w, d, h, mat });
const pad = (x: number, z: number, vx: number, vy: number, vz = 0): Pad => ({ x, z, vx, vy, vz });

function level(id: string, name: string, tint: string, fog: string, sun: string, ambient: [string, string, number], particles: MapDef['particles'], extra: Partial<MapDef> = {}): MapDef {
  // start deck -> gantry -> mid platform -> bridge -> boss arena (round-ish, big)
  return {
    id, name, heroes: [], story: '', size: [95, 50],
    floors: [
      plat(-80, 0, 22, 26), plat(-62, 0, 16, 6, 'trim'), plat(-46, 0, 20, 34),
      plat(-30, -12, 14, 5, 'trim'), plat(-30, 12, 14, 5, 'trim'),
      plat(-14, 0, 22, 36), plat(4, 0, 16, 7, 'trim'),
      plat(40, 0, 60, 60), plat(40, 0, 44, 76), plat(40, 0, 76, 44),
    ],
    boxes: [
      cover(-84, -8, 3, 3, 2.5, 'accent'), cover(-84, 8, 3, 3, 2.5, 'accent'),
      cover(-50, -8), cover(-42, 6), cover(-46, 0, 1, 4, 1.4), cover(-52, 12, 4, 1, 2.2), cover(-40, -14, 4, 1, 2.2),
      cover(-18, -8), cover(-10, 8), cover(-14, 0, 1, 5, 1.3), cover(-20, 14, 5, 1, 2.4), cover(-8, -14, 5, 1, 2.4),
      cover(24, -18, 2, 2, 3, 'accent'), cover(24, 18, 2, 2, 3, 'accent'), cover(56, -18, 2, 2, 3, 'accent'), cover(56, 18, 2, 2, 3, 'accent'),
      cover(30, 0, 1, 6, 1.4), cover(50, 0, 1, 6, 1.4), cover(40, -26, 8, 1, 1.4), cover(40, 26, 8, 1, 1.4),
    ],
    props: [], pads: [pad(-72, 0, 12, 11), pad(-38, 0, 13, 11), pad(-6, 0, 16, 12)],
    spawns: { zenith: [-84, 0], umbra: [40, 0] }, point: [0, 0, 0],
    sun: { color: sun, intensity: 2.2, dir: [-0.4, 0.8, 0.35] }, ambient, fog: [fog, 80, 260], tint, particles, killY: -35, ...extra,
  };
}

export const LEVELS: Level[] = [
  {
    id: 'c1_shipyard', name: 'Kessler Shipyard', boss: 'boss_ironmaw', arena: [40, 0],
    map: level('c1_shipyard', 'Kessler Shipyard', '#4fc3ff', '#0b1630', '#e6f0ff', ['#7fa8ff', '#1a2440', 1.6], 'motes'),
    encounters: [
      { at: [-46, 0], r: 12, waves: [[['minion_lancer', 3]], [['minion_swarmer', 3], ['minion_lancer', 2]]] },
      { at: [-14, 0], r: 12, waves: [[['minion_lancer', 3], ['minion_swarmer', 2]], [['minion_sentinel', 1], ['minion_lancer', 3]]] },
    ],
    intro: [
      { img: 'img/cine_01.webp', text: "Far above Earth, the Syndicate's alien genius - Archon Qel'Varis, the Star-Forger - has been building weapons the size of mountains." },
      { img: 'img/cine_03.webp', text: 'The Zenith Vanguard answers. First target: the Kessler orbital shipyard, where his first Colossus is waking up.' },
    ],
    outro: [{ img: 'img/cine_05.webp', text: "Ironmaw falls into the atmosphere in pieces. On the wreck: coordinates to a foundry on the Moon." }],
  },
  {
    id: 'c2_lunar', name: 'Selene Foundry', boss: 'boss_reaper', arena: [40, 0],
    map: level('c2_lunar', 'Selene Foundry', '#b56dff', '#12101c', '#f0f0ff', ['#b0b0d0', '#2a2438', 1.5], 'sparks'),
    encounters: [
      { at: [-46, 0], r: 12, waves: [[['minion_lancer', 4]], [['minion_sentinel', 1], ['minion_swarmer', 3]]] },
      { at: [-14, 0], r: 12, waves: [[['minion_lancer', 4], ['minion_bomber', 2]], [['minion_sentinel', 2], ['minion_lancer', 2]]] },
    ],
    intro: [{ img: 'img/map_c2_lunar.webp', text: 'The Selene crater glows violet. Qel\'Varis is pouring molten starlight into something tall, thin - and sharp.' }],
    outro: [{ img: 'img/cine_06.webp', text: '"Impressive, little oath-keepers," the Star-Forger laughs across every channel. "Come find me in the Deep."' }],
  },
  {
    id: 'c3_ceres', name: 'Ceres Deep', boss: 'boss_leviathan', arena: [40, 0],
    map: level('c3_ceres', 'Ceres Deep', '#2de0c8', '#06161a', '#d6fff8', ['#4fd8c8', '#0a2024', 1.5], 'motes'),
    encounters: [
      { at: [-46, 0], r: 12, waves: [[['minion_bomber', 3], ['minion_swarmer', 2]], [['minion_lancer', 4]]] },
      { at: [-14, 0], r: 12, waves: [[['minion_sentinel', 2], ['minion_bomber', 3]], [['minion_swarmer', 4], ['minion_lancer', 2]]] },
    ],
    intro: [{ img: 'img/map_c3_ceres.webp', text: 'Inside a hollow asteroid, the Syndicate grew a machine hive. Something enormous is coiled in the dark.' }],
    outro: [{ img: 'img/map_c4_helios.webp', text: 'The Leviathan\'s memory core points sunward - to a crown of mirrors drinking the Sun itself.' }],
  },
  {
    id: 'c4_helios', name: 'Helios Crown', boss: 'boss_phoenix', arena: [40, 0],
    map: level('c4_helios', 'Helios Crown', '#ff9d2a', '#2a1206', '#fff0d0', ['#ffb870', '#3a1a0a', 1.7], 'embers'),
    encounters: [
      { at: [-46, 0], r: 12, waves: [[['minion_swarmer', 4], ['minion_lancer', 2]], [['minion_sentinel', 2], ['minion_bomber', 2]]] },
      { at: [-14, 0], r: 12, waves: [[['minion_lancer', 4], ['minion_swarmer', 3]], [['minion_sentinel', 2], ['minion_bomber', 3]]] },
    ],
    intro: [{ img: 'img/map_c4_helios.webp', text: "Helios Crown focuses the Sun into a single beam - aimed at the black star where Qel'Varis waits." }],
    outro: [{ img: 'img/cine_02.webp', text: 'With the Phoenix down, the path is open: through the eclipse, into the Citadel, to the Star-Forger\'s throne.' }],
  },
  {
    id: 'c5_citadel', name: 'Eclipse Citadel', boss: 'boss_genesis', arena: [40, 0],
    map: level('c5_citadel', 'Eclipse Citadel', '#b56dff', '#0c0614', '#e8d8ff', ['#8a5acc', '#150a24', 1.6], 'motes'),
    encounters: [
      { at: [-46, 0], r: 12, waves: [[['minion_sentinel', 2], ['minion_lancer', 3]], [['minion_swarmer', 4], ['minion_bomber', 3]]] },
      { at: [-14, 0], r: 12, waves: [[['minion_lancer', 5], ['minion_sentinel', 1]], [['minion_sentinel', 2], ['minion_swarmer', 4]]] },
    ],
    intro: [{ img: 'img/map_c5_citadel.webp', text: "The Eclipse Citadel. Qel'Varis sits enthroned inside his masterpiece - Omega Genesis." }],
    outro: [
      { img: 'img/cine_07.webp', text: 'The sun-sword falls. Omega Genesis breaks apart - and the Star-Forger falls with it.' },
      { img: 'img/cine_08.webp', text: 'Operation Starfall is complete. For now, the dawn holds.' },
    ],
  },
];
export const LEVEL: Record<string, Level> = Object.fromEntries(LEVELS.map(l => [l.id, l]));
export const CAMPAIGN_HEROES = ['tenkai', 'mirei', 'kaien', 'raijin', 'yuzu'];
