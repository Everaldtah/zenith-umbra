// Training Grounds dressing (desktop edition): the Hero Range lane (firing line, distance marks, the target's post, its
// console) and the Spar Arena (a floor outline and corner posts while open; walls and a roof of blue holographic grid
// that rise and seal the box while a spar is on). Built before the match preload so its shaders compile with the rest.
import * as THREE from 'three';
import { LANE, type HeroRange } from '../game/herorange';
import { ARENA, SPAR_CONSOLE, type Spar } from '../game/spar';

const BLUE = new THREE.Color('#3fa9ff'), WIN = new THREE.Color('#58ffb0'), LOSE = new THREE.Color('#ff5d6d');

/** a word painted on a transparent card (floor numbers, signs, console screens) */
function label(text: string, w: number, h: number, o: { color?: string; bg?: string; size?: number; sub?: string } = {}) {
  const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w);
  const g = c.getContext('2d')!;
  if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, c.width, c.height); }
  g.fillStyle = o.color ?? '#e8f6ff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `800 ${o.size ?? Math.round(c.height * 0.55)}px Orbitron, Rajdhani, sans-serif`;
  g.fillText(text, c.width / 2, c.height * (o.sub ? 0.4 : 0.52));
  if (o.sub) { g.font = `600 ${Math.round(c.height * 0.2)}px Rajdhani, sans-serif`; g.globalAlpha = 0.8; g.fillText(o.sub, c.width / 2, c.height * 0.76); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
}
const glow = (color: string | THREE.Color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, toneMapped: false });

/** the holographic wall: a blue tint you see the world through, a 1 m grid, a scan band sweeping up, bright edges
 *  (normal blending: additive light vanished against the Proving Grounds' bright white walls) */
function holoMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: BLUE.clone() }, uSize: { value: new THREE.Vector2(1, 1) }, uOn: { value: 0 } },
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uColor; uniform vec2 uSize; uniform float uOn; varying vec2 vUv;
      void main() {
        vec2 p = vUv * uSize;
        vec2 g = abs(fract(p) - 0.5);
        float grid = smoothstep(0.455, 0.5, max(g.x, g.y));
        vec2 e = min(vUv, 1.0 - vUv) * uSize;
        float edge = 1.0 - smoothstep(0.0, 0.18, min(e.x, e.y));
        float scan = smoothstep(0.9, 1.0, 1.0 - abs(fract(vUv.y * 0.5 - uTime * 0.35) - 0.5) * 2.0);
        float shimmer = 0.85 + 0.15 * sin(uTime * 3.0 + p.x * 0.7 + p.y * 1.3);
        float a = clamp((0.16 + grid * 0.42 + edge * 0.7 + scan * 0.25) * shimmer, 0.0, 0.92) * uOn;
        vec3 col = mix(uColor * 0.85, vec3(0.85, 0.95, 1.0), grid * 0.35 + edge * 0.5 + scan * 0.3);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
}

/** a console: a dark pedestal, an angled lit screen with the station's name, a ring on the floor */
function consoleAt(x: number, z: number, yaw: number, title: string, sub: string, color: string) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.05, 0.55), new THREE.MeshStandardMaterial({ color: '#232733', roughness: 0.45, metalness: 0.65 }));
  body.position.y = 0.525; body.castShadow = true;
  const screen = label(title, 1.1, 0.62, { color, bg: 'rgba(6,14,26,0.92)', sub });
  screen.position.set(0, 1.22, 0.05); screen.rotation.x = -0.55;
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.15, 40), glow(color, 0.6)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.05, 0.57), glow(color)); strip.position.y = 0.9;
  g.add(body, screen, ring, strip);
  return g;
}

export class TrainingScene {
  group = new THREE.Group();
  private post: THREE.Group;
  private walls: THREE.Mesh[] = [];
  private roof: THREE.Mesh;
  private holo: THREE.ShaderMaterial[] = [];
  private posts: THREE.Mesh[] = [];
  private outline: THREE.MeshBasicMaterial;
  private seal = 0;

