// The 2D anime stage: an orthographic three.js compositor for painted layers (no 3D assets).
// Layers: background plates split into parallax depths, character drawings on deformable meshes (breath / hair & cloth sway /
// squash-stretch), a 2D FX canvas (particles, lines, lightning...), and a film post pass (grain, weave, bloom, chroma, impact frames).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export const W = 1920, H = 1080;
const loader = new THREE.TextureLoader();
const texCache = new Map<string, Promise<THREE.Texture>>();
export function tex(url: string) {
  let p = texCache.get(url);
  if (!p) { p = loader.loadAsync(url).then(t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }); texCache.set(url, p); }
  return p;
}
const ready = new Map<string, THREE.Texture>();
export async function preload(urls: string[], onEach?: () => void) {
  await Promise.all(urls.map(u => tex(u).then(t => { ready.set(u, t); onEach?.(); }).catch(() => onEach?.())));
}
export const T = (url: string) => ready.get(url) ?? null;

// ---------------------------------------------------------------- sprite: a drawing on a deformable mesh
const SpriteShader = {
  uniforms: { map: { value: null as THREE.Texture | null }, time: { value: 0 }, breath: { value: 1 }, sway: { value: 0.6 }, wind: { value: 0 },
    squash: { value: 0 }, tint: { value: new THREE.Color(1, 1, 1) }, flash: { value: 0 }, rim: { value: new THREE.Color(0, 0, 0) }, opacity: { value: 1 }, sil: { value: 0 } },
  vertexShader: `
    uniform float time, breath, sway, wind, squash; varying vec2 vUv;
    void main(){
      vUv = uv; vec3 p = position;
      float h = uv.y;                                   // 0 feet .. 1 head
      // breathing: the chest rises, shoulders lift a hair
      p.y += sin(time * 2.2) * 2.2 * breath * smoothstep(0.35, 0.8, h);
      p.x *= 1.0 + sin(time * 2.2) * 0.004 * breath * smoothstep(0.4, 0.75, h);
      // hair / cloth sway: grows with height from the hips and toward the silhouette edges, with wind lean
      float edge = abs(uv.x - 0.5) * 2.0;
      float s = sin(time * 1.7 + h * 3.0) * 6.0 * sway + wind * 18.0;
      p.x += s * smoothstep(0.55, 1.0, h) * (0.3 + edge) + s * 0.6 * (1.0 - smoothstep(0.0, 0.45, h)) * edge * 0.6;
      // squash & stretch around the feet (landings, impacts)
      p.y *= 1.0 - squash; p.x *= 1.0 + squash * 0.6;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D map; uniform vec3 tint, rim; uniform float flash, opacity, sil; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(map, vUv);
      if (c.a < 0.02) discard;
      vec3 col = c.rgb * tint;
      // rim light: brighten pixels near the alpha edge (sampled offsets)
      float e = 0.0; vec2 d = vec2(0.004, 0.0);
      e += 1.0 - texture2D(map, vUv + d).a; e += 1.0 - texture2D(map, vUv - d).a; e += 1.0 - texture2D(map, vUv + d.yx).a;
      col += rim * clamp(e, 0.0, 1.0);
      col = mix(col, vec3(1.0), flash);
      col = mix(col, vec3(0.02, 0.01, 0.04), sil);
      gl_FragColor = vec4(col, c.a * opacity);
    }`,
};
export class Sprite {
  mesh: THREE.Mesh; mat: THREE.ShaderMaterial; url = '';
  constructor(public stage: Stage2D) {
    this.mat = new THREE.ShaderMaterial({ ...SpriteShader, uniforms: THREE.UniformsUtils.clone(SpriteShader.uniforms), transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 8, 24), this.mat);
    this.mesh.visible = false;
  }
  /** show drawing `url` with its feet at (x, y) screen px, height h px; flip mirrors it */
  set(url: string, x: number, y: number, h: number, o: { flip?: boolean; rot?: number; z?: number; breath?: number; sway?: number; wind?: number; squash?: number; tint?: string; flash?: number; rim?: string; opacity?: number; sil?: number } = {}) {
    const t = T(url); if (!t) { this.mesh.visible = false; return; }
    const img = t.image as { width: number; height: number };
    const w = h * img.width / img.height;
    if (this.url !== url) { this.mat.uniforms.map.value = t; this.url = url; }
    this.mesh.visible = true;
    this.mesh.geometry.dispose(); this.mesh.geometry = new THREE.PlaneGeometry(w, h, 8, 24); this.mesh.geometry.translate(0, h / 2, 0);
    this.mesh.position.set(x, H - y, o.z ?? 0);
    this.mesh.scale.set(o.flip ? -1 : 1, 1, 1); this.mesh.rotation.z = o.rot ?? 0;
    const u = this.mat.uniforms;
    u.breath.value = o.breath ?? 1; u.sway.value = o.sway ?? 0.6; u.wind.value = o.wind ?? 0; u.squash.value = o.squash ?? 0;
    (u.tint.value as THREE.Color).set(o.tint ?? '#ffffff'); u.flash.value = o.flash ?? 0; (u.rim.value as THREE.Color).set(o.rim ?? '#000000');
    u.opacity.value = o.opacity ?? 1; u.sil.value = o.sil ?? 0;
  }
}

