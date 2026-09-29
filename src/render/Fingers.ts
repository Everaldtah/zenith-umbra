// Finger curls. Tripo rigs carry Mixamo's fingers (thumb / index / middle / ring / pinky, joints 1..3, per hand), skinned
// but never driven, so every hand hung open and flat: a katana held in straight fingers, a trigger never pulled. Each hero's
// hands close into the grip their weapon needs, the way Overwatch 2 poses hands: a fist wrapped around a hilt or a bow
// grip, the index along the trigger (squeezed on every shot), the string hand's three-finger hook, a caster's open palm,
// a card pinched between two fingers. Grips blend per joint in about a tenth of a second.
//
// Curls are rotations about each joint's hinge in its rest frame (the axis across the knuckles, turning the finger toward
// the palm), so they ride on whatever the arm is doing: procedural pose, clips, the first-person viewmodel or a ragdoll.
import * as THREE from 'three';
import type { Actor } from '../game/Actor';
import { ARROW_GONE } from './HeldProps';

export type Grip = 'relaxed' | 'fist' | 'trigger' | 'hook' | 'open' | 'pinch' | 'claw' | 'hammer';
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
/** radians per joint (1..3), per finger, thumb first */
const CURL: Record<Grip, number[][]> = {
  relaxed: [[0.12, 0.2, 0.12], [0.22, 0.38, 0.22], [0.28, 0.44, 0.26], [0.34, 0.5, 0.3], [0.4, 0.55, 0.32]],
  fist: [[0.5, 0.55, 0.45], [1.3, 1.5, 0.95], [1.35, 1.5, 0.95], [1.35, 1.5, 0.95], [1.35, 1.45, 0.95]],
  trigger: [[0.45, 0.5, 0.35], [0.35, 0.55, 0.3], [1.3, 1.5, 0.95], [1.35, 1.5, 0.95], [1.35, 1.45, 0.95]],
  hook: [[0.3, 0.35, 0.25], [0.35, 1.15, 0.75], [0.35, 1.2, 0.75], [0.4, 1.2, 0.75], [1.15, 1.35, 0.9]],
  open: [[0.04, 0.05, 0.04], [0.04, 0.08, 0.05], [0.04, 0.08, 0.05], [0.06, 0.1, 0.06], [0.08, 0.1, 0.06]],
  pinch: [[0.45, 0.5, 0.35], [0.55, 0.55, 0.3], [0.6, 0.6, 0.35], [1.25, 1.45, 0.9], [1.3, 1.45, 0.9]],
  claw: [[0.3, 0.4, 0.3], [0.55, 0.85, 0.6], [0.6, 0.9, 0.6], [0.6, 0.9, 0.6], [0.65, 0.9, 0.6]],
  // a two-handed wrap around a thick haft (Reinhardt's hammer): fingers round a ~5 cm handle, the thumb over them
  hammer: [[0.75, 0.85, 0.6], [1.15, 1.35, 0.95], [1.2, 1.4, 0.95], [1.2, 1.4, 0.95], [1.25, 1.4, 0.95]],
};
/** how far a grip closes the fingers' rest spread (a fist packs them together, an open palm fans them a little) */
const CLOSE: Record<Grip, number> = { relaxed: 0.35, fist: 0.9, trigger: 0.85, hook: 0.7, open: -0.15, pinch: 0.6, claw: 0.2, hammer: 0.95 };

interface Joint { o: THREE.Object3D; rest: THREE.Quaternion; curl: THREE.Vector3; splay: THREE.Vector3 | null; spread: number; f: number; k: number }
interface Hand { joints: Joint[]; cur: Float32Array; tgt: Float32Array; close: number; closeTgt: number }

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

export class Fingers {
  private hands: (Hand | null)[] = [null, null];
  private first = true;

  /** null when the model has no finger bones (the procedural mannequin, mechs) */
  static build(model: THREE.Object3D): Fingers | null {
    const f = new Fingers(model);
    return f.hands[0] || f.hands[1] ? f : null;
  }

