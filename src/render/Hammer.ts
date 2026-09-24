// Tenkai-Oh's "Dawnbreaker" rocket hammer, built procedurally in the rig's model space.
// Local frame: the haft runs up +Y from the pommel (origin); the head sits across the top with its striking face on +X
// (the swing direction) and the rocket nozzle on -X, which flares while a swing is in flight.
import * as THREE from 'three';

export interface HammerProp { group: THREE.Group; len: number; flame: THREE.Mesh; core: THREE.MeshStandardMaterial }

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
  return { group: g, len, flame, core };
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
