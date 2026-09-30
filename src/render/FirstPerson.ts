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
import { reapPhase, REAP_SECS, REAP_STOP } from './Animator';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BASE } from './Assets';
import { driveFingers } from './Fingers';

type V = [number, number, number];     // view space metres: right, up, forward (from the eye)
type Grip = 'rifle' | 'pistol' | 'katana' | 'bow' | 'caster' | 'kunai' | 'fists' | 'hammer' | 'shotgun' | 'dual';
// push: eye forward past a bulky collar / coat (m); clip: cut viewmodel geometry closer than this to the camera (m) -
// a high collar that would otherwise wrap the view (hands are always further out)
// keep: how much hand weight a triangle needs to stay in the viewmodel (armsOnly; default 0.75) - raise it for heroes
// whose sleeve cuffs flare over the hands
// drape: drop arm-weighted triangles further than this (x forearm length) from their bone - sleeve cloth and sashes that hang
// off the arms and would fill the view
// gunScale: the held guns' size in the viewmodel (the world model's props are concept-sized; up close they'd fill the view)
// squeeze: pull arm geometry further than this (x forearm length) from its bone radially in to that distance - wide
// sleeves become slim tubes in the viewmodel instead of walls of cloth or cut shards (a tailored first-person sleeve)
// shoulderW / reach: a viewmodel liberty for rigs whose hands can't meet in front of the lens (Tenkai-Oh: shoulders
// 0.92 m out, 0.62 m arms) - the shoulder joints drawn in to this half-width (m) and the upper arms lengthened by this
// factor, both behind the camera where armsOnly has already cut the geometry away (see fpArmReach)
// gauntlets: rigid first-person forearms + hands (a GLB under public/, nodes gauntlet_L / gauntlet_R) mounted straight
// on the held haft, for a rig whose own arms can't carry its hands (Tenkai-Oh: assetgen/blender/fp_gauntlets.py)
interface Style { grip: Grip; R: V; L: V | null; recoil: number; push?: number; clip?: number; keep?: number; drape?: number; gunScale?: number; squeeze?: number; shoulderW?: number; reach?: number; gauntlets?: string; }

