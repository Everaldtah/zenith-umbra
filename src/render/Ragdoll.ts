// Ragdoll deaths (desktop edition), the way Overwatch 2 throws its heroes: the moment a hero dies the animated pose
// becomes a set of Verlet particles on the joints, launched with the hero's own momentum plus the killing blow (a bigger
// hit flings harder, the upper body takes more of it so the body tumbles), then left to gravity, the floor and the map's
// walls. The skeleton is driven back from the particles every frame, so the skinned mesh, its held props and the
// cloth follow the fall.
//
// Particles sit on bone heads (plus a head top, hand tips and toes). Bone lengths are rigid distance constraints; extra
// struts keep the pelvis / chest box from shearing; a few minimum distances stand in for joint limits (elbows, knees and
// the neck can't fold through themselves). Fixed 120 Hz sub-steps; floor contact bleeds speed through friction.
import * as THREE from 'three';
import type { Level } from '../engine/Physics';

type Bones = Record<string, THREE.Object3D | undefined>;
interface P { x: THREE.Vector3; prev: THREE.Vector3; r: number; }
interface Link { a: number; b: number; d: number; kind: 'rigid' | 'min' | 'band'; }

const G = 20;                  // a little floatier than the game's 24: the fall reads, as Overwatch's does
const STEP = 1 / 120;
const TONE = 0.45;             // seconds of fading muscle tone after death

export class Ragdoll {
  private p: P[] = [];
  private idx = new Map<string, number>();
  private links: Link[] = [];
  private acc = 0;
  private age = 0;
  // driven bones: [bone, from particle, to particle] (aimed), and the two framed ones (hips, chest)
  private aims: { bone: THREE.Object3D; a: number; b: number; d0: THREE.Vector3; q0: THREE.Quaternion }[] = [];
  private frames: { bone: THREE.Object3D; o: number; up: number; l: number; r: number; B0: THREE.Matrix4; q0: THREE.Quaternion; pos: boolean }[] = [];
  private order: THREE.Object3D[] = [];
  // muscle tone: each particle's place in the pelvis frame at the moment of death - pulled back toward it with a pull
  // that fades out over TONE seconds, so the body staggers with the blow and then crumples (not an instant plank)
  private local: THREE.Vector3[] = [];
  private tone0: THREE.Matrix4 | null = null;

