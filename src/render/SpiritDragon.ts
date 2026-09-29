// Spirit koi-dragons for the Koryu ultimates (desktop edition), built the way Overwatch builds Hanzo's and Genji's:
//  - Seiran's Twin Koi Torrent (Dragonstrike): a summoning sigil opens on the aim line and two blue koi-dragons pour out
//    of it, twisting round each other in a double helix as they swim 45 m straight through the level, then dissolve.
//  - Hayate's Dragon Gate Blade (Dragonblade): as the nodachi is drawn a violet koi-dragon coils up around him and pours
//    into the blade; every cut of the ult then streaks the dragon through its target along the cut.
// The dragons are Tripo models rigged by assetgen/blender/rig_dragon.py: a straight rest spine (head toward +Z) skinned to
// a flat chain of joints. Each frame every joint is laid on the path the head has already swum, at its own rest distance
// behind the head (follow-the-leader: the body pours along the spiral like water through a pipe instead of sliding as a
// rigid mesh), with a travelling swim wave and a corkscrew roll on top. Joints still "behind" the start of the path
// collapse to a point, so the dragons emerge out of the sigil / the blade.
import * as THREE from 'three';
import { riggedModel } from './Assets';
import type { V3 } from '../engine/Physics';
import type { Actor } from '../game/Actor';
import { TWIN_R, TWIN_W } from '../game/abilities';

/** centreline of a swim at path distance u (metres from where the dragon emerges), t seconds after it was summoned */
type Path = (u: number, t: number, out: THREE.Vector3) => THREE.Vector3;
type Emit = (p: V3, color: THREE.Color, big: boolean) => void;

interface Rig {
  id: string; root: THREE.Object3D; mesh: THREE.SkinnedMesh; bones: THREE.Bone[];
  restW: THREE.Matrix4[]; restZ: number[]; headZ: number; len: number; mat: THREE.ShaderMaterial;
}
interface Swim {
  rig: Rig; path: Path; born: number; dur: number; delay: number; speed: number; lead: number; scale: number;
  /** cross-section relative to length: a coiling Dragonblade dragon is slender, Dragonstrike's twins are massive */
  girth: number;
  wave: number; roll: number; phase: number; color: THREE.Color; lastEmit: number;
}
interface Sigil { obj: THREE.Group; born: number; dur: number; mats: THREE.MeshBasicMaterial[] }

export const DRAGON_MODEL = { seiran: 'seiran_dragon', hayate: 'hayate_dragon' } as const;
const COL = { seiran: ['#4f9dff', '#8fd0ff'], hayate: ['#b36bff'] };

