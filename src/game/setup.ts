// Match construction shared by the game client, the AI test lab and headless tests.
import { HEROES } from '../data/heroes';
import { Nav } from '../ai/Nav';
import { Bot } from '../ai/Bot';
import { World, type Mode } from './World';
import type { Actor } from './Actor';
import { Director } from '../campaign/Director';
import { LEVEL, CAMPAIGN_HEROES } from '../campaign/data';

export interface Match { world: World; nav: Nav; player: Actor | null; bots: Bot[]; }

export function createMatch(mapId: string, mode: Mode, playerHero: string | null, skill = 0.7): Match {
  const world = new World(mapId, mode);
  const nav = new Nav(world.level);
  const bots: Bot[] = [];
  let player: Actor | null = null;
  if (mode === 'gallery') {
    // animation test bench: one hero runs a scripted routine through every movement / combat state
    const a = world.addHero(playerHero ?? 'raijin', 'zenith');
    a.pos = { x: -10, y: 0, z: 0 };
    a.controller = new DemoRoutine(world, a);
    world.point.unlockAt = 1e9;
    return { world, nav, player: null, bots };
  }
  if (mode === 'training') {
    player = world.addHero(playerHero ?? 'raijin', 'zenith');
    player.isPlayer = true;
    const robots: [string, number, number][] = [
      ['bot_dummy', 8, -4], ['bot_dummy', 8, 4], ['bot_dummy', 14, 0],
      ['bot_sentry', 30, -10], ['bot_sentry', 30, 10],
      ['bot_drone', 20, -16], ['bot_drone', 20, 16],
    ];
    for (const [id, x, z] of robots) {
      const r = world.addHero(id, 'umbra');
      r.spawn = [x, z]; world.respawn(r, true);
      const b = new Bot(world, r, nav, skill); r.controller = b; bots.push(b);
    }
    return { world, nav, player, bots };
  }
  for (const h of HEROES) {
    const a = world.addHero(h.id);
    if (h.id === playerHero && mode === 'skirmish') { a.isPlayer = true; player = a; continue; }
    const b = new Bot(world, a, nav, skill);
    a.controller = b; bots.push(b);
  }
  return { world, nav, player, bots };
}

/** Scripted routine for the gallery / animation test: idle, walk, run, strafe, backpedal, jump, fly, attack, cast, hit. */
export class DemoRoutine {
  t0: number;
  step = '';
  constructor(public w: World, public a: Actor) { this.t0 = w.time; }
  static STEPS: [string, number][] = [['idle', 2], ['run', 2.5], ['strafe', 2], ['back', 1.5], ['jump', 1.4], ['attack', 1.6], ['alt', 1.2], ['cast', 1.4], ['fly', 3], ['hit', 1], ['idle2', 1]];
  think() {
    const w = this.w, a = this.a, i = a.input;
    const total = DemoRoutine.STEPS.reduce((s, x) => s + x[1], 0);
    let k = (w.time - this.t0) % total, step = 'idle';
    for (const [n, d] of DemoRoutine.STEPS) { if (k < d) { step = n; break; } k -= d; }
    this.step = step;
    i.mx = i.mz = 0; i.fire = i.alt = i.jump = i.jumpHeld = false; i.a1 = i.a2 = i.ult = false;
    // walk a circle around the origin so the camera always has room
    const ang = Math.atan2(a.pos.z, a.pos.x);
    const tangent = ang + Math.PI / 2;
    i.yaw = step === 'strafe' ? ang + Math.PI : step === 'back' ? tangent + Math.PI : tangent;
    i.yaw = Math.atan2(Math.sin(i.yaw), Math.cos(i.yaw));
    const forward = { x: Math.cos(tangent), z: Math.sin(tangent) };
    i.yaw = step === 'strafe' ? Math.atan2(-a.pos.x, -a.pos.z) : step === 'back' ? Math.atan2(-forward.x, -forward.z) : Math.atan2(forward.x, forward.z);
    i.pitch = 0;
    if (step === 'run' || step === 'jump' || step === 'fly') i.mz = 1;
    if (step === 'strafe') i.mx = 1;
    if (step === 'back') i.mz = -1;
    if (step === 'jump') i.jump = Math.floor((w.time - this.t0) * 2) % 3 === 0;
    if (step === 'fly') { i.jump = true; i.jumpHeld = a.def.frame === 'flyer'; }
    if (step === 'attack') i.fire = true;
    if (step === 'alt') i.alt = true;
    if (step === 'cast') { a.anim.castAt = w.time - (w.time % 0.7); }
    if (step === 'hit' && Math.floor(w.time * 3) !== Math.floor((w.time - 1 / 60) * 3)) a.anim.hitAt = w.time;
    // keep them on the circle (radius ~10)
    const r = Math.hypot(a.pos.x, a.pos.z);
    if (r > 12 || r < 8) { const c = (10 - r) / 10; i.mx += 0; a.vel.x += a.pos.x / (r || 1) * c * 2; a.vel.z += a.pos.z / (r || 1) * c * 2; }
    a.hp = a.def.hp; a.ammo = 99;
  }
}

// ---------------------------------------------------------------- campaign

export interface CampaignMatch extends Match { director: Director; }
/** squad: the human players (local first). AI companions fill the squad up to three heroes. */
export function createCampaign(levelId: string, squad: { hero: string; netId: string }[], skill = 0.7): CampaignMatch {
  const lvl = LEVEL[levelId];
  const world = new World(lvl.map, 'campaign');
  const nav = new Nav(world.level);
  const bots: Bot[] = [];
  let player: Actor | null = null;
  const humans = squad.length;
  const director = new Director(world, lvl, nav, () => world.actors.filter(a => a.team === 'zenith' && (a.isPlayer || a.netId)).length || 1);
  world.director = director;
  for (const s of squad) {
    const a = world.addHero(s.hero, 'zenith');
    a.netId = s.netId;
    if (s.netId === 'local') { a.isPlayer = true; player = a; a.netId = ''; }
  }
  const used = new Set(squad.map(s => s.hero));
  for (const h of CAMPAIGN_HEROES) {
    if (world.actors.filter(a => a.team === 'zenith').length >= Math.max(3, humans)) break;
    if (used.has(h)) continue;
    const a = world.addHero(h, 'zenith');
    const b = new Bot(world, a, nav, skill); a.controller = b; bots.push(b);
  }
  return { world, nav, player, bots, director };
}
