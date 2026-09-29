// Grand Dohyo's binding chains (Gantetsu's ult, after Overwatch's Cage Fight - where a chain leashes everyone in the cage
// to the device at its centre): a holographic chain rides round the ring at the rope, and from the stake in the middle
// of the ring a chain runs to every enemy the ring holds, ending in a shackle looped round them. The chains pay out
// from the stake when the ring is stamped, sag while their hero stands close and pull taut at the rope.
//
// One InstancedMesh draws every chain: the unit is the Tripo link model (prop_chain_link: three interlocking rope-cast
// links) laid along +Z, tiled end to end. Holographic like the spirit dragons: a semi-opaque body in the ring's colours
// with a bright rim, scanlines and light running along the links (premultiplied alpha, so it reads on a bright arena).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { World, Zone } from '../game/World';
import { hasProp, loadManifest, propModel } from './Assets';

/** chain units drawn at once (a ring is ~65, a tether ~12 with its shackle) */
const MAX = 360;
/** metres of chain one unit covers */
const UNIT = 0.9;
/** the stake the chains are made fast to: height of its head above the ring */
const STAKE_H = 1.5;

const VERT = /* glsl */`
varying vec3 vN; varying vec3 vWorld; varying vec3 vView; varying vec2 vUv; varying float vK;
void main() {
  vec4 p = vec4(position, 1.0); vec3 n = normal; vK = 1.0;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vK = instanceColor.r;
  #endif
  vec4 wp = modelMatrix * p;
  vWorld = wp.xyz; vN = normalize(mat3(modelMatrix) * n); vView = normalize(cameraPosition - wp.xyz); vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FRAG = /* glsl */`
