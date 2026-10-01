// Enra's Hellfire Chains (after Kratos' Blades of Chaos, docs/research/kratos_blades_study.md): the blade itself is a
// HeldProps item in each fist (prop_enra_chainblade, a Tripo model); this file is everything that makes it a CHAIN blade:
//
//  - the chain: black iron links (every fourth an ember) from the bracer on the forearm to the ring at the pommel. One
//    InstancedMesh per chain, the links laid along a curve each frame - a slack loop hanging beside the hand at rest,
//    paid out behind the blade when it flies: on a light swing the blade leaves the fist and whips round him at the
//    chain's full length (the sim's 5 m sweep), on the Chain Throw it shoots straight out to 7.5 m, spins once, snaps
//    taut and is yanked back (the timelines below are the sim's numbers, shared with the Animator and FirstPerson)
//  - the yoke: Kratos' chains are fused to his forearms; Enra's run on past the bracers, up the arms and across his
//    shoulders, so the two blades are one chain end to end (the user's ask: the swords connected)
//  - the fire: the blades burn on every attack - an additive flame sheet along each edge that licks and flickers, the
//    blade's own glow driven up, and a ribbon trail of ember-orange the blade's tip leaves behind (the path of the cut)
//
// Frame: everything lives in the same parent as the held props (CharacterView's gun root = model space) and follows
// whatever the animator or a first-person clip does with the hands.
import * as THREE from 'three';

// ---------------------------------------------------------------- timelines (the frame counts of the study, sections 2 and 4)
/** a light swing: 0.15 s wind-up, 0.25 s arc, recover to 0.62 s (1.6 swings a second); the throw 0.25 s out, a beat
 *  taut, 0.3 s back */
export const CB_WIND = 0.15, CB_ARC = 0.25, CB_SWING = 0.62, CB_THROW = 0.6;
/** metres the blade reaches from the shoulder on a full swing / the throw (the sim's primary and secondary ranges) */
export const CB_REACH = 5, CB_THROW_REACH = 7.5;
/** the throw's phases: the arm winds back, the blade flies out, holds taut, comes back */
export const CB_THROW_OUT = 0.08, CB_THROW_HIT = 0.25, CB_THROW_BACK = 0.34;

const ez = (u: number) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };

/** how far out on its chain the blade is during a light swing, 0 (in the fist) .. 1 (the chain's full length):
 *  it leaves the hand as the arc starts, is at full stretch for the middle of the arc, and is hauled back in the recover */
export function swingExt(t: number): number {
  if (t < 0) return 0;
  if (t < CB_WIND) return 0.12 * ez(t / CB_WIND);
  if (t < CB_WIND + CB_ARC) { const u = (t - CB_WIND) / CB_ARC; return 0.12 + 0.88 * ez(u / 0.45); }
  if (t < CB_SWING) return 1 - ez((t - CB_WIND - CB_ARC) / (CB_SWING - CB_WIND - CB_ARC));
  return 0;
}

/** the arc's progress 0..1 (0 = wound back on its own side, 1 = across the body), eased; stays at 1 through the recover */
export function swingArc(t: number): number {
  if (t < CB_WIND) return 0;
  if (t < CB_WIND + CB_ARC) return ez((t - CB_WIND) / CB_ARC);
  return 1;
}

/** the blade's bearing round the swinger (radians about the vertical, 0 = straight ahead, + = the character's left):
 *  it leads the hand by a little on the way across (a blade on a chain runs ahead of the wrist that whips it) */
export function swingPhi(t: number, side: number): number {
  const phi0 = side * 1.9, phi1 = -side * 1.25, a = swingArc(t);
  const lead = t < CB_WIND + CB_ARC ? -side * 0.3 * Math.sin(a * Math.PI) : 0;
  if (t >= CB_WIND + CB_ARC) { const u = ez((t - CB_WIND - CB_ARC) / (CB_SWING - CB_WIND - CB_ARC)); return phi1 + (-side * 0.5 - phi1) * u; }
  return phi0 + (phi1 - phi0) * a + lead;
}

