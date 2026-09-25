// "The Oath at Dawn" - 2D anime cut. One entry per screenplay shot (ids = cinematic/script.py). Everything is 2D:
// painted plates, drawn character keys from the game models (played on 2s), physics particles, hand-built anime FX.
import { T, type Stage2D } from './stage2d';
import MOUTHS from './mouths.json';
import type { Particles, Kind } from './particles';
import * as F from './fx2d';
import { ease, easeOut, easeInOut, seg, clamp, lerp, glow, alpha } from '../paint/core';
import { sfx } from '../../audio/Sfx';

export const ART = 'film2d/art/', BGP = 'film2d/bg/';
export interface Ui { card(name: string, title: string, color: string): void; }
export interface C { st: Stage2D; P: Particles; ui: Ui; base: string; t: number; dt: number; T: number; k: number; now: number; talk: string; }
export interface Shot { update(c: C): void; at?: [number, (c: C) => void][]; enter?(c: C): void; card?: [string, number][]; }

// ---------------------------------------------------------------- camera + drawing helpers
let cam = { x: 0, y: 0, zoom: 1, rot: 0 };
let shake = 0;
let spriteN = 0;
let post = { impact: 0, flash: 0, tint: '#ffffff', sat: 1.08, fade: 0 };
export function resetFrame() { spriteN = 0; post = { impact: 0, flash: 0, tint: '#ffffff', sat: 1.08, fade: 0 }; }
export function postState() { return post; }
export function shakeNow(c: C) { const s = shake; shake *= Math.pow(0.02, c.dt); return s; }
/** background plate + camera: pan (px), zoom, dutch angle */
function bg(c: C, name: string, x = 0, y = 0, zoom = 1, o: { layers?: boolean; tint?: string; bright?: number; rot?: number } = {}) {
  const s = shakeNow(c);
  cam = { x: x + (Math.random() - 0.5) * s * 40, y: y + (Math.random() - 0.5) * s * 40, zoom, rot: o.rot ?? 0 };
  c.st.plate.set(`${c.base}${BGP}${name}`, cam, o);
}
const W = 1920, H = 1080;
/** screen position of a world point under the current camera (mid layer) */
function scr(x: number, y: number): [number, number] { return [W / 2 + (x - W / 2) * cam.zoom - cam.x, H / 2 + (y - H / 2) * cam.zoom + cam.y]; }
/** draw character key `pose` of `id`, feet at world (x, y), height h */
function ch(c: C, id: string, pose: string, x: number, y: number, h: number, o: Parameters<Stage2D['sprites'][0]['set']>[4] = {}) {
  const s = c.st.sprites[spriteN++]; if (!s) return;
  const [sx, sy] = scr(x, y), url = `${c.base}${ART}${id}_${pose}.webp`;
  s.set(url, sx, sy, h * cam.zoom, { z: spriteN, ...o });
  if (pose === 'face' && c.talk === id && (o.opacity ?? 1) > 0) lipFlap(c, id, url, sx, sy, h * cam.zoom, !!o.flip);
}
/** limited-animation lip flap: the flat anime open-mouth shape over the drawing's own closed mouth, open/closed on 3s */
function lipFlap(c: C, id: string, url: string, sx: number, sy: number, h: number, flip: boolean) {
  const m = (MOUTHS as Record<string, number[]>)[id], t = T(url); if (!m || !t) return;
  const phase = Math.floor(c.t * 8) % 3; if (phase === 0) return;          // closed: the drawing's own mouth line
  const img = t.image as { width: number; height: number }, w = h * img.width / img.height;
  const mx = sx + (m[0] - 0.5) * w * (flip ? -1 : 1), my = sy - (1 - m[1]) * h, mw = m[2] * w * (phase === 2 ? 1 : 0.8), mh = mw * (phase === 2 ? 0.62 : 0.4);
  const g = fx(c); g.save();
  g.fillStyle = '#5a1822'; g.strokeStyle = '#1a0a10'; g.lineWidth = Math.max(1.5, mw * 0.08);
  g.beginPath(); g.moveTo(mx - mw / 2, my); g.quadraticCurveTo(mx, my - mh * 0.35, mx + mw / 2, my); g.quadraticCurveTo(mx, my + mh * 1.1, mx - mw / 2, my); g.closePath();
  g.fill(); g.stroke();
  g.fillStyle = '#d8606e'; g.beginPath(); g.ellipse(mx, my + mh * 0.55, mw * 0.24, mh * 0.2, 0, 0, Math.PI * 2); g.fill();   // tongue
  g.restore();
}
/** held key + stride: anime runs / walks / flights hold one drawing and sell the motion with bob, lean and squash on 2s */
function stride(c: C, kind: 'run' | 'walk' | 'fly') {
  const q = Math.floor(c.t * 12) / 12, rate = kind === 'run' ? 3.2 : kind === 'walk' ? 1.8 : 0.9;
  const b = Math.abs(Math.sin(q * Math.PI * rate));
  return { pose: kind === 'fly' ? 'fly0' : `${kind}1`, dy: -b * (kind === 'run' ? 22 : kind === 'walk' ? 10 : 16), rot: kind === 'run' ? -0.05 : 0, squash: kind === 'fly' ? 0 : (1 - b) * 0.03 };
}
/** a cycle on 2s: frame index of an n-frame cycle at 12 drawings per second */
const on2 = (t: number, n: number, fps = 12) => Math.floor(t * fps) % n;
/** held key drawings: [time, pose] - the drawing holds until the next key (limited animation) */
function keysAt(t: number, keys: [number, string][]) { let p = keys[0][1]; for (const [k, v] of keys) if (t >= k) p = v; return p; }
/** lip-flap: while `id` is speaking, alternate the face with its open-mouth key on 3s */
const face = (_c: C, _id: string) => 'face';   // lip flap is drawn over the portrait by ch()
const fx = (c: C) => c.st.fx;
function snd(id: string, v = 1) { sfx.play(id, undefined, v); }
function impact(c: C, kind: 1 | 2 | 3 = 1, s = 0.6) { post.impact = kind; shake = Math.max(shake, s); impHold = 0.1; impKind = kind; }
let impHold = 0, impKind = 0;
export function impactTick(dt: number) { if (impHold > 0) { impHold -= dt; post.impact = impKind; } }
function flash(v = 0.8) { flashV = v; }
let flashV = 0;
export function flashTick(dt: number) { flashV *= Math.pow(0.002, dt); post.flash = Math.max(post.flash, flashV); }
function field(c: C, k: Kind, rate: number, o: Record<string, unknown> = {}) { c.P.field(k, rate, c.dt, o as never); }
function sky(c: C, stops: [number, string][]) {
  const g = c.st.bg.createLinearGradient(0, 0, 0, H); for (const [o, col] of stops) g.addColorStop(o, col);
  c.st.bg.fillStyle = g; c.st.bg.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------- the shots
const ACT = (lines: [string, number][]) => lines;
export const SHOTS: Record<string, Shot> = {
  // ================================================================ I. The world that sang
  s01: { card: ACT([['EPISODE:00', 60], ['THE OATH', 150], ['AT DAWN', 150]]),
    update: c => { bg(c, 'amatsu_dawn', lerp(-120, 120, ease(c.k)), lerp(40, -20, ease(c.k)), lerp(1.05, 1.15, c.k), { layers: true }); field(c, 'petal', 6); F.flare(fx(c), 1500, 250, 0.8 + Math.sin(c.t) * 0.05); } },
  s02: { update: c => { bg(c, 'amatsu_night', 0, lerp(-80, 40, ease(c.k)), 1.08, { layers: true }); field(c, 'star', 12); field(c, 'mote', 8, { col: '#fff3c0' });
      for (const [i, x] of [700, 860, 1020, 1180].entries()) ch(c, 'nocturne', 'cast0', x, 930 + (i % 2) * 20, 380, { tint: '#c8d0ff', sil: 0.6, breath: 1.2 });
      const g = fx(c); g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = alpha('#fff3b0', 0.7 * seg(c.k, 0.1, 0.5)); g.lineWidth = 2;
      const pts = [[500, 200], [700, 140], [900, 230], [1100, 120], [1350, 210], [1500, 150]];
      g.beginPath(); pts.slice(0, 1 + Math.floor(seg(c.k, 0.1, 0.9) * pts.length)).forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
      for (const [x, y] of pts) glow(g, x, y, 22, '#fff3b0', 0.8); g.restore(); },
    at: [[0.2, () => snd('constellation')]] },
  s03: { update: c => { bg(c, 'amatsu_night', -200, -60, 1.3, { layers: true, bright: 0.9 }); field(c, 'mote', 18, { col: '#bfe8ff' });
      ch(c, 'mirei', 'face', 960, 1180, 1250 * lerp(1, 1.06, ease(c.k)), { breath: 1.4, sway: 1, rim: '#3a6aff' }); },
    at: [[0.4, () => snd('note', 0.5)]] },
  s04: { update: c => { bg(c, 'amatsu_night', 100, -40, 1.15, { layers: true }); field(c, 'star', 10);
      ch(c, 'nocturne', 'idle', 820, 960, 620, { tint: '#f8f0ff', rim: '#ffe0a0' }); ch(c, 'mirei', 'idle', 1120, 960, 540, { flip: true, rim: '#bfe8ff' }); } },
  s05: { update: c => { bg(c, 'shrine_gate', lerp(0, -60, c.k), 0, 1.1, { layers: true }); field(c, 'talisman', 3, { size: 10 }); c.P.wind = 60;
      ch(c, 'kaien', 'idle', 960, 990, 680, { wind: 0.4, sway: 1 }); },
    enter: c => c.ui.card('KAIEN', 'The Warding Monk', '#e8e4ff') },
  s06: { update: c => { bg(c, 'sacred_tree', 0, lerp(160, -80, ease(c.k)), lerp(1.2, 1.05, ease(c.k)), { layers: true }); field(c, 'petal', 14); field(c, 'mote', 10, { col: '#ffc8e0' }); } },
  s07: { update: c => { bg(c, 'shrine_gate', -140, 0, 1.2, { layers: true, tint: '#9aa0c8' });
      ch(c, 'kaien', 'cast0', 1250, 980, 560, { flip: true, rim: '#ffe28a' }); ch(c, 'kagemaru', 'idle', 620, 1000, 620, { tint: '#8a8aa8', breath: 0.6 });
      glow(fx(c), 1230, 760, 90, '#ffe28a', 0.6); },
    enter: c => c.ui.card('KAGEMARU', 'The Shade Fang', '#9d7bff') },
  s08: { update: c => { bg(c, 'kurogane_street', lerp(-160, 160, c.k), 0, 1.12, { layers: true }); c.P.ground = 1000; field(c, 'rain', 520); } },
  s09: { update: c => { bg(c, 'dueling_ring', 0, 0, lerp(1.1, 1.25, ease(c.k)), { layers: true }); field(c, 'rain', 200);
      const p = keysAt(c.t, [[0, 'idle'], [1.3, 'attack0'], [1.55, 'attack1'], [1.7, 'attack2'], [2.3, 'attack3'], [3.1, 'idle']]);
      ch(c, 'raijin', p, 900, 1000, 720, { rim: '#8ad8ff', charged: undefined } as never);
      if (c.t > 1.6 && c.t < 2.0) { F.slash(fx(c), 1100, 700, 300, -2.4, 0.4, seg(c.t, 1.6, 2.0), '#8ad8ff'); F.speedLines(fx(c), 0, c.t, { a: 0.4 }); } },
    enter: c => c.ui.card('RAIJIN', 'The Stormblade', '#8ad8ff'),
    at: [[1.6, c => { snd('katana'); impact(c, 1, 0.5); snd('crit'); c.P.emit('spark', 30, 1150, 640, { speed: 900, col: '#bfe8ff', size: 6 }); }]] },
  s10: { update: c => { bg(c, 'seal_cavern', 0, lerp(40, -40, c.k), lerp(1.05, 1.18, ease(c.k)), { layers: true, bright: 0.8 + 0.25 * Math.sin(c.t * 3) });
      glow(fx(c), 960, 560, 360, '#ff2a3a', 0.25 + 0.2 * Math.sin(c.t * 3)); field(c, 'dust', 4, { col: '#6a4a4a' }); },
    at: [[0.8, () => snd('mechstep', 0.35)], [2.3, () => snd('mechstep', 0.35)]] },
  s11: { update: c => { bg(c, 'hangar', 0, lerp(260, -60, ease(c.k)), 1.1, { layers: true });
      ch(c, 'tenkai', 'idle', 640, 1060, 980, { breath: 0.2, sway: 0.1 }); ch(c, 'gorgoth', 'idle', 1320, 1060, 1000, { flip: true, breath: 0.2, sway: 0.1 });
      if (Math.random() < 0.3) c.P.emit('spark', 6, 800 + Math.random() * 400, 300 + Math.random() * 300, { speed: 400, dir: Math.PI / 2, cone: 1.2, col: '#ffcc66', size: 4 }); },
    at: [[0.3, () => snd('reload', 0.5)], [1.4, () => snd('reload', 0.5)]] },
  s12: { update: c => { bg(c, 'hangar', -200, 160, 1.3, { layers: true });
      ch(c, 'tenkai', 'idle', 1250, 1400, 1700, { breath: 0.1, sway: 0 }); ch(c, 'haruto', 'idle', 760, 1020, 600, { rim: '#ffd76a' }); },
    enter: c => c.ui.card('HARUTO DAIMON', "Tenkai-Oh's pilot", '#f4d35e') },
  s13: { update: c => { bg(c, 'hangar', 120, 60, 1.25, { layers: true, tint: '#ffe4c8' });
      ch(c, 'vorn', face(c, 'vorn'), 1180, 1250, 1150, { flip: true, breath: 0.8 }); ch(c, 'haruto', 'face', 640, 1300, 900, { breath: 1, sway: 0.4 }); },
    enter: c => c.ui.card('WARLORD VORN', "Haruto's instructor", '#ff3355') },
  s14: { update: c => { bg(c, 'academy_sunset', lerp(-80, 40, c.k), 0, 1.1, { layers: true });
      const p = keysAt(c.t, [[0, 'idle'], [0.6, 'attack0'], [1.2, 'attack1'], [2.4, 'attack3'], [3.0, 'attack2']]);
      ch(c, 'yuzu', p, 820, 1000, 640, { rim: '#ffd27a' }); ch(c, 'brother', 'idle', 1260, 1000, 600, { flip: true });
      if (c.t > 2.4 && c.t < 2.8) F.beam(fx(c), [900, 690], [lerp(900, 2000, seg(c.t, 2.4, 2.6)), 660], 6, '#ffd27a', 1, c.t); },
    enter: c => c.ui.card('YUZU', 'The Dawnshot', '#ffb347'),
    at: [[0.6, () => snd('bowdraw')], [2.4, () => snd('bow')]] },
  s15: { update: c => { bg(c, 'academy_sunset', 300, -120, 1.5, { layers: true });
      const g = fx(c), cut = seg(c.k, 0.45, 1), y = 540 + c.k * 60;
      g.save(); g.translate(960, y); for (const s of [-1, 1]) { g.save(); g.translate(s * cut * 120, s * cut * 60); g.rotate(c.t * 1.5 + s * cut * 3); g.fillStyle = '#e0902a'; g.strokeStyle = '#3a1a0a'; g.lineWidth = 4;
        g.beginPath(); g.ellipse(0, 0, 90, 46, 0, s < 0 ? Math.PI : 0, s < 0 ? Math.PI * 2 : Math.PI); g.closePath(); g.fill(); g.stroke(); g.restore(); } g.restore();
      if (c.k > 0.42 && c.k < 0.5) F.beam(g, [0, 560], [1920, 560], 8, '#fff0a0', 1, c.t); },
    at: [[1.2, c => { snd('bow'); flash(0.5); impact(c, 1, 0.2); }]] },
  // ================================================================ II. The Eclipse
  s16: { card: ACT([['PART II', 60], ['THE', 150], ['ECLIPSE', 150]]),
    update: c => { bg(c, 'eclipse_city', 0, lerp(-60, 60, c.k), lerp(1.05, 1.2, ease(c.k)), { layers: true, bright: lerp(1, 0.7, c.k) }); post.tint = c.k > 0.6 ? '#ff9080' : '#ffe0d0'; },
    at: [[0.5, () => snd('singularity', 0.6)], [3.5, c => { impact(c, 2, 0.5); snd('boom'); }]] },
  s17: { update: c => { bg(c, 'rift_sky', 0, lerp(0, -100, c.k), 1.1, { layers: true, rot: -0.03 });
      if (Math.floor(c.t * 3) !== Math.floor((c.t - c.dt) * 3)) { snd('thunder', 0.5); flash(0.4); }
      F.lightning(fx(c), [400 + Math.sin(c.t) * 300, 0], [900, 700], c.t, '#c77dff', 5, 3); field(c, 'debris', 3, { col: '#3a2a4a' }); } },
  s18: { update: c => { bg(c, 'rift_sky', 0, 0, 1.2, { layers: true, bright: 0.6 });
      for (const [i, id] of ['kagemaru', 'hex', 'nocturne', 'enra'].entries()) ch(c, id, 'idle', 480 + i * 330, 1040, id === 'enra' ? 760 : 620, { sil: 0.85, rim: '#ff2a3a' });
      if (c.t > 1.2) for (const i of [0, 1, 2, 3]) glow(fx(c), 480 + i * 330, 560, 22, '#ff2a3a', 0.9); },
    at: [[1.2, () => snd('singularity', 0.7)]] },
  s19: { update: c => { bg(c, 'cathedral', 0, lerp(100, 0, ease(c.k)), lerp(1.05, 1.15, c.k), { layers: true });
      const p = c.k > 0.55 ? 'fly0' : 'cast1'; ch(c, 'nocturne', p, 960, 1000 - Math.max(0, c.k - 0.55) * 300, 700, { rim: '#ff2d55', wind: 0.3 });
      field(c, 'petal', 10, { col: '#c0102a' }); if (c.k > 0.55) F.spiral(fx(c), 960, 560, 400, c.t, '#ff2d55', 0.25); },
    enter: c => c.ui.card('LADY NOCTURNE', 'The Crimson Diva', '#ff4d6d'), at: [[0.6, () => snd('requiem', 0.8)]] },
  s20: { update: c => { bg(c, 'amatsu_night', -200, -60, 1.3, { layers: true, bright: lerp(1, 0.55, c.k), tint: '#9aa8e0' });
      ch(c, 'mirei', face(c, 'mirei'), 960, 1200, 1250, { breath: 0.6, sway: 0.6, tint: '#c8d0f0' });
      const g = fx(c); g.fillStyle = alpha('#bfe8ff', 0.8); const ty = 560 + (c.t * 60) % 240; g.beginPath(); g.ellipse(1010, ty, 5, 9, 0, 0, Math.PI * 2); g.fill(); } },
  s21: { update: c => { bg(c, 'sacred_tree', 0, 0, 1.15, { layers: true, tint: '#ffb080' }); field(c, 'ember', 30);
      const p = keysAt(c.t, [[0, 'idle'], [0.5, 'cast0'], [1.4, 'cast1']]); ch(c, 'kagemaru', p, 760, 1020, 660, { rim: '#ff7a2a' });
      if (c.t > 1.4) glow(fx(c), 1200, 500, 500 * seg(c.t, 1.4, 3), '#ff7a2a', 0.6); },
    at: [[0.5, () => snd('flamestart')], [1.8, () => snd('boom', 0.6)]] },
  s22: { update: c => { bg(c, 'sacred_tree_fire', 0, lerp(-40, 80, c.k), lerp(1.05, 1.2, ease(c.k)), { layers: true }); field(c, 'ember', 90); field(c, 'talisman', 5, { size: 9 }); c.P.wind = -40; },
    at: [[0.2, () => snd('flamestart')], [1.5, () => snd('flame', 0.8)], [3, () => snd('boom', 0.5)]] },
  s23: { update: c => { bg(c, 'sacred_tree_fire', -160, 60, 1.25, { layers: true, bright: 0.9 }); field(c, 'ember', 50);
      { const st = stride(c, 'run'), run = c.t < 2.2;
        ch(c, 'kaien', run ? st.pose : 'cast0', lerp(500, 900, seg(c.k, 0, 0.6)), 1010 + (run ? st.dy : 0), 640, { rim: '#ff7a2a', rot: run ? st.rot : 0, squash: run ? st.squash : 0 }); } },
    at: [[2.4, c => { snd('talisman'); c.P.emit('talisman', 24, 960, 600, { speed: 500, size: 11 }); }]] },
  s24: { update: c => { bg(c, 'seal_cavern', 0, 0, lerp(1.1, 1.3, ease(c.k)), { layers: true, bright: 0.8 + seg(c.k, 0.35, 0.7) * 0.8 });
      if (c.k > 0.35) { F.evaCross(fx(c), 960, 700, seg(c.k, 0.35, 1), '#ff4a3a', 0.8); field(c, 'debris', 30, { col: '#3a2a2a' }); } },
    at: [[1.2, c => { impact(c, 3, 1); snd('slam'); c.P.emit('debris', 40, 960, 600, { speed: 1300, col: '#4a3a3a', size: 18 }); }]] },
  s25: { update: c => { bg(c, 'burned_district', 0, lerp(-80, 0, ease(c.k)), 1.1, { layers: true, tint: '#ff9a7a' }); field(c, 'ember', 60);
      const rise = ease(Math.min(1, c.k * 1.6)); ch(c, 'enra', c.k > 0.7 ? 'cast0' : 'idle', 960, 1100 + (1 - rise) * 700, 950, { rim: '#ff6a2a', breath: 0.5 });
      glow(fx(c), 960, 1000, 700, '#ff4a1a', 0.35); },
    enter: c => c.ui.card('ENRA', 'The Crimson Oni', '#ff6a2a'),
    at: [[0.2, () => snd('roar')], [2.8, c => { impact(c, 3, 0.8); snd('roar'); F.shockwave; c.P.emit('ember', 80, 960, 700, { speed: 900 }); }]] },
  s26: { update: c => { bg(c, 'burned_district', -120, -30, 1.2, { layers: true, bright: 0.75, tint: '#9aa8d8' }); field(c, 'rain', 300); field(c, 'ash', 6, { col: '#6a6a6a' });
      ch(c, 'raijin', 'hit', 900, 1040, 680, { tint: '#b8c0e8', breath: 1.3 }); ch(c, 'enra', 'idle', 1560, 1000, 520, { sil: 0.8, rim: '#ff4a1a' }); } },
  s27: { update: c => { bg(c, 'hangar', 200, -80, 1.4, { layers: true, bright: 0.5, tint: '#ff9090' });
      ch(c, 'gorgoth', 'face', 960, 1500, 1500, { breath: 0.1, sway: 0, flip: true }); glow(fx(c), 900, 520, 120 * seg(c.k, 0.15, 0.3), '#ff2244', 0.9); },
    at: [[0.6, c => { flash(0.3); snd('mechjump', 0.6); }], [2, () => snd('denied')]] },
  s28: { update: c => { bg(c, 'hangar_fire', 0, 0, 1.15, { layers: true });
      const p = keysAt(c.t, [[0, 'idle'], [0.4, 'attack0'], [0.8, 'attack2'], [1.6, 'attack3']]);
      ch(c, 'gorgoth', p, 1250, 1060, 900, { flip: true }); ch(c, 'tenkai', 'hit', 600, 1060, 880, { squash: c.t > 0.95 && c.t < 1.2 ? 0.05 : 0 });
      field(c, 'ember', 40); },
    at: [[0.95, c => { impact(c, 1, 0.8); snd('slam'); c.P.emit('spark', 60, 780, 560, { speed: 1100, col: '#ffcc66' }); c.P.emit('debris', 16, 760, 560, { speed: 900, col: '#e8e0d0', size: 20 }); }]] },
  s29: { update: c => { bg(c, 'hangar_fire', -150, 40, 1.2, { layers: true });
      const kb = Math.min(1, c.k / 0.3); ch(c, 'haruto', kb < 1 ? 'hit' : 'idle', lerp(900, 600, easeOut(kb)), 1020 - Math.sin(kb * Math.PI) * 120, 560, {}); field(c, 'ember', 60); },
    at: [[0.1, c => { impact(c, 1, 0.6); snd('boom'); c.P.emit('debris', 20, 1000, 700, { speed: 1000, col: '#5a4a3a', size: 14 }); }]] },
  s30: { update: c => { bg(c, 'void', 0, 0, lerp(1.05, 1.2, ease(c.k)), { layers: true });
      ch(c, 'hex', keysAt(c.t, [[0, 'idle'], [0.8, 'cast1']]), 960, 1060, 820, { rim: '#c77dff' });
      if (c.t > 0.8) F.strings(fx(c), [1060, 540], [[1500, 900], [1400, 300], [520, 850]], c.t); },
    enter: c => c.ui.card('HEX', 'The Dollmaker', '#b56dff'), at: [[0.8, () => snd('strings')]] },
  s31: { update: c => { bg(c, 'void', 120, -40, 1.3, { layers: true, bright: 0.8 });
      const g = fx(c), x = lerp(700, 1400, c.k), y = 520 + Math.sin(c.t) * 30;
      g.save(); g.translate(x, y); g.rotate(Math.sin(c.t * 0.7) * 0.4);
      g.fillStyle = '#ff8a2a'; g.strokeStyle = '#3a1a0a'; g.lineWidth = 4; g.beginPath(); g.moveTo(-200, 0);
      for (let i = 0; i <= 20; i++) { const u = i / 20; g.lineTo(-200 + u * 400, Math.sin(u * 8 + c.t * 4) * 20 * u); } for (let i = 20; i >= 0; i--) { const u = i / 20; g.lineTo(-200 + u * 400, 40 + Math.sin(u * 8 + c.t * 4) * 20 * u); }
      g.closePath(); g.fill(); g.stroke(); g.restore();
      F.strings(g, [x + 150, y + 10], [[1920, 200], [1920, 700]], c.t); } },
  s32: { update: c => { bg(c, 'rift_sky', 0, 0, lerp(1.05, 1.12, c.k), { layers: true });
      const L: [string, number, number][] = [['nocturne', 420, 600], ['kagemaru', 700, 620], ['gorgoth', 1000, 1000], ['enra', 1330, 780], ['hex', 1600, 700]];
      for (const [id, x, h] of L) ch(c, id, 'idle', x, 1060, h, { rim: '#ff2a3a', flip: x > 1000 });
      F.lightning(fx(c), [1500, 0], [1300, 400], c.t, '#c77dff', 4, 9); },
    enter: c => c.ui.card('THE UMBRA SYNDICATE', 'Five who fell', '#ff3b5c'), at: [[0.4, () => snd('thunder')], [1.7, () => snd('roar', 0.7)]] },
  // ================================================================ III. Five who stood up
  s33: { card: ACT([['PART III', 60], ['FIVE WHO', 150], ['STOOD UP', 150]]),
    update: c => { bg(c, 'burned_district', lerp(-100, 100, c.k), 0, 1.1, { layers: true, tint: '#a8a0b8', bright: 0.8 }); post.sat = 0.6; field(c, 'ash', 20, { col: '#8a8a8a' }); } },
  s34: { update: c => { bg(c, 'cockpit', 0, 0, lerp(1.1, 1.2, c.k), { layers: true });
      ch(c, 'haruto', face(c, 'haruto'), 960, 1250, 1150, { rim: '#ffd76a', breath: 1.3 });
      if (c.k > 0.5) F.focusLines(fx(c), 960, 540, c.t, { col: '#ffd76a', a: 0.35, inner: 380 }); },
    at: [[2.6, c => { impact(c, 1, 0.3); snd('ultcall'); }]] },
  s35: { update: c => { bg(c, 'hangar', 0, -100, 1.35, { layers: true, bright: 0.7 });
      ch(c, 'tenkai', 'face', 960, 1500, 1500, { breath: 0.1, sway: 0 });
      const on = seg(c.k, 0.2, 0.35); glow(fx(c), 960, 560, 260 * on, '#ffd76a', 0.9 * on); glow(fx(c), 960, 880, 200 * on, '#6ae0ff', 0.6 * on); },
    enter: c => c.ui.card('TENKAI-OH', 'The Dawn Colossus', '#f4d35e'), at: [[0.9, c => { flash(0.6); snd('mechjump'); impact(c, 2, 0.3); }], [1.4, () => snd('ultcall')]] },
  s36: { update: c => { bg(c, 'amatsu_night', 0, -40, 1.12, { layers: true }); field(c, 'feather', 5, { col: '#f4f6ff', size: 12 }); field(c, 'mote', 14, { col: '#bfe8ff' });
      ch(c, 'mirei', keysAt(c.t, [[0, 'cast0'], [1.4, 'cast1']]), 960, 1000, 700, { rim: '#6cc4ff', wind: 0.2 }); if (c.t > 1.4) F.spiral(fx(c), 960, 560, 360, c.t, '#6cc4ff', 0.2); },
    enter: c => c.ui.card('MIREI', 'The Starweaver', '#8fd3ff'), at: [[0.6, () => snd('constellation')]] },
  s37: { update: c => { bg(c, 'amatsu_dawn', 0, lerp(-200, 200, ease(c.k)), 1.15, { layers: true, bright: 0.85 });
      { const st = stride(c, 'fly'); ch(c, 'mirei', st.pose, 960, lerp(1200, 500, ease(c.k)) + st.dy, 600, { rim: '#bfe8ff', wind: -0.6 }); } field(c, 'feather', 8, { col: '#f4f6ff' }); F.speedLines(fx(c), -Math.PI / 2, c.t, { a: 0.3, n: 40 }); },
    at: [[0.2, () => snd('sunhop')]] },
  s38: { update: c => { bg(c, 'shrine_steps', lerp(0, 160, c.k), lerp(-60, 60, c.k), 1.12, { layers: true }); field(c, 'talisman', 14, { size: 10 }); c.P.wind = 30;
      { const st = stride(c, 'walk'); ch(c, 'kaien', st.pose, 960, 1010 + st.dy, 640, { wind: 0.3, squash: st.squash }); } },
    at: [[0.3, () => snd('talisman', 0.6)]] },
  s39: { update: c => { bg(c, 'kurogane_skyline', 0, 60, 1.15, { layers: true, bright: 0.7 }); field(c, 'rain', 420);
      ch(c, 'raijin', keysAt(c.t, [[0, 'cast0'], [1.2, 'cast1']]), 960, 1020, 700, { rim: '#8ad8ff' });
      if (c.t > 1.4 && c.t < 1.8) F.lightning(fx(c), [980, 0], [1000, 480], c.t, '#8ad8ff', 7, 5);
      if (c.t > 2.6 && c.t < 3.0) F.lightning(fx(c), [1300, 0], [1000, 480], c.t, '#8ad8ff', 7, 6); },
    at: [[1.4, c => { snd('thunderclap'); impact(c, 2, 0.4); }], [2.6, c => { snd('thunder'); impact(c, 1, 0.3); }]] },
  s40: { update: c => { bg(c, 'academy_sunset', 200, 0, 1.2, { layers: true, tint: '#8fa6ff', bright: 0.6 });
      ch(c, 'yuzu', 'attack1', 960, 1020, 700, { rim: '#ffd27a' }); ch(c, 'yuzu', face(c, 'yuzu'), 1560, 1200, 700, { opacity: 0 }); },
    at: [[0.4, () => snd('bowdraw')]] },
  // ================================================================ IV. The Night of the Academy
  s41: { card: ACT([['PART IV', 60], ['THE NIGHT', 150], ['OF THE ACADEMY', 150]]),
    update: c => { bg(c, 'academy_night', lerp(-100, 100, c.k), 0, 1.1, { layers: true }); field(c, 'ember', 40);
      if (Math.random() < 0.05) { c.P.emit('debris', 10, 400 + Math.random() * 1100, 600, { speed: 900, col: '#3a3040', size: 14 }); snd('boom', 0.5); } } },
  s42: { update: c => { bg(c, 'academy_night', 0, 0, 1.18, { layers: true });
      const drop = (t0: number) => (1 - easeOut(seg(c.k, t0, t0 + 0.25))) * 900;
      ch(c, 'enra', 'idle', 600, 1060 - drop(0.05), 760); ch(c, 'gorgoth', 'idle', 1250, 1060 - drop(0.3), 900, { flip: true }); ch(c, 'nocturne', 'fly0', 950, 560 - drop(0.5), 520); },
    at: [[0.9, c => { impact(c, 1, 0.7); snd('mechland'); c.P.emit('dust', 20, 600, 1040, { speed: 400, dir: -Math.PI / 2, cone: 3, col: '#8a8090', size: 30 }); }], [1.8, c => { impact(c, 1, 0.8); snd('mechland'); }], [2.5, () => snd('roar')]] },
  s43: { update: c => { bg(c, 'academy_night', 0, 60, 1.2, { layers: true, tint: '#ffe8c0' });
      const land = easeOut(Math.min(1, c.k / 0.3)); ch(c, 'tenkai', 'idle', 960, 1060 - (1 - land) * 1200, 1000, { squash: c.k > 0.28 && c.k < 0.36 ? 0.06 : 0 });
      if (c.k > 0.5) F.hexShield(fx(c), 1250, 620, 300, 420, easeOut(seg(c.k, 0.5, 0.65)), '#ffd76a', c.t); },
    at: [[1.2, c => { impact(c, 1, 0.9); snd('mechland'); c.P.emit('dust', 30, 960, 1040, { speed: 700, col: '#a09080', size: 40 }); c.P.emit('debris', 20, 960, 1040, { speed: 1000, dir: -Math.PI / 2, cone: 2.6, col: '#5a5060', size: 16 }); }], [2.2, () => snd('barrierup')]] },
  s44: { update: c => { bg(c, 'academy_night', 0, lerp(-200, 0, ease(c.k)), 1.15, { layers: true });
      ch(c, 'mirei', keysAt(c.t, [[0, 'fly0'], [1.5, 'cast1']]), 960, lerp(200, 900, ease(c.k)), 640, { rim: '#bfe8ff' });
      if (c.t > 1.5) { F.flashRing(fx(c), 960, 700, seg(c.t, 1.5, 2.6), '#bfe8ff', 700); field(c, 'mote', 60, { col: '#bfe8ff' }); } },
    at: [[1.6, () => snd('nova')]] },
  s45: { update: c => { bg(c, 'academy_night', -120, 0, 1.2, { layers: true });
      ch(c, 'kaien', 'cast1', 960, 1020, 680, { rim: '#ffe28a', wind: 0.5 }); field(c, 'talisman', 40, { size: 11 });
      const g = fx(c); g.save(); g.translate(960, 1000); g.scale(1, 0.3); g.strokeStyle = alpha('#ffe28a', 0.9); g.lineWidth = 8; g.beginPath(); g.arc(0, 0, 360 * easeOut(seg(c.k, 0.2, 0.5)), 0, Math.PI * 2); g.stroke(); g.restore(); },
    at: [[0.8, () => snd('seal')]] },
  s46: { update: c => { bg(c, 'academy_night', 200, 0, 1.25, { layers: true, tint: '#b0d0ff' });
      ch(c, 'raijin', keysAt(c.t, [[0, 'run3'], [0.5, 'attack1']]), lerp(1400, 960, easeOut(seg(c.t, 0, 0.5))), 1020, 700, { rim: '#8ad8ff' });
      if (c.t < 0.5) F.speedLines(fx(c), Math.PI, c.t, { col: '#8ad8ff', a: 0.6 }); },
    at: [[0.1, c => { snd('flashstep'); impact(c, 2, 0.3); }]] },
  s47: { update: c => { bg(c, 'academy_night', -200, 100, 1.25, { layers: true });
      ch(c, 'yuzu', keysAt(c.t, [[0, 'attack0'], [0.6, 'attack1'], [2.1, 'attack3']]), 960, 1020, 700, { rim: '#ffd27a', wind: 0.3 });
      if (c.t > 2.1 && c.t < 2.5) F.beam(fx(c), [1050, 640], [lerp(1050, 2000, seg(c.t, 2.1, 2.25)), 560], 7, '#ffd27a', 1, c.t); },
    at: [[0.2, () => snd('bowdraw')], [2.1, () => snd('bow')]] },
  // duel 1: Tenkai-Oh vs Gorgoth
  s48: { update: c => { bg(c, 'academy_night', lerp(-200, 200, c.k), 0, 1.15, { layers: true, tint: '#ff9a9a' });
      { const st = stride(c, 'run'); ch(c, 'gorgoth', st.pose, 960, 1060 + st.dy, 900, { flip: true, rot: -st.rot, squash: st.squash }); } F.speedLines(fx(c), 0, c.t, { col: '#ff2244', a: 0.5 }); F.drill(fx(c), 700, 640, Math.PI, 260, 50, c.t); field(c, 'dust', 20, { col: '#6a5a6a' }); },
    at: [[0.1, () => snd('charge')]] },
  s49: { update: c => { bg(c, 'academy_night', lerp(200, -200, c.k), 0, 1.15, { layers: true, tint: '#ffe0a0' });
      { const st = stride(c, 'run'); ch(c, 'tenkai', st.pose, 960, 1060 + st.dy, 900, { rot: st.rot, squash: st.squash }); } F.speedLines(fx(c), Math.PI, c.t, { col: '#ffd76a', a: 0.5 }); field(c, 'ember', 30, { col: '#ffd76a' }); },
    at: [[0.1, () => { snd('charge'); snd('mechjump'); }]] },
  s50: { update: c => { const hit = c.t > 0.95;
      bg(c, 'academy_night', 0, 0, hit ? 1.3 : lerp(1.1, 1.25, c.k), { layers: true, tint: '#fff0d0' });
      const u = easeInOut(Math.min(1, c.k / 0.25));
      ch(c, 'tenkai', hit ? 'attack2' : 'run2', lerp(300, 820, u), 1060, 900); ch(c, 'gorgoth', hit ? 'hit' : 'run2', lerp(1620, 1100, u) + (hit ? seg(c.t, 0.95, 1.6) * 260 : 0), 1060, 920, { flip: true });
      if (!hit) F.focusLines(fx(c), 960, 560, c.t, { a: 0.5 }); else F.evaCross(fx(c), 960, 700, seg(c.t, 0.95, 3.5), '#ffd76a', 0.7); },
    at: [[0.95, c => { impact(c, 3, 1.1); snd('slam'); snd('counter'); c.P.emit('spark', 120, 960, 600, { speed: 1600, col: '#ffe8a0', size: 7 }); c.P.emit('debris', 30, 960, 700, { speed: 1300, col: '#40384a', size: 20 }); }], [1.15, () => flash(0.7)]] },
  // duel 2: Mirei vs Nocturne
  s51: { update: c => { bg(c, 'academy_night', 300, -120, 1.2, { layers: true, tint: '#ff90a8' });
      ch(c, 'nocturne', keysAt(c.t, [[0, 'fly0'], [0.4, 'cast1']]), 960, 900, 700, { rim: '#ff2d55' });
      if (c.t > 0.4) for (let i = 0; i < 4; i++) F.shockwave(fx(c), 900, 520, ((c.t - 0.4) * 0.8 + i * 0.25) % 1, 900, '#ff2d55'); },
    at: [[0.4, c => { snd('silence'); impact(c, 2, 0.4); }]] },
  s52: { update: c => { bg(c, 'academy_night', -200, 0, 1.2, { layers: true, tint: '#c8e0ff' });
      ch(c, 'mirei', keysAt(c.t, [[0, 'cast0'], [1.8, 'cast1']]), 960, 900, 700, { rim: '#6cc4ff' });
      const g = fx(c); g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = alpha('#bfe8ff', 0.8); g.lineWidth = 3;
      for (const to of [[300, 1000], [1600, 1000]]) { g.beginPath(); g.moveTo(960, 560); g.lineTo(to[0], to[1]); g.stroke(); glow(g, to[0], to[1], 30, '#bfe8ff', 0.8); } g.restore();
      if (c.t > 1.8) F.flashRing(fx(c), 960, 560, seg(c.t, 1.8, 2.8), '#bfe8ff', 800); },
    at: [[0.3, () => snd('constellation')], [1.8, c => { snd('barrierbreak'); snd('counter'); impact(c, 1, 0.5); }]] },
  // duel 3: Kaien vs Kagemaru
  s53: { update: c => { bg(c, 'academy_night', 100, 0, 1.2, { layers: true, tint: '#a090d0' });
      ch(c, 'kagemaru', keysAt(c.t, [[0, 'attack0'], [0.3, 'attack2']]), 960, 1020, 680, { opacity: c.t > 1.3 ? 0.25 : 1 });
      if (c.t > 1.3) c.P.field('dust', 40, c.dt, { col: '#3a2a55' } as never); },
    at: [[0.3, c => { snd('kunai'); c.P.emit('spark', 10, 1100, 620, { speed: 800, dir: 0, cone: 0.3, col: '#c0b0ff' }); }], [1.3, () => snd('veil')]] },
  s54: { update: c => { bg(c, 'academy_night', 0, 0, 1.18, { layers: true, tint: '#fff0c0' });
      ch(c, 'kaien', 'cast1', 600, 1020, 660, { rim: '#ffe28a' }); ch(c, 'kagemaru', c.k < 0.3 ? 'hit' : 'hit', 1300, 1020, 660, { flip: true, opacity: c.k < 0.3 ? 0.3 : 1 });
      const g = fx(c), r = 260 * easeOut(seg(c.k, 0.2, 0.4)); g.save(); g.translate(1300, 1000); g.scale(1, 0.32); g.rotate(c.t);
      g.strokeStyle = alpha('#ffe28a', 0.95); g.lineWidth = 8; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); g.stroke(); } g.restore(); },
    at: [[0.2, () => snd('seal')], [0.9, c => { snd('unveil'); snd('counter'); impact(c, 1, 0.4); c.P.emit('talisman', 20, 1300, 700, { speed: 400 }); }]] },
  // duel 4: Raijin vs Enra
  s55: { update: c => { bg(c, 'academy_night', 0, -120, 1.3, { layers: true, tint: '#ffa070' }); field(c, 'ember', 60);
      ch(c, 'enra', keysAt(c.t, [[0, 'attack0'], [0.4, 'attack1'], [0.75, 'attack2']]), 960, 1200, 1100, { rim: '#ff6a2a' }); F.focusLines(fx(c), 960, 500, c.t, { col: '#ff6a2a', a: 0.3 }); },
    at: [[0.4, () => snd('roar')], [0.8, c => { snd('punch'); impact(c, 1, 0.6); }]] },
  s56: { update: c => { bg(c, 'academy_night', 0, 0, 1.2, { layers: true, tint: '#c0d8ff' });
      ch(c, 'raijin', keysAt(c.t, [[0, 'attack0'], [0.5, 'attack2'], [1.2, 'attack3']]), 760, 1020, 700, { rim: '#8ad8ff' }); ch(c, 'enra', c.t > 0.5 ? 'hit' : 'attack2', 1300, 1040, 860, { flip: true });
      if (c.t > 0.5 && c.t < 1.1) F.lightning(fx(c), [980, 560], [1240, 520], c.t, '#8ad8ff', 8, 2);
      if (c.t > 1.2 && c.t < 1.6) F.slash(fx(c), 1100, 620, 320, -2.2, 0.6, seg(c.t, 1.2, 1.6), '#8ad8ff'); },
    at: [[0.5, c => { snd('parry'); snd('thunderclap'); snd('counter'); impact(c, 2, 0.8); c.P.emit('spark', 80, 1040, 560, { speed: 1400, col: '#bfe8ff' }); }], [1.2, () => snd('katana')]] },
  // duel 5: Yuzu vs Hex
  s57: { update: c => { bg(c, 'void', 0, 0, 1.2, { layers: true });
      ch(c, 'hex', 'cast1', 1150, 1040, 820, { flip: true, rim: '#c77dff' }); ch(c, 'brother', 'hit', 640, 1020, 560, { tint: '#b8a8d8', sil: 0.2 });
      F.strings(fx(c), [1060, 560], [[640, 620], [600, 760], [700, 700]], c.t); },
    at: [[0.4, () => snd('strings')]] },
  s58: { update: c => { bg(c, 'academy_night', 0, 0, 1.15, { layers: true, tint: '#ffe0b0' });
      ch(c, 'yuzu', keysAt(c.t, [[0, 'attack1'], [1.4, 'attack3']]), 520, 1020, 660, { rim: '#ffd27a' }); ch(c, 'hex', c.t > 1.6 ? 'hit' : 'cast1', 1450, 1040, 800, { flip: true });
      if (c.t < 1.6) F.strings(fx(c), [1380, 560], [[980, 700]], c.t);
      if (c.t > 1.4 && c.t < 1.8) F.beam(fx(c), [620, 640], [lerp(620, 1450, seg(c.t, 1.4, 1.6)), 600], 7, '#ffd27a', 1, c.t);
      if (c.t > 1.6) { const g = fx(c), u = seg(c.t, 1.6, 3.5); g.fillStyle = '#ff8a2a'; g.save(); g.translate(980 - u * 200, 700 - u * 300); g.rotate(u * 3); g.fillRect(-120, -14, 240, 28); g.restore(); } },
    at: [[1.4, () => snd('bow')], [1.6, c => { snd('cut'); snd('counter'); impact(c, 1, 0.5); c.P.emit('spark', 40, 980, 700, { speed: 800, col: '#fff0a0' }); }]] },
  // finale
  s59: { update: c => { bg(c, 'academy_night', 0, 0, lerp(1.1, 1.2, c.k), { layers: true, tint: '#fff4d0' });
      ch(c, 'tenkai', 'cast1', 960, 1080, 980); ch(c, 'kaien', 'cast1', 520, 1040, 600); ch(c, 'raijin', 'cast1', 1400, 1040, 640, { flip: true }); ch(c, 'yuzu', 'attack1', 300, 1060, 580); ch(c, 'mirei', 'fly1', 1620, 700, 560, { flip: true });
      if (c.t > 0.3) { for (const [x, y, col] of [[520, 600, '#ffe28a'], [1400, 560, '#8ad8ff'], [300, 640, '#ffd27a'], [1620, 420, '#bfe8ff'], [960, 520, '#ffd76a']] as [number, number, string][]) F.beam(fx(c), [x, y], [960, 140], 6, col, seg(c.t, 0.3, 0.6), c.t); }
      if (c.t > 0.9) glow(fx(c), 960, 140, 400 * seg(c.t, 0.9, 1.4), '#ffffff', 0.9); },
    at: [[0.3, () => snd('ultcall')], [0.9, c => { snd('boom'); impact(c, 2, 0.6); }]] },
  s60: { update: c => { bg(c, 'academy_night', 0, 80, lerp(1.2, 1.35, ease(c.k)), { layers: true, tint: '#ffe8b0' });
      ch(c, 'tenkai', keysAt(c.t, [[0, 'attack0'], [0.5, 'attack1'], [0.85, 'attack2'], [1.4, 'attack3']]), 820, 1080, 1000);
      if (c.t > 0.85) { F.evaCross(fx(c), 1300, 1000, seg(c.t, 0.85, 3.5), '#ffd76a', 0.9); F.shockwave(fx(c), 1100, 1040, seg(c.t, 0.85, 1.8), 1400, '#ffd76a'); } },
    at: [[0.3, () => snd('ultcall')], [0.85, c => { snd('slam'); snd('boom'); impact(c, 3, 1.2); c.P.emit('debris', 60, 1200, 1040, { speed: 1600, dir: -Math.PI / 2, cone: 2, col: '#4a4050', size: 22 }); }], [1.05, () => flash(0.8)]] },
  s61: { update: c => { bg(c, 'rift_sky', 0, 0, lerp(1.1, 1.3, ease(c.k)), { layers: true, bright: lerp(1, 1.4, c.k) });
      F.spiral(fx(c), 960, 400, 900 * (1 - c.k), -c.t * 2, '#c77dff', 0.5); if (c.k > 0.5) glow(fx(c), 960, 400, 900 * seg(c.k, 0.5, 1), '#ffffff', 0.9); },
    at: [[0.4, () => snd('implode')], [2.2, c => { snd('boom'); flash(0.9); }]] },
  // ================================================================ V. The oath at dawn
  s62: { card: ACT([['FINAL', 60], ['THE OATH', 150], ['AT DAWN', 150]]),
    update: c => { bg(c, 'dawn_ruins', lerp(-80, 80, c.k), 0, 1.1, { layers: true });
      ch(c, 'tenkai', 'idle', 1250, 1080, 760, { sil: 0.85, rim: '#ffd76a' }); for (const [i, id] of ['kaien', 'mirei', 'raijin', 'yuzu'].entries()) ch(c, id, 'idle', 560 + i * 150, 1070, 330, { sil: 0.85, rim: '#ffd76a' });
      F.flare(fx(c), 1500, 380, 1.2); field(c, 'mote', 12, { col: '#ffe0a0' }); } },
  s63: { update: c => { bg(c, 'dawn_ruins', 200, -60, 1.25, { layers: true });
      for (const [i, id] of ['kaien', 'mirei', 'raijin', 'yuzu'].entries()) ch(c, id, 'idle', 440 + i * 360, 1040, 640, { rim: '#ffd76a', wind: 0.3 }); field(c, 'mote', 10, { col: '#ffe0a0' }); } },
  s64: { update: c => { bg(c, 'dawn_ruins', 0, -200, 1.4, { layers: true, bright: 1.1 });
      const g = fx(c); g.save(); g.translate(960, 620);
      const cols = ['#e8e4ff', '#f6f7fc', '#24286a', '#ff8a2a', '#d8202c'];
      cols.forEach((col, i) => { const a = -Math.PI / 2 + (i - 2) * 0.55; g.save(); g.rotate(a + Math.PI / 2); g.translate(0, -440 + ease(seg(c.k, 0, 0.4)) * 200); g.fillStyle = col; g.strokeStyle = '#140c18'; g.lineWidth = 6;
        g.beginPath(); g.roundRect(-60, -220, 120, 300, 40); g.fill(); g.stroke(); g.fillStyle = '#f6d9c6'; g.beginPath(); g.ellipse(0, 100, 56, 70, 0, 0, Math.PI * 2); g.fill(); g.stroke(); g.restore(); });
      g.restore(); if (c.k > 0.35) { glow(g, 960, 620, 500 * seg(c.k, 0.35, 0.6), '#ffd76a', 0.9); F.flashRing(g, 960, 620, seg(c.k, 0.35, 0.8), '#ffd76a', 600); } },
    at: [[1.2, c => { snd('sunburst'); flash(0.4); }]] },
  s65: { update: c => { bg(c, 'dawn_ruins', 0, lerp(80, -40, ease(c.k)), lerp(1.2, 1.1, ease(c.k)), { layers: true });
      ch(c, 'tenkai', 'idle', 960, 1100, 1000, { rim: '#ffd76a' }); for (const [i, id] of ['kaien', 'mirei', 'raijin', 'yuzu'].entries()) ch(c, id, 'idle', [420, 640, 1280, 1500][i], 1080, 520, { rim: '#ffd76a', flip: i > 1, wind: 0.3 });
      F.flare(fx(c), 960, 300, 1.4); field(c, 'mote', 16, { col: '#ffe0a0' }); },
    enter: c => c.ui.card('THE ZENITH VANGUARD', 'Sworn at dawn', '#ffd76a'), at: [[0.5, () => snd('victory')]] },
  s66: { update: c => { bg(c, 'space_lab', 0, 0, lerp(1.1, 1.25, ease(c.k)), { layers: true });
      ch(c, 'qelvaris', keysAt(c.t, [[0, 'face'], [2.5, 'facefront']]), 960, 1250, 1150, { rim: '#ffd24a', breath: 0.8, sway: 0.8 }); field(c, 'mote', 10, { col: '#b56dff' }); },
    enter: c => c.ui.card("ARCHON QEL'VARIS", 'The Star-Forger', '#ffd24a'), at: [[0.8, () => snd('theater', 0.6)]] },
  s67: { update: c => { bg(c, 'orbit_colossus', 0, lerp(-100, 100, c.k), lerp(1.3, 1.05, ease(c.k)), { layers: true }); field(c, 'star', 6); },
    at: [[0.5, () => snd('mechstep', 0.8)], [2.5, () => snd('mechstep', 0.8)]] },
  s68: { update: c => { bg(c, 'eclipse_title', 0, 0, lerp(1.0, 1.08, c.k), { layers: true }); field(c, 'star', 8);
      const g = fx(c), a = seg(c.k, 0.15, 0.4);
      g.save(); g.globalAlpha = a; g.textAlign = 'center'; g.font = '900 150px Orbitron, sans-serif';
      const gr = g.createLinearGradient(0, 380, 0, 560); gr.addColorStop(0, '#fff8e1'); gr.addColorStop(0.6, '#ffd76a'); gr.addColorStop(1, '#c98a1c');
      g.fillStyle = gr; g.shadowColor = '#ffb347'; g.shadowBlur = 40; g.fillText('ZENITH//UMBRA', 960, 540); g.shadowBlur = 0;
      g.font = '700 40px Orbitron, sans-serif'; g.fillStyle = '#e8eeff'; g.fillText('THE  OATH  AT  DAWN', 960, 620); g.restore(); },
    at: [[0.3, () => snd('victory', 0.7)]] },
};
void clamp; void Math;
