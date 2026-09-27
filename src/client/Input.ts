// Keyboard + mouse (pointer lock) -> the player's Actor.input, through the player's bindings (Settings.controls): every
// action checks the codes bound to it - the hero's own override first - so any key, mouse button or wheel notch can drive
// any action. Aim angles are integrated here (sensitivity per hero, invert Y, zoomed sensitivity).
import type { Actor } from '../game/Actor';
import { bindsFor, defaultSettings, type Action, type Settings } from './Settings';

/** legacy fixed codes (menus / e2e tools); gameplay reads the player's bindings */
export const KEYS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', descend: 'ControlLeft',
  a1: 'ShiftLeft', a2: 'KeyE', ult: 'KeyQ', reload: 'KeyR', melee: 'KeyC', swoop: 'KeyF', view: 'KeyV', score: 'Tab', swap: 'KeyH',
};

export class Input {
  /** held codes: keyboard codes and Mouse0..Mouse4 */
  keys = new Set<string>();
  /** kept for tools that press the buttons directly */
  mouse = { l: false, r: false };
  yaw = 0; pitch = 0;
  sens = 0.0022;
  locked = false;
  pressedOnce = new Set<string>();
  settings: Settings = defaultSettings('high');
  /** the hero whose bindings apply (set when the player's hero changes) */
  hero = '';
  zoomed = false;
  /** Settings screen capturing a new binding: the next input goes to it instead of the game */
  capture: ((code: string) => void) | null = null;

  constructor(public canvas: HTMLCanvasElement) {
    addEventListener('keydown', e => {
      if (this.capture) { e.preventDefault(); e.stopPropagation(); const c = this.capture; this.capture = null; c(e.code); return; }
      if (e.code === 'Tab' || e.code === 'F8') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedOnce.add(e.code);
      this.keys.add(e.code);
    }, true);
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.l = this.mouse.r = false; });
    addEventListener('mousedown', e => {
      if (this.capture) { e.preventDefault(); e.stopPropagation(); const c = this.capture; this.capture = null; c(`Mouse${e.button}`); return; }
      if (!this.locked) return;
      const c = `Mouse${e.button}`;
      if (!this.keys.has(c)) this.pressedOnce.add(c);
      this.keys.add(c);
      if (e.button === 0) this.mouse.l = true;
      if (e.button === 2) this.mouse.r = true;
    }, true);
    addEventListener('mouseup', e => { this.keys.delete(`Mouse${e.button}`); if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
    addEventListener('wheel', e => {
      const c = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
      if (this.capture) { e.preventDefault(); const f = this.capture; this.capture = null; f(c); return; }
      if (this.locked) this.pressedOnce.add(c);
    }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => {
      if (!this.locked) return;
      const C = this.settings.controls;
      const k = this.sens * (C.heroSens[this.hero] ?? 1) * (this.zoomed ? C.zoomSens : 1);
      this.yaw -= e.movementX * k;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * k * (C.invertY ? -1 : 1)));
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.mouse.l = this.mouse.r = false; for (const k of [...this.keys]) if (k.startsWith('Mouse')) this.keys.delete(k); }
    });
  }
  lock() { if (!this.locked) this.canvas.requestPointerLock?.(); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  /** a raw code went down this frame (menus / fixed keys) */
  once(code: string) { const h = this.pressedOnce.has(code); this.pressedOnce.delete(code); return h; }
  endFrame() { this.pressedOnce.clear(); }

  private down(code: string) {
    if (code === 'Mouse0' && this.mouse.l) return true;
    if (code === 'Mouse2' && this.mouse.r) return true;
    return this.keys.has(code) || ((code === 'WheelUp' || code === 'WheelDown') && this.pressedOnce.has(code));
  }
  /** an action is held (any of its bindings) */
  held(a: Action) { return bindsFor(this.settings, this.hero, a).some(c => this.down(c)); }
  /** an action was pressed this frame */
  pressed(a: Action) {
    const b = bindsFor(this.settings, this.hero, a);
    const hit = b.some(c => this.pressedOnce.has(c));
    if (hit) for (const c of b) this.pressedOnce.delete(c);
    return hit;
  }

  /** write this frame's controls into the actor (aim pitch/yaw may be overridden by the camera's crosshair solve) */
  apply(a: Actor, aimYaw: number, aimPitch: number) {
    const i = a.input, H = (x: Action) => this.held(x);
    this.hero = a.def.id;
    i.mz = (H('forward') ? 1 : 0) - (H('back') ? 1 : 0);
    i.mx = (H('right') ? 1 : 0) - (H('left') ? 1 : 0);
    i.jump = H('jump'); i.jumpHeld = i.jump; i.descend = H('crouch');
    i.fire = H('fire'); i.alt = H('alt');
    i.a1 = H('a1'); i.a2 = H('a2'); i.ult = H('ult'); i.reload = H('reload'); i.melee = H('melee'); i.swoop = H('swoop');
    i.grind = H('grind');
    i.yaw = aimYaw; i.pitch = aimPitch;
  }
}
