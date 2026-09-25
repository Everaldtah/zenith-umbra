// Synthetic source skeletons + clips for the retargeting tests. One canonical motion (a parametric walk in leg lengths,
// canonical frame: Y up, +Z forward, +X = character's left) is baked onto rigs that differ the way real packs do:
// bone names (Quaternius UAL / Mixamo / old Quaternius / Rigify), rest pose (T / A), units (m / cm), facing, Z-up
// armature wrappers and arbitrary bone rolls. A correct retargeter recovers the same canonical motion from all of them.
import * as THREE from 'three';

export type Joint = 'root' | 'hips' | 'spine1' | 'spine2' | 'chest' | 'neck' | 'head'
  | 'clav_L' | 'uarm_L' | 'farm_L' | 'hand_L' | 'clav_R' | 'uarm_R' | 'farm_R' | 'hand_R'
  | 'thigh_L' | 'shin_L' | 'foot_L' | 'toe_L' | 'thigh_R' | 'shin_R' | 'foot_R' | 'toe_R';
const PARENT: Record<Joint, Joint | null> = {
  root: null, hips: 'root', spine1: 'hips', spine2: 'spine1', chest: 'spine2', neck: 'chest', head: 'neck',
  clav_L: 'chest', uarm_L: 'clav_L', farm_L: 'uarm_L', hand_L: 'farm_L', clav_R: 'chest', uarm_R: 'clav_R', farm_R: 'uarm_R', hand_R: 'farm_R',
  thigh_L: 'hips', shin_L: 'thigh_L', foot_L: 'shin_L', toe_L: 'foot_L', thigh_R: 'hips', shin_R: 'thigh_R', foot_R: 'shin_R', toe_R: 'foot_R',
};
export const JOINTS = Object.keys(PARENT) as Joint[];
const LIMB_CHILD: Partial<Record<Joint, Joint>> = { uarm_L: 'farm_L', farm_L: 'hand_L', uarm_R: 'farm_R', farm_R: 'hand_R', thigh_L: 'shin_L', shin_L: 'foot_L', thigh_R: 'shin_R', shin_R: 'foot_R' };
const TORSO: Joint[] = ['hips', 'spine1', 'spine2', 'chest', 'neck', 'head', 'clav_L', 'clav_R', 'foot_L', 'foot_R', 'hand_L', 'hand_R', 'toe_L', 'toe_R'];

export const NAMES: Record<string, Record<Joint, string>> = {
  ual: { root: 'root', hips: 'pelvis', spine1: 'spine_01', spine2: 'spine_02', chest: 'spine_03', neck: 'neck_01', head: 'Head',
    clav_L: 'clavicle_l', uarm_L: 'upperarm_l', farm_L: 'lowerarm_l', hand_L: 'hand_l', clav_R: 'clavicle_r', uarm_R: 'upperarm_r', farm_R: 'lowerarm_r', hand_R: 'hand_r',
    thigh_L: 'thigh_l', shin_L: 'calf_l', foot_L: 'foot_l', toe_L: 'ball_l', thigh_R: 'thigh_r', shin_R: 'calf_r', foot_R: 'foot_r', toe_R: 'ball_r' },
  mixamo: { root: 'Armature_root', hips: 'mixamorigHips', spine1: 'mixamorigSpine', spine2: 'mixamorigSpine1', chest: 'mixamorigSpine2', neck: 'mixamorigNeck', head: 'mixamorigHead',
    clav_L: 'mixamorigLeftShoulder', uarm_L: 'mixamorigLeftArm', farm_L: 'mixamorigLeftForeArm', hand_L: 'mixamorigLeftHand', clav_R: 'mixamorigRightShoulder', uarm_R: 'mixamorigRightArm', farm_R: 'mixamorigRightForeArm', hand_R: 'mixamorigRightHand',
    thigh_L: 'mixamorigLeftUpLeg', shin_L: 'mixamorigLeftLeg', foot_L: 'mixamorigLeftFoot', toe_L: 'mixamorigLeftToeBase', thigh_R: 'mixamorigRightUpLeg', shin_R: 'mixamorigRightLeg', foot_R: 'mixamorigRightFoot', toe_R: 'mixamorigRightToeBase' },
  quat: { root: 'Root', hips: 'Hips', spine1: 'Abdomen', spine2: 'Torso', chest: 'Chest', neck: 'Neck', head: 'Head',
    clav_L: 'ShoulderL', uarm_L: 'UpperArmL', farm_L: 'LowerArmL', hand_L: 'FistL', clav_R: 'ShoulderR', uarm_R: 'UpperArmR', farm_R: 'LowerArmR', hand_R: 'FistR',
    thigh_L: 'UpperLegL', shin_L: 'LowerLegL', foot_L: 'FootL', toe_L: 'ToesL', thigh_R: 'UpperLegR', shin_R: 'LowerLegR', foot_R: 'FootR', toe_R: 'ToesR' },
};

