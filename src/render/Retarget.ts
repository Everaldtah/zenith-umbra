// Clip retargeting: bakes glTF animation clips authored on ANY humanoid skeleton (Quaternius Universal Animation
// Library 1 & 2, Mixamo, Blender Rigify / metarig exports, our own auto-rig) into rig-independent PoseClips.
//
// A PoseClip stores, per frame and per body bone, in the shared canonical frame (Y up, +Z forward, +X = the
// character's left):
//   - the bone's model-space rotation DELTA from the source rest pose (rest-pose-independent: T-pose, A-pose, any bone
//     roll convention)
//   - the bone head position in LEG LENGTHS from the ground under the hips (proportion-independent)
// The Animator applies deltas to the torso and aims limbs along the clip's bone directions, and places feet by
// IK on the scaled clip foot positions. So one library drives every hero regardless of how tall, wide or
// long-legged their auto-rigged mesh is.
//
// Locomotion clips are analysed on load: travel direction and speed come from the planted feet (in-place clips)
// or the hips drift (root-motion clips, which are made in-place). This is how 8-way blend spaces get built
// without depending on how a pack happens to name its clips.
import * as THREE from 'three';
import { RT, RT_INDEX, type RtBone } from './Rig';

export interface PoseClip {
  name: string;
  src: string;              // pack / file the clip came from
  duration: number;
  fps: number;
  frames: number;
  loop: boolean;
  mask: boolean[];          // per RT bone: present in the source rig
  q: Float32Array;          // frames * RT * 4: model-space rotation delta from the source rest pose
  p: Float32Array;          // frames * RT * 3: bone head, leg lengths, canonical frame, ground origin under the hips
  restP: Float32Array;      // RT * 3: source rest positions (same units)
  speed: number;            // leg lengths per second the clip travels (0 = stationary)
  travel: [number, number]; // unit travel direction in the canonical XZ plane (x = left, z = forward)
  contact: Uint8Array;      // frames * 2: foot (L, R) planted
  phase0: number;           // normalised time of the left foot touch-down (phase-syncs gait clips)
  rootMotion: boolean;      // horizontal hips drift was removed
}

// ---------------------------------------------------------------- bone-name mapping
// Names arrive sanitised by three's GLTFLoader ("mixamorig:LeftArm" -> "mixamorigLeftArm", "UpperArm.L" ->
// "UpperArmL"), so matching works on lowercase alphanumerics with the side peeled off either end.
const PARTS: Record<string, string[]> = {
  shoulder: ['shoulder', 'clavicle', 'collar', 'collarbone'],
  upperarm: ['upperarm', 'arm', 'uparm', 'humerus'],
  forearm: ['forearm', 'lowerarm', 'loarm'],
  hand: ['hand', 'palm', 'fist', 'wrist'],
  thigh: ['thigh', 'upleg', 'upperleg', 'femur'],
  shin: ['shin', 'calf', 'leg', 'lowerleg', 'loleg', 'knee'],
  foot: ['foot', 'ankle'],
};
const CENTER: Record<string, string[]> = { hips: ['hips', 'hip', 'pelvis'], neck: ['neck'], head: ['head'] };

export function normBoneName(n: string) {
  return n.toLowerCase()
    .replace(/^mixamorig\d*[-_:. ]*/, '')
    .replace(/^(armature|def|org|mch|bip0?1|cc_base|valvebiped\d*)[-_:. ]+/, '')
    .replace(/[^a-z0-9]/g, '');
}
const partOf = (base: string) => {
  const b = base.replace(/\d+$/, '');
  for (const [k, list] of Object.entries(PARTS)) if (list.includes(b)) return k;
  return null;
};

