// Tenkai-Oh's "Dawnbreaker" rocket hammer, built procedurally in the rig's model space.
// Local frame: the haft runs up +Y from the pommel (origin); the head sits across the top with its striking face on +X
// (the swing direction) and the rocket nozzle on -X, which flares while a swing is in flight.
import * as THREE from 'three';
import { hasProp, loadManifest, propModel } from './Assets';
import { fitProp } from './TomoeProps';

export interface HammerProp { group: THREE.Group; len: number; flame: THREE.Mesh; core: THREE.MeshStandardMaterial; sword?: boolean }

/** a summoned giant's greatsword (Enra's Susanoo: system32-82's prop_enra_susanoo_sword, an oni great-cleaver with an
 *  iron ring pommel, a red-corded grip and ember cracks down the blade). The prop is exported lying along X - the ring
 *  on -X, the tip on +X, the jagged edge on -Y, the grip's cord centred SWORD_GRIP of the way up its width - and is stood
 *  in the hammer's frame: pommel at the origin, blade up +Y, the edge on +X so it leads the sweep (Animator.gripT), at
 *  `fullLen` of the giant's height (4.6 m on the 6.15 m Susanoo). The animator swings it on the hammer path. */
const SWORD_GRIP = 0.27;
export function fitGreatsword(m: THREE.Object3D, modelHeight: number, fullLen = 0.75): HammerProp {
  const L = modelHeight, box = new THREE.Box3().setFromObject(m);
  const s = fullLen * L / Math.max(1e-6, box.max.x - box.min.x);
  m.scale.setScalar(s);
  m.rotation.z = Math.PI / 2;                                   // prop +X -> +Y (up the blade), prop -Y (the edge) -> +X
  m.position.set((box.min.y + SWORD_GRIP * (box.max.y - box.min.y)) * s, -box.min.x * s, 0);
  m.traverse(o => { const me = o as THREE.Mesh; if (me.isMesh) me.castShadow = true; });
  const g = new THREE.Group(); g.add(m);
  // (no rocket: the flame and the core are placeholders the hammer's flare logic never touches - HammerProp.sword)
  const flame = new THREE.Mesh(); flame.visible = false;
  return { group: g, len: 0.62 * L, flame, core: new THREE.MeshStandardMaterial(), sword: true };
}

