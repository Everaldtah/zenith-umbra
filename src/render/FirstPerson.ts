// First-person arms (viewmodel): the hero's own rigged model, head collapsed, drawn in a separate pass over the world
// (own camera and depth, so hands never clip into walls). Each hero holds and uses their weapon their own way.
//
// Two sources of motion, per action:
//  1. Blender-authored clips (assetgen/blender/fp_arms.py -> public/anim/fp_<hero>.glb, listed under "fp" in
//     public/anim/manifest.json): fp_idle (loop), fp_fire, fp_alt, fp_melee, fp_reload, fp_ability1, fp_ability2,
//     fp_ult, fp_hit, fp_land. Played straight onto the hero's rig (same bone names: no retargeting).
//  2. Procedural personality (below): hand targets per hero with recoil, slashes, bow draw, kunai throws, flame palms,
//     reloads, casts, quick melee, plus movement bob, mouse sway and landing dip on top of either source.
import * as THREE from 'three';
import type { Actor } from '../game/Actor';
import { CharacterView } from './CharacterView';
import { animLib } from './ClipLibrary';

type V = [number, number, number];     // view space metres: right, up, forward (from the eye)
type Grip = 'rifle' | 'pistol' | 'katana' | 'bow' | 'caster' | 'kunai' | 'fists' | 'hammer' | 'shotgun';
// push: eye forward past a bulky collar / coat (m); clip: cut viewmodel geometry closer than this to the camera (m) -
// a high collar that would otherwise wrap the view (hands are always further out)
// keep: how much hand weight a triangle needs to stay in the viewmodel (armsOnly; default 0.75) - raise it for heroes
// whose sleeve cuffs flare over the hands
interface Style { grip: Grip; R: V; L: V | null; recoil: number; push?: number; clip?: number; keep?: number; }

/** each hero's viewmodel personality */
export const FP_STYLE: Record<string, Style> = {
  raijin: { grip: 'katana', R: [0.22, -0.17, 0.46], L: [0.08, -0.19, 0.44], recoil: 0, clip: 0.14, keep: 0.97 },
  yuzu: { grip: 'bow', R: [0.0, -0.13, 0.4], L: [-0.06, -0.13, 0.52], recoil: 0 },
  kaien: { grip: 'caster', R: [0.19, -0.19, 0.46], L: [-0.19, -0.2, 0.44], recoil: 0.03, keep: 0.97 },
  mirei: { grip: 'caster', R: [0.14, -0.14, 0.38], L: [-0.15, -0.15, 0.35], recoil: 0.02 },
  nocturne: { grip: 'caster', R: [0.14, -0.1, 0.4], L: [-0.14, -0.11, 0.38], recoil: 0.02 },
  hex: { grip: 'caster', R: [0.13, -0.14, 0.38], L: [-0.13, -0.14, 0.38], recoil: 0.025 },
  kagemaru: { grip: 'kunai', R: [0.17, -0.15, 0.34], L: [-0.17, -0.18, 0.32], recoil: 0 },
  enra: { grip: 'fists', R: [0.16, -0.15, 0.36], L: [-0.16, -0.15, 0.36], recoil: 0, push: 0.05 },
  haruto: { grip: 'pistol', R: [0.13, -0.12, 0.4], L: [0.06, -0.15, 0.36], recoil: 0.05 },
  tenkai: { grip: 'hammer', R: [0.24, -0.26, 0.38], L: [0.14, -0.3, 0.46], recoil: 0 },
  gorgoth: { grip: 'shotgun', R: [0.2, -0.19, 0.34], L: [0.05, -0.19, 0.62], recoil: 0.09 },
};
const DEFAULT: Style = { grip: 'rifle', R: [0.16, -0.15, 0.34], L: [0.03, -0.14, 0.5], recoil: 0.04 };

const FP_CLIPS = ['fp_idle', 'fp_fire', 'fp_fire2', 'fp_alt', 'fp_melee', 'fp_reload', 'fp_ability1', 'fp_ability2', 'fp_ult', 'fp_hit', 'fp_land',
  'fp_beam', 'fp_draw', 'fp_inspect', 'fp_equip'] as const;
