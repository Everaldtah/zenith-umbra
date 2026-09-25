// "The Oath at Dawn - Engine Cut": the renderer side. Sets are the game's own maps (MapScene), the cast are the game's
// rigged heroes (CharacterView + Animator), effects come from the game's Fx system. An anime post pass (ink lines from a
// Sobel on colour + depth-ish luminance, cel banding, grading) sits on top.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MAP } from '../data/maps';
import { LEVEL, BOSSES } from '../campaign/data';
import { HERO, PILOTS, type HeroDef } from '../data/heroes';
import { ROBOTS } from '../data/robots';
import { skinsFor } from '../data/skins';
import { Level } from '../engine/Physics';
import { MapScene } from '../render/MapScene';
import { CharacterView } from '../render/CharacterView';
import { Fx } from '../render/Fx';
import { Actor } from '../game/Actor';
import { PRESETS } from '../client/Settings';
import type { GameEvent } from '../game/World';

// ---------------------------------------------------------------- anime post pass
const AnimeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null }, res: { value: new THREE.Vector2(1920, 1080) },
    ink: { value: 0.85 }, bands: { value: 5.0 }, sat: { value: 1.18 }, tint: { value: new THREE.Color(1, 1, 1) },
    exposure: { value: 1.0 }, vignette: { value: 0.35 }, flash: { value: 0.0 }, invert: { value: 0.0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 res; uniform float ink, bands, sat, exposure, vignette, flash, invert; uniform vec3 tint;
    varying vec2 vUv;
    float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    void main(){
      vec2 px = 2.0 / res;
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // ink: sobel on luminance
      float tl = lum(texture2D(tDiffuse, vUv + px * vec2(-1., 1.)).rgb), t = lum(texture2D(tDiffuse, vUv + px * vec2(0., 1.)).rgb), tr = lum(texture2D(tDiffuse, vUv + px * vec2(1., 1.)).rgb);
      float l = lum(texture2D(tDiffuse, vUv + px * vec2(-1., 0.)).rgb), r = lum(texture2D(tDiffuse, vUv + px * vec2(1., 0.)).rgb);
      float bl = lum(texture2D(tDiffuse, vUv + px * vec2(-1., -1.)).rgb), b = lum(texture2D(tDiffuse, vUv + px * vec2(0., -1.)).rgb), br = lum(texture2D(tDiffuse, vUv + px * vec2(1., -1.)).rgb);
      float gx = -tl - 2.*l - bl + tr + 2.*r + br, gy = -tl - 2.*t - tr + bl + 2.*b + br;
      float edge = smoothstep(0.55, 1.1, sqrt(gx*gx + gy*gy));
      // cel: band the luminance, keep hue
      float L = lum(c);
      float Lb = floor(L * bands + 0.5) / bands;
      vec3 cel = c * (Lb / max(L, 1e-3));
      c = mix(c, cel, 0.4);
      // grade
      c = mix(vec3(lum(c)), c, sat) * tint * exposure;
      c = mix(c, c * 0.18, edge * ink * 0.8);
      float v = distance(vUv, vec2(0.5)); c *= 1.0 - vignette * smoothstep(0.35, 0.85, v);
      c = mix(c, vec3(1.0), flash);
      c = mix(c, vec3(1.0) - c, invert);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export interface Grade { tint?: string; exposure?: number; sat?: number; ink?: number; vignette?: number; }

// ---------------------------------------------------------------- sets
export interface SetDef { id: string; map: string; campaign?: boolean }
export class FilmSet {
  scene = new THREE.Scene();
  level: Level; fx: Fx; mapScene: MapScene;
  props = new THREE.Group();
  constructor(public id: string, mapId: string, env: THREE.Texture) {
    const map = MAP[mapId] ?? LEVEL[mapId]?.map;
    this.level = new Level(map);
    this.mapScene = new MapScene(map, this.level, PRESETS.high, this.scene);
    this.scene.environment = env; this.scene.environmentIntensity = 0.55;
    this.fx = new Fx(this.scene, 8000);
    this.scene.add(this.props);
  }
  ground(x: number, z: number) { const g = this.level.groundAt(x, z, 40); return Number.isFinite(g) ? g : 0; }
}

// ---------------------------------------------------------------- cast
const EXTRA: Record<string, HeroDef> = {
  vorn: { ...HERO.gorgoth, id: 'vorn', name: 'Warlord Vorn', frame: 'human', height: 1.85, radius: 0.4, pilot: undefined, jets: undefined },
  haruto: PILOTS.tenkai,
  qelvaris: BOSSES.qelvaris as unknown as HeroDef,
  boss_genesis: BOSSES.boss_genesis as unknown as HeroDef,
};
export const defOf = (id: string): HeroDef => HERO[id] ?? EXTRA[id] ?? ROBOTS[id];

export class Cast {
  views = new Map<string, CharacterView>();
  actors = new Map<string, Actor>();
  /** key "mirei" or a clone "mirei#2" (choir, twins); skin picks a colourway for clones */
  get(key: string) {
    let v = this.views.get(key);
    if (!v) {
      const [id, tag] = key.split('#'), def = defOf(id);
      // clones wear another colourway (the choir, Yuzu's twin brother)
      const skins = HERO[id] ? skinsFor(id, def.team) : [];
      const skin = tag && skins.length ? skins[(tag === 'brother' ? 2 : +tag || 1) % skins.length].id : 'classic';
      const a = new Actor(def, def.team);
      a.grounded = true;
      v = new CharacterView(a, 'zenith', skin);
      v.rim.value = 0;
      this.views.set(key, v); this.actors.set(key, a);
    }
    return { view: v, actor: this.actors.get(key)! };
  }
}

// ---------------------------------------------------------------- props built in code
export function sacredTree(): THREE.Group {
  const g = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ color: '#4a2f24', roughness: 0.9 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.2, 12, 12), bark); trunk.position.y = 6; g.add(trunk);
  for (let i = 0; i < 6; i++) {
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 7, 8), bark);
    const a = i / 6 * Math.PI * 2; br.position.set(Math.cos(a) * 2.4, 11, Math.sin(a) * 2.4); br.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9); g.add(br);
  }
  const bloom = new THREE.MeshStandardMaterial({ color: '#ffb7d5', emissive: new THREE.Color('#ff7fb8'), emissiveIntensity: 0.45, roughness: 0.8 });
  const blob = new THREE.IcosahedronGeometry(1, 1);
  const inst = new THREE.InstancedMesh(blob, bloom, 70);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 6, y = 11 + Math.random() * 6;
    const s = 1.6 + Math.random() * 1.8;
    m.compose(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.8, s));
    inst.setMatrixAt(i, m);
  }
  g.add(inst);
  // sacred rope + paper seals
  const rope = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.18, 8, 32), new THREE.MeshStandardMaterial({ color: '#e8d9a8' }));
  rope.rotation.x = Math.PI / 2; rope.position.y = 4; g.add(rope);
  const paper = new THREE.MeshStandardMaterial({ color: '#fffaf0', emissive: new THREE.Color('#fff2c0'), emissiveIntensity: 0.6, side: THREE.DoubleSide });
  for (let i = 0; i < 10; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 1.1), paper);
    const a = i / 10 * Math.PI * 2; p.position.set(Math.cos(a) * 2.05, 3.3, Math.sin(a) * 2.05); p.rotation.y = -a; p.name = 'seal'; g.add(p);
  }
  const glow = new THREE.PointLight('#ffb7d5', 30, 30, 1.6); glow.position.y = 12; glow.name = 'glow'; g.add(glow);
  g.scale.setScalar(0.6);            // fits the shrine island and the frame
  return g;
}

