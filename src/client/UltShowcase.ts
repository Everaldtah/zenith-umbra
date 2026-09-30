// Ult Viewer (Hero Viewer > ULT VIEWER): a hero's ultimate played for real, outside a match. It runs a live World
// (the 'gallery' bench on the Proving Grounds) through the full game pipeline - abilities, effects, spirit dragons,
// voice lines, ragdolls - with a row of target dummies to hit (and wounded allied dummies for the support ults to
// heal), a routine that aims, charges and casts the ult, fights through the timed ones (Dragon Gate Blade, Judgment,
// Asura, the Dohyo, the Colossus) and resets for a replay, and a cinematic camera sized to the effect.
import type * as THREE from 'three';
import type { Game } from './Game';
import type { Match } from '../game/setup';
import type { World } from '../game/World';
import type { Actor } from '../game/Actor';
import { HERO, rosterFor } from '../data/heroes';
import { FULL } from '../edition';
import { BASE } from '../render/Assets';
import { sfx } from '../audio/Sfx';

/** how each ult is shown: `secs` from the cast to the replay; `near` walks within that of a target before casting (the
 *  Dohyo is stamped around you); `fight` closes to that range after the cast and keeps attacking (the timed ults);
 *  `flat` aims level (the ult travels along the ground); `wide` pulls the camera out and ahead (45 m koi-dragons);
 *  `tough` armours the enemy dummies to this many times their health, so a long ult has targets for its whole length;
 *  `track: 'row'` keeps the camera on the target row instead of following the hero (a 20 m flight through it) */
interface Plan { secs: number; near?: number; fight?: number; flat?: boolean; wide?: number; tough?: number; track?: 'row'; dead?: number }
const PLAN: Record<string, Plan> = {
  colossus: { secs: 10, fight: 4 },
  nova: { secs: 5 },
  rebirth: { secs: 6, dead: 1.5 },
  sanctuary: { secs: 6 },
  judgment: { secs: 7, fight: 2.2 },
  hundredsuns: { secs: 4.5 },
  singularity: { secs: 4.5, flat: true },
  requiem: { secs: 4.5 },
  theater: { secs: 17, wide: 1, tough: 2.5 },
  thousandcuts: { secs: 3.2 },
  asura: { secs: 8.5, fight: 5 },
  dohyo: { secs: 7, near: 3, fight: 2.5 },
  bassdrop: { secs: 5 },
  tide: { secs: 6, flat: true, wide: 0.45, track: 'row' },
  dragongate: { secs: 10, fight: 2.6 },
  twinkoi: { secs: 5, flat: true, wide: 1 },
};

// the stage on the Proving Grounds: a lane at z = LZ, clear of the training barriers (z = +-6), the hero at HX facing +x,
// dummies 8-15 m ahead (inside every ult's reach: the 15 m Theater / Thousand Cuts, the Singularity's 15 m throw);
// Twin Koi swims on through the low trim wall at x = 10. The camera sits on the -z side, so the barriers are backdrop.
const HX = -8, LZ = -10;
const FOES: [number, number][] = [[0, LZ], [3, LZ - 2.8], [3, LZ + 2.8], [6.5, LZ - 1.4], [6.5, LZ + 1.6]];
const FRIENDS: [number, number][] = [[-4.5, LZ + 2], [-5, LZ - 2.2]];      // in the middle ground, where the heal shows
const FACE = Math.PI / 2;               // yaw toward +x

export class UltShowcase {
  w: World;
  hero: Actor;
  foes: Actor[] = [];
  friends: Actor[] = [];
  plan: Plan;
  /** shown by the HUD's spectator label (Game reads controller.step on the gallery bench) */
  step = 'ult viewer';
  phase: 'ready' | 'approach' | 'cast' | 'show' = 'ready';
  at = 0;
  private castTries = 0;
  private felled = false;
  private ultsBefore = 0;
  private barW = -1;
  // camera state (orbit offset / zoom from the mouse, smoothed focus)
  private orbit = 0; private zoom = 1; private camInit = false; private lift = 0.36; private swing = 0;
  private focus = { x: 0, y: 0, z: 0 };
  private ui: HTMLElement | null = null;
  private off: (() => void)[] = [];

