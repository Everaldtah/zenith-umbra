// Animation clip library: the Quaternius Universal Animation Library 1 & 2 (CC0), plus Mixamo clips that fill gaps,
// baked to rig-independent PoseClips (see Retarget.ts) and sorted into gameplay slots.
//
// public/anim/manifest.json (optional; without it every hero stays fully procedural):
//   { "packs": ["UAL1.glb", "UAL2.glb", "mixamo/Sword Combo.glb"],
//     "slots": { "death": ["Death01", "Death02"] },              // optional: pin clips to a slot by name
//     "exclude": ["T-Pose"],                                     // optional: never use these clips
//     "fp": { "raijin": "fp_raijin.glb" } }                      // Blender-authored first-person arm clips per hero
//
// Slots come from clip names (tolerant of every pack's naming), except locomotion: walk / jog / run / sprint clips
// are placed in an 8-way blend space by the direction and speed they ACTUALLY travel (measured from the feet),
// and missing directions are filled by mirroring (left <-> right) and time-reversal (forward -> backward).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RT, RT_INDEX, type RtBone } from './Rig';
import { bakeClips, analyse, type PoseClip } from './Retarget';

export type Slot = 'idle' | 'jump_start' | 'jump_loop' | 'land' | 'death' | 'hit' | 'punch' | 'melee' | 'roll' | 'dash'
  | 'slide' | 'vault' | 'flip' | 'cast' | 'throw' | 'stun' | 'shoot' | 'block';
export const SLOTS: Slot[] = ['idle', 'jump_start', 'jump_loop', 'land', 'death', 'hit', 'punch', 'melee', 'roll', 'dash', 'slide', 'vault', 'flip', 'cast', 'throw', 'stun', 'shoot', 'block'];

export interface Gait { name: string; speed: number; clips: PoseClip[]; }
export interface Manifest { packs?: string[]; slots?: Partial<Record<Slot, string[]>>; exclude?: string[]; fp?: Record<string, string>; }

const GAIT_ORDER = ['walk', 'jog', 'run', 'sprint'];
// variants that aren't the plain, unarmed, healthy movement set
const VARIANT = / (crouch|sneak|swim|carry|injur|limp|zombie|drunk|sit|lie|lying|prone|crawl|ladder|climb|pistol|rifle|gun|sword|bow|spear|shield|torch|push|pull|wheel|drive|ride|dance|talk|wave|cheer|clap|emote|interact|pick|fish|farm|chop|mine|sad|happy|angry|tired|old|female|feminine|masc|turn|start|stop|to)/;

const words = (n: string) => ' ' + n.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[^a-z0-9]+/gi, ' ').toLowerCase() + ' ';

/** the gameplay slot a clip belongs to, from its name (null: locomotion or unused) */
export function slotOf(name: string, loop: boolean): Slot | null {
  const w = words(name);
  const has = (re: RegExp) => re.test(w);
  if (has(/ (death|dying|die|dies|dead|killed) /) || has(/death/)) return has(/idle|pose/) && loop ? null : 'death';
  if (has(/ (hit|hurt|react|reaction|flinch|damage|damaged|impact) /) && !has(/attack|combo|punch|kick|slash|strike/)) return 'hit';
  if (has(/ (stun|stunned|dizzy|stagger|knocked) /)) return 'stun';
  if (has(/ (land|landing) /)) return 'land';
  if (has(/ jump /) || has(/ (fall|falling|airborne|air) /)) {
    if (has(/ (loop|idle|air|mid|fall|falling|airborne) /) || loop) return 'jump_loop';
    return 'jump_start';
  }
  if (has(/ (roll|dodge|evade|tumble) /)) return 'roll';
  if (has(/ (vault|mantle|hurdle|parkour|wallrun|wall run|ledge) /)) return has(/ flip /) ? 'flip' : 'vault';
  if (has(/ (flip|backflip|frontflip|somersault|cartwheel) /)) return 'flip';
  if (has(/ (slide|sliding) /)) return 'slide';
  if (has(/ (dash|lunge) /) && !has(/attack|slash/)) return 'dash';
  if (has(/ (block|guard|parry) /)) return 'block';
  if (has(/ (throw|toss|grenade) /)) return 'throw';
  if (has(/ (punch|jab|hook|uppercut|kick|cross|elbow|knee strike) /)) return 'punch';
  if (has(/ (sword|melee|slash|katana|combo|attack|strike|swing|stab|blade|axe|chop|thrust|cleave|hit \d) /)) return 'melee';
  if (has(/ (spell|cast|casting|magic|buff|summon|channel|shout|roar|power) /)) return 'cast';
  if (has(/ (shoot|shooting|fire|firing|aim) /)) return 'shoot';
  if (has(/ idle /) && loop && !has(/crouch|sit|lie|swim|pistol|rifle|gun|sword|bow|spell|talk|dance|sad|injur|tired|wounded/)) return 'idle';
  return null;
}