/** our bone for a source bone name (limbs + hips / neck / head; spine and chest come from the hierarchy) */
export function classifyBone(name: string): RtBone | null {
  const n = normBoneName(name);
  let m: RegExpMatchArray | null;
  const tries: [string, string][] = [];
  if ((m = n.match(/^(left|right)(.+)$/))) tries.push([m[1][0], m[2]]);
  if ((m = n.match(/^(.+?)(left|right)$/))) tries.push([m[2][0], m[1]]);
  if ((m = n.match(/^(.+?)(l|r)$/))) tries.push([m[2], m[1]]);
  if ((m = n.match(/^(l|r)(.+)$/))) tries.push([m[1], m[2]]);
  for (const [side, base] of tries) {
    const p = partOf(base);
    if (p) return `${p}_${side === 'l' ? 'L' : 'R'}` as RtBone;
  }
  const c = n.replace(/\d+$/, '');
  for (const [k, list] of Object.entries(CENTER)) if (list.includes(c)) return k as RtBone;
  return null;
}

/** our rig's bones -> source objects; null when the skeleton isn't a recognisable humanoid */
export function mapSkeleton(root: THREE.Object3D): Partial<Record<RtBone, THREE.Object3D>> | null {
  const out: Partial<Record<RtBone, THREE.Object3D>> = {};
  const depth = (o: THREE.Object3D) => { let d = 0; for (let p = o.parent; p; p = p.parent) d++; return d; };
  const found: [RtBone, THREE.Object3D][] = [];
  root.traverse(o => {
    if ((o as THREE.Mesh).isMesh) return;
    const b = classifyBone(o.name);
    if (b) found.push([b, o]);
  });
  // the shallowest match wins (a "Head" beats "Head_end", a "LeftArm" beats "LeftArmTwist")
  found.sort((a, b) => depth(a[1]) - depth(b[1]));
  for (const [b, o] of found) if (!out[b]) out[b] = o;
  // hips must be an ancestor of the legs; some rigs call the root "Hips" AND have a "pelvis": prefer the one that is
  if (out.hips && out.thigh_L && !isAncestor(out.hips, out.thigh_L)) {
    const alt = found.find(([b, o]) => b === 'hips' && isAncestor(o, out.thigh_L!));
    if (alt) out.hips = alt[1];
  }
  const need: RtBone[] = ['hips', 'head', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R'];
  if (!need.every(b => out[b])) return null;
  // spine chain: the bones between the hips and the neck (or head)
  const top = out.neck ?? out.head!;
  const chain: THREE.Object3D[] = [];
  for (let p = top.parent; p && p !== out.hips; p = p.parent) chain.unshift(p);
  if (chain.length && isAncestor(out.hips!, top)) {
    out.chest = chain[chain.length - 1];
    if (chain.length > 1) out.spine = chain[0];
  }
  return out;
}
function isAncestor(a: THREE.Object3D, b: THREE.Object3D) { for (let p = b.parent; p; p = p.parent) if (p === a) return true; return false; }

// ---------------------------------------------------------------- baking
const NB = RT.length;
const FPS = 30;
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

interface Frame { q: THREE.Quaternion[]; p: THREE.Vector3[]; }

/** rig-space basis: from the source rest pose, which way is up / left / forward, and how long a leg is */
function basis(map: Partial<Record<RtBone, THREE.Object3D>>, rootInv: THREE.Matrix4) {
  const pos = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(_m.multiplyMatrices(rootInv, o.matrixWorld));
  const hips = pos(map.hips!), head = pos(map.head!);
  const tl = pos(map.thigh_L!), tr = pos(map.thigh_R!), sl = pos(map.shin_L!), fl = pos(map.foot_L!), fr = pos(map.foot_R!);
  const up = head.clone().sub(hips).normalize();
  const left = tl.clone().sub(tr); left.addScaledVector(up, -left.dot(up)).normalize();
  const fwd = new THREE.Vector3().crossVectors(left, up).normalize();
  const qC = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(left, up, fwd));
  const legLen = tl.distanceTo(sl) + sl.distanceTo(fl);
  const feet = fl.clone().add(fr).multiplyScalar(0.5);
  const origin = hips.clone().addScaledVector(up, -hips.clone().sub(feet).dot(up));
  return { qCinv: qC.invert(), legLen, origin };
}

