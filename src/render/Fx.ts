// Visual effects: a pooled GPU point-particle system, shockwave rings, beams, projectile visuals,
// persistent zone decals and per-actor status visuals. Driven by World events + state.
import * as THREE from 'three';
import type { GameEvent, Proj, World, Zone } from '../game/World';
import type { V3 } from '../engine/Physics';
import type { Actor } from '../game/Actor';

const FXCOL: Record<string, string> = {
  sun: '#ffd76a', star: '#bfe8ff', talisman: '#ffe28a', bolt: '#8ad8ff', void: '#ff2244', blood: '#ff2d55', hex: '#c77dff',
  shadow: '#9d7bff', flame: '#ff6a2a', fist: '#ffd76a', reveal: '#fff2b0', hexbomb: '#c77dff', chain: '#ff6a2a',
};

class Particles {
  n: number; pos: Float32Array; vel: Float32Array; col: Float32Array; life: Float32Array; max: Float32Array; size: Float32Array; grav: Float32Array;
  geo = new THREE.BufferGeometry(); points: THREE.Points; next = 0; alive = 0;
  constructor(cap: number) {
    this.n = cap;
    this.pos = new Float32Array(cap * 3); this.vel = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3);
    this.life = new Float32Array(cap); this.max = new Float32Array(cap).fill(1); this.size = new Float32Array(cap); this.grav = new Float32Array(cap);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const aLife = new Float32Array(cap);
    this.geo.setAttribute('alife', new THREE.BufferAttribute(aLife, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(this.geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
      vertexShader: `attribute float size; attribute float alife; varying vec3 vC; varying float vL;
        void main(){ vC=color; vL=alife; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=size*420.0/max(0.1,-mv.z)*(0.4+0.6*alife); }`,
      fragmentShader: `varying vec3 vC; varying float vL; void main(){ float d=length(gl_PointCoord-0.5); float a=(1.0-smoothstep(0.0,0.5,d))*vL; if(a<0.01) discard; gl_FragColor=vec4(vC*(1.0+ (1.0-d*2.0)),a); }`,
    }));
    this.points.frustumCulled = false;
  }
  emit(p: V3, count: number, color: THREE.Color, o: { speed?: number; life?: number; size?: number; grav?: number; spread?: number; dir?: V3; up?: number } = {}) {
    const sp = o.speed ?? 4, life = o.life ?? 0.6, size = o.size ?? 0.25, g = o.grav ?? 0, spread = o.spread ?? 0.2;
    for (let k = 0; k < count; k++) {
      const i = this.next; this.next = (this.next + 1) % this.n;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * spread; this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * spread; this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * spread;
      let vx = Math.random() * 2 - 1, vy = Math.random() * 2 - 1, vz = Math.random() * 2 - 1;
      const l = Math.hypot(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l;
      const s = sp * (0.4 + Math.random() * 0.6);
      if (o.dir) { vx = o.dir.x + vx * 0.35; vy = o.dir.y + vy * 0.35; vz = o.dir.z + vz * 0.35; }
      this.vel[i * 3] = vx * s; this.vel[i * 3 + 1] = vy * s + (o.up ?? 0); this.vel[i * 3 + 2] = vz * s;
      this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
      this.life[i] = this.max[i] = life * (0.6 + Math.random() * 0.6); this.size[i] = size * (0.6 + Math.random() * 0.8); this.grav[i] = g;
    }
  }
  update(dt: number) {
    const al = this.geo.attributes.alife.array as Float32Array;
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { al[i] = 0; continue; }
      alive++;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      const drag = 1 - Math.min(1, dt * 1.5);
      this.vel[i * 3] *= drag; this.vel[i * 3 + 1] *= drag; this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      al[i] = Math.max(0, this.life[i] / this.max[i]);
    }
    this.alive = alive;
    for (const k of ['position', 'color', 'size', 'alife']) this.geo.attributes[k].needsUpdate = true;
  }
}

interface Timed { obj: THREE.Object3D; born: number; dur: number; kind: string; r?: number; from?: V3; to?: V3; actor?: Actor; target?: Actor; }

const ringGeo = new THREE.RingGeometry(0.92, 1, 64);
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true); beamGeo.translate(0, 0.5, 0); beamGeo.rotateX(Math.PI / 2);
const coneGeo = new THREE.ConeGeometry(1, 1, 24, 1, true); coneGeo.translate(0, -0.5, 0); coneGeo.rotateX(-Math.PI / 2);

