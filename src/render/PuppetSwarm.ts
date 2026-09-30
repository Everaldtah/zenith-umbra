// Hex's puppet army, drawn as one swarm: a single instanced mesh for every puppet on the field (fifty skinned characters
// would cost fifty rigs), moved the way marionettes move - hanging from their strings a hand above the floor, swaying,
// leaning into the run, lunging on a claw swipe, rising out of the floor in a ripple, dropping in a heap when the strings
// go slack. Two violet strings run up from each of them; a ring of light marks where one is rising.
//
// The model is the Tripo puppet (prop_hex_puppet) when it is published, a stand-in built here until then.
// Everything is built at match start and lives in the scene from then on (one hidden instance), so the match preloader
// uploads its texture and compiles its shaders before the first cast.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { World } from '../game/World';
import type { Actor } from '../game/Actor';
import { PUPPET_DEF } from '../game/puppets';
import { propModel } from './Assets';

export const PUPPET_MODEL = 'prop_hex_puppet';
const MAX = 128;
const H = PUPPET_DEF.height;
/** the model's own facing, turned to the game's (+z forward) */
const MODEL_YAW = 0;
const HOVER = 0.14, FALL_SECS = 0.7, GONE_AFTER = 3.2;

/** the stand-in: a masked figure in a tailcoat, from a few solids (vertex colours) */
function standIn(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, col: string, x: number, y: number, z: number, rx = 0, rz = 0) => {
    g = g.toNonIndexed(); g.rotateX(rx); g.rotateZ(rz); g.translate(x, y, z);
    const c = new THREE.Color(col), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  };
  add(new THREE.SphereGeometry(0.17, 12, 10).scale(0.9, 1.15, 0.95), '#f4f1ea', 0, 1.56, 0.02);          // the mask
  add(new THREE.ConeGeometry(0.24, 0.22, 10, 1, true), '#7a3fd0', 0, 1.36, 0, Math.PI);                  // the collar
  add(new THREE.CylinderGeometry(0.2, 0.17, 0.62, 10), '#15131a', 0, 1.06, 0);                           // the coat
  add(new THREE.BoxGeometry(0.16, 0.5, 0.05), '#f4f1ea', 0, 1.08, 0.16);                                 // the waistcoat
  add(new THREE.ConeGeometry(0.26, 0.7, 10, 1, true), '#15131a', 0, 0.62, -0.05, Math.PI);               // the tails
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.055, 0.045, 0.42, 8), '#15131a', s * 0.3, 1.22, 0.12, -1.0, s * 0.5);   // arm, raised
    add(new THREE.SphereGeometry(0.09, 8, 6), '#7a3fd0', s * 0.4, 1.4, 0.3);                                 // the glove
    add(new THREE.CylinderGeometry(0.07, 0.05, 0.75, 8), '#15131a', s * 0.1, 0.4, 0);                        // the leg
    add(new THREE.SphereGeometry(0.06, 8, 6), '#d8c3a5', s * 0.1, 0.42, 0.02);                               // the knee joint
  }
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  return g;
}

