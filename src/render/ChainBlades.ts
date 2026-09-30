// Enra's Hellfire Chains (after Kratos' Blades of Chaos, docs/research/kratos_blades_study.md): the blade itself is a
// HeldProps item in each fist (prop_enra_blade, evera-b6's Tripo model); this is the chain that runs from the pommel up
// to the bracer on the forearm - a slack loop of black iron links, every fourth one an ember, hanging beside the hand at
// rest and flung out behind the blade on a swing (the loop's sag trails the hand's motion by a beat).
//
// Frame: the links live in the same parent as the held props (CharacterView's gun root) and are laid along a quadratic
// bezier from the bracer to the pommel each frame, so they follow whatever the animator or a first-person clip does
// with the hands.
import * as THREE from 'three';

export interface ChainLoop { group: THREE.Group; links: THREE.Mesh[]; prev: THREE.Vector3 | null; sag: THREE.Vector3 }

const IRON = new THREE.MeshStandardMaterial({ color: '#26222a', metalness: 0.85, roughness: 0.42 });
const EMBER = new THREE.MeshStandardMaterial({ color: '#3a1a10', emissive: new THREE.Color('#ff5a1f'), emissiveIntensity: 1.8, metalness: 0.6, roughness: 0.5 });

/** a run of `n` links sized for a rig `L` model units tall (Enra's links: about 6 cm long on a 2 m oni) */
export function buildChainLoop(L: number, n = 12): ChainLoop {
  const g = new THREE.Group(), links: THREE.Mesh[] = [];
  const geo = new THREE.TorusGeometry(0.014 * L, 0.0045 * L, 6, 12);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, i % 4 === 3 ? EMBER : IRON);
    m.castShadow = true;
    g.add(m); links.push(m);
  }
  return { group: g, links, prev: null, sag: new THREE.Vector3() };
}

const P = new THREE.Vector3(), T = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), M = new THREE.Matrix4(), Q = new THREE.Quaternion();
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
const QY = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2), QX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2), QI = new THREE.Quaternion();

/**
 * Lay the links from the bracer (`from`) to the pommel (`to`), the loop sagging `drop` (model units) below their
 * midpoint and trailing the pommel's motion. Positions in the chain group's parent space.
 */
export function updateChainLoop(c: ChainLoop, from: THREE.Vector3, to: THREE.Vector3, drop: number, dt: number) {
  // the sag: straight down at rest, swept back against the pommel's velocity so the loop flies out behind a swing
  if (c.prev && dt > 0) {
    tmpA.subVectors(to, c.prev).divideScalar(dt);                           // pommel velocity, model units / s
    const want = tmpA.multiplyScalar(-0.06);
    const maxLen = drop * 1.6;
    if (want.length() > maxLen) want.setLength(maxLen);
    c.sag.lerp(want, Math.min(1, dt * 14));
  } else c.sag.set(0, 0, 0);
  (c.prev ??= new THREE.Vector3()).copy(to);
  const ctrl = tmpB.addVectors(from, to).multiplyScalar(0.5).add(c.sag);
  ctrl.y -= drop;
  const n = c.links.length;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n, v = 1 - u;
    // quadratic bezier and its tangent
    P.set(0, 0, 0).addScaledVector(from, v * v).addScaledVector(ctrl, 2 * u * v).addScaledVector(to, u * u);
    T.subVectors(ctrl, from).multiplyScalar(2 * v).addScaledVector(tmpA.subVectors(to, ctrl), 2 * u);
    if (T.lengthSq() < 1e-8) T.set(0, -1, 0);
    T.normalize();
    const l = c.links[i];
    l.position.copy(P);
    // a torus lies in its local XY plane (the hole on Z): lookAt puts the chain direction on local -Z, a quarter turn
    // about Y then lays it along local X so the ring's plane holds the chain; alternate links turned a quarter round it
    M.lookAt(P, tmpA.addVectors(P, T), Math.abs(T.y) > 0.95 ? new THREE.Vector3(0, 0, 1) : UP);
    Q.setFromRotationMatrix(M);
    l.quaternion.copy(Q).multiply(QY).multiply(i % 2 ? QX : QI);
  }
}
