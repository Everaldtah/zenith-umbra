// Gunfire you can read at a glance (desktop edition): every round is a travelling tracer - a white-hot core inside a
// coloured sheath with a thin rail trail that lingers a beat - fired out of a star-shaped muzzle flash; it lands in a spray
// of hot sparks, a flash, a curl of smoke and a scorch mark that stays on the wall; rotary cannons throw brass. Pooled
// instanced billboards: hundreds of rounds a second cost a handful of draw calls.
// Sprites: Kenney's CC0 Particle Pack (public/fx, assetgen/fetch_cc0.py) - star bursts for the flashes, real smoke wisps,
// burn marks for the scorches, dirt for the dust a round kicks off the ground; the canvas-drawn star stays in the mix.
import * as THREE from 'three';
import type { V3 } from '../engine/Physics';
import { BASE } from './Assets';

const fxLoader = new THREE.TextureLoader();
const fxCache = new Map<string, THREE.Texture>();
/** a sprite from public/fx (white with alpha: the material colour tints it) */
function fxTex(name: string): THREE.Texture {
  let t = fxCache.get(name);
  if (!t) { t = fxLoader.load(`${BASE}fx/${name}.webp`); t.colorSpace = THREE.SRGBColorSpace; fxCache.set(name, t); }
  return t;
}
const FLASH_TEX = ['star_09', 'star_06', 'star_08'], SMOKE_TEX = ['smoke_01', 'smoke_02', 'smoke_04', 'smoke_05', 'smoke_06', 'smoke_07'];
const SCORCH_TEX = ['scorch_01', 'scorch_02', 'scorch_03'], DIRT_TEX = ['dirt_01', 'dirt_02', 'dirt_03'];
const MAX_DUST = 24;

const MAX_TR = 256, MAX_SP = 512, MAX_FL = 64, MAX_DC = 96, MAX_CS = 96;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _mid = new THREE.Vector3(), _m = new THREE.Matrix4();

function starTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.18, 'rgba(255,255,255,0.9)'); r.addColorStop(0.45, 'rgba(255,255,255,0.25)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  // spikes
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    g.save(); g.translate(64, 64); g.rotate(i * Math.PI / 3 + (i % 2) * 0.2);
    const l = i % 2 ? 44 : 62, grd = g.createLinearGradient(0, 0, l, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.moveTo(0, -5); g.lineTo(l, 0); g.lineTo(0, 5); g.fill(); g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function scorchTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(10,8,6,0.95)'); r.addColorStop(0.25, 'rgba(25,18,12,0.8)'); r.addColorStop(0.6, 'rgba(40,30,20,0.3)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(0,0,0,${0.2 + Math.random() * 0.3})`; g.beginPath(); g.arc(32 + (Math.random() - 0.5) * 30, 32 + (Math.random() - 0.5) * 30, 1 + Math.random() * 3, 0, 7); g.fill(); }
  return new THREE.CanvasTexture(c);
}

/** a camera-facing streak shader for instanced quads: each instance is a segment a->b with a width and a colour */
/** the streak's look across its width (v) and length (u): a white-hot core line inside a soft coloured sheath, brightest
 *  at the head (u = 1), fading into the tail */
function streakTexture(): THREE.Texture {
  const W = 128, H = 32, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!, img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = Math.abs(y / (H - 1) - 0.5) * 2, u = x / (W - 1);
    const core = Math.max(0, 1 - v / 0.28), sheath = Math.max(0, 1 - v);
    const along = Math.min(1, u / 0.3) * (0.45 + 0.55 * u);
    const wv = core * 0.95, i = (y * W + x) * 4;
    // RGB: white in the core (the instance colour tints the sheath through vertex colours below)
    img.data[i] = 255; img.data[i + 1] = 255 * (0.8 + 0.2 * wv); img.data[i + 2] = 255 * (0.55 + 0.45 * wv);
    img.data[i + 3] = 255 * Math.min(1, (sheath * sheath * 0.8 + core) * along);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

interface Tr { a: THREE.Vector3; b: THREE.Vector3; born: number; dur: number; len: number; w: number; col: THREE.Color; rail: boolean }
interface Sp { p: THREE.Vector3; v: THREE.Vector3; born: number; dur: number; col: THREE.Color; w: number }

export class WeaponFx {
  group = new THREE.Group();
  private tr: Tr[] = []; private sp: Sp[] = [];
  private trMesh: THREE.InstancedMesh; private railMesh: THREE.InstancedMesh; private spMesh: THREE.InstancedMesh;
  /** camera position (streaks face it) - set by Fx each frame */
  cam = new THREE.Vector3();
  private flashes: THREE.Sprite[] = []; private flashBorn: number[] = []; private flashI = 0;
  private decals: THREE.Mesh[] = []; private decalBorn: number[] = []; private decalI = 0;
  private cases: { m: THREE.Mesh; v: THREE.Vector3; born: number; spin: THREE.Vector3 }[] = []; private caseI = 0;
  private smoke: THREE.Sprite[] = []; private smokeBorn: number[] = []; private smokeI = 0; private smokeSpin: number[] = [];
  /** dirt kicked off the ground by a round: a burst of grit that spreads and drops */
  private dust: THREE.Sprite[] = []; private dustBorn: number[] = []; private dustI = 0;
  /** the ground under a point (casings bounce on it) */
  ground: ((x: number, z: number, y: number) => number) | null = null;

  constructor() {
    const tex = streakTexture();
    const unit = new THREE.PlaneGeometry(1, 1); unit.translate(0.5, 0, 0);
    const im = (n: number, opacity = 1) => {
      const m = new THREE.InstancedMesh(unit, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false;
      m.setColorAt(0, new THREE.Color('#ffffff')); m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m); return m;
    };
    this.trMesh = im(MAX_TR); this.railMesh = im(MAX_TR, 0.35); this.spMesh = im(MAX_SP);
    const star = starTexture();
    for (let i = 0; i < MAX_FL; i++) {
      // a quarter keep the canvas star, the rest are Kenney bursts: no two flashes in a burst look alike
      const map = i % 4 === 3 ? star : fxTex(FLASH_TEX[i % 4]);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.visible = false; this.flashes.push(s); this.flashBorn.push(-9); this.group.add(s);
    }
    const scorch = scorchTexture(), dg = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < MAX_DC; i++) {
      // burn marks: Kenney scorches darkened to soot (one in four keeps the canvas mark: a softer, round one)
      const kenney = i % 4 !== 3;
      const d = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ map: kenney ? fxTex(SCORCH_TEX[i % 3]) : scorch, color: kenney ? '#1c140e' : '#ffffff', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
      d.visible = false; this.decals.push(d); this.decalBorn.push(-99); this.group.add(d);
    }
    const cg = new THREE.CylinderGeometry(0.022, 0.022, 0.09, 6), cm = new THREE.MeshStandardMaterial({ color: '#d8a64a', metalness: 0.9, roughness: 0.3 });
    for (let i = 0; i < MAX_CS; i++) { const m = new THREE.Mesh(cg, cm); m.visible = false; this.cases.push({ m, v: new THREE.Vector3(), born: -9, spin: new THREE.Vector3() }); this.group.add(m); }
    // smoke: wisps from the Kenney set, each puff turned and slowly curling as it rises
    for (let i = 0; i < 48; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fxTex(SMOKE_TEX[i % SMOKE_TEX.length]), transparent: true, depthWrite: false, color: '#9a938a' })); s.visible = false; this.smoke.push(s); this.smokeBorn.push(-9); this.smokeSpin.push(0); this.group.add(s); }
    for (let i = 0; i < MAX_DUST; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fxTex(DIRT_TEX[i % 3]), transparent: true, depthWrite: false, color: '#dccaa6' })); s.visible = false; this.dust.push(s); this.dustBorn.push(-9); this.group.add(s); }
  }

  /** a round: tracer from the muzzle to where it landed; `rail` rounds leave a lingering trail (hitscan) */
  tracer(from: V3, to: V3, color: string, now: number, o: { speed?: number; w?: number; len?: number; rail?: boolean } = {}) {
    if (this.tr.length >= MAX_TR) this.tr.shift();
    const a = new THREE.Vector3(from.x, from.y, from.z), b = new THREE.Vector3(to.x, to.y, to.z);
    const d = a.distanceTo(b);
    this.tr.push({ a, b, born: now, dur: Math.max(0.05, d / (o.speed ?? 240)), len: Math.min(d, o.len ?? 3.2), w: o.w ?? 0.07, col: new THREE.Color(color).multiplyScalar(1.6), rail: o.rail ?? true });
  }

  /** a star-shaped muzzle flash (and a puff of smoke from big guns) */
  muzzle(p: V3, color: string, now: number, size = 0.5, smoke = false) {
    const s = this.flashes[this.flashI], i = this.flashI; this.flashI = (this.flashI + 1) % MAX_FL;
    s.position.set(p.x, p.y, p.z); s.scale.setScalar(size * (0.8 + Math.random() * 0.4));
    (s.material as THREE.SpriteMaterial).color.set(color).lerp(new THREE.Color('#ffffff'), 0.45);
    (s.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI;
    s.visible = true; this.flashBorn[i] = now;
    if (smoke && Math.random() < 0.35) this.puff(p, now, 0.35);
  }

  /** a round landing on the world: sparks along the bounce, a flash, smoke, a scorch mark facing out of the surface */
  impact(p: V3, n: V3 | undefined, color: string, now: number, big = false) {
    const N = n ? new THREE.Vector3(n.x, n.y, n.z).normalize() : new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color(color).lerp(new THREE.Color('#ffd9a0'), 0.4);
    const k = big ? 10 : 6;
    for (let i = 0; i < k; i++) {
      if (this.sp.length >= MAX_SP) this.sp.shift();
      const v = N.clone().multiplyScalar(2 + Math.random() * 4).add(new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 3, (Math.random() - 0.5) * 6));
      this.sp.push({ p: new THREE.Vector3(p.x, p.y, p.z), v, born: now, dur: 0.18 + Math.random() * 0.22, col: c, w: 0.025 + Math.random() * 0.02 });
    }
    this.muzzle({ x: p.x + N.x * 0.05, y: p.y + N.y * 0.05, z: p.z + N.z * 0.05 }, color, now, big ? 0.7 : 0.38);
    if (Math.random() < 0.4) this.puff({ x: p.x + N.x * 0.15, y: p.y + N.y * 0.15, z: p.z + N.z * 0.15 }, now, 0.5);
    // a round into the ground throws grit and a low, dusty puff
    if (n && N.y > 0.6 && Math.random() < (big ? 1 : 0.55)) {
      const d = this.dust[this.dustI], i = this.dustI; this.dustI = (this.dustI + 1) % MAX_DUST;
      d.position.set(p.x, p.y + 0.2, p.z); d.scale.setScalar(big ? 1.0 : 0.6); d.visible = true; this.dustBorn[i] = now;
      (d.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI * 2;
      if (Math.random() < 0.5) this.puff({ x: p.x, y: p.y + 0.2, z: p.z }, now, big ? 0.8 : 0.5, '#b3a186');
    }
    if (n) {
      const d = this.decals[this.decalI], i = this.decalI; this.decalI = (this.decalI + 1) % MAX_DC;
      d.position.set(p.x + N.x * 0.012, p.y + N.y * 0.012, p.z + N.z * 0.012);
      d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), N); d.rotateZ(Math.random() * Math.PI * 2);
      d.scale.setScalar(big ? 0.55 : 0.22 + Math.random() * 0.1); d.visible = true; this.decalBorn[i] = now;
    }
  }

  /** brass kicked out of a rotary cannon: arcs out to the side, bounces, settles */
  casing(p: V3, side: V3, now: number) {
    const C = this.cases[this.caseI]; this.caseI = (this.caseI + 1) % MAX_CS;
    C.m.position.set(p.x, p.y, p.z); C.m.visible = true; C.born = now;
    C.v.set(side.x * (2 + Math.random() * 1.5), 2.5 + Math.random() * 1.5, side.z * (2 + Math.random() * 1.5));
    C.spin.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
  }

  /** instance i of `mesh` becomes a camera-facing ribbon from a to b, w wide */
  private seg(mesh: THREE.InstancedMesh, i: number, a: THREE.Vector3, b: THREE.Vector3, w: number, col: THREE.Color) {
    _x.subVectors(b, a); const len = _x.length() || 1e-4; _x.divideScalar(len);
    _mid.addVectors(a, b).multiplyScalar(0.5);
    _y.crossVectors(_x, _z.subVectors(this.cam, _mid).normalize());
    if (_y.lengthSq() < 1e-8) _y.set(0, 1, 0); _y.normalize();
    _z.crossVectors(_x, _y);
    _m.makeBasis(_x.multiplyScalar(len), _y.multiplyScalar(w), _z);
    _m.setPosition(a);
    mesh.setMatrixAt(i, _m); mesh.setColorAt(i, col);
  }

  private puff(p: V3, now: number, size: number, color = '#9a938a') {
    const s = this.smoke[this.smokeI], i = this.smokeI; this.smokeI = (this.smokeI + 1) % this.smoke.length;
    s.position.set(p.x, p.y, p.z); s.scale.setScalar(size); s.visible = true; this.smokeBorn[i] = now;
    const m = s.material as THREE.SpriteMaterial;
    m.color.set(color); m.rotation = Math.random() * Math.PI * 2; this.smokeSpin[i] = (Math.random() - 0.5) * 1.6;
  }

  update(now: number, dt: number) {
    // tracers: the head travels muzzle -> target; the rail (a thin line over the whole path) fades behind it
    let n = 0, r = 0;
    this.tr = this.tr.filter(t => now - t.born < t.dur + 0.14);
    for (const t of this.tr) {
      const k = Math.min(1, (now - t.born) / t.dur), L = t.a.distanceTo(t.b) || 1, head = k * L;
      if (k < 1 && n < MAX_TR) {
        _b.copy(t.a).lerp(t.b, head / L); _a.copy(t.a).lerp(t.b, Math.max(0, head - t.len) / L);
        this.seg(this.trMesh, n++, _a, _b, t.w, t.col);
      }
      if (t.rail && r < MAX_TR) {
        const f = 1 - Math.min(1, (now - t.born) / (t.dur + 0.14));
        _b.copy(t.a).lerp(t.b, k);
        this.seg(this.railMesh, r++, t.a, _b, t.w * 0.4 * f, t.col);
      }
    }
    this.trMesh.count = n; this.railMesh.count = r;
    for (const m of [this.trMesh, this.railMesh]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    // sparks: short streaks along their velocity, falling
    let m = 0;
    this.sp = this.sp.filter(q => now - q.born < q.dur);
    for (const q of this.sp) {
      q.v.y -= 14 * dt; q.p.addScaledVector(q.v, dt);
      const f = 1 - (now - q.born) / q.dur;
      _a.copy(q.p).addScaledVector(q.v, -0.035);
      this.seg(this.spMesh, m++, _a, q.p, q.w * (0.4 + 0.6 * f), q.col);
    }
    this.spMesh.count = m; this.spMesh.instanceMatrix.needsUpdate = true; if (this.spMesh.instanceColor) this.spMesh.instanceColor.needsUpdate = true;
    // flashes: 50 ms pops
    this.flashes.forEach((s, i) => { if (!s.visible) return; const k = (now - this.flashBorn[i]) / 0.05; if (k >= 1) s.visible = false; else (s.material as THREE.SpriteMaterial).opacity = 1 - k * k; });
    // smoke: rises, spreads, fades
    this.smoke.forEach((s, i) => { if (!s.visible) return; const k = (now - this.smokeBorn[i]) / 0.9; if (k >= 1) { s.visible = false; return; } s.position.y += dt * 0.6; s.scale.multiplyScalar(1 + dt * 1.4);
      const m = s.material as THREE.SpriteMaterial; m.rotation += this.smokeSpin[i] * dt; m.opacity = 0.6 * Math.min(1, k * 8) * (1 - k); });
    // dust: a fast burst of grit that spreads, sinks and thins out in 0.4 s
    this.dust.forEach((s, i) => { if (!s.visible) return; const k = (now - this.dustBorn[i]) / 0.4; if (k >= 1) { s.visible = false; return; } s.scale.multiplyScalar(1 + dt * 2.2); s.position.y -= dt * 0.3; (s.material as THREE.SpriteMaterial).opacity = 0.95 * (1 - k * k); });
    // scorch marks stay a while, then fade
    this.decals.forEach((d, i) => { if (!d.visible) return; const age = now - this.decalBorn[i]; if (age > 9) d.visible = false; else (d.material as THREE.MeshBasicMaterial).opacity = age > 6 ? 1 - (age - 6) / 3 : 1; });
    // brass
    for (const C of this.cases) {
      if (!C.m.visible) continue;
      if (now - C.born > 2.2) { C.m.visible = false; continue; }
      C.v.y -= 14 * dt; C.m.position.addScaledVector(C.v, dt);
      C.m.rotation.x += C.spin.x * dt; C.m.rotation.y += C.spin.y * dt; C.m.rotation.z += C.spin.z * dt;
      const gy = this.ground ? this.ground(C.m.position.x, C.m.position.z, C.m.position.y + 0.3) : 0;
      if (C.m.position.y < gy + 0.02 && C.v.y < 0) { C.m.position.y = gy + 0.02; C.v.y *= -0.35; C.v.x *= 0.5; C.v.z *= 0.5; C.spin.multiplyScalar(0.5); }
    }
  }
}