  constructor(public game: Game, m: Match, heroId: string) {
    const w = this.w = m.world;
    this.hero = w.actors[0];
    this.plan = PLAN[this.hero.def.ult.id] ?? { secs: 5 };
    this.hero.spawn = [HX, LZ];
    this.hero.controller = this;
    for (const [x, z] of FOES) { const d = w.addHero('bot_dummy', 'umbra'); d.spawn = [x, z]; this.foes.push(d); }
    // the healing / temporary-health / cannot-die ults need wounded allies to show anything
    if (HERO[heroId]?.role === 'support') for (const [x, z] of FRIENDS) { const d = w.addHero('bot_dummy', 'zenith'); d.spawn = [x, z]; this.friends.push(d); }
    this.reset();
  }

  private place(a: Actor, x: number, z: number, yaw: number) {
    a.pos = { x, y: Math.max(0, this.w.level.groundAt(x, z, 4)), z };
    a.vel = { x: 0, y: 0, z: 0 }; a.yaw = a.input.yaw = yaw; a.pitch = a.input.pitch = 0;
  }

  /** everyone back on their marks, the hero's ult full */
  reset() {
    const w = this.w, h = this.hero;
    w.respawn(h, true);                  // puts back swapped weapons (Dragon Gate Blade), the Colossus scale, statuses
    this.place(h, HX, LZ, FACE);
    h.cd = {}; h.ult = h.def.ult.charge;
    const put = (d: Actor, x: number, z: number, hp: number) => {
      if (!d.alive) w.respawn(d, true);
      d.st = {}; d.sv = {}; d.forced = null; d.wounds = []; d.shields = [];
      d.hp = d.def.hp * hp; d.lastDamagedAt = w.time;      // no out-of-combat regen before the ult has healed them
      // (armour, not health: the bars over their heads stay full-scale)
      d.maxArmor = d.armor = d.team === h.team ? 0 : d.def.hp * Math.max(0, (this.plan.tough ?? 1) - 1);
      this.place(d, x, z, d.team === h.team ? FACE : -FACE);
    };
    this.foes.forEach((d, i) => put(d, FOES[i][0], FOES[i][1], 1));
    this.friends.forEach((d, i) => put(d, FRIENDS[i][0], FRIENDS[i][1], 0.35));
    this.phase = 'ready'; this.at = w.time; this.castTries = 0; this.felled = false;
  }

  /** the nearest standing target (or the middle of the row) */
  private target(): { x: number; y: number; z: number } {
    const h = this.hero;
    let best: Actor | null = null, bd = Infinity;
    for (const d of this.foes) if (d.alive) { const k = Math.hypot(d.pos.x - h.pos.x, d.pos.z - h.pos.z); if (k < bd) { bd = k; best = d; } }
    return best ? best.center : { x: 3, y: 1, z: LZ };
  }