export interface RigSpec { names: Record<Joint, string>; pose: 'T' | 'A'; unit: number; frameQ?: THREE.Quaternion; wrapQ?: THREE.Quaternion; wrapScale?: number; roll?: boolean; legScale?: number; }

/** canonical rest positions, leg lengths (thigh 0.5 + shin 0.5) */
function restCanon(pose: 'T' | 'A', legScale = 1): Record<Joint, THREE.Vector3> {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const P: Partial<Record<Joint, THREE.Vector3>> = {};
  const footY = 0.08, thighY = footY + 1.0, hipsY = thighY + 0.08;
  P.root = V(0, 0, 0); P.hips = V(0, hipsY, 0); P.spine1 = V(0, hipsY + 0.12, 0); P.spine2 = V(0, hipsY + 0.26, 0); P.chest = V(0, hipsY + 0.4, 0);
  P.neck = V(0, hipsY + 0.7, 0); P.head = V(0, hipsY + 0.8, 0);
  const armDir = pose === 'T' ? V(1, 0, 0) : V(Math.SQRT1_2, -Math.SQRT1_2, 0);
  for (const [S, s] of [['L', 1], ['R', -1]] as const) {
    P[`clav_${S}`] = V(s * 0.05, hipsY + 0.65, 0.02);
    P[`uarm_${S}`] = V(s * 0.2, hipsY + 0.65, 0);
    const ad = armDir.clone().multiply(V(s, 1, 1));
    P[`farm_${S}`] = P[`uarm_${S}`]!.clone().addScaledVector(ad, 0.55);
    P[`hand_${S}`] = P[`farm_${S}`]!.clone().addScaledVector(ad, 0.5);
    P[`thigh_${S}`] = V(s * 0.18, thighY, 0); P[`shin_${S}`] = V(s * 0.18, thighY - 0.5, 0.01); P[`foot_${S}`] = V(s * 0.18, footY, 0);
    P[`toe_${S}`] = V(s * 0.18, 0.01, 0.2);
  }
  for (const j of JOINTS) P[j]!.multiplyScalar(legScale);
  return P as Record<Joint, THREE.Vector3>;
}

// ---------------------------------------------------------------- canonical motion (leg units)
export interface Motion {
  duration: number; name: string;
  /** hips displacement from rest (leg units), torso deltas, limb directions, at time t */
  at(t: number): { hips: THREE.Vector3; torso: Partial<Record<Joint, THREE.Quaternion>>; dir: Partial<Record<Joint, THREE.Vector3>> };
}

function ik(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const d = target.clone().sub(root); let len = d.length();
  len = Math.min(len, (l1 + l2) * 0.999); const dir = d.clone().normalize();
  const a = (l1 * l1 - l2 * l2 + len * len) / (2 * len), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const pd = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  const knee = root.clone().addScaledVector(dir, a).addScaledVector(pd, h), end = root.clone().addScaledVector(dir, len);
  return [knee.clone().sub(root).normalize(), end.sub(knee).normalize()];
}

/**
 * walk / jog: travel `speed` leg lengths per second toward `angle` (0 = forward, +pi/2 = left); feet planted for
 * `duty` of each cycle, sliding backwards at exactly the travel speed. rootMotion: the hips move instead.
 */
