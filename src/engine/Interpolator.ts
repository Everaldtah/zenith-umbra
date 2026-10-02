// Render interpolation between fixed simulation steps (engine core) - Glenn Fiedler's "Fix Your Timestep!" final form,
// and what Overwatch's client does with its fixed 16 ms command frames.
// The World steps at a fixed rate (120 Hz desktop, 60 Hz web) while the screen runs at its own (57, 60, 144 Hz...), so a
// frame gets 2 steps, then 3, then 2 - or 1, then 0 - and anything drawn straight from the sim state advances unevenly
// on screen (judder; worst on a 144 Hz monitor where every sixth frame shows no movement at all). Before each step we
// snapshot every actor's and projectile's transform; at render time each is drawn at prev + (cur - prev) * alpha with
// alpha = the leftover accumulator / DT, i.e. exactly where it was at the instant being shown. The swap is
// temporary: apply() before the views/camera/FX/HUD read the world, restore() right after the frame is drawn, so the
// simulation never sees an interpolated value.
import type { Actor } from '../game/Actor';

/** a teleport (blink, respawn, ult reposition): further than this in one step snaps instead of sliding */
const SNAP = 3;

interface Pose { x: number; y: number; z: number; yaw: number; pitch: number; stamp: number; }
interface Body { pos: { x: number; y: number; z: number }; yaw?: number; pitch?: number; }

export class Interpolator {
  enabled = true;
  alpha = 1;
  private prev = new WeakMap<object, Pose>();
  private stamp = 0;
  /** cur values parked while the interpolated ones are swapped in */
  private parked: { b: Body; x: number; y: number; z: number; yaw: number; pitch: number }[] = [];
  private nParked = 0;
  private swapped = false;

  /** call right before each World.step */
  snapshot(actors: readonly Actor[], projs: readonly Body[]) {
    const s = ++this.stamp;
    for (const a of actors) this.keep(a, s);
    for (const p of projs) this.keep(p, s);
  }

  private keep(b: Body, s: number) {
    let p = this.prev.get(b);
    if (!p) { p = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, stamp: 0 }; this.prev.set(b, p); }
    p.x = b.pos.x; p.y = b.pos.y; p.z = b.pos.z; p.yaw = b.yaw ?? 0; p.pitch = b.pitch ?? 0; p.stamp = s;
  }

  /** swap the interpolated transforms in. `own` = the local player: its yaw/pitch are the live mouse aim, keep them */
  apply(actors: readonly Actor[], projs: readonly Body[], alpha: number, own: Actor | null) {
    if (this.swapped) this.restore();
    this.alpha = alpha;
    if (!this.enabled || alpha >= 0.999) return;
    this.nParked = 0;
    for (const a of actors) this.lerp(a, alpha, a !== own);
    for (const p of projs) this.lerp(p, alpha, false);
    this.swapped = true;
  }

  private lerp(b: Body, k: number, angles: boolean) {
    const p = this.prev.get(b);
    if (!p || p.stamp !== this.stamp) return;           // born in the latest step: no earlier pose to come from
    const q = b.pos, dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
    if (dx * dx + dy * dy + dz * dz > SNAP * SNAP) return;
    let slot = this.parked[this.nParked];
    if (!slot) slot = this.parked[this.nParked] = { b, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.nParked++;
    slot.b = b; slot.x = q.x; slot.y = q.y; slot.z = q.z; slot.yaw = b.yaw ?? 0; slot.pitch = b.pitch ?? 0;
    q.x = p.x + dx * k; q.y = p.y + dy * k; q.z = p.z + dz * k;
    if (angles && b.yaw !== undefined) {
      let d = b.yaw - p.yaw;
      if (d > Math.PI || d < -Math.PI) d = Math.atan2(Math.sin(d), Math.cos(d));
      b.yaw = p.yaw + d * k;
      if (b.pitch !== undefined) b.pitch = p.pitch + (b.pitch - p.pitch) * k;
    }
  }

  /** put the simulation's own values back */
  restore() {
    if (!this.swapped) return;
    for (let i = 0; i < this.nParked; i++) {
      const s = this.parked[i], b = s.b;
      b.pos.x = s.x; b.pos.y = s.y; b.pos.z = s.z;
      if (b.yaw !== undefined) b.yaw = s.yaw;
      if (b.pitch !== undefined) b.pitch = s.pitch;
      s.b = null as unknown as Body;
    }
    this.nParked = 0;
    this.swapped = false;
  }
}