uniform float uTime; uniform vec3 uColA; uniform vec3 uColB; uniform sampler2D uMap; uniform float uHasMap;
varying vec3 vN; varying vec3 vWorld; varying vec3 vView; varying vec2 vUv; varying float vK;
void main() {
  if (vK < 0.004) discard;
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.2);
  float scan = 0.5 + 0.5 * sin(vWorld.y * 46.0 - uTime * 6.0);                                  // hologram scanlines
  float run = 0.5 + 0.5 * sin(dot(vWorld.xz, vec2(1.7, 1.3)) * 1.4 - uTime * 5.5);              // light running down the links
  vec3 tex = mix(vec3(0.8), texture2D(uMap, vUv).rgb, uHasMap);
  float lum = dot(tex, vec3(0.299, 0.587, 0.114));
  vec3 body = mix(uColA, uColB, run * 0.75) * (0.35 + 0.9 * lum);
  float a = (0.5 + 0.16 * scan) * (0.92 + 0.08 * sin(uTime * 43.0 + vWorld.x * 3.0));           // a little flicker
  vec3 rim = mix(uColB, vec3(1.0), 0.55) * fres * 1.25;
  gl_FragColor = vec4((body * a + rim) * vK, a * vK);                                           // premultiplied
}`;

function holo(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: { uTime: { value: 0 }, uColA: { value: new THREE.Color('#2fe0c8') }, uColB: { value: new THREE.Color('#ffd27a') }, uMap: { value: null }, uHasMap: { value: 0 } },
  });
}

/** the stand-in until the Tripo link is in (and on a build without it): two interlocking oval links along +Z */
function plainLinks(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 2; k++) {
    const g = new THREE.TorusGeometry(0.17, 0.05, 8, 18);
    g.scale(1, 1.55, 1).rotateX(Math.PI / 2);          // an oval, long axis along Z
    if (k) g.rotateZ(Math.PI / 2);                      // every other link turned a quarter
    g.translate(0, 0, (k - 0.5) * UNIT * 0.5);
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

export class ChainCage {
  readonly mesh: THREE.InstancedMesh;
  private readonly mat = holo();
  private readonly stakes = new Map<number, THREE.Group>();
  private readonly stakeMat = holo();
  private n = 0;
  private readonly M = new THREE.Matrix4();
  private readonly Q = new THREE.Quaternion();
  private readonly R = new THREE.Quaternion();
  private readonly S = new THREE.Vector3(1, 1, 1);
  private readonly P = new THREE.Vector3();
  private readonly D = new THREE.Vector3();
  private readonly C = new THREE.Color();

  constructor(private readonly parent: THREE.Object3D) {
    this.mesh = new THREE.InstancedMesh(plainLinks(), this.mat, MAX);
    this.mesh.frustumCulled = false; this.mesh.castShadow = false; this.mesh.receiveShadow = false; this.mesh.renderOrder = 6;
    // one unit is always drawn (parked under the world, faded out): the program, its instancing buffers and the link's
    // texture are live from the match's warm-up on, so the first Grand Dohyo costs nothing
    this.n = 0; this.put(new THREE.Vector3(0, -500, 0), new THREE.Vector3(0, 0, 1), 0, 0);
    this.mesh.count = 1;
    parent.add(this.mesh);
    // ...and the stake's program (the same shader without instancing) the same way
    const speck = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), this.stakeMat);
    speck.position.y = -500; speck.frustumCulled = false; parent.add(speck);
    void this.load();
  }

  /** the Tripo link model: laid along +Z, one unit long (a little over, so neighbouring units' end links interlock) */
  private async load() {
    await loadManifest();
    if (!hasProp('prop_chain_link')) return;
    const m = await propModel('prop_chain_link');
    if (!m) return;
    m.updateMatrixWorld(true);
    const parts: THREE.BufferGeometry[] = []; let map: THREE.Texture | null = null;
    m.traverse(o => {
      const me = o as THREE.Mesh;
      if (!me.isMesh) return;
      const g = me.geometry.clone().applyMatrix4(me.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) return;
      parts.push(g);
      map ??= (me.material as THREE.MeshStandardMaterial).map ?? null;
    });
    if (!parts.length) return;
    const geo = parts.length > 1 ? mergeGeometries(parts) : parts[0];
    if (!geo) return;
    geo.computeBoundingBox();
    const b = geo.boundingBox!, size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    geo.translate(-c.x, -c.y, -c.z);
    // the chain's run is its longest side
    if (size.x >= size.y && size.x >= size.z) geo.rotateY(-Math.PI / 2);
    else if (size.y >= size.x && size.y >= size.z) geo.rotateX(Math.PI / 2);
    geo.scale(1, 1, 1).computeBoundingBox();
    const len = geo.boundingBox!.max.z - geo.boundingBox!.min.z;
    geo.scale(UNIT * 1.12 / len, UNIT * 1.12 / len, UNIT * 1.12 / len);
    geo.computeBoundingSphere();
    const old = this.mesh.geometry;
    this.mesh.geometry = geo; old.dispose();
    if (map) { this.mat.uniforms.uMap.value = map; this.mat.uniforms.uHasMap.value = 1; }
  }

  /** one chain unit at `p`, its run along `dir`, rolled `roll` about it, shown at strength `k` */
  private put(p: THREE.Vector3, dir: THREE.Vector3, roll: number, k: number) {
    if (this.n >= MAX) return;
    this.Q.setFromUnitVectors(Z, dir);
    this.Q.multiply(this.R.setFromAxisAngle(Z, roll));
    this.mesh.setMatrixAt(this.n, this.M.compose(p, this.Q, this.S));
    this.mesh.setColorAt(this.n, this.C.setRGB(k, k, k));
    this.n++;
  }

  /** units along a path of points (evenly `UNIT` apart along it), each shown at `k` */
  private run(pts: THREE.Vector3[], k: number, roll0 = 0) {
    for (let i = 0; i + 1 < pts.length; i++) {
      this.P.addVectors(pts[i], pts[i + 1]).multiplyScalar(0.5);
      this.D.subVectors(pts[i + 1], pts[i]);
      if (this.D.lengthSq() < 1e-6) continue;
      this.put(this.P, this.D.normalize(), roll0 + i * 0.35, k);
    }
  }

  private stake(z: Zone): THREE.Group {
    let g = this.stakes.get(z.id);
    if (g) return g;
    g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.2, STAKE_H, 12), this.stakeMat); post.position.y = STAKE_H / 2; g.add(post);
    const head = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.07, 8, 24), this.stakeMat); head.rotation.x = Math.PI / 2; head.position.y = STAKE_H; g.add(head);
    const foot = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.05, 6, 32), this.stakeMat); foot.rotation.x = Math.PI / 2; foot.position.y = 0.1; g.add(foot);
    for (const m of g.children) (m as THREE.Mesh).frustumCulled = false;
    g.position.set(z.x, z.y, z.z);
    this.parent.add(g); this.stakes.set(z.id, g);
    return g;
  }

  update(w: World, now: number) {
    this.mat.uniforms.uTime.value = now; this.stakeMat.uniforms.uTime.value = now;
    this.n = 1;                                            // [0] is the parked unit
    const live = new Set<number>();
    for (const z of w.zones) {
      if (z.kind !== 'dohyo' || now >= z.until) continue;
      live.add(z.id);
      const left = z.until - now, grow = Math.min(1, (now - z.born) / 0.45);
      const k = left < 0.5 ? (Math.sin(now * 60) > 0 ? left * 2 : 0.25) : 1;      // flickers out with the wall
      const st = this.stake(z); st.scale.set(1, Math.max(0.01, grow), 1); st.visible = true;
      // ---- the chain round the ring, at the rope: it crawls slowly round and hangs in swags between the four tassels
      const N = Math.ceil(2 * Math.PI * z.r / UNIT), shown = Math.ceil(N * grow), a0 = now * 0.12;
      const ring: THREE.Vector3[] = [];
      for (let i = 0; i <= shown; i++) {
        const a = a0 + i / N * Math.PI * 2;
        ring.push(new THREE.Vector3(z.x + Math.cos(a) * z.r, z.y + 1.25 + 0.22 * Math.cos((a - a0) * 4 + Math.PI) , z.z + Math.sin(a) * z.r));
      }
      this.run(ring, k);
      // ---- a chain from the stake to everyone the ring holds
      const head = new THREE.Vector3(z.x, z.y + STAKE_H * grow, z.z);
      for (const id of (z.data?.trapped as number[] | undefined) ?? []) {
        const x = w.actors.find(o => o.id === id);
        if (!x || !x.alive || !x.has('chained', now)) continue;
        const c = x.center, end = new THREE.Vector3(c.x, c.y, c.z), reach = head.distanceTo(end);
        // slack: the chain is as long as the ring is wide, so it sags while its hero stands close and is taut at the rope
        const sag = Math.max(0.08, Math.min(1.3, (z.r + 0.6 - reach) * 0.22));
        const n = Math.max(2, Math.ceil(reach / UNIT)), upTo = Math.ceil(n * grow), pts: THREE.Vector3[] = [];
        for (let i = 0; i <= upTo; i++) {
          const s = i / n, p = new THREE.Vector3().lerpVectors(head, end, s);
          p.y = Math.max(z.y + 0.14, p.y - sag * 4 * s * (1 - s) + 0.03 * Math.sin(now * 9 + i * 1.7 + id));   // a live, rattling chain
          pts.push(p);
        }
        this.run(pts, k, id);
        if (grow < 1) continue;
        // the shackle: the chain looped once round them
        const rr = x.radius * x.scale + 0.2, loops = Math.max(4, Math.ceil(2 * Math.PI * rr / UNIT)), sh: THREE.Vector3[] = [];
        for (let i = 0; i <= loops; i++) { const a = i / loops * Math.PI * 2 + now * 0.8; sh.push(new THREE.Vector3(c.x + Math.cos(a) * rr, c.y - 0.05 + 0.06 * Math.sin(a * 2), c.z + Math.sin(a) * rr)); }
        this.run(sh, k, id + 1);
      }
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    for (const [id, g] of this.stakes) if (!live.has(id)) { this.parent.remove(g); this.stakes.delete(id); for (const m of g.children) (m as THREE.Mesh).geometry.dispose(); }
  }
}

const Z = new THREE.Vector3(0, 0, 1);