export function gaitMotion(name: string, speed: number, angle: number, period = 1, duty = 0.6, rootMotion = false): Motion {
  const R = restCanon('T');
  const td = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
  const S = speed * period;
  return {
    duration: period, name,
    at(t: number) {
      const ph = t / period;
      const hips = new THREE.Vector3(0, -0.12 + 0.03 * Math.cos(ph * 4 * Math.PI), 0);   // knees soft: every stance foot stays in reach
      if (rootMotion) hips.addScaledVector(td, speed * t);
      const yaw = 0.12 * Math.sin(ph * 2 * Math.PI);
      const torso: Partial<Record<Joint, THREE.Quaternion>> = {};
      const qh = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const qc = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08, -yaw * 1.5, 0.03 * Math.sin(ph * 2 * Math.PI)));
      for (const j of ['hips', 'foot_L', 'foot_R', 'toe_L', 'toe_R'] as Joint[]) torso[j] = qh.clone();
      for (const j of ['spine1', 'spine2'] as Joint[]) torso[j] = qh.clone().slerp(qc, 0.5);
      for (const j of ['chest', 'neck', 'head', 'clav_L', 'clav_R', 'hand_L', 'hand_R'] as Joint[]) torso[j] = qc.clone();
      const dir: Partial<Record<Joint, THREE.Vector3>> = {};
      for (const [S_, s, i] of [['L', 1, 0], ['R', -1, 1]] as const) {
        const p = ((ph + i * 0.5) % 1 + 1) % 1;
        let off: number, lift = 0;
        if (p < duty) off = S * (0.5 * duty - p);
        else { const u = (p - duty) / (1 - duty); off = S * duty * (-0.5 + (u * u * (3 - 2 * u))); lift = Math.sin(u * Math.PI) * 0.15; }
        const foot = R[`foot_${S_}`].clone().addScaledVector(td, off); foot.y += lift;
        if (rootMotion) foot.addScaledVector(td, speed * t);
        const hipJ = R[`thigh_${S_}`].clone().sub(R.hips).applyQuaternion(qh).add(R.hips).add(hips);
        const [u, l] = ik(hipJ, foot, 0.5, 0.5, new THREE.Vector3(0, 0, 1));
        dir[`thigh_${S_}`] = u; dir[`shin_${S_}`] = l;
        const sw = 0.45 * Math.sin((ph + i * 0.5) * 2 * Math.PI) * s * s;
        const up = new THREE.Vector3(s * 0.15, -1, 0).normalize().applyAxisAngle(new THREE.Vector3(1, 0, 0), -sw);
        dir[`uarm_${S_}`] = up; dir[`farm_${S_}`] = up.clone().lerp(new THREE.Vector3(0, -0.2, 1), 0.35).normalize();
      }
      return { hips, torso, dir };
    },
  };
}

/** a stationary one-shot: the hips drop to the ground and the torso pitches back (a death) */
export function fallMotion(name: string, duration = 1.2): Motion {
  const g = gaitMotion('', 0.001, 0, 1);
  return {
    duration, name,
    at(t: number) {
      const k = Math.min(1, t / duration), b = g.at(0);
      b.hips.set(0, -0.9 * k * k, -0.3 * k);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -1.3 * k);
      for (const j of Object.keys(b.torso) as Joint[]) b.torso[j] = q.clone();
      return b;
    },
  };
}

export function idleMotion(name: string, duration = 2): Motion {
  const g = gaitMotion('', 0.001, 0, 1, 1);
  return { duration, name, at(t) { const b = g.at(0); b.hips.y = -0.02 + 0.01 * Math.sin(t / duration * 2 * Math.PI); return b; } };
}

// ---------------------------------------------------------------- rig building + baking to glTF-style clips
const rnd = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

export interface SrcRig { scene: THREE.Object3D; bones: Record<Joint, THREE.Bone>; spec: RigSpec; }