export class Fx {
  group = new THREE.Group();
  parts: Particles;
  timed: Timed[] = [];
  projMeshes = new Map<number, THREE.Object3D>();
  zoneMeshes = new Map<number, THREE.Object3D>();
  beamMeshes = new Map<number, THREE.Mesh>();
  flameMeshes = new Map<number, THREE.Mesh>();
  flash: THREE.PointLight;
  flashUntil = 0;
  shake = 0;
  private sphere = new THREE.SphereGeometry(1, 12, 8);

  constructor(scene: THREE.Scene, cap = 6000) {
    this.parts = new Particles(cap);
    this.group.add(this.parts.points);
    this.flash = new THREE.PointLight('#ffffff', 0, 18, 2);
    this.group.add(this.flash);
    scene.add(this.group);
  }

  private add(obj: THREE.Object3D, kind: string, now: number, dur: number, extra: Partial<Timed> = {}) {
    this.group.add(obj); this.timed.push({ obj, born: now, dur, kind, ...extra });
  }
  private ring(p: V3, r: number, color: string, now: number, dur = 0.5, flat = true, width = 1) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(p.x, p.y + 0.1, p.z); if (flat) m.rotation.x = -Math.PI / 2;
    this.add(m, 'ring', now, dur, { r: r * width });
  }
  private beam(a: V3, b: V3, color: string, now: number, dur: number, width = 0.06, kind = 'beam', actor?: Actor, target?: Actor) {
    const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.orient(m, a, b, width);
    this.add(m, kind, now, dur, { from: a, to: b, actor, target, r: width });
  }
  private orient(m: THREE.Object3D, a: V3, b: V3, w: number) {
    const d = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z), l = d.length() || 0.01;
    m.position.set(a.x, a.y, a.z);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize());
    m.scale.set(w, w, l);
  }
  private light(p: V3, color: string, intensity: number, now: number, dur = 0.12) {
    this.flash.position.set(p.x, p.y + 0.5, p.z); this.flash.color.set(color); this.flash.intensity = intensity; this.flashUntil = now + dur;
  }

  onEvent(e: GameEvent, now: number, camPos: THREE.Vector3) {
    if (e.t !== 'fx') return;
    const c = new THREE.Color(e.color ?? '#ffffff'), p = e.pos, P = this.parts;
    const near = camPos.distanceTo(new THREE.Vector3(p.x, p.y, p.z));
    const lod = near > 60 ? 0.35 : near > 30 ? 0.7 : 1;
    const n = (k: number) => Math.max(1, Math.round(k * lod));
    switch (e.kind) {
      case 'hit': P.emit(p, n(8), c, { speed: 5, life: 0.25, size: 0.18 }); break;
      case 'impact': P.emit(p, n(6), c, { speed: 3, life: 0.3, size: 0.15, grav: 6 }); break;
      case 'healhit': P.emit(p, n(10), new THREE.Color('#9dffb0'), { speed: 2, life: 0.6, size: 0.2, up: 2 }); break;
      case 'burst': P.emit(p, n(30), c, { speed: 7, life: 0.45, size: 0.35 }); this.ring(p, (e.r ?? 2) * 1.2, e.color ?? '#fff', now, 0.35, false); this.light(p, e.color ?? '#fff', 25, now); this.shake = Math.max(this.shake, 0.12 / (1 + near / 10)); break;
      case 'tracer': if (e.to) this.beam(p, e.to, e.color ?? '#fff', now, 0.07, 0.025); break;
      case 'slash': case 'swing': {
        if (e.kind === 'slash') P.emit(p, n(12), c, { speed: 6, life: 0.3, size: 0.22 });
        else if (e.actor) {
          // a crescent sweep in front of the attacker
          const a = e.actor, f = a.forward();
          const arc = new THREE.Mesh(new THREE.RingGeometry(1.4 * a.scale, 2.6 * a.scale, 24, 1, -0.9, 1.8), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
          arc.position.set(a.pos.x, a.pos.y + a.height * 0.55, a.pos.z);
          arc.rotation.set(-Math.PI / 2 + 0.25, 0, -Math.atan2(f.x, f.z) + Math.PI / 2, 'YXZ');
          arc.rotation.order = 'YXZ'; arc.rotation.y = a.yaw - Math.PI / 2; arc.rotation.x = -Math.PI / 2 + 0.3;
          this.add(arc, 'fade', now, 0.18);
        }
        break;
      }
      case 'hammer': if (e.actor) {
        // rocket hammer: a wide flat crescent swept across the front, tilted with the swing direction
        const a = e.actor, r = e.r ?? 5, side = e.side ?? 1;
        const arc = new THREE.Mesh(new THREE.RingGeometry(r * 0.3, r, 40, 1, -1.5, 3.0), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
        arc.position.set(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z);
        arc.rotation.order = 'YXZ'; arc.rotation.y = a.yaw - Math.PI / 2; arc.rotation.x = -Math.PI / 2 + 0.12 * side; arc.rotation.z = 0;
        this.add(arc, 'fade', now, 0.22);
        const f = a.forward(), tip = { x: a.pos.x + f.x * r * 0.8, y: a.pos.y + a.height * 0.45, z: a.pos.z + f.z * r * 0.8 };
        P.emit(tip, n(18), c, { speed: 7, life: 0.35, size: 0.25 });
        this.shake = Math.max(this.shake, 0.05 / (1 + near / 8));
      } break;
      case 'shatter': if (e.to) {
        // ground shockwave: a glowing wedge that races out along the floor, rock debris thrown up along its path
        const len = e.r ?? 16, dx = e.to.x - p.x, dz = e.to.z - p.z, yaw = Math.atan2(dx, dz), half = 0.42;
        const shape = new THREE.Shape();
        shape.moveTo(0, 0); shape.lineTo(Math.tan(half) * len, len); shape.lineTo(-Math.tan(half) * len, len); shape.lineTo(0, 0);
        const wedge = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.7, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
        wedge.rotation.order = 'YXZ'; wedge.rotation.y = yaw; wedge.rotation.x = Math.PI / 2;
        wedge.position.set(p.x, p.y + 0.08, p.z);
        this.add(wedge, 'shatter', now, 0.55, { r: 1 });
        for (let k = 1; k <= 8; k++) {
          const u = k / 8, q = { x: p.x + dx * u, y: p.y + 0.2, z: p.z + dz * u };
          P.emit(q, n(10), c, { speed: 5 + 4 * u, life: 0.6, size: 0.35, up: 4, grav: 12 });
          P.emit(q, n(6), new THREE.Color('#6b5b4a'), { speed: 4, life: 0.8, size: 0.45, up: 5, grav: 14 });
        }
        this.ring(p, 3, e.color ?? '#ffd76a', now, 0.4);
        this.light(p, e.color ?? '#ffd76a', 40, now);
        this.shake = Math.max(this.shake, 0.3 / (1 + near / 12));
      } break;
      case 'lightning': if (e.to) { this.zigzag(p, e.to, '#8ad8ff', now); } break;
      case 'parry': this.ring(p, 1.8, '#8ad8ff', now, 0.3, false); P.emit(p, n(16), c, { speed: 8, life: 0.2, size: 0.15 }); this.light(p, '#8ad8ff', 30, now); break;
      case 'decoy': P.emit(p, n(40), c, { speed: 4, life: 0.8, size: 0.3 }); this.ring(p, 2, e.color ?? '#c77dff', now, 0.5, false); break;
      case 'undying': P.emit(p, n(20), new THREE.Color('#ffe28a'), { speed: 3, life: 0.6, size: 0.3, up: 2 }); break;
      case 'death': P.emit(p, n(50), c, { speed: 5, life: 1.2, size: 0.3, up: 2 }); break;
      case 'eject': {
        // escape pod rockets up out of the cockpit trailing sparks
        const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.5, 4, 8), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.8 }));
        pod.position.set(p.x, p.y, p.z);
        this.add(pod, 'pod', now, 2.2, { from: { ...p } });
        P.emit(p, n(40), new THREE.Color('#ffb040'), { speed: 8, life: 0.6, size: 0.35 });
        this.light(p, '#ffb040', 60, now, 0.25); this.shake = Math.max(this.shake, 0.35);
        break;
      }
      case 'dust': P.emit(p, n(24), new THREE.Color('#b8a58a'), { speed: 3, life: 0.8, size: 0.6, spread: e.r ?? 1.5, up: 0.5 }); this.shake = Math.max(this.shake, 0.2 / (1 + near / 8)); break;
      case 'step': P.emit(p, n(6), new THREE.Color('#9c8f7c'), { speed: 1.2, life: 0.5, size: 0.35, spread: 0.6, up: 0.4 }); break;
      case 'doublejump': case 'sunhop': this.ring(p, 1.5, e.color ?? '#fff', now, 0.3); P.emit(p, n(14), c, { speed: 3, life: 0.4, size: 0.2 }); break;
      case 'pad': this.ring(p, 2, e.color ?? '#fff', now, 0.4); P.emit(p, n(20), c, { speed: 2, life: 0.6, size: 0.25, dir: { x: 0, y: 1, z: 0 }, up: 6 }); break;
      case 'spawn': P.emit({ x: p.x, y: p.y + 1, z: p.z }, n(30), c, { speed: 2, life: 0.8, size: 0.3, up: 3, spread: 1 }); this.ring(p, 1.6, e.color ?? '#fff', now, 0.6); break;
      case 'barrierhit': P.emit(p, n(5), c, { speed: 3, life: 0.2, size: 0.2 }); break;
      case 'barrierbreak': P.emit(p, n(60), c, { speed: 9, life: 0.7, size: 0.35 }); this.light(p, e.color ?? '#fff', 40, now); break;
      case 'ultflash': this.ring(p, 5, e.color ?? '#fff', now, 0.6, false); P.emit(p, n(50), c, { speed: 6, life: 0.8, size: 0.4 }); this.light(p, e.color ?? '#fff', 70, now, 0.3); break;
      case 'sunburst': case 'nova': case 'requiem': case 'theater': case 'sanctuarycast': case 'sealcast': case 'revealburst': case 'hexburst': case 'implode': case 'slam': case 'arrowsmark': {
        const r = e.r ?? 6;
        this.ring(p, r, e.color ?? '#fff', now, e.kind === 'slam' || e.kind === 'implode' ? 0.5 : 0.8);
        if (e.kind !== 'arrowsmark') this.ring({ x: p.x, y: p.y + 0.5, z: p.z }, r * 0.7, e.color ?? '#fff', now, 0.6, false);
        P.emit(p, n(e.kind === 'slam' || e.kind === 'implode' ? 90 : 60), c, { speed: r * 0.9, life: 0.7, size: 0.4, spread: 1 });
        this.light(p, e.color ?? '#fff', e.kind === 'slam' ? 120 : 50, now, 0.25);
        if (e.kind === 'slam' || e.kind === 'implode') this.shake = Math.max(this.shake, 0.6 / (1 + near / 15));
        break;
      }
      case 'link': case 'strings': case 'chainline': if (e.actor && e.target) this.beam(e.actor.center, e.target.center, e.color ?? '#fff', now, e.dur ?? 0.5, e.kind === 'chainline' ? 0.08 : 0.03, 'tether', e.actor, e.target); break;
      case 'wish': case 'voidshield': case 'bloodpact': case 'parrystance': P.emit(p, n(25), c, { speed: 2.5, life: 0.6, size: 0.3 }); break;
      case 'papers': P.emit({ x: p.x, y: p.y + 1, z: p.z }, n(40), new THREE.Color('#fff6d8'), { speed: 4, life: 0.8, size: 0.28, grav: -1, spread: 1 }); break;
      case 'smoke': P.emit({ x: p.x, y: p.y + 1, z: p.z }, n(40), new THREE.Color('#3a2a5a'), { speed: 2.5, life: 1.0, size: 0.8, spread: 1.2, up: 0.5 }); break;
      case 'flash': case 'chargetrail': if (e.actor) this.add(new THREE.Object3D(), 'trail', now, e.dur ?? 0.3, { actor: e.actor, r: 0 }); (this.timed[this.timed.length - 1].obj as any).__col = c; break;
      case 'lance': case 'soundcone': case 'brandcone': if (e.to) {
        const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        const w = e.kind === 'lance' ? 1 : e.kind === 'soundcone' ? 5 : 4;
        this.orient(cone, p, e.to, 1);
        const l = Math.hypot(e.to.x - p.x, e.to.y - p.y, e.to.z - p.z);
        cone.scale.set(w, w, l);
        this.add(cone, 'fade', now, 0.35);
        P.emit(e.to, n(20), c, { speed: 4, life: 0.4, size: 0.3 });
        break;
      }
      case 'cut': if (e.to) { this.beam(p, e.to, '#9d7bff', now, 0.2, 0.08); P.emit(e.to, n(20), c, { speed: 6, life: 0.3, size: 0.25 }); } break;
      case 'arrowhit': {
        const top = { x: p.x, y: p.y + 14, z: p.z };
        this.beam(top, p, '#fff2b0', now, 0.12, 0.05);
        P.emit(p, n(8), c, { speed: 4, life: 0.35, size: 0.25 });
        break;
      }
      case 'immune': case 'blocked': case 'interrupt': P.emit(p, n(16), c, { speed: 3, life: 0.4, size: 0.22 }); this.ring(p, 1.2, e.color ?? '#fff', now, 0.3, false); break;
      case 'zonebreak': this.ring(p, e.r ?? 6, e.color ?? '#9d7bff', now, 0.5); P.emit(p, n(50), c, { speed: 6, life: 0.6, size: 0.3, spread: e.r ?? 4 }); break;
      case 'singularity': P.emit(p, n(30), c, { speed: 3, life: 0.6, size: 0.4, spread: 3 }); break;
      case 'fall': break;
      case 'bossbeam': if (e.to) { this.beam(p, e.to, e.color ?? '#fff', now, 0.07, 0.45); this.beam(p, e.to, '#ffffff', now, 0.07, 0.15); P.emit(e.to, n(3), c, { speed: 4, life: 0.3, size: 0.5 }); } break;
      default: P.emit(p, n(10), c, { speed: 3, life: 0.4, size: 0.25 });
    }
  }

  private zigzag(a: V3, b: V3, color: string, now: number) {
    const pts: THREE.Vector3[] = [];
    const segs = 7;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const j = i === 0 || i === segs ? 0 : 0.5;
      pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t + (Math.random() - 0.5) * j, a.y + (b.y - a.y) * t + (Math.random() - 0.5) * j, a.z + (b.z - a.z) * t + (Math.random() - 0.5) * j));
    }
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.04, 4, false);
    this.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })), 'fadegeo', now, 0.18);
  }

  // ------------------------------------------------------------------ per-frame sync
  update(dt: number, w: World, now: number) {
    this.parts.update(dt);
    if (now > this.flashUntil) this.flash.intensity *= 0.8;
    this.shake *= Math.pow(0.02, dt);
    // timed objects
    this.timed = this.timed.filter(t => {
      const k = (now - t.born) / t.dur;
      if (k >= 1) { this.group.remove(t.obj); if (t.kind === 'fadegeo' || t.kind === 'pod') (t.obj as THREE.Mesh).geometry.dispose(); const m = (t.obj as THREE.Mesh).material as THREE.Material; m?.dispose?.(); return false; }
      const mat = (t.obj as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (t.kind === 'ring') { const r = (t.r ?? 1) * (0.2 + 0.8 * Math.sqrt(k)); t.obj.scale.setScalar(r); if (mat) mat.opacity = 0.9 * (1 - k); }
      else if (t.kind === 'beam' || t.kind === 'fade' || t.kind === 'fadegeo') { if (mat) mat.opacity = 0.9 * (1 - k); }
      else if (t.kind === 'shatter') { t.obj.scale.set(Math.min(1, k * 2.6), Math.min(1, k * 2.6), 1); if (mat) mat.opacity = 0.75 * (1 - k * k); }
      else if (t.kind === 'tether' && t.actor && t.target) { this.orient(t.obj, t.actor.center, t.target.center, t.r ?? 0.03); if (mat) mat.opacity = 0.7 + 0.3 * Math.sin(now * 20); t.obj.visible = t.actor.alive && t.target.alive; }
      else if (t.kind === 'trail' && t.actor) { const c = (t.obj as any).__col as THREE.Color; this.parts.emit(t.actor.center, 3, c, { speed: 1, life: 0.35, size: 0.4, spread: 0.6 }); }
      else if (t.kind === 'pod' && t.from) {
        const s = now - t.born;
        t.obj.position.set(t.from.x - s * 2, t.from.y + s * 9 - s * s * 2.2, t.from.z + s * 1.5); t.obj.rotation.z = s * 3;
        this.parts.emit(t.obj.position, 2, new THREE.Color('#ffb040'), { speed: 1, life: 0.4, size: 0.3 });
      }
      return true;
    });
    this.syncProjectiles(w.projs, now);
    this.syncZones(w.zones, now);
    this.syncBeams(w, now);
    this.statusFx(w, now, dt);
  }

  private syncProjectiles(projs: Proj[], now: number) {
    const seen = new Set<number>();
    for (const p of projs) {
      seen.add(p.id);
      let m = this.projMeshes.get(p.id);
      const col = new THREE.Color(FXCOL[p.fx] ?? '#ffffff');
      if (!m) {
        m = new THREE.Group();
        const core = new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({ color: col.clone().lerp(new THREE.Color('#ffffff'), 0.5) }));
        const glow = new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
        const r = p.fx === 'fist' ? 0.45 : p.fx === 'hexbomb' ? 0.3 : p.heal ? 0.22 : p.splash ? 0.2 : 0.09;
        core.scale.setScalar(r); glow.scale.setScalar(r * 2.6);
        if (['sun', 'reveal', 'shadow', 'hex', 'bolt'].includes(p.fx) && !p.splash) core.scale.set(r * 0.8, r * 0.8, r * 5);
        m.add(core, glow);
        this.group.add(m); this.projMeshes.set(p.id, m);
      }
      m.position.set(p.pos.x, p.pos.y, p.pos.z);
      const v = new THREE.Vector3(p.vel.x, p.vel.y, p.vel.z);
      if (v.lengthSq() > 0.01) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v.normalize());
      if (Math.random() < 0.6) this.parts.emit(p.pos, 1, col, { speed: 0.5, life: 0.25, size: p.splash ? 0.3 : 0.14 });
      if (p.fx === 'chain' || p.fx === 'fist') {
        // draw the chain / cable back to the thrower
        const key = -p.id;
        let line = this.beamMeshes.get(key);
        if (!line) { line = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })); this.group.add(line); this.beamMeshes.set(key, line); }
        this.orient(line, p.owner.center, p.pos, 0.05);
      }
    }
    for (const [id, m] of this.projMeshes) if (!seen.has(id)) {
      this.group.remove(m); this.projMeshes.delete(id);
      const line = this.beamMeshes.get(-id); if (line) { this.group.remove(line); this.beamMeshes.delete(-id); }
    }
    void now;
  }

  private syncZones(zones: Zone[], now: number) {
    const seen = new Set<number>();
    for (const z of zones) {
      if (z.kind === 'tether') continue;
      seen.add(z.id);
      let m = this.zoneMeshes.get(z.id);
      if (z.kind === 'tele') {
        // boss attack warning: a red shape whose inner fill grows until the hit lands
        const d = z.data;
        if (!m) {
          m = new THREE.Group();
          const geo = d.shape === 'line' ? new THREE.PlaneGeometry(1, 1) : new THREE.CircleGeometry(1, 48);
          const mat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, side: THREE.DoubleSide,
            uniforms: { k: { value: 0 }, c: { value: new THREE.Color(d.color ?? '#ff3355') }, line: { value: d.shape === 'line' ? 1 : 0 } },
            vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
            fragmentShader: `uniform float k; uniform vec3 c; uniform float line; varying vec2 vUv;
              void main(){ vec2 p=vUv-0.5; float r = line>0.5 ? abs(p.y)*2.0 : length(p)*2.0; if(r>1.0) discard;
                float edge=smoothstep(0.88,0.97,r); float fill=step(r,k)*0.35; float warn=mix(vec3(1.0,0.15,0.2),c,0.35).r;
                gl_FragColor=vec4(mix(vec3(1.0,0.12,0.16),c,0.3),(edge*0.9+fill+0.12)); }`,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.rotation.x = -Math.PI / 2;
          if (d.shape === 'line') {
            const L = Math.hypot(d.x2 - d.x, d.z2 - d.z);
            mesh.scale.set(L, z.r * 2, 1);
            m.position.set((d.x + d.x2) / 2, z.y + 0.1, (d.z + d.z2) / 2);
            m.rotation.y = -Math.atan2(d.z2 - d.z, d.x2 - d.x);
          } else { mesh.scale.setScalar(z.r); m.position.set(z.x, z.y + 0.1, z.z); }
          m.add(mesh);
          this.group.add(m); this.zoneMeshes.set(z.id, m);
        }
        const k = Math.min(1, (now - z.born) / Math.max(0.01, d.fireAt - z.born));
        ((m.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.k.value = k;
        m.visible = !d.done;
        continue;
      }
      const col = new THREE.Color(z.kind === 'seal' || z.kind === 'sanctuary' ? '#ffe28a' : z.kind === 'grievous' ? '#c77dff' : z.kind === 'singularity' ? '#ff2244' : '#ffd27a');
      if (!m) {
        m = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CircleGeometry(z.r, 64), new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
          uniforms: { t: { value: 0 }, c: { value: col }, kind: { value: ['seal', 'sanctuary', 'grievous', 'singularity', 'arrows'].indexOf(z.kind) } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
          fragmentShader: `uniform float t; uniform vec3 c; uniform float kind; varying vec2 vUv;
            void main(){ vec2 p=vUv-0.5; float r=length(p)*2.0; float a=atan(p.y,p.x);
              float edge=smoothstep(0.9,0.98,r)*(1.0-smoothstep(0.98,1.0,r));
              float glyph=0.0;
              if(kind<0.5){ glyph=smoothstep(0.03,0.0,abs(r-0.62))+smoothstep(0.02,0.0,abs(sin(a*5.0+t*0.8))*r-0.02)*step(r,0.62)*0.6+smoothstep(0.02,0.0,abs(r-0.35)); }
              else if(kind<1.5){ glyph=0.25+0.2*sin(r*18.0-t*3.0); }
              else if(kind<2.5){ glyph=0.3*smoothstep(0.4,0.9,sin(a*3.0+r*10.0-t*2.0)); }
              else if(kind<3.5){ glyph=0.5*smoothstep(0.3,0.9,sin(a*2.0+r*14.0+t*8.0))*(1.0-r); }
              else { glyph=0.15; }
              gl_FragColor=vec4(c,(edge*0.9+glyph*0.55)*(1.0-smoothstep(0.99,1.0,r))); }`,
        }));
        disc.rotation.x = -Math.PI / 2; disc.position.y = 0.08;
        m.add(disc);
        if (z.kind === 'sanctuary') {
          const dome = new THREE.Mesh(new THREE.SphereGeometry(z.r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
          m.add(dome);
        }
        if (z.kind === 'singularity') {
          const core = new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({ color: '#12000a' }));
          core.scale.setScalar(1.2); core.position.y = 1.5; core.name = 'core';
          const halo = new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
          halo.scale.setScalar(2); halo.position.y = 1.5; halo.name = 'halo';
          m.add(core, halo);
        }
        m.position.set(z.x, z.y, z.z);
        this.group.add(m); this.zoneMeshes.set(z.id, m);
      }
      ((m.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.t.value = now;
      const life = (z.until - now) / (z.until - z.born);
      m.children[0].scale.setScalar(Math.min(1, (now - z.born) * 4) * (life < 0.1 ? life * 10 : 1));
      if (z.kind === 'singularity') { const h = m.getObjectByName('halo')!; h.scale.setScalar(2 + Math.sin(now * 20) * 0.3); this.parts.emit({ x: z.x + (Math.random() - 0.5) * z.r * 2, y: z.y + 0.5, z: z.z + (Math.random() - 0.5) * z.r * 2 }, 2, col, { speed: 0.5, life: 0.5, size: 0.3 }); }
      if (z.kind === 'seal' && Math.random() < 0.5) this.parts.emit({ x: z.x + (Math.random() - 0.5) * z.r * 1.6, y: z.y + 0.2, z: z.z + (Math.random() - 0.5) * z.r * 1.6 }, 1, col, { speed: 0.3, life: 1, size: 0.25, up: 1.5 });
      if (z.kind === 'grievous' && Math.random() < 0.6) this.parts.emit({ x: z.x + (Math.random() - 0.5) * z.r * 1.6, y: z.y + 0.2, z: z.z + (Math.random() - 0.5) * z.r * 1.6 }, 1, col, { speed: 0.3, life: 1.2, size: 0.35, up: 1 });
    }
    for (const [id, m] of this.zoneMeshes) if (!seen.has(id)) { this.group.remove(m); this.zoneMeshes.delete(id); }
  }

  private syncBeams(w: World, now: number) {
    const seen = new Set<number>();
    for (const a of w.actors) {
      if (a.alive && a.beamOn && a.beamTarget) {
        seen.add(a.id);
        let m = this.beamMeshes.get(a.id);
        if (!m) { m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: a.def.glow, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })); this.group.add(m); this.beamMeshes.set(a.id, m); }
        const from = w.muzzle(a);
        this.orient(m, from, a.beamTarget.center, 0.05 + Math.sin(now * 25) * 0.01);
        if (Math.random() < 0.5) this.parts.emit(a.beamTarget.center, 1, new THREE.Color('#9dffb0'), { speed: 1, life: 0.5, size: 0.2, up: 1.5 });
      }
      // Enra's hellflame cone
      let f = this.flameMeshes.get(a.id);
      if (a.alive && a.flameOn) {
        if (!f) { f = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: '#ff6a2a', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); this.group.add(f); this.flameMeshes.set(a.id, f); }
        f.visible = true;
        const from = w.muzzle(a), d = a.aimDir(), range = a.def.primary.range * (a.has('asura', now) ? 1.5 : 1) * a.scale;
        this.orient(f, from, { x: from.x + d.x * range, y: from.y + d.y * range, z: from.z + d.z * range }, 1);
        f.scale.set(range * 0.27, range * 0.27, range);
        (f.material as THREE.MeshBasicMaterial).opacity = 0.07 + Math.random() * 0.05;
        for (let i = 0; i < 3; i++) this.parts.emit(from, 1, new THREE.Color(Math.random() < 0.5 ? '#ff6a2a' : '#b026ff'), { speed: range * 1.6, life: 0.5, size: 0.45, dir: d });
      } else if (f) f.visible = false;
    }
    for (const [id, m] of this.beamMeshes) if (id > 0 && !seen.has(id)) { this.group.remove(m); this.beamMeshes.delete(id); }
  }

  private statusFx(w: World, now: number, dt: number) {
    const k = Math.min(1, dt * 60);
    for (const a of w.actors) {
      if (!a.alive) continue;
      const c = a.center;
      if (a.has('brand', now) && Math.random() < 0.3 * k) this.parts.emit(c, 1, new THREE.Color('#ff6a2a'), { speed: 0.8, life: 0.6, size: 0.25, up: 1.5, spread: a.radius });
      if (a.has('bleed', now) && Math.random() < 0.3 * k) this.parts.emit(c, 1, new THREE.Color('#ff1744'), { speed: 0.8, life: 0.6, size: 0.2, grav: 4, spread: a.radius });
      if (a.has('stun', now) && Math.random() < 0.4 * k) { const t = now * 6; this.parts.emit({ x: a.pos.x + Math.cos(t) * 0.5, y: a.pos.y + a.height + 0.2, z: a.pos.z + Math.sin(t) * 0.5 }, 1, new THREE.Color('#ffee58'), { speed: 0.1, life: 0.3, size: 0.2 }); }
      if (a.has('root', now) && Math.random() < 0.4 * k) { const t = Math.random() * 6.28; this.parts.emit({ x: a.pos.x + Math.cos(t) * a.radius, y: a.pos.y + 0.1, z: a.pos.z + Math.sin(t) * a.radius }, 1, new THREE.Color('#c77dff'), { speed: 0.2, life: 0.4, size: 0.2 }); }
      if (a.has('silence', now) && Math.random() < 0.3 * k) this.parts.emit({ x: a.pos.x, y: a.pos.y + a.height + 0.3, z: a.pos.z }, 1, new THREE.Color('#ff4d6d'), { speed: 0.3, life: 0.4, size: 0.3 });
      if (a.has('antiheal', now) && Math.random() < 0.2 * k) this.parts.emit(c, 1, new THREE.Color('#7b2cbf'), { speed: 0.5, life: 0.6, size: 0.25, up: 0.8, spread: a.radius });
      if (a.has('hot', now) && Math.random() < 0.3 * k) this.parts.emit(c, 1, new THREE.Color('#9dffb0'), { speed: 0.5, life: 0.7, size: 0.2, up: 1.5, spread: a.radius });
      if (a.has('judgment', now) && Math.random() < 0.5 * k) this.parts.emit(c, 1, new THREE.Color('#8ad8ff'), { speed: 3, life: 0.2, size: 0.18, spread: a.radius * 2 });
      if (a.has('asura', now) && Math.random() < 0.6 * k) this.parts.emit(c, 1, new THREE.Color(Math.random() < 0.5 ? '#ff6a2a' : '#b026ff'), { speed: 1, life: 0.5, size: 0.4, up: 2.5, spread: a.radius * 1.5 });
      if (a.flying && Math.random() < 0.5 * k) this.parts.emit({ x: a.pos.x, y: a.pos.y + a.height * 0.6, z: a.pos.z }, 1, new THREE.Color(a.def.glow), { speed: 0.6, life: 0.6, size: 0.22, spread: 0.8, grav: 1 });
      if (a.def.frame === 'mech' && a.forced && Math.random() < 0.8) this.parts.emit({ x: a.pos.x, y: a.pos.y + a.height * 0.6, z: a.pos.z }, 2, new THREE.Color('#ffb040'), { speed: 2, life: 0.3, size: 0.35, dir: { x: -a.vel.x * 0.1, y: -0.5, z: -a.vel.z * 0.1 } });
    }
  }
}
