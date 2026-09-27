// Tomoe's arms, in her armour's design language (white lacquer, gold filigree, turquoise gems, sky-blue glow): the
// Crownfire Scattergun (right hand), the Crescent Fang (left hand / thrown) and the great axe she swings for Crescent
// Reaping and Tide of Blades (carried on her back otherwise). Each is built procedurally first and upgraded in place to the
// TRELLIS.2 prop generated from her model sheet (public/models/prop_tomoe_*.glb) when the manifest has it.
import * as THREE from 'three';
import type { ChaingunProp, HammerProp } from './Hammer';
import { hasProp, loadManifest, propModel } from './Assets';

const mats = () => ({
  white: new THREE.MeshStandardMaterial({ color: '#f3f1ec', metalness: 0.2, roughness: 0.32 }),
  gold: new THREE.MeshStandardMaterial({ color: '#d9a441', metalness: 0.85, roughness: 0.3 }),
  gem: new THREE.MeshStandardMaterial({ color: '#7ff5ea', emissive: new THREE.Color('#2fd9c9'), emissiveIntensity: 1.4, metalness: 0.1, roughness: 0.2 }),
  glow: new THREE.MeshStandardMaterial({ color: '#d8fffb', emissive: new THREE.Color('#5ff2e0'), emissiveIntensity: 2.4, roughness: 0.3 }),
  dark: new THREE.MeshStandardMaterial({ color: '#1a2230', metalness: 0.5, roughness: 0.55 }),
});
const put = (g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o;
};

/** the Crownfire Scattergun: grip (fist) at the origin, barrel along +Z, top +Y - the ChaingunProp frame the animator lays along the forearm */
export function buildScattergun(modelHeight: number): ChaingunProp {
  const L = modelHeight, M = mats(), g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const alongZ = (geo: THREE.BufferGeometry) => geo.rotateX(Math.PI / 2);
  const by = 0.035 * L;
  put(body, new THREE.BoxGeometry(0.05 * L, 0.06 * L, 0.14 * L), M.white, 0, by, 0.03 * L);                  // receiver
  put(body, alongZ(new THREE.CylinderGeometry(0.022 * L, 0.022 * L, 0.24 * L, 16)), M.white, 0, by + 0.012 * L, 0.2 * L);    // barrel
  put(body, alongZ(new THREE.CylinderGeometry(0.016 * L, 0.016 * L, 0.2 * L, 12)), M.gem, 0, by - 0.022 * L, 0.18 * L);     // turquoise pump tube
  put(body, alongZ(new THREE.CylinderGeometry(0.02 * L, 0.02 * L, 0.06 * L, 12)), M.gold, 0, by - 0.022 * L, 0.14 * L);     // gold-ringed pump grip
  put(body, alongZ(new THREE.CylinderGeometry(0.032 * L, 0.024 * L, 0.03 * L, 16)), M.gold, 0, by + 0.012 * L, 0.33 * L);   // flared muzzle crown
  put(body, new THREE.BoxGeometry(0.03 * L, 0.012 * L, 0.05 * L), M.gold, 0, by + 0.04 * L, 0.05 * L);                     // crown sight
  put(body, new THREE.BoxGeometry(0.04 * L, 0.05 * L, 0.1 * L), M.white, 0, by - 0.01 * L, -0.08 * L).rotation.x = 0.35;    // short stock
  put(body, new THREE.SphereGeometry(0.012 * L, 10, 8), M.gem, 0.026 * L, by, -0.05 * L);                                  // gem in the stock
  put(body, new THREE.BoxGeometry(0.028 * L, 0.06 * L, 0.03 * L), M.dark, 0, -0.005 * L, 0);                                 // grip
  const flash = new THREE.Mesh(new THREE.CircleGeometry(0.07 * L, 12), new THREE.MeshBasicMaterial({ color: '#dffffb', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  flash.position.set(0, by + 0.012 * L, 0.36 * L); flash.visible = false; g.add(flash);
  body.scale.setScalar(0.72); flash.position.multiplyScalar(0.72);
  const prop: ChaingunProp = { group: g, spin: new THREE.Group(), flash, core: M.glow, len: 0.26 * L };
  upgrade(body, 'prop_tomoe_shotgun', 'gun', 0.4 * L / 0.72, new THREE.Vector3(0, by, 0.08 * L));
  return prop;
}

/** the Crescent Fang: the grip at the origin, the curved blade along +Z (the edge on +Y) */
export function buildFang(modelHeight: number): THREE.Group {
  const L = modelHeight, M = mats(), g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const s = new THREE.Shape();
  // a crescent cleaver: straight spine, deep curved belly, a hooked tip, two jag teeth near the grip
  s.moveTo(0, 0); s.lineTo(0.22, 0.0); s.quadraticCurveTo(0.3, 0.02, 0.28, 0.08);
  s.quadraticCurveTo(0.2, 0.1, 0.12, 0.085); s.lineTo(0.1, 0.1); s.lineTo(0.08, 0.075); s.lineTo(0.05, 0.09); s.lineTo(0.03, 0.06); s.lineTo(0, 0.05); s.lineTo(0, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 });
  geo.translate(0, -0.03, -0.006); geo.scale(L, L, L); geo.rotateY(-Math.PI / 2);                     // length along +Z, flat in the YZ plane
  put(body, geo, M.white, 0, 0, 0.04 * L);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.004 * L, 0.006 * L, 0.2 * L), M.glow); edge.position.set(0, 0.052 * L, 0.14 * L); edge.rotation.x = -0.18; body.add(edge);
  put(body, new THREE.BoxGeometry(0.03 * L, 0.03 * L, 0.012 * L), M.gold, 0, 0, 0.04 * L);          // guard
  put(body, new THREE.CylinderGeometry(0.011 * L, 0.012 * L, 0.07 * L, 10).rotateX(Math.PI / 2), M.dark, 0, 0, 0);
  put(body, new THREE.SphereGeometry(0.014 * L, 10, 8), M.gem, 0, 0, -0.04 * L);                    // gem pommel
  body.scale.setScalar(0.7);
  upgrade(body, 'prop_tomoe_blade', 'blade', 0.26 * L / 0.7, new THREE.Vector3(0, 0, 0.1 * L));
  return g;
}

