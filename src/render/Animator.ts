// Procedural animation for the shared humanoid rig (Blender auto-rig and the fallback mannequin use the same bone names).
// Everything is solved in MODEL space (Y up, +Z forward, +X = character's left) as a delta on top of the rest pose:
//  - legs: 2-bone IK toward foot targets driven by a distance-based gait phase, so planted feet never slide
//  - spine/neck/head: FK lean + aim pitch; arms: swing, or IK toward the aim line when attacking / casting
//  - flyers: body lean into velocity, dangling legs, flapping wing bones; mechs: slow heavy stride with stomp events
import * as THREE from 'three';

export const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head',
  'shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L', 'shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R',
  'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R', 'wing_L', 'wing_R',
  'hair_B_1', 'hair_B_2', 'hair_B_3', 'hair_L_1', 'hair_L_2', 'hair_L_3', 'hair_R_1', 'hair_R_2', 'hair_R_3',
  'skirt_B_1', 'skirt_B_2', 'skirt_B_3', 'skirt_F_1', 'skirt_F_2', 'skirt_F_3'] as const;
type BoneName = typeof BONES[number];
/** spring chains: [segment1, segment2, tip marker, parent, stiffness, damping, max angle (rad)] */
const CHAINS: [BoneName, BoneName, BoneName, BoneName, number, number, number][] = [
  ['hair_B_1', 'hair_B_2', 'hair_B_3', 'head', 0.14, 0.84, 0.8], ['hair_L_1', 'hair_L_2', 'hair_L_3', 'head', 0.14, 0.84, 0.8], ['hair_R_1', 'hair_R_2', 'hair_R_3', 'head', 0.14, 0.84, 0.8],
  ['skirt_B_1', 'skirt_B_2', 'skirt_B_3', 'hips', 0.26, 0.8, 0.45], ['skirt_F_1', 'skirt_F_2', 'skirt_F_3', 'hips', 0.32, 0.78, 0.35],
];
const CHILD: Partial<Record<BoneName, BoneName>> = {
  hair_B_1: 'hair_B_2', hair_B_2: 'hair_B_3', hair_L_1: 'hair_L_2', hair_L_2: 'hair_L_3', hair_R_1: 'hair_R_2', hair_R_2: 'hair_R_3',
  skirt_B_1: 'skirt_B_2', skirt_B_2: 'skirt_B_3', skirt_F_1: 'skirt_F_2', skirt_F_2: 'skirt_F_3',
  hips: 'spine', spine: 'chest', chest: 'neck', neck: 'head', shoulder_L: 'upperarm_L', upperarm_L: 'forearm_L', forearm_L: 'hand_L',
  shoulder_R: 'upperarm_R', upperarm_R: 'forearm_R', forearm_R: 'hand_R', thigh_L: 'shin_L', shin_L: 'foot_L', thigh_R: 'shin_R', shin_R: 'foot_R',
};

export interface AnimState {
  dt: number; time: number;
  vel: THREE.Vector3;       // world velocity
  yaw: number; pitch: number;
  grounded: boolean; flying: boolean; frame: string;
  attackAge: number; attackKind: string; castAge: number; castId: string; hitAge: number; landAge: number; jumpAge: number;
  stunned: boolean; charging: boolean; beam: boolean; barrier: boolean; rooted: boolean;
  melee?: boolean;          // primary is a melee weapon (bigger swings, lunges)
  scale: number;            // world metres per model unit
  pos: THREE.Vector3;       // actor world position (feet)
}

interface Rest { q: THREE.Quaternion; p: THREE.Vector3; dir: THREE.Vector3; }

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const rot = (axis: THREE.Vector3, a: number) => new THREE.Quaternion().setFromAxisAngle(axis, a);