export function buildHammer(modelHeight: number): HammerProp {
  const L = modelHeight, len = 0.62 * L;
  const white = new THREE.MeshStandardMaterial({ color: '#eef1f6', metalness: 0.45, roughness: 0.35 });
  const gold = new THREE.MeshStandardMaterial({ color: '#b98224', metalness: 0.8, roughness: 0.34 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1c2433', metalness: 0.5, roughness: 0.6 });
  const core = new THREE.MeshStandardMaterial({ color: '#fff1c2', emissive: new THREE.Color('#ffd76a'), emissiveIntensity: 2.4, metalness: 0, roughness: 0.4 });
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rz = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.z = rz; m.castShadow = true; g.add(m); return m;
  };
  // haft, grip wraps, gold bands, pommel
  add(new THREE.CylinderGeometry(0.017 * L, 0.02 * L, len * 0.86, 12), white, 0, len * 0.43, 0);
  add(new THREE.CylinderGeometry(0.022 * L, 0.022 * L, len * 0.22, 12), dark, 0, len * 0.19, 0);
  add(new THREE.CylinderGeometry(0.022 * L, 0.022 * L, len * 0.1, 12), dark, 0, len * 0.46, 0);
  for (const y of [0.33, 0.6, 0.8]) add(new THREE.CylinderGeometry(0.026 * L, 0.026 * L, 0.012 * L, 12), gold, 0, len * y, 0);
  add(new THREE.SphereGeometry(0.032 * L, 14, 10), gold, 0, 0, 0);
  // head: armoured block with gold face frames
  const hy = len * 0.9, hw = 0.27 * L, hh = 0.13 * L;
  add(new THREE.BoxGeometry(hw, hh, hh), white, 0, hy, 0);
  add(new THREE.BoxGeometry(hw * 0.5, hh * 1.06, hh * 0.4), gold, 0, hy, 0);
  for (const sx of [1, -1]) add(new THREE.BoxGeometry(0.022 * L, hh * 1.18, hh * 1.18), gold, sx * hw / 2, hy, 0);
  // striking face (+X): an octagonal gold ram
  add(new THREE.CylinderGeometry(0.07 * L, 0.078 * L, 0.035 * L, 8), gold, hw / 2 + 0.02 * L, hy, 0, -Math.PI / 2);
  // rocket nozzle (-X) with a hot throat
  add(new THREE.CylinderGeometry(0.058 * L, 0.04 * L, 0.06 * L, 12, 1, true), dark, -hw / 2 - 0.035 * L, hy, 0, -Math.PI / 2);
  add(new THREE.CircleGeometry(0.038 * L, 12), core, -hw / 2 - 0.02 * L, hy, 0).rotation.y = -Math.PI / 2;
  // sun cores on both flanks
  for (const sz of [1, -1]) {
    const c = add(new THREE.CircleGeometry(0.038 * L, 20), core, 0, hy, sz * (hh * 0.5 + 0.004 * L));
    c.rotation.y = sz > 0 ? 0 : Math.PI;
    const ring = add(new THREE.TorusGeometry(0.047 * L, 0.008 * L, 6, 20), gold, 0, hy, sz * (hh * 0.5 + 0.002 * L));
    ring.rotation.y = sz > 0 ? 0 : Math.PI;
  }
  // thruster flame (additive, scaled by the renderer during swings)
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.045 * L, 0.16 * L, 14, 1, true),
    new THREE.MeshBasicMaterial({ color: '#ff8a2a', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  flame.geometry.translate(0, 0.08 * L, 0);                // base at the nozzle, tip trailing away (-X)
  flame.position.set(-hw / 2 - 0.065 * L, hy, 0); flame.rotation.z = Math.PI / 2;
  flame.visible = false;
  g.add(flame);
  upgradeHammer(g, flame, len, L);
  return { group: g, len, flame, core };
}

/**
 * Swap the procedural hammer for the generated Dawnbreaker (Tripo Studio; assetgen/blender/prop_orient.py stood it in
 * this frame: pommel at the origin, haft up +Y, the octagonal striking face on +X, the rocket nozzle on -X) when the
 * manifest has it. Scaled to the same haft length, so every swing path and grip stays as authored; the thruster flame
 * moves to the real nozzle.
 */
function upgradeHammer(g: THREE.Group, flame: THREE.Mesh, len: number, L: number) {
  void (async () => {
    await loadManifest();
    if (!hasProp('prop_tenkai_hammer')) return;
    const m = await propModel('prop_tenkai_hammer');
    if (!m) return;
    const box = new THREE.Box3().setFromObject(m);
    const s = len * 1.08 / Math.max(1e-6, box.max.y - box.min.y);     // a touch longer than the procedural haft: Reinhardt-sized
    m.scale.setScalar(s); m.position.y = -box.min.y * s;
    m.traverse(o => { const me = o as THREE.Mesh; if (me.isMesh) { me.castShadow = true; const mt = me.material as THREE.MeshStandardMaterial; if (mt?.isMeshStandardMaterial) { mt.metalnessMap = null; mt.metalness = 0.45; mt.roughness = 0.34; mt.needsUpdate = true; } } });
    for (const c of [...g.children]) if (c !== flame) g.remove(c);
    g.add(m);
    // the nozzle: the -X end of the head
    flame.position.set(box.min.x * s - 0.012 * L, (box.max.y - (box.max.y - box.min.y) * 0.12) * s - box.min.y * s, 0);
  })();
}

/** Haruto's "Sunspark" sidearm: barrel along +Z from the grip (origin), sized in the rig's model units */
export function buildBlaster(modelHeight: number): THREE.Group {
  const L = modelHeight;
  const white = new THREE.MeshStandardMaterial({ color: '#eef1f6', metalness: 0.5, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1c2433', metalness: 0.55, roughness: 0.5 });
  const gold = new THREE.MeshStandardMaterial({ color: '#b98224', metalness: 0.8, roughness: 0.34 });
  const core = new THREE.MeshStandardMaterial({ color: '#fff1c2', emissive: new THREE.Color('#ffd76a'), emissiveIntensity: 2.2 });
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.x = rx; o.castShadow = true; g.add(o); return o; };
  add(new THREE.BoxGeometry(0.035 * L, 0.05 * L, 0.13 * L), white, 0, 0.03 * L, 0.05 * L);            // body
  add(new THREE.CylinderGeometry(0.011 * L, 0.013 * L, 0.09 * L, 10), dark, 0, 0.038 * L, 0.15 * L, Math.PI / 2);   // barrel
  add(new THREE.BoxGeometry(0.028 * L, 0.06 * L, 0.03 * L), dark, 0, -0.012 * L, 0.0, -0.25);        // grip
  add(new THREE.BoxGeometry(0.038 * L, 0.012 * L, 0.1 * L), gold, 0, 0.058 * L, 0.05 * L);           // top rail
  add(new THREE.SphereGeometry(0.012 * L, 10, 8), core, 0.018 * L, 0.03 * L, 0.06 * L);               // sun cell
  return g;
}

export interface ChaingunProp { group: THREE.Group; spin: THREE.Group; flash: THREE.Mesh; core: THREE.MeshStandardMaterial; len: number; }

/**
 * Gantetsu's rotary chainguns, built like black-lacquer festival drums: gold rims and rivets, glowing ember vents, a
 * six-barrel cluster that really spins up, a drum magazine underneath and an accent ring (jade = Hinoko, the left gun;
 * gold = Hanabi, the right). Local frame: the grip (fist) at the origin, barrels along +Z, top of the gun +Y.
 */
export function buildChaingun(modelHeight: number, side: 'L' | 'R'): ChaingunProp {
  const L = modelHeight, len = 0.44 * L;
  const lacquer = new THREE.MeshStandardMaterial({ color: '#17131a', metalness: 0.45, roughness: 0.3 });
  const gold = new THREE.MeshStandardMaterial({ color: '#c8922e', metalness: 0.85, roughness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: '#3a3d45', metalness: 0.8, roughness: 0.35 });
  const accentC = side === 'L' ? '#2fd3b8' : '#ffb84a';
  const accent = new THREE.MeshStandardMaterial({ color: accentC, emissive: new THREE.Color(accentC), emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.4 });
  const core = new THREE.MeshStandardMaterial({ color: '#ffd9a0', emissive: new THREE.Color('#ff7a1f'), emissiveIntensity: 2.6, roughness: 0.5 });
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
  };
  const alongZ = (geo: THREE.BufferGeometry) => geo.rotateX(Math.PI / 2);
  const bodyR = 0.066 * L, bodyZ0 = -0.03 * L, bodyZ1 = 0.25 * L, cy = -0.03 * L;       // the drum sits just under the fist
  const bodyL = bodyZ1 - bodyZ0, bz = (bodyZ0 + bodyZ1) / 2;
  add(alongZ(new THREE.CylinderGeometry(bodyR, bodyR * 1.04, bodyL, 22)), lacquer, 0, cy, bz);
  // gold rims front and back, a ring of rivets on each
  for (const z of [bodyZ0 + 0.004 * L, bodyZ1 - 0.004 * L]) {
    add(alongZ(new THREE.TorusGeometry(bodyR * 1.03, 0.0075 * L, 8, 28).rotateX(Math.PI / 2)), gold, 0, cy, z);
    for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; add(new THREE.SphereGeometry(0.0055 * L, 6, 5), gold, Math.cos(a) * bodyR * 1.06, cy + Math.sin(a) * bodyR * 1.06, z + 0.012 * L * (z < bz ? 1 : -1)); }
  }
  // ember heat vents along the flanks and the accent band
  for (const sx of [1, -1]) for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(0.006 * L, 0.03 * L, 0.028 * L), core, sx * bodyR * 1.0, cy + 0.01 * L, bodyZ0 + (0.05 + k * 0.055) * L);
  add(alongZ(new THREE.CylinderGeometry(bodyR * 1.045, bodyR * 1.045, 0.022 * L, 22, 1, true)), accent, 0, cy, bz - 0.02 * L).material = accent;
  // the front shroud with a glowing core, and the spinning six-barrel cluster
  add(alongZ(new THREE.CylinderGeometry(bodyR * 0.82, bodyR * 0.95, 0.05 * L, 20)), steel, 0, cy, bodyZ1 + 0.02 * L);
  const face = add(new THREE.CircleGeometry(bodyR * 0.55, 20), core, 0, cy, bodyZ1 + 0.046 * L);
  void face;
  const spin = new THREE.Group(); spin.position.set(0, cy, bodyZ1 + 0.045 * L); g.add(spin);
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2, r = bodyR * 0.46;
    add(alongZ(new THREE.CylinderGeometry(0.011 * L, 0.011 * L, 0.13 * L, 8)), steel, Math.cos(a) * r, Math.sin(a) * r, 0.065 * L, spin);
    add(alongZ(new THREE.TorusGeometry(0.011 * L, 0.003 * L, 5, 10).rotateX(Math.PI / 2)), gold, Math.cos(a) * r, Math.sin(a) * r, 0.13 * L, spin);
  }
  add(alongZ(new THREE.CylinderGeometry(bodyR * 0.62, bodyR * 0.62, 0.012 * L, 18)), gold, 0, 0, 0.09 * L, spin);
  add(alongZ(new THREE.CylinderGeometry(bodyR * 0.2, bodyR * 0.2, 0.14 * L, 10)), lacquer, 0, 0, 0.065 * L, spin);
  // drum magazine slung under the rear, gold-rimmed, with the accent emblem
  const mag = add(new THREE.CylinderGeometry(0.058 * L, 0.058 * L, 0.05 * L, 22).rotateZ(Math.PI / 2), lacquer, 0, cy - bodyR - 0.035 * L, 0.03 * L);
  void mag;
  for (const sx of [1, -1]) {
    add(new THREE.TorusGeometry(0.058 * L, 0.005 * L, 6, 24).rotateY(Math.PI / 2), gold, sx * 0.025 * L, cy - bodyR - 0.035 * L, 0.03 * L);
    add(new THREE.CircleGeometry(0.03 * L, 16).rotateY(sx * Math.PI / 2), accent, sx * 0.0255 * L, cy - bodyR - 0.035 * L, 0.03 * L);
  }
  // grip block under the fist and a top handle rail
  add(new THREE.BoxGeometry(0.03 * L, 0.05 * L, 0.05 * L), steel, 0, -0.005 * L, 0);
  add(new THREE.BoxGeometry(0.018 * L, 0.012 * L, 0.2 * L), gold, 0, cy + bodyR + 0.004 * L, bz);
  // muzzle flash: a crisp four-petal star (stylized, readable), flickered by the view while the gun fires
  const star = new THREE.Shape();
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, r = (k % 2 ? 0.03 : 0.11) * L; if (k) star.lineTo(Math.cos(a) * r, Math.sin(a) * r); else star.moveTo(r, 0); }
  const flash = new THREE.Mesh(new THREE.ShapeGeometry(star), new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  flash.position.set(0, cy, bodyZ1 + 0.2 * L); flash.visible = false;
  g.add(flash);
  const prop: ChaingunProp = { group: g, spin, flash, core, len };
  upgradeChaingun(prop, side === 'L' ? 'prop_gantetsu_hinoko' : 'prop_gantetsu_hanabi', L);
  return prop;
}

