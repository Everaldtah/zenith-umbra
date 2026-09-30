// Positional sound. The web edition synthesises every effect from a small recipe of oscillator / noise layers with pitch +
// filter sweeps. The desktop edition plays the recorded bank (Bank.ts: generated, curated, mastered - assetgen/audio_finish
// .py) through an Overwatch-style mix: category buses, voice ducking, HRTF panning up close, air absorption and occlusion
// by distance and walls, a per-map reverb that crossfades to a room indoors, quad-delay wall reflections (Space.ts),
// threat-bucket mixing and louder enemy footsteps. Recipes stay as the fallback for anything the bank doesn't have.
import * as THREE from 'three';
import { FULL } from '../edition';
import { BASE } from '../render/Assets';
import { SampleBank } from './Bank';
import { impulse, QuadDelay, SPACE, ROOM, type Acoustic } from './Space';

type Layer = {
  n?: boolean;                 // noise instead of oscillator
  w?: OscillatorType; f?: number; f1?: number;   // start / end frequency
  d: number; v?: number; a?: number; dl?: number; // duration, volume, attack, delay
  lp?: number; lp1?: number; hp?: number; q?: number; bp?: number;
};
// desktop-played recipes (sounds with no recorded sample: UI stings, counter / victory cues) use sine and triangle only:
// square and sawtooth edges read as clicks on the output meter and as harshness on headphones
const R: Record<string, Layer[]> = {
  // ---------------- weapons
  cannon: [{ w: 'square', f: 180, f1: 60, d: 0.18, v: 0.35, lp: 1400 }, { n: true, d: 0.2, v: 0.4, lp: 2200, lp1: 300 }],
  star: [{ w: 'sine', f: 1500, f1: 2400, d: 0.14, v: 0.25 }, { w: 'triangle', f: 3000, f1: 3600, d: 0.1, v: 0.1, dl: 0.03 }],
  healbeam: [{ w: 'sine', f: 660, f1: 990, d: 0.45, v: 0.15, a: 0.05 }, { w: 'sine', f: 1320, d: 0.4, v: 0.06, a: 0.1 }],
  healbeam2: [{ w: 'sine', f: 440, f1: 330, d: 0.45, v: 0.15, a: 0.05 }, { w: 'triangle', f: 880, f1: 700, d: 0.4, v: 0.06, a: 0.1 }],
  talisman: [{ n: true, d: 0.12, v: 0.25, bp: 3500, q: 2 }, { w: 'triangle', f: 900, f1: 1300, d: 0.1, v: 0.1 }],
  blessing: [{ w: 'sine', f: 784, f1: 1046, d: 0.3, v: 0.2 }, { w: 'sine', f: 1568, d: 0.25, v: 0.08, dl: 0.05 }],
  katana: [{ n: true, d: 0.16, v: 0.35, hp: 2000, bp: 5000, q: 1.5 }, { w: 'sawtooth', f: 2200, f1: 800, d: 0.08, v: 0.06 }],
  thunder: [{ n: true, d: 0.3, v: 0.4, lp: 5000, lp1: 800 }, { w: 'square', f: 90, f1: 40, d: 0.25, v: 0.2 }],
  bow: [{ w: 'triangle', f: 220, f1: 110, d: 0.12, v: 0.25 }, { n: true, d: 0.25, v: 0.25, bp: 2500, q: 1 }],
  bowdraw: [{ w: 'sawtooth', f: 90, f1: 140, d: 0.6, v: 0.05, lp: 700 }],
  shotgun: [{ n: true, d: 0.35, v: 0.55, lp: 3000, lp1: 250 }, { w: 'square', f: 110, f1: 45, d: 0.2, v: 0.3 }],
  note: [{ w: 'sine', f: 880, f1: 830, d: 0.18, v: 0.2 }, { w: 'sine', f: 1318, d: 0.15, v: 0.08 }],
  needle: [{ w: 'sawtooth', f: 2600, f1: 1400, d: 0.07, v: 0.12, hp: 1200 }],
  stitch: [{ w: 'triangle', f: 500, f1: 900, d: 0.18, v: 0.18 }, { n: true, d: 0.1, v: 0.1, bp: 3000, q: 4 }],
  kunai: [{ n: true, d: 0.1, v: 0.3, bp: 4000, q: 3 }, { w: 'sine', f: 1800, f1: 900, d: 0.08, v: 0.08 }],
  // Hayate's koi-scale shuriken: a spinning whir with a bright ring (the recorded bank replaces it on desktop)
  shuriken: [{ n: true, d: 0.12, v: 0.26, bp: 5200, q: 4 }, { w: 'sine', f: 2600, f1: 1900, d: 0.1, v: 0.07 }, { w: 'triangle', f: 3400, f1: 3100, d: 0.05, v: 0.04, dl: 0.03 }],
  // a ragdoll hitting the floor
  bodyfall: [{ w: 'sine', f: 110, f1: 45, d: 0.22, v: 0.45 }, { n: true, d: 0.18, v: 0.3, lp: 500 }],
  fang: [{ n: true, d: 0.18, v: 0.35, bp: 3000, q: 1 }, { w: 'sawtooth', f: 300, f1: 120, d: 0.12, v: 0.12 }],
  flame: [{ n: true, d: 0.12, v: 0.12, lp: 900 }],
  flamestart: [{ n: true, d: 0.35, v: 0.35, lp: 400, lp1: 1600 }, { w: 'sawtooth', f: 60, d: 0.3, v: 0.1, lp: 300 }],
  punch: [{ w: 'sine', f: 140, f1: 45, d: 0.2, v: 0.55 }, { n: true, d: 0.12, v: 0.3, lp: 1500 }],
  // rocket hammer: a rising thruster roar through the wind-up, a heavy whoosh as the head comes round
  hammer: [{ n: true, d: 0.3, v: 0.22, bp: 500, q: 0.7 }, { w: 'sawtooth', f: 70, f1: 150, d: 0.28, v: 0.08, lp: 600 }, { n: true, d: 0.22, v: 0.3, bp: 1400, q: 1.2, dl: 0.18 }],
  blaster: [{ w: 'square', f: 900, f1: 300, d: 0.12, v: 0.15 }],
  // Gantetsu's rotary chainguns: a clattering burst per three rounds - Hinoko (left) low and throaty, Hanabi (right) brighter
  chaingun: [{ n: true, d: 0.07, v: 0.26, bp: 1700, q: 1.2 }, { w: 'square', f: 140, f1: 90, d: 0.06, v: 0.16, lp: 1500 }, { n: true, d: 0.05, v: 0.16, hp: 3000, dl: 0.035 }],
  chaingun2: [{ n: true, d: 0.07, v: 0.26, bp: 2600, q: 1.4 }, { w: 'square', f: 190, f1: 120, d: 0.06, v: 0.14, lp: 2200 }, { n: true, d: 0.05, v: 0.16, hp: 4000, dl: 0.035 }],
  spinup: [{ w: 'sawtooth', f: 60, f1: 260, d: 0.35, v: 0.1, lp: 900 }, { n: true, d: 0.3, v: 0.08, bp: 1200, q: 3 }],
  ignite: [{ n: true, d: 0.4, v: 0.28, lp: 600, lp1: 2400 }, { w: 'sine', f: 180, f1: 90, d: 0.3, v: 0.1 }],
  // ---------------- impacts & feedback
  hit: [{ w: 'triangle', f: 700, f1: 500, d: 0.05, v: 0.12 }],
  crit: [{ w: 'triangle', f: 1400, f1: 1100, d: 0.09, v: 0.2 }, { w: 'sine', f: 2100, d: 0.07, v: 0.1, dl: 0.02 }],
  boom: [{ n: true, d: 0.45, v: 0.45, lp: 1800, lp1: 150 }, { w: 'sine', f: 90, f1: 35, d: 0.4, v: 0.35 }],
  whiff: [{ n: true, d: 0.14, v: 0.12, bp: 1500, q: 1 }],
  reload: [{ w: 'square', f: 300, d: 0.04, v: 0.08 }, { w: 'square', f: 450, d: 0.04, v: 0.08, dl: 0.18 }],
  parry: [{ w: 'triangle', f: 2400, f1: 1800, d: 0.3, v: 0.3 }, { w: 'sine', f: 3600, d: 0.25, v: 0.12 }, { n: true, d: 0.1, v: 0.2, hp: 5000 }],
  decoy: [{ w: 'sine', f: 400, f1: 150, d: 0.4, v: 0.2 }, { n: true, d: 0.2, v: 0.15, bp: 1200, q: 3 }],
  down: [{ w: 'sawtooth', f: 400, f1: 80, d: 0.6, v: 0.18, lp: 1500 }],
  mechdown: [{ n: true, d: 1.2, v: 0.6, lp: 1200, lp1: 80 }, { w: 'sine', f: 70, f1: 25, d: 1.2, v: 0.5 }, { w: 'square', f: 180, f1: 40, d: 0.5, v: 0.15, dl: 0.3 }],
  botdown: [{ w: 'square', f: 800, f1: 100, d: 0.4, v: 0.12 }],
  eject: [{ n: true, d: 0.8, v: 0.35, hp: 400, lp: 4000, lp1: 1000 }, { w: 'sawtooth', f: 200, f1: 900, d: 0.6, v: 0.12 }],
  jump: [{ n: true, d: 0.08, v: 0.08, lp: 1200 }],
  dash: [{ n: true, d: 0.22, v: 0.22, bp: 900, q: 0.8 }, { w: 'sine', f: 220, f1: 110, d: 0.18, v: 0.08 }],
  mechjump: [{ n: true, d: 0.5, v: 0.35, lp: 800, lp1: 2000 }, { w: 'sawtooth', f: 60, f1: 120, d: 0.4, v: 0.15, lp: 500 }],
  doublejump: [{ w: 'sine', f: 600, f1: 1200, d: 0.12, v: 0.12 }, { n: true, d: 0.1, v: 0.1, hp: 3000 }],
  land: [{ n: true, d: 0.1, v: 0.15, lp: 600 }],
  mechland: [{ w: 'sine', f: 80, f1: 30, d: 0.35, v: 0.6 }, { n: true, d: 0.3, v: 0.4, lp: 700 }],
  step: [{ n: true, d: 0.05, v: 0.06, lp: 900 }],
  mechstep: [{ w: 'sine', f: 70, f1: 35, d: 0.25, v: 0.45 }, { n: true, d: 0.18, v: 0.25, lp: 500 }, { w: 'square', f: 220, f1: 180, d: 0.06, v: 0.04, dl: 0.05 }],
  pad: [{ w: 'sine', f: 200, f1: 900, d: 0.4, v: 0.25 }, { n: true, d: 0.3, v: 0.15, hp: 800 }],
  barrierup: [{ w: 'sine', f: 180, f1: 360, d: 0.3, v: 0.25 }, { w: 'triangle', f: 540, d: 0.25, v: 0.08 }],
  barrierhit: [{ w: 'triangle', f: 320, f1: 260, d: 0.08, v: 0.12 }],
  barrierbreak: [{ n: true, d: 0.6, v: 0.5, hp: 1500 }, { w: 'triangle', f: 900, f1: 100, d: 0.5, v: 0.25 }],
  healhit: [{ w: 'sine', f: 1046, f1: 1318, d: 0.18, v: 0.12 }],
  healthpack: [{ w: 'sine', f: 523, f1: 1046, d: 0.25, v: 0.22 }, { w: 'sine', f: 784, f1: 1568, d: 0.3, v: 0.14, dl: 0.06 }, { n: true, d: 0.15, v: 0.08, hp: 4000 }],
  interrupt: [{ w: 'triangle', f: 300, f1: 150, d: 0.2, v: 0.2 }, { n: true, d: 0.15, v: 0.2, bp: 2000, q: 2 }],
  denied: [{ w: 'triangle', f: 200, d: 0.08, v: 0.15 }, { w: 'triangle', f: 150, d: 0.1, v: 0.15, dl: 0.1 }],
  zonebreak: [{ n: true, d: 0.4, v: 0.35, hp: 2500 }, { w: 'triangle', f: 1600, f1: 200, d: 0.35, v: 0.18 }],
  // ---------------- abilities
  rocketfist: [{ n: true, d: 0.5, v: 0.35, lp: 1000, lp1: 3000 }, { w: 'sawtooth', f: 120, f1: 60, d: 0.4, v: 0.15, lp: 600 }],
  anchorhit: [{ w: 'square', f: 160, f1: 60, d: 0.25, v: 0.35 }, { n: true, d: 0.2, v: 0.3, lp: 1500 }],
  sunburst: [{ w: 'sine', f: 330, f1: 990, d: 0.6, v: 0.3 }, { w: 'triangle', f: 660, f1: 1980, d: 0.5, v: 0.12 }, { n: true, d: 0.5, v: 0.2, hp: 2000 }],
  ultcall: [{ w: 'sawtooth', f: 220, f1: 440, d: 0.5, v: 0.12, lp: 2000 }, { w: 'sawtooth', f: 277, f1: 554, d: 0.5, v: 0.1, lp: 2000 }, { w: 'sawtooth', f: 330, f1: 660, d: 0.5, v: 0.1, lp: 2000 }],
  slam: [{ n: true, d: 1, v: 0.7, lp: 2500, lp1: 100 }, { w: 'sine', f: 90, f1: 25, d: 0.9, v: 0.6 }],
  constellation: [{ w: 'sine', f: 1046, d: 0.5, v: 0.12 }, { w: 'sine', f: 1318, d: 0.5, v: 0.12, dl: 0.08 }, { w: 'sine', f: 1568, d: 0.6, v: 0.12, dl: 0.16 }],
  wish: [{ w: 'sine', f: 784, f1: 1568, d: 0.5, v: 0.2 }, { w: 'triangle', f: 2352, d: 0.3, v: 0.06, dl: 0.1 }],
  nova: [{ w: 'sine', f: 523, d: 1.4, v: 0.18, a: 0.1 }, { w: 'sine', f: 659, d: 1.4, v: 0.15, a: 0.1 }, { w: 'sine', f: 784, d: 1.4, v: 0.15, a: 0.1 }, { w: 'sine', f: 1046, d: 1.6, v: 0.12, a: 0.2 }],
  spiritstep: [{ n: true, d: 0.35, v: 0.25, bp: 3500, q: 1.5 }, { w: 'sine', f: 800, f1: 1600, d: 0.2, v: 0.08 }],
  seal: [{ w: 'triangle', f: 196, d: 0.8, v: 0.25 }, { w: 'sine', f: 392, d: 1.0, v: 0.15, dl: 0.05 }, { n: true, d: 0.2, v: 0.15, bp: 2500, q: 5 }],
  sanctuary: [{ w: 'sine', f: 261, d: 1.5, v: 0.2, a: 0.1 }, { w: 'sine', f: 392, d: 1.5, v: 0.15, a: 0.1 }, { w: 'sine', f: 523, d: 1.8, v: 0.12, a: 0.2 }],
  flashstep: [{ n: true, d: 0.2, v: 0.4, hp: 1500 }, { w: 'sawtooth', f: 3000, f1: 200, d: 0.2, v: 0.1 }],
  parrystance: [{ w: 'triangle', f: 1800, d: 0.25, v: 0.15 }, { n: true, d: 0.1, v: 0.1, hp: 6000 }],
  thunderclap: [{ n: true, d: 1.2, v: 0.6, lp: 6000, lp1: 200 }, { w: 'square', f: 60, f1: 30, d: 0.8, v: 0.25 }],
  chainlightning: [{ n: true, d: 0.2, v: 0.3, hp: 3000 }, { w: 'sawtooth', f: 1200, f1: 3000, d: 0.12, v: 0.08 }],
  sunhop: [{ w: 'sine', f: 400, f1: 1000, d: 0.3, v: 0.2 }, { n: true, d: 0.25, v: 0.15, hp: 1500 }],
  reveal: [{ w: 'sine', f: 1318, f1: 1760, d: 0.6, v: 0.2 }, { w: 'triangle', f: 2637, d: 0.4, v: 0.08 }, { n: true, d: 0.3, v: 0.15, hp: 4000 }],
  arrowrain: [{ n: true, d: 2.5, v: 0.2, hp: 2500, a: 0.3 }],
  arrowhit: [{ n: true, d: 0.1, v: 0.18, bp: 2500, q: 2 }],
  plating: [{ w: 'sawtooth', f: 80, f1: 160, d: 0.5, v: 0.2, lp: 700 }, { n: true, d: 0.4, v: 0.15, lp: 1200 }],
  charge: [{ n: true, d: 1, v: 0.4, lp: 600, lp1: 1500 }, { w: 'sawtooth', f: 55, f1: 90, d: 1, v: 0.2, lp: 400 }],
  pin: [{ w: 'square', f: 120, f1: 60, d: 0.2, v: 0.3 }],
  lance: [{ w: 'sawtooth', f: 80, f1: 400, d: 0.35, v: 0.3, lp: 2000 }, { n: true, d: 0.3, v: 0.3, bp: 1500, q: 2 }],
  singularity: [{ w: 'sine', f: 50, f1: 30, d: 2.5, v: 0.5, a: 0.2 }, { w: 'sawtooth', f: 200, f1: 60, d: 2.5, v: 0.08, lp: 600 }],
  implode: [{ n: true, d: 0.8, v: 0.6, lp: 3000, lp1: 100 }, { w: 'sine', f: 120, f1: 20, d: 0.7, v: 0.5 }],
  silence: [{ w: 'sine', f: 1760, f1: 440, d: 0.6, v: 0.25 }, { w: 'sine', f: 1760 * 1.5, f1: 660, d: 0.6, v: 0.12 }],
  bloodpact: [{ w: 'sine', f: 220, f1: 330, d: 0.5, v: 0.2 }, { w: 'sine', f: 262, f1: 392, d: 0.5, v: 0.15 }],
  requiem: [{ w: 'sine', f: 220, d: 2, v: 0.2, a: 0.2 }, { w: 'sine', f: 262, d: 2, v: 0.15, a: 0.3 }, { w: 'sine', f: 330, d: 2, v: 0.15, a: 0.4 }, { w: 'sine', f: 415, d: 2, v: 0.1, a: 0.5 }],
  // Mirei's Stellar Rebirth: a rising choir chord for the call, and a bright chime as each soul stands
  rebirthcast: [{ w: 'sine', f: 392, f1: 523, d: 1.8, v: 0.16, a: 0.15 }, { w: 'sine', f: 494, f1: 659, d: 1.8, v: 0.14, a: 0.2 }, { w: 'sine', f: 587, f1: 784, d: 2, v: 0.12, a: 0.25 }, { w: 'triangle', f: 1046, d: 1.2, v: 0.06, a: 0.5 }],
  rebirth: [{ w: 'sine', f: 1318, d: 0.8, v: 0.12, a: 0.02 }, { w: 'sine', f: 1568, d: 0.9, v: 0.1, a: 0.05 }, { w: 'triangle', f: 2093, d: 0.7, v: 0.06, a: 0.08 }],
  strings: [{ w: 'triangle', f: 1200, f1: 600, d: 0.5, v: 0.15 }, { w: 'triangle', f: 1210, f1: 605, d: 0.5, v: 0.12 }],
  yank: [{ n: true, d: 0.2, v: 0.25, bp: 1500, q: 2 }, { w: 'sine', f: 300, f1: 900, d: 0.15, v: 0.12 }],
  throw: [{ n: true, d: 0.15, v: 0.15, bp: 1200, q: 1 }],
  hexburst: [{ w: 'sawtooth', f: 180, f1: 90, d: 0.5, v: 0.2, lp: 1200 }, { n: true, d: 0.4, v: 0.2, bp: 800, q: 3 }],
  theater: [{ w: 'square', f: 196, d: 1, v: 0.1, lp: 1500 }, { w: 'square', f: 233, d: 1, v: 0.1, lp: 1500 }, { w: 'square', f: 277, d: 1, v: 0.1, lp: 1500 }],
  shadowstep: [{ n: true, d: 0.35, v: 0.3, lp: 800 }, { w: 'sine', f: 120, f1: 60, d: 0.3, v: 0.2 }],
  veil: [{ n: true, d: 0.6, v: 0.2, lp: 1500, lp1: 200 }],
  unveil: [{ n: true, d: 0.2, v: 0.15, hp: 2000 }],
  cut: [{ n: true, d: 0.15, v: 0.35, hp: 2500, bp: 5000, q: 1 }],
  chainthrow: [{ n: true, d: 0.4, v: 0.25, bp: 3000, q: 6 }, { w: 'square', f: 900, f1: 600, d: 0.3, v: 0.05 }],
  chainhit: [{ w: 'square', f: 600, f1: 200, d: 0.2, v: 0.2 }, { n: true, d: 0.2, v: 0.25, bp: 3000, q: 3 }],
  brand: [{ n: true, d: 0.5, v: 0.4, lp: 500, lp1: 2500 }, { w: 'sawtooth', f: 80, f1: 50, d: 0.4, v: 0.2, lp: 500 }],
  // festival drums: the Taiko Heartbeat opening double-strike, its pulse, and the Grand Dohyo's ceremonial clap + drum roll
  taiko: [{ w: 'sine', f: 110, f1: 45, d: 0.5, v: 0.6 }, { n: true, d: 0.12, v: 0.35, lp: 800 }, { w: 'sine', f: 92, f1: 40, d: 0.5, v: 0.5, dl: 0.18 }, { n: true, d: 0.12, v: 0.3, lp: 800, dl: 0.18 }],
  taikobeat: [{ w: 'sine', f: 95, f1: 42, d: 0.35, v: 0.3 }, { n: true, d: 0.08, v: 0.15, lp: 700 }],
  dohyo: [{ n: true, d: 0.08, v: 0.4, bp: 2500, q: 2 }, { n: true, d: 0.08, v: 0.4, bp: 2500, q: 2, dl: 0.22 }, { w: 'sine', f: 73, d: 1.6, v: 0.35, a: 0.05, dl: 0.4 }, { w: 'triangle', f: 146, d: 1.4, v: 0.1, dl: 0.4 }],
  // Mirei's Starwing Swoop: an airy rush with a rising chime
  swoop: [{ n: true, d: 0.45, v: 0.26, bp: 1600, q: 0.8 }, { w: 'sine', f: 988, f1: 1976, d: 0.35, v: 0.12 }, { w: 'sine', f: 1480, f1: 2960, d: 0.3, v: 0.06, dl: 0.06 }],
  roar: [{ w: 'sawtooth', f: 110, f1: 70, d: 1.2, v: 0.35, lp: 900 }, { n: true, d: 1.2, v: 0.3, lp: 700 }],
  // ---------------- UI / announcer stingers
  announce: [{ w: 'triangle', f: 523, d: 0.2, v: 0.2 }, { w: 'triangle', f: 784, d: 0.35, v: 0.2, dl: 0.18 }],
  capture: [{ w: 'triangle', f: 659, d: 0.2, v: 0.2 }, { w: 'triangle', f: 880, d: 0.2, v: 0.2, dl: 0.15 }, { w: 'triangle', f: 1046, d: 0.4, v: 0.2, dl: 0.3 }],
  victory: [{ w: 'triangle', f: 523, d: 0.3, v: 0.12, lp: 3000 }, { w: 'triangle', f: 659, d: 0.3, v: 0.12, lp: 3000, dl: 0.25 }, { w: 'triangle', f: 784, d: 0.3, v: 0.12, lp: 3000, dl: 0.5 }, { w: 'triangle', f: 1046, d: 1.2, v: 0.14, lp: 3000, dl: 0.75 }],
  counter: [{ w: 'triangle', f: 880, d: 0.08, v: 0.12 }, { w: 'triangle', f: 1320, d: 0.15, v: 0.12, dl: 0.08 }],
  ult_ready: [{ w: 'sine', f: 660, d: 0.15, v: 0.15 }, { w: 'sine', f: 990, d: 0.25, v: 0.15, dl: 0.12 }],
  ui_click: [{ w: 'triangle', f: 900, f1: 1200, d: 0.05, v: 0.1 }],
  ui_buy: [{ w: 'sine', f: 1318, d: 0.08, v: 0.12 }, { w: 'sine', f: 1760, d: 0.18, v: 0.12, dl: 0.07 }],
  ui_hover: [{ w: 'sine', f: 1500, d: 0.03, v: 0.04 }],
  kill: [{ w: 'triangle', f: 1046, d: 0.08, v: 0.2 }, { w: 'triangle', f: 1568, d: 0.18, v: 0.2, dl: 0.07 }],
};