export class Animator {
  bones: Partial<Record<BoneName, THREE.Object3D>> = {};
  rest: Partial<Record<BoneName, Rest>> = {};
  parentQ = new Map<THREE.Object3D, THREE.Quaternion>();   // model-space rotation of non-rig parents
  hipsParentInv = new THREE.Matrix3();
  hipsRestLocal = new THREE.Vector3();
  legLen = 1; thigh = 0.5; shin = 0.5; hipW = 0.1; hipH = 1; footY = 0.05; armLen = 0.6; height = 1.8;
  phase = 0;                   // gait phase in cycles
  foot = [new THREE.Vector3(), new THREE.Vector3()];   // current foot targets (model space)
  lean = new THREE.Vector2();  // smoothed lean
  bob = 0; landDip = 0; flap = 0; moveBlend = 0; airBlend = 0; flyBlend = 0; atk = 0; cast = 0;
  onStep: ((side: number, heavy: boolean) => void) | null = null;
  ok = false;
  private lastStance = [true, true];
  plant: (THREE.Vector3 | null)[] = [null, null];                // world-space planted foot positions
  private swingFrom: (THREE.Vector3 | null)[] = [null, null];
  private restepT = [0, 0];
  // dynamic layer (springs)
  private hipYaw = 0; private hipYawV = 0; private lastYaw = 0; private turnRoll = 0;
  private leanV = new THREE.Vector2(); private flinch = 0; private flinchV = 0; private lastHitAge = 9; private flinchDir = 1;
  private recoil = 0; private recoilV = 0; private lastAtkAge = 9; private readyW = 0;
  // spring chain state: world-space tip + previous tip per chain segment
  private spring = new Map<string, { tip: THREE.Vector3; prev: THREE.Vector3 }>();
  private posCache = new Map<string, THREE.Vector3>();
  private hipsOffNow = new THREE.Vector3();

  /** current model-space position of a bone head (FK from the deltas applied this frame) */
  private modelPos(n: BoneName): THREE.Vector3 {
    const c = this.posCache.get(n); if (c) return c;
    const R = this.rest[n]!;
    let p: THREE.Vector3;
    if (n === 'hips' || !this.bones[n]?.parent) p = R.p.clone().add(this.hipsOffNow);
    else {
      const parObj = this.bones[n]!.parent!;
      const parName = (Object.keys(this.bones) as BoneName[]).find(k => this.bones[k] === parObj);
      if (!parName || !this.rest[parName]) p = R.p.clone().add(this.hipsOffNow);
      else {
        const pq = this.modelQ.get(parObj) ?? this.rest[parName]!.q;
        const delta = pq.clone().multiply(this.rest[parName]!.q.clone().invert());
        p = this.modelPos(parName).clone().add(R.p.clone().sub(this.rest[parName]!.p).applyQuaternion(delta));
      }
    }
    this.posCache.set(n, p);
    return p;
  }

  private springs(s: AnimState, dt: number) {
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    const toW = (m: THREE.Vector3) => new THREE.Vector3(s.pos.x + (m.x * cy + m.z * sy) * s.scale, s.pos.y + m.y * s.scale, s.pos.z + (-m.x * sy + m.z * cy) * s.scale);
    const dirToM = (w: THREE.Vector3) => new THREE.Vector3(w.x * cy - w.z * sy, w.y, w.x * sy + w.z * cy).normalize();
    const f = dt * 60;
    for (const [b1, b2, b3, par, stiff, damp, maxA] of CHAINS) {
      if (!this.bones[b1] || !this.rest[b1] || !this.rest[b2]) continue;
      for (const [seg, next] of [[b1, b2], [b2, b3]] as [BoneName, BoneName][]) {
        const R = this.rest[seg]!, Rn = this.rest[next];
        if (!Rn) continue;
        const len = R.p.distanceTo(Rn.p) * s.scale;
        const parObj = this.bones[seg]!.parent!;
        const parName = (Object.keys(this.bones) as BoneName[]).find(k => this.bones[k] === parObj) ?? (seg === b1 ? par : b1);
        if (!this.rest[parName]) continue;
        const pq = this.modelQ.get(parObj) ?? this.rest[parName]!.q;
        const base = pq.clone().multiply(this.rest[parName]!.q.clone().invert());
        const headW = toW(this.modelPos(seg));
        const rigidDirM = R.dir.clone().applyQuaternion(base);
        const rigidDirW = new THREE.Vector3(rigidDirM.x * cy + rigidDirM.z * sy, rigidDirM.y, -rigidDirM.x * sy + rigidDirM.z * cy);
        const target = headW.clone().addScaledVector(rigidDirW, len);
        let st = this.spring.get(seg);
        if (!st || st.tip.distanceTo(target) > len * 3) { st = { tip: target.clone(), prev: target.clone() }; this.spring.set(seg, st); }
        if (dt > 0) {
          const vel = st.tip.clone().sub(st.prev).multiplyScalar(Math.pow(damp, f));
          st.prev.copy(st.tip);
          st.tip.add(vel);
          st.tip.y -= 9.8 * 0.35 * dt * dt * 60;                             // gravity (scaled for readable sway)
          st.tip.x -= s.vel.x * dt * 0.2; st.tip.z -= s.vel.z * dt * 0.2;      // air drag while moving / flying
          st.tip.lerp(target, 1 - Math.pow(1 - stiff, f));
          // cloth collides with the legs (thigh-to-ankle capsules) instead of passing through them
          if (seg.startsWith('skirt') && this.bones.thigh_L && this.bones.foot_L) {
            const r = this.legLen * 0.17 * s.scale;
            for (const L of ['L', 'R'] as const) {
              const A = toW(this.modelPos(`thigh_${L}` as BoneName)), B = toW(this.modelPos(`foot_${L}` as BoneName));
              const AB = B.clone().sub(A), t = Math.max(0, Math.min(1, st.tip.clone().sub(A).dot(AB) / Math.max(1e-6, AB.lengthSq())));
              const C = A.addScaledVector(AB, t), d = st.tip.clone().sub(C), dl = d.length();
              if (dl < r) st.tip.copy(C).addScaledVector(dl > 1e-5 ? d.divideScalar(dl) : rigidDirW, r);
            }
          }
          // keep segment length, and never swing further than maxA from the rigid pose
          const d = st.tip.clone().sub(headW);
          let dir = d.lengthSq() > 1e-8 ? d.normalize() : rigidDirW.clone();
          const ang = dir.angleTo(rigidDirW);
          if (ang > maxA) dir = rigidDirW.clone().lerp(dir, maxA / ang).normalize();
          st.tip.copy(headW).addScaledVector(dir, len);
        }
        this.aimBone(seg, dirToM(st.tip.clone().sub(headW)), base);
        // only this chain's downstream bones moved: invalidate just those cache entries
        this.posCache.delete(next); if (seg === b1) this.posCache.delete(b3);
      }
    }
  }