function gaitOf(c: PoseClip): string | null {
  const w = words(c.name);
  if (!c.loop || c.speed < 0.2 || VARIANT.test(w)) return null;
  for (const g of GAIT_ORDER) if (w.includes(` ${g}`)) return g;
  if (/ (strafe|move|locomotion|forward|fwd|backward|bwd|back|left|right) /.test(w)) return 'walk';
  return null;
}

// ---------------------------------------------------------------- derived clips (fill 8-way coverage)
const MIRROR_OF = RT.map(b => RT_INDEX[(b.endsWith('_L') ? b.replace(/_L$/, '_R') : b.endsWith('_R') ? b.replace(/_R$/, '_L') : b) as RtBone]);
const NB = RT.length;

/** left <-> right mirror: swap sides, reflect positions across the YZ plane, (x, y, z, w) -> (x, -y, -z, w) */
export function mirrorClip(c: PoseClip): PoseClip {
  const q = new Float32Array(c.q.length), p = new Float32Array(c.p.length), restP = new Float32Array(c.restP.length);
  for (let f = 0; f < c.frames; f++) for (let i = 0; i < NB; i++) {
    const j = MIRROR_OF[i], a = (f * NB + j) * 4, b = (f * NB + i) * 4, pa = (f * NB + j) * 3, pb = (f * NB + i) * 3;
    q[b] = c.q[a]; q[b + 1] = -c.q[a + 1]; q[b + 2] = -c.q[a + 2]; q[b + 3] = c.q[a + 3];
    p[pb] = -c.p[pa]; p[pb + 1] = c.p[pa + 1]; p[pb + 2] = c.p[pa + 2];
  }
  for (let i = 0; i < NB; i++) { const j = MIRROR_OF[i]; restP[i * 3] = -c.restP[j * 3]; restP[i * 3 + 1] = c.restP[j * 3 + 1]; restP[i * 3 + 2] = c.restP[j * 3 + 2]; }
  const contact = new Uint8Array(c.contact.length);
  for (let f = 0; f < c.frames; f++) { contact[f * 2] = c.contact[f * 2 + 1]; contact[f * 2 + 1] = c.contact[f * 2]; }
  const m: PoseClip = { ...c, name: `${c.name} (mirror)`, q, p, restP, contact, mask: RT.map((_, i) => c.mask[MIRROR_OF[i]]), travel: [-c.travel[0], c.travel[1]] };
  let f0 = 0; for (let f = 1; f < m.frames; f++) if (contact[f * 2] && !contact[(f - 1) * 2]) { f0 = f; break; }
  m.phase0 = f0 / (m.frames - 1);
  return m;
}

/** time reversal: a forward walk played backwards is a convincing backpedal */
export function reverseClip(c: PoseClip): PoseClip {
  const q = new Float32Array(c.q.length), p = new Float32Array(c.p.length), contact = new Uint8Array(c.contact.length);
  const last = c.frames - 1;
  for (let f = 0; f <= last; f++) {
    q.set(c.q.subarray((last - f) * NB * 4, (last - f + 1) * NB * 4), f * NB * 4);
    p.set(c.p.subarray((last - f) * NB * 3, (last - f + 1) * NB * 3), f * NB * 3);
    contact[f * 2] = c.contact[(last - f) * 2]; contact[f * 2 + 1] = c.contact[(last - f) * 2 + 1];
  }
  const r: PoseClip = { ...c, name: `${c.name} (reverse)`, q, p, contact, rootMotion: false };
  analyse(r);
  if (r.speed < 0.2) { r.speed = c.speed; r.travel = [-c.travel[0], -c.travel[1]]; }
  return r;
}