  private aimAt(p: { x: number; y: number; z: number }, flat: boolean) {
    const h = this.hero, e = h.eye, dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz);
    h.input.yaw = Math.atan2(dx, dz);
    // aimed ults (Hundred Suns lands where you look): the middle of the row on the ground
    h.input.pitch = flat ? 0 : Math.atan2(p.y - e.y, Math.max(1, dist));
    return dist;
  }

  // controller: called by World.step for the hero
  think() {
    const w = this.w, h = this.hero, i = h.input, P = this.plan, t = w.time - this.at;
    i.mx = i.mz = 0; i.fire = i.alt = i.jump = i.jumpHeld = i.melee = i.reload = false; i.a1 = i.a2 = i.ult = false;
    h.hp = Math.max(h.hp, h.def.hp * 0.6);
    if (h.maxAmmo) h.ammo = h.maxAmmo;
    const tgt = this.target();
    const mid = { x: 3.5, y: 0, z: LZ };
    const dist = this.aimAt(P.flat || this.phase === 'ready' ? { ...tgt, y: h.eye.y } : this.phase === 'cast' && !P.fight ? mid : tgt, !!P.flat);
    if (this.phase === 'ready') {
      // (a resurrection needs someone to call back: the friends fall `dead` seconds before the cast)
      if (P.dead && t > 1.1 && !this.felled) { this.felled = true; for (const d of this.friends) w.kill(d, null); }
      if (t > 1.1 + (P.dead ?? 0)) { this.phase = P.near ? 'approach' : 'cast'; this.at = w.time; this.ultsBefore = h.ults; }
    } else if (this.phase === 'approach') {
      if (dist > (P.near ?? 0) && t < 3.5) i.mz = 1;
      else { this.phase = 'cast'; this.at = w.time; this.ultsBefore = h.ults; }
    } else if (this.phase === 'cast') {
      // a fresh press each try (World.pressed is edge-triggered); some ults refuse without a target in reach
      i.ult = Math.floor(t * 8) % 2 === 0;
      if (h.ults > this.ultsBefore) { this.phase = 'show'; this.at = w.time; }
      else if (t > 2.5) { this.castTries++; this.at = w.time; if (this.castTries > 2) this.reset(); }
    } else {
      // the timed ults: close in and keep swinging / firing until the replay
      if (P.fight) { if (dist > P.fight) i.mz = 1; i.fire = dist < P.fight + 3; }
      if (t > P.secs) this.reset();
    }
    const left = this.phase === 'show' ? Math.max(0, P.secs - t) : 0;
    this.step = this.phase === 'show' ? `${h.baseDef.ult.name} · replay in ${left.toFixed(0)}s` : h.baseDef.ult.name;
    this.updateUi(left);
  }

  // ------------------------------------------------------------------ camera
  /** a slow three-quarter orbit behind the hero's shoulder, framing the hero and the target row (wider for the koi) */
  camera(cam: THREE.PerspectiveCamera, dt: number) {
    const h = this.hero, H = h.height, P = this.plan;
    const ahead = 5 + 9 * (P.wide ?? 0);
    const want = P.track === 'row' ? { x: 3.5, y: 1.2, z: LZ } : { x: h.pos.x + ahead * 0.9, y: h.pos.y + H * 0.45 + 0.4, z: LZ + (h.pos.z - LZ) * 0.6 };
    const k = this.camInit ? 1 - Math.exp(-dt * 3) : 1;
    this.focus.x += (want.x - this.focus.x) * k; this.focus.y += (want.y - this.focus.y) * k; this.focus.z += (want.z - this.focus.z) * k;
    const r = Math.max(9, H * 3.2) * (1 + 1.1 * (P.wide ?? 0)) * this.zoom;
    const base = -2.2 + Math.sin(this.w.time * 0.18) * 0.28 + this.orbit, F = this.focus, L = this.w.level;
    // keep a clear shot: nothing between the lens and the action, and no prop right in front of the lens (the Proving
    // Grounds' barriers) - swing around a little first, then rise over it
    let pick: [number, number] = [0, 1.1];
    for (const [sw, e] of [[0, 0.36], [0.4, 0.36], [-0.4, 0.36], [0, 0.55], [0.4, 0.55], [-0.4, 0.55], [0, 0.8], [0.7, 0.8]] as [number, number][]) {
      const a = base + sw, sx = Math.sin(a) * r, sz = Math.cos(a) * r, dy = r * e + H * 0.2, len = Math.hypot(sx, dy, sz);
      const cx = F.x + sx, cy = F.y + dy, cz = F.z + sz;
      const near = L.solids.some(o => o.y1 > cy - 2.5 && Math.hypot(o.x - cx, o.z - cz) < o.r + 3.5);
      if (!near && !L.ray(F, { x: sx / len, y: dy / len, z: sz / len }, len)) { pick = [sw, e]; break; }
    }
    const ke = this.camInit ? 1 - Math.exp(-dt * 1.8) : 1;
    this.swing += (pick[0] - this.swing) * ke; this.lift += (pick[1] - this.lift) * ke;
    const ang = base + this.swing;
    const px = F.x + Math.sin(ang) * r, pz = F.z + Math.cos(ang) * r, py = F.y + r * this.lift + H * 0.2;
    if (!this.camInit) { cam.position.set(px, py, pz); this.camInit = true; }
    else { const kc = 1 - Math.exp(-dt * 4); cam.position.x += (px - cam.position.x) * kc; cam.position.y += (py - cam.position.y) * kc; cam.position.z += (pz - cam.position.z) * kc; }
    cam.lookAt(this.focus.x, this.focus.y, this.focus.z);
  }

  // ------------------------------------------------------------------ overlay
  mountUi(host: HTMLElement, nav: { back(): void; pick(id: string): void }) {
    const h = this.hero.baseDef, u = h.ult;
    injectCss();
    const el = this.ui = document.createElement('div');
    el.className = 'ultsc';
    el.innerHTML = `<div class="ucol">
      <div class="ucard" style="--c:${h.color}">
        <img src="${BASE}img/portrait_${h.id}.webp" onerror="this.src='${BASE}img/key_${h.id}.webp';this.onerror=null">
        <div><small>ULT VIEWER · ${h.name.toUpperCase()}</small><b>${u.name}</b><p>${u.desc}</p><div class="ubar"><i></i></div></div>
      </div>
      <div class="ubtns">
        <button data-k="replay">⟲ REPLAY <kbd>R</kbd></button>
        <button data-k="slow">SLOW-MO <kbd>T</kbd></button>
        <button data-k="back">BACK TO HERO VIEWER <kbd>Esc</kbd></button>
      </div></div>
      <div class="upick">${rosterFor(FULL).map(x => `<button data-h="${x.id}" class="${x.id === h.id ? 'sel' : ''}" style="--c:${x.color}" title="${x.name}: ${x.ult.name}"><img src="${BASE}img/portrait_${x.id}.webp" onerror="this.src='${BASE}img/key_${x.id}.webp';this.onerror=null"></button>`).join('')}</div>
      <div class="uhint">Drag to orbit · wheel to zoom · [ ] sim speed</div>`;
    host.append(el);
    const act = (k: string) => {
      sfx.play('ui_click');
      if (k === 'replay') this.reset();
      else if (k === 'slow') this.game.timeScale = this.game.timeScale < 1 ? 1 : 0.35;
      else if (k === 'back') nav.back();
    };
    el.querySelectorAll<HTMLElement>('[data-k]').forEach(b => b.onclick = () => act(b.dataset.k!));
    el.querySelectorAll<HTMLElement>('[data-h]').forEach(b => b.onclick = () => { if (b.dataset.h !== h.id) { sfx.play('ui_click'); nav.pick(b.dataset.h!); } });
    const key = (e: KeyboardEvent) => { if (e.code === 'KeyR') act('replay'); else if (e.code === 'KeyT') act('slow'); };
    // orbit / zoom on the game canvas (the gallery bench never takes the pointer lock)
    const cv = this.game.renderer.domElement;
    let drag: number | null = null;
    const down = (e: PointerEvent) => { drag = e.clientX; };
    const move = (e: PointerEvent) => { if (drag === null) return; this.orbit -= (e.clientX - drag) * 0.006; drag = e.clientX; };
    const up = () => { drag = null; };
    const wheel = (e: WheelEvent) => { this.zoom = Math.max(0.45, Math.min(2.2, this.zoom * (e.deltaY > 0 ? 1.1 : 0.9))); };
    addEventListener('keydown', key); cv.addEventListener('pointerdown', down); addEventListener('pointermove', move); addEventListener('pointerup', up); cv.addEventListener('wheel', wheel, { passive: true });
    this.off.push(() => { removeEventListener('keydown', key); cv.removeEventListener('pointerdown', down); removeEventListener('pointermove', move); removeEventListener('pointerup', up); cv.removeEventListener('wheel', wheel); });
  }

  private updateUi(left: number) {
    if (!this.ui) return;
    // (called every sim step: touch the DOM only when the bar moves a whole percent)
    const pct = Math.round(this.phase === 'show' ? (left / this.plan.secs) * 100 : 100);
    if (pct === this.barW) return;
    this.barW = pct;
    (this.ui.querySelector('.ubar i') as HTMLElement).style.width = `${pct}%`;
    this.ui.querySelector('[data-k="slow"]')?.classList.toggle('on', this.game.timeScale < 1);
  }

  dispose() {
    for (const f of this.off) f();
    this.off = [];
    this.ui?.remove(); this.ui = null;
  }
}