type P3 = { x: number; y: number; z: number };
export interface PlayOpts {
  /** who made the sound (threat mixing, own-sound handling) */
  actor?: { id: number } | null;
  /** relation to the listener: own sounds play in your head, enemy footsteps louder than friendly ones (Overwatch) */
  rel?: 'self' | 'ally' | 'enemy';
  /** reverb / reflection send override */
  send?: number;
  /** playback-rate multiplier */
  rate?: number;
}
interface Loop { src: AudioBufferSourceNode; g: GainNode; lp: BiquadFilterNode; pan: PannerNode | null; id: string; seen: number }
interface Live { src: AudioBufferSourceNode; g: GainNode; t0: number; id: string }

/** simultaneous instances of one sound per category (the oldest fades out to make room) */
const CAP: Record<string, number> = { weapon: 5, impact: 4, step: 6, move: 3, ability: 4, feedback: 3, loop: 2, amb: 1, voice: 3 };
const MAX_LIVE = 48;

/** output meter (AudioWorklet on the final mix): peak, clipped samples, isolated clicks - the glitch detector the audio
 *  tests read, and the advanced performance overlay shows */
const METER_SRC = `
class ZuMeter extends AudioWorkletProcessor {
  constructor() { super(); this.peak = 0; this.clips = 0; this.clicks = 0; this.frames = 0; this.p1 = 0; this.p2 = 0; this.avg = 1e-4; this.n = 0; }
  process(inputs) {
    const ch = inputs[0];
    if (ch && ch.length) {
      const x = ch[0];
      for (let i = 0; i < x.length; i++) {
        const v = x[i], a = Math.abs(v);
        if (a > this.peak) this.peak = a;
        if (a >= 0.999) this.clips++;
        // a click: the waveform's curvature jumps far above its running level (and above an absolute floor)
        const c = Math.abs(v - 2 * this.p1 + this.p2);
        if (c > 0.35 && c > this.avg * 40) this.clicks++;
        this.avg += (c - this.avg) * 0.002;
        this.p2 = this.p1; this.p1 = v;
      }
      this.frames += x.length;
    }
    if (++this.n % 24 === 0) { this.port.postMessage({ peak: this.peak, clips: this.clips, clicks: this.clicks, frames: this.frames }); this.peak = 0; }
    return true;
  }
}
registerProcessor('zu-meter', ZuMeter);`;