export class PuppetSwarm {
  group = new THREE.Group();
  body: THREE.InstancedMesh;
  strings: THREE.InstancedMesh;
  rings: THREE.InstancedMesh;
  /** resolves when the published model (if there is one) has replaced the stand-in */
  ready: Promise<void>;
  real = false;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private p = new THREE.Vector3(); private s = new THREE.Vector3();
  private e = new THREE.Euler(0, 0, 0, 'YXZ'); private c = new THREE.Color();
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 });
    this.body = new THREE.InstancedMesh(standIn(), mat, MAX);
    this.body.castShadow = true; this.body.receiveShadow = true;
    // two strings a puppet, fading upward
    const sg = new THREE.CylinderGeometry(0.012, 0.012, 1, 4, 1, true); sg.translate(0, 0.5, 0);
    const sc = new Float32Array(sg.attributes.position.count * 3);
    for (let i = 0; i < sg.attributes.position.count; i++) { const k = 1 - sg.attributes.position.getY(i); sc[i * 3] = sc[i * 3 + 1] = sc[i * 3 + 2] = k * k; }
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    this.strings = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), MAX * 2);
    const rg = new THREE.RingGeometry(0.35, 0.5, 24); rg.rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(rg, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), MAX);
    for (const im of [this.body, this.strings, this.rings]) {
      im.frustumCulled = false;                       // the instances are anywhere on the map
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // one instance under the map: there for the preloader's texture upload and shader compile
      im.count = 1; im.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, -400, 0));
      im.setColorAt(0, new THREE.Color('#c77dff'));
      im.instanceMatrix.needsUpdate = true;
      this.group.add(im);
    }
    this.body.setColorAt(0, new THREE.Color('#ffffff'));
    scene.add(this.group);
    this.ready = propModel(PUPPET_MODEL).then(model => { if (model) this.adopt(model); }).catch(() => { /* the stand-in stays */ });
  }

  /** the published puppet: its meshes merged into one, scaled to a puppet's height, feet on the floor */
  private adopt(model: THREE.Object3D) {
    model.updateMatrixWorld(true);
    const geos: THREE.BufferGeometry[] = [];
    let map: THREE.Texture | null = null, rough = 0.75, metal = 0.05;
    model.traverse(o => {
      const me = o as THREE.Mesh;
      if (!me.isMesh) return;
      const g = me.geometry.clone().applyMatrix4(me.matrixWorld);
      for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
      if (!g.attributes.normal) g.computeVertexNormals();
      geos.push(g.index ? g.toNonIndexed() : g);
      const mt = (Array.isArray(me.material) ? me.material[0] : me.material) as THREE.MeshStandardMaterial;
      if (mt?.map && !map) { map = mt.map; rough = mt.roughness ?? rough; metal = Math.min(0.2, mt.metalness ?? metal); }
    });
    if (!geos.length || geos.some(g => !g.attributes.uv)) return;
    const g = mergeGeometries(geos, false);
    if (!g) return;
    g.rotateY(MODEL_YAW);
    g.computeBoundingBox();
    const b = g.boundingBox!, k = H / (b.max.y - b.min.y || 1);
    g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    g.scale(k, k, k);
    const old = this.body.geometry, om = this.body.material as THREE.Material;
    this.body.geometry = g;
    // uniform surface values: generated metal / roughness maps are noise (as on the heroes)
    this.body.material = new THREE.MeshStandardMaterial({ map, roughness: Math.max(0.55, rough), metalness: metal, side: THREE.DoubleSide });
    old.dispose(); om.dispose();
    this.real = true;
  }

  update(w: World, time: number, viewerTeam: string, sees: (a: Actor) => boolean) {
    const { m, q, p, s, e, c } = this;
    let n = 0, ns = 0, nr = 0;
    for (const a of w.actors) {
      if (!a.isSummon || a.def.id !== 'puppet' || n >= MAX) continue;
      const fell = a.alive ? -1 : time - (a.sv.fellAt ?? a.deathAt);
      if (!a.alive && (fell > GONE_AFTER || a.deathAt < -50)) continue;
      if (a.alive && !sees(a)) continue;
      const id = a.id * 1.37;
      const riseK = a.alive && a.sv.riseUntil !== undefined && time < a.sv.riseUntil ? Math.max(0, (time - a.sv.riseAt) / Math.max(0.01, a.sv.riseUntil - a.sv.riseAt)) : 1;
      const speed = Math.hypot(a.vel.x, a.vel.z);
      const atk = time - a.anim.attackAt, lunge = atk >= 0 && atk < 0.32 ? Math.sin((atk / 0.32) * Math.PI) : 0;
      const hit = time - a.anim.hitAt, flinch = hit >= 0 && hit < 0.2 ? 1 - hit / 0.2 : 0;
      let y = a.pos.y, pitch = 0, roll = 0, yaw = a.yaw, sy = 1;
      if (a.alive) {
        const ease = 1 - (1 - riseK) * (1 - riseK);
        y += -H * (1 - ease) + HOVER * ease + Math.sin(time * 3.1 + id) * 0.05 * ease;
        pitch = Math.min(0.32, speed * 0.05) + lunge * 0.55 - flinch * 0.35;
        roll = Math.sin(time * 2.3 + id) * 0.07 + Math.sin(time * 9 + id) * 0.02 * Math.min(1, speed / 3);
        yaw += Math.sin(time * 1.7 + id) * 0.08;
      } else {
        // the strings go slack: knees first, then the whole figure folds forward into a heap and sinks away
        const k = Math.min(1, fell / FALL_SECS), kk = k * k;
        pitch = kk * 1.45; roll = Math.sin(id) * 0.5 * kk; sy = 1 - 0.25 * kk;
        y += HOVER * (1 - kk) + 0.12 * kk - Math.max(0, fell - (GONE_AFTER - 0.8)) * 0.6;
      }
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
      p.set(a.pos.x + fx * lunge * 0.35, y, a.pos.z + fz * lunge * 0.35);
      e.set(pitch, yaw, roll); q.setFromEuler(e);
      s.set(a.scale, a.scale * sy, a.scale);
      this.body.setMatrixAt(n, m.compose(p, q, s));
      // enemies' puppets read a shade redder
      this.body.setColorAt(n, c.set(a.team === viewerTeam ? '#ffffff' : '#ffd0d0'));
      n++;
      if (a.alive) {
        const col = a.team === viewerTeam ? '#b98cff' : '#ff6a8a', len = 5 + Math.sin(id) * 1.2;
        for (const sx of [-0.22, 0.22]) {
          // from the shoulders up, leaning a little with the run
          p.set(a.pos.x - fz * sx * a.scale, y + H * 0.82 * a.scale, a.pos.z + fx * sx * a.scale);
          e.set(-pitch * 0.4, yaw, roll * 0.5 + sx * 0.06); q.setFromEuler(e);
          s.set(1, len * riseK, 1);
          this.strings.setMatrixAt(ns, m.compose(p, q, s));
          this.strings.setColorAt(ns, c.set(col));
          ns++;
        }
        if (riseK < 1) {
          p.set(a.pos.x, a.pos.y + 0.04, a.pos.z); q.identity(); const r = 0.6 + riseK * 1.2; s.set(r, 1, r);
          this.rings.setMatrixAt(nr, m.compose(p, q, s));
          this.rings.setColorAt(nr, c.set(col).multiplyScalar(1 - riseK));
          nr++;
        }
      }
    }
    // (always one instance, parked under the map when the field is empty: an empty instanced mesh is skipped by the
    // renderer and its program would be compiled at the first cast)
    const park = (im: THREE.InstancedMesh, k: number) => { if (k === 0) { im.setMatrixAt(0, this.hidden); k = 1; } im.count = k; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; };
    park(this.body, n); park(this.strings, ns); park(this.rings, nr);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    for (const im of [this.body, this.strings, this.rings]) { im.geometry.dispose(); (im.material as THREE.Material).dispose(); im.dispose(); }
  }
}