/** each hero's viewmodel personality */
export const FP_STYLE: Record<string, Style> = {
  raijin: { grip: 'katana', R: [0.21, -0.21, 0.44], L: [-0.17, -0.24, 0.42], recoil: 0, clip: 0.14, keep: 0.97 },
  // the bow held left of the reticle and canted (an archer's first-person read), sized down for the viewmodel; the
  // string hand rests on the nocked arrow beside the grip (Hanzo's ready pose)
  // (work/fp_spec.md, after Hanzo: bow fist low left at (0.37, 0.83), string hand on the arrow at (0.47, 0.89), the bow
  // small enough that its limb never covers the reticle at rest)
  yuzu: { grip: 'bow', R: [0.06, -0.24, 0.1], L: [-0.03, -0.18, 0.5], recoil: 0, clip: 0.12, gunScale: 0.8 },
  // the wide kimono sleeves are squeezed into slim tubes for the viewmodel (they'd fill the screen), hands well forward
  kaien: { grip: 'caster', R: [0.21, -0.2, 0.44], L: [-0.21, -0.17, 0.46], recoil: 0.03, keep: 0.97, squeeze: 0.12 },
  mirei: { grip: 'caster', R: [0.22, -0.2, 0.42], L: [-0.19, -0.24, 0.4], recoil: 0.02 },
  nocturne: { grip: 'caster', R: [0.17, -0.17, 0.42], L: [-0.18, -0.19, 0.42], recoil: 0.02 },
  hex: { grip: 'caster', R: [0.18, -0.16, 0.42], L: [-0.18, -0.16, 0.42], recoil: 0.025 },
  kagemaru: { grip: 'kunai', R: [0.19, -0.16, 0.4], L: [-0.2, -0.23, 0.4], recoil: 0 },
  // his spiked pauldrons and gauntlet spikes crowd the lens: clipped close, only hand-weighted triangles kept
  enra: { grip: 'fists', R: [0.21, -0.18, 0.44], L: [-0.21, -0.2, 0.44], recoil: 0, push: 0.05, clip: 0.22, keep: 0.95, drape: 0.35 },
  haruto: { grip: 'pistol', R: [0.17, -0.16, 0.4], L: [0.02, -0.26, 0.34], recoil: 0.05 },
  // Reinhardt's viewmodel: both gauntlets on the haft low right, the haft out to the right, the head resting right of
  // centre (the rest pose of HAMMER_REST - hammerProc drives the whole swing)
  tenkai: { grip: 'hammer', R: [0.2, -0.27, 0.5], L: [0.329, -0.27, 0.653], recoil: 0, shoulderW: 0.2, reach: 1.9, gauntlets: 'models/fp/tenkai_gauntlets.glb' },
  // mech claws half a metre across: out in the bottom corners and well forward (as Gantetsu's guns), the near arm cut away
  gorgoth: { grip: 'shotgun', R: [0.34, -0.34, 0.56], L: [-0.34, -0.34, 0.56], recoil: 0.09, clip: 0.25, gunScale: 0.8 },
  // hip-held twin chainguns in the bottom corners, angled in on the reticle, the rear of each gun out of view
  gantetsu: { grip: 'dual', R: [0.4, -0.28, 0.56], L: [-0.4, -0.28, 0.56], recoil: 0.03, push: 0.08, gunScale: 0.7 },
  hibiki: { grip: 'pistol', R: [0.2, -0.2, 0.44], L: [-0.18, -0.21, 0.4], recoil: 0.05 },
  // the scattergun one-handed on the right, the Crescent Fang held low in the left fist
  tomoe: { grip: 'shotgun', R: [0.21, -0.2, 0.44], L: [-0.24, -0.24, 0.38], recoil: 0.1, push: 0.04, keep: 0.97, drape: 0.5 },
  // koi-scale shuriken flicked from the chest (the scarf is cut out: it wraps the neck, not the arms)
  hayate: { grip: 'kunai', R: [0.17, -0.17, 0.4], L: [-0.17, -0.18, 0.4], recoil: 0, keep: 0.9 },
  // the Riverbow in the left hand, the draw hand on the right
  // his robe sleeves squeezed to slim tubes and the quiver over his shoulder clipped, so the bow arm doesn't wall off the view
  seiran: { grip: 'bow', R: [0.06, -0.24, 0.1], L: [-0.03, -0.18, 0.5], recoil: 0, keep: 0.9, squeeze: 0.16, clip: 0.14, gunScale: 0.8 },
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

// ---------------- Tenkai-Oh's rocket hammer in first person, after Reinhardt's viewmodel (studied frame by frame from
// Overwatch 2 footage): at rest the gauntlets hold the haft low right and the head rests right of centre; a swing drops
// the head back past the bottom-right corner (~0.13 s), whips it flat across the upper middle - over the reticle for a
// couple of frames, the thruster roaring - and follows through off the left edge (the hit lands 0.24 s in, 0.96 s a
// swing). Swings alternate: the next one comes back across from the left; with no follow-up the hammer rises back from
// the bottom left into the rest. A key: [time s, grip x, y, z (the lower, right hand; view metres), haft yaw (+ = right),
// haft pitch, lead (left) hand distance up the haft (m)] - the lead hand slides up the haft on the wind-up.
type HKey = [number, number, number, number, number, number, number];
const HAMMER_REST: HKey = [0, 0.2, -0.27, 0.5, 0.7, 0, 0.2];
const HOLD_L: [number, number, number, number, number, number] = [-0.44, -0.44, 0.3, -1.9, -0.12, 0.2];
const rest = (t: number): HKey => [t, ...HAMMER_REST.slice(1)] as HKey;
/** swing 1, right to left (counter-clockwise, as Reinhardt's first swing) */
const SWING_RL: HKey[] = [
  HAMMER_REST,
  [0.065, 0.27, -0.32, 0.42, 1.2, -0.14, 0.22],      // wind-up: the head drops toward the bottom-right corner...
  [0.13, 0.3, -0.36, 0.32, 1.75, -0.28, 0.24],       // ...and back past it
  [0.2, 0.2, -0.27, 0.4, 0.85, 0.24, 0.2],
  [0.245, 0.02, -0.26, 0.43, 0, 0.33, 0.18],          // the hit: the head flat across the upper middle
  [0.29, -0.2, -0.29, 0.39, -1.0, 0.24, 0.18],
  [0.4, -0.42, -0.42, 0.3, -1.85, -0.08, 0.2],        // follow-through off the left edge
  [0.96, ...HOLD_L],                                   // held there for the next swing
];
/** swing 2, left to right (clockwise), from the left hold back across into the rest */
const SWING_LR: HKey[] = [
  [0, ...HOLD_L],
  [0.13, -0.45, -0.42, 0.28, -2.05, -0.22, 0.24],
  [0.2, -0.22, -0.28, 0.38, -0.85, 0.24, 0.2],
  [0.245, 0, -0.26, 0.43, 0, 0.33, 0.18],
  [0.29, 0.22, -0.27, 0.4, 1.0, 0.24, 0.18],
  [0.42, 0.32, -0.33, 0.34, 1.55, 0.02, 0.2],         // follow-through right
  rest(0.75),
];
/** no follow-up swing: back up from the bottom left, head low across the bottom, into the rest (times from the swing) */
const RECOVER: HKey[] = [[0.96, ...HOLD_L], [1.12, -0.12, -0.46, 0.36, -0.5, -0.55, 0.2], rest(1.34)];
/** Solar Shatter (E): heaved up out of the top of the frame with the fists low at the bottom edge, brought over the top
 *  and driven down in front - the head stops at the bottom centre with the quake (0.55 s) - lifted back. (The viewmodel
 *  has its own level camera: the ground 2 m under Tenkai-Oh's eye is out of frame, so the head lands low, not on it) */
const SHATTER: HKey[] = [HAMMER_REST, [0.18, 0.1, -0.46, 0.5, 0.35, 0.85, 0.08], [0.32, 0.06, -0.46, 0.48, 0.1, 1.2, 0.08],
  [0.45, 0.05, -0.47, 0.46, 0.05, 1.3, 0.08], [0.55, 0.02, -0.42, 0.47, 0, -0.08, 0.16], [0.78, 0.02, -0.42, 0.46, 0, -0.06, 0.16], rest(1.1)];
/** quick melee: a short thrust of the head */
const JAB: HKey[] = [HAMMER_REST, [0.06, 0.08, -0.18, 0.56, 0.3, 0.2, 0.2], [0.14, 0.07, -0.18, 0.58, 0.28, 0.2, 0.2], rest(0.45)];
/** Dawn Colossus (Q): the hammer raised high while the frame grows */
const RAISE: HKey[] = [HAMMER_REST, [0.25, 0.12, -0.12, 0.4, 0.3, 1.2, 0.24], [0.9, 0.12, -0.12, 0.4, 0.3, 1.2, 0.24], rest(1.3)];
/** the pose at t: Catmull-Rom through the keys, so a sweep keeps its speed through them instead of stopping at each */
function hammerAt(K: HKey[], t: number): HKey {
  const n = K.length - 1;
  if (t <= K[0][0]) return K[0];
  if (t >= K[n][0]) return K[n];
  let i = 0; while (i < n - 1 && t > K[i + 1][0]) i++;
  const p0 = K[Math.max(0, i - 1)], p1 = K[i], p2 = K[i + 1], p3 = K[Math.min(n, i + 2)];
  const u = (t - p1[0]) / (p2[0] - p1[0]), u2 = u * u, u3 = u2 * u;
  return p1.map((_, j) => j === 0 ? t : 0.5 * (2 * p1[j] + (p2[j] - p0[j]) * u + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u2 + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * u3)) as HKey;
}
/** a closed gauntlet's grip centre past the wrist bone, in forearm lengths */
const FIST = 0.32;
/** Style.gauntlets: where each rigid forearm points back to (view metres: its shoulder, below and beside the lens), and
 *  which way round each fist wraps the haft (+1: the model's grip tunnel along the haft, -1: reversed) - [L, R] */
const GAUNT_SHOULDER: [V, V] = [[-0.34, -0.5, 0], [0.34, -0.5, 0]];
const GAUNT_FLIP: [number, number] = [1, 1];
const haftDir = (k: HKey): V => [Math.sin(k[4]) * Math.cos(k[5]), Math.sin(k[5]), Math.cos(k[4]) * Math.cos(k[5])];
export const FP_HAMMER = { REST: HAMMER_REST, SWING_RL, SWING_LR, RECOVER, SHATTER, JAB, RAISE, at: hammerAt, dir: haftDir };

/**
 * Where the arms rig sits relative to the camera: auto-rigged arms vary a lot in length, so instead of bending the grip
 * to the rig, the rig moves (in model space, applied to the eye) until both rest hand targets are within reach - the
 * hands land where the style wants them on screen and the shoulders stay off-screen. fp_arms.py places its camera the
 * same way, so Blender-authored clips keep this framing.
 */
/** Style.shoulderW / reach on this viewmodel's own rig (the first-person view has its own CharacterView, so the world
 *  model keeps its proportions): shoulders moved in toward the spine, upper arms stretched, the rest pose updated to match
 *  so the arm IK stays exact. Once per rig. */
const armsFitted = new WeakSet<object>();
function fpArmReach(an: { model: THREE.Object3D; bones: Partial<Record<string, THREE.Object3D>>; rest: Partial<Record<string, { p: THREE.Vector3 }>> }, st: Style) {
  const B = an.bones, R = an.rest, uL = B.upperarm_L, uR = B.upperarm_R;
  if ((!st.shoulderW && !st.reach) || !uL || !uR || !R.upperarm_L || !R.upperarm_R || armsFitted.has(uL)) return;
  armsFitted.add(uL);
  an.model.updateMatrixWorld(true);
  // every rest entry under a bone moves with it
  const under = (root: THREE.Object3D) => Object.keys(R).filter(n => { for (let o: THREE.Object3D | null = B[n] ?? null; o; o = o.parent) if (o === root) return true; return false; });
  const mid = (R.upperarm_L.p.x + R.upperarm_R.p.x) / 2;
  for (const S of ['L', 'R']) {
    const ua = B[`upperarm_${S}`]!, fa = B[`forearm_${S}`], r = R[`upperarm_${S}`]!;
    if (st.shoulderW && ua.parent) {
      const d = new THREE.Vector3(mid + Math.sign(r.p.x - mid) * st.shoulderW - r.p.x, 0, 0);
      const w = an.model.localToWorld(an.model.worldToLocal(ua.getWorldPosition(new THREE.Vector3())).add(d));
      ua.position.copy(ua.parent.worldToLocal(w));
      for (const n of under(ua)) R[n]!.p.add(d);
      an.model.updateMatrixWorld(true);
    }
    const rf = R[`forearm_${S}`];
    if (st.reach && fa && rf) {
      const d = rf.p.clone().sub(r.p).multiplyScalar(st.reach - 1);
      fa.position.multiplyScalar(st.reach);
      for (const n of under(fa)) R[n]!.p.add(d);
    }
  }
}

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
export function armsOnly(model: THREE.Object3D, keep = 0.75, drape = 0, squeeze = 0): { kept: number; total: number } {
  let kept = 0, total = 0;
  model.traverse(o => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || (m.userData.fpArms as boolean)) return;
    const bones = m.skeleton.bones, arm = bones.map(b => /^(upperarm|forearm|hand|(thumb|index|middle|ring|pinky)\d)_[LR]$/.test(b.name));
    const g = m.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    if (!si || !sw) return;
    const n = si.count, w = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < 4; j++) if (arm[si.getComponent(i, j)]) s += sw.getComponent(i, j); w[i] = s; }
    // drape: each vertex's distance (bind space) from the segment of its heaviest arm bone; far = cloth hanging off the arm
    const far = new Uint8Array(n);
    let moved: Float32Array | null = null;
    if (drape > 0 || squeeze > 0) {
      const at = (name: string) => { const i = bones.findIndex(b => b.name === name); return i < 0 ? null : new THREE.Vector3().setFromMatrixPosition(m.skeleton.boneInverses[i].clone().invert()); };
      const seg = new Map<number, [THREE.Vector3, THREE.Vector3]>();
      let limit = 0, limitS = 0;
      for (const S of ['L', 'R']) {
        const ua = at(`upperarm_${S}`), fa = at(`forearm_${S}`), hd = at(`hand_${S}`);
        if (!ua || !fa || !hd) continue;
        const tip = hd.clone().add(hd.clone().sub(fa).multiplyScalar(0.45));
        seg.set(bones.findIndex(b => b.name === `upperarm_${S}`), [ua, fa]);
        seg.set(bones.findIndex(b => b.name === `forearm_${S}`), [fa, hd]);
        seg.set(bones.findIndex(b => b.name === `hand_${S}`), [hd, tip]);
        limit = Math.max(limit, fa.distanceTo(hd) * drape);
        limitS = Math.max(limitS, fa.distanceTo(hd) * squeeze);
      }
      const p = new THREE.Vector3(), q = new THREE.Vector3(), c = new THREE.Vector3(), pos = g.attributes.position;
      const unbind = m.bindMatrix.clone().invert();
      if (limitS > 0) moved = new Float32Array(pos.array as ArrayLike<number>);
      for (let i = 0; i < n && (limit > 0 || limitS > 0); i++) {
        let best = -1, bw = 0;
        for (let j = 0; j < 4; j++) { const b = si.getComponent(i, j), x = sw.getComponent(i, j); if (seg.has(b) && x > bw) { bw = x; best = b; } }
        if (best < 0) continue;
        const [a, b] = seg.get(best)!;
        p.fromBufferAttribute(pos, i).applyMatrix4(m.bindMatrix);
        const ab = q.copy(b).sub(a), u = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq())));
        c.copy(a).addScaledVector(ab, u);
        const d = p.distanceTo(c);
        if (limit > 0 && d > limit) far[i] = 1;
        // squeeze: a wide sleeve pulled in to a slim tube around the bone (bind space, then back to the mesh's own)
        if (moved && d > limitS) {
          p.sub(c).multiplyScalar(limitS / d).add(c).applyMatrix4(unbind);
          moved[i * 3] = p.x; moved[i * 3 + 1] = p.y; moved[i * 3 + 2] = p.z;
        }
      }
    }
    const src = g.index ? g.index.array : Array.from({ length: n }, (_, i) => i);
    const out: number[] = [];
    for (let t = 0; t + 2 < src.length; t += 3) if (w[src[t]] + w[src[t + 1]] + w[src[t + 2]] >= keep * 3 && !(far[src[t]] || far[src[t + 1]] || far[src[t + 2]])) out.push(src[t], src[t + 1], src[t + 2]);
    total += src.length / 3; kept += out.length / 3;
    const g2 = g.clone(); g2.setIndex(out); m.geometry = g2; m.userData.fpArms = true;
    if (moved) { g2.setAttribute('position', new THREE.BufferAttribute(moved, 3)); g2.computeVertexNormals(); g2.computeBoundingSphere(); }
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
  /** an archer's aim-down (Yuzu's Hawk Eye), eased in ~150 ms like Freja's Take Aim */
  private aimK = 0;
  /** a strike's impact: the viewmodel jolts down (the dip spring), as on a landing */
  kick(k: number) { this.dipV -= 0.45 * k; }
  /** Gantetsu's Shiko leap: the guns rise with him, then the slam throws the whole viewmodel down */
  private leapK = 0; private wasLeap = false;
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
    this.view = new CharacterView(actor, actor.team, skinId, { hd: 'fp' });      // the hero's first-person hand model (desktop)
    this.view.noSmear = true;
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
      fpArmReach(an, this.style);                  // (before the rig is placed: that reads the shoulders)
      const R = an.rest;
      const H = an.height;
      this.eye.copy(R.head!.p).add(new THREE.Vector3(0, H * 0.06, H * 0.05 + (this.style.push ?? 0) / Math.max(1e-6, this.view.scaleFit)));
      this.eye.sub(viewmodelOffset(an, this.eye, this.style, this.view.scaleFit));
    }
    if (this.real) armsOnly(this.view.model, this.style.keep ?? 0.75, this.style.drape ?? 0, this.style.squeeze ?? 0);
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
    // a one-shot retriggered (auto fire) is the SAME action: cross-fading it from itself fades it in from weight 0 with
    // nothing else playing, and the arms flash to the bind pose (hands thrown off-screen) - just restart it at full weight
    if (this.playing && this.playing.action !== a) a.crossFadeFrom(this.playing.action, 0.08, false);
    else a.setEffectiveWeight(1);
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
    const leap = a.has('stompair', t);
    if (this.wasLeap && !leap && a.grounded) this.dipV -= 1.3;                 // the slam lands
    this.wasLeap = leap;
    this.leapK += ((leap && !a.grounded ? 1 : 0) - this.leapK) * Math.min(1, dt * (leap ? 8 : 16));
    if (newAttack && a.anim.attackKind !== 'punch') this.swings++;
    this.dipV += (-this.dip * 120 - this.dipV * 14) * dt; this.dip += this.dipV * dt;
    const bob: V = [Math.sin(this.walk * 1.0) * 0.012 * mv + this.swayX, -Math.abs(Math.cos(this.walk * 1.0)) * 0.016 * mv + this.swayY + this.dip * 0.2, 0];
    // rig placement: eye at the origin, then the whole viewmodel offset by bob / sway
    // (a loaded GLB sits inside a scaled wrapper, lifted so its feet touch the ground)
    const k = this.view.scaleFit, off = an.model !== this.view.model ? an.model.position : new THREE.Vector3();
    // aiming down the arrow (Freja's Take Aim, docs/research/archer_fp_study.md s.2-3): the bow comes up and a little to
    // the right so the arrow runs just under the reticle, rolled more upright; the limbs leave the frame
    this.aimK += ((this.style.grip === 'bow' && a.sv.zoom ? 1 : 0) - this.aimK) * Math.min(1, dt * 14);
    const ak = this.aimK * this.aimK * (3 - 2 * this.aimK);
    this.view.group.position.set(-(this.eye.x + off.x) * k - bob[0] - 0.035 * ak, -(this.eye.y + off.y) * k + bob[1] + 0.035 * ak, -(this.eye.z + off.z) * k);
    this.view.group.rotation.set(this.swayY * 0.6, this.swayX * 0.8, 0);
    // Mirror Water (Hayate's deflect): each shot turned on the blade flicks the whole viewmodel toward where it came
    // from and rolls it that way, over both sources of motion (the guard itself is the authored fp_ability2 clip)
    const dfa = t - a.anim.deflectAt;
    if (dfa < 0.16 && a.has('deflect', t)) {
      const k = Math.sin(Math.min(1, dfa / 0.16) * Math.PI), d = a.anim.deflectDir;
      const dx = -d.x * Math.cos(a.yaw) + d.z * Math.sin(a.yaw), dy = d.y;       // view space: right, up
      this.view.group.position.x += dx * 0.06 * k; this.view.group.position.y += dy * 0.04 * k;
      this.view.group.rotation.z -= dx * 0.4 * k; this.view.group.rotation.x += dy * 0.25 * k;
    }
    this.view.inner.scale.setScalar(1);
    this.view.updateGuns(dt, t);
    if (this.style.gunScale) for (const g of this.view.guns) g.group.scale.setScalar(this.style.gunScale);
    if (this.view.backAxe) this.view.backAxe.visible = false;          // slung on her back: never in the viewmodel
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
      // the deflect guard ends when the window does (E again ends it early): the blade comes down with it
      if (this.oneShot?.name === 'fp_ability2' && a.def.id === 'hayate' && !a.has('deflect', t) && t - a.anim.castAt > 0.2) this.oneShot = null;
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
        // held weapons (Raijin's katana, the bows, Hayate's nodachi) follow the clip's hands; bows canted in
        // (Hanzo's hold: the bow rolled nearly flat, upper limb to the right, tilted so that limb recedes into the view)
        an.bowCant = this.style.grip === 'bow' ? -1.35 + 0.45 * this.aimK : 0; an.bowTilt = this.style.grip === 'bow' ? 0.35 - 0.15 * this.aimK : 0;
        an.placeGunsFromBones();
        driveFingers(this.view.fingers, a, t, dt, { fp: true });
        this.source = `clip:${want}`;
        return;
      }
    }
    // ---- 2. procedural personality
    this.proc(t, newAttack);
    driveFingers(this.view.fingers, a, t, dt, { fp: true });
  }

  private proc(t: number, _newAttack: boolean) {
    const a = this.actor, S = this.style, an = this.view.anim;
    if (S.grip === 'hammer' && an.prop) return this.hammerProc(t);
    let R: V = S.R, L: V | null = S.L;
    const atk = t - a.anim.attackAt, kind = a.anim.attackKind, cast = t - a.anim.castAt;
    let src = 'idle';
    // idle breathing / personality
    const br = Math.sin(t * 1.7) * 0.004;
    R = add(R, [0, br, 0]); if (L) L = add(L, [0, br * 0.8, 0]);
    let wristR: THREE.Quaternion | null = null, wristL: THREE.Quaternion | null = null;
    if (S.grip === 'katana') wristR = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 0, 0.3));
    // Tomoe's Fang hand: a hand that simply follows the forearm shows its palm to the lens on these rigs; the knife is
    // held knuckles-up, the blade out past the fingers
    if (a.def.id === 'tomoe') wristL = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 1.5));
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
    } else if (S.grip === 'dual' && L && this.leapK > 0.05) {
      // the leap: both guns hauled up and in, muzzles to the sky, ready to come down with him
      R = add(R, [-0.06, 0.2, -0.1], this.leapK); L = add(L, [0.06, 0.2, -0.1], this.leapK);
      src = 'leap';
    } else if (S.grip === 'dual' && L) {
      // twin chainguns: each gun kicks straight back on its own rounds (Boehm: push, snap back, a little rock) and the
      // spun-up guns chatter; nothing covers the reticle
      for (const [k, age] of [[1, t - a.anim.fireR], [0, t - a.anim.fireL]] as [number, number][]) {
        const kk = Math.max(0, 1 - age / 0.06), jit = age < 0.1 ? 0.004 : 0;
        const d: V = [(Math.random() - 0.5) * jit, 0.005 * kk + (Math.random() - 0.5) * jit, -S.recoil * kk];
        if (k === 1) R = add(R, d); else L = add(L, d);
        if (age < 0.1) src = 'chaingun';
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
    const own = a.def.id === 'tomoe' && ['crescent', 'recall', 'reaping', 'tide'].includes(a.anim.castId);
    if (cast < 0.6 && a.anim.castId && !own) {
      const k = bump(cast / 0.6), ult = a.anim.castId === a.def.ult.id;
      R = lerp(R, [0.1, ult ? 0.02 : -0.08, 0.5], k);
      if (L) L = lerp(L, [-0.1, ult ? 0.02 : -0.08, 0.5], k); else L = [-0.1, -0.08, 0.5];
      src = ult ? 'ult' : 'ability';
    }
    // Tomoe: the Fang leaves the left hand in an overhand throw and is called back palm-out; the great axe is heaved
    // across the screen from high right to low left for Crescent Reaping, and held out in front through the Warpath
    let axe: 'cleave' | 'warpath' | 'spin' | null = null, spinPh = 0;
    if (a.def.id === 'tomoe' && S.L) {
      const id = a.anim.castId;
      // the Fang (Junker Queen's knife): a sharp forward throw, the empty hand held open and forward a beat, then down;
      // on the recall the hand comes up palm-out for the whole return, and the catch slaps it back into the fist
      const fang = a.sv.fang ?? 0, fs = t - (a.sv.fangAt ?? -9);
      if (id === 'crescent' && cast < 0.45 && fang !== 4) {
        const u = cast / 0.45, back: V = [-0.32, 0.06, 0.12], out: V = [-0.02, -0.06, 0.62];
        L = u < 0.35 ? lerp(S.L, back, smooth(u / 0.35)) : lerp(back, out, smooth((u - 0.35) / 0.25));
        src = 'throw';
      } else if (fang === 4) {
        L = lerp(S.L, [-0.1, -0.03, 0.56], smooth(Math.min(1, fs / 0.15))); wristL = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.2, 0, 0.4)); src = 'recall';
      } else if (fang > 0) {
        L = lerp([-0.02, -0.06, 0.62], S.L, smooth(Math.max(0, (cast - 0.45) / 0.3))); src = 'thrown';
      } else if (fs < 0.25 && a.anim.castId === 'recall') { L = add(S.L, [0, -0.02, -0.05], bump(fs / 0.25)); src = 'catch'; }
      if (id === 'reaping' && cast < REAP_SECS + REAP_STOP) {
        // the cleave: a beat of anticipation with the axe loaded high right, the fast swing down across the view, a
        // 3-frame hit-stop as it crosses the target (reapPhase), then the recovery
        const u = reapPhase(cast), hi: V = [0.3, 0.14, 0.44], lo: V = [-0.34, -0.36, 0.52], home: V = [0.2, -0.22, 0.44];
        R = u < 0.3 ? lerp(home, hi, smooth(u / 0.3)) : u < 0.8 ? lerp(hi, lo, smooth((u - 0.3) / 0.32)) : lerp(lo, home, smooth((u - 0.8) / 0.2));
        L = add(R, [-0.06, -0.1, -0.04]); axe = 'cleave'; src = 'cleave';
      } else if (a.forced?.kind === 'tide') {
        // Crescent Warpath in first person: the camera doesn't spin (the body does, in third person) - the great axe
        // sweeps round her in flat circles, crossing the view from right to left once a turn, the Fang in the left
        // hand half a turn behind it
        const t0 = a.sv.tideT0 ?? a.anim.castAt, dur = Math.max(0.2, a.sv.tideDur ?? 1.2);
        const ph = (t - t0) / dur * 2 * 2 * Math.PI;
        R = [0.3 * Math.cos(ph), -0.2 + 0.03 * Math.sin(ph * 2), 0.42 + 0.16 * Math.sin(ph)];
        L = [0.26 * Math.cos(ph + Math.PI), -0.24 + 0.03 * Math.sin(ph * 2 + 1), 0.4 + 0.14 * Math.sin(ph + Math.PI)];
        axe = 'spin'; spinPh = ph; src = 'warpath';
      }
    }
    // hit flinch
    const hit = t - a.anim.hitAt;
    if (hit < 0.25) { const k = bump(hit / 0.25) * 0.02; R = add(R, [0, k, -k]); if (L) L = add(L, [0, k, -k]); }
    // view space (right, up, forward) -> model space (+X = the character's left)
    const k = 1 / Math.max(1e-6, this.view.scaleFit);
    // hand targets are camera-relative; the rig sits wherever puts the grip in reach (viewmodelOffset)
    const toM = (v: V) => new THREE.Vector3(-v[0] * k, v[1] * k, v[2] * k).add(this.eye);
    const hands: [THREE.Vector3 | null, THREE.Vector3 | null] = [L ? toM(L) : null, toM(R)];
    const prop = axe === 'spin' ? { pos: hands[1]!.clone(), dir: new THREE.Vector3(-Math.cos(spinPh), 0.12, Math.sin(spinPh)).normalize(), side: new THREE.Vector3(0, 1, 0) }
      : axe ? { pos: hands[1]!.clone(), dir: hands[1]!.clone().sub(hands[0]!).normalize(), side: axe === 'cleave' ? new THREE.Vector3(1, -0.3, 0) : new THREE.Vector3(0, 0, 1) }
      : S.grip === 'hammer' ? { pos: hands[1]!.clone(), dir: hands[0] ? hands[0].clone().sub(hands[1]!).normalize().add(new THREE.Vector3(0, 0.9, 0.2)).normalize() : new THREE.Vector3(0, 1, 0.3).normalize(), side: new THREE.Vector3(-1, 0, 0) } : null;
    // twin chainguns converge on a point well past the reticle (hip-held guns never follow the bent forearms)
    const gunAim = an.guns ? toM([0, 0, 14]) : undefined;
    an.updateFirstPerson({ hands, wrist: [wristL, wristR], prop, gunAim });
    this.source = `proc:${src}`;
  }

  // the hammer's current swing: when it started, which way (+1 right to left, -1 left to right)
  private hSwing = { at: -99, dir: 1 };

  /** Tenkai-Oh's rocket hammer (see HAMMER_REST): both gauntlets on the haft through keyed haft poses, the swings
   *  alternating, the thruster lit through the strike */
  private hammerProc(t: number) {
    const a = this.actor, an = this.view.anim;
    const kind = a.anim.attackKind, atk = t - a.anim.attackAt, cast = t - a.anim.castAt;
    // a new swing goes right to left - unless the last went right to left and is still held off the left edge: back across
    if (kind === 'primary' && a.anim.attackAt !== this.hSwing.at && atk < 0.5) {
      const held = this.hSwing.dir === 1 && a.anim.attackAt - this.hSwing.at < RECOVER[1][0];
      this.hSwing = { at: a.anim.attackAt, dir: held ? -1 : 1 };
    }
    const sa = t - this.hSwing.at;
    let k = HAMMER_REST, src = 'idle', dir = 1, flame = 0;
    if (sa < 1.4) {
      dir = this.hSwing.dir;
      k = dir === 1 ? hammerAt(sa < 0.96 ? SWING_RL : RECOVER, sa) : hammerAt(SWING_LR, sa);
      src = sa < 0.45 ? 'swing' : 'recover';
      // the thruster fires on the strike, not the wind-up (as on the third-person hammer)
      if (sa > 0.12 && sa < 0.42) flame = Math.sin(((sa - 0.12) / 0.3) * Math.PI);
    }
    if (a.anim.castId === 'shatter' && cast < 1.1) { k = hammerAt(SHATTER, cast); src = 'shatter'; flame = cast > 0.42 && cast < 0.6 ? 1 : 0; }
    else if (a.anim.castId === a.def.ult.id && cast < 1.3) { k = hammerAt(RAISE, cast); src = 'ult'; }
    if (kind === 'punch' && atk < 0.45) { k = hammerAt(JAB, atk); src = 'melee'; flame = 0; }
    // breathing, and a flinch when hit
    const hit = t - a.anim.hitAt, fl = hit < 0.25 ? bump(hit / 0.25) * 0.02 : 0;
    const g: V = [k[1], k[2] + Math.sin(t * 1.7) * 0.004 + fl, k[3] - fl], H = haftDir(k);
    // model space (+X = the character's left); the head's striking faces lead the motion (the swing's tangent), so the
    // thruster (trailing the head's -X) streams out behind it
    const s = 1 / Math.max(1e-6, this.view.scaleFit);
    const toM = (v: V) => new THREE.Vector3(-v[0] * s, v[1] * s, v[2] * s).add(this.eye);
    const side: V = src === 'shatter' ? [Math.sin(k[4]) * Math.sin(k[5]), -Math.cos(k[5]), Math.cos(k[4]) * Math.sin(k[5])] : [-Math.cos(k[4]) * dir, 0, Math.sin(k[4]) * dir];
    const Hm = new THREE.Vector3(-H[0], H[1], H[2]), Tm = new THREE.Vector3(-side[0], side[1], side[2]);
    an.updateFirstPerson({ hands: [toM(add(g, H, k[6])), toM(g)], wrist: [null, null], prop: { pos: toM(g), dir: Hm, side: Tm } });
    // dedicated first-person gauntlets sit on the haft by construction; the rig's own hands are locked on after the IK
    if (this.style.gauntlets) this.placeGauntlets(g, add(g, H, k[6]), H);
    if (!this.gaunt) this.haftThroughFists(Hm, Tm);
    const hm = this.view.hammer;
    if (hm) {
      hm.flame.visible = flame > 0.02;
      if (flame > 0.02) hm.flame.scale.set(1, 0.5 + 0.9 * flame + Math.random() * 0.15, 1);
      hm.core.emissiveIntensity = 2.4 + 3 * flame;
    }
    this.source = `proc:${src}`;
  }

  /** Style.gauntlets, once loaded: [L, R] */
  private gaunt: [THREE.Object3D, THREE.Object3D] | null = null;
  private gauntLoad: Promise<void> | null = null;
  private loadGauntlets(): Promise<void> {
    return this.gauntLoad ??= new GLTFLoader().loadAsync(`${BASE}${this.style.gauntlets}`).then(g => {
      const L = g.scene.getObjectByName('gauntlet_L'), R = g.scene.getObjectByName('gauntlet_R');
      if (L && R) this.gaunt = [L, R];
    }).catch(() => { /* no file: the rig's own hands stay */ });
  }
  /** what this viewmodel loads on demand (Tenkai-Oh's gauntlets), loaded now: the match preloader waits for it, and the
   *  next update mounts it - so it is uploaded and compiled with everything else, not in the first frames of play */
  preload(): Promise<void> { return this.style.gauntlets ? this.loadGauntlets() : Promise.resolve(); }

  /** each rigid gauntlet's fist round the haft at its grip, the forearm rising back toward its own shoulder below the
   *  lens; the rig's skinned body (whose arms can't reach) is hidden once they're in */
  private placeGauntlets(gR: V, gL: V, H: V) {
    const prop = this.view.anim.prop;
    if (!this.gaunt) {
      if (this.style.gauntlets) void this.loadGauntlets();
      return;
    }
    if (!prop?.parent) return;
    const [GL, GR] = this.gaunt;
    if (GL.parent !== prop.parent) {
      prop.parent.add(GL, GR);
      this.view.model.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.visible = false; });
    }
    const s = 1 / Math.max(1e-6, this.view.scaleFit);
    const toM = (v: V) => new THREE.Vector3(-v[0] * s, v[1] * s, v[2] * s).add(this.eye);
    const Hm = new THREE.Vector3(-H[0], H[1], H[2]).normalize();
    for (const [i, o, at] of [[0, GL, gL], [1, GR, gR]] as const) {
      const p = toM(at);
      const f = toM(GAUNT_SHOULDER[i]).sub(p);
      f.addScaledVector(Hm, -f.dot(Hm)).normalize();                       // the forearm square to the haft
      const z = Hm.clone().multiplyScalar(GAUNT_FLIP[i]), x = new THREE.Vector3().crossVectors(f, z).normalize();
      o.position.copy(p);
      o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, f, z));
    }
  }

  /** the haft through both closed gauntlets as the arms actually solved (the IK falls a little short at the extremes):
   *  fist centres FIST forearm-lengths past the wrists, the pommel under the right fist, the haft on through the left */
  private haftThroughFists(want: THREE.Vector3, side: THREE.Vector3) {
    const an = this.view.anim, prop = an.prop, R = an.rest, B = an.bones;
    if (!prop?.parent || !B.hand_R || !B.hand_L || !B.forearm_R || !B.forearm_L || !R.forearm_R || !R.hand_R) return;
    this.view.group.updateMatrixWorld(true);
    const lf = R.forearm_R.p.distanceTo(R.hand_R.p);
    const fist = (h: THREE.Object3D, f: THREE.Object3D) => {
      const ph = prop.parent!.worldToLocal(h.getWorldPosition(new THREE.Vector3())), pf = prop.parent!.worldToLocal(f.getWorldPosition(new THREE.Vector3()));
      return ph.addScaledVector(ph.clone().sub(pf).normalize(), lf * FIST);
    };
    const cR = fist(B.hand_R, B.forearm_R), cL = fist(B.hand_L, B.forearm_L);
    const H = cL.clone().sub(cR);
    // a short lead-hand gap swings the haft a lot per centimetre of IK error: lean on the authored direction
    H.normalize().multiplyScalar(0.65).addScaledVector(want, 0.35).normalize();
    const T = side.clone().addScaledVector(H, -side.dot(H)).normalize();
    prop.position.copy(cR).addScaledVector(H, -0.1 * an.hammerLen);
    prop.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(T, H, new THREE.Vector3().crossVectors(T, H)));
  }

  dispose() { this.view.anim.restoreHead(); this.view.dispose(); }
}