/** seconds standing idle before the hero shows off (weapon inspect) */
const INSPECT_AFTER = 7;
const smooth = (u: number) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
const bump = (u: number) => (u <= 0 || u >= 1 ? 0 : Math.sin(u * Math.PI));
const lerp = (a: V, b: V, k: number): V => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const add = (a: V, b: V, k = 1): V => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/**
 * Where the arms rig sits relative to the camera: auto-rigged arms vary a lot in length, so instead of bending the grip
 * to the rig, the rig moves (in model space, applied to the eye) until both rest hand targets are within reach - the
 * hands land where the style wants them on screen and the shoulders stay off-screen. fp_arms.py places its camera the
 * same way, so Blender-authored clips keep this framing.
 */
export function viewmodelOffset(an: { rest: Partial<Record<string, { p: THREE.Vector3 }>> }, eye: THREE.Vector3, style: Style, scaleFit: number) {
  const k = 1 / Math.max(1e-6, scaleFit);
  const o = new THREE.Vector3();
  const arms = ([['L', style.L], ['R', style.R]] as const).flatMap(([S, v]) => {
    const ua = an.rest[`upperarm_${S}`], fa = an.rest[`forearm_${S}`], hd = an.rest[`hand_${S}`];
    if (!v || !ua || !fa || !hd) return [];
    const reach = (ua.p.distanceTo(fa.p) + fa.p.distanceTo(hd.p)) * 0.92;
    return [{ t: new THREE.Vector3(-v[0] * k, v[1] * k, v[2] * k).add(eye), s: ua.p, reach }];
  });
  // the shoulders must stay behind the camera - by the style's push too, so a high collar stays behind it (the rig slides
  // up / down / sideways freely, but only so far forward)
  const maxZ = Math.min(...arms.map(a => eye.z - a.s.z)) - (0.03 + (style.push ?? 0)) * k;
  const pull = (a: typeof arms[number], f: number) => {
    const d = a.t.clone().sub(o).sub(a.s), ex = d.length() - a.reach;
    if (ex > 0) o.addScaledVector(d.normalize(), ex * f);
    o.z = Math.min(o.z, maxZ);
  };
  for (let it = 0; it < 40; it++) for (const a of arms) pull(a, 0.6);
  // when both grips can't be reached (a cross-body two-handed grip on very short arms), the main hand wins
  const main = arms[arms.length - 1];
  if (main) pull(main, 1);
  return o.clampLength(0, Math.max(0.5 * k, 2 * Math.max(0, ...arms.map(a => a.reach))));
}

/**
 * Overwatch-style first-person model: keep only the triangles skinned (mostly) to the arm chain - hands, forearms,
 * sleeves and whatever the hands carry (weapons are bound to the hand). Torso, collar, shoulder armour, hair and legs
 * drop out of the viewmodel, so a high collar or a big pauldron can't fill the screen. The geometry is cloned: the
 * world view of the same hero shares the loaded buffers.
 */
export function armsOnly(model: THREE.Object3D, keep = 0.75): { kept: number; total: number } {
  let kept = 0, total = 0;
  model.traverse(o => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || (m.userData.fpArms as boolean)) return;
    const arm = m.skeleton.bones.map(b => /^(upperarm|forearm|hand)_[LR]$/.test(b.name));
    const g = m.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    if (!si || !sw) return;
    const n = si.count, w = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < 4; j++) if (arm[si.getComponent(i, j)]) s += sw.getComponent(i, j); w[i] = s; }
    const src = g.index ? g.index.array : Array.from({ length: n }, (_, i) => i);
    const out: number[] = [];
    for (let t = 0; t + 2 < src.length; t += 3) if (w[src[t]] + w[src[t + 1]] + w[src[t + 2]] >= keep * 3) out.push(src[t], src[t + 1], src[t + 2]);
    total += src.length / 3; kept += out.length / 3;
    const g2 = g.clone(); g2.setIndex(out); m.geometry = g2; m.userData.fpArms = true;
  });
  return { kept, total };
}