// category -> bus + reference distance + reverb send + pitch variation
const CATS: Record<string, { ref: number; send: number; quad: number; pv: number }> = {
  weapon: { ref: 7, send: 0.22, quad: 0.55, pv: 0.06 }, impact: { ref: 3.5, send: 0.18, quad: 0.35, pv: 0.1 },
  ability: { ref: 7, send: 0.25, quad: 0.25, pv: 0.03 }, move: { ref: 3, send: 0.1, quad: 0.1, pv: 0.06 },
  step: { ref: 2.6, send: 0.08, quad: 0.05, pv: 0.08 }, feedback: { ref: 4, send: 0.05, quad: 0, pv: 0.02 },
  loop: { ref: 4, send: 0.12, quad: 0, pv: 0 }, amb: { ref: 1, send: 0, quad: 0, pv: 0 }, voice: { ref: 5, send: 0.12, quad: 0.05, pv: 0 },
};

export class Sfx {
  ctx: AudioContext | null = null;
  master!: GainNode;
  bus!: GainNode;
  musicBus!: GainNode;
  noiseBuf!: AudioBuffer;
  listener = new THREE.Vector3();
  listenerF = new THREE.Vector3(0, 0, -1);
  voices = 0;
  maxVoices = 40;
  volume = 0.7;
  played: Record<string, number> = {};
  unknown = new Set<string>();
  private throttle = new Map<string, number>();