  private constructor(model: THREE.Object3D) {
    const byName = new Map<string, THREE.Object3D>();
    model.traverse(o => { const n = o.name.replace(/\./g, '_'); if (!byName.has(n)) byName.set(n, o); });
    model.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const M = new THREE.Matrix4(), s = new THREE.Vector3();
    const pose = (o: THREE.Object3D) => { const p = new THREE.Vector3(), q = new THREE.Quaternion(); M.multiplyMatrices(inv, o.matrixWorld).decompose(p, q, s); return { p, q }; };
    for (const [side, S] of [[0, 'L'], [1, 'R']] as const) {
      const chain = FINGERS.map(f => [1, 2, 3].map(k => byName.get(`${f}${k}_${S}`)).filter((o): o is THREE.Object3D => !!o));
      const idx = chain[1], mid = chain[2], pky = chain[4].length ? chain[4] : chain[3];
      if (idx.length < 2 || mid.length < 2 || !pky.length) continue;
      const P = chain.map(c => c.map(pose));
      // the hand frame at rest: fingers' direction, the knuckle line (index -> pinky), the palm normal. For a right hand
      // (index on the thumb side) the palm faces dir x across; the left hand is its mirror image
      const across = pose(pky[0]).p.sub(P[1][0].p).normalize();
      const along = P[2][P[2].length - 1].p.clone().sub(P[2][0].p).normalize();
      const palm = along.clone().cross(across).multiplyScalar(S === 'R' ? 1 : -1).normalize();
      const midDir = P[2][1].p.clone().sub(P[2][0].p).normalize();
      const joints: Joint[] = [];
      chain.forEach((c, f) => c.forEach((o, k) => {
        const here = P[f][k].p, dir = (k + 1 < c.length ? P[f][k + 1].p.clone().sub(here) : here.clone().sub(P[f][k - 1]?.p ?? here)).normalize();
        if (dir.lengthSq() < 0.5) return;
        // the thumb closes across the palm toward the little finger, the others straight into it
        const to = f === 0 ? palm.clone().add(across.clone().multiplyScalar(0.7)).normalize() : palm;
        const axis = dir.clone().cross(to);
        if (axis.lengthSq() < 1e-6) return;
        const toLocal = P[f][k].q.clone().invert();
        let splay: THREE.Vector3 | null = null, spread = 0;
        if (k === 0 && f !== 0 && f !== 2) {
          // the finger's rest spread from the middle finger, about the palm normal
          spread = Math.atan2(palm.dot(midDir.clone().cross(dir)), midDir.dot(dir));
          splay = palm.clone().applyQuaternion(toLocal);
        }
        joints.push({ o, rest: o.quaternion.clone(), curl: axis.normalize().applyQuaternion(toLocal), splay, spread, f, k });
      }));
      const cur = new Float32Array(15), tgt = new Float32Array(15);
      if (joints.length) this.hands[side] = { joints, cur, tgt, close: 0, closeTgt: 0 };
    }
  }

  /** side 0 = left, 1 = right; `squeeze` curls the index further in (a trigger pull) */
  set(side: 0 | 1, grip: Grip, squeeze = 0) {
    const h = this.hands[side]; if (!h) return;
    const c = CURL[grip];
    for (let f = 0; f < 5; f++) for (let k = 0; k < 3; k++) h.tgt[f * 3 + k] = c[f][k];
    if (squeeze > 0) { h.tgt[3] += 0.45 * squeeze; h.tgt[4] += 0.35 * squeeze; h.tgt[5] += 0.2 * squeeze; }
    h.closeTgt = CLOSE[grip];
  }

  /** blend toward the targets (rate: 1/s; ~20 = a snap into a grip) and pose the joints */
  update(dt: number, rate = 20) {
    const u = this.first ? 1 : Math.min(1, dt * rate);
    this.first = false;
    for (const h of this.hands) {
      if (!h) continue;
      for (let i = 0; i < 15; i++) h.cur[i] += (h.tgt[i] - h.cur[i]) * u;
      h.close += (h.closeTgt - h.close) * u;
      for (const j of h.joints) {
        _q.copy(j.rest);
        if (j.splay) _q.multiply(_q2.setFromAxisAngle(j.splay, -j.spread * h.close));
        j.o.quaternion.copy(_q.multiply(_q2.setFromAxisAngle(j.curl, h.cur[j.f * 3 + j.k])));
      }
    }
  }
}