/**
 * Swap the procedural chaingun for the Tripo model (Hinoko left, Hanabi right) once it's loaded: fitted by PCA (muzzle
 * forward on +Z, flat top up, pistol grip in the fist), then the front of the mesh - the six-barrel cluster - is cut
 * into its own mesh and hung in the spin group on the cluster's own axis, so the barrels still spin up as he fires.
 */
const GUN_ROLL: Record<string, number> = { prop_gantetsu_hanabi: Math.PI };
/** how much of the gun's length, from the muzzle back, is the barrel cluster that spins (the rest is the receiver) */
const GUN_BARREL: Record<string, number> = { prop_gantetsu_hinoko_v2: 0.4, prop_gantetsu_hanabi_v2: 0.36 };

function upgradeChaingun(prop: ChaingunProp, id0: string, L: number) {
  void (async () => {
    await loadManifest();
    // the second generation of the guns (six long barrels in two gold rings, a drum magazine under the receiver) when the
    // build has them
    const id = hasProp(`${id0}_v2`) ? `${id0}_v2` : id0;
    if (!hasProp(id)) return;
    const m = await propModel(id);
    if (!m) return;
    const size = 0.46 * L;
    const fitted = fitProp(m, 'gun', size);
    // fitProp decides "up" by which side of the gun reaches further out; Hanabi's tall carry handle out-reaches its drum
    // magazine, so it comes out upside down - rolled over here (checked in the Hero Viewer, profile view)
    fitted.rotation.z = GUN_ROLL[id] ?? 0;
    const g = prop.group;
    // bake the fitted model into gun-frame geometry
    const holder = new THREE.Group(); holder.add(fitted); holder.updateMatrixWorld(true);
    const parts: { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[] }[] = [];
    fitted.traverse(o => {
      const me = o as THREE.Mesh;
      if (!me.isMesh) return;
      const geo = (me.geometry.index ? me.geometry.toNonIndexed() : me.geometry.clone()).applyMatrix4(me.matrixWorld);
      parts.push({ geo, mat: me.material });
    });
    if (!parts.length) return;
    const box = new THREE.Box3();
    for (const p of parts) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox!); }
    // the grip: a quarter of the way along from the back, the receiver sitting just above the fist
    const off = new THREE.Vector3(-(box.min.x + box.max.x) / 2, -(box.min.y + (box.max.y - box.min.y) * 0.3), -(box.min.z + (box.max.z - box.min.z) * 0.22));
    const zCut = box.max.z + off.z - (box.max.z - box.min.z) * (GUN_BARREL[id] ?? 0.38);
    const keepMeshes: THREE.Mesh[] = [], barrelMeshes: THREE.Mesh[] = [];
    const ax = new THREE.Vector2(), bb = new THREE.Box2();
    bb.makeEmpty();
    for (const p of parts) {
      p.geo.translate(off.x, off.y, off.z);
      const pos = p.geo.attributes.position, n = pos.count;
      const front: number[] = [], back: number[] = [];
      for (let t = 0; t + 2 < n; t += 3) {
        const inFront = pos.getZ(t) > zCut && pos.getZ(t + 1) > zCut && pos.getZ(t + 2) > zCut;
        (inFront ? front : back).push(t, t + 1, t + 2);
        if (inFront) for (let k = 0; k < 3; k++) bb.expandByPoint(new THREE.Vector2(pos.getX(t + k), pos.getY(t + k)));
      }
      const sub = (idx: number[]) => { const q = p.geo.clone(); q.setIndex(idx); return q; };
      if (back.length) keepMeshes.push(new THREE.Mesh(sub(back), p.mat));
      if (front.length) barrelMeshes.push(new THREE.Mesh(sub(front), p.mat));
    }
    bb.getCenter(ax);
    // replace the procedural parts (keep the spin group and the flash), then hang the barrels on their own axis
    for (const c of [...g.children]) if (c !== prop.spin && c !== prop.flash) g.remove(c);
    prop.spin.clear();
    prop.spin.position.set(ax.x, ax.y, 0);
    for (const b of barrelMeshes) { b.geometry.translate(-ax.x, -ax.y, 0); prop.spin.add(b); }
    for (const k of keepMeshes) g.add(k);
    for (const o of [...keepMeshes, ...barrelMeshes]) { o.castShadow = true; o.receiveShadow = true; }
    prop.flash.position.set(ax.x, ax.y, box.max.z + off.z + 0.03 * L);
    prop.len = box.max.z + off.z;
  })();
}