const angleOf = (c: PoseClip) => Math.atan2(c.travel[0], c.travel[1]);
const angDiff = (a: number, b: number) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

// ---------------------------------------------------------------- library
export class ClipLibrary {
  slots = new Map<Slot, PoseClip[]>();
  gaits: Gait[] = [];
  fp = new Map<string, { scene: THREE.Object3D; clips: THREE.AnimationClip[] }>();

  constructor(public clips: PoseClip[], m: Manifest = {}) {
    const excluded = new Set(m.exclude ?? []);
    const pinned = new Set(Object.values(m.slots ?? {}).flat());
    const byGait = new Map<string, PoseClip[]>();
    for (const c of clips) {
      if (excluded.has(c.name) || pinned.has(c.name)) continue;
      const g = gaitOf(c);
      if (g) { if (!byGait.has(g)) byGait.set(g, []); byGait.get(g)!.push(c); continue; }
      const s = slotOf(c.name, c.loop);
      if (s) this.add(s, c);
    }
    for (const [s, names] of Object.entries(m.slots ?? {}) as [Slot, string[]][]) {
      this.slots.set(s, names.map(n => clips.find(c => c.name === n)).filter((c): c is PoseClip => !!c));
    }
    // plain names first ("Idle" before "Idle_Talking"); combos keep their authored hit order
    for (const [s, list] of this.slots) if (!m.slots?.[s]) list.sort((a, b) => s === 'melee' || s === 'punch' ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.name.length - b.name.length || a.name.localeCompare(b.name));
    for (const [name, list] of byGait) {
      const set = [...list];
      // backpedal from the forward clip, strafes from their mirror image
      const covered = (a: number) => set.some(c => Math.abs(angDiff(angleOf(c), a)) < 0.35);
      for (const c of [...set]) { const mm = mirrorClip(c); if (!covered(angleOf(mm))) set.push(mm); }
      const fwd = set.filter(c => Math.abs(angleOf(c)) < 0.35).sort((a, b) => a.name.length - b.name.length)[0];
      if (fwd && !covered(Math.PI)) set.push(reverseClip(fwd));
      // one clip per direction (the plainest name)
      const dedup: PoseClip[] = [];
      for (const c of set.sort((a, b) => a.name.length - b.name.length)) if (!dedup.some(d => Math.abs(angDiff(angleOf(d), angleOf(c))) < 0.2)) dedup.push(c);
      const fw = dedup.filter(c => Math.abs(angleOf(c)) < 0.8);
      const speed = (fw.length ? fw : dedup).reduce((s, c) => s + c.speed, 0) / Math.max(1, (fw.length ? fw : dedup).length);
      this.gaits.push({ name, speed, clips: dedup.sort((a, b) => angleOf(a) - angleOf(b)) });
    }
    this.gaits.sort((a, b) => a.speed - b.speed);
  }

  private add(s: Slot, c: PoseClip) { if (!this.slots.has(s)) this.slots.set(s, []); this.slots.get(s)!.push(c); }
  get(s: Slot): PoseClip[] { return this.slots.get(s) ?? []; }
  has(s: Slot) { return this.get(s).length > 0; }
  get hasLocomotion() { return this.gaits.length > 0; }