/** the Chain Throw: how far out the blade is on its chain, 0..1 */
export function throwExt(t: number): number {
  if (t < CB_THROW_OUT) return 0;
  if (t < CB_THROW_HIT) return ez((t - CB_THROW_OUT) / (CB_THROW_HIT - CB_THROW_OUT));
  if (t < CB_THROW_BACK) return 1;
  if (t < CB_THROW) return 1 - ez((t - CB_THROW_BACK) / (CB_THROW - CB_THROW_BACK));
  return 0;
}

/** turns of the blade about the chain's side axis: one spin on the way out, point-first into the target, one back */
export function throwSpin(t: number): number {
  if (t < CB_THROW_OUT) return 0;
  if (t < CB_THROW_HIT) return (t - CB_THROW_OUT) / (CB_THROW_HIT - CB_THROW_OUT);
  if (t < CB_THROW_BACK) return 1;
  if (t < CB_THROW) return 1 + (t - CB_THROW_BACK) / (CB_THROW - CB_THROW_BACK);
  return 0;
}

/** how much the blade burns, 0..1: flares on as the attack starts, holds while the blade is moving, dies in the recover */
export function fireK(kind: string, age: number): number {
  if (age < 0) return 0;
  if (kind === 'primary' && age < CB_SWING) return age < 0.06 ? age / 0.06 : age < CB_WIND + CB_ARC + 0.08 ? 1 : Math.max(0, 1 - (age - CB_WIND - CB_ARC - 0.08) / 0.16);
  if (kind === 'secondary' && age < CB_THROW) return age < 0.06 ? age / 0.06 : age < CB_THROW - 0.12 ? 1 : Math.max(0, (CB_THROW - age) / 0.12);
  return 0;
}

// ---------------------------------------------------------------- the chain
/** iron: the black links; ember: every fourth link, glowing (its own mesh: emissive can't vary per instance) */
export interface Chain {
  group: THREE.Group; iron: THREE.InstancedMesh; ember: THREE.InstancedMesh; n: number; pitch: number; prev: THREE.Vector3 | null; sag: THREE.Vector3;
}

const IRON = new THREE.MeshStandardMaterial({ color: '#2a2529', metalness: 0.88, roughness: 0.4 });
const EMBER_MAT = new THREE.MeshStandardMaterial({ color: '#3a1a10', emissive: new THREE.Color('#ff5a1f'), emissiveIntensity: 1.6, metalness: 0.6, roughness: 0.5 });
const Z = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
const QY = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2), QX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

/** a chain of up to `n` links sized for a rig `L` model units tall (Enra's links about 7 cm long on a 2.05 m oni):
 *  one instanced mesh, the links rolled alternately so each ring threads the next; every fourth link glows an ember */
export function buildChain(L: number, n = 160): Chain {
  const geo = new THREE.TorusGeometry(0.0165 * L, 0.0048 * L, 6, 12);
  // the ring's plane holds the chain: a torus lies in XY (hole on Z) - turned so its long axis runs along local Z
  geo.applyQuaternion(QY);
  const mk = (mat: THREE.Material, count: number) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.castShadow = true; m.frustumCulled = false;
    for (let i = 0; i < count; i++) m.setMatrixAt(i, HIDE);
    return m;
  };
  const iron = mk(IRON, n), ember = mk(EMBER_MAT.clone(), Math.ceil(n / 4));
  const group = new THREE.Group(); group.add(iron); group.add(ember);
  return { group, iron, ember, n, pitch: 0.0235 * L, prev: null, sag: new THREE.Vector3() };
}

