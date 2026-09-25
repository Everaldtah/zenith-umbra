// Shot scripts for "The Oath at Dawn - Engine Cut". One entry per screenplay shot (ids match cinematic/script.py and the
// timeline, so the recorded lines and score land exactly where they do in the AI-generated cut).
// A shot: which set, who is on stage, a grade, weather, and update(c) called every frame with the shot-local time.
// Everything is a function of time (seek-safe); one-off effects / sounds go in `at` and fire when the playhead crosses them.
import * as THREE from 'three';
import type { Stage, Grade } from './stage';
import { sacredTree, sealStone, skyDisc, scarf, waveScarf } from './stage';
import { sfx } from '../audio/Sfx';
import { TITAN_SCALE } from '../game/World';

export interface Ui {
  card(name: string, title: string, color: string): void;
  impact(kind?: 'white' | 'invert'): void;
  speedLines(on: boolean, color?: string): void;
  cockpit(on: boolean): void;
  title(on: boolean): void;
}
export interface C { st: Stage; ui: Ui; t: number; dt: number; T: number; k: number; now: number; }
export interface Shot {
  set: [string, string]; cast?: string[]; grade?: Grade; weather?: 'rain' | 'embers' | 'stars' | 'none';
  setup?(c: C): void; update(c: C): void; at?: [number, (c: C) => void][];
}

// ---------------------------------------------------------------- helpers
type V2 = [number, number]; type V3 = [number, number, number];
const ease = (k: number) => k * k * (3 - 2 * k);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerp3 = (a: V3, b: V3, k: number): V3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
function A(c: C, key: string) { return c.st.cast.get(key).actor; }
function V(c: C, key: string) { return c.st.cast.get(key).view; }
/** stand still at x,z facing yaw (radians, 0 = +Z) */
function place(c: C, key: string, x: number, z: number, yaw = 0, y?: number) {
  const a = A(c, key);
  a.pos = { x, y: y ?? c.st.set!.ground(x, z), z }; a.vel = { x: 0, y: 0, z: 0 }; a.yaw = yaw; a.pitch = 0;
  a.grounded = y === undefined; a.flying = false; a.forced = null; a.charging = false; a.barrier.up = false; a.scale = a.scale || 1;
  return a;
}
/** move from -> to over the shot fraction [k0,k1] at walking pace; the gait comes from the velocity */
function walk(c: C, key: string, from: V2, to: V2, k0 = 0, k1 = 1) {
  const a = A(c, key), u = Math.min(1, Math.max(0, (c.k - k0) / (k1 - k0)));
  const x = lerp(from[0], to[0], u), z = lerp(from[1], to[1], u);
  const moving = u > 0 && u < 1, d = Math.hypot(to[0] - from[0], to[1] - from[1]) / Math.max(0.01, (k1 - k0) * c.T);
  a.yaw = Math.atan2(to[0] - from[0], to[1] - from[1]);
  a.pos = { x, y: c.st.set!.ground(x, z), z };
  a.vel = moving ? { x: Math.sin(a.yaw) * d, y: 0, z: Math.cos(a.yaw) * d } : { x: 0, y: 0, z: 0 };
  a.grounded = true;
  return a;
}
function face(c: C, key: string, x: number, z: number) { const a = A(c, key); a.yaw = Math.atan2(x - a.pos.x, z - a.pos.z); }
function attack(c: C, key: string, kind = 'primary', side = 1) { const a = A(c, key); a.anim.attackAt = c.now; a.anim.attackKind = kind; a.anim.attackSide = side; }
function cast(c: C, key: string, id = 'x') { const a = A(c, key); a.anim.castAt = c.now; a.anim.castId = id; }
function hit(c: C, key: string) { A(c, key).anim.hitAt = c.now; }
function cam(c: C, eye: V3, look: V3, fov = 38) {
  const d = new THREE.Vector3(eye[0] - look[0], eye[1] - look[1], eye[2] - look[2]), len = d.length();
  if (len > 0.01) {
    d.divideScalar(len);
    const h = c.st.set!.level.ray({ x: look[0], y: look[1], z: look[2] }, { x: d.x, y: d.y, z: d.z }, len);
    if (h && h.t > 0.3) eye = [look[0] + d.x * (h.t - 0.3), look[1] + d.y * (h.t - 0.3), look[2] + d.z * (h.t - 0.3)];
  }
  c.st.camera.position.set(...eye); c.st.camera.lookAt(...look);
  if (c.st.camera.fov !== fov) { c.st.camera.fov = fov; c.st.camera.updateProjectionMatrix(); }
}
function dolly(c: C, e0: V3, e1: V3, l0: V3, l1: V3, fov = 38) { const k = ease(c.k); cam(c, lerp3(e0, e1, k), lerp3(l0, l1, k), fov); }
function orbit(c: C, ctr: V3, r: number, h: number, a0: number, a1: number, fov = 38, lookH = 0) {
  const a = lerp(a0, a1, ease(c.k));
  cam(c, [ctr[0] + Math.sin(a) * r, ctr[1] + h, ctr[2] + Math.cos(a) * r], [ctr[0], ctr[1] + lookH, ctr[2]], fov);
}
const P = (c: C, x: number, y: number, z: number) => ({ x, y, z });
function fx(c: C, kind: string, p: { x: number; y: number; z: number }, o: Record<string, unknown> = {}) { c.st.fx(kind, p, o as any, c.now); }
function snd(id: string, vol = 1) { sfx.play(id, undefined, vol); }
/** an object added to the set for this shot only */
const tmp = new Map<string, THREE.Object3D>();
function prop(c: C, key: string, make: () => THREE.Object3D, x: number, y: number, z: number) {
  let o = tmp.get(key);
  if (!o) { o = make(); tmp.set(key, o); }
  if (o.parent !== c.st.set!.props) c.st.set!.props.add(o);
  o.position.set(x, y, z);
  return o;
}
export function clearProps(st: Stage) { for (const o of tmp.values()) o.removeFromParent(); }

// set origins (open floor on each map)
// open floor on each set (measured: widest clearance from walls / drops)
const AM: V2 = [-44, 0], KU: V2 = [-36, 0], HA: V2 = [-37, 0], TR: V2 = [-8, 0], CA: V2 = [-14, 20], RI: V2 = [-40, 2];
const CI: V2 = [10, 0];
const NIGHT: Grade = { tint: '#8fa6ff', exposure: 0.8, sat: 1.1 };
const DUSK: Grade = { tint: '#ffc8a0', exposure: 0.95 };
const RED: Grade = { tint: '#ff9a9a', exposure: 0.85, sat: 1.25 };
const DAWN: Grade = { tint: '#ffd9a8', exposure: 1.05, sat: 1.2 };
const VIOLET: Grade = { tint: '#c7a8ff', exposure: 0.9, sat: 1.2 };