export function buildRig(spec: RigSpec, seed = 7): SrcRig {
  const R = restCanon(spec.pose, spec.legScale);
  const C = spec.frameQ ?? new THREE.Quaternion();
  const rand = rnd(seed);
  const scene = new THREE.Group(); scene.name = 'Scene';
  const arm = new THREE.Object3D(); arm.name = 'Armature';
  if (spec.wrapQ) arm.quaternion.copy(spec.wrapQ);
  arm.scale.setScalar(spec.wrapScale ?? 1);
  scene.add(arm);
  const bones = {} as Record<Joint, THREE.Bone>;
  const restQ = {} as Record<Joint, THREE.Quaternion>;           // rig-space rest orientation
  for (const j of JOINTS) {
    const b = new THREE.Bone(); b.name = spec.names[j]; bones[j] = b;
    restQ[j] = spec.roll && j !== 'root' ? new THREE.Quaternion(rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize() : new THREE.Quaternion();
  }
  const rs = (j: Joint) => R[j].clone().multiplyScalar(spec.unit).applyQuaternion(C);   // rig-space rest position
  for (const j of JOINTS) {
    const par = PARENT[j];
    const b = bones[j];
    if (!par) { arm.add(b); b.position.copy(rs(j)); b.quaternion.copy(restQ[j]); continue; }
    bones[par].add(b);
    b.position.copy(rs(j).sub(rs(par)).applyQuaternion(restQ[par].clone().invert()));
    b.quaternion.copy(restQ[par].clone().invert().multiply(restQ[j]));
  }
  // a skinned mesh so the scene looks like a real export (the retargeter must ignore it)
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial());
  mesh.name = 'Body';
  scene.add(mesh);
  scene.updateMatrixWorld(true);                 // bind AFTER the world matrices exist: the inverse bind matrices must be real
  mesh.bind(new THREE.Skeleton(JOINTS.map(j => bones[j])));
  (scene as any).__restQ = restQ;
  return { scene, bones, spec };
}

/** bake a canonical motion into a glTF-style AnimationClip on this rig (local quaternion tracks + hips translation) */
export function clipFor(rig: SrcRig, m: Motion, fps = 30): THREE.AnimationClip {
  const R = restCanon(rig.spec.pose, rig.spec.legScale);
  const C = rig.spec.frameQ ?? new THREE.Quaternion(), Ci = C.clone().invert();
  const restQ = (rig.scene as any).__restQ as Record<Joint, THREE.Quaternion>;
  const n = Math.round(m.duration * fps) + 1;
  const times: number[] = [];
  const qv: Record<string, number[]> = {}; const hp: number[] = [];
  for (let f = 0; f < n; f++) {
    const t = Math.min(m.duration, f / fps); times.push(t);
    const st = m.at(t);
    const Qrs = {} as Record<Joint, THREE.Quaternion>;
    for (const j of JOINTS) {
      let D = new THREE.Quaternion();
      const lc = LIMB_CHILD[j];
      if (lc && st.dir[j]) D.setFromUnitVectors(R[lc].clone().sub(R[j]).normalize(), st.dir[j]!);
      else if (st.torso[j]) D = st.torso[j]!.clone();
      Qrs[j] = C.clone().multiply(D).multiply(Ci).multiply(restQ[j]);
    }
    for (const j of JOINTS) {
      const par = PARENT[j];
      const local = par ? Qrs[par].clone().invert().multiply(Qrs[j]) : Qrs[j];
      (qv[j] ??= []).push(local.x, local.y, local.z, local.w);
    }
    const hpos = R.hips.clone().add(st.hips.clone().multiplyScalar(rig.spec.legScale ?? 1)).multiplyScalar(rig.spec.unit).applyQuaternion(C);
    const rootLocal = hpos.applyQuaternion(restQ.root.clone().invert());
    hp.push(rootLocal.x, rootLocal.y, rootLocal.z);
  }
  const tracks: THREE.KeyframeTrack[] = JOINTS.filter(j => j !== 'root').map(j => new THREE.QuaternionKeyframeTrack(`${rig.spec.names[j]}.quaternion`, times, qv[j]));
  tracks.push(new THREE.VectorKeyframeTrack(`${rig.spec.names.hips}.position`, times, hp));
  return new THREE.AnimationClip(m.name, m.duration, tracks);
}

/** the rig styles the tests run against */
export const STYLES: Record<string, RigSpec> = {
  ual: { names: NAMES.ual, pose: 'T', unit: 0.9 },
  mixamo: { names: NAMES.mixamo, pose: 'A', unit: 100 * 0.95, wrapScale: 0.01, legScale: 1.1, roll: true,
    wrapQ: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI) },
  zup: { names: NAMES.mixamo, pose: 'T', unit: 1, roll: true,
    frameQ: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
    wrapQ: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2) },
  quat: { names: NAMES.quat, pose: 'A', unit: 0.8, roll: true },
};