/** the chain's own glow (the ember links) driven up with the fire */
export function setChainHeat(c: Chain, heat: number) {
  (c.ember.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.6 + 3 * heat;
}

/**
 * Lay the links along a polyline of sample points (model space), one link every `pitch` of arc length; links the
 * curve is too short for are hidden. Returns how many were laid.
 */
export function layChain(c: Chain, pts: THREE.Vector3[]): number {
  const n = c.n;
  let laid = 0, seg = 0, into = 0;          // walking the polyline: current segment and the distance into it
  const segLen: number[] = [];
  for (let i = 1; i < pts.length; i++) segLen.push(pts[i].distanceTo(pts[i - 1]));
  const total = segLen.reduce((s, v) => s + v, 0);
  const count = Math.min(n, Math.max(1, Math.floor(total / c.pitch)));
  // centre the run on the curve so neither end leaves a gap
  let d = (total - (count - 1) * c.pitch) * 0.5;
  for (let i = 0; i < count; i++) {
    while (seg < segLen.length - 1 && into + segLen[seg] < d) { d -= segLen[seg]; seg++; }
    const u = segLen[seg] > 1e-9 ? Math.min(1, Math.max(0, d / segLen[seg])) : 0;
    _p.lerpVectors(pts[seg], pts[seg + 1], u);
    _t.subVectors(pts[seg + 1], pts[seg]);
    if (_t.lengthSq() < 1e-10) _t.copy(Z);
    _t.normalize();
    _q.setFromUnitVectors(Z, _t);
    if (i % 2) _q.multiply(QX);
    _m.compose(_p, _q, _s);
    if (i % 4 === 3) c.ember.setMatrixAt(i >> 2, _m); else c.iron.setMatrixAt(i, _m);
    laid++;
    d += c.pitch;
  }
  for (let i = laid; i < n; i++) { if (i % 4 === 3) c.ember.setMatrixAt(i >> 2, HIDE); else c.iron.setMatrixAt(i, HIDE); }
  c.iron.instanceMatrix.needsUpdate = true; c.ember.instanceMatrix.needsUpdate = true;
  return laid;
}

/**
 * A chain from the bracer (`from`) to the pommel (`to`) with `restLen` of chain to spend (model units): slack hangs in a
 * loop below the chord and trails the pommel's motion by a beat (flung out behind a swing); a chord longer than the
 * chain is a taut line with the barest bow against the motion. Returns the sampled curve.
 */
export function slackCurve(c: Chain, from: THREE.Vector3, to: THREE.Vector3, restLen: number, dt: number, out: THREE.Vector3[] = []): THREE.Vector3[] {
  const dist = from.distanceTo(to);
  // the sag: how much of a hanging loop the slack makes (a parabola of arc length s on a chord d dips ~ sqrt(s^2 - d^2) / 2.3)
  const slack = Math.max(0, restLen - dist), drop = Math.sqrt(Math.max(0, restLen * restLen - dist * dist)) / 2.3;
  // trailing: the loop swept back against the pommel's velocity, more when there's slack to swing
  if (c.prev && dt > 0) {
    _a.subVectors(to, c.prev).divideScalar(dt);
    const want = _a.multiplyScalar(-0.05 * (0.25 + 0.75 * Math.min(1, slack / Math.max(1e-6, restLen))));
    const maxLen = Math.max(0.03 * restLen, drop * 1.4);
    if (want.length() > maxLen) want.setLength(maxLen);
    c.sag.lerp(want, Math.min(1, dt * 16));
  } else c.sag.set(0, 0, 0);
  (c.prev ??= new THREE.Vector3()).copy(to);
  _c.addVectors(from, to).multiplyScalar(0.5).add(c.sag);
  _c.y -= drop;
  // a quadratic bezier from the bracer through the sag to the pommel
  const N = 32;
  out.length = N + 1;
  for (let i = 0; i <= N; i++) {
    const u = i / N, v = 1 - u;
    const p = (out[i] ??= new THREE.Vector3());
    p.set(0, 0, 0).addScaledVector(from, v * v).addScaledVector(_c, 2 * u * v).addScaledVector(to, u * u);
  }
  return out;
}

/** the yoke across the shoulders: a smooth run through the given waypoints (bracer, elbow, shoulder, nape, ...) */
export function yokeCurve(way: THREE.Vector3[], out: THREE.Vector3[] = []): THREE.Vector3[] {
  const curve = new THREE.CatmullRomCurve3(way, false, 'centripetal', 0.5);
  const N = 48;
  out.length = N + 1;
  for (let i = 0; i <= N; i++) curve.getPoint(i / N, (out[i] ??= new THREE.Vector3()));
  return out;
}

// ---------------------------------------------------------------- the fire
export interface Flame { group: THREE.Group; mats: THREE.MeshBasicMaterial[]; tex: THREE.CanvasTexture; k: number }

let flameTex: THREE.CanvasTexture | null = null;
function fireTexture(): THREE.CanvasTexture {
  if (flameTex) return flameTex;
  const w = 64, h = 256, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d')!, img = g.createImageData(w, h), d = img.data;
  // tongues of flame: bright at the root (v = 0, the edge of the blade), ragged and fading toward the tip; a few
  // sine-stacked licks so it reads as fire and not a glow bar
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    const lick = 0.55 + 0.45 * Math.sin(u * 23 + v * 9) * Math.sin(u * 11 - v * 17) * Math.sin(u * 41 + 2);
    const core = Math.max(0, 1 - v * 1.1), edge = Math.pow(Math.max(0, 1 - Math.abs(u - 0.5) * 2), 0.6);
    const a = Math.min(1, core * core * 1.4 * lick * edge + Math.max(0, 0.5 - v) * 0.4);
    const i = (y * w + x) * 4;
    d[i] = 255; d[i + 1] = Math.round(120 + 135 * core * core); d[i + 2] = Math.round(30 + 90 * core * core * core); d[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  flameTex = new THREE.CanvasTexture(cv);
  flameTex.wrapS = THREE.RepeatWrapping; flameTex.wrapT = THREE.ClampToEdgeWrapping;
  flameTex.colorSpace = THREE.SRGBColorSpace;
  return flameTex;
}

/** flames along a blade `len` long (its +Z): two crossed sheets off the edge plus a hotter core sheet, additive */
export function buildFlame(L: number, len: number): Flame {
  const tex = fireTexture(), group = new THREE.Group(), mats: THREE.MeshBasicMaterial[] = [];
  const mk = (h: number, rot: number, alpha: number, z0: number) => {
    const geo = new THREE.PlaneGeometry(len * 0.72, h, 8, 1);
    geo.rotateY(-Math.PI / 2); geo.translate(0, h * 0.4, z0 + len * 0.36);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: alpha, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: '#ffb070' });
    const m = new THREE.Mesh(geo, mat); m.rotation.z = rot; group.add(m); mats.push(mat);
  };
  mk(0.16 * L, 0, 0.9, 0.02 * L); mk(0.13 * L, Math.PI / 2, 0.7, 0.03 * L); mk(0.11 * L, -Math.PI / 2, 0.7, 0.01 * L); mk(0.09 * L, Math.PI, 0.55, 0.02 * L);
  group.visible = false;
  return { group, mats, tex, k: 0 };
}