/** each hero's hands holding their weapon, [left, right] */
const BASE: Record<string, [Grip, Grip]> = {
  raijin: ['fist', 'fist'], hayate: ['relaxed', 'fist'], yuzu: ['fist', 'hook'], seiran: ['fist', 'hook'],
  kaien: ['open', 'pinch'], mirei: ['relaxed', 'open'], nocturne: ['claw', 'claw'], hex: ['claw', 'claw'],
  kagemaru: ['pinch', 'fist'], enra: ['fist', 'fist'], haruto: ['fist', 'trigger'], tenkai: ['hammer', 'hammer'],
  gorgoth: ['fist', 'trigger'], gantetsu: ['trigger', 'trigger'], hibiki: ['relaxed', 'trigger'], hibiki_armor: ['relaxed', 'trigger'],
  tomoe: ['fist', 'trigger'],
};
const CASTERS = new Set(['kaien', 'mirei', 'nocturne', 'hex']);

/**
 * The grips for this moment: the weapon grip, overridden by what the hands are doing - open palms for casts and beams,
 * a clawed hand on a wall, the archer's string hand flicking open on the loose and pinching the next arrow out of the
 * quiver, a trigger squeeze on each shot, a loose hand in death. `fp`: the first-person viewmodel (the off hand's own
 * placement differs from the world model's).
 */
export function gripsFor(a: Actor, t: number, o: { drawW?: number; fp?: boolean } = {}): { L: Grip; R: Grip; sqL: number; sqR: number; rate: number } {
  const id = a.def.id;
  let [L, R] = BASE[id] ?? (['relaxed', 'relaxed'] as [Grip, Grip]);
  let sqL = 0, sqR = 0, rate = 20;
  if (!a.alive) return { L: 'relaxed', R: 'relaxed', sqL, sqR, rate: 4 };
  if (a.has('knockdown', t)) return { L: 'relaxed', R: 'relaxed', sqL, sqR, rate: 12 };      // knocked flat: hands fall open
  const an = a.anim, atk = t - an.attackAt, cast = t - an.castAt;
  if (R === 'trigger') sqR = Math.max(0, 1 - (t - an.fireR) / 0.09);
  if (L === 'trigger') sqL = Math.max(0, 1 - (t - (id === 'gantetsu' ? an.fireL : an.fireR)) / 0.09);
  // Hayate: the koi shuriken pinched while the nodachi is sheathed (HeldProps.heldVisible)
  if (id === 'hayate' && !(a.has('dragonblade', t) || a.has('parry', t) || an.castId === 'currentdash' && cast < 0.45 || an.castId === 'dragongate' && cast < 1.4
    || (an.attackKind === 'punch' || an.attackKind === 'secondary') && atk < 0.5)) R = 'pinch';
  // archers: hook on the string; the loose flicks the fingers open, the reach to the quiver pinches the next arrow
  if (id === 'yuzu' || id === 'seiran') {
    const shot = an.attackKind === 'primary' || an.attackKind === 'secondary';
    if (shot && atk < ARROW_GONE[0] + 0.12) R = 'open';
    else if (shot && atk < ARROW_GONE[1] - 0.12) R = 'relaxed';
    else if (shot && atk < ARROW_GONE[1] + 0.05) R = 'pinch';
    else if (!o.fp && (o.drawW ?? 1) < 0.3 && !a.charging) R = 'relaxed';
  }
  // casts: casters open their palms (both), everyone's free hand opens for the gesture
  if (an.castId && cast < 0.55) {
    if (CASTERS.has(id)) { L = 'open'; R = id === 'kaien' ? 'pinch' : 'open'; }
    else if (L === 'relaxed') L = 'open';
  }
  if (a.beamOn || a.flameOn) { L = 'open'; if (CASTERS.has(id) || id === 'enra') R = 'open'; }
  // a reload: the off hand grabs the magazine
  if (a.reloadUntil > t && L !== 'trigger') L = 'claw';
  // quick melee jab with the off hand
  if (an.attackKind === 'punch' && atk < 0.45) L = 'fist';
  // hands on the wall
  if (a.has('wallclimb', t)) { L = 'claw'; if (R === 'relaxed' || R === 'open') R = 'claw'; }
  return { L, R, sqL, sqR, rate };
}

/** convenience: pose a Fingers rig for this actor */
export function driveFingers(f: Fingers | null, a: Actor, t: number, dt: number, o: { drawW?: number; fp?: boolean } = {}) {
  if (!f) return;
  const g = gripsFor(a, t, o);
  f.set(0, g.L, g.sqL); f.set(1, g.R, g.sqR);
  f.update(dt, g.rate);
}