  constructor(public model: THREE.Object3D) {
    model.traverse(o => {
      const n = o.name.replace(/\./g, '_') as BoneName;
      if ((BONES as readonly string[]).includes(n) && !this.bones[n]) this.bones[n] = o;
    });
    const need: BoneName[] = ['hips', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R', 'chest', 'head'];
    this.ok = need.every(n => this.bones[n]);
    if (this.ok) this.bind();
  }

  private bind() {
    const m = this.model;
    const inv = new THREE.Matrix4().copy(m.matrixWorld).invert();
    m.updateMatrixWorld(true);
    inv.copy(m.matrixWorld).invert();
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (const n of BONES) {
      const b = this.bones[n]; if (!b) continue;
      new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld).decompose(pos, q, s);
      this.rest[n] = { q: q.clone(), p: pos.clone(), dir: new THREE.Vector3(0, 1, 0) };
      // parents that aren't rig bones: remember their (static) model-space rotation
      const par = b.parent;
      if (par && !this.parentQ.has(par)) {
        new THREE.Matrix4().multiplyMatrices(inv, par.matrixWorld).decompose(pos, q, s);
        this.parentQ.set(par, q.clone());
      }
    }
    for (const n of BONES) {
      const r = this.rest[n]; if (!r) continue;
      const c = CHILD[n];
      if (c && this.rest[c]) r.dir.copy(this.rest[c]!.p).sub(r.p).normalize();
      else if (n.startsWith('foot')) r.dir.set(0, -0.2, 1).normalize();
      else if (n.startsWith('hand')) r.dir.copy(this.rest[n.replace('hand', 'forearm') as BoneName]?.dir ?? Y);
      else if (n.startsWith('wing')) r.dir.set(n.endsWith('L') ? 1 : -1, 0.3, -0.3).normalize();
      else if (n === 'head') r.dir.set(0, 1, 0);
    }
    const R = this.rest as Record<BoneName, Rest>;
    this.thigh = R.thigh_L.p.distanceTo(R.shin_L.p);
    this.shin = R.shin_L.p.distanceTo(R.foot_L.p);
    this.legLen = this.thigh + this.shin;
    this.hipW = Math.abs(R.thigh_L.p.x - R.thigh_R.p.x) / 2;
    this.hipH = R.hips.p.y;
    this.footY = (R.foot_L.p.y + R.foot_R.p.y) / 2;
    this.height = R.head.p.y * 1.08;
    if (R.upperarm_L && R.hand_L) this.armLen = R.upperarm_L.p.distanceTo(R.forearm_L.p) + R.forearm_L.p.distanceTo(R.hand_L.p);
    const hp = this.bones.hips!.parent!;
    const pm = new THREE.Matrix4().multiplyMatrices(inv, hp.matrixWorld);
    this.hipsParentInv.setFromMatrix4(pm).invert();
    this.hipsRestLocal.copy(this.bones.hips!.position);
    this.foot[0].set(R.foot_L.p.x, this.footY, R.foot_L.p.z);
    this.foot[1].set(R.foot_R.p.x, this.footY, R.foot_R.p.z);
  }

