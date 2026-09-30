// Kaien's Divine Seal Storm (after Byakuya's Senbonzakura Kageyoshi, docs/research/senbonzakura_study.md): a storm of
// golden paper seals for 15 s. The release - two rows of tall seals standing up out of the ground behind him, a beat,
// then they break into the swarm; the swarm moves as STREAMS, ribbons of tumbling cards that curve round him, never a
// cloud; a shield of seals closes round him in layers a metre out, thinning as it's spent and re-forming with a snap;
// each beat a ribbon flows to every enemy in reach and bursts on it in paper scraps, a gold flash and red sigils; the
// mending seals ring an ally in green-gold; at the end the seals lose their light and flutter down as paper.
//
// One InstancedMesh draws every card (system32-82's prop_kaien_seal, the film's talisman cut to 399 tris; a plain paper
// card until it loads), refilled every frame from the storms' card lists; per-instance colour carries the glow.
import * as THREE from 'three';
import type { V3 } from '../engine/Physics';
import type { Actor } from '../game/Actor';
import type { World } from '../game/World';
import { hasProp, loadManifest, propModel } from './Assets';

/** cards drawn at once (a shield is ~60, a ribbon ~22, the release rows 14 tall ones) */
const MAX = 900;
/** a card's height (m); the release rows' seals; the shield's radius round him */
const CARD = 0.42, TALL = 2.8, SHIELD_R = 1.05;
/** the shield at full strength: this many seals */
const SHIELD_N = 60;
/** the release: seals a row, the rows' spacing behind him and to each side */
const ROW_N = 7, ROW_STEP = 0.95, ROW_SIDE = 1.7, ROW_BACK = 1.6;
/** the ambient streams round him, cards a stream, spacing along it (in the loop's 0..1) */
const STREAMS = 4, STREAM_N = 18, STREAM_GAP = 0.016;
/** a strike ribbon: cards, their spacing, seconds to reach the target, the ribbon's life */
const STRIKE_N = 22, STRIKE_GAP = 0.035, STRIKE_SECS = 0.3, STRIKE_LIFE = 0.62;
/** the fall at the end: seconds a card flutters down for */
const FALL_SECS = 1.7;
const GOLD = new THREE.Color('#ffe28a'), BRIGHT = new THREE.Color('#fff3c8'), DULL = new THREE.Color('#6a6250'), MEND = new THREE.Color('#9dffb0');

interface Ribbon { from: V3; to: V3; born: number; side: number; up: number; seed: number }
interface Falling { p: THREE.Vector3; v: THREE.Vector3; q: THREE.Quaternion; spin: THREE.Vector3; born: number; s: number }
interface Storm {
  actor: Actor; born: number; until: number; yaw: number; live: boolean;
  shieldAt: number;                      // when the shield last (re)formed: it snaps in over 0.25 s
  phase: number[];                       // each stream's own phase
}
interface Mend { actor: Actor; born: number; seed: number }

export interface SealFx {
  emit: (p: V3, n: number, color: THREE.Color, o: { speed?: number; life?: number; size?: number; grav?: number; spread?: number; up?: number }) => void;
  ring: (p: V3, r: number, color: string, now: number, dur?: number) => void;
  light: (p: V3, color: string, intensity: number, now: number, dur?: number) => void;
}

export class SealStorm {
  group = new THREE.Group();
  /** the seal prop loaded (the match preloader waits for it, so the storm's first frame compiles nothing) */
  ready: Promise<void>;
  private mesh: THREE.InstancedMesh;
  private storms = new Map<number, Storm>();
  private ribbons: Ribbon[] = [];
  private falling: Falling[] = [];
  private mends: Mend[] = [];
  private M = new THREE.Matrix4(); private Q = new THREE.Quaternion(); private S = new THREE.Vector3();
  private X = new THREE.Vector3(); private Y = new THREE.Vector3(); private Z = new THREE.Vector3(); private B = new THREE.Matrix4();
  private col = new THREE.Color();
  private n = 0;