  /**
   * bones: the rig's bone objects by name (hips, chest, neck, head, upperarm_L, forearm_L, hand_L, thigh_L, shin_L,
   * foot_L, and the _R side); H: the hero's height (m, world); vel: its velocity at death; fling: the killing blow's
   * push (world m/s, already scaled by the hit); level: the map (null: a floor at `floorY`)
   */
  constructor(private bones: Bones, private H: number, vel: THREE.Vector3, fling: THREE.Vector3, private level: Level | null, private floorY: number) {
    const wp = (n: string) => bones[n]!.getWorldPosition(new THREE.Vector3());
    const add = (name: string, pos: THREE.Vector3, r: number) => { this.idx.set(name, this.p.length); this.p.push({ x: pos.clone(), prev: pos.clone(), r: r * H }); };
    const hips = wp('hips'), chest = wp('chest'), neck = wp(bones.neck ? 'neck' : 'chest'), head = wp('head');
    const up = chest.clone().sub(hips).normalize();
    add('hips', hips, 0.07); add('chest', chest, 0.075); add('neck', neck, 0.05); add('head', head, 0.06);
    add('top', head.clone().addScaledVector(up, 0.12 * H), 0.06);
    for (const S of ['L', 'R']) {
      const sh = wp(`upperarm_${S}`), el = wp(`forearm_${S}`), wr = wp(`hand_${S}`);
      add(`sh${S}`, sh, 0.045); add(`el${S}`, el, 0.035); add(`wr${S}`, wr, 0.03);
      add(`tip${S}`, wr.clone().add(wr.clone().sub(el).normalize().multiplyScalar(0.07 * H)), 0.025);
      const th = wp(`thigh_${S}`), kn = wp(`shin_${S}`), an = wp(`foot_${S}`);
      add(`th${S}`, th, 0.055); add(`kn${S}`, kn, 0.045); add(`an${S}`, an, 0.035);
      // the toe: forward along the ground from the ankle (the rig's foot bone points there)
      const fwd = bones[`foot_${S}`]!.children.length ? bones[`foot_${S}`]!.children[0].getWorldPosition(new THREE.Vector3()).sub(an) : new THREE.Vector3();
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1).applyQuaternion(bones.hips!.getWorldQuaternion(new THREE.Quaternion())).setY(0);
      add(`toe${S}`, an.clone().add(fwd.normalize().multiplyScalar(0.1 * H)), 0.03);
    }
    const I = (n: string) => this.idx.get(n)!;
    const link = (a: string, b: string, kind: Link['kind'] = 'rigid', k = 1) => this.links.push({ a: I(a), b: I(b), d: this.p[I(a)].x.distanceTo(this.p[I(b)].x) * k, kind });
    // the spine and head
    link('hips', 'chest'); link('chest', 'neck'); link('neck', 'head'); link('head', 'top');
    link('chest', 'head', 'band'); link('neck', 'top', 'band');
    // chest box and pelvis box, tied together
    link('chest', 'shL'); link('chest', 'shR'); link('shL', 'shR'); link('neck', 'shL'); link('neck', 'shR');
    link('shL', 'hips'); link('shR', 'hips');
    link('hips', 'thL'); link('hips', 'thR'); link('thL', 'thR'); link('thL', 'chest'); link('thR', 'chest');
    link('shL', 'thL', 'band'); link('shR', 'thR', 'band');
    for (const S of ['L', 'R']) {
      link(`sh${S}`, `el${S}`); link(`el${S}`, `wr${S}`); link(`wr${S}`, `tip${S}`);
      link(`th${S}`, `kn${S}`); link(`kn${S}`, `an${S}`); link(`an${S}`, `toe${S}`); link(`kn${S}`, `toe${S}`);
      // joint limits: elbows and knees never fold shut, feet stay off the thighs
      const ua = this.p[I(`sh${S}`)].x.distanceTo(this.p[I(`el${S}`)].x), fa = this.p[I(`el${S}`)].x.distanceTo(this.p[I(`wr${S}`)].x);
      this.links.push({ a: I(`sh${S}`), b: I(`wr${S}`), d: (ua + fa) * 0.45, kind: 'min' });
      const tl = this.p[I(`th${S}`)].x.distanceTo(this.p[I(`kn${S}`)].x), sl = this.p[I(`kn${S}`)].x.distanceTo(this.p[I(`an${S}`)].x);
      this.links.push({ a: I(`th${S}`), b: I(`an${S}`), d: (tl + sl) * 0.5, kind: 'min' });
      this.links.push({ a: I('chest'), b: I(`an${S}`), d: (tl + sl) * 0.6, kind: 'min' });
    }
    // launch: the hero's own momentum, plus the blow - upper body more than the legs, so the body tips and tumbles
    const share: Record<string, number> = { hips: 0.75, chest: 1.1, neck: 1.2, head: 1.3, top: 1.35 };
    for (const [n, i] of this.idx) {
      const k = share[n] ?? (/^(sh|el|wr|tip)/.test(n) ? 1.05 : /^(th)/.test(n) ? 0.7 : 0.55);
      const v = vel.clone().addScaledVector(fling, k);
      this.p[i].prev.copy(this.p[i].x).addScaledVector(v, -STEP);
    }
    // driven bones
    const aim = (bone: string, a: string, b: string) => {
      const o = bones[bone]; if (!o) return;
      const A = this.p[I(a)].x, B = this.p[I(b)].x;
      this.aims.push({ bone: o, a: I(a), b: I(b), d0: B.clone().sub(A).normalize(), q0: o.getWorldQuaternion(new THREE.Quaternion()) });
    };
    const frame = (bone: string, o: string, upTo: string, l: string, r: string, pos: boolean) => {
      const obj = bones[bone]; if (!obj) return;
      this.frames.push({ bone: obj, o: I(o), up: I(upTo), l: I(l), r: I(r), B0: this.basis(I(o), I(upTo), I(l), I(r)), q0: obj.getWorldQuaternion(new THREE.Quaternion()), pos });
    };
    frame('hips', 'hips', 'chest', 'thL', 'thR', true);
    frame('chest', 'chest', 'neck', 'shL', 'shR', false);
    if (bones.neck) aim('neck', 'neck', 'head');
    aim('head', 'head', 'top');
    for (const S of ['L', 'R']) {
      aim(`upperarm_${S}`, `sh${S}`, `el${S}`); aim(`forearm_${S}`, `el${S}`, `wr${S}`); aim(`hand_${S}`, `wr${S}`, `tip${S}`);
      aim(`thigh_${S}`, `th${S}`, `kn${S}`); aim(`shin_${S}`, `kn${S}`, `an${S}`); aim(`foot_${S}`, `an${S}`, `toe${S}`);
    }
    // the pose in the pelvis frame (hips at the origin; up to the chest, across the hip joints)
    this.tone0 = this.basis(I('hips'), I('chest'), I('thL'), I('thR'));
    const inv = this.tone0.clone().transpose(), o = this.p[I('hips')].x;
    this.local = this.p.map(q => q.x.clone().sub(o).applyMatrix4(inv));
    // parents before children
    const all = [...this.frames.map(f => f.bone), ...this.aims.map(a => a.bone)];
    const depth = (o: THREE.Object3D) => { let d = 0; for (let q = o.parent; q; q = q.parent) d++; return d; };
    this.order = all.sort((a, b) => depth(a) - depth(b));
  }

  private basis(o: number, u: number, l: number, r: number): THREE.Matrix4 {
    const P = this.p;
    const up = P[u].x.clone().sub(P[o].x).normalize();
    const side = P[l].x.clone().sub(P[r].x); side.addScaledVector(up, -side.dot(up)).normalize();
    const fwd = new THREE.Vector3().crossVectors(side, up).normalize();
    return new THREE.Matrix4().makeBasis(side, up, fwd);
  }

  /** advance the simulation and pose the skeleton; `sink` lowers the body into the floor (the respawn fade) */
  step(dt: number, sink = 0) {
    this.age += dt;
    this.acc += Math.min(dt, 0.1);
    const P = this.p, L = this.level;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      for (const q of P) {
        const v = q.x.clone().sub(q.prev).multiplyScalar(0.996);
        q.prev.copy(q.x);
        q.x.add(v); q.x.y -= G * STEP * STEP;
      }
      // fading muscle tone (see `local`)
      const tone = Math.max(0, 1 - this.age / TONE);
      if (tone > 0 && this.tone0) {
        const I = (n: string) => this.idx.get(n)!;
        const B = this.basis(I('hips'), I('chest'), I('thL'), I('thR')), o = P[I('hips')].x.clone();
        const k = 0.22 * tone * tone;
        P.forEach((q, i) => { const t = this.local[i].clone().applyMatrix4(B).add(o); q.x.lerp(t, k); });
      }
      for (let it = 0; it < 6; it++) {
        for (const c of this.links) {
          const A = P[c.a].x, B = P[c.b].x, d = B.clone().sub(A), len = d.length();
          if (len < 1e-6) continue;
          let want = c.d;
          if (c.kind === 'min') { if (len >= c.d) continue; }
          else if (c.kind === 'band') { want = Math.min(Math.max(len, c.d * 0.85), c.d * 1.15); if (want === len) continue; }
          const k = (len - want) / len * 0.5;
          A.addScaledVector(d, k); B.addScaledVector(d, -k);
        }
        for (const q of P) this.collide(q);
      }
    }
    if (sink > 0) for (const q of P) { q.x.y -= sink; q.prev.y -= sink; }
    this.pose();
  }

  /** the body's first hard landings (pelvis, chest): world position and impact speed (m/s), for the thud */
  onImpact?: (at: THREE.Vector3, speed: number) => void;
  private landed = new Set<number>();

  private collide(q: P) {
    const L = this.level;
    const g = L ? L.groundAt(q.x.x, q.x.z, q.x.y + this.H * 0.3, 0) : this.floorY;
    const floor = Number.isFinite(g) ? g : this.floorY - 50;
    if (q.x.y < floor + q.r) {
      const i = this.p.indexOf(q), vy = (q.prev.y - q.x.y) / STEP;
      if (!this.landed.has(i) && vy > 2.5 && (i === this.idx.get('hips') || i === this.idx.get('chest'))) { this.landed.add(i); this.onImpact?.(q.x.clone(), vy); }
      q.x.y = floor + q.r;
      // floor friction: the body slides a little, then stops
      q.prev.x += (q.x.x - q.prev.x) * 0.18; q.prev.z += (q.x.z - q.prev.z) * 0.18;
      if (q.prev.y < q.x.y) q.prev.y = q.x.y - (q.prev.y - q.x.y) * 0;
    }
    if (L) {
      const w = { x: q.x.x, y: q.x.y - q.r, z: q.x.z };
      if (L.collide(w, q.r, q.r * 2)) { q.x.x = w.x; q.x.z = w.z; q.prev.x += (q.x.x - q.prev.x) * 0.5; q.prev.z += (q.x.z - q.prev.z) * 0.5; }
    }
  }

  private pose() {
    const P = this.p, qp = new THREE.Quaternion(), m = new THREE.Matrix4();
    const setWorldQ = (o: THREE.Object3D, qw: THREE.Quaternion) => {
      if (o.parent) { o.parent.getWorldQuaternion(qp); o.quaternion.copy(qp.invert().multiply(qw)); }
      else o.quaternion.copy(qw);
      o.updateMatrixWorld(true);
    };
    for (const bone of this.order) {
      const f = this.frames.find(x => x.bone === bone);
      if (f) {
        if (f.pos && bone.parent) { bone.position.copy(bone.parent.worldToLocal(P[f.o].x.clone())); }
        const B = this.basis(f.o, f.up, f.l, f.r);
        const dq = new THREE.Quaternion().setFromRotationMatrix(m.copy(B).multiply(f.B0.clone().transpose()));
        setWorldQ(bone, dq.multiply(f.q0));
        continue;
      }
      const a = this.aims.find(x => x.bone === bone)!;
      const d = P[a.b].x.clone().sub(P[a.a].x);
      if (d.lengthSq() < 1e-10) continue;
      const sw = new THREE.Quaternion().setFromUnitVectors(a.d0, d.normalize());
      setWorldQ(bone, sw.multiply(a.q0));
    }
  }

  /** where the body is now (the pelvis), for the camera / effects */
  get center() { return this.p[this.idx.get('hips')!].x; }
}