/**
 * the great axe on the hammer rig's frame: the haft up +Y from the pommel (origin), the crescent head across the top with
 * its edge on +X (the swing direction) - so Animator poses it exactly like Tenkai-Oh's hammer
 */
export function buildGreatAxe(modelHeight: number): HammerProp {
  const L = modelHeight, M = mats(), g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const len = 0.62 * L;
  put(body, new THREE.CylinderGeometry(0.016 * L, 0.019 * L, len * 0.92, 12), M.white, 0, len * 0.46, 0);
  for (const y of [0.12, 0.3, 0.55, 0.72]) put(body, new THREE.CylinderGeometry(0.022 * L, 0.022 * L, 0.014 * L, 12), M.gold, 0, len * y, 0);
  put(body, new THREE.CylinderGeometry(0.021 * L, 0.021 * L, len * 0.14, 12), M.dark, 0, len * 0.21, 0);
  put(body, new THREE.SphereGeometry(0.026 * L, 12, 10), M.gold, 0, 0, 0);
  // crescent head: an extruded half-moon on +X, a small back spike on -X, gold horn spikes on top
  const s = new THREE.Shape(), R = 0.2 * L;
  s.moveTo(0, -R * 0.55); s.quadraticCurveTo(R * 1.25, -R * 0.9, R * 1.2, 0); s.quadraticCurveTo(R * 1.25, R * 0.9, 0, R * 0.55);
  s.quadraticCurveTo(R * 0.55, 0, 0, -R * 0.55);
  const head = new THREE.ExtrudeGeometry(s, { depth: 0.02 * L, bevelEnabled: true, bevelThickness: 0.005 * L, bevelSize: 0.005 * L, bevelSegments: 1 });
  head.translate(0, 0, -0.01 * L);
  put(body, head, M.white, 0.01 * L, len * 0.86, 0);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(R * 0.95, 0.006 * L, 6, 24, Math.PI * 0.62), M.glow);
  edge.position.set(R * 0.28, len * 0.86, 0); edge.rotation.z = -Math.PI * 0.31; body.add(edge);
  put(body, new THREE.ConeGeometry(0.03 * L, 0.1 * L, 8).rotateZ(Math.PI / 2), M.white, -0.06 * L, len * 0.86, 0);
  for (const sy of [1, -1]) put(body, new THREE.ConeGeometry(0.014 * L, 0.09 * L, 8), M.gold, 0.02 * L, len * 0.86 + sy * R * 0.62, 0).rotation.z = -sy * 0.5;
  put(body, new THREE.SphereGeometry(0.02 * L, 10, 8), M.gem, 0.05 * L, len * 0.86, 0.016 * L);
  const flame = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()); flame.visible = false;
  upgrade(body, 'prop_tomoe_axe', 'axe', len * 1.02, new THREE.Vector3(0, -0.02 * L, 0));    // fitted pommel-first
  return { group: g, len, flame, core: M.glow };
}

type Kind = 'gun' | 'blade' | 'axe';

/**
 * Swap a procedural body for the generated prop: the longest axis is laid along the prop's frame (Z for the gun and
 * blade, Y for the axe), the heavy end chosen by cross-section (the gun's stock and the axe head are the bulky ends),
 * scaled to `size` and centred on `at`.
 */