export function sealStone(): THREE.Group {
  const g = new THREE.Group();
  const rock = new THREE.MeshStandardMaterial({ color: '#2b2630', roughness: 0.95 });
  const half = (sx: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 6, 3), rock); m.position.set(sx * 1.2, 3, 0); m.name = sx < 0 ? 'L' : 'R'; return m; };
  g.add(half(-1), half(1));
  const rune = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.3, 6), new THREE.MeshBasicMaterial({ color: '#ff2a3a', side: THREE.DoubleSide, transparent: true }));
  rune.position.set(0, 3.2, 1.52); rune.name = 'rune'; g.add(rune);
  const chainMat = new THREE.MeshStandardMaterial({ color: '#555', metalness: 0.8, roughness: 0.4 });
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.12, 6, 40), chainMat);
    c.position.y = 1.5 + i * 1.6; c.rotation.x = Math.PI / 2 + (i - 1) * 0.2; c.name = 'chain'; g.add(c);
  }
  const light = new THREE.PointLight('#ff2a3a', 20, 18, 1.5); light.position.set(0, 3, 3); light.name = 'glow'; g.add(light);
  return g;
}

/** a sky disc: the sun, a blood moon, the eclipse (black disc + corona ring) */
export function skyDisc(color: string, r: number, corona = false): THREE.Group {
  const g = new THREE.Group();
  const d = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ color, fog: false }));
  d.name = 'disc'; g.add(d);
  if (corona) {
    const c = new THREE.Mesh(new THREE.RingGeometry(r * 1.0, r * 1.5, 64), new THREE.MeshBasicMaterial({ color: '#ff7a3a', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, fog: false, depthWrite: false }));
    c.name = 'corona'; g.add(c);
  }
  return g;
}