let cssDone = false;
function injectCss() {
  if (cssDone) return; cssDone = true;
  const s = document.createElement('style');
  s.textContent = `
.ultsc { position: fixed; inset: 0; z-index: 12; pointer-events: none; font-family: inherit; }
.ultsc button { pointer-events: auto; }
.ultsc .ucol { position: absolute; left: 24px; top: 70px; width: 430px; display: flex; flex-direction: column; gap: 10px; }
.ultsc .ucard { display: flex; gap: 14px; padding: 14px 16px; background: rgba(6,8,16,.72); border-left: 4px solid var(--c); backdrop-filter: blur(4px); }
.ultsc .ucard img { width: 78px; height: 78px; object-fit: cover; border: 1px solid rgba(255,255,255,.2); }
.ultsc .ucard small { display: block; letter-spacing: .12em; opacity: .7; font-size: 12px; }
.ultsc .ucard b { display: block; font: 800 22px Orbitron, sans-serif; color: var(--c); margin: 2px 0 4px; }
.ultsc .ucard p { margin: 0; font-size: 14px; line-height: 1.35; color: #d5dcf5; }
.ultsc .ubar { margin-top: 8px; height: 4px; background: rgba(255,255,255,.12); }
.ultsc .ubar i { display: block; height: 100%; width: 100%; background: var(--c); transition: width .1s linear; }
.ultsc .ubtns { display: flex; gap: 8px; flex-wrap: wrap; }
body:has(.ultsc) .hud .obj { display: none; }
.ultsc .ubtns button { background: rgba(6,8,16,.78); color: #fff; border: 1px solid rgba(255,255,255,.25); padding: 8px 12px; font-weight: 700; letter-spacing: .06em; cursor: pointer; }
.ultsc .ubtns button:hover, .ultsc .ubtns button.on { border-color: #ffd76a; color: #ffd76a; }
.ultsc kbd { margin-left: 8px; padding: 1px 6px; border: 1px solid currentColor; font-size: 11px; opacity: .8; }
.ultsc .upick { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); display: flex; gap: 6px; padding: 6px; background: rgba(6,8,16,.6); }
.ultsc .upick button { width: 48px; height: 48px; padding: 0; border: 2px solid transparent; background: #111; cursor: pointer; }
.ultsc .upick button img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ultsc .upick button:hover { border-color: rgba(255,255,255,.5); }
.ultsc .upick button.sel { border-color: var(--c); box-shadow: 0 0 10px var(--c); }
.ultsc .uhint { position: absolute; left: 50%; bottom: 80px; transform: translateX(-50%); font-size: 12px; opacity: .55; letter-spacing: .08em; }`;
  document.head.append(s);
}

/**
 * Open the Ult Viewer for a hero: a gallery-bench match on the Proving Grounds with the showcase as the hero's
 * controller and camera. Esc / BACK returns through nav.back(); a portrait in the strip switches hero via nav.pick().
 */
export async function startUltShowcase(game: Game, heroId: string, nav: { back(): void; pick(id: string): void }) {
  const prevExit = game.onExit;
  let show: UltShowcase | null = null;
  const done = () => { game.onExit = prevExit; game.showcaseCam = null; game.timeScale = 1; show?.dispose(); show = null; };
  const leave = (then: () => void) => { done(); then(); };
  game.onExit = () => leave(() => { game.stop(); nav.back(); });
  await game.start({ mode: 'gallery', map: 'training', hero: heroId, setup: m => { show = new UltShowcase(game, m, heroId); } });
  const s = show as UltShowcase | null;
  if (!s) return;
  game.showcaseCam = (cam, dt) => s.camera(cam, dt);
  s.mountUi(game.host, { back: () => game.onExit?.(), pick: id => leave(() => nav.pick(id)) });
}