function capture(map: Partial<Record<RtBone, THREE.Object3D>>, rootInv: THREE.Matrix4, B: ReturnType<typeof basis>): Frame {
  const f: Frame = { q: [], p: [] };
  for (const b of RT) {
    const o = map[b];
    if (!o) { f.q.push(new THREE.Quaternion()); f.p.push(new THREE.Vector3()); continue; }
    _m.multiplyMatrices(rootInv, o.matrixWorld).decompose(_p, _q, _s);
    f.q.push(B.qCinv.clone().multiply(_q));
    f.p.push(_p.clone().sub(B.origin).applyQuaternion(B.qCinv).divideScalar(B.legLen));
  }
  return f;
}

const LOOP_HINT = /loop|idle|walk|jog|run|sprint|strafe|crouch.*(fwd|bwd|left|right|move)|swim|fly|hover|breath/i;

/**
 * Bake every clip of a loaded glTF (scene + animations) into PoseClips. The scene's node transforms at load time are
 * its rest pose; they are restored afterwards, so the same scene can be baked again.
 */
export function bakeClips(root: THREE.Object3D, clips: THREE.AnimationClip[], src = ''): PoseClip[] {
  const map = mapSkeleton(root);
  if (!map) return [];
  const saved: [THREE.Object3D, THREE.Vector3, THREE.Quaternion, THREE.Vector3][] = [];
  root.traverse(o => saved.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  const restore = () => { for (const [o, p, q, s] of saved) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(s); } root.updateMatrixWorld(true); };
  restore();
  const rootInv = root.matrixWorld.clone().invert();
  const B = basis(map, rootInv);
  const rest = capture(map, rootInv, B);
  const restInv = rest.q.map(q => q.clone().invert());
  const mask = RT.map(b => !!map[b]);
  const out: PoseClip[] = [];
  const mixer = new THREE.AnimationMixer(root);
  for (const clip of clips) {
    if (!(clip.duration > 0)) continue;
    const frames = Math.max(2, Math.round(clip.duration * FPS) + 1);
    const q = new Float32Array(frames * NB * 4), p = new Float32Array(frames * NB * 3);
    const act = mixer.clipAction(clip);
    // play once and clamp: a repeating action wraps t == duration back to frame 0
    act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true;
    act.reset(); act.play();
    for (let f = 0; f < frames; f++) {
      mixer.setTime(Math.min(clip.duration, f / FPS));
      root.updateMatrixWorld(true);
      const fr = capture(map, rootInv, B);
      for (let i = 0; i < NB; i++) {
        const d = fr.q[i].clone().multiply(restInv[i]);
        d.toArray(q, (f * NB + i) * 4);
        fr.p[i].toArray(p, (f * NB + i) * 3);
      }
    }
    act.stop(); mixer.uncacheAction(clip);
    restore();
    const pc: PoseClip = {
      name: clip.name, src, duration: clip.duration, fps: FPS, frames, loop: false, mask, q, p,
      restP: new Float32Array(rest.p.flatMap(v => [v.x, v.y, v.z])), speed: 0, travel: [0, 1],
      contact: new Uint8Array(frames * 2), phase0: 0, rootMotion: false,
    };
    analyse(pc);
    out.push(pc);
  }
  mixer.uncacheRoot(root);
  return out;
}

const pAt = (c: PoseClip, f: number, b: RtBone) => { const o = (f * NB + RT_INDEX[b]) * 3; return new THREE.Vector3(c.p[o], c.p[o + 1], c.p[o + 2]); };