const VERT = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
varying vec2 vUv; varying vec3 vN; varying vec3 vView; varying float vAlong; varying vec3 vWorld;
void main() {
  vUv = uv; vAlong = position.z;
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vN = normalize(mat3(modelMatrix) * objectNormal);
  vView = cameraPosition - wp.xyz; vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
// holographic spirit (Overwatch's Dragonstrike / Dragonblade dragons): a semi-opaque glowing body in the dragon's colour,
// the painted scale patterns lit up as energy veins over a procedural scale lattice, a hot iridescent fresnel rim, energy
// pulses racing snout -> tail, drifting hologram scanlines, glitch bands and flicker, a tail that thins to mist, and a
// noise dissolve with a glowing edge as the dragon materialises out of the sigil / blade and burns away at the end
const FRAG = /* glsl */`
uniform sampler2D map; uniform vec3 uCol; uniform vec3 uGlow; uniform float uTime; uniform float uAlpha;
uniform float uHead; uniform float uLen; uniform float uSeed;
varying vec2 vUv; varying vec3 vN; varying vec3 vView; varying float vAlong; varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec3 n = normalize(vN), v = normalize(vView);
  float fr = pow(1.0 - abs(dot(n, v)), 1.8);
  float back = clamp((uHead - vAlong) / uLen, 0.0, 1.0);          // 0 at the snout, 1 at the tail tip
  vec3 tex = texture2D(map, vUv).rgb;
  float lum = dot(tex, vec3(0.3, 0.59, 0.11));
  float vein = smoothstep(0.55, 0.9, lum);                         // the concept's glowing scale lines
  // scale lattice: offset rows of arcs along the body
  vec2 sc = vec2(vAlong * 3.2, vUv.y * 26.0); sc.x += step(1.0, mod(sc.y, 2.0)) * 0.5;
  vec2 cell = fract(sc) - vec2(0.5, 0.0);
  float scale = smoothstep(0.08, 0.0, abs(length(cell) - 0.55)) * 0.6;
  float pulse = pow(0.5 + 0.5 * sin(vAlong * 1.3 + uTime * 10.0), 8.0);                 // energy racing to the tail
  float scan = 0.5 + 0.5 * sin(vWorld.y * 38.0 - uTime * 7.0);                          // hologram scanlines
  float glitch = step(0.94, noise(vec2(floor(vWorld.y * 6.0), floor(uTime * 14.0) + uSeed)));
  float flicker = 0.9 + 0.1 * noise(vec2(uTime * 25.0, uSeed));
  vec3 irid = mix(uCol, uGlow, fr) + vec3(0.12, -0.05, 0.18) * sin(fr * 6.0 + uTime * 2.0);
  // the holographic body (semi-opaque, so it still reads over a bright white arena) ...
  vec3 body = irid * (0.8 + 0.8 * lum) + uGlow * (vein * 1.1 + scale * 0.5 + pulse * 0.7);   // self-lit: the texture only shades it
  body *= (0.85 + 0.25 * scan) * flicker;
  float bodyA = (0.55 + 0.35 * fr + 0.2 * vein) * (1.0 - smoothstep(0.6, 1.0, back) * 0.85);
  // ... plus light that only adds: the fresnel rim, a white-hot edge and glitch bands
  vec3 rim = uGlow * fr * 1.7 + vec3(1.0) * pow(fr, 5.0) * 0.4 + uGlow * glitch * 0.8;
  // dissolve: uAlpha 0..1 sweeps a noise threshold; the burning edge glows white-hot
  float dn = noise(vUv * 18.0 + vec2(uSeed)) * 0.7 + noise(vec2(vAlong * 0.9, uSeed)) * 0.3;
  float edge = uAlpha * 1.15 - dn;
  if (edge < 0.0) discard;
  rim += mix(uGlow, vec3(1.0), 0.6) * smoothstep(0.12, 0.0, edge) * 2.5;
  float k = min(1.0, uAlpha * 1.5);
  gl_FragColor = vec4(body * bodyA * k + rim * k, bodyA * k);   // premultiplied: dst * (1 - a) + body + rim
}`;

const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); WHITE.needsUpdate = true;
const V = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), XAX = new THREE.Vector3(1, 0, 0);

export class SpiritDragons {
  group = new THREE.Group();
  private proto = new Map<string, Promise<THREE.Object3D | null>>();
  private free = new Map<string, Rig[]>();
  private swims: Swim[] = [];
  private sigils: Sigil[] = [];
  private P: THREE.Vector3[] = []; private T: THREE.Vector3[] = []; private sq: number[] = [];
  private M = new THREE.Matrix4(); private n = V(); private b = V(); private tmp = V();

  constructor(parent: THREE.Object3D) {
    parent.add(this.group);
    for (const id of Object.values(DRAGON_MODEL)) this.proto.set(id, riggedModel(id));   // warm the GLB cache
  }