  constructor(parent: THREE.Object3D, private fx: SealFx) {
    // a plain paper card until the talisman arrives: a tall thin box, gold
    const geo = new THREE.BoxGeometry(0.62, 1, 0.02);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: new THREE.Color('#ffd27a'), emissiveIntensity: 0.4, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3).fill(1), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = false;
    this.group.add(this.mesh);
    parent.add(this.group);
    this.ready = this.load();
  }

  private async load() {
    await loadManifest();
    if (!hasProp('prop_kaien_seal')) return;
    const m = await propModel('prop_kaien_seal');
    if (!m) return;
    let src: THREE.Mesh | null = null;
    m.traverse(o => { const me = o as THREE.Mesh; if (me.isMesh && !src) src = me; });
    if (!src) return;
    const me = src as THREE.Mesh;
    // the talisman stood in the card's frame: centred, its height 1 (CARD scales it), its long axis up +Y
    const geo = me.geometry.clone(); geo.computeBoundingBox();
    const b = geo.boundingBox!, size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    geo.translate(-c.x, -c.y, -c.z);
    const h = Math.max(size.x, size.y, size.z);
    if (size.x > size.y) geo.rotateZ(Math.PI / 2);
    geo.scale(1 / h, 1 / h, 1 / h);
    const mt = (Array.isArray(me.material) ? me.material[0] : me.material) as THREE.MeshStandardMaterial;
    const mat = mt.clone(); mat.side = THREE.DoubleSide; mat.emissive.set('#ffd27a'); mat.emissiveIntensity = 0.45; mat.emissiveMap = null; mat.metalness = 0; mat.needsUpdate = true;
    this.mesh.geometry.dispose(); this.mesh.geometry = geo;
    (this.mesh.material as THREE.Material).dispose(); this.mesh.material = mat;
  }

  /** the storm's events; true when this was one of them */
  onEvent(e: { kind: string; pos: V3; to?: V3; actor?: Actor; color?: string; r?: number; dur?: number }, now: number): boolean {
    const { fx } = this;
    switch (e.kind) {
      case 'sealstorm': {
        if (!e.actor) return true;
        const a = e.actor;
        this.storms.set(a.id, { actor: a, born: now, until: now + (e.dur ?? 15), yaw: a.yaw, live: false, shieldAt: now, phase: Array.from({ length: STREAMS }, (_, k) => k / STREAMS + Math.random() * 0.1) });
        fx.ring(e.pos, e.r ?? 18, '#ffe28a', now, 1.1); fx.ring(e.pos, 3, '#ffffff', now, 0.5);
        fx.light({ x: e.pos.x, y: e.pos.y + 1, z: e.pos.z }, '#ffe28a', 60, now, 0.5);
        fx.emit({ x: a.pos.x, y: a.pos.y + 0.3, z: a.pos.z }, 40, GOLD, { speed: 3, life: 1.2, size: 0.3, up: 4, spread: 2.5 });
        return true;
      }
      case 'sealshield': {
        const s = e.actor && this.storms.get(e.actor.id);
        if (s) s.shieldAt = now;
        fx.ring(e.pos, 1.6, '#ffe28a', now, 0.35); fx.emit(e.pos, 14, BRIGHT, { speed: 2, life: 0.4, size: 0.2, spread: 1 });
        return true;
      }
      case 'sealstrike': {
        if (!e.to) return true;
        this.ribbons.push({ from: { ...e.pos }, to: { ...e.to }, born: now, side: Math.random() < 0.5 ? -1 : 1, up: 0.6 + Math.random() * 1.2, seed: Math.random() * 7 });
        return true;
      }
      case 'sealburst': {
        // paper scraps, a small gold flash, red sigil lines
        fx.emit(e.pos, 14, GOLD, { speed: 3.5, life: 0.5, size: 0.16, grav: 5, spread: 0.5 });
        fx.emit(e.pos, 6, new THREE.Color('#ff3a2a'), { speed: 1.5, life: 0.35, size: 0.22, spread: 0.4 });
        fx.ring(e.pos, 0.9, '#ff5a3a', now, 0.3); fx.light(e.pos, '#ffd27a', 18, now, 0.1);
        return true;
      }
      case 'sealmend': {
        if (e.actor) this.mends.push({ actor: e.actor, born: now, seed: Math.random() * 7 });
        fx.emit(e.pos, 8, MEND, { speed: 1.2, life: 0.7, size: 0.2, up: 2, spread: 0.5 });
        fx.ring(e.pos, 1.3, '#9dffb0', now, 0.4); fx.light(e.pos, '#9dffb0', 14, now, 0.15);
        return true;
      }
    }
    return false;
  }

  /** a card's rotation from its facing (normal) and the direction of its long axis, left in Q */
  private orient(normal: THREE.Vector3, up: THREE.Vector3) {
    const z = this.Z.copy(normal).normalize(), y = this.Y.copy(up).addScaledVector(z, -up.dot(z));
    if (y.lengthSq() < 1e-6) y.set(0, 1, 0).addScaledVector(z, -z.y);
    y.normalize();
    const x = this.X.crossVectors(y, z);
    this.Q.setFromRotationMatrix(this.B.makeBasis(x, y, z));
    return this.Q;
  }

  /** a card: position, facing (its normal), up along its long axis, height, colour */
  private card(p: THREE.Vector3, normal: THREE.Vector3, up: THREE.Vector3, h: number, c: THREE.Color) {
    if (this.n >= MAX) return;
    this.orient(normal, up);
    this.S.setScalar(h);
    this.M.compose(p, this.Q, this.S);
    this.mesh.setMatrixAt(this.n, this.M); this.mesh.setColorAt(this.n, c);
    this.n++;
  }

  /** the ambient stream round the caster: a looping path that swells and dips, streams offset in phase */
  private streamAt(s: Storm, u: number, k: number, out: THREE.Vector3) {
    const a = s.actor, th = u * Math.PI * 2 + k * 1.7, R = 3.2 + 1.3 * Math.sin(u * Math.PI * 4 + k), h = a.height * 0.55 + 1.1 * Math.sin(u * Math.PI * 6 + k * 2.1);
    return out.set(a.pos.x + Math.cos(th) * R, a.pos.y + h, a.pos.z + Math.sin(th) * R);
  }

  /** a strike ribbon's path: a bezier from him to the target, bulging out to one side and up */
  private strikeAt(r: Ribbon, u: number, out: THREE.Vector3) {
    const dx = r.to.x - r.from.x, dz = r.to.z - r.from.z, L = Math.hypot(dx, dz) || 1, sx = -dz / L * r.side, sz = dx / L * r.side;
    const bulge = Math.min(3, L * 0.35);
    const P0 = r.from, P3 = r.to;
    const P1 = { x: P0.x + dx * 0.3 + sx * bulge, y: P0.y + (P3.y - P0.y) * 0.3 + r.up, z: P0.z + dz * 0.3 + sz * bulge };
    const P2 = { x: P0.x + dx * 0.7 - sx * bulge * 0.5, y: P0.y + (P3.y - P0.y) * 0.7 + r.up * 0.4, z: P0.z + dz * 0.7 - sz * bulge * 0.5 };
    const t = u, mt = 1 - t, a0 = mt * mt * mt, a1 = 3 * mt * mt * t, a2 = 3 * mt * t * t, a3 = t * t * t;
    return out.set(a0 * P0.x + a1 * P1.x + a2 * P2.x + a3 * P3.x, a0 * P0.y + a1 * P1.y + a2 * P2.y + a3 * P3.y, a0 * P0.z + a1 * P1.z + a2 * P2.z + a3 * P3.z);
  }

  /** the storm ends: what was in the air falls as paper */
  private drop(p: THREE.Vector3, q: THREE.Quaternion, s: number, now: number) {
    this.falling.push({ p: p.clone(), v: new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.3 + Math.random() * 0.6, (Math.random() - 0.5) * 1.2), q: q.clone(), spin: new THREE.Vector3(Math.random() * 4 - 2, Math.random() * 6 - 3, Math.random() * 4 - 2), born: now, s });
  }

  update(w: World, now: number, dt: number) {
    this.n = 0;
    const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const [id, s] of this.storms) {
      const a = s.actor, age = now - s.born;
      const has = a.alive && a.has('sealstorm', now) && now < s.until + 0.2;
      if (has) s.live = true;
      // (the preloader's sample fires the cast on a hero without the status: one frame of the release compiles the
      // swarm's shaders, then it's dropped without a fall)
      const on = has || (!s.live && age < 0.1);
      if (!on) {
        // over: the shield and the streams fall as dull paper
        if (s.live) {
          for (let k = 0; k < SHIELD_N; k++) { this.shieldCard(s, k, now, 1, tmp, tmp2); this.drop(tmp, this.orient(tmp2, up), CARD, now); }
          for (let k = 0; k < STREAMS; k++) for (let i = 0; i < STREAM_N; i++) {
            const u = ((s.phase[k] + now * 0.28 - i * STREAM_GAP) % 1 + 1) % 1;
            this.streamAt(s, u, k, tmp); this.streamAt(s, u + 0.01, k, tmp2); tmp2.sub(tmp).normalize();
            this.drop(tmp, this.orient(tmp2, up), CARD, now);
          }
        }
        this.storms.delete(id); continue;
      }
      // the release: two rows of tall seals rising out of the ground behind him, holding a beat, dissolving top-down
      if (age < 1.5) {
        const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
        for (let side = -1; side <= 1; side += 2) for (let i = 0; i < ROW_N; i++) {
          const t0 = i * 0.045 + (side > 0 ? 0.02 : 0), rise = Math.min(1, Math.max(0, (age - t0) / 0.35)), gone = Math.min(1, Math.max(0, (age - 0.95 - i * 0.03) / 0.4));
          if (rise <= 0 || gone >= 1) continue;
          const k = rise * rise * (3 - 2 * rise) * (1 - gone), h = TALL * k;
          const d = ROW_BACK + i * ROW_STEP;
          tmp.set(a.pos.x - fx * d + rx * side * ROW_SIDE, a.pos.y + h * 0.5, a.pos.z - fz * d + rz * side * ROW_SIDE);
          tmp2.set(fx, 0, fz);
          this.col.copy(GOLD).lerp(BRIGHT, 0.5 * Math.max(0, 1 - Math.abs(age - 0.9) / 0.3));
          this.card(tmp, tmp2, up, h, this.col);
          if (gone > 0 && gone < 1 && Math.random() < 0.5) this.fx.emit({ x: tmp.x, y: tmp.y + h * 0.5 * (1 - gone), z: tmp.z }, 1, GOLD, { speed: 2, life: 0.5, size: 0.2, spread: 0.8 });
        }
      }
      // the shield: a sphere of seals, layered like scales, thinning with what's left of it
      const sh = a.shields.find(x => x.kind === 'sealshield' && x.amt > 0);
      if (sh) {
        const frac = Math.min(1, Math.max(0.25, sh.amt / 300)), snap = Math.min(1, (now - s.shieldAt) / 0.25);
        const N = Math.round(SHIELD_N * frac);
        for (let k = 0; k < N; k++) { this.shieldCard(s, k, now, snap, tmp, tmp2); this.col.copy(GOLD).lerp(BRIGHT, 0.3 + 0.3 * Math.sin(now * 5 + k)); this.card(tmp, tmp2, up, CARD * (0.6 + 0.4 * snap), this.col); }
      }
      // the streams: ribbons of tumbling cards curving round him, the head of each brighter
      const flow = age < 1.2 ? Math.min(1, Math.max(0, (age - 0.8) / 0.4)) : 1;
      if (flow > 0) for (let k = 0; k < STREAMS; k++) for (let i = 0; i < STREAM_N; i++) {
        const u = ((s.phase[k] + now * 0.28 - i * STREAM_GAP) % 1 + 1) % 1;
        this.streamAt(s, u, k, tmp); this.streamAt(s, u + 0.01, k, tmp2); tmp2.sub(tmp).normalize();      // the ribbon's tangent
        const spin = now * 7 + i * 0.6 + k, nrm = new THREE.Vector3(0, 1, 0).cross(tmp2).normalize().applyAxisAngle(tmp2, spin);
        this.col.copy(GOLD).lerp(BRIGHT, Math.max(0, 1 - i / 5) * 0.8);
        this.card(tmp, nrm, tmp2, CARD * flow * (1 - i / (STREAM_N * 1.6)), this.col);
      }
    }
    // the strike ribbons: cards flowing along the bezier, arriving over STRIKE_SECS, gone on arrival
    this.ribbons = this.ribbons.filter(r => {
      const age = now - r.born;
      if (age > STRIKE_LIFE) return false;
      const head = age / STRIKE_SECS;
      for (let i = 0; i < STRIKE_N; i++) {
        const u = head - i * STRIKE_GAP;
        if (u <= 0 || u >= 1) continue;
        this.strikeAt(r, u, tmp); this.strikeAt(r, Math.min(1, u + 0.02), tmp2); tmp2.sub(tmp).normalize();
        const nrm = new THREE.Vector3(0, 1, 0).cross(tmp2).normalize().applyAxisAngle(tmp2, now * 9 + i * 0.7 + r.seed);
        this.col.copy(GOLD).lerp(BRIGHT, Math.max(0, 1 - i / 4) * 0.9);
        this.card(tmp, nrm, tmp2, CARD * (0.75 + 0.25 * Math.min(1, u * 4)), this.col);
      }
      return true;
    });
    // the mending seals: a ring of green-gold cards rising round the ally
    this.mends = this.mends.filter(m => {
      const age = now - m.born, a = m.actor;
      if (age > 0.7 || !a.alive) return false;
      const k = age / 0.7;
      for (let i = 0; i < 8; i++) {
        const th = i / 8 * Math.PI * 2 + now * 2.5 + m.seed, R = a.radius + 0.35;
        tmp.set(a.pos.x + Math.cos(th) * R, a.pos.y + a.height * (0.25 + 0.55 * k), a.pos.z + Math.sin(th) * R);
        tmp2.set(Math.cos(th), 0, Math.sin(th));
        this.col.copy(MEND).lerp(GOLD, 0.35);
        this.card(tmp, tmp2, up, CARD * 0.7 * Math.sin(k * Math.PI), this.col);
      }
      return true;
    });
    // paper falling at the end: drifting down, swaying, losing its light
    this.falling = this.falling.filter(f => {
      const age = now - f.born;
      if (age > FALL_SECS) return false;
      f.v.y -= 2.6 * dt; f.v.multiplyScalar(Math.pow(0.35, dt));
      f.p.addScaledVector(f.v, dt); f.p.x += Math.sin(age * 5 + f.s) * 0.9 * dt;
      f.q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(f.spin.x * dt, f.spin.y * dt, f.spin.z * dt)));
      const k = age / FALL_SECS;
      this.col.copy(GOLD).lerp(DULL, Math.min(1, k * 1.6));
      if (this.n < MAX) { this.S.setScalar(f.s * (1 - k * k)); this.M.compose(f.p, f.q, this.S); this.mesh.setMatrixAt(this.n, this.M); this.mesh.setColorAt(this.n, this.col); this.n++; }
      return true;
    });
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    void w;
  }

  /** the shield's k-th seal: on a fibonacci sphere round him, the sphere turning slowly and breathing; writes the
   *  position to `p` and the outward normal to `nrm` */
  private shieldCard(s: Storm, k: number, now: number, snap: number, p: THREE.Vector3, nrm: THREE.Vector3) {
    const a = s.actor, N = SHIELD_N, y = 1 - (k + 0.5) / N * 2, r = Math.sqrt(1 - y * y), th = k * 2.399963 + now * 0.9 + (k % 2 ? 0.4 : 0);
    const R = SHIELD_R * (0.4 + 0.6 * snap) + 0.06 * Math.sin(now * 6 + k);
    nrm.set(Math.cos(th) * r, y, Math.sin(th) * r);
    p.set(a.pos.x + nrm.x * R, a.pos.y + a.height * 0.5 + nrm.y * R * 1.15, a.pos.z + nrm.z * R);
  }
}