export interface FpInput { dt: number; time: number; yawRate: number; pitchRate: number; aspect: number; }

export class FirstPersonArms {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, 1, 0.02, 30);
  view: CharacterView;
  style: Style;
  private eye = new THREE.Vector3();           // model-space eye (camera) position
  private real = false;
  private mixer: THREE.AnimationMixer | null = null;
  private clips = new Map<string, THREE.AnimationClip>();
  private playing: { name: string; action: THREE.AnimationAction } | null = null;
  private walk = 0; private swayX = 0; private swayY = 0; private dip = 0; private dipV = 0;
  private prev = { attack: 9, cast: 9, hit: 9, land: 9 };
  private swings = 0;
  private oneShot: { name: string; until: number } | null = null;
  /** last time the hero did anything (fired, cast, reloaded, moved): the inspect flourish waits for a quiet moment */
  idleSince = 0;
  private equipped = false;
  private reloadRate = 1;
  /** the current action source: 'clip:fp_fire' or 'proc:fire' (tests / AI lab) */
  source = '';

  constructor(public actor: Actor, skinId = 'classic') {
    this.view = new CharacterView(actor, actor.team, skinId);
    this.style = FP_STYLE[actor.def.id] ?? DEFAULT;
    this.view.anim.useClips(null);                 // body clips don't apply to a viewmodel
    this.scene.add(this.view.group);
    this.scene.add(new THREE.HemisphereLight('#dfe8ff', '#3a3140', 1.6));
    const key = new THREE.DirectionalLight('#fff4e0', 2.2); key.position.set(-1, 2, -1); this.scene.add(key);
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, 1);
    this.fit();
  }

  get defId() { return this.view.defId; }

  /** camera at the eye: the rig is placed so its eye sits at the origin, facing +Z */
  private fit() {
    const an = this.view.anim;
    this.real = this.view.real;
    if (an.ok) {
      this.view.anim.useClips(null);
      const R = an.rest;
      const H = an.height;
      this.eye.copy(R.head!.p).add(new THREE.Vector3(0, H * 0.06, H * 0.05 + (this.style.push ?? 0) / Math.max(1e-6, this.view.scaleFit)));
      this.eye.sub(viewmodelOffset(an, this.eye, this.style, this.view.scaleFit));
    }
    if (this.real) armsOnly(this.view.model, this.style.keep ?? 0.75);
    // near cut in camera space (the camera sits at the origin looking down +Z): drops a collar wrapped around the eye
    const plane = this.style.clip ? [new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.style.clip)] : null;
    for (const m of this.view.mats) { m.clippingPlanes = plane; m.needsUpdate = true; }
    this.bindClips();
  }

  private bindClips() {
    this.mixer = null; this.clips.clear(); this.playing = null;
    const fp = animLib?.fp.get(this.actor.def.id);
    if (!fp || !this.view.real) return;
    for (const c of fp.clips) {
      const n = FP_CLIPS.find(k => c.name === k || c.name.endsWith(`|${k}`) || c.name.startsWith(`${k}.`));
      if (n) this.clips.set(n, c);
    }
    if (this.clips.size) this.mixer = new THREE.AnimationMixer(this.view.model);
  }

  private play(name: string, loop: boolean, rate = 1) {
    const c = this.clips.get(name);
    if (!c || !this.mixer) return false;
    if (this.playing?.name === name) return true;
    const a = this.mixer.clipAction(c);
    a.reset(); a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !loop; a.timeScale = rate;
    if (this.playing) a.crossFadeFrom(this.playing.action, 0.08, false);
    a.play();
    this.playing = { name, action: a };
    return true;
  }

  update(i: FpInput) {
    const a = this.actor, t = i.time, dt = Math.min(0.05, i.dt);
    if (this.view.real !== this.real) this.fit();
    const an = this.view.anim;
    this.camera.aspect = i.aspect; this.camera.updateProjectionMatrix();
    // materials: skin / stealth like the world view
    this.view.look.zuTime.value = t;
    const stealth = a.has('stealth', t);
    for (const m of this.view.mats) { if (m.transparent !== stealth) { m.transparent = stealth; m.needsUpdate = true; } m.opacity = stealth ? 0.35 : 1; }
    // ---- motion layers shared by both sources: walk bob, mouse sway, landing dip
    const sp = Math.hypot(a.vel.x, a.vel.z);
    this.walk += sp * dt * (a.grounded ? 1.6 : 0.3);
    const mv = Math.min(1, sp / 6) * (a.grounded ? 1 : 0.3);
    this.swayX += (Math.max(-0.05, Math.min(0.05, -i.yawRate * 0.012)) - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (Math.max(-0.04, Math.min(0.04, -i.pitchRate * 0.01)) - this.swayY) * Math.min(1, dt * 10);
    const P = this.prev;
    const newAttack = t - a.anim.attackAt < P.attack - 1e-6, newCast = t - a.anim.castAt < P.cast - 1e-6, newHit = t - a.anim.hitAt < P.hit - 1e-6, newLand = t - a.anim.landAt < P.land - 1e-6;
    P.attack = t - a.anim.attackAt; P.cast = t - a.anim.castAt; P.hit = t - a.anim.hitAt; P.land = t - a.anim.landAt;
    if (newLand) this.dipV -= 0.35;
    if (newAttack && a.anim.attackKind !== 'punch') this.swings++;
    this.dipV += (-this.dip * 120 - this.dipV * 14) * dt; this.dip += this.dipV * dt;
    const bob: V = [Math.sin(this.walk * 1.0) * 0.012 * mv + this.swayX, -Math.abs(Math.cos(this.walk * 1.0)) * 0.016 * mv + this.swayY + this.dip * 0.2, 0];
    // rig placement: eye at the origin, then the whole viewmodel offset by bob / sway
    // (a loaded GLB sits inside a scaled wrapper, lifted so its feet touch the ground)
    const k = this.view.scaleFit, off = an.model !== this.view.model ? an.model.position : new THREE.Vector3();
    this.view.group.position.set(-(this.eye.x + off.x) * k - bob[0], -(this.eye.y + off.y) * k + bob[1], -(this.eye.z + off.z) * k);
    this.view.group.rotation.set(this.swayY * 0.6, this.swayX * 0.8, 0);
    this.view.inner.scale.setScalar(1);
    // ---- 1. authored clips (Overwatch-style: gameplay owns the clock - see assetgen/blender/fp_choreo.py)
    if (this.mixer) {
      const kind = a.anim.attackKind;
      const busy = newAttack || newCast || a.reloadUntil > t || a.charging || a.beamOn || a.flameOn || sp > 0.5 || !a.grounded;
      if (busy || !this.equipped) this.idleSince = t;
      // one-shots run their full clip (a new event restarts / replaces them); swings alternate between two authored cuts
      const fire = this.swings % 2 === 0 && this.clips.has('fp_fire2') ? 'fp_fire2' : 'fp_fire';
      let ev = newCast ? (a.anim.castId === a.def.ult.id ? 'fp_ult' : a.anim.castId === a.def.ability2.id ? 'fp_ability2' : 'fp_ability1')
        : newAttack ? (kind === 'punch' ? 'fp_melee' : kind === 'secondary' ? 'fp_alt' : fire) : newHit ? 'fp_hit' : newLand ? 'fp_land' : '';
      if (!this.equipped) { this.equipped = true; if (this.clips.has('fp_equip')) ev = 'fp_equip'; }
      if (!ev && t - this.idleSince > INSPECT_AFTER && this.clips.has('fp_inspect') && !this.oneShot) { ev = 'fp_inspect'; this.idleSince = t; }
      if (ev && this.clips.has(ev) && (ev !== 'fp_hit' && ev !== 'fp_land' || !this.oneShot)) { this.oneShot = { name: ev, until: t + this.clips.get(ev)!.duration }; if (this.playing) this.playing = { ...this.playing, name: '' }; }
      if (this.oneShot && (t >= this.oneShot.until || (this.oneShot.name === 'fp_inspect' && busy))) this.oneShot = null;
      let want = 'fp_idle', loop = true, rate = 1, scrub = -1;
      if ((a.beamOn || a.flameOn) && this.clips.has('fp_beam')) want = 'fp_beam';
      if (a.charging && this.clips.has('fp_draw')) { want = 'fp_draw'; loop = false; scrub = Math.min(1, Math.max(0, a.charge)); }
      if (a.reloadUntil > t && this.clips.has('fp_reload')) {
        // the reload clip is authored at the weapon's reload time: stretch it to the reload actually running
        if (this.playing?.name !== 'fp_reload') { const left = a.reloadUntil - t; this.reloadRate = Math.min(3, Math.max(0.3, this.clips.get('fp_reload')!.duration / Math.max(0.05, left))); }
        want = 'fp_reload'; loop = false; rate = this.reloadRate;
      }
      if (this.oneShot && !(want === 'fp_reload' && this.oneShot.name === 'fp_inspect')) { want = this.oneShot.name; loop = false; rate = 1; scrub = -1; }
      if (this.clips.has(want) && this.play(want, loop, rate)) {
        if (scrub >= 0 && this.playing) { this.playing.action.time = scrub * this.clips.get(want)!.duration; this.playing.action.timeScale = 0; }
        this.mixer.update(dt);
        an.bones.head?.scale.setScalar(1e-3);
        if (an.prop) an.prop.visible = true;
        this.source = `clip:${want}`;
        return;
      }
    }
    // ---- 2. procedural personality
    this.proc(t, newAttack);
  }

  private proc(t: number, _newAttack: boolean) {
    const a = this.actor, S = this.style, an = this.view.anim;
    let R: V = S.R, L: V | null = S.L;
    const atk = t - a.anim.attackAt, kind = a.anim.attackKind, cast = t - a.anim.castAt;
    let src = 'idle';
    // idle breathing / personality
    const br = Math.sin(t * 1.7) * 0.004;
    R = add(R, [0, br, 0]); if (L) L = add(L, [0, br * 0.8, 0]);
    let wristR: THREE.Quaternion | null = null, wristL: THREE.Quaternion | null = null;
    if (S.grip === 'katana') wristR = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 0, 0.3));
    // reload: hands dip, off hand comes to the weapon
    if (a.reloadUntil > t) {
      const dur = 'reload' in a.def.primary && a.def.primary.reload ? a.def.primary.reload : 1.4;
      const u = 1 - (a.reloadUntil - t) / dur, k = bump(u);
      R = add(R, [-0.04, -0.1, -0.06], k); if (L) L = lerp(L, add(R, [-0.05, -0.02, 0]), k * 0.8);
      src = 'reload';
    }
    // primary / secondary use
    const melee = a.def.primary.kind === 'melee' && kind === 'primary' || kind === 'secondary' && 'kind' in a.def.secondary && a.def.secondary.kind === 'melee';
    if (kind === 'punch' && atk < 0.45) {
      // quick melee: off-hand jab (everyone), pulled back then snapped straight out
      const u = atk / 0.42, ext = u < 0.14 ? -0.4 * u / 0.14 : u < 0.28 ? -0.4 + 1.4 * (u - 0.14) / 0.14 : Math.max(0, 1 - (u - 0.28) / 0.72);
      const tgt: V = [-0.03, -0.1, 0.36 + 0.3 * ext];
      if (L && S.grip !== 'hammer') L = lerp(L, tgt, Math.min(1, Math.max(0, ext + 0.4))); else R = lerp(R, [0.05, -0.1, 0.36 + 0.3 * ext], 0.8);
      src = 'melee';
    } else if (melee && atk < 0.6) {
      // blade / fist swings alternate direction through the combo
      const dir = this.swings % 2 ? -1 : 1, u = smooth(atk / 0.35);
      if (S.grip === 'fists') { R = lerp(R, [0.04, -0.12, 0.62], bump(atk / 0.4)); src = 'punch'; }
      else if (S.grip === 'kunai') { L = lerp(L ?? S.R, lerp([-0.3, 0.02, 0.35], [0.2, -0.3, 0.45], u), bump(atk / 0.5)); src = 'slash'; }
      else {
        const from: V = [0.32 * dir, 0.06, 0.34], to: V = [-0.28 * dir, -0.32, 0.42];
        R = lerp(R, lerp(from, to, u), Math.min(1, bump(Math.min(1, atk / 0.55)) * 1.4));
        if (L && S.grip !== 'hammer') L = lerp(L, add(R, [-0.07, -0.03, -0.02]), 0.7);
        wristR = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3 - u * 0.6, 0, dir * (0.9 - u * 1.4)));
        src = 'slash';
      }
    } else if (kind !== 'punch' && atk < 0.5 && S.grip !== 'bow') {
      // ranged: per-grip kick
      const r = Math.max(0, 1 - atk / 0.18);
      if (S.grip === 'kunai') { const u = atk / 0.3; R = lerp(R, u < 0.35 ? [0.24, -0.04, 0.16] : [0.06, -0.12, 0.58], bump(Math.min(1, u))); src = 'throw'; }
      else if (S.grip === 'caster') { R = add(R, [-0.03, 0.04, 0.12], bump(atk / 0.22)); src = 'flick'; }
      else { R = add(R, [0, 0.02, -S.recoil], r); if (L) L = add(L, [0, 0.02, -S.recoil], r); wristR = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5 * r, 0, 0)); src = 'recoil'; }
    }
    // bow: the drawing hand comes back to the cheek with the charge, snaps forward on release
    if (S.grip === 'bow') {
      const draw = a.charging ? Math.min(1, a.charge) : 0, rel = atk < 0.25 ? bump(atk / 0.25) : 0;
      R = lerp(R, [0.1, -0.06, 0.08], smooth(draw));
      R = add(R, [0.04, 0.02, -0.05], rel);
      if (draw > 0.01) src = 'draw'; else if (rel > 0) src = 'release';
    }
    // beams: both palms / focus forward and steady (flame, heal beams)
    if (a.beamOn || a.flameOn) {
      const sh = a.flameOn ? 0.006 : 0.002;
      const j: V = [(Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, 0];
      if (S.grip === 'fists') { R = add([0.08, -0.14, 0.46], j); L = add([-0.08, -0.14, 0.46], j); }
      else if (L) L = add([-0.06, -0.12, 0.5], j);
      src = 'beam';
    }
    // abilities: a two-handed gesture toward the aim (ults reach higher)
    if (cast < 0.6 && a.anim.castId) {
      const k = bump(cast / 0.6), ult = a.anim.castId === a.def.ult.id;
      R = lerp(R, [0.1, ult ? 0.02 : -0.08, 0.5], k);
      if (L) L = lerp(L, [-0.1, ult ? 0.02 : -0.08, 0.5], k); else L = [-0.1, -0.08, 0.5];
      src = ult ? 'ult' : 'ability';
    }
    // hit flinch
    const hit = t - a.anim.hitAt;
    if (hit < 0.25) { const k = bump(hit / 0.25) * 0.02; R = add(R, [0, k, -k]); if (L) L = add(L, [0, k, -k]); }
    // view space (right, up, forward) -> model space (+X = the character's left)
    const k = 1 / Math.max(1e-6, this.view.scaleFit);
    // hand targets are camera-relative; the rig sits wherever puts the grip in reach (viewmodelOffset)
    const toM = (v: V) => new THREE.Vector3(-v[0] * k, v[1] * k, v[2] * k).add(this.eye);
    const hands: [THREE.Vector3 | null, THREE.Vector3 | null] = [L ? toM(L) : null, toM(R)];
    const prop = S.grip === 'hammer' ? { pos: hands[1]!.clone(), dir: hands[0] ? hands[0].clone().sub(hands[1]!).normalize().add(new THREE.Vector3(0, 0.9, 0.2)).normalize() : new THREE.Vector3(0, 1, 0.3).normalize(), side: new THREE.Vector3(-1, 0, 0) } : null;
    an.updateFirstPerson({ hands, wrist: [wristL, wristR], prop });
    this.source = `proc:${src}`;
  }

  dispose() { this.view.anim.restoreHead(); this.view.dispose(); }
}