// ---------------------------------------------------------------- background plate: parallax layers (far / mid / near)
export class Plate {
  meshes: THREE.Mesh[] = [];
  constructor(public stage: Stage2D) {
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      m.visible = false; this.meshes.push(m);
    }
  }
  /** cam: pan x/y in px, zoom (1 = fit), per-layer parallax factors */
  set(base: string, cam: { x: number; y: number; zoom: number; rot?: number }, o: { layers?: boolean; tint?: string; bright?: number } = {}) {
    const urls = o.layers ? [`${base}_far.webp`, `${base}.webp`, `${base}_near.webp`] : [`${base}.webp`];
    const par = [0.35, 1, 1.6];
    this.meshes.forEach((m, i) => {
      const url = urls.length === 3 ? urls[i] : i === 1 ? urls[0] : '';
      const t = url ? T(url) : null;
      m.visible = !!t;
      if (!t) return;
      const mat = m.material as THREE.MeshBasicMaterial;
      if (mat.map !== t) { mat.map = t; mat.needsUpdate = true; }
      mat.color.set(o.tint ?? '#ffffff').multiplyScalar(o.bright ?? 1);
      const k = urls.length === 3 ? par[i] : 1;
      const z = 1 + (cam.zoom - 1) * k, s = 1.12 * z;       // plates are over-scanned 12% so pans never show an edge
      m.scale.set(W * s, H * s, 1);
      m.position.set(W / 2 - cam.x * k, H / 2 + cam.y * k, -10 + i);
      m.rotation.z = (cam.rot ?? 0) * k;
    });
  }
}

// ---------------------------------------------------------------- film post pass
const FilmShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.06 }, impact: { value: 0 }, flash: { value: 0 }, chroma: { value: 0.0015 },
    vignette: { value: 0.35 }, tint: { value: new THREE.Color(1, 1, 1) }, sat: { value: 1.08 }, weave: { value: 0.0006 }, fade: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, grain, impact, flash, chroma, vignette, sat, weave, fade; uniform vec3 tint; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv + vec2(sin(time * 23.0) * weave, cos(time * 17.0) * weave);   // gate weave
      vec2 dc = (uv - 0.5) * chroma;
      vec3 c = vec3(texture2D(tDiffuse, uv + dc).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - dc).b);
      float L = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(L), c, sat) * tint;
      // impact frame: two-tone posterise (white figure / black ground or inverse)
      if (impact > 0.0) { float b = step(0.42, L); vec3 two = impact > 1.5 ? vec3(1.0 - b) : vec3(b); two = mix(two, two * vec3(1.0, 0.25, 0.2), impact > 2.5 ? 1.0 : 0.0); c = mix(c, two, min(impact, 1.0)); }
      c = mix(c, vec3(1.0), flash);
      c += (h(uv * 1000.0 + time) - 0.5) * grain;
      float v = distance(vUv, vec2(0.5)); c *= 1.0 - vignette * smoothstep(0.35, 0.9, v);
      c *= 1.0 - fade;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Stage2D {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera: THREE.OrthographicCamera;
  composer: EffectComposer; post: ShaderPass; bloom: UnrealBloomPass;
  fxCanvas: HTMLCanvasElement; fx: CanvasRenderingContext2D; fxTex: THREE.CanvasTexture; fxMesh: THREE.Mesh;
  bgCanvas: HTMLCanvasElement; bg: CanvasRenderingContext2D; bgTex: THREE.CanvasTexture; bgMesh: THREE.Mesh;
  plate: Plate; sprites: Sprite[] = [];
  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    host.append(this.renderer.domElement);
    this.camera = new THREE.OrthographicCamera(0, W, H, 0, -100, 100);
    // painted-sky canvas (procedural 80s gradients behind plates when needed)
    [this.bgCanvas, this.bg] = mk(); this.bgTex = new THREE.CanvasTexture(this.bgCanvas); this.bgTex.colorSpace = THREE.SRGBColorSpace;
    this.bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: this.bgTex, depthWrite: false })); this.bgMesh.position.set(W / 2, H / 2, -20);
    this.scene.add(this.bgMesh);
    this.plate = new Plate(this); this.plate.meshes.forEach(m => this.scene.add(m));
    for (let i = 0; i < 12; i++) { const s = new Sprite(this); this.sprites.push(s); this.scene.add(s.mesh); }
    [this.fxCanvas, this.fx] = mk(); this.fxTex = new THREE.CanvasTexture(this.fxCanvas); this.fxTex.colorSpace = THREE.SRGBColorSpace;
    this.fxMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: this.fxTex, transparent: true, depthWrite: false }));
    this.fxMesh.position.set(W / 2, H / 2, 50); this.scene.add(this.fxMesh);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.45, 0.6, 0.82); this.composer.addPass(this.bloom);
    this.post = new ShaderPass(FilmShader); this.composer.addPass(this.post);
    this.composer.addPass(new OutputPass());
    this.resize(); addEventListener('resize', () => this.resize());
  }
  resize() {
    // letterboxed 16:9
    const w = innerWidth, h = innerHeight, s = Math.min(w / W, h / H);
    this.renderer.setSize(W * s, H * s); this.composer.setSize(W * s, H * s);
    const c = this.renderer.domElement; c.style.position = 'absolute'; c.style.left = `${(w - W * s) / 2}px`; c.style.top = `${(h - H * s) / 2}px`;
  }
  begin() {
    this.fx.clearRect(0, 0, W, H);
    for (const s of this.sprites) s.mesh.visible = false;
  }
  render(time: number) {
    this.fxTex.needsUpdate = true; this.bgTex.needsUpdate = true;
    for (const s of this.sprites) s.mat.uniforms.time.value = time + s.mesh.id * 1.3;
    this.post.uniforms.time.value = time;
    this.composer.render();
  }
}
function mk(): [HTMLCanvasElement, CanvasRenderingContext2D] { const c = document.createElement('canvas'); c.width = W; c.height = H; return [c, c.getContext('2d')!]; }