// ================================================================ the shots
export const SHOTS: Record<string, Shot> = {
  // ---------------------------------------------------------------- I. the world that sang
  s01: { set: ['amatsu', 'amatsu'], grade: { tint: '#fff0e0' }, update: c => dolly(c, [AM[0] - 20, 40, 60], [AM[0] + 10, 18, 25], [AM[0] + 30, 0, 0], [AM[0] + 20, 2, 0], 46) },
  s02: { set: ['amatsu', 'amatsu'], cast: ['mirei#1', 'mirei#2', 'mirei#3', 'mirei#4', 'nocturne'], grade: { tint: '#b8c8ff', exposure: 0.85 }, weather: 'stars',
    setup: c => { ['mirei#1', 'mirei#2', 'mirei#3', 'mirei#4'].forEach((k, i) => place(c, k, AM[0] + 4 + (i % 2) * 1.6, -3 + i * 2, -Math.PI / 2)); place(c, 'nocturne', AM[0] + 1, 0, -Math.PI / 2); },
    update: c => { orbit(c, [AM[0] + 3, 1, 0], 12, 3, -2.2, -1.5, 40, 2); if (c.t % 0.7 < c.dt) fx(c, 'wish', P(c, AM[0] + 3 + Math.random() * 3, 4 + Math.random() * 4, -3 + Math.random() * 6), { color: '#fff3b0' }); },
    at: [[0.2, c => { fx(c, 'nova', P(c, AM[0] + 3, 2, 0), { r: 10, color: '#ffe9a8' }); snd('constellation'); }], [2.5, () => snd('note', 0.6)]] },
  s03: { set: ['amatsu', 'amatsu'], cast: ['mirei'], grade: { tint: '#b8c8ff', exposure: 0.9 }, weather: 'stars',
    setup: c => place(c, 'mirei', AM[0] + 2, 0, -Math.PI / 2),
    update: c => { dolly(c, [AM[0] - 2, 1.8, 1.2], [AM[0] - 0.5, 1.6, 0.6], [AM[0] + 2, 1.5, 0], [AM[0] + 2, 1.5, 0], 30); if (c.t % 0.35 < c.dt) fx(c, 'healhit', P(c, AM[0] + 2, 1.2, 0)); },
    at: [[0.3, () => snd('note', 0.5)], [1.5, c => cast(c, 'mirei', 'wish')]] },
  s04: { set: ['amatsu', 'amatsu'], cast: ['nocturne', 'mirei'], grade: { tint: '#c8d0ff', exposure: 0.9 }, weather: 'stars',
    setup: c => { place(c, 'nocturne', AM[0] + 2, -0.6, -Math.PI / 2 + 0.4); place(c, 'mirei', AM[0] + 2, 0.7, -Math.PI / 2 - 0.3); },
    update: c => dolly(c, [AM[0] - 4, 1.6, 0.2], [AM[0] - 2.6, 1.7, 0], [AM[0] + 2, 1.4, 0], [AM[0] + 2, 1.6, 0], 34) },
  s05: { set: ['amatsu', 'amatsu'], cast: ['kaien'], grade: DUSK,
    setup: c => { place(c, 'kaien', AM[0] + 1, 0, -Math.PI / 2); c.ui.card('KAIEN', 'The Warding Monk', '#e8e4ff'); },
    update: c => { orbit(c, [AM[0] + 1, 0, 0], 5, 1.4, -1.9, -1.3, 36, 1.4); if (c.t % 0.5 < c.dt) fx(c, 'papers', P(c, AM[0] + 1, 1.5, 0), { color: '#fff6d8' }); },
    at: [[0.4, () => snd('talisman', 0.5)]] },
  s06: { set: ['amatsu', 'amatsu'], grade: DUSK,
    setup: c => { prop(c, 'tree', sacredTree, AM[0] + 14, c.st.set!.ground(AM[0] + 14, 0), 0); },
    update: c => { dolly(c, [AM[0] - 4, 2, 6], [AM[0] - 2, 6, 10], [AM[0] + 14, 6, 0], [AM[0] + 14, 11, 0], 42); const t = tmp.get('tree')!; ((t.getObjectByName('glow') as THREE.PointLight).intensity = 30 + Math.sin(c.t * 2) * 10); if (c.t % 0.3 < c.dt) fx(c, 'healhit', P(c, AM[0] + 14 + (Math.random() - 0.5) * 10, 8 + Math.random() * 6, (Math.random() - 0.5) * 10), { color: '#ffb7d5' }); } },
  s07: { set: ['amatsu', 'amatsu'], cast: ['kagemaru', 'kaien'], grade: { tint: '#9aa0c8', exposure: 0.7, sat: 1.0 },
    setup: c => { place(c, 'kagemaru', AM[0] - 1, -2.5, 0.9); place(c, 'kaien', AM[0] + 5, 1, -Math.PI / 2); c.ui.card('KAGEMARU', 'The Shade Fang', '#9d7bff'); },
    update: c => dolly(c, [AM[0] - 4, 1.5, -5], [AM[0] - 3.5, 1.6, -4.2], [AM[0] + 5, 1.3, 1], [AM[0] - 1, 1.5, -2.5], 34),
    at: [[0.5, c => { cast(c, 'kaien', 'seal'); fx(c, 'sealcast', P(c, AM[0] + 5, 0.1, 1), { r: 2, color: '#ffe28a' }); snd('seal', 0.5); }]] },
  s08: { set: ['kurogane', 'kurogane'], grade: { tint: '#b0a0ff', exposure: 0.9, sat: 1.3 }, weather: 'rain',
    update: c => dolly(c, [KU[0] - 6, 14, 20], [KU[0] + 16, 4, 8], [KU[0] + 30, 2, 0], [KU[0] + 36, 3, 0], 50) },
  s09: { set: ['kurogane', 'kurogane'], cast: ['raijin', 'bot_dummy'], grade: { tint: '#b0a0ff', exposure: 0.95, sat: 1.3 }, weather: 'rain',
    setup: c => { place(c, 'raijin', KU[0] + 2, 0, Math.PI / 2); place(c, 'bot_dummy', KU[0] + 5, 0, -Math.PI / 2); c.ui.card('RAIJIN', 'The Stormblade', '#8ad8ff'); },
    update: c => { orbit(c, [KU[0] + 3.5, 0, 0], 6, 1.6, 2.2, 2.9, 38, 1.1); if (c.k > 0.4) walk(c, 'raijin', [KU[0] + 2, 0], [KU[0] + 3.4, 0], 0.4, 0.55); },
    at: [[1.6, c => { attack(c, 'raijin'); snd('katana'); c.ui.speedLines(true, '#8ad8ff'); }], [1.8, c => { hit(c, 'bot_dummy'); fx(c, 'slash', P(c, KU[0] + 5, 1.2, 0), { color: '#8ad8ff' }); fx(c, 'lightning', P(c, KU[0] + 3, 1.4, 0), { to: P(c, KU[0] + 5, 1.2, 0) }); snd('crit'); c.ui.impact(); }], [2.4, c => c.ui.speedLines(false)]] },
  s10: { set: ['kurogane', 'kurogane'], grade: { tint: '#ff9090', exposure: 0.55, sat: 1.1 },
    setup: c => { prop(c, 'stone', sealStone, KU[0] + 6, c.st.set!.ground(KU[0] + 6, 0) - 0.5, 0); },
    update: c => { dolly(c, [KU[0] - 2, 2, 4], [KU[0] + 1, 2.5, 2.5], [KU[0] + 6, 3, 0], [KU[0] + 6, 3.2, 0], 36); const s = tmp.get('stone')!; const g = 0.5 + 0.5 * Math.sin(c.t * 3); ((s.getObjectByName('glow') as THREE.PointLight).intensity = 10 + g * 30); ((s.getObjectByName('rune') as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.4 + g * 0.6; },
    at: [[0.8, () => snd('mechstep', 0.35)], [2.3, () => snd('mechstep', 0.35)]] },
  s11: { set: ['hangar', 'hangar'], cast: ['tenkai', 'gorgoth'], grade: { tint: '#ffe0b8' },
    setup: c => { place(c, 'tenkai', HA[0] - 5, HA[1], 0.2); place(c, 'gorgoth', HA[0] + 5, HA[1], -0.2); },
    update: c => { dolly(c, [HA[0], 1.5, 14], [HA[0], 5, 10], [HA[0], 3, 0], [HA[0], 5, 0], 48); if (c.t % 0.25 < c.dt) fx(c, 'impact', P(c, HA[0] + (Math.random() - 0.5) * 12, 3 + Math.random() * 3, (Math.random() - 0.5) * 2), { color: '#ffcc66' }); },
    at: [[0.3, () => snd('reload', 0.5)], [1.4, () => snd('reload', 0.5)], [3, () => snd('mechstep', 0.4)]] },
  s12: { set: ['hangar', 'hangar'], cast: ['haruto', 'tenkai'], grade: { tint: '#ffe0b8' },
    setup: c => { place(c, 'tenkai', HA[0], HA[1] + 4, Math.PI); place(c, 'haruto', HA[0], HA[1], 0); c.ui.card('HARUTO DAIMON', "Tenkai-Oh's pilot", '#f4d35e'); },
    update: c => { dolly(c, [HA[0] - 1.6, 1.2, -2.2], [HA[0] - 1.2, 0.9, -1.6], [HA[0], 1.5, 0], [HA[0], 3, 4], 38); A(c, 'haruto').pitch = 0.6; } },
  s13: { set: ['hangar', 'hangar'], cast: ['vorn', 'haruto'], grade: { tint: '#ffd8b0', exposure: 0.95 },
    setup: c => { place(c, 'vorn', HA[0] + 0.9, HA[1], -Math.PI / 2 - 0.3); place(c, 'haruto', HA[0] - 0.5, HA[1] + 0.2, Math.PI / 2 + 0.2); c.ui.card('WARLORD VORN', 'Haruto\'s instructor', '#ff3355'); },
    update: c => dolly(c, [HA[0] + 0.3, 1.7, 4], [HA[0] + 0.2, 1.7, 3.2], [HA[0] + 0.2, 1.5, 0], [HA[0] + 0.3, 1.6, 0], 34),
    at: [[0.4, c => cast(c, 'vorn')]] },
  s14: { set: ['training', 'training'], cast: ['yuzu', 'yuzu#brother'], grade: DUSK,
    setup: c => { place(c, 'yuzu', TR[0], TR[1], Math.PI / 2); place(c, 'yuzu#brother', TR[0] - 1.2, TR[1] + 1.2, Math.PI / 2 - 0.4); c.ui.card('YUZU', 'The Dawnshot', '#ffb347'); },
    update: c => { orbit(c, [TR[0], 0, TR[1]], 5, 1.3, -0.6, -0.2, 36, 1.2); A(c, 'yuzu').charging = c.k > 0.2 && c.k < 0.62; },
    at: [[0.8, () => snd('bowdraw')], [2.5, c => { attack(c, 'yuzu'); fx(c, 'tracer', P(c, TR[0] + 0.6, 1.4, TR[1]), { to: P(c, TR[0] + 30, 2, TR[1]), color: '#ffd27a' }); snd('bow'); }], [3.1, c => cast(c, 'yuzu#brother')]] },
  s15: { set: ['training', 'training'], grade: DUSK,
    setup: c => { prop(c, 'leafL', () => new THREE.Mesh(new THREE.CircleGeometry(0.18, 12, 0, Math.PI), new THREE.MeshStandardMaterial({ color: '#e0902a', side: THREE.DoubleSide })), TR[0] + 8, 3, TR[1]); prop(c, 'leafR', () => new THREE.Mesh(new THREE.CircleGeometry(0.18, 12, Math.PI, Math.PI), new THREE.MeshStandardMaterial({ color: '#e0902a', side: THREE.DoubleSide })), TR[0] + 8, 3, TR[1]); },
    update: c => { cam(c, [TR[0] + 7.2, 3.05, TR[1] + 0.9], [TR[0] + 8, 3, TR[1]], 24); const cut = Math.max(0, c.k - 0.45); const L = tmp.get('leafL')!, R = tmp.get('leafR')!; L.position.set(TR[0] + 8, 3 - c.k * 0.3 + cut * 0.4, TR[1] - cut * 0.8); R.position.set(TR[0] + 8, 3 - c.k * 0.3 - cut * 0.6, TR[1] + cut * 0.8); L.rotation.set(c.t * 1.5, 0.4, cut * 6); R.rotation.set(c.t * 1.5, 0.4, -cut * 6); },
    at: [[1.2, c => { fx(c, 'tracer', P(c, TR[0] - 10, 3, TR[1]), { to: P(c, TR[0] + 20, 3, TR[1]), color: '#fff0a0' }); snd('bow'); c.ui.impact(); }]] },
  // ---------------------------------------------------------------- II. the Eclipse
  s16: { set: ['kurogane', 'kurogane'], cast: ['raijin', 'haruto', 'yuzu', 'kaien'], grade: { tint: '#ffb0a0', exposure: 0.9 },
    setup: c => { ['raijin', 'haruto', 'yuzu', 'kaien'].forEach((k, i) => place(c, k, KU[0] + 2 + i * 1.3, (i - 1.5) * 0.9, Math.PI / 2)); A(c, 'raijin').pitch = 0.5; const s = prop(c, 'sun', () => skyDisc('#fff4d0', 9), KU[0] + 90, 45, 0); s.lookAt(KU[0], 0, 0); const m = prop(c, 'moon', () => skyDisc('#050308', 9.2, true), KU[0] + 89, 45, -18); m.lookAt(KU[0], 0, 0); },
    update: c => { dolly(c, [KU[0] - 2, 1.4, 3], [KU[0] - 2, 1.2, 2], [KU[0] + 90, 40, 0], [KU[0] + 90, 44, 0], 42); tmp.get('moon')!.position.z = lerp(-18, 0, ease(Math.min(1, c.k * 1.3))); c.st.grade({ tint: c.k > 0.7 ? '#ff7060' : '#ffc0a0', exposure: lerp(0.95, 0.55, ease(c.k)), sat: 1.3 }); },
    at: [[0.5, () => snd('singularity', 0.6)], [3.5, c => { c.ui.impact('invert'); snd('boom'); }]] },
  s17: { set: ['rift', 'rift'], grade: VIOLET,
    update: c => { dolly(c, [RI[0] - 10, 3, 14], [RI[0] - 10, 6, 10], [RI[0] + 20, 20, 0], [RI[0] + 20, 30, 0], 55); if (c.t % 0.45 < c.dt) { fx(c, 'lightning', P(c, RI[0] + 10 + Math.random() * 30, 40, (Math.random() - 0.5) * 30), { to: P(c, RI[0] + 10 + Math.random() * 30, 10, (Math.random() - 0.5) * 30) }); snd('thunder', 0.5); } } },
  s18: { set: ['rift', 'rift'], cast: ['kagemaru', 'hex', 'nocturne', 'enra'], grade: { tint: '#b08aff', exposure: 0.6, sat: 1.1 },
    setup: c => { ['kagemaru', 'hex', 'nocturne', 'enra'].forEach((k, i) => place(c, k, RI[0] + 8, (i - 1.5) * 2.4, -Math.PI / 2)); },
    update: c => dolly(c, [RI[0] - 2, 1, 0], [RI[0] + 1, 1.2, 0], [RI[0] + 8, 2.5, 0], [RI[0] + 8, 2.2, 0], 44),
    at: [[1.2, c => { ['kagemaru', 'hex', 'nocturne', 'enra'].forEach(k => cast(c, k)); fx(c, 'singularity', P(c, RI[0] + 14, 8, 0), { r: 8, color: '#b56dff' }); snd('singularity', 0.7); }]] },
  s19: { set: ['cathedral', 'cathedral'], cast: ['nocturne'], grade: RED,
    setup: c => { place(c, 'nocturne', CA[0], CA[1], 0); const m = prop(c, 'bloodmoon', () => skyDisc('#ff2a2a', 14), CA[0], 60, CA[1] + 120); m.lookAt(CA[0], 2, CA[1]); c.ui.card('LADY NOCTURNE', 'The Crimson Diva', '#ff4d6d'); },
    update: c => { dolly(c, [CA[0], 0.8, CA[1] - 6], [CA[0], 1.4, CA[1] - 4], [CA[0], 3, CA[1] + 10], [CA[0], 2, CA[1]], 40); A(c, 'nocturne').flying = c.k > 0.5; A(c, 'nocturne').pos.y = c.st.set!.ground(CA[0], CA[1]) + Math.max(0, c.k - 0.5) * 1.6; },
    at: [[0.6, () => snd('requiem', 0.8)], [2.4, c => { cast(c, 'nocturne', 'requiem'); fx(c, 'requiem', P(c, CA[0], 1, CA[1]), { r: 8, color: '#ff2d55' }); }]] },
  s20: { set: ['amatsu', 'amatsu'], cast: ['mirei'], grade: { tint: '#7f90d0', exposure: 0.65, sat: 0.9 }, weather: 'stars',
    setup: c => place(c, 'mirei', AM[0] + 2, 0, -Math.PI / 2),
    update: c => { dolly(c, [AM[0] - 1.5, 1.5, 1.5], [AM[0] - 0.4, 1.5, 0.8], [AM[0] + 2, 1.4, 0], [AM[0] + 2, 1.35, 0], 32); c.st.grade({ tint: '#7f90d0', exposure: lerp(0.7, 0.5, c.k), sat: 0.9 }); },
    at: [[0.6, c => hit(c, 'mirei')]] },
  s21: { set: ['amatsu', 'amatsu'], cast: ['kagemaru'], grade: { tint: '#ffa070', exposure: 0.75 }, weather: 'embers',
    setup: c => { prop(c, 'tree', sacredTree, AM[0] + 14, c.st.set!.ground(AM[0] + 14, 0), 0); place(c, 'kagemaru', AM[0] + 9, 0, Math.PI / 2); },
    update: c => { orbit(c, [AM[0] + 9, 0, 0], 4.5, 1.4, -1.2, -0.6, 36, 1.5); if (c.k > 0.5 && c.t % 0.08 < c.dt) fx(c, 'burst', P(c, AM[0] + 12 + Math.random() * 3, 3 + Math.random() * 6, (Math.random() - 0.5) * 3), { r: 1, color: '#ff7a2a' }); },
    at: [[0.5, c => { cast(c, 'kagemaru'); snd('flamestart'); }], [1.8, () => snd('boom', 0.6)]] },
  s22: { set: ['amatsu', 'amatsu'], grade: { tint: '#ff9060', exposure: 0.8, sat: 1.3 }, weather: 'embers',
    setup: c => prop(c, 'tree', sacredTree, AM[0] + 14, c.st.set!.ground(AM[0] + 14, 0), 0),
    update: c => { dolly(c, [AM[0] - 2, 3, 10], [AM[0] + 2, 8, 12], [AM[0] + 14, 8, 0], [AM[0] + 14, 12, 0], 44); const t = tmp.get('tree')!; ((t.getObjectByName('glow') as THREE.PointLight).color.set('#ff5a1a')); if (c.t % 0.05 < c.dt) fx(c, 'burst', P(c, AM[0] + 14 + (Math.random() - 0.5) * 8, 2 + Math.random() * 14, (Math.random() - 0.5) * 8), { r: 1.2, color: Math.random() < 0.5 ? '#ff7a2a' : '#ffd060' }); t.children.forEach(o => { if (o.name === 'seal') o.position.y += c.dt * 1.5; }); },
    at: [[0.2, () => snd('flamestart')], [1.5, () => snd('flame', 0.8)], [3, () => snd('boom', 0.5)]] },
  s23: { set: ['amatsu', 'amatsu'], cast: ['kaien'], grade: { tint: '#ff9a60', exposure: 0.8 }, weather: 'embers',
    setup: c => prop(c, 'tree', sacredTree, AM[0] + 14, c.st.set!.ground(AM[0] + 14, 0), 0),
    update: c => { walk(c, 'kaien', [AM[0] - 2, 0], [AM[0] + 5, 0], 0.1, 0.8); cam(c, [A(c, 'kaien').pos.x + 3.5, 1.4, 2.5], [A(c, 'kaien').pos.x, 1.3, 0], 36); if (c.k > 0.7) A(c, 'kaien').vel = { x: 0, y: 0, z: 0 }; },
    at: [[2.6, c => { cast(c, 'kaien'); fx(c, 'papers', P(c, AM[0] + 5, 1.6, 0), { color: '#fff6d8' }); snd('talisman'); }]] },
  s24: { set: ['kurogane', 'kurogane'], grade: { tint: '#ff7070', exposure: 0.7, sat: 1.3 },
    setup: c => { const s = prop(c, 'stone', sealStone, KU[0] + 6, c.st.set!.ground(KU[0] + 6, 0) - 0.5, 0); s.getObjectByName('L')!.position.x = -1.2; s.getObjectByName('R')!.position.x = 1.2; },
    update: c => { dolly(c, [KU[0] - 1, 2.5, 5], [KU[0] - 2, 4, 7], [KU[0] + 6, 3, 0], [KU[0] + 6, 4, 0], 40); const s = tmp.get('stone')!, open = ease(Math.max(0, (c.k - 0.35) / 0.4)); s.getObjectByName('L')!.position.x = -1.2 - open * 1.4; s.getObjectByName('R')!.position.x = 1.2 + open * 1.4; s.getObjectByName('L')!.rotation.z = open * 0.35; s.getObjectByName('R')!.rotation.z = -open * 0.35; ((s.getObjectByName('glow') as THREE.PointLight).intensity = 20 + open * 200); },
    at: [[1.2, c => { fx(c, 'burst', P(c, KU[0] + 6, 3, 0), { r: 4, color: '#ff2a3a' }); snd('slam'); c.ui.impact('invert'); c.st.shake = 0.4; }], [2.2, c => fx(c, 'slam', P(c, KU[0] + 6, 0.2, 0), { r: 6, color: '#ff2a3a' })]] },
  s25: { set: ['kurogane', 'kurogane'], cast: ['enra'], grade: { tint: '#ff8060', exposure: 0.85, sat: 1.35 }, weather: 'embers',
    setup: c => { place(c, 'enra', KU[0] + 6, 0, -Math.PI / 2); c.ui.card('ENRA', 'The Crimson Oni', '#ff6a2a'); },
    update: c => { const a = A(c, 'enra'); a.pos.y = c.st.set!.ground(KU[0] + 6, 0) - 3 + ease(Math.min(1, c.k * 1.6)) * 3; dolly(c, [KU[0] + 1, 0.4, 2], [KU[0] + 0.5, 0.6, 1.5], [KU[0] + 6, 2, 0], [KU[0] + 6, 3, 0], 40); if (c.t % 0.06 < c.dt) fx(c, 'burst', P(c, KU[0] + 6 + (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4), { r: 1, color: '#ff6a2a' }); },
    at: [[0.2, () => snd('roar')], [2.8, c => { cast(c, 'enra', 'asura'); fx(c, 'ultflash', P(c, KU[0] + 6, 2, 0), { color: '#ff6a2a' }); snd('roar'); c.st.shake = 0.3; }]] },
  s26: { set: ['kurogane', 'kurogane'], cast: ['raijin', 'enra'], grade: { tint: '#8090d0', exposure: 0.7, sat: 1.0 }, weather: 'rain',
    setup: c => { place(c, 'raijin', KU[0] + 1, 0, Math.PI / 2); A(c, 'raijin').charging = true; place(c, 'enra', KU[0] + 16, 3, -Math.PI / 2); },
    update: c => { dolly(c, [KU[0] - 2.5, 1.0, 1.4], [KU[0] - 1.8, 1.1, 1], [KU[0] + 1, 0.9, 0], [KU[0] + 1, 1, 0], 34); if (c.t % 0.12 < c.dt) fx(c, 'burst', P(c, KU[0] + 16 + Math.random() * 4, Math.random() * 3, 3 + (Math.random() - 0.5) * 4), { r: 1, color: '#ff6a2a' }); } },
  s27: { set: ['hangar', 'hangar'], cast: ['gorgoth'], grade: { tint: '#ff9090', exposure: 0.55 },
    setup: c => place(c, 'gorgoth', HA[0] + 5, HA[1], -0.4),
    update: c => { dolly(c, [HA[0] + 3.4, 2.8, 3.4], [HA[0] + 3.8, 2.9, 2.8], [HA[0] + 5, 2.8, 0], [HA[0] + 5, 2.9, 0], 30); A(c, 'gorgoth').yaw = lerp(-0.4, -0.9, ease(c.k)); },
    at: [[0.6, c => { fx(c, 'ultflash', P(c, HA[0] + 5, 2.9, 0.5), { color: '#ff2244' }); snd('mechjump', 0.6); }], [2, () => snd('denied')]] },
  s28: { set: ['hangar', 'hangar'], cast: ['gorgoth', 'tenkai'], grade: { tint: '#ff9a80', exposure: 0.8, sat: 1.3 },
    setup: c => { place(c, 'tenkai', HA[0] - 2, HA[1], Math.PI / 2); place(c, 'gorgoth', HA[0] + 1.5, HA[1], -Math.PI / 2); },
    update: c => orbit(c, [HA[0] - 0.3, 0, 0], 8, 2.5, 0.4, 0.9, 42, 2.2),
    at: [[0.6, c => { attack(c, 'gorgoth', 'secondary'); snd('lance'); }], [0.95, c => { hit(c, 'tenkai'); fx(c, 'burst', P(c, HA[0] - 1.2, 2, 0.8), { r: 3, color: '#ffcc66' }); fx(c, 'impact', P(c, HA[0] - 1.2, 2, 0.8), { color: '#ffcc66' }); snd('slam'); c.ui.impact(); c.st.shake = 0.5; }], [2.2, c => fx(c, 'dust', P(c, HA[0] - 1, 0, 2), { r: 3 })]] },
  s29: { set: ['hangar', 'hangar'], cast: ['haruto'], grade: { tint: '#ffb080', exposure: 0.85 },
    setup: c => place(c, 'haruto', HA[0] - 6, HA[1] + 3, 0.6),
    update: c => { const a = A(c, 'haruto'), kb = Math.min(1, c.k / 0.3); a.pos.x = HA[0] - 6 - ease(kb) * 2.5; a.pos.y = c.st.set!.ground(a.pos.x, a.pos.z) + Math.sin(kb * Math.PI) * 0.9; a.grounded = kb >= 1; cam(c, [HA[0] - 11, 1.2, HA[1] + 5], [a.pos.x, 1, a.pos.z], 38); if (c.t % 0.15 < c.dt) fx(c, 'burst', P(c, HA[0] - 2 + Math.random() * 3, 1 + Math.random() * 3, HA[1]), { r: 2, color: '#ff9a3a' }); },
    at: [[0.1, c => { hit(c, 'haruto'); fx(c, 'burst', P(c, HA[0] - 4, 1.5, HA[1] + 2), { r: 4, color: '#ffcc66' }); snd('boom'); c.st.shake = 0.4; }], [1.8, c => cast(c, 'haruto')]] },
  s30: { set: ['rift', 'rift'], cast: ['hex'], grade: VIOLET,
    setup: c => { place(c, 'hex', RI[0], RI[1], 0); c.ui.card('HEX', 'The Dollmaker', '#b56dff'); },
    update: c => dolly(c, [RI[0] + 1, 1.6, 4], [RI[0] + 0.6, 1.8, 3], [RI[0], 1.7, 0], [RI[0], 1.9, 0], 34),
    at: [[0.8, c => { cast(c, 'hex', 'theater'); fx(c, 'strings', P(c, RI[0], 1.6, 0), { to: P(c, RI[0] + 2, 1, 4), color: '#c77dff' }); snd('strings'); }], [2.4, c => fx(c, 'strings', P(c, RI[0], 1.6, 0), { to: P(c, RI[0] - 2, 1.2, 4), color: '#c77dff' })]] },
  s31: { set: ['rift', 'rift'], grade: { tint: '#a080e0', exposure: 0.75 },
    setup: c => { prop(c, 'scarf', scarf, RI[0] + 2, 3, 0); },
    update: c => { const s = tmp.get('scarf') as THREE.Mesh; s.position.set(RI[0] + 2 + c.k * 3, 3 + Math.sin(c.t) * 0.3, -c.k * 2); s.rotation.set(0.3, c.t * 0.3, Math.sin(c.t * 0.7) * 0.4); waveScarf(s, c.t); cam(c, [RI[0] - 1, 3.2, 3], [s.position.x, s.position.y, s.position.z], 32); },
    at: [[0.5, () => snd('strings', 0.5)]] },
  s32: { set: ['rift', 'rift'], cast: ['nocturne', 'kagemaru', 'gorgoth', 'enra', 'hex'], grade: VIOLET,
    setup: c => { const L = ['nocturne', 'kagemaru', 'gorgoth', 'enra', 'hex']; L.forEach((k, i) => place(c, k, RI[0] + (i === 2 ? 2 : 0), (i - 2) * 2.8, -Math.PI / 2)); c.ui.card('THE UMBRA SYNDICATE', 'Five who fell', '#ff3b5c'); },
    update: c => { dolly(c, [RI[0] - 9, 0.5, 0], [RI[0] - 6.5, 0.7, 0], [RI[0], 2.5, 0], [RI[0], 2.8, 0], 44); if (c.t % 0.5 < c.dt) fx(c, 'lightning', P(c, RI[0] + 20, 30, (Math.random() - 0.5) * 20), { to: P(c, RI[0] + 10, 0, (Math.random() - 0.5) * 20) }); },
    at: [[0.4, () => snd('thunder')], [1.6, c => ['nocturne', 'kagemaru', 'gorgoth', 'enra', 'hex'].forEach(k => cast(c, k))], [1.7, () => snd('roar', 0.7)]] },
  // ---------------------------------------------------------------- III. five who stood up
  s33: { set: ['kurogane', 'kurogane'], cast: ['haruto'], grade: { tint: '#b0a8c8', exposure: 0.85, sat: 0.7 }, weather: 'embers',
    setup: c => place(c, 'haruto', KU[0] + 8, 0, Math.PI / 2),
    update: c => { dolly(c, [KU[0] + 2, 2, 4], [KU[0] + 4, 1.8, 3], [KU[0] + 8, 1.5, 0], [KU[0] + 8, 1.3, 0], 40); if (c.t % 0.4 < c.dt) fx(c, 'smoke', P(c, KU[0] + 12 + Math.random() * 10, 1, (Math.random() - 0.5) * 12), { color: '#554a55' }); } },
  s34: { set: ['hangar', 'hangar'], cast: ['haruto'], grade: { tint: '#ffc860', exposure: 0.85, sat: 1.3, vignette: 0.6 },
    setup: c => { place(c, 'haruto', HA[0], HA[1], 0); c.ui.cockpit(true); },
    update: c => { cam(c, [HA[0] + 0.9, 1.6, 2.6 - c.k * 0.6], [HA[0], 1.55, 0], 30); if (c.k > 0.45) A(c, 'haruto').charging = true; },
    at: [[1.2, c => { cast(c, 'haruto'); snd('ultcall'); }], [2.6, c => c.ui.impact()]] },
  s35: { set: ['hangar', 'hangar'], cast: ['tenkai'], grade: { tint: '#ffe0a0' },
    setup: c => { place(c, 'tenkai', HA[0], HA[1], Math.PI); c.ui.cockpit(false); c.ui.card('TENKAI-OH', 'The Dawn Colossus', '#f4d35e'); },
    update: c => { dolly(c, [HA[0], 2.7, -2.8], [HA[0], 2.8, -2.2], [HA[0], 2.7, 0], [HA[0], 2.8, 0], 34); if (c.t % 0.2 < c.dt && c.k > 0.4) fx(c, 'smoke', P(c, HA[0] + (Math.random() - 0.5) * 3, 2, 0), { color: '#ffffff' }); },
    at: [[0.9, c => { cast(c, 'tenkai', 'colossus'); fx(c, 'ultflash', P(c, HA[0], 2.8, -0.3), { color: '#ffd76a' }); snd('mechjump'); c.st.shake = 0.2; }], [1.4, () => snd('ultcall')]] },
  s36: { set: ['amatsu', 'amatsu'], cast: ['mirei'], grade: { tint: '#b8c8ff', exposure: 0.95 }, weather: 'stars',
    setup: c => { place(c, 'mirei', AM[0] + 2, 0, -Math.PI / 2); c.ui.card('MIREI', 'The Starweaver', '#8fd3ff'); },
    update: c => { orbit(c, [AM[0] + 2, 0, 0], 4.5, 1.5, -2.1, -1.2, 36, 1.4); if (c.t % 0.15 < c.dt) fx(c, 'wish', P(c, AM[0] + 2 + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 3), { color: '#bfe8ff' }); },
    at: [[0.6, c => { cast(c, 'mirei', 'constellation'); snd('constellation'); }]] },
  s37: { set: ['amatsu', 'amatsu'], cast: ['mirei'], grade: { tint: '#c8d8ff' }, weather: 'stars',
    setup: c => place(c, 'mirei', AM[0] + 2, 0, -Math.PI / 2),
    update: c => { const a = A(c, 'mirei'); a.flying = true; a.grounded = false; a.pos.y = c.st.set!.ground(AM[0] + 2, 0) + ease(c.k) * 14; a.vel = { x: 0, y: 5, z: 0 }; cam(c, [AM[0] - 4, a.pos.y - 1.5, 3], [a.pos.x, a.pos.y + 1, 0], 40); if (c.t % 0.05 < c.dt) fx(c, 'healhit', P(c, a.pos.x, a.pos.y, 0)); },
    at: [[0.2, () => snd('sunhop')]] },
  s38: { set: ['amatsu', 'amatsu'], cast: ['kaien'], grade: DUSK,
    update: c => { walk(c, 'kaien', [AM[0] + 6, 0], [AM[0] - 2, 0]); const a = A(c, 'kaien'); cam(c, [a.pos.x - 4, 1.6, 2.2], [a.pos.x, 1.3, 0], 36); if (c.t % 0.12 < c.dt) fx(c, 'papers', P(c, a.pos.x, 1.4, 0), { color: '#fff6d8' }); },
    at: [[0.3, () => snd('talisman', 0.6)], [2, () => snd('seal', 0.5)]] },
  s39: { set: ['kurogane', 'kurogane'], cast: ['raijin'], grade: { tint: '#90b0ff', exposure: 0.85, sat: 1.2 }, weather: 'rain',
    setup: c => place(c, 'raijin', KU[0] + 2, 0, Math.PI / 2),
    update: c => { orbit(c, [KU[0] + 2, 0, 0], 4, 0.6, 2.6, 2.1, 38, 1.8); A(c, 'raijin').pitch = 0.9; },
    at: [[0.5, c => cast(c, 'raijin', 'judgment')], [1.4, c => { fx(c, 'lightning', P(c, KU[0] + 2, 40, 0), { to: P(c, KU[0] + 2.3, 2.2, 0) }); snd('thunderclap'); c.ui.impact(); c.st.shake = 0.3; }], [2.6, c => { fx(c, 'lightning', P(c, KU[0] + 4, 40, 3), { to: P(c, KU[0] + 2.3, 2.2, 0) }); snd('thunder'); c.ui.impact('invert'); }]] },
  s40: { set: ['training', 'training'], cast: ['yuzu'], grade: NIGHT,
    setup: c => place(c, 'yuzu', TR[0], TR[1], Math.PI / 2),
    update: c => { dolly(c, [TR[0] + 2.2, 1.5, TR[1] + 0.8], [TR[0] + 1.6, 1.45, TR[1] + 0.5], [TR[0], 1.4, TR[1]], [TR[0], 1.45, TR[1]], 30); A(c, 'yuzu').charging = true; },
    at: [[0.4, () => snd('bowdraw')]] },
  // ---------------------------------------------------------------- IV. the Night of the Academy
  s41: { set: ['training', 'training'], grade: { tint: '#b090ff', exposure: 0.8, sat: 1.3 },
    update: c => { dolly(c, [TR[0] - 20, 12, 22], [TR[0] - 12, 8, 16], [TR[0], 4, 0], [TR[0] + 4, 5, 0], 50); if (c.t % 0.3 < c.dt) { fx(c, 'burst', P(c, TR[0] + (Math.random() - 0.5) * 30, 1 + Math.random() * 5, (Math.random() - 0.5) * 20), { r: 3, color: '#ff8a4a' }); snd('boom', 0.5); } },
    at: [[0.2, c => { fx(c, 'singularity', P(c, TR[0] + 5, 18, 0), { r: 10, color: '#b56dff' }); snd('singularity'); }]] },
  s42: { set: ['training', 'training'], cast: ['enra', 'gorgoth', 'nocturne'], grade: { tint: '#c098ff', exposure: 0.85, sat: 1.3 },
    setup: c => { place(c, 'enra', TR[0] + 6, TR[1] - 3, -Math.PI / 2); place(c, 'gorgoth', TR[0] + 8, TR[1] + 3, -Math.PI / 2); place(c, 'nocturne', TR[0] + 9, TR[1], -Math.PI / 2); },
    update: c => { const drop = (k: string, t0: number, x: number, z: number) => { const a = A(c, k), u = Math.min(1, Math.max(0, (c.k - t0) / 0.25)); a.pos.y = c.st.set!.ground(x, z) + (1 - u) * 18; a.grounded = u >= 1; a.flying = k === 'nocturne'; if (k === 'nocturne') a.pos.y += 3; }; drop('enra', 0.05, TR[0] + 6, TR[1] - 3); drop('gorgoth', 0.3, TR[0] + 8, TR[1] + 3); drop('nocturne', 0.5, TR[0] + 9, TR[1]); dolly(c, [TR[0] - 4, 1.2, 0], [TR[0] - 3, 1.5, 0], [TR[0] + 7, 3, 0], [TR[0] + 7, 2.5, 0], 46); },
    at: [[0.9, c => { fx(c, 'slam', P(c, TR[0] + 6, 0.1, TR[1] - 3), { r: 5, color: '#ff6a2a' }); snd('mechland'); c.st.shake = 0.5; }], [1.8, c => { fx(c, 'slam', P(c, TR[0] + 8, 0.1, TR[1] + 3), { r: 5, color: '#ff2244' }); snd('mechland'); c.st.shake = 0.5; }], [2.5, () => snd('roar')]] },
  s43: { set: ['training', 'training'], cast: ['tenkai'], grade: { tint: '#ffe0a8', sat: 1.25 },
    setup: c => place(c, 'tenkai', TR[0] - 2, TR[1], Math.PI / 2),
    update: c => { const a = A(c, 'tenkai'), u = Math.min(1, c.k / 0.3); a.pos.y = c.st.set!.ground(TR[0] - 2, TR[1]) + (1 - ease(u)) * 20; a.grounded = u >= 1; a.flying = u < 1; a.barrier.up = c.k > 0.55; dolly(c, [TR[0] + 5, 1, 4], [TR[0] + 4, 1.4, 5], [TR[0] - 2, 3, 0], [TR[0] - 2, 2.5, 0], 44); },
    at: [[1.2, c => { fx(c, 'slam', P(c, TR[0] - 2, 0.1, TR[1]), { r: 6, color: '#ffd76a' }); snd('mechland'); c.ui.impact(); c.st.shake = 0.6; }], [2.2, () => snd('barrierup')]] },
  s44: { set: ['training', 'training'], cast: ['mirei'], grade: { tint: '#b8d0ff' },
    update: c => { const a = A(c, 'mirei'); a.pos = { x: TR[0] - 4, y: lerp(14, 2.5, ease(c.k)), z: TR[1] - 3 }; a.flying = true; a.grounded = false; a.yaw = Math.PI / 2; a.vel = { x: 0, y: -3, z: 0 }; cam(c, [a.pos.x - 3.5, a.pos.y + 0.4, a.pos.z - 3.5], [a.pos.x, a.pos.y + 1, a.pos.z], 38); },
    at: [[1.6, c => { cast(c, 'mirei', 'nova'); fx(c, 'nova', P(c, TR[0] - 4, 2, TR[1] - 3), { r: 8, color: '#bfe8ff' }); snd('nova'); }]] },
  s45: { set: ['training', 'training'], cast: ['kaien'], grade: { tint: '#e0d8ff' },
    setup: c => place(c, 'kaien', TR[0] - 5, TR[1] + 3, Math.PI / 2),
    update: c => { orbit(c, [TR[0] - 5, 0, TR[1] + 3], 4.5, 1.6, 1.2, 1.9, 38, 1.4); if (c.t % 0.1 < c.dt) fx(c, 'papers', P(c, TR[0] - 5, 1.5, TR[1] + 3), { color: '#fff6d8' }); },
    at: [[0.8, c => { cast(c, 'kaien', 'sanctuary'); fx(c, 'sealcast', P(c, TR[0] - 5, 0.1, TR[1] + 3), { r: 4, color: '#ffe28a' }); snd('seal'); }]] },
  s46: { set: ['training', 'training'], cast: ['raijin'], grade: { tint: '#b0d0ff', sat: 1.3 },
    setup: c => place(c, 'raijin', TR[0] - 3, TR[1] - 5, Math.PI / 2),
    update: c => dolly(c, [TR[0] + 1, 1.3, TR[1] - 3], [TR[0] + 0.5, 1.3, TR[1] - 3.5], [TR[0] - 3, 1.3, TR[1] - 5], [TR[0] - 3, 1.4, TR[1] - 5], 34),
    at: [[0.15, c => { fx(c, 'lightning', P(c, TR[0] - 3, 30, TR[1] - 5), { to: P(c, TR[0] - 3, 0.5, TR[1] - 5) }); fx(c, 'flash', P(c, TR[0] - 3, 1, TR[1] - 5), { color: '#8ad8ff' }); snd('flashstep'); c.ui.impact(); }], [0.9, c => attack(c, 'raijin')]] },
  s47: { set: ['training', 'training'], cast: ['yuzu'], grade: NIGHT,
    setup: c => place(c, 'yuzu', TR[0] - 6, TR[1] - 8, 0.8),
    update: c => { orbit(c, [TR[0] - 6, 0, TR[1] - 8], 3.6, 1.4, -2.4, -2.0, 34, 1.4); A(c, 'yuzu').charging = c.k < 0.7; },
    at: [[0.2, () => snd('bowdraw')], [2.1, c => { attack(c, 'yuzu'); fx(c, 'tracer', P(c, TR[0] - 5.4, 1.4, TR[1] - 7.4), { to: P(c, TR[0] + 20, 3, TR[1] + 12), color: '#ffd27a' }); snd('bow'); }]] },
  // -- duel 1: Tenkai-Oh vs Gorgoth - the Dawn Charge meets the Abyss Charge head-on
  s48: { set: ['training', 'training'], cast: ['gorgoth'], grade: { tint: '#ff9a9a', sat: 1.3 },
    update: c => { walk(c, 'gorgoth', [TR[0] + 22, TR[1]], [TR[0] + 6, TR[1]]); const a = A(c, 'gorgoth'); a.vel.x *= 2.2; cam(c, [a.pos.x - 7, 1.2, 2.5], [a.pos.x, 2, 0], 40); if (c.t % 0.05 < c.dt) fx(c, 'dust', P(c, a.pos.x, 0.1, 0), { r: 1.5 }); c.ui.speedLines(true, '#ff2244'); },
    at: [[0.1, c => { fx(c, 'chargetrail', P(c, TR[0] + 22, 1.5, 0), { actor: A(c, 'gorgoth'), color: '#ff2244', dur: 3 }); snd('charge'); }]] },
  s49: { set: ['training', 'training'], cast: ['tenkai'], grade: { tint: '#ffe0a0', sat: 1.3 },
    update: c => { walk(c, 'tenkai', [TR[0] - 18, TR[1]], [TR[0] - 2, TR[1]]); const a = A(c, 'tenkai'); a.vel.x *= 2.2; a.forced = { vx: a.vel.x, vy: 0, vz: 0, until: 1e9, kind: 'dawncharge' }; cam(c, [a.pos.x + 7, 1.4, -2.5], [a.pos.x, 2, 0], 40); if (c.t % 0.05 < c.dt) fx(c, 'dust', P(c, a.pos.x, 0.1, 0), { r: 1.5 }); c.ui.speedLines(true, '#ffd76a'); },
    at: [[0.1, c => { fx(c, 'chargetrail', P(c, TR[0] - 18, 1.5, 0), { actor: A(c, 'tenkai'), color: '#ffd76a', dur: 3 }); snd('charge'); snd('mechjump'); }]] },
  s50: { set: ['training', 'training'], cast: ['tenkai', 'gorgoth'], grade: { tint: '#fff0d0', sat: 1.35 },
    update: c => { const u = Math.min(1, c.k / 0.25); const tx = lerp(TR[0] - 4, TR[0] - 1.6, u), gx = lerp(TR[0] + 4, TR[0] + 1.6 + Math.max(0, c.k - 0.25) * 6, u); place(c, 'tenkai', tx, 0, Math.PI / 2); place(c, 'gorgoth', gx, 0, -Math.PI / 2); if (u < 1) A(c, 'tenkai').forced = { vx: 8, vy: 0, vz: 0, until: 1e9, kind: 'dawncharge' }; orbit(c, [TR[0], 0, 0], 9, 2.2, 1.35, 1.85, 42, 2); c.ui.speedLines(c.k < 0.3, '#ffffff'); },
    at: [[0.95, c => { fx(c, 'slam', P(c, TR[0], 1, 0), { r: 8, color: '#ffd76a' }); fx(c, 'burst', P(c, TR[0], 2.5, 0), { r: 5, color: '#fff0a0' }); hit(c, 'gorgoth'); snd('slam'); snd('counter'); c.ui.impact('invert'); c.st.shake = 1.0; }], [1.15, c => c.ui.impact()], [1.4, c => fx(c, 'interrupt', P(c, TR[0] + 2, 3, 0), { color: '#ffffff' })]] },
  // -- duel 2: Mirei vs Nocturne - song against song
  s51: { set: ['training', 'training'], cast: ['nocturne'], grade: { tint: '#ff90a8', exposure: 0.85, sat: 1.3 },
    update: c => { const a = A(c, 'nocturne'); a.pos = { x: TR[0] + 8, y: 4 + Math.sin(c.t * 1.5) * 0.3, z: TR[1] }; a.flying = true; a.grounded = false; a.yaw = -Math.PI / 2; dolly(c, [TR[0] + 4, 4.5, 3], [TR[0] + 5, 4.6, 2.2], [TR[0] + 8, 5, 0], [TR[0] + 8, 5, 0], 36); },
    at: [[0.4, c => { cast(c, 'nocturne', 'silence'); fx(c, 'soundcone', P(c, TR[0] + 8, 5, 0), { to: P(c, TR[0] - 4, 3, 0), color: '#ff2d55' }); snd('silence'); c.st.shake = 0.3; }]] },
  s52: { set: ['training', 'training'], cast: ['mirei', 'kaien', 'yuzu'], grade: { tint: '#c8e0ff', sat: 1.3 },
    setup: c => { place(c, 'kaien', TR[0] - 6, TR[1] + 3, Math.PI / 2); place(c, 'yuzu', TR[0] - 6, TR[1] - 3, Math.PI / 2); },
    update: c => { const a = A(c, 'mirei'); a.pos = { x: TR[0] - 4, y: 3.2, z: TR[1] }; a.flying = true; a.grounded = false; a.yaw = Math.PI / 2; orbit(c, [TR[0] - 4, 2, 0], 7, 1.5, -0.9, -0.3, 40, 1.4); },
    at: [[0.3, c => { cast(c, 'mirei', 'constellation'); fx(c, 'link', P(c, TR[0] - 4, 3.2, 0), { to: P(c, TR[0] - 6, 1.4, 3), color: '#bfe8ff' }); fx(c, 'link', P(c, TR[0] - 4, 3.2, 0), { to: P(c, TR[0] - 6, 1.4, -3), color: '#bfe8ff' }); snd('constellation'); }], [1.8, c => { fx(c, 'barrierbreak', P(c, TR[0] - 1, 3, 0), { color: '#ff2d55' }); fx(c, 'nova', P(c, TR[0] - 4, 3, 0), { r: 6, color: '#bfe8ff' }); snd('barrierbreak'); snd('counter'); c.ui.impact(); }]] },
  // -- duel 3: Kaien vs Kagemaru - the seal that no shadow escapes
  s53: { set: ['training', 'training'], cast: ['kagemaru'], grade: { tint: '#a090d0', exposure: 0.75 },
    setup: c => place(c, 'kagemaru', TR[0] + 4, TR[1] + 6, -Math.PI / 2),
    update: c => { orbit(c, [TR[0] + 4, 0, TR[1] + 6], 4, 1.4, 2.3, 1.8, 36, 1.3); const a = A(c, 'kagemaru'); if (c.k > 0.45) a.set('stealth', c.now, 0.2); },
    at: [[0.3, c => { attack(c, 'kagemaru'); fx(c, 'tracer', P(c, TR[0] + 4, 1.4, TR[1] + 6), { to: P(c, TR[0] - 6, 1.4, TR[1] + 3), color: '#9d7bff' }); snd('kunai'); }], [1.3, c => { fx(c, 'smoke', P(c, TR[0] + 4, 1, TR[1] + 6), { color: '#3a2a55' }); snd('veil'); }]] },
  s54: { set: ['training', 'training'], cast: ['kaien', 'kagemaru'], grade: { tint: '#fff0c0' },
    setup: c => { place(c, 'kaien', TR[0], TR[1] + 6, Math.PI / 2); place(c, 'kagemaru', TR[0] + 4, TR[1] + 6, -Math.PI / 2); },
    update: c => { orbit(c, [TR[0] + 2, 0, TR[1] + 6], 7, 3, 0.3, 0.8, 42, 1); const a = A(c, 'kagemaru'); if (c.k < 0.3) a.set('stealth', c.now, 0.2); else { a.clear('stealth'); a.set('stun', c.now, 0.3); } },
    at: [[0.2, c => { cast(c, 'kaien', 'seal'); snd('seal'); }], [0.9, c => { fx(c, 'sealcast', P(c, TR[0] + 4, 0.1, TR[1] + 6), { r: 3.5, color: '#ffe28a' }); fx(c, 'revealburst', P(c, TR[0] + 4, 1.2, TR[1] + 6), { r: 3, color: '#ffe28a' }); snd('unveil'); snd('counter'); c.ui.impact(); }]] },
  // -- duel 4: Raijin vs Enra - the thunder parry
  s55: { set: ['training', 'training'], cast: ['enra'], grade: { tint: '#ffa070', sat: 1.35 }, weather: 'embers',
    setup: c => place(c, 'enra', TR[0] + 3, TR[1] - 6, -Math.PI / 2),
    update: c => dolly(c, [TR[0] - 2.5, 1.0, TR[1] - 4.5], [TR[0] - 2, 0.9, TR[1] - 5], [TR[0] + 3, 2.2, TR[1] - 6], [TR[0] + 3, 2.4, TR[1] - 6], 42),
    at: [[0.4, c => { attack(c, 'enra', 'secondary'); snd('roar'); }], [0.8, c => { fx(c, 'burst', P(c, TR[0] + 1.5, 1.5, TR[1] - 6), { r: 3, color: '#ff6a2a' }); snd('punch'); }]] },
  s56: { set: ['training', 'training'], cast: ['raijin', 'enra'], grade: { tint: '#c0d8ff', sat: 1.35 },
    setup: c => { place(c, 'raijin', TR[0] + 0.5, TR[1] - 6, Math.PI / 2); place(c, 'enra', TR[0] + 3, TR[1] - 6, -Math.PI / 2); },
    update: c => { orbit(c, [TR[0] + 1.7, 0, TR[1] - 6], 6, 1.6, -0.3, 0.4, 40, 1.6); if (c.k > 0.4) A(c, 'enra').set('stun', c.now, 0.2); },
    at: [[0.2, c => { attack(c, 'enra', 'secondary'); }], [0.5, c => { cast(c, 'raijin', 'parry'); fx(c, 'parry', P(c, TR[0] + 1.2, 1.5, TR[1] - 6), { color: '#8ad8ff' }); fx(c, 'lightning', P(c, TR[0] + 1.2, 1.5, TR[1] - 6), { to: P(c, TR[0] + 3, 2.5, TR[1] - 6) }); snd('parry'); snd('thunderclap'); snd('counter'); c.ui.impact('invert'); c.st.shake = 0.6; }], [1.2, c => { attack(c, 'raijin'); fx(c, 'slash', P(c, TR[0] + 3, 2, TR[1] - 6), { color: '#8ad8ff' }); snd('katana'); }]] },
  // -- duel 5: Yuzu vs Hex - the arrow that cuts the strings
  s57: { set: ['training', 'training'], cast: ['hex'], grade: { tint: '#c8a8ff', exposure: 0.85 },
    setup: c => { place(c, 'hex', TR[0] + 5, TR[1] - 10, -Math.PI / 2 - 0.4); const s = prop(c, 'scarf', scarf, TR[0] + 3, 1.6, TR[1] - 10); s.rotation.set(0, 0, 0); },
    update: c => { orbit(c, [TR[0] + 5, 0, TR[1] - 10], 4.2, 1.6, -2.6, -2.1, 36, 1.7); waveScarf(tmp.get('scarf') as THREE.Mesh, c.t); if (c.t % 0.5 < c.dt) fx(c, 'strings', P(c, TR[0] + 5, 1.8, TR[1] - 10), { to: P(c, TR[0] + 3, 1.6, TR[1] - 10), color: '#c77dff' }); },
    at: [[0.4, c => { cast(c, 'hex', 'marionette'); snd('strings'); }]] },
  s58: { set: ['training', 'training'], cast: ['yuzu', 'hex'], grade: { tint: '#ffe0b0', sat: 1.3 },
    setup: c => { place(c, 'yuzu', TR[0] - 5, TR[1] - 10, Math.PI / 2); place(c, 'hex', TR[0] + 5, TR[1] - 10, -Math.PI / 2); const s = prop(c, 'scarf', scarf, TR[0] + 3, 1.6, TR[1] - 10); s.rotation.set(0, 0, 0); },
    update: c => { const s = tmp.get('scarf') as THREE.Mesh, free = Math.max(0, c.k - 0.45); s.position.set(TR[0] + 3 - free * 6, 1.6 + free * 3, TR[1] - 10); waveScarf(s, c.t); A(c, 'yuzu').charging = c.k < 0.35; dolly(c, [TR[0] - 7, 1.5, TR[1] - 8.5], [TR[0] - 2, 1.6, TR[1] - 8], [TR[0], 1.5, TR[1] - 10], [TR[0] + 3, 1.8, TR[1] - 10], 38); },
    at: [[1.4, c => { attack(c, 'yuzu'); fx(c, 'tracer', P(c, TR[0] - 4.4, 1.5, TR[1] - 10), { to: P(c, TR[0] + 5, 1.7, TR[1] - 10), color: '#ffd27a' }); snd('bow'); }], [1.6, c => { fx(c, 'cut', P(c, TR[0] + 3, 1.7, TR[1] - 10), { color: '#ffd27a' }); fx(c, 'burst', P(c, TR[0] + 3, 1.7, TR[1] - 10), { r: 2, color: '#fff0a0' }); hit(c, 'hex'); snd('cut'); snd('counter'); c.ui.impact(); }]] },
  // -- finale: together
  s59: { set: ['training', 'training'], cast: ['tenkai', 'mirei', 'kaien', 'raijin', 'yuzu'], grade: { tint: '#fff4d0', sat: 1.35 },
    setup: c => { place(c, 'tenkai', TR[0] - 4, 0, Math.PI / 2); place(c, 'kaien', TR[0] - 5, 3, Math.PI / 2); place(c, 'raijin', TR[0] - 3, -3, Math.PI / 2); place(c, 'yuzu', TR[0] - 6, -5, Math.PI / 2); const m = A(c, 'mirei'); place(c, 'mirei', TR[0] - 5, -1.5, Math.PI / 2); m.flying = true; m.pos.y += 3; },
    update: c => { orbit(c, [TR[0] - 4, 0, 0], 10, 3, -2.2, -1.5, 44, 2); A(c, 'yuzu').charging = c.k < 0.3; },
    at: [[0.3, c => { const tgt = P(c, TR[0] + 14, 6, 0); for (const [k, col] of [['tenkai', '#ffd76a'], ['mirei', '#bfe8ff'], ['kaien', '#ffe28a'], ['raijin', '#8ad8ff'], ['yuzu', '#ffd27a']] as [string, string][]) { cast(c, k); const a = A(c, k); fx(c, 'tracer', P(c, a.pos.x, a.pos.y + 1.5, a.pos.z), { to: tgt, color: col }); } snd('ultcall'); }], [0.9, c => { fx(c, 'burst', P(c, TR[0] + 14, 6, 0), { r: 8, color: '#ffffff' }); snd('boom'); c.ui.impact(); c.st.shake = 0.5; }]] },
  s60: { set: ['training', 'training'], cast: ['tenkai'], grade: { tint: '#ffe8b0', sat: 1.35 },
    setup: c => place(c, 'tenkai', TR[0], 0, Math.PI / 2),
    update: c => { orbit(c, [TR[0], 0, 0], 8, 1.2, -0.7, -0.2, 44, 2.4); },
    at: [[0.3, c => { cast(c, 'tenkai', 'shatter'); snd('ultcall'); }], [0.85, c => { fx(c, 'shatter', P(c, TR[0] + 1.2, 0.1, 0), { to: P(c, TR[0] + 18, 0.1, 0), r: 16, color: '#ffd76a' }); snd('slam'); snd('boom'); c.ui.impact('invert'); c.st.shake = 1.1; }], [1.05, c => c.ui.impact()]] },
  s61: { set: ['rift', 'rift'], grade: { tint: '#e0c8ff', exposure: 1.1 },
    update: c => { dolly(c, [RI[0] - 12, 4, 12], [RI[0] - 16, 3, 16], [RI[0] + 20, 22, 0], [RI[0] + 20, 18, 0], 55); c.st.grade({ tint: '#d8c0ff', exposure: lerp(0.6, 0.85, ease(c.k)) }); },
    at: [[0.4, c => { fx(c, 'implode', P(c, RI[0] + 20, 22, 0), { r: 6, color: '#b56dff' }); snd('implode'); }], [2.2, c => { fx(c, 'slam', P(c, RI[0] + 20, 22, 0), { r: 10, color: '#e0c8ff' }); snd('boom'); c.ui.impact(); }]] },
  // ---------------------------------------------------------------- V. the oath at dawn
  s62: { set: ['training', 'training'], cast: ['tenkai', 'mirei', 'kaien', 'raijin', 'yuzu'], grade: DAWN,
    setup: c => { ['kaien', 'mirei', 'raijin', 'yuzu'].forEach((k, i) => place(c, k, TR[0] + 3, (i - 1.5) * 1.6, Math.PI / 2)); place(c, 'tenkai', TR[0] + 1, 0, Math.PI / 2); const s = prop(c, 'sun', () => skyDisc('#fff0c0', 10), TR[0] + 120, 8, 0); s.lookAt(TR[0], 2, 0); },
    update: c => dolly(c, [TR[0] - 8, 1.2, 0.5], [TR[0] - 6, 1.4, 0.5], [TR[0] + 30, 4, 0], [TR[0] + 30, 5, 0], 42) },
  s63: { set: ['training', 'training'], cast: ['mirei', 'kaien', 'raijin', 'yuzu'], grade: DAWN,
    setup: c => { ['kaien', 'mirei', 'raijin', 'yuzu'].forEach((k, i) => place(c, k, TR[0], (i - 1.5) * 1.1, Math.PI / 2 + (i - 1.5) * 0.12)); },
    update: c => dolly(c, [TR[0] + 5, 1.6, 0], [TR[0] + 3.8, 1.55, 0], [TR[0], 1.4, 0], [TR[0], 1.5, 0], 40) },
  s64: { set: ['training', 'training'], cast: ['mirei', 'kaien', 'raijin', 'yuzu', 'haruto'], grade: DAWN,
    setup: c => { ['kaien', 'mirei', 'raijin', 'yuzu', 'haruto'].forEach((k, i) => { const a = i / 5 * Math.PI * 2; place(c, k, TR[0] + Math.cos(a) * 1.2, Math.sin(a) * 1.2, Math.atan2(-Math.cos(a), -Math.sin(a))); }); },
    update: c => { orbit(c, [TR[0], 0, 0], 2.6, 2.4, 0, 0.6, 40, 1.1); for (const k of ['kaien', 'mirei', 'raijin', 'yuzu', 'haruto']) A(c, k).charging = c.k > 0.3; },
    at: [[1.2, c => { ['kaien', 'mirei', 'raijin', 'yuzu', 'haruto'].forEach(k => cast(c, k)); fx(c, 'sunburst', P(c, TR[0], 1.2, 0), { r: 4, color: '#ffd76a' }); fx(c, 'ultflash', P(c, TR[0], 1.2, 0), { color: '#ffd76a' }); snd('sunburst'); }]] },
  s65: { set: ['training', 'training'], cast: ['tenkai', 'mirei', 'kaien', 'raijin', 'yuzu'], grade: DAWN,
    setup: c => { place(c, 'tenkai', TR[0], 0, -Math.PI / 2); A(c, 'tenkai').scale = 1.35; ['kaien', 'mirei', 'raijin', 'yuzu'].forEach((k, i) => place(c, k, TR[0] - 3.5, (i - 1.5) * 1.8, -Math.PI / 2)); c.ui.card('THE ZENITH VANGUARD', 'Sworn at dawn', '#ffd76a'); },
    update: c => { dolly(c, [TR[0] - 11, 0.5, -1], [TR[0] - 9, 0.8, -0.5], [TR[0], 3.5, 0], [TR[0], 3.2, 0], 46); },
    at: [[0.5, () => snd('victory')]] },
  s66: { set: ['citadel', 'c5_citadel'], cast: ['qelvaris'], grade: { tint: '#c8a8ff', exposure: 0.85, sat: 1.25 },
    setup: c => { place(c, 'qelvaris', CI[0], CI[1], Math.PI); c.ui.card("ARCHON QEL'VARIS", 'The Star-Forger', '#ffd24a'); },
    update: c => { dolly(c, [CI[0] + 0.8, 2.2, -3.6], [CI[0] + 0.4, 2.3, -2.8], [CI[0], 2.1, 0], [CI[0], 2.2, 0], 34); if (c.t % 0.6 < c.dt) fx(c, 'hexburst', P(c, CI[0] + (Math.random() - 0.5) * 3, 2 + Math.random(), 1), { r: 1.5, color: '#b56dff' }); },
    at: [[0.8, c => { cast(c, 'qelvaris'); snd('theater', 0.6); }]] },
  s67: { set: ['citadel', 'c5_citadel'], cast: ['boss_genesis'], grade: { tint: '#b098ff', exposure: 0.8, sat: 1.2 },
    setup: c => place(c, 'boss_genesis', CI[0] + 12, 0, -Math.PI / 2),
    update: c => { orbit(c, [CI[0] + 12, 0, 0], lerp(24, 44, ease(c.k)), 6, -1.9, -1.3, 48, 9); },
    at: [[0.5, () => snd('mechstep', 0.8)], [2.5, () => snd('mechstep', 0.8)], [4, () => snd('singularity', 0.5)]] },
  s68: { set: ['rift', 'rift'], grade: { tint: '#ffd0a0', exposure: 1 },
    setup: c => { const m = prop(c, 'eclipse', () => skyDisc('#050308', 16, true), RI[0] + 100, 40, 0); m.lookAt(RI[0], 0, 0); c.ui.title(true); },
    update: c => { cam(c, [RI[0] - 10, 6, 0], [RI[0] + 100, 38, 0], 36); const e = tmp.get('eclipse')!; const cor = e.getObjectByName('corona') as THREE.Mesh; cor.scale.setScalar(1 + ease(c.k) * 0.4); ((cor.material as THREE.MeshBasicMaterial).color.set(c.k > 0.5 ? '#ffd76a' : '#ff7a3a')); },
    at: [[0.3, () => snd('victory', 0.7)]] },
};
void TITAN_SCALE;