export function scarf(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(2.2, 0.35, 24, 1);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#ff8a2a', side: THREE.DoubleSide, emissive: new THREE.Color('#5a2000'), emissiveIntensity: 0.4 }));
  m.userData.base = geo.attributes.position.array.slice();
  return m;
}
export function waveScarf(m: THREE.Mesh, t: number) {
  const p = m.geometry.attributes.position as THREE.BufferAttribute, b = m.userData.base as Float32Array;
  for (let i = 0; i < p.count; i++) { const x = b[i * 3]; p.setZ(i, Math.sin(x * 3 + t * 4) * 0.25 * (x + 1.1)); p.setY(i, b[i * 3 + 1] + Math.sin(x * 2 + t * 3) * 0.1); }
  p.needsUpdate = true;
}

// ---------------------------------------------------------------- rain / embers / stars (camera-local particle fields)
export class Weather {
  points: THREE.LineSegments; kind: 'rain' | 'embers' | 'stars' | 'none' = 'none';
  private pos: Float32Array; private N = 2400;
  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(this.N * 6);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#9fc6ff', transparent: true, opacity: 0.5, depthWrite: false, fog: false }));
    this.points.frustumCulled = false; scene.add(this.points);
    this.reset();
  }
  attach(scene: THREE.Scene) { scene.add(this.points); }
  set(kind: Weather['kind']) {
    this.kind = kind; this.points.visible = kind !== 'none';
    const m = this.points.material as THREE.LineBasicMaterial;
    m.color.set(kind === 'rain' ? '#9fc6ff' : kind === 'embers' ? '#ff8a3a' : '#fff6d8'); m.opacity = kind === 'rain' ? 0.45 : 0.9;
    m.blending = kind === 'rain' ? THREE.NormalBlending : THREE.AdditiveBlending;
  }
  private reset() { for (let i = 0; i < this.N; i++) this.seed(i, Math.random() * 30); }
  private seed(i: number, y: number) {
    const x = (Math.random() - 0.5) * 60, z = (Math.random() - 0.5) * 60;
    this.pos.set([x, y, z, x, y, z], i * 6);
  }
  update(dt: number, cam: THREE.Camera, t: number) {
    if (this.kind === 'none') return;
    const c = cam.position;
    for (let i = 0; i < this.N; i++) {
      const o = i * 6;
      let x = this.pos[o], y = this.pos[o + 1], z = this.pos[o + 2];
      if (this.kind === 'rain') { y -= 38 * dt; x += 4 * dt; }
      else if (this.kind === 'embers') { y += (2 + (i % 5)) * dt; x += Math.sin(t * 2 + i) * dt * 1.5; }
      else { y += Math.sin(t + i) * dt * 0.1; }
      if (y < -2 || y > 32) { this.seed(i, this.kind === 'embers' ? -1 : 30); continue; }
      const len = this.kind === 'rain' ? 0.9 : this.kind === 'embers' ? 0.12 : 0.06;
      this.pos.set([x, y, z, x - (this.kind === 'rain' ? 0.1 : 0), y + len, z], o);
    }
    this.points.position.set(c.x, 0, c.z);
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ---------------------------------------------------------------- the stage
export class Stage {
  renderer: THREE.WebGLRenderer;
  camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 1500);
  composer: EffectComposer; anime: ShaderPass; bloom: UnrealBloomPass; render: RenderPass;
  sets = new Map<string, FilmSet>();
  set: FilmSet | null = null;
  cast = new Cast();
  weather: Weather;
  env: THREE.Texture;
  private onStage = new Set<string>();
  shake = 0;

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    host.append(this.renderer.domElement);
    this.env = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    this.composer = new EffectComposer(this.renderer);
    this.render = new RenderPass(new THREE.Scene(), this.camera);
    this.composer.addPass(this.render);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1920, 1080), 0.35, 0.5, 0.9);
    this.composer.addPass(this.bloom);
    this.anime = new ShaderPass(AnimeShader);
    this.composer.addPass(this.anime);
    this.composer.addPass(new OutputPass());
    this.weather = new Weather(new THREE.Scene());
    this.resize(); addEventListener('resize', () => this.resize());
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h); this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    (this.anime.uniforms.res.value as THREE.Vector2).set(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
  }
  use(setId: string, mapId: string) {
    let s = this.sets.get(setId);
    if (!s) { s = new FilmSet(setId, mapId, this.env); this.sets.set(setId, s); }
    if (this.set !== s) {
      this.set = s; this.render.scene = s.scene; this.weather.attach(s.scene);
      for (const k of this.onStage) { const v = this.cast.views.get(k); if (v) v.group.removeFromParent(); }
      this.onStage.clear();
    }
    return s;
  }
  /** put a cast member on the current set (removing anyone not listed this shot) */
  stageCast(keys: string[]) {
    for (const k of [...this.onStage]) if (!keys.includes(k)) { this.cast.views.get(k)?.group.removeFromParent(); this.onStage.delete(k); }
    for (const k of keys) { const { view } = this.cast.get(k); if (!this.onStage.has(k)) { this.set!.scene.add(view.group); this.onStage.add(k); } }
  }
  /** exposure trim per set, multiplied into every grade */
  setTrim: Record<string, number> = { training: 0.78, amatsu: 0.9 };
  grade(g: Grade) {
    const u = this.anime.uniforms;
    (u.tint.value as THREE.Color).set(g.tint ?? '#ffffff'); u.exposure.value = (g.exposure ?? 1) * (this.setTrim[this.set?.id ?? ''] ?? 1); u.sat.value = g.sat ?? 1.18;
    u.ink.value = g.ink ?? 0.85; u.vignette.value = g.vignette ?? 0.35;
  }
  fx(kind: string, pos: { x: number; y: number; z: number }, o: Partial<Extract<GameEvent, { t: 'fx' }>> = {}, now = 0) {
    this.set?.fx.onEvent({ t: 'fx', kind, pos, ...o } as GameEvent, now, this.camera.position);
  }
  frame(dt: number, time: number) {
    const s = this.set; if (!s) return;
    for (const k of this.onStage) this.cast.views.get(k)!.update(dt, time, { team: 'zenith', sees: () => true });
    s.fx.update(dt, { projs: [], zones: [], actors: [] } as any, time);
    s.mapScene.update(time, { owner: null, capture: 0, capTeam: null, contested: false }, 'zenith');
    this.weather.update(dt, this.camera, time);
    // camera shake (handheld impact)
    const sh = this.shake + s.fx.shake;
    if (sh > 0.001) { this.camera.position.x += (Math.random() - 0.5) * sh; this.camera.position.y += (Math.random() - 0.5) * sh; }
    this.shake *= Math.pow(0.02, dt);
    this.composer.render(dt);
  }
}
