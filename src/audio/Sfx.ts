// Procedural positional sound: every effect is a small recipe of oscillator / noise layers with pitch + filter sweeps.
// No audio files ship with the game; everything is synthesised at runtime (so it also works offline in the desktop build).
import * as THREE from 'three';

type Layer = {
  n?: boolean;                 // noise instead of oscillator
  w?: OscillatorType; f?: number; f1?: number;   // start / end frequency
  d: number; v?: number; a?: number; dl?: number; // duration, volume, attack, delay
  lp?: number; lp1?: number; hp?: number; q?: number; bp?: number;
};
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
  fang: [{ n: true, d: 0.18, v: 0.35, bp: 3000, q: 1 }, { w: 'sawtooth', f: 300, f1: 120, d: 0.12, v: 0.12 }],
  flame: [{ n: true, d: 0.12, v: 0.12, lp: 900 }],
  flamestart: [{ n: true, d: 0.35, v: 0.35, lp: 400, lp1: 1600 }, { w: 'sawtooth', f: 60, d: 0.3, v: 0.1, lp: 300 }],
  punch: [{ w: 'sine', f: 140, f1: 45, d: 0.2, v: 0.55 }, { n: true, d: 0.12, v: 0.3, lp: 1500 }],
  blaster: [{ w: 'square', f: 900, f1: 300, d: 0.12, v: 0.15 }],
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
  interrupt: [{ w: 'square', f: 300, f1: 150, d: 0.2, v: 0.2 }, { n: true, d: 0.15, v: 0.2, bp: 2000, q: 2 }],
  denied: [{ w: 'square', f: 200, d: 0.08, v: 0.15 }, { w: 'square', f: 150, d: 0.1, v: 0.15, dl: 0.1 }],
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
  roar: [{ w: 'sawtooth', f: 110, f1: 70, d: 1.2, v: 0.35, lp: 900 }, { n: true, d: 1.2, v: 0.3, lp: 700 }],
  // ---------------- UI / announcer stingers
  announce: [{ w: 'triangle', f: 523, d: 0.2, v: 0.2 }, { w: 'triangle', f: 784, d: 0.35, v: 0.2, dl: 0.18 }],
  capture: [{ w: 'triangle', f: 659, d: 0.2, v: 0.2 }, { w: 'triangle', f: 880, d: 0.2, v: 0.2, dl: 0.15 }, { w: 'triangle', f: 1046, d: 0.4, v: 0.2, dl: 0.3 }],
  victory: [{ w: 'sawtooth', f: 523, d: 0.3, v: 0.12, lp: 3000 }, { w: 'sawtooth', f: 659, d: 0.3, v: 0.12, lp: 3000, dl: 0.25 }, { w: 'sawtooth', f: 784, d: 0.3, v: 0.12, lp: 3000, dl: 0.5 }, { w: 'sawtooth', f: 1046, d: 1.2, v: 0.14, lp: 3000, dl: 0.75 }],
  counter: [{ w: 'square', f: 880, d: 0.08, v: 0.12 }, { w: 'square', f: 1320, d: 0.15, v: 0.12, dl: 0.08 }],
  ult_ready: [{ w: 'sine', f: 660, d: 0.15, v: 0.15 }, { w: 'sine', f: 990, d: 0.25, v: 0.15, dl: 0.12 }],
  ui_click: [{ w: 'triangle', f: 900, f1: 1200, d: 0.05, v: 0.1 }],
  ui_hover: [{ w: 'sine', f: 1500, d: 0.03, v: 0.04 }],
  kill: [{ w: 'triangle', f: 1046, d: 0.08, v: 0.2 }, { w: 'triangle', f: 1568, d: 0.18, v: 0.2, dl: 0.07 }],
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

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    this.bus = this.ctx.createGain(); this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = 0.35;
    this.bus.connect(comp); this.musicBus.connect(comp); comp.connect(this.master); this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.value = v; }

  setListener(pos: THREE.Vector3, fwd: THREE.Vector3) {
    this.listener.copy(pos); this.listenerF.copy(fwd);
    const L = this.ctx?.listener;
    if (!L) return;
    if (L.positionX) { L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z; L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else (L as any).setPosition(pos.x, pos.y, pos.z);
  }

  play(id: string, pos?: { x: number; y: number; z: number }, vol = 1) {
    this.played[id] = (this.played[id] ?? 0) + 1;
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