  // ------------------------------------------------------------------ rigs
  private async rig(id: string): Promise<Rig | null> {
    const pool = this.free.get(id);
    if (pool?.length) return pool.pop()!;
    if (!(await this.proto.get(id))) return null;
    const root = await riggedModel(id);
    if (!root) return null;
    let mesh: THREE.SkinnedMesh | null = null;
    root.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh; });
    if (!mesh) return null;
    const m = mesh as THREE.SkinnedMesh, sk = m.skeleton;
    // identity bind: the skinned vertex is then sum(w * jointWorld * inverseBind * v), so a joint's world matrix is simply
    // (where its slice of the body goes) * (that joint's rest pose) - no dependence on the glTF node hierarchy
    m.bind(sk, new THREE.Matrix4());
    // joints sorted snout -> tail (the solver walks the chain in that order); each keeps its own rest pose
    const js = sk.bones.map((bone, i) => { const w = sk.boneInverses[i].clone().invert(); return { bone, w, z: new THREE.Vector3().setFromMatrixPosition(w).z }; })
      .sort((p, q) => q.z - p.z);
    const bones = js.map(j => j.bone), restW = js.map(j => j.w), restZ = js.map(j => j.z);
    for (const bn of bones) { bn.matrixAutoUpdate = false; bn.matrixWorldAutoUpdate = false; }
    const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,   // premultiplied alpha
      uniforms: { map: { value: src?.map ?? WHITE }, uCol: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
        uTime: { value: 0 }, uAlpha: { value: 0 }, uHead: { value: Math.max(...restZ) }, uLen: { value: 1 }, uSeed: { value: Math.random() * 100 } },
    });
    m.material = mat; m.frustumCulled = false; m.castShadow = false; m.renderOrder = 5;
    const headZ = Math.max(...restZ), len = headZ - Math.min(...restZ);
    mat.uniforms.uLen.value = len;
    return { id, root, mesh: m, bones, restW, restZ, headZ, len, mat };
  }
  private release(r: Rig) { this.group.remove(r.root); (this.free.get(r.id) ?? this.free.set(r.id, []).get(r.id)!).push(r); }

  private async spawn(id: string, now: number, o: Omit<Swim, 'rig' | 'born' | 'lastEmit'>) {
    const rig = await this.rig(id);
    if (!rig) return;
    rig.mat.uniforms.uCol.value.copy(o.color); rig.mat.uniforms.uSeed.value = Math.random() * 100;
    rig.mat.uniforms.uGlow.value.copy(o.color).lerp(new THREE.Color('#ffffff'), 0.3);
    this.group.add(rig.root);
    this.swims.push({ rig, born: now, lastEmit: 0, ...o });
  }

  // ------------------------------------------------------------------ the three motions
  /** Twin Koi Torrent: sigil at `o`, two dragons in a double helix along o -> to (matches the ult's bite path) */
  twin(o: V3, to: V3, now: number, delay = 0.25, speed = 25) {
    const d = new THREE.Vector3(to.x - o.x, 0, to.z - o.z).normalize(), side = new THREE.Vector3(-d.z, 0, d.x);
    const R = TWIN_R, W = TWIN_W;                        // helix radius and turn rate: the same sway the ult's bites follow
    this.sigil(o, d, now, new THREE.Color(COL.seiran[0]), 1.1);
    [0, Math.PI].forEach((ph, k) => this.spawn(DRAGON_MODEL.seiran, now, {
      path: (u, _t, out) => out.set(
        o.x + d.x * u + side.x * R * Math.sin(W * u + ph), o.y + R * 0.7 * Math.cos(W * u + ph), o.z + d.z * u + side.z * R * Math.sin(W * u + ph)),
      dur: delay + 68 / speed, delay, speed, lead: 2, scale: 2.2, girth: 1.3, wave: 0.22, roll: 0.5, phase: ph, color: new THREE.Color(COL.seiran[k]),
    }));
  }
  /** Dragon Gate: the koi-dragon coils up around Hayate as the blade is drawn (follows him through the teleport cuts) */
  coil(a: Actor, now: number, firstPerson: boolean) {
    const r = firstPerson ? 1.8 : 1.45;                 // wide enough that the slender body wraps him, never through him
    this.spawn(DRAGON_MODEL.hayate, now, {
      path: (u, _t, out) => out.set(a.pos.x + Math.cos(u / r) * r, a.pos.y + 0.1 + u * 0.14, a.pos.z + Math.sin(u / r) * r),   // ground to over his head in ~1.2 turns/s
      dur: 1.2, delay: 0, speed: 17, lead: 0, scale: 0.8, girth: 0.4, wave: 0.12, roll: 0.35, phase: 0, color: new THREE.Color(COL.hayate[0]),
    });
  }
  /** one Dragon Gate cut: the dragon streaks through the target along the cut, corkscrewing */
  streak(from: V3, to: V3, now: number) {
    const d = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z), L = d.length() || 1;
    d.divideScalar(L);
    const s1 = Math.abs(d.y) > 0.9 ? XAX.clone() : new THREE.Vector3().crossVectors(UP, d).normalize(), s2 = new THREE.Vector3().crossVectors(d, s1);
    this.spawn(DRAGON_MODEL.hayate, now, {
      path: (u, _t, out) => out.set(from.x + d.x * u, from.y + d.y * u, from.z + d.z * u)
        .addScaledVector(s1, Math.cos(u * 1.6) * 0.45).addScaledVector(s2, Math.sin(u * 1.6) * 0.45),
      dur: 0.5, delay: 0, speed: Math.max(40, (L + 6) / 0.3), lead: 0, scale: 0.55, girth: 0.5, wave: 0.1, roll: 0.9, phase: 0, color: new THREE.Color(COL.hayate[0]),
    });
  }

  /** Dragonstrike's summoning sigil: concentric rings and a spinning eight-petal seal facing down the aim */
  private sigil(o: V3, d: THREE.Vector3, now: number, c: THREE.Color, size = 1) {
    const g = new THREE.Group(), mats: THREE.MeshBasicMaterial[] = [];
    const mk = (geo: THREE.BufferGeometry) => {
      const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
      mats.push(m); const me = new THREE.Mesh(geo, m); g.add(me); return me;
    };
    mk(new THREE.RingGeometry(2.3, 2.5, 64)); mk(new THREE.RingGeometry(1.55, 1.65, 64)); mk(new THREE.RingGeometry(0.5, 0.62, 32));
    for (let k = 0; k < 8; k++) {
      const petal = mk(new THREE.PlaneGeometry(0.16, 1.1)); petal.position.set(Math.cos(k * Math.PI / 4) * 1.95, Math.sin(k * Math.PI / 4) * 1.95, 0);
      petal.rotation.z = k * Math.PI / 4 + Math.PI / 2;
    }
    g.scale.setScalar(size); g.userData.size = size;
    g.position.set(o.x, o.y, o.z); g.lookAt(o.x + d.x, o.y + d.y, o.z + d.z);
    this.group.add(g); this.sigils.push({ obj: g, born: now, dur: 1.5, mats });
  }

  // ------------------------------------------------------------------ per frame
  update(now: number, emit: Emit) {
    for (const sg of this.sigils) {
      const k = (now - sg.born) / sg.dur;
      sg.obj.scale.setScalar((sg.obj.userData.size ?? 1) * (0.3 + 0.7 * Math.min(1, k * 5)));
      sg.obj.children.forEach((c, i) => { c.rotation.z += (i % 2 ? -1 : 1) * 0.02; });
      sg.mats.forEach(m => { m.opacity = Math.min(1, k * 6) * (1 - Math.max(0, (k - 0.55) / 0.45)); });
      if (k >= 1) { this.group.remove(sg.obj); sg.obj.traverse(o => (o as THREE.Mesh).geometry?.dispose()); sg.mats.forEach(m => m.dispose()); }
    }
    this.sigils = this.sigils.filter(sg => now - sg.born < sg.dur);
    this.swims = this.swims.filter(s => {
      const t = now - s.born;
      if (t >= s.dur) { this.release(s.rig); return false; }
      this.pose(s, t);
      const fade = Math.min(1, t / 0.3) * Math.min(1, (s.dur - t) / 0.5);   // materialise, then burn away
      s.rig.mat.uniforms.uAlpha.value = fade;
      s.rig.mat.uniforms.uTime.value = now;
      if (now - s.lastEmit > 0.035 && fade > 0.2) {      // mist shed from the snout and a random stretch of the body
        s.lastEmit = now;
        emit(this.P[0], s.color, true);
        emit(this.P[1 + Math.floor(Math.random() * (this.P.length - 1))], s.color, false);
      }
      return true;
    });
  }

  /** lay every joint on the swum path (follow-the-leader), add the swim wave, then orient each by its neighbours */
  private pose(s: Swim, t: number) {
    const r = s.rig, n = r.bones.length, sc = s.scale;
    const uh = Math.max(0, t - s.delay) * s.speed + s.lead;
    while (this.P.length < n) { this.P.push(V()); this.T.push(V()); this.sq.push(1); }
    for (let i = 0; i < n; i++) {
      const back = (r.headZ - r.restZ[i]) * sc, u = uh - back;
      this.sq[i] = THREE.MathUtils.smoothstep(u, -1.2 * sc, 0.4 * sc);   // still inside the sigil / blade: collapsed
      s.path(Math.max(0, u), t, this.P[i]);
    }
    // travelling swim wave (grows toward the tail) across the direction of travel
    for (let i = 0; i < n; i++) {
      const a = Math.min(n - 1, i + 1), b = Math.max(0, i - 1);
      this.tmp.subVectors(this.P[b], this.P[a]);
      if (this.tmp.lengthSq() < 1e-8) this.tmp.set(0, 0, 1);
      this.T[i].copy(this.tmp).normalize();
    }
    for (let i = 0; i < n; i++) {
      const back = (r.headZ - r.restZ[i]) / r.len;
      const w = s.wave * sc * s.girth * (0.25 + 0.75 * back) * Math.sin(back * 9.5 - t * 9 + s.phase) * this.sq[i];
      this.n.crossVectors(Math.abs(this.T[i].y) > 0.95 ? XAX : UP, this.T[i]).normalize();
      this.P[i].addScaledVector(this.n, w);
    }
    for (let i = 0; i < n; i++) {
      const a = Math.min(n - 1, i + 1), b = Math.max(0, i - 1);
      this.tmp.subVectors(this.P[b], this.P[a]);
      if (this.tmp.lengthSq() > 1e-8) this.T[i].copy(this.tmp).normalize();
      const T = this.T[i];
      this.n.crossVectors(Math.abs(T.y) > 0.95 ? XAX : UP, T).normalize();
      this.b.crossVectors(T, this.n);
      const roll = s.roll * Math.sin((uh - (r.headZ - r.restZ[i]) * sc) * 0.36 + s.phase);
      const cr = Math.cos(roll), sr = Math.sin(roll);
      const nx = this.n.x * cr + this.b.x * sr, ny = this.n.y * cr + this.b.y * sr, nz = this.n.z * cr + this.b.z * sr;
      const bx = -this.n.x * sr + this.b.x * cr, by = -this.n.y * sr + this.b.y * cr, bz = -this.n.z * sr + this.b.z * cr;
      const q = sc * s.girth * Math.max(0.001, this.sq[i]), z = r.restZ[i], P = this.P[i], e = this.M.elements;
      e[0] = nx * q; e[1] = ny * q; e[2] = nz * q; e[3] = 0;
      e[4] = bx * q; e[5] = by * q; e[6] = bz * q; e[7] = 0;
      e[8] = T.x * sc; e[9] = T.y * sc; e[10] = T.z * sc; e[11] = 0;
      e[12] = P.x - T.x * sc * z; e[13] = P.y - T.y * sc * z; e[14] = P.z - T.z * sc * z; e[15] = 1;
      r.bones[i].matrixWorld.multiplyMatrices(this.M, r.restW[i]);
    }
  }
}
