// Animation level of detail (engine core), after Unreal's Update Rate Optimisation / Animation Budget Allocator that
// Fortnite runs on every character: a hero's skeleton is re-posed at a rate that follows how much of the screen it
// covers. Near or big on screen = every frame; small = 45 or 30 updates a second; off screen = 24 (its shadow still
// moves). On a frame a view sits out, only its root follows the simulation (Game moves view.group), so the body never
// lags its hitbox - just the limbs re-pose a little less often where nobody can see the difference. The view gets the
// real time since its last update when it does run (ClipLayer's inertialization and the gait phase integrate it,
// Animator clamps at 50 ms; the slowest tier here is 42 ms). Updates are staggered so far heroes don't all land on
// the same frame.
import * as THREE from 'three';
import type { Actor } from '../game/Actor';

/** projected hero height (CSS px) at which a view gets every frame / 45 Hz; below that 30 Hz */
const FULL_PX = 110, MID_PX = 50;
const MID = 1 / 45, FAR = 1 / 30, HIDDEN = 1 / 24;

interface Slot { acc: number; }

export class AnimBudget {
  enabled = true;
  /** last frame: views updated / held */
  updated = 0;
  held = 0;
  private slots = new WeakMap<object, Slot>();
  private frustum = new THREE.Frustum();
  private vp = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private cam = new THREE.Vector3();
  private pxPerM = 600;
  private seq = 0;

  /** once a frame, before the views: the camera that will show them (last frame's pose is close enough) */
  begin(camera: THREE.PerspectiveCamera, viewportH: number) {
    this.updated = this.held = 0;
    camera.updateMatrixWorld();
    this.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.vp);
    this.cam.setFromMatrixPosition(camera.matrixWorld);
    this.pxPerM = viewportH / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  }

  /**
   * The dt to update `key`'s view with this frame, or -1 to hold its pose.
   * @param always this view must run every frame (own hero, bosses, the dead / ragdolls, holograms, forced moves)
   */
  step(key: object, a: Actor, dt: number, always: boolean): number {
    let s = this.slots.get(key);
    // new views start at a spread of phases, so the reduced-rate ones don't all update together
    if (!s) { s = { acc: (this.seq++ % 4) * FAR / 4 }; this.slots.set(key, s); }
    if (dt <= 0) { this.updated++; return dt; }                // paused: nothing to accumulate
    s.acc += dt;
    if (!this.enabled || always || s.acc + 1e-3 >= this.interval(a)) {
      // everything since its last update (a long frame still passes through whole, as before)
      const d = Math.min(s.acc, Math.max(dt, 0.05));
      s.acc = 0;
      this.updated++;
      return d;
    }
    this.held++;
    return -1;
  }

  /** the minimum time between this hero's skeleton updates */
  interval(a: Actor): number {
    const h = Math.max(0.5, a.height * a.scale);
    this.sphere.center.set(a.pos.x, a.pos.y + h / 2, a.pos.z);
    this.sphere.radius = h * 0.75 + 0.5;
    if (!this.frustum.intersectsSphere(this.sphere)) return HIDDEN;
    const dist = Math.max(0.1, this.cam.distanceTo(this.sphere.center));
    const px = h * this.pxPerM / dist;
    return px >= FULL_PX ? 0 : px >= MID_PX ? MID : FAR;
  }
}