  constructor(scene: THREE.Scene, public range?: HeroRange, public spar?: Spar) {
    const G = this.group;
    // ---------------- Hero Range lane: firing line across, a mark + number every distance, the post ring
    const lane = new THREE.Group();
    const across = (x: number, w: number, color: string, o = 1) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, 8.4), glow(color, o)); m.position.set(x, 0.015, LANE.z); lane.add(m); };
    across(LANE.x0, 0.14, '#ffd76a');
    const fl = label('FIRING LINE', 3.2, 0.5, { color: '#ffd76a' }); fl.rotation.x = -Math.PI / 2; fl.rotation.z = -Math.PI / 2; fl.position.set(LANE.x0 - 0.5, 0.03, LANE.z); lane.add(fl);
    for (const d of LANE.dists) {
      across(LANE.x0 + d, 0.06, '#9fe0ff', 0.55);
      const n = label(`${d} M`, 1.6, 0.6, { color: '#cfefff' }); n.rotation.x = -Math.PI / 2; n.rotation.z = -Math.PI / 2; n.position.set(LANE.x0 + d, 0.03, LANE.z - 4.9); lane.add(n);
    }
    // the side rails of the lane
    for (const s of [-1, 1]) { const r = new THREE.Mesh(new THREE.BoxGeometry(LANE.dists[LANE.dists.length - 1] + 2, 0.02, 0.06), glow('#9fe0ff', 0.4)); r.position.set(LANE.x0 + (LANE.dists[LANE.dists.length - 1] + 2) / 2 - 1, 0.015, LANE.z + s * 4.2); lane.add(r); }
    const sign = label('HERO RANGE', 4.6, 1.0, { color: '#9fe0ff', sub: 'G · choose a hero · attack or defense' }); sign.position.set(LANE.x0 - 3.2, 2.6, LANE.z - 4.4); sign.rotation.y = -0.53;                 // (faces the spawn room you walk over from) lane.add(sign);
    this.post = new THREE.Group();
    const pr = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 40), glow('#ff5d6d', 0.85)); pr.rotation.x = -Math.PI / 2; pr.position.y = 0.025;
    const pd = new THREE.Mesh(new THREE.CircleGeometry(0.85, 40), glow('#ff5d6d', 0.12)); pd.rotation.x = -Math.PI / 2; pd.position.y = 0.022;
    this.post.add(pr, pd); lane.add(this.post);
    lane.add(consoleAt(LANE.console.x, LANE.console.z, -0.75, 'HERO RANGE', 'press G', '#9fe0ff'));
    G.add(lane);
    // ---------------- Spar Arena: outline, corner posts, holographic walls + roof (sealed), its console and sign
    const A = ARENA, x0 = A.x - A.hx, x1 = A.x + A.hx, z0 = A.z - A.hz, z1 = A.z + A.hz;
    this.outline = glow(BLUE, 0.9);
    for (const [x, z, w, d] of [[A.x, z0, A.hx * 2, 0.12], [A.x, z1, A.hx * 2, 0.12], [x0, A.z, 0.12, A.hz * 2], [x1, A.z, 0.12, A.hz * 2]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), this.outline); m.position.set(x, 0.02, z); G.add(m);
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(A.hx * 2, A.hz * 2), glow(BLUE, 0.05)); floor.rotation.x = -Math.PI / 2; floor.position.set(A.x, 0.012, A.z); G.add(floor);
    for (const [x, z] of [[x0, z0], [x0, z1], [x1, z0], [x1, z1]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1, 0.16), this.outline); p.position.set(x, 0.5, z); p.scale.y = 1.2; G.add(p); this.posts.push(p);
    }
    const wall = (w: number, h: number, x: number, z: number, yaw: number) => {
      const m = holoMaterial(); m.uniforms.uSize.value.set(w, h); this.holo.push(m);
      const geo = new THREE.PlaneGeometry(w, h); geo.translate(0, h / 2, 0);     // anchored at the floor: scale.y raises it
      const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, 0, z); mesh.rotation.y = yaw; mesh.renderOrder = 5; mesh.frustumCulled = false;
      this.walls.push(mesh); G.add(mesh);
    };
    wall(A.hx * 2, A.h, A.x, z0, 0); wall(A.hx * 2, A.h, A.x, z1, Math.PI);
    wall(A.hz * 2, A.h, x0, A.z, Math.PI / 2); wall(A.hz * 2, A.h, x1, A.z, -Math.PI / 2);
    const rm = holoMaterial(); rm.uniforms.uSize.value.set(A.hx * 2, A.hz * 2); this.holo.push(rm);
    this.roof = new THREE.Mesh(new THREE.PlaneGeometry(A.hx * 2, A.hz * 2), rm); this.roof.rotation.x = Math.PI / 2; this.roof.position.set(A.x, A.h, A.z); this.roof.renderOrder = 5; G.add(this.roof);
    const ss = label('SPAR ARENA', 5.2, 1.1, { color: '#7fd8ff', sub: 'G · pick an opponent · walk in to fight' }); ss.position.set(A.x, 3.1, z0 - 0.05); ss.rotation.y = Math.PI; G.add(ss);
    G.add(consoleAt(SPAR_CONSOLE.x, SPAR_CONSOLE.z, Math.PI, 'SPAR', 'press G', '#7fd8ff'));
    this.setSeal(0);
    scene.add(G);
  }

  private setSeal(k: number) {
    this.seal = k;
    for (const w of this.walls) { w.scale.y = Math.max(0.03, k); }
    this.roof.visible = k > 0.98;
    for (const p of this.posts) { p.scale.y = 1.2 + k * (ARENA.h - 1.2); p.position.y = p.scale.y / 2; }
  }

  update(time: number, dt: number) {
    const r = this.range, s = this.spar;
    if (r) { this.post.visible = !!r.bot; this.post.position.set(r.post.x, 0, r.post.z); }
    // the box rises in ~0.6 s when it seals and sinks back when the spar is over
    const want = s?.sealed ? 1 : 0;
    if (this.seal !== want) this.setSeal(want > this.seal ? Math.min(1, this.seal + dt / 0.6) : Math.max(0, this.seal - dt / 0.8));
    // its colour: blue while it fights; the winner's colour once the spar is decided
    const c = s?.phase === 'done' ? (s.wins.you > s.wins.them ? WIN : LOSE) : BLUE;
    for (const m of this.holo) { m.uniforms.uTime.value = time; m.uniforms.uOn.value = 0.5 + this.seal * 0.5; m.uniforms.uColor.value.copy(c); }
    this.outline.color.copy(c);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.group.traverse(o => {
      const m = o as THREE.Mesh; if (!m.isMesh) return;
      m.geometry.dispose();
      const mat = m.material as THREE.MeshBasicMaterial; mat.map?.dispose(); mat.dispose();
    });
  }
}
