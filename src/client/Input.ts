// Keyboard + mouse (pointer lock) -> the player's Actor.input. Aim angles are integrated here.
import type { Actor } from '../game/Actor';

export const KEYS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', descend: 'ControlLeft',
  a1: 'ShiftLeft', a2: 'KeyE', ult: 'KeyQ', reload: 'KeyR', melee: 'KeyC', view: 'KeyV', score: 'Tab', swap: 'KeyH',
};

export class Input {
  keys = new Set<string>();
  mouse = { l: false, r: false };
  yaw = 0; pitch = 0;
  sens = 0.0022;
  locked = false;
  pressedOnce = new Set<string>();
  constructor(public canvas: HTMLCanvasElement) {
    addEventListener('keydown', e => {
      if (e.code === 'Tab') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedOnce.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.l = this.mouse.r = false; });
    canvas.addEventListener('mousedown', e => {
      if (!this.locked) return;
      if (e.button === 0) this.mouse.l = true;
      if (e.button === 2) this.mouse.r = true;
    });
    addEventListener('mouseup', e => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sens;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * this.sens));
    });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === this.canvas; if (!this.locked) { this.mouse.l = this.mouse.r = false; } });
  }
  lock() { if (!this.locked) this.canvas.requestPointerLock?.(); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  once(code: string) { const h = this.pressedOnce.has(code); this.pressedOnce.delete(code); return h; }
  endFrame() { this.pressedOnce.clear(); }

  /** write this frame's controls into the actor (aim pitch/yaw may be overridden by the camera's crosshair solve) */
  apply(a: Actor, aimYaw: number, aimPitch: number) {
    const k = this.keys, i = a.input;
    i.mz = (k.has(KEYS.forward) ? 1 : 0) - (k.has(KEYS.back) ? 1 : 0);
    i.mx = (k.has(KEYS.right) ? 1 : 0) - (k.has(KEYS.left) ? 1 : 0);
    i.jump = k.has(KEYS.jump); i.jumpHeld = i.jump; i.descend = k.has(KEYS.descend);
    i.fire = this.mouse.l; i.alt = this.mouse.r;
    i.a1 = k.has(KEYS.a1) || k.has('ShiftRight'); i.a2 = k.has(KEYS.a2); i.ult = k.has(KEYS.ult); i.reload = k.has(KEYS.reload); i.melee = k.has(KEYS.melee);
    i.yaw = aimYaw; i.pitch = aimPitch;
  }
}