/** burn at strength `k` (0 = out): the sheets scroll, flicker and swell with it */
export function updateFlame(f: Flame, k: number, dt: number, time: number) {
  f.k += (k - f.k) * Math.min(1, dt * 18);
  const on = f.k > 0.02;
  f.group.visible = on;
  if (!on) return;
  f.tex.offset.x = (time * 1.7) % 1;
  for (let i = 0; i < f.mats.length; i++) {
    const m = f.mats[i], fl = 0.78 + 0.22 * Math.sin(time * 37 + i * 2.1) * Math.sin(time * 23 + i);
    m.opacity = f.k * fl * [0.9, 0.7, 0.7, 0.55][i];
    const mesh = f.group.children[i];
    mesh.scale.set(1, 0.55 + 0.6 * f.k * fl, 1);
  }
}

// ---------------------------------------------------------------- the trail
export interface Trail { mesh: THREE.Mesh; samples: { a: THREE.Vector3; b: THREE.Vector3; t: number }[]; life: number; max: number }

/** a ribbon the blade's tip leaves (the swing's path, Kratos' ember arc): the last `max` pommel-tip pairs, brightest at
 *  the blade and black (gone, additive) `life` seconds back */
export function buildTrail(max = 28, life = 0.28): Trail {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 2 * 3), col = new Float32Array(max * 2 * 3), idx: number[] = [];
  for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.visible = false;
  return { mesh, samples: [], life, max };
}