/**
 * Hibiki's Subwoofer Blaster, strapped to the right forearm: a white-and-gold speaker housing whose woofer cone pumps with
 * every round, an equaliser strip that glows the colour of the track he's playing, a short muzzle ring.
 */
export function buildSonicAmp(modelHeight: number): ChaingunProp {
  const L = modelHeight;
  const shell = new THREE.MeshStandardMaterial({ color: '#f2f4f7', metalness: 0.25, roughness: 0.35 });
  const gold = new THREE.MeshStandardMaterial({ color: '#d9a441', metalness: 0.85, roughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: '#15181f', metalness: 0.4, roughness: 0.5 });
  const core = new THREE.MeshStandardMaterial({ color: '#bffcff', emissive: new THREE.Color('#39d6ff'), emissiveIntensity: 2.4, roughness: 0.4 });
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
  };
  const alongZ = (geo: THREE.BufferGeometry) => geo.rotateX(Math.PI / 2);
  const cy = -0.028 * L;
  // housing along the forearm, a gold band, the equaliser strip on top
  add(new THREE.BoxGeometry(0.075 * L, 0.07 * L, 0.2 * L), shell, 0, cy, 0.06 * L);
  add(new THREE.BoxGeometry(0.079 * L, 0.012 * L, 0.2 * L), gold, 0, cy + 0.036 * L, 0.06 * L);
  for (let k = 0; k < 6; k++) add(new THREE.BoxGeometry(0.008 * L, (0.01 + (k % 3) * 0.006) * L, 0.012 * L), core, -0.025 * L + k * 0.01 * L, cy + 0.045 * L, 0.03 * L);
  // the speaker: a round baffle with the woofer cone (pumps on each shot) and a glowing dust cap
  const bz = 0.17 * L;
  add(alongZ(new THREE.CylinderGeometry(0.058 * L, 0.052 * L, 0.03 * L, 26)), shell, 0, cy, bz);
  add(alongZ(new THREE.TorusGeometry(0.052 * L, 0.006 * L, 8, 26).rotateX(Math.PI / 2)), gold, 0, cy, bz + 0.016 * L);
  const spin = new THREE.Group(); spin.position.set(0, cy, bz + 0.018 * L); g.add(spin);
  add(new THREE.ConeGeometry(0.045 * L, 0.02 * L, 26, 1, true).rotateX(-Math.PI / 2), dark, 0, 0, -0.004 * L, spin);
  const flashCap = add(new THREE.CircleGeometry(0.016 * L, 16), core, 0, 0, 0.004 * L, spin);
  void flashCap;
  // the burst ring in front of the cone (the muzzle flash)
  const flash = new THREE.Mesh(new THREE.RingGeometry(0.03 * L, 0.07 * L, 24), new THREE.MeshBasicMaterial({ color: '#bffcff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  flash.position.set(0, cy, bz + 0.045 * L); flash.visible = false; g.add(flash);
  add(new THREE.BoxGeometry(0.03 * L, 0.045 * L, 0.05 * L), dark, 0, -0.005 * L, 0);
  return { group: g, spin, flash, core, len: bz + 0.05 * L };
}

export interface SkateProp { group: THREE.Group; wheels: THREE.Mesh[]; glow: THREE.MeshStandardMaterial }
/** a mag-skate: a gold-trimmed white chassis clamped under the shoe with four glowing sky-blue wheels */
export function buildMagSkate(modelHeight: number): SkateProp {
  const L = modelHeight;
  const white = new THREE.MeshStandardMaterial({ color: '#f4f6fa', metalness: 0.3, roughness: 0.35 });
  const gold = new THREE.MeshStandardMaterial({ color: '#d9a441', metalness: 0.85, roughness: 0.3 });
  const glow = new THREE.MeshStandardMaterial({ color: '#c9fbff', emissive: new THREE.Color('#39d6ff'), emissiveIntensity: 2.2, roughness: 0.3 });
  const g = new THREE.Group();
  // the chassis wraps the sole: longer and wider than the shoe, so the wheels show front and back
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.078 * L, 0.022 * L, 0.2 * L), white); frame.position.set(0, 0.034 * L, 0.02 * L); g.add(frame);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.082 * L, 0.006 * L, 0.2 * L), gold); rail.position.set(0, 0.047 * L, 0.02 * L); g.add(rail);
  for (const sx of [1, -1]) { const strip = new THREE.Mesh(new THREE.BoxGeometry(0.004 * L, 0.01 * L, 0.18 * L), glow); strip.position.set(sx * 0.041 * L, 0.034 * L, 0.02 * L); g.add(strip); }
  const wheels: THREE.Mesh[] = [];
  const wg = new THREE.CylinderGeometry(0.024 * L, 0.024 * L, 0.022 * L, 18).rotateZ(Math.PI / 2);
  for (let k = 0; k < 4; k++) { const w = new THREE.Mesh(wg, glow); w.position.set(0, 0.022 * L, -0.068 * L + k * 0.058 * L); g.add(w); wheels.push(w); }
  return { group: g, wheels, glow };
}