/** loop detection, root-motion removal, travel speed / direction from the feet, foot contacts, gait phase */
export function analyse(c: PoseClip) {
  const n = c.frames, last = n - 1, dur = c.duration;
  // loop: first and last poses match (hips height, both feet relative to the hips)
  const rel = (f: number, b: RtBone) => pAt(c, f, b).sub(pAt(c, f, 'hips'));
  const same = Math.abs(pAt(c, 0, 'hips').y - pAt(c, last, 'hips').y) < 0.04 && rel(0, 'foot_L').distanceTo(rel(last, 'foot_L')) < 0.08 && rel(0, 'foot_R').distanceTo(rel(last, 'foot_R')) < 0.08;
  c.loop = same && (LOOP_HINT.test(c.name) || dur >= 0.4);
  // root motion: a looping clip whose hips travel is made in place
  const drift = pAt(c, last, 'hips').sub(pAt(c, 0, 'hips')); drift.y = 0;
  if (c.loop && drift.length() > 0.2) {
    c.rootMotion = true;
    c.speed = drift.length() / dur;
    c.travel = [drift.x / drift.length(), drift.z / drift.length()];
    for (let f = 0; f < n; f++) {
      const k = f / last;
      for (let i = 0; i < NB; i++) { const o = (f * NB + i) * 3; c.p[o] -= drift.x * k; c.p[o + 2] -= drift.z * k; }
    }
  }
  // contacts: a foot within a few centimetres (per leg length) of its lowest point
  const minY = [Infinity, Infinity];
  for (let f = 0; f < n; f++) for (let s = 0; s < 2; s++) minY[s] = Math.min(minY[s], pAt(c, f, s ? 'foot_R' : 'foot_L').y);
  for (let f = 0; f < n; f++) for (let s = 0; s < 2; s++) c.contact[f * 2 + s] = pAt(c, f, s ? 'foot_R' : 'foot_L').y < minY[s] + 0.05 ? 1 : 0;
  // in-place gait: a planted foot slides backwards (relative to the body) at the travel speed
  if (!c.rootMotion && c.loop) {
    const v: THREE.Vector3[] = [];
    for (let f = 0; f < last; f++) for (let s = 0; s < 2; s++) {
      if (!c.contact[f * 2 + s] || !c.contact[(f + 1) * 2 + s]) continue;
      const b: RtBone = s ? 'foot_R' : 'foot_L';
      const d = pAt(c, f + 1, b).sub(pAt(c, f, b)).multiplyScalar(c.fps); d.y = 0;
      v.push(d);
    }
    const mean = v.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(Math.max(1, v.length));
    if (v.length >= 4 && mean.length() > 0.15) {
      const t = mean.clone().negate().normalize();
      const along = v.map(d => -d.dot(t)).sort((a, b) => a - b);
      c.speed = along[Math.floor(along.length / 2)];
      c.travel = [t.x, t.z];
    }
  }
  // a moving clip's planted foot also moves WITH the stance (backwards at the travel speed in place, still with root
  // motion): low feet that are already swinging forward (lift-off, touch-down) aren't planted
  if (c.speed > 0.2) {
    const tv = new THREE.Vector3(c.travel[0], 0, c.travel[1]);
    for (let s = 0; s < 2; s++) {
      const b: RtBone = s ? 'foot_R' : 'foot_L';
      const ok: number[] = [];
      for (let f = 0; f < n; f++) {
        const f0 = Math.max(0, f - 1), f1 = Math.min(last, f + 1);
        const v = pAt(c, f1, b).sub(pAt(c, f0, b)).multiplyScalar(c.fps / Math.max(1, f1 - f0)); v.y = 0;
        const stance = c.rootMotion ? v.length() < 0.35 * c.speed : -v.dot(tv) > 0.6 * c.speed && Math.abs(v.clone().addScaledVector(tv, -v.dot(tv)).length()) < 0.5 * c.speed;
        ok.push(c.contact[f * 2 + s] && stance ? 1 : 0);
      }
      for (let f = 0; f < n; f++) c.contact[f * 2 + s] = ok[f];
    }
  }
  // gait phase anchor: the left foot touching down
  for (let f = 1; f < n; f++) if (c.contact[f * 2] && !c.contact[(f - 1) * 2]) { c.phase0 = f / last; break; }
}

