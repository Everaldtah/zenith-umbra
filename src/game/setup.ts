// Match construction shared by the game client, the AI test lab and headless tests.
import { rosterFor, HERO, type HeroDef, type TeamId } from '../data/heroes';
import { FULL } from '../edition';
import { Nav } from '../ai/Nav';
import { Bot } from '../ai/Bot';
import { World, type Mode } from './World';
import { Stadium } from './stadium';
import type { Actor } from './Actor';
import { Director } from '../campaign/Director';
import { LEVEL, CAMPAIGN_HEROES } from '../campaign/data';

export interface Match { world: World; nav: Nav; player: Actor | null; bots: Bot[]; }

export function createMatch(mapId: string, mode: Mode, playerHero: string | null, skill = 0.7): Match {
  const world = new World(mapId, mode);
  const nav = new Nav(world.level);
  world.nav = nav;
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
  // the AI lab / headless sims alternate the two-tank team's pick map by map (deterministic, both get exercised)
  const seed = [...mapId].reduce((s, c) => s + c.charCodeAt(0), 0) % 2;
  for (const h of lineup(playerHero, mode === 'aitest' ? () => seed * 0.99 : Math.random)) {
    const a = world.addHero(h.id);
    if (h.id === playerHero && ['skirmish', 'stadium', 'quickplay', 'competitive', 'practice'].includes(mode)) { a.isPlayer = true; player = a; continue; }
    const b = new Bot(world, a, nav, skill);
    a.controller = b; bots.push(b);
  }
  if (mode === 'stadium') world.stadium = new Stadium(world);
  return { world, nav, player, bots };
}

/** a seat in an online match: a hero, a side, and who plays it ('local' = this machine, a peer id, '' = AI) */
export interface OnlineSlot { hero: string; team: TeamId; netId: string; }
/**
 * Online match (the host's world): the humans' heroes, and AI for every seat still empty - each side is filled to five
 * (one tank, two damage, two support; roles the humans already cover are skipped, a side never fields the same hero
 * twice). Few people online = a mostly-AI match; every extra player replaces a bot.
 */
export function createOnlineMatch(mapId: string, mode: Mode, slots: OnlineSlot[], skill = 0.7, rnd: () => number = Math.random): Match {
  const world = new World(mapId, mode);
  const nav = new Nav(world.level);
  world.nav = nav;
  const bots: Bot[] = [];
  let player: Actor | null = null;
  const HEROES = rosterFor(FULL);
  const seats: { def: HeroDef; slot: OnlineSlot | null }[] = [];
  for (const team of ['zenith', 'umbra'] as const) {
    const humans = slots.filter(s => s.team === team && HERO[s.hero]?.team === team).slice(0, 5);
    const used = new Set(humans.map(s => s.hero));
    for (const s of humans) seats.push({ def: HERO[s.hero], slot: s });
    const need: Record<string, number> = { tank: 1, dps: 2, support: 2 };
    for (const s of humans) need[HERO[s.hero].role]--;
    let open = 5 - humans.length;
    for (const role of ['tank', 'support', 'dps'] as const) {
      const pool = HEROES.filter(h => h.team === team && h.role === role && !used.has(h.id));
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      for (const h of pool.slice(0, Math.max(0, Math.min(open, need[role])))) { seats.push({ def: h, slot: null }); used.add(h.id); open--; }
    }
    // a side whose humans doubled up on a role still gets five: any hero left
    for (const h of HEROES.filter(h => h.team === team && !used.has(h.id)).slice(0, open)) { seats.push({ def: h, slot: null }); used.add(h.id); }
  }
  // the roster order keeps spawn slots and the scoreboard stable
  seats.sort((a, b) => HEROES.indexOf(a.def) - HEROES.indexOf(b.def));
  for (const { def, slot } of seats) {
    const a = world.addHero(def.id);
    if (slot?.netId === 'local') { a.isPlayer = true; player = a; continue; }
    if (slot?.netId) { a.netId = slot.netId; continue; }
    const b = new Bot(world, a, nav, skill); a.controller = b; bots.push(b);
  }
  return { world, nav, player, bots };
}

/**
 * Role queue, the 5v5 way: each side fields one tank, two supports and two damage heroes. A team with more heroes in a
 * role than slots (the Umbra Syndicate has two tanks: Gorgoth and Gantetsu) sends a random one - always the player's pick.
 */
export function lineup(playerHero: string | null, rnd: () => number = Math.random, full = FULL): HeroDef[] {
  const SLOTS: Record<string, number> = { tank: 1, support: 2, dps: 2 };
  const out: HeroDef[] = [];
  const HEROES = rosterFor(full);
  for (const team of ['zenith', 'umbra'] as const) for (const role of Object.keys(SLOTS)) {
    const pool = HEROES.filter(h => h.team === team && h.role === role);
    const mine = pool.filter(h => h.id === playerHero), rest = pool.filter(h => h.id !== playerHero);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    out.push(...[...mine, ...rest].slice(0, SLOTS[role]));
  }
  // keep the roster order (spawn slots, scoreboard) stable
  return HEROES.filter(h => out.includes(h));
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
  world.nav = nav;
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