  /** model-space rotation currently applied to a bone's parent */
  private modelQ = new Map<THREE.Object3D, THREE.Quaternion>();
  private setModelQ(n: BoneName, Qm: THREE.Quaternion) {
    const b = this.bones[n]; if (!b) return;
    const par = b.parent!;
    const pq = this.modelQ.get(par) ?? this.parentQ.get(par) ?? new THREE.Quaternion();
    b.quaternion.copy(pq).invert().multiply(Qm);
    this.modelQ.set(b, Qm.clone());
  }
  /** delta D (model space) applied on top of the rest orientation */
  private applyDelta(n: BoneName, D: THREE.Quaternion) {
    const r = this.rest[n]; if (!r) return;
    this.setModelQ(n, _q.copy(D).multiply(r.q));
  }
  /** rotate a bone so its rest direction points along `dir` (model space), keeping twist minimal */
  private aimBone(n: BoneName, dir: THREE.Vector3, base?: THREE.Quaternion): THREE.Quaternion {
    const r = this.rest[n]; if (!r) return new THREE.Quaternion();
    const from = base ? _v3.copy(r.dir).applyQuaternion(base) : r.dir;
    const D = new THREE.Quaternion().setFromUnitVectors(_v2.copy(from).normalize(), _v.copy(dir).normalize());
    if (base) D.multiply(base);
    this.applyDelta(n, D);
    return D;
  }

  /** 2-bone IK: returns [upperDir, lowerDir] model space */
  private ik(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
    const d = _v.copy(target).sub(root);
    let len = d.length();
    const maxL = (l1 + l2) * 0.999;
    if (len > maxL) { d.multiplyScalar(maxL / len); len = maxL; }
    len = Math.max(len, Math.abs(l1 - l2) + 1e-3);
    const dir = d.clone().normalize();
    const a = (l1 * l1 - l2 * l2 + len * len) / (2 * len);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const pd = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
    if (pd.lengthSq() < 1e-6) pd.set(0, 0, 1); pd.normalize();
    const knee = root.clone().add(dir.clone().multiplyScalar(a)).add(pd.multiplyScalar(h));
    const end = root.clone().add(d);
    return [knee.clone().sub(root).normalize(), end.sub(knee).normalize()];
  }