  /**
   * 8-way / multi-gait blend: clip weights for travelling at `speed` (leg lengths / s) toward `angle` (canonical,
   * 0 = forward, +pi/2 = the character's left). Two gaits by speed x two neighbouring directions each.
   */
  blend(angle: number, speed: number): { clip: PoseClip; w: number }[] {
    const G = this.gaits;
    if (!G.length) return [];
    let g0 = 0, g1 = 0, k = 0;
    if (speed >= G[G.length - 1].speed) g0 = g1 = G.length - 1;
    else if (speed > G[0].speed) {
      while (g1 < G.length - 1 && G[g1].speed < speed) g1++;
      g0 = g1 - 1; k = (speed - G[g0].speed) / Math.max(1e-6, G[g1].speed - G[g0].speed);
    }
    const out: { clip: PoseClip; w: number }[] = [];
    const push = (g: Gait, w: number) => {
      if (w <= 1e-4) return;
      const cs = g.clips;
      if (cs.length === 1) { out.push({ clip: cs[0], w }); return; }
      // nearest clip on each side of the wanted direction, weighted by angular distance
      let lo: PoseClip | null = null, hi: PoseClip | null = null, dlo = -Infinity, dhi = Infinity;
      for (const c of cs) {
        const d = angDiff(angleOf(c), angle);
        if (d <= 0 && d > dlo) { dlo = d; lo = c; }
        if (d >= 0 && d < dhi) { dhi = d; hi = c; }
      }
      if (!lo || !hi) {
        // no clip on one side: wrap-around neighbours
        const sorted = [...cs].sort((a, b) => angDiff(angleOf(a), angle) - angDiff(angleOf(b), angle));
        lo = lo ?? sorted[sorted.length - 1]; hi = hi ?? sorted[0];
        dlo = angDiff(angleOf(lo), angle); dhi = angDiff(angleOf(hi), angle);
        if (dlo > 0) dlo -= 2 * Math.PI; if (dhi < 0) dhi += 2 * Math.PI;
      }
      if (lo === hi) { out.push({ clip: lo, w }); return; }
      const span = dhi - dlo, u = span > 1e-6 ? -dlo / span : 0;
      // clips more than ~100 degrees apart blend poorly: favour the closer one
      const uu = span > 1.75 ? (u < 0.5 ? 0 : 1) * 0.3 + u * 0.7 : u;
      out.push({ clip: lo, w: w * (1 - uu) }, { clip: hi, w: w * uu });
    };
    push(G[g0], 1 - k);
    if (g1 !== g0) push(G[g1], k);
    return out.filter(e => e.w > 1e-4);
  }
}

// ---------------------------------------------------------------- loading
const BASE = (import.meta as any).env?.BASE_URL ?? '/';
let libP: Promise<ClipLibrary | null> | null = null;

export function animLibrary(): Promise<ClipLibrary | null> {
  if (libP) return libP;
  // ?anim=procedural turns the library off; ?animdir=/some/dir/ loads another library (tests, pack previews)
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const dir = q?.get('animdir') ?? `${BASE}anim/`;
  libP = q?.get('anim') === 'procedural' ? Promise.resolve(null) : loadLibrary(dir.endsWith('/') ? dir : dir + '/');
  return libP;
}
/** the library once loaded (null while loading, missing or disabled) */
export let animLib: ClipLibrary | null = null;
/** tests / tools: install a library built in memory */
export function setAnimLibrary(l: ClipLibrary | null) { animLib = l; libP = Promise.resolve(l); }

export async function loadLibrary(dir: string): Promise<ClipLibrary | null> {
  let m: Manifest;
  try {
    const r = await fetch(`${dir}manifest.json`, { cache: 'no-cache' });
    if (!r.ok) return null;
    m = await r.json();
  } catch { return null; }
  const loader = new GLTFLoader();
  const draco = new DRACOLoader(); draco.setDecoderPath(`${BASE}draco/`); loader.setDRACOLoader(draco);
  const clips: PoseClip[] = [];
  for (const f of m.packs ?? []) {
    try {
      const g = await loader.loadAsync(dir + f);
      const baked = bakeClips(g.scene, g.animations, f);
      if (!baked.length) console.warn('anim pack: no humanoid skeleton / clips in', f);
      clips.push(...baked);
    } catch (e) { console.warn('anim pack failed', f, e); }
  }
  const lib = new ClipLibrary(clips, m);
  for (const [hero, f] of Object.entries(m.fp ?? {})) {
    try { const g = await loader.loadAsync(dir + f); lib.fp.set(hero, { scene: g.scene, clips: g.animations }); }
    catch (e) { console.warn('first-person clips failed', hero, f, e); }
  }
  if (!clips.length && !lib.fp.size) return null;
  animLib = lib;
  if (typeof window !== 'undefined') (window as any).__zu = { ...(window as any).__zu, anim: lib };
  console.info(`[anim] ${clips.length} clips from ${(m.packs ?? []).length} packs: ${lib.gaits.map(g => `${g.name} x${g.clips.length}`).join(', ') || 'no locomotion'}; ` +
    `slots ${[...lib.slots].filter(([, l]) => l.length).map(([k, l]) => `${k} ${l.length}`).join(', ')}${lib.fp.size ? `; first-person: ${[...lib.fp.keys()].join(', ')}` : ''}`);
  return lib;
}