const EMBER_HOT = new THREE.Color('#ffd27a'), EMBER_COOL = new THREE.Color('#ff3a0a');
/** push this frame's blade (pommel `a` -> tip `b`) when `on`, age the ribbon, rebuild it */
export function updateTrail(tr: Trail, a: THREE.Vector3 | null, b: THREE.Vector3 | null, on: boolean, now: number) {
  if (on && a && b) {
    const last = tr.samples[tr.samples.length - 1];
    if (!last || last.b.distanceToSquared(b) > 1e-6) {
      tr.samples.push({ a: a.clone(), b: b.clone(), t: now });
      if (tr.samples.length > tr.max) tr.samples.shift();
    }
  }
  while (tr.samples.length && now - tr.samples[0].t > tr.life) tr.samples.shift();
  const n = tr.samples.length;
  tr.mesh.visible = n >= 2;
  if (n < 2) return;
  const geo = tr.mesh.geometry, pos = geo.attributes.position as THREE.BufferAttribute, col = geo.attributes.color as THREE.BufferAttribute;
  const c = new THREE.Color();
  for (let i = 0; i < tr.max; i++) {
    // bright at the blade, dark at the tail: by age, and by place along the ribbon (a whip crosses metres in a few
    // frames, so by age alone the whole sweep would read as one slab)
    const s = tr.samples[Math.min(i, n - 1)], k = Math.max(0, 1 - (now - s.t) / tr.life) * Math.min(1, (Math.min(i, n - 1) + 1) / n);
    pos.setXYZ(i * 2, s.a.x, s.a.y, s.a.z); pos.setXYZ(i * 2 + 1, s.b.x, s.b.y, s.b.z);
    c.lerpColors(EMBER_COOL, EMBER_HOT, k * k).multiplyScalar(k * k);
    col.setXYZ(i * 2, c.r * 0.35, c.g * 0.35, c.b * 0.35); col.setXYZ(i * 2 + 1, c.r, c.g, c.b);
  }
  pos.needsUpdate = true; col.needsUpdate = true;
  geo.setDrawRange(0, Math.max(0, n - 1) * 6);
}

/** every emissive material under a prop, with its own glow remembered, so the blade can be driven hot and restored.
 *  The materials are cloned onto this prop first: the two blades are clones of one Tripo model sharing its materials,
 *  and one blade burning must not light the other (textures stay shared, the program is the same, nothing recompiles) */
export function heatMaterials(root: THREE.Object3D): { m: THREE.MeshStandardMaterial; e: number; c: THREE.Color }[] {
  const out: { m: THREE.MeshStandardMaterial; e: number; c: THREE.Color }[] = [];
  const cloned = new Map<THREE.Material, THREE.Material>();
  const own = (m: THREE.Material) => { let c = cloned.get(m); if (!c) { c = m.clone(); cloned.set(m, c); } return c; };
  root.traverse(o => {
    const me = o as THREE.Mesh;
    if (!me.isMesh || !me.material) return;
    me.material = Array.isArray(me.material) ? me.material.map(own) : own(me.material);
    const mats = Array.isArray(me.material) ? me.material : [me.material];
    for (const m of mats as THREE.MeshStandardMaterial[]) if (m && 'emissive' in m && !out.some(x => x.m === m)) out.push({ m, e: m.emissiveIntensity, c: m.emissive.clone() });
  });
  return out;
}

const HEAT = new THREE.Color('#ff4a12');
export function setHeat(mats: { m: THREE.MeshStandardMaterial; e: number; c: THREE.Color }[], k: number) {
  for (const x of mats) {
    x.m.emissive.copy(x.c).lerp(HEAT, Math.min(1, k * 0.8));
    x.m.emissiveIntensity = x.e + 3.5 * k;
  }
}

void _b; void _q2;