  update(s: AnimState) {
    if (!this.ok) return;
    const R = this.rest as Record<BoneName, Rest>;
    const dt = Math.min(0.05, s.dt);
    this.modelQ.clear();
    const heavy = s.frame === 'mech';
    const flyer = s.frame === 'flyer';
    // velocity in model space (character faces +Z at its yaw)
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    const lvx = (s.vel.x * cy - s.vel.z * sy) / s.scale, lvz = (s.vel.x * sy + s.vel.z * cy) / s.scale;
    // rig units: the model is scaled to hero height, so convert m/s into model units
    const k = this.height / Math.max(0.5, s.scale);
    void k;
    const speed = Math.hypot(lvx, lvz);
    const moving = s.grounded && speed > 0.4 && !s.rooted ? 1 : 0;
    this.moveBlend += (moving - this.moveBlend) * Math.min(1, dt * 10);
    this.airBlend += ((s.grounded ? 0 : 1) - this.airBlend) * Math.min(1, dt * 8);
    this.flyBlend += ((s.flying ? 1 : 0) - this.flyBlend) * Math.min(1, dt * 5);
    this.atk = Math.max(0, 1 - s.attackAge / (s.attackKind === 'secondary' || s.attackKind === 'lance' ? 0.45 : 0.3));
    this.cast = Math.max(0, 1 - s.castAge / 0.55);
    this.landDip = Math.max(0, 1 - s.landAge / 0.3) * (heavy ? 0.14 : 0.1);
    // ---------------- lower-body yaw: legs face where we move, the torso twists back to the aim (hero-shooter strafing)
    {
      let mv = speed > 0.6 && moving ? Math.atan2(lvx, lvz) : 0;
      if (Math.abs(mv) > 1.95) mv -= Math.sign(mv) * Math.PI;          // backpedal: legs face forward, walk backwards
      const target = Math.max(-1.05, Math.min(1.05, mv)) * this.moveBlend;
      const yawRate = (() => { let d = s.yaw - this.lastYaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return dt > 0 ? d / dt : 0; })();
      this.lastYaw = s.yaw;
      // when turning in place the legs lag behind the torso for a beat
      this.hipYawV += ((target - this.hipYaw) * 90 - this.hipYawV * 14) * dt;
      this.hipYaw += this.hipYawV * dt - (this.moveBlend < 0.5 ? yawRate * dt * 0.35 : 0);
      this.hipYaw = Math.max(-1.2, Math.min(1.2, this.hipYaw)) * (this.moveBlend < 0.1 ? 0.97 : 1);
      this.turnRoll += (Math.max(-0.22, Math.min(0.22, -yawRate * 0.04 * this.moveBlend)) - this.turnRoll) * Math.min(1, dt * 8);
    }
    // ---------------- gait. Feet are LOCKED IN WORLD SPACE while planted (no sliding when the body turns or
    // changes speed); each swing lands on the spot the stride predicts. Phase advances with distance travelled.
    // faster = higher cadence + shorter stance, not longer reach: a planted foot must stay inside the leg's range
    const run = Math.min(1, speed / (this.legLen * 7));
    const stride = this.legLen * (heavy ? 0.6 + 0.4 * run : 0.55 + 0.55 * run);
    const duty = heavy ? 0.6 - 0.1 * run : 0.62 - 0.22 * run;
    const cycleLen = stride * 2;                    // one cycle = a left and a right step
    const travel = cycleLen * duty;                 // how far the body moves over a planted foot
    this.phase += (speed * dt) / cycleLen * (moving ? 1 : 0);
    const md = speed > 0.01 ? _v2.set(lvx / speed, 0, lvz / speed).clone() : new THREE.Vector3(0, 0, 1);
    const lift = this.legLen * (heavy ? 0.16 : 0.22) * Math.min(1, speed / 3 + 0.3);
    const hipsOff = new THREE.Vector3();
    const toModel = (w: THREE.Vector3) => { const dx = (w.x - s.pos.x) / s.scale, dz = (w.z - s.pos.z) / s.scale; return new THREE.Vector3(dx * cy - dz * sy, (w.y - s.pos.y) / s.scale, dx * sy + dz * cy); };
    const toWorld = (m: THREE.Vector3) => new THREE.Vector3(s.pos.x + (m.x * cy + m.z * sy) * s.scale, s.pos.y + m.y * s.scale, s.pos.z + (-m.x * sy + m.z * cy) * s.scale);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      // feet sit under the hips, which turn toward the movement direction (lower-body yaw)
      const restFoot = new THREE.Vector3(side * this.hipW * 1.05, this.footY, (i === 0 ? R.foot_L : R.foot_R).p.z).applyAxisAngle(Y, this.hipYaw);
      const ph = ((this.phase + i * 0.5) % 1 + 1) % 1;
      let tgt: THREE.Vector3;
      if (!s.grounded || this.airBlend > 0.5) {
        this.plant[i] = null;
        tgt = restFoot.clone();
      } else if (moving) {
        const stance = ph < duty;
        if (stance) {
          if (!this.plant[i]) {
            // touch-down: plant where the stride says this foot lands, then keep it there in the world
            const land = restFoot.clone().addScaledVector(md, travel * (0.5 - ph / duty));
            this.plant[i] = toWorld(land); this.plant[i]!.y = s.pos.y + this.footY * s.scale;
            this.onStep?.(i, heavy);
          }
          tgt = toModel(this.plant[i]!);
        } else {
          // swing: from lift-off toward the predicted landing spot, with a lift arc
          const u = (ph - duty) / (1 - duty);
          if (this.plant[i]) { this.swingFrom[i] = toModel(this.plant[i]!); this.plant[i] = null; }
          const from = this.swingFrom[i] ?? restFoot.clone().addScaledVector(md, -travel / 2);
          const land = restFoot.clone().addScaledVector(md, travel / 2);
          const k = u * u * (3 - 2 * u);
          tgt = from.clone().lerp(land, k);
          tgt.y = this.footY + Math.sin(u * Math.PI) * lift;
          // swingFrom is in model space of lift-off; body has moved since, so correct by the distance covered
          this.swingFrom[i] = from.addScaledVector(md, -(speed * dt));
        }
        this.lastStance[i] = stance;
      } else {
        // standing: feet stay put in the world; re-step if the body turned or drifted too far from them
        if (!this.plant[i]) { this.plant[i] = toWorld(restFoot); this.plant[i]!.y = s.pos.y + this.footY * s.scale; }
        let m = toModel(this.plant[i]!);
        if (m.distanceTo(restFoot) > this.legLen * 0.32 && this.restepT[i] <= 0 && this.restepT[1 - i] <= 0) { this.restepT[i] = 0.22; this.swingFrom[i] = m.clone(); }
        if (this.restepT[i] > 0) {
          this.restepT[i] -= dt;
          const u = 1 - Math.max(0, this.restepT[i]) / 0.22;
          m = this.swingFrom[i]!.clone().lerp(restFoot, u); m.y = this.footY + Math.sin(u * Math.PI) * lift * 0.5;
          if (this.restepT[i] <= 0) { this.plant[i] = toWorld(restFoot); this.plant[i]!.y = s.pos.y + this.footY * s.scale; this.onStep?.(i, heavy); }
        }
        tgt = m;
      }
      // airborne: knees up (jump), trailing dangle (flying)
      if (this.airBlend > 0.01) {
        const tuck = flyer ? 0.25 : Math.max(0, Math.min(1, (s.vel.y + 4) / 10));
        const air = new THREE.Vector3(side * this.hipW * 1.1, this.footY + this.legLen * (0.35 * tuck + 0.1), (flyer ? -0.25 : i === 0 ? 0.15 : -0.05) * this.legLen);
        if (flyer) { air.y += Math.sin(s.time * 2.2 + i) * 0.03 * this.legLen; air.z += Math.sin(s.time * 1.7 + i * 2) * 0.05 * this.legLen; }
        tgt.lerp(air, this.airBlend);
      }
      // never reach further than the leg allows (keeps IK stable on hard stops)
      const off = tgt.clone().sub(restFoot); off.y = 0;
      const maxOff = this.legLen * 0.75;
      if (off.length() > maxOff) { tgt.sub(off).add(off.setLength(maxOff)); this.plant[i] = null; }
      this.foot[i].copy(tgt);
    }
    // body bob: lowest at mid-stance (twice per cycle)
    const bobPh = this.phase * 2 * Math.PI * 2;
    this.bob = (Math.cos(bobPh) * 0.5 - 0.5) * this.legLen * (heavy ? 0.06 : 0.035) * this.moveBlend;
    // combat stance: knees soft, weight low; melee heroes lunge into their swings
    const stance = (1 - this.moveBlend) * (1 - this.airBlend) * (heavy ? 0.03 : 0.045);
    const lunge = s.melee ? Math.sin(Math.min(1, this.atk) * Math.PI) * 0.12 * this.legLen : 0;
    hipsOff.y = this.bob - this.landDip * this.legLen - (s.charging ? 0.04 * this.legLen : 0) - stance * this.legLen - lunge * 0.3;
    hipsOff.z += lunge;
    if (s.barrier) hipsOff.y -= 0.06 * this.legLen;
    // lean into velocity with a damped spring (overshoots when you stop or turn) + roll into turns
    const leanTarget = new THREE.Vector2(
      Math.max(-1, Math.min(1, lvx / 8)) * (flyer && s.flying ? 0.35 : 0.14) + this.turnRoll,
      Math.max(-1, Math.min(1, lvz / 8)) * (flyer && s.flying ? 0.45 : heavy ? 0.1 : 0.18));
    this.leanV.x += ((leanTarget.x - this.lean.x) * 70 - this.leanV.x * 9) * dt;
    this.leanV.y += ((leanTarget.y - this.lean.y) * 70 - this.leanV.y * 9) * dt;
    this.lean.x += this.leanV.x * dt; this.lean.y += this.leanV.y * dt;
    // hit flinch + weapon recoil: impulses into springs
    if (s.hitAge < this.lastHitAge) { this.flinchV += 7; this.flinchDir = Math.random() < 0.5 ? -1 : 1; }
    this.lastHitAge = s.hitAge;
    this.flinchV += (-this.flinch * 160 - this.flinchV * 14) * dt; this.flinch += this.flinchV * dt;
    if (s.attackAge < this.lastAtkAge && !s.melee) this.recoilV += heavy ? 3 : 5;
    this.lastAtkAge = s.attackAge;
    this.recoilV += (-this.recoil * 220 - this.recoilV * 16) * dt; this.recoil += this.recoilV * dt;
    const hipSway = Math.sin(this.phase * 2 * Math.PI) * (heavy ? 0.09 : 0.06) * this.moveBlend;
    const idleShift = Math.sin(s.time * 0.55) * 0.03 * (1 - this.moveBlend);
    const stepRoll = heavy ? Math.sin(this.phase * 2 * Math.PI) * 0.05 * this.moveBlend : 0;   // mechs rock side to side per stomp
    // ---------------- hips (face the movement direction)
    const Dh = rot(Y, this.hipYaw + hipSway).premultiply(rot(X, this.lean.y * 0.4)).premultiply(rot(Z, -this.lean.x * 0.5 + idleShift + stepRoll));
    if (s.stunned) Dh.premultiply(rot(Z, Math.sin(s.time * 9) * 0.06));
    this.applyDelta('hips', Dh);
    const hb = this.bones.hips!;
    hb.position.copy(this.hipsRestLocal).add(_v.copy(hipsOff).applyMatrix3(this.hipsParentInv));
    // ---------------- spine chain (unwinds the hip yaw so the chest faces the aim)
    const aimP = -s.pitch;   // pitch up = negative X rotation in this frame
    const breath = Math.sin(s.time * 1.6) * 0.015;
    const twist = this.atk * (s.melee || s.attackKind === 'secondary' ? -0.55 : -0.12);
    const Ds = Dh.clone().multiply(rot(X, this.lean.y * 0.5 + aimP * 0.2 - this.flinch * 0.6 + breath + this.cast * 0.1 + stance * 1.2)).multiply(rot(Y, -(this.hipYaw + hipSway) * 0.45 + twist * 0.4)).multiply(rot(Z, this.flinch * 0.4 * this.flinchDir));
    if (this.bones.spine) this.applyDelta('spine', Ds);
    const Dc = Ds.clone().multiply(rot(X, aimP * 0.3 - this.flinch * 0.4 - this.recoil * 0.9 + breath)).multiply(rot(Y, -(this.hipYaw + hipSway) * 0.55 + twist * 0.6 - idleShift * 0.5));
    this.applyDelta('chest', Dc);
    const Dn = Dc.clone().multiply(rot(X, aimP * 0.2));
    if (this.bones.neck) this.applyDelta('neck', Dn);
    // the head keeps the eyes on the aim and glances around when idle
    const look = Math.sin(s.time * 0.37) * 0.12 * (1 - this.moveBlend) * (1 - Math.min(1, this.atk * 3));
    const Dhd = Dn.clone().multiply(rot(Y, look - twist * 0.5)).multiply(rot(X, aimP * 0.3 + this.recoil * 0.3 + Math.sin(s.time * 0.7) * 0.02));
    this.applyDelta('head', Dhd);
    // ---------------- legs (IK)
    const hipsPos = R.hips.p.clone().add(hipsOff);
    for (let i = 0; i < 2; i++) {
      const L = i === 0 ? 'L' : 'R';
      const th = R[`thigh_${L}` as BoneName], sh = R[`shin_${L}` as BoneName];
      const hipJ = th.p.clone().sub(R.hips.p).applyQuaternion(Dh).add(hipsPos);
      const ft = this.foot[i].clone(); ft.y = Math.max(ft.y, this.footY * 0.6);
      const pole = new THREE.Vector3(0, 0, 1).applyQuaternion(Dh);
      const [ud, ld] = this.ik(hipJ, ft, this.thigh, this.shin, pole);
      const Dt = this.aimBone(`thigh_${L}` as BoneName, ud);
      void sh;
      this.aimBone(`shin_${L}` as BoneName, ld);
      void Dt;
      // feet stay level with the ground, toes pitch a little during swing
      const toe = (this.foot[i].y - this.footY) / Math.max(1e-3, this.legLen) * -1.2;
      this.applyDelta(`foot_${L}` as BoneName, rot(X, toe).premultiply(rot(Y, hipSway * 0.3)));
    }
    // ---------------- arms
    const armSwing = Math.sin(this.phase * 2 * Math.PI) * (heavy ? 0.25 : 0.4) * this.moveBlend * Math.min(1, speed / 5 + 0.3);
    const aimDir = new THREE.Vector3(0, Math.sin(s.pitch), Math.cos(s.pitch)).normalize();
    for (let i = 0; i < 2; i++) {
      const L = i === 0 ? 'L' : 'R', side = i === 0 ? 1 : -1;
      const ua = `upperarm_${L}` as BoneName, fa = `forearm_${L}` as BoneName;
      if (!this.bones[ua] || !this.bones[fa]) continue;
      if (this.bones[`shoulder_${L}` as BoneName]) this.applyDelta(`shoulder_${L}` as BoneName, Dc);
      const shoulder = R[ua].p.clone().sub(R.chest.p).applyQuaternion(Dc).add(R.chest.p).add(hipsOff);
      const l1 = R[ua].p.distanceTo(R[fa].p), l2 = R[fa].p.distanceTo((R[`hand_${L}` as BoneName] ?? R[fa]).p) || l1;
      // relaxed pose: rest direction pulled 25% toward straight down, swung with the gait
      const restD = R[ua].dir.clone().applyQuaternion(Dc);
      const relaxed = restD.clone().lerp(new THREE.Vector3(side * 0.25, -1, 0.05), flyer && s.flying ? 0.05 : 0.3).normalize();
      relaxed.applyAxisAngle(new THREE.Vector3(side, 0, 0).applyQuaternion(Dc).normalize(), -armSwing * side * (i === 0 ? 1 : 1));
      if (flyer && s.flying) relaxed.applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.3 * this.flyBlend);
      // weapon-ready stance: elbows forward, hands up in front of the body; relaxes into arm swing at full sprint
      const readyW = (1 - 0.7 * run) * (1 - this.airBlend * 0.5) * (heavy ? 0.45 : 0.72) * (flyer && s.flying ? 0.35 : 1);
      relaxed.lerp(new THREE.Vector3(side * 0.3, -0.72, 0.62).applyQuaternion(Dc).normalize(), readyW).normalize();
      this.readyW = readyW;
      // attack / cast: reach along the aim line (right arm leads primaries, both for casts)
      const lead = i === 1 ? 1 : 0.35;
      const act = Math.max(this.atk * lead * (s.attackKind === 'secondary' && i === 0 ? 2.5 : 1), this.cast * 0.9, s.beam ? 0.9 * lead : 0, s.charging ? 1 * (i === 0 ? 1 : 0.8) : 0, s.barrier && i === 0 ? 1 : 0);
      if (act > 0.01) {
        const reach = aimDir.clone().multiplyScalar((l1 + l2) * (0.72 + 0.15 * Math.sin(Math.min(1, act) * Math.PI)));
        const hand = shoulder.clone().add(reach);
        hand.x += -side * (l1 + l2) * 0.25;             // hands converge toward the centre line
        if (s.attackKind === 'secondary' && this.atk > 0) hand.x += side * Math.sin(this.atk * Math.PI) * (l1 + l2) * 0.8;   // slash arc
        const [u, l] = this.ik(shoulder, hand, l1, l2, new THREE.Vector3(side * 0.4, -1, -0.6));
        const w = Math.min(1, act);
        const uD = relaxed.clone().lerp(u, w).normalize();
        const Du = this.aimBone(ua, uD);
        const lD = relaxed.clone().lerp(l, w).normalize();
        this.aimBone(fa, lD);
        void Du;
      } else {
        const Du = this.aimBone(ua, relaxed);
        // slight natural elbow bend
        // forearms bend up toward the centre line (holding the weapon / focus) in the ready stance
        const fore = new THREE.Vector3(-side * 0.35, -0.12, 1).applyQuaternion(Dc).normalize();
        const lD = relaxed.clone().lerp(fore, 0.18 + 0.15 * this.moveBlend + this.readyW * 0.55).normalize();
        this.aimBone(fa, lD);
        void Du;
      }
      const hn = `hand_${L}` as BoneName;
      if (this.bones[hn]) this.setModelQ(hn, (this.modelQ.get(this.bones[fa]!) ?? new THREE.Quaternion()).clone().multiply(_q2.copy(R[fa].q).invert()).multiply(R[hn].q));
    }
    // ---------------- wings
    if (this.bones.wing_L || this.bones.wing_R) {
      const rate = s.flying ? (s.vel.y > 1 ? 4.2 : 2.6) : 0.8;
      this.flap += dt * rate;
      const amp = s.flying ? (s.vel.y > 1 ? 0.55 : 0.35) : 0.08;
      const f = Math.sin(this.flap * 2 * Math.PI) * amp;
      const fold = (1 - this.flyBlend) * 0.35;
      for (const [n, side] of [['wing_L', 1], ['wing_R', -1]] as [BoneName, number][]) {
        if (!this.bones[n]) continue;
        this.applyDelta(n, Dc.clone().multiply(rot(Z, side * (f - fold))).multiply(rot(Y, side * fold * 0.6)));
      }
    }
    // ---------------- secondary motion: hair / coat tails / skirts
    this.hipsOffNow.copy(hipsOff); this.posCache.clear();
    this.springs(s, dt);
  }
}