function upgrade(body: THREE.Group, id: string, kind: Kind, size: number, at: THREE.Vector3) {
  void (async () => {
    await loadManifest();
    if (!hasProp(id)) return;
    const m = await propModel(id);
    if (!m) return;
    const fitted = fitProp(m, kind, size);
    fitted.position.add(at);
    body.clear();
    body.add(fitted);
  })();
}

export function fitProp(m: THREE.Object3D, kind: Kind, size: number): THREE.Object3D {
  m.updateMatrixWorld(true);
  const pts: THREE.Vector3[] = [];
  m.traverse(o => {
    const me = o as THREE.Mesh;
    if (!me.isMesh || !me.geometry?.attributes.position) return;
    const pa = me.geometry.attributes.position, step = Math.max(1, Math.floor(pa.count / 4000));
    for (let i = 0; i < pa.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(pa, i).applyMatrix4(me.matrixWorld));
    me.castShadow = true;
  });
  if (pts.length < 3) return m;
  // the object's own axes (PCA): image-to-3D keeps the pose of the picture, so a weapon drawn on the diagonal comes out
  // on the diagonal - its bounding box says nothing about where the haft or barrel runs
  const mean = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length);
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) { const d = [p.x - mean.x, p.y - mean.y, p.z - mean.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += d[i] * d[j]; }
  const mul = (v: THREE.Vector3) => new THREE.Vector3(C[0] * v.x + C[1] * v.y + C[2] * v.z, C[3] * v.x + C[4] * v.y + C[5] * v.z, C[6] * v.x + C[7] * v.y + C[8] * v.z);
  const power = (v: THREE.Vector3, not?: THREE.Vector3) => { for (let i = 0; i < 60; i++) { if (not) v.addScaledVector(not, -v.dot(not)); v = mul(v).normalize(); } if (not) v.addScaledVector(not, -v.dot(not)).normalize(); return v; };
  const a1 = power(new THREE.Vector3(1, 0.7, 0.4).normalize());
  const a2 = power(new THREE.Vector3(-0.3, 1, 0.5).normalize(), a1);
  // extent along the long axis, and how bulky each end is (the gun's stock, the axe head, the blade)
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { const u = p.clone().sub(mean).dot(a1); lo = Math.min(lo, u); hi = Math.max(hi, u); }
  const span = hi - lo, ends = [0, 0], side = [new THREE.Vector3(), new THREE.Vector3()], n = [0, 0];
  for (const p of pts) {
    const d = p.clone().sub(mean), u = (d.dot(a1) - lo) / span, perp = d.addScaledVector(a1, -d.dot(a1));
    const e = u < 0.25 ? 0 : u > 0.75 ? 1 : -1;
    if (e < 0) continue;
    ends[e] = Math.max(ends[e], perp.length()); side[e].add(perp); n[e]++;
  }
  // gun: the muzzle (thin end) forward (+Z); blade: the grip (thin end) at the back, blade forward; axe: the head up (+Y)
  const heavy = ends[1] > ends[0] ? 1 : 0;
  const wantHeavyForward = kind !== 'gun';
  const dir = a1.clone().multiplyScalar((heavy === 1) === wantHeavyForward ? 1 : -1);
  const target = kind === 'axe' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(dir, target);
  // roll about the long axis: the axe head juts out on +X (the swing's cutting side); the gun's grip hangs down (-Y),
  // i.e. its bulkier side across the second axis points down
  let across: THREE.Vector3;
  if (kind === 'axe') across = side[heavy].clone().divideScalar(Math.max(1, n[heavy]));
  else {
    let up = 0, dn = 0;
    for (const p of pts) { const v = p.clone().sub(mean).dot(a2); up = Math.max(up, v); dn = Math.max(dn, -v); }
    across = a2.clone().multiplyScalar(up > dn ? -1 : 1);          // points toward the flat top
  }
  across.applyQuaternion(q); across.addScaledVector(target, -across.dot(target));      // into the plane across the long axis
  const want = kind === 'axe' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  if (across.lengthSq() > 1e-8) {
    across.normalize();
    const ang = Math.atan2(new THREE.Vector3().crossVectors(across, want).dot(target), across.dot(want));
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(target, ang));
  }
  const wrap = new THREE.Group(), inner = new THREE.Group();
  inner.add(m); m.position.sub(mean);
  inner.quaternion.copy(q);
  // the axe hangs from its pommel (the haft's thin end at the origin); gun and blade stay centred on their grip point
  if (kind === 'axe') inner.position.y = (heavy === 1 ? -lo : hi) * 1;
  wrap.add(inner);
  wrap.scale.setScalar(size / Math.max(1e-6, span));
  return wrap;
}