  // ---- desktop edition: recorded bank, buses, space, threat mixing, loops
  bank = new SampleBank();
  voiceBus!: GainNode;
  ambBus!: GainNode;
  private sfxDuck!: GainNode; private ambDuck!: GainNode; private musicDuck!: GainNode;
  private revOut!: GainNode; private revIn!: GainNode; private roomIn!: GainNode; private outdoor!: ConvolverNode; private room!: ConvolverNode;
  private quad: QuadDelay | null = null;
  private indoor = 0;
  private hrtfLive = 0;
  /** Game: how blocked the path from the listener to a point is (0 = clear line of sight, 1 = fully walled off) */
  occlude: ((p: P3) => number) | null = null;
  /** Game: per-actor mix gain from the threat buckets (1 HIGH, 2 NORMAL, 4-10 LOW, the rest culled) */
  threat = new Map<number, number>();
  private loops = new Map<string, Loop>();
  private frame = 0;
  // ---- quality safeguards
  private live: Live[] = [];
  private uiBus!: GainNode; private announcerBus!: GainNode; private limiter!: DynamicsCompressorNode; private glue!: DynamicsCompressorNode;
  /** output meter totals since unlock (clipped samples, clicks) and the last window's peak */
  meter = { peak: 0, clips: 0, clicks: 0, frames: 0 };
  /** the audio thread's load (AudioRenderCapacity, where the runtime has it): degrades gracefully instead of crackling */
  load = { avg: 0, peak: 0, underruns: 0 };
  private degraded = false; private calmSince = 0;
  /** mix settings (Settings > Sound) */
  mix = { sfx: 1, voice: 1, announcer: 1, ambience: 0.8, ui: 0.8, hitmarker: 1, music: 0.6, preset: 'default' as 'default' | 'headphones' | 'speakers' | 'night', background: false };
  latencyHint: AudioContextLatencyCategory = 'interactive';

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    // 48 kHz: the rate the bank is mastered at (no resampling on the way out); the latency the player chose
    try { this.ctx = FULL ? new AC({ latencyHint: this.latencyHint, sampleRate: 48000 }) : new AC(); } catch { this.ctx = new AC(); }
    this.master = this.ctx.createGain(); this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    this.bus = this.ctx.createGain(); this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = 0.35;
    if (FULL) {
      // bus -> duck -> limiter; voice rides on top; reverb and reflections return after the ducks
      const C = this.ctx;
      // glue: a gentle bus compressor (holds the mix together without pumping); the brick-wall limiter sits after the
      // master volume so nothing the mix does can clip the output (clipping = crackle)
      comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
      this.glue = comp;
      this.limiter = C.createDynamicsCompressor();
      this.limiter.threshold.value = -1.5; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.001; this.limiter.release.value = 0.1;
      this.sfxDuck = C.createGain(); this.ambDuck = C.createGain(); this.musicDuck = C.createGain();
      this.voiceBus = C.createGain(); this.ambBus = C.createGain(); this.uiBus = C.createGain(); this.announcerBus = C.createGain();
      this.bus.gain.value = 0.8;                          // headroom: a dense fight sums many sounds
      this.bus.connect(this.sfxDuck); this.sfxDuck.connect(comp);
      this.musicBus.connect(this.musicDuck); this.musicDuck.connect(comp);
      this.ambBus.connect(this.ambDuck); this.ambDuck.connect(comp);
      this.voiceBus.connect(comp); this.announcerBus.connect(comp); this.uiBus.connect(comp);
      this.revIn = C.createGain(); this.roomIn = C.createGain(); this.revOut = C.createGain(); this.revOut.gain.value = 1;
      this.outdoor = C.createConvolver(); this.room = C.createConvolver();
      this.revIn.connect(this.outdoor); this.roomIn.connect(this.room);
      this.outdoor.connect(this.revOut); this.room.connect(this.revOut); this.revOut.connect(comp);
      this.quad = new QuadDelay(C, comp);
      this.setSpace('training');
      void this.bank.load(C, BASE);
    } else {
      this.bus.connect(comp); this.musicBus.connect(comp);
    }
    comp.connect(this.master);
    if (FULL) {
      this.master.connect(this.limiter); this.limiter.connect(this.ctx.destination);
      this.applyMix();
      void this.startMeter();
      this.watchLoad();
      document.addEventListener('visibilitychange', () => this.focusMute());
      addEventListener('blur', () => this.focusMute()); addEventListener('focus', () => this.focusMute());
    } else this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }

  // ---------------------------------------------------------------- mix & safeguards (desktop)
  /** Settings > Sound: category volumes, mix preset (headphones = HRTF 3D, speakers = plain panning, night = narrow
   *  dynamic range), background audio */
  applyMix() {
    if (!FULL || !this.ctx) return;
    const t = this.ctx.currentTime, m = this.mix, r = (g: GainNode, v: number) => g.gain.setTargetAtTime(v, t, 0.03);
    r(this.bus, 0.8 * m.sfx); r(this.voiceBus, m.voice); r(this.announcerBus, m.announcer); r(this.ambBus, 0.9 * m.ambience); r(this.uiBus, m.ui);
    r(this.musicBus, 0.35 * m.music / 0.6);
    const night = m.preset === 'night';
    this.glue.threshold.setTargetAtTime(night ? -30 : -18, t, 0.05); this.glue.ratio.setTargetAtTime(night ? 6 : 3, t, 0.05);
    this.focusMute();
  }
  private focusMute() {
    if (!this.ctx || !FULL) return;
    const away = !this.mix.background && (document.hidden || !document.hasFocus());
    this.master.gain.setTargetAtTime(away ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }
  private async startMeter() {
    const C = this.ctx!;
    try {
      const url = URL.createObjectURL(new Blob([METER_SRC], { type: 'application/javascript' }));
      await C.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(C, 'zu-meter', { numberOfOutputs: 1 });
      const silent = C.createGain(); silent.gain.value = 0;
      this.limiter.connect(node); node.connect(silent); silent.connect(C.destination);
      node.port.onmessage = e => { const d = e.data; this.meter.peak = d.peak; this.meter.clips = d.clips; this.meter.clicks = d.clicks; this.meter.frames = d.frames; };
    } catch { /* no worklet support: the safeguards still run */ }
  }
  /** Chromium's AudioRenderCapacity: under load, shed HRTF, reflections and voices before the audio thread underruns */
  private watchLoad() {
    const rc = (this.ctx as any).renderCapacity;
    if (!rc?.start) return;
    try {
      rc.addEventListener('update', (e: any) => {
        this.load.avg = e.averageLoad; this.load.peak = e.peakLoad; if (e.underrunRatio > 0) this.load.underruns++;
        const now = performance.now();
        if (e.underrunRatio > 0 || e.peakLoad > 0.85) { this.degraded = true; this.calmSince = now; }
        else if (this.degraded && e.peakLoad < 0.5 && now - this.calmSince > 8000) this.degraded = false;
      });
      rc.start({ updateInterval: 1 });
    } catch { /* not available */ }
  }
  /** make room: per-sound caps, then the global voice budget - the oldest fades out in 12 ms (never a hard cut) */
  private admit(id: string, cat: string) {
    const ctx = this.ctx!, t = ctx.currentTime;
    this.live = this.live.filter(l => l.t0 + (l.src.buffer?.duration ?? 0) / Math.max(0.1, l.src.playbackRate.value) > t);
    const cap = this.degraded ? Math.max(1, Math.floor((CAP[cat] ?? 4) / 2)) : CAP[cat] ?? 4;
    const same = this.live.filter(l => l.id === id);
    const budget = this.degraded ? 32 : MAX_LIVE;
    const drop = same.length >= cap ? same[0] : this.live.length >= budget ? this.live[0] : null;
    if (drop) {
      drop.g.gain.cancelScheduledValues(t); drop.g.gain.setTargetAtTime(0, t, 0.004);
      try { drop.src.stop(t + 0.03); } catch { /* already stopping */ }
      this.live = this.live.filter(l => l !== drop);
    }
  }

  setListener(pos: THREE.Vector3, fwd: THREE.Vector3) {
    this.listener.copy(pos); this.listenerF.copy(fwd);
    const L = this.ctx?.listener;
    if (!L) return;
    if (L.positionX) { L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z; L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else (L as any).setPosition(pos.x, pos.y, pos.z);
  }

  // ---------------------------------------------------------------- space (desktop)
  /** the map's outdoor reverb (indoor rooms share one tight room) */
  setSpace(mapId: string) {
    if (!FULL || !this.ctx) return;
    const a: Acoustic = SPACE[mapId] ?? SPACE.training;
    this.outdoor.buffer = impulse(this.ctx, a); this.room.buffer = impulse(this.ctx, ROOM);
    this.outdoorWet = a.wet;
    this.setIndoor(this.indoor, true);
  }
  private outdoorWet = 0.15;
  /** 0 = open sky over the listener, 1 = a roof: crossfades the outdoor reverb into the room */
  setIndoor(k: number, now = false) {
    if (!FULL || !this.ctx) return;
    this.indoor = k;
    const t = this.ctx.currentTime, tc = now ? 0.001 : 0.25;
    this.revIn.gain.setTargetAtTime(this.outdoorWet * (1 - k), t, tc);
    this.roomIn.gain.setTargetAtTime(ROOM.wet * k, t, tc);
  }
  /** distances to the nearest wall in front / right / behind / left of the listener */
  setReflections(d: number[]) { if (this.quad && this.ctx) this.quad.set(this.ctx, d); }
  /** voice lines duck the world a little so they cut through (critical lines duck more) */
  duck(amount: number, secs: number) {
    if (!FULL || !this.ctx) return;
    const t = this.ctx.currentTime, g = 1 - amount;
    for (const [n, k] of [[this.sfxDuck, 0.35], [this.ambDuck, 1], [this.musicDuck, 1]] as [GainNode, number][]) {
      n.gain.cancelScheduledValues(t); n.gain.setTargetAtTime(1 - (1 - g) * k, t, 0.04); n.gain.setTargetAtTime(1, t + secs, 0.3);
    }
  }

  play(id: string, pos?: { x: number; y: number; z: number }, vol = 1, o: PlayOpts = {}) {
    this.played[id] = (this.played[id] ?? 0) + 1;
    if (FULL && this.bank.ready && this.bank.has(id)) { this.playSample(id, pos, vol, o); return; }
    const recipe = R[id];
    if (!recipe) { if (id !== 'none') this.unknown.add(id); return; }
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // de-duplicate bursts of the same sound in the same instant
    const now = ctx.currentTime, last = this.throttle.get(id) ?? -1;
    if (now - last < 0.025) return;
    this.throttle.set(id, now);
    let dist = 0;
    if (pos) { dist = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z); if (dist > 70) return; }
    if (this.voices >= this.maxVoices) return;
    let out: AudioNode = this.bus;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 4; p.rolloffFactor = 1.1; p.maxDistance = 80;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else (p as any).setPosition(pos.x, pos.y, pos.z);
      p.connect(this.bus); out = p;
    }
    let end = 0;
    for (const L of recipe) {
      const t0 = now + (L.dl ?? 0), t1 = t0 + L.d, a = L.a ?? 0.005;
      const g = ctx.createGain();
      const v = (L.v ?? 0.2) * vol;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t0 + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t1);
      let src: AudioScheduledSourceNode;
      if (L.n) {
        const b = ctx.createBufferSource(); b.buffer = this.noiseBuf; b.loop = true; b.playbackRate.value = 0.8 + Math.random() * 0.4; src = b;
      } else {
        const o = ctx.createOscillator(); o.type = L.w ?? 'sine';
        const f = (L.f ?? 440) * (0.97 + Math.random() * 0.06);
        o.frequency.setValueAtTime(f, t0);
        if (L.f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, L.f1), t1);
        src = o;
      }
      let node: AudioNode = src;
      const filt = (type: BiquadFilterType, f: number, f1?: number) => {
        const bq = ctx.createBiquadFilter(); bq.type = type; bq.frequency.setValueAtTime(f, t0); if (f1) bq.frequency.exponentialRampToValueAtTime(f1, t1);
        bq.Q.value = L.q ?? 0.7; node.connect(bq); node = bq;
      };
      if (L.lp) filt('lowpass', L.lp, L.lp1);
      if (L.hp) filt('highpass', L.hp);
      if (L.bp) filt('bandpass', L.bp);
      node.connect(g); g.connect(out);
      src.start(t0); src.stop(t1 + 0.02);
      end = Math.max(end, t1);
    }
    this.voices++;
    setTimeout(() => this.voices--, (end - now) * 1000 + 50);
  }

  /** mix gain, air absorption and occlusion for a sound at pos (shared by one-shots, loops and voice) */
  private spatial(pos: P3 | undefined, cat: string, o: PlayOpts) {
    const C = CATS[cat] ?? CATS.ability;
    let gain = 1, cutoff = 20000, dist = 0, occ = 0;
    if (o.actor && o.rel !== 'self') gain *= this.threat.get(o.actor.id) ?? 1;
    if (cat === 'step' && o.rel) gain *= o.rel === 'enemy' ? 1.45 : o.rel === 'ally' ? 0.55 : 0.8;
    if (pos && o.rel !== 'self') {
      dist = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
      // air absorption: far sounds lose their top end
      cutoff = 20000 * Math.pow(Math.max(0, 1 - dist / 110), 1.8) + 1400;
      occ = this.occlude ? this.occlude(pos) : 0;
      if (occ > 0) { cutoff = Math.min(cutoff, 20000 * (1 - 0.93 * occ) + 700); gain *= 1 - 0.5 * occ; }
    }
    return { C, gain, cutoff, dist, occ };
  }

  private makePanner(ctx: AudioContext, pos: P3, ref: number, near: boolean) {
    const p = ctx.createPanner();
    // HRTF (3D over headphones) for the closest few; plain panning for the rest, for speakers, or under load
    const hrtf = near && this.hrtfLive < 6 && !this.degraded && this.mix.preset !== 'speakers';
    p.panningModel = hrtf ? 'HRTF' : 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = 1.15; p.maxDistance = 140;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else (p as any).setPosition(pos.x, pos.y, pos.z);
    return { p, hrtf };
  }

  private playSample(id: string, pos: P3 | undefined, vol: number, o: PlayOpts) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const meta = this.bank.meta(id)!, cat = meta.cat;
    const now = ctx.currentTime, last = this.throttle.get(id) ?? -1;
    if (now - last < (cat === 'weapon' ? 0.03 : 0.02)) return;
    this.throttle.set(id, now);
    if (pos && o.rel !== 'self' && Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z) > 110) return;
    const buf = this.bank.sfx(id); if (!buf) return;
    const S = this.spatial(pos, cat, o);
    if (S.gain < 0.05) return;           // culled by the threat mix
    this.admit(id, cat);
    const src = ctx.createBufferSource(); src.buffer = buf;
    // pitch spread kept small (resampling a transient far off its rate smears it)
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() - 0.5) * 2 * Math.min(0.03, S.C.pv));
    const g = ctx.createGain();
    const v = vol * S.gain * (o.rel === 'self' ? 0.9 : 1) * (id.startsWith('ui_') ? this.mix.ui : id === 'hit' || id === 'crit' || id === 'kill' ? this.mix.hitmarker : 1);
    // a 2 ms fade-in: whatever the first sample is, the sound never starts with a click
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(v, now + 0.002);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = S.cutoff; lp.Q.value = 0.5;
    src.connect(lp); lp.connect(g);
    let hrtf = false;
    if (pos && o.rel !== 'self') {
      const { p, hrtf: h } = this.makePanner(ctx, pos, S.C.ref, S.dist < 28); hrtf = h;
      g.connect(p); p.connect(this.bus);
    } else g.connect(this.bus);
    // space: more reverb with distance (the far layer of a gunshot is mostly tail), reflections for close weapons
    const send = (o.send ?? S.C.send) * (1 + Math.min(1.2, S.dist / 45)) * (1 + S.occ * 0.6);
    if (send > 0.01) { const r = ctx.createGain(); r.gain.value = send; g.connect(r); r.connect(this.revIn); r.connect(this.roomIn); }
    if (this.quad && S.C.quad && S.dist < 40 && !this.degraded) { const q = ctx.createGain(); q.gain.value = S.C.quad * (1 - S.dist / 40); g.connect(q); q.connect(this.quad.input); }
    this.voices++; if (hrtf) this.hrtfLive++;
    this.live.push({ src, g, t0: now, id });
    src.onended = () => { this.voices--; if (hrtf) this.hrtfLive--; src.disconnect(); g.disconnect(); };
    src.start(now);
  }

  /** a voice line on the voice bus (the director decides who hears what); returns its duration */
  playLine(buf: AudioBuffer, pos: P3 | null, vol: number, o: PlayOpts & { radio?: boolean; ult?: boolean; announcer?: boolean }, onEnd?: () => void): { stop: () => void; dur: number } | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    const S = this.spatial(pos ?? undefined, 'voice', { ...o, actor: null });
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain();
    // enemy ult warnings stay loud wherever they come from (you have to hear them to react)
    const gv = vol * (o.ult ? Math.max(0.85, S.gain) : S.gain);
    g.gain.setValueAtTime(0, ctx.currentTime); g.gain.linearRampToValueAtTime(gv, ctx.currentTime + 0.004);
    let node: AudioNode = src;
    if (o.radio) {
      // a mech pilot speaks over the cockpit comms: band-limited with a little grit
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 320;
      const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 3600;
      // gentle drive, oversampled: a hard curve at the native rate aliases into fizz
      const sh = ctx.createWaveShaper(); const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; c[i] = Math.tanh(x * 1.3) / Math.tanh(1.3); } sh.curve = c; sh.oversample = '4x';
      node.connect(hp); hp.connect(bp); bp.connect(sh); node = sh;
    }
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.ult ? 20000 : S.cutoff;
    node.connect(lp); lp.connect(g);
    if (pos && o.rel !== 'self') {
      const { p } = this.makePanner(ctx, pos, o.ult ? 30 : 6, false);
      g.connect(p); p.connect(this.voiceBus);
    } else g.connect(o.announcer ? this.announcerBus : this.voiceBus);
    const r = ctx.createGain(); r.gain.value = 0.1; g.connect(r); r.connect(this.revIn); r.connect(this.roomIn);
    src.onended = () => { src.disconnect(); g.disconnect(); onEnd?.(); };
    src.start();
    return { stop: () => { try { g.gain.setTargetAtTime(0, ctx.currentTime, 0.03); src.stop(ctx.currentTime + 0.12); } catch { /* ended */ } }, dur: buf.duration };
  }

  // ---------------------------------------------------------------- loops (desktop): beams, flames, grinding, wind, auras, beds
  beginFrame() { this.frame++; }
  /** keep a looping sound going this frame (call every frame it should play); loops not refreshed fade out */
  loop(key: string, id: string, pos: P3 | null, vol = 1, o: PlayOpts = {}) {
    const ctx = this.ctx;
    if (!FULL || !ctx || ctx.state !== 'running' || !this.bank.ready) return;
    let L = this.loops.get(key);
    if (L && L.id !== id) { this.stopLoop(key); L = undefined; }
    const cat = key.startsWith('amb') ? 'amb' : 'loop';
    const S = this.spatial(pos ?? undefined, cat, o);
    const t = ctx.currentTime;
    if (!L) {
      const buf = this.bank.sfx(id); if (!buf) return;
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const g = ctx.createGain(); g.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = S.cutoff;
      src.connect(lp); lp.connect(g);
      let pan: PannerNode | null = null;
      const bus = cat === 'amb' ? this.ambBus : this.bus;
      if (pos && o.rel !== 'self') { pan = this.makePanner(ctx, pos, CATS[cat].ref + 2, false).p; g.connect(pan); pan.connect(bus); } else g.connect(bus);
      if (cat !== 'amb') { const r = ctx.createGain(); r.gain.value = 0.12; g.connect(r); r.connect(this.revIn); r.connect(this.roomIn); }
      src.start(t, Math.random() * buf.duration);
      L = { src, g, lp, pan, id, seen: this.frame };
      this.loops.set(key, L);
    }
    L.seen = this.frame;
    L.g.gain.setTargetAtTime(vol * S.gain, t, 0.08);
    L.lp.frequency.setTargetAtTime(S.cutoff, t, 0.1);
    if (o.rate) L.src.playbackRate.setTargetAtTime(o.rate, t, 0.1);
    if (L.pan && pos) { L.pan.positionX.value = pos.x; L.pan.positionY.value = pos.y; L.pan.positionZ.value = pos.z; }
  }
  /** fade out loops nobody refreshed this frame */
  endFrame() { for (const [k, L] of this.loops) if (L.seen !== this.frame) this.stopLoop(k); }
  stopLoop(key: string) {
    const L = this.loops.get(key); if (!L || !this.ctx) return;
    this.loops.delete(key);
    const t = this.ctx.currentTime;
    L.g.gain.setTargetAtTime(0, t, 0.08);
    L.src.stop(t + 0.5);
    L.src.onended = () => { L.src.disconnect(); L.g.disconnect(); };
  }
  stopAllLoops() { for (const k of [...this.loops.keys()]) this.stopLoop(k); }

  // ---------------------------------------------------------------- music: slow pad + pulse, per-map key
  private musicTimer: number | null = null;
  music(mood: 'menu' | 'zenith' | 'umbra' | 'battle' | null) {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
    if (!mood || !this.ctx) return;
    const ctx = this.ctx;
    const prog: Record<string, number[][]> = {
      menu: [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]],
      zenith: [[60, 64, 67], [57, 60, 64], [65, 69, 72], [62, 67, 71]],
      umbra: [[57, 60, 64], [58, 62, 65], [55, 58, 62], [52, 56, 59]],
      battle: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]],
    };
    const chords = prog[mood];
    let i = 0;
    const bar = mood === 'battle' ? 2.4 : 4;
    const playBar = () => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const t = ctx.currentTime + 0.05, ch = chords[i++ % chords.length];
      for (const n of ch) {
        const f = 440 * Math.pow(2, (n - 69) / 12);
        for (const det of [-4, 4]) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
          const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
          const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.025, t + bar * 0.3); g.gain.linearRampToValueAtTime(0.0001, t + bar * 1.05);
          o.connect(lp); lp.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + bar * 1.1);
        }
      }
      // bass pulse
      const bf = 440 * Math.pow(2, (ch[0] - 12 - 69) / 12);
      const steps = mood === 'battle' ? 8 : 4;
      for (let s = 0; s < steps; s++) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = bf;
        const g = ctx.createGain(); const ts = t + s * bar / steps;
        g.gain.setValueAtTime(0.0001, ts); g.gain.exponentialRampToValueAtTime(0.06, ts + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, ts + bar / steps * 0.9);
        o.connect(g); g.connect(this.musicBus); o.start(ts); o.stop(ts + bar / steps);
      }
    };
    playBar();
    this.musicTimer = window.setInterval(playBar, bar * 1000);
  }
}

export const SFX_IDS = Object.keys(R);
export const sfx = new Sfx();