// ---------------------------------------------------------------- sampling / blending
export class Pose {
  q = RT.map(() => new THREE.Quaternion());
  p = RT.map(() => new THREE.Vector3());   // bone head, leg lengths (limb directions come from these)
  d = RT.map(() => new THREE.Vector3());   // displacement from the source rest pose, leg lengths (feet / hips placement)
  w = new Float32Array(NB);          // accumulated weight per bone (0 = the clip doesn't drive it)
  contact = [0, 0];
  reset() { this.w.fill(0); for (const q of this.q) q.identity(); for (const p of this.p) p.set(0, 0, 0); for (const d of this.d) d.set(0, 0, 0); this.contact[0] = this.contact[1] = 0; return this; }
  copy(o: Pose) { for (let i = 0; i < NB; i++) { this.q[i].copy(o.q[i]); this.p[i].copy(o.p[i]); this.d[i].copy(o.d[i]); this.w[i] = o.w[i]; } this.contact[0] = o.contact[0]; this.contact[1] = o.contact[1]; return this; }
}

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
/** clip time -> pose (frame lerp / slerp); loops wrap, one-shots clamp */
export function samplePose(c: PoseClip, t: number, out: Pose) {
  const last = c.frames - 1;
  let x = t / c.duration;
  x = c.loop ? x - Math.floor(x) : Math.min(1, Math.max(0, x));
  const fx = x * last, f0 = Math.min(last, Math.floor(fx)), f1 = Math.min(last, f0 + 1), u = fx - f0;
  for (let i = 0; i < NB; i++) {
    out.w[i] = c.mask[i] ? 1 : 0;
    const a = (f0 * NB + i) * 4, b = (f1 * NB + i) * 4;
    _qa.fromArray(c.q, a); _qb.fromArray(c.q, b);
    out.q[i].copy(_qa).slerp(_qb, u);
    const pa = (f0 * NB + i) * 3, pb = (f1 * NB + i) * 3;
    out.p[i].set(c.p[pa] + (c.p[pb] - c.p[pa]) * u, c.p[pa + 1] + (c.p[pb + 1] - c.p[pa + 1]) * u, c.p[pa + 2] + (c.p[pb + 2] - c.p[pa + 2]) * u);
    out.d[i].set(out.p[i].x - c.restP[i * 3], out.p[i].y - c.restP[i * 3 + 1], out.p[i].z - c.restP[i * 3 + 2]);
  }
  const fc = u < 0.5 ? f0 : f1;
  out.contact[0] = c.contact[fc * 2]; out.contact[1] = c.contact[fc * 2 + 1];
  return out;
}

/** accumulate `src` into `acc` with weight w (normalised running slerp / lerp); call acc.reset() first */
export function accumulate(acc: Pose, src: Pose, w: number) {
  if (w <= 0) return;
  for (let i = 0; i < NB; i++) {
    const ws = src.w[i] * w;
    if (ws <= 0) continue;
    const W = acc.w[i] + ws, k = ws / W;
    if (acc.w[i] === 0) { acc.q[i].copy(src.q[i]); acc.p[i].copy(src.p[i]); acc.d[i].copy(src.d[i]); }
    else {
      if (acc.q[i].dot(src.q[i]) < 0) _qa.set(-src.q[i].x, -src.q[i].y, -src.q[i].z, -src.q[i].w); else _qa.copy(src.q[i]);
      acc.q[i].slerp(_qa, k); acc.p[i].lerp(src.p[i], k); acc.d[i].lerp(src.d[i], k);
    }
    acc.w[i] = W;
  }
  acc.contact[0] += src.contact[0] * w; acc.contact[1] += src.contact[1] * w;
}
