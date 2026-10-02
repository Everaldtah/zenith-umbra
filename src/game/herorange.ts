// Training Grounds - the Hero Range (desktop edition). Overwatch's Practice Range has a Hero Bot by the spawn room that a
// console turns into any hero; it stands passive, but its passives still apply (armour, damage reduction, knockback).
// Here the console spawns any hero in one of two modes:
//  - DEFENSE: it holds its post facing you and never fires. With its abilities on it guards itself the way a player
//    would (a barrier up under fire, temporary health, a deflect or a parry, a dodge when low) - never anything that
//    damages or disables you. With them off it is Overwatch's passive Hero Bot. It resets to full health 3 s after
//    the last hit, so every burst starts from full and gives a clean time-to-kill.
//  - ATTACK: it fights back with the hero AI (weapon, abilities, ultimate), leashed to its lane, so you can measure
//    what you deal under fire and what that hero deals to you.
// The meter (client: RangeUI) reads the stats kept here from the world's damage and kill events.
import { HERO, isAbility } from '../data/heroes';
import { Bot } from '../ai/Bot';
import type { Nav } from '../ai/Nav';
import type { Actor } from './Actor';
import type { GameEvent, World } from './World';

export type RangeMode = 'attack' | 'defense';
export interface RangeOpts {
  hero: string;
  mode: RangeMode;
  /** the hero's abilities (and ultimate, in attack mode): off = weapon only / a passive dummy */
  abilities: boolean;
  /** defense: stand still or strafe side to side along the lane */
  move: 'hold' | 'strafe';
  /** metres from the firing line to the hero's post */
  dist: number;
  /** attack: the AI's aim and reaction (Bot skill) */
  skill: number;
}

/** the lane on the Proving Grounds: firing line at x = X0 (the console beside it), the post `dist` metres down +x */
export const LANE = { x0: -14, z: -21, dists: [5, 10, 15, 20, 25], console: { x: -16.5, z: -17.5 }, strafe: 3 };
export const LEASH = 14;            // attack: how far it may leave its post chasing you
export const RESPAWN_SECS = 2;      // the hero is back at its post this long after you drop it
export const RESET_SECS = 3;        // defense: back to full health this long after the last hit
export const BURST_GAP = 2.5;       // no damage for this long ends a burst (its DPS figure freezes)
export const SKILLS: [string, number][] = [['RECRUIT', 0.4], ['VETERAN', 0.62], ['ELITE', 0.8], ['LEGEND', 0.95]];
export const DEFAULT_OPTS: RangeOpts = { hero: 'gorgoth', mode: 'defense', abilities: false, move: 'hold', dist: 10, skill: 0.62 };

/**
 * DEFENSE with abilities on: what each hero uses to protect itself. 'hit' = the moment it is being hit, 'hurt' = under
 * fire below 60% health; hold = keep the input down while hits keep coming (Tenkai-Oh's sun-shield). Hex and Enra have
 * nothing purely defensive - Hex still has his passive Stitched Decoy.
 */
export interface Guard { slot: 'a1' | 'a2' | 'alt'; id: string; on: 'hit' | 'hurt'; hold?: boolean; dodge?: boolean }
export const GUARD: Record<string, Guard[]> = {
  tenkai: [{ slot: 'alt', id: 'bulwark', on: 'hit', hold: true }],
  gorgoth: [{ slot: 'alt', id: 'plating', on: 'hit' }],
  gantetsu: [{ slot: 'a2', id: 'taiko', on: 'hit' }],
  tomoe: [{ slot: 'a1', id: 'warcall', on: 'hit' }],
  mirei: [{ slot: 'a2', id: 'wish', on: 'hurt' }, { slot: 'a1', id: 'constellation', on: 'hurt' }],
  kaien: [{ slot: 'a1', id: 'spiritstep', on: 'hurt', dodge: true }],
  nocturne: [{ slot: 'a2', id: 'bloodpact', on: 'hurt' }],
  hibiki: [{ slot: 'a2', id: 'maxvolume', on: 'hurt' }],          // (Healing Groove is his starting track)
  raijin: [{ slot: 'a2', id: 'parry', on: 'hit' }],
  hayate: [{ slot: 'a2', id: 'mirrorwater', on: 'hit' }],
  yuzu: [{ slot: 'a1', id: 'sunhop', on: 'hurt' }],
  seiran: [{ slot: 'a1', id: 'riverstep', on: 'hurt', dodge: true }],
  kagemaru: [{ slot: 'a2', id: 'veil', on: 'hurt' }],
  hex: [], enra: [],
};

export type DmgClass = 'weapon' | 'ability' | 'dot';
const classOf = (kind?: string): DmgClass => kind === 'ability' ? 'ability' : kind === 'dot' ? 'dot' : 'weapon';
/** damage that arrives every tick (a beam, a bleed): it counts toward the totals and DPS but isn't a "hit" */
const continuous = (kind?: string) => kind === 'dot' || kind === 'beam';

/** a running tally of damage one way (you -> the hero, or the hero -> you) */
export class Tally {
  total = 0; hits = 0; crits = 0; last = 0; lastCrit = false; max = 0;
  by: Record<DmgClass, number> = { weapon: 0, ability: 0, dot: 0 };
  /** the current burst: first / last damage time, damage, distinct damage ticks; frozen once it ends */
  b0 = -1; b1 = -1; bDmg = 0; bTicks = 0;
  private lastT = -1; private lastKind = '';
  add(t: number, amt: number, crit: boolean, kind?: string) {
    this.total += amt;
    this.by[classOf(kind)] += amt;
    if (this.b0 < 0 || t - this.b1 > BURST_GAP) { this.b0 = t; this.bDmg = 0; this.bTicks = 0; }
    if (t !== this.b1) this.bTicks++;
    this.b1 = t; this.bDmg += amt;
    if (continuous(kind)) return;
    // a shotgun's pellets (and both of a twin gun's rounds) land on one tick: one hit
    if (t === this.lastT && kind === this.lastKind) { if (crit && !this.lastCrit) this.crits++; this.last += amt; this.lastCrit ||= crit; }
    else { this.hits++; this.last = amt; this.lastCrit = crit; if (crit) this.crits++; }
    this.max = Math.max(this.max, this.last);
    this.lastT = t; this.lastKind = kind ?? '';
  }
  /** sustained damage per second over the burst (the mean damage per tick over the mean gap between ticks) */
  dps(): number | null {
    if (this.bTicks < 2 || this.b1 <= this.b0) return null;
    return this.bDmg / ((this.b1 - this.b0) * this.bTicks / (this.bTicks - 1));
  }
  active(t: number) { return this.b0 >= 0 && t - this.b1 <= BURST_GAP; }
}

/** one dropped target, for the results table */
export interface RangeResult {
  you: string; target: string; mode: RangeMode; abilities: boolean; dist: number;
  ttk: number; dmg: number; hits: number; crits: number; dps: number | null;
  /** a mech's frame: when it went down (the pilot fights on) */
  frameDown?: number;
}

export class RangeStats {
  dealt = new Tally();
  taken = new Tally();
  kills = 0; deaths = 0;
  /** first damage of the target's current life (from full health): the time-to-kill clock */
  lifeStart = -1; lifeDmg = 0; lifeHits = 0; lifeCrits = 0; frameDown = -1;
  lastTtk: number | null = null; bestTtk: number | null = null;
  /** where you stood for the last hit, metres from the target */
  lastDist = 0;
  /** your shots / hits when the stats were last reset (accuracy = the difference) */
  shots0 = 0; hits0 = 0;
  log: RangeResult[] = [];
}

/**
 * Lives on a training match (setup.ts, desktop edition). Owns at most one range hero: `deploy` (re)spawns it with new
 * options, `clear` removes it. Watches the world's events through World.taps, so it sees every damage tick at its own
 * sim time (the client drains World.events once a frame).
 */
export class HeroRange {
  opts: RangeOpts = { ...DEFAULT_OPTS };
  bot: Actor | null = null;
  brain: RangeBrain | null = null;
  stats = new RangeStats();
  /** a spar is on (spar.ts): the range hero stands down at its post - nothing joins a one-on-one */
  suspended = false;
  /** bumped on every deploy / clear: a respawn timer from an older target does nothing */
  private gen = 0;

  constructor(public w: World, public nav: Nav) {
    w.taps.push(e => this.observe(e));
  }

  get player(): Actor | null { return this.w.actors.find(a => a.isPlayer) ?? null; }
  get post() { return { x: LANE.x0 + this.opts.dist, z: LANE.z }; }

  deploy(o: Partial<RangeOpts> = {}) {
    const next = { ...this.opts, ...o };
    if (!HERO[next.hero]) return null;
    const keep = this.bot && this.bot.alive && this.bot.baseDef.id === next.hero;
    this.opts = next;
    if (!keep) {
      this.clear(false);
      const a = this.w.addHero(next.hero, 'umbra');
      this.bot = a;
    }
    const a = this.bot!;
    a.spawn = [this.post.x, this.post.z];
    this.brain = new RangeBrain(this, a);
    a.controller = this.brain;
    this.place();
    this.resetStats();
    return a;
  }

  /** remove the range hero and everything it summoned or fired */
  clear(bump = true) {
    const a = this.bot;
    if (bump) this.gen++;
    if (!a) return;
    const w = this.w;
    w.actors = w.actors.filter(x => x !== a && x.owner !== a);
    w.zones = w.zones.filter(z => z.owner !== a);
    w.projs = w.projs.filter(p => p.owner !== a);
    a.controller = null; a.alive = false;
    this.bot = null; this.brain = null;
  }

  /** back to full at its post, facing the firing line */
  place() {
    const a = this.bot; if (!a) return;
    this.gen++;
    const w = this.w, p = this.post;
    w.respawn(a, true);
    const g = w.level.groundAt(p.x, p.z, 4);
    a.pos = { x: p.x, y: Math.max(0, g > -Infinity ? g : 0) + (a.def.frame === 'drone' ? 3 : 0), z: p.z };
    a.yaw = a.input.yaw = -Math.PI / 2; a.input.pitch = 0;
    a.cd = {};
    this.newLife();
  }

  resetStats() {
    const me = this.player, s = this.stats;
    this.stats = new RangeStats();
    this.stats.log = s.log;
    this.stats.shots0 = me?.shots ?? 0; this.stats.hits0 = me?.hits ?? 0;
  }

  private newLife() { const s = this.stats; s.lifeStart = -1; s.lifeDmg = 0; s.lifeHits = 0; s.lifeCrits = 0; s.frameDown = -1; }

  /** your side of a hit: you, or something you summoned / left behind */
  private mine(x: Actor | null) { const me = this.player; return !!me && !!x && (x === me || x.owner === me); }
  private theirs(x: Actor | null) { return !!this.bot && !!x && (x === this.bot || x.owner === this.bot); }

  observe(e: GameEvent) {
    const s = this.stats, t = this.w.time, a = this.bot;
    if (!a) return;
    if (e.t === 'dmg' && !e.heal) {
      if (e.tgt === a && this.mine(e.src)) {
        const hitsBefore = s.dealt.hits, critsBefore = s.dealt.crits;
        s.dealt.add(t, e.amt, e.crit, e.kind);
        if (s.lifeStart < 0) s.lifeStart = t;
        s.lifeDmg += e.amt; s.lifeHits += s.dealt.hits - hitsBefore; s.lifeCrits += s.dealt.crits - critsBefore;
        const me = this.player; if (me) s.lastDist = Math.hypot(me.pos.x - a.pos.x, me.pos.z - a.pos.z);
      } else if (this.mine(e.tgt) && e.tgt === this.player && this.theirs(e.src)) s.taken.add(t, e.amt, e.crit, e.kind);
    } else if (e.t === 'demech' && e.tgt === a && s.lifeStart >= 0) s.frameDown = t - s.lifeStart;
    else if (e.t === 'kill') {
      if (e.tgt === a) {
        s.kills++;
        const ttk = s.lifeStart >= 0 ? t - s.lifeStart : 0;
        s.lastTtk = ttk; s.bestTtk = s.bestTtk === null ? ttk : Math.min(s.bestTtk, ttk);
        const me = this.player;
        s.log.unshift({
          you: me?.def.name ?? '-', target: a.baseDef.name, mode: this.opts.mode, abilities: this.opts.abilities, dist: Math.round(s.lastDist),
          ttk, dmg: s.lifeDmg, hits: s.lifeHits, crits: s.lifeCrits, dps: ttk > 0 ? s.lifeDmg / ttk : null,
          frameDown: s.frameDown >= 0 ? s.frameDown : undefined,
        });
        s.log.length = Math.min(s.log.length, 8);
        // back at its post in RESPAWN_SECS (the world's own respawn would put it in the Umbra spawn after 6 s)
        a.respawnAt = 0;
        const gen = this.gen;
        this.w.after(RESPAWN_SECS, () => { if (this.gen === gen && this.bot === a) this.place(); });
      } else if (e.tgt === this.player && this.theirs(e.src)) s.deaths++;
    }
  }
}

const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));

/** the range hero's controller: the hero AI (attack) or the guard routine (defense) */
export class RangeBrain {
  bot: Bot;
  strafe = 1; strafeUntil = 0; guardAt = 0;
  constructor(public r: HeroRange, public a: Actor) {
    this.bot = new Bot(r.w, a, r.nav, r.opts.skill);
  }

  think(dt: number) {
    const r = this.r, o = r.opts, a = this.a, w = r.w, i = a.input, t = w.time, me = r.player;
    if (r.suspended) {
      i.fire = i.alt = i.melee = i.a1 = i.a2 = i.ult = i.jump = i.jumpHeld = i.reload = i.swoop = i.descend = false;
      const p = r.post; this.steer(p.x - a.pos.x, p.z - a.pos.z, Math.hypot(p.x - a.pos.x, p.z - a.pos.z) > 0.6 ? 1 : 0);
      return;
    }
    if (o.mode === 'attack') {
      this.bot.think(dt);
      const p = r.post, off = Math.hypot(a.pos.x - p.x, a.pos.z - p.z);
      // leashed: nobody to fight, or chased too far - walk back to the post
      if (!this.bot.target || off > LEASH) {
        if (off > LEASH) { i.fire = false; i.alt = false; }
        this.steer(p.x - a.pos.x, p.z - a.pos.z, off > 1.2 ? 1 : 0);
      }
      if (!o.abilities) {
        i.a1 = i.a2 = i.ult = false; i.swoop = false;
        if (isAbility(a.def.secondary)) { i.alt = false; this.bot.holdAlt = 0; }
      }
      return;
    }
    // ---- defense: never fires; faces you; holds or strafes; guards itself if allowed
    i.fire = i.alt = i.melee = i.a1 = i.a2 = i.ult = i.jump = i.jumpHeld = i.reload = i.swoop = i.descend = false;
    if (me?.alive) {
      const c = me.center, e = a.eye;
      i.yaw = Math.atan2(c.x - e.x, c.z - e.z); i.pitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z));
    }
    const p = r.post;
    let dx = p.x - a.pos.x, dz = p.z - a.pos.z;
    if (o.move === 'strafe') {
      if (t > this.strafeUntil) { this.strafe = -this.strafe; this.strafeUntil = t + 0.45 + Math.random() * 0.9; }
      const side = a.pos.z - p.z;
      if (Math.abs(side) > LANE.strafe) this.strafe = side > 0 ? -1 : 1;
      dz = this.strafe * 4; dx = (p.x - a.pos.x) * 2;
      this.steer(dx, dz, 1);
    } else this.steer(dx, dz, Math.hypot(dx, dz) > 0.6 ? 1 : 0);     // knocked off the spot: walk back
    // between bursts: back to full, the way the training robots get back up
    if (t - a.lastDamagedAt > RESET_SECS && (a.hp < a.def.hp || a.armor < a.maxArmor || a.wounds.length)) {
      a.hp = a.def.hp; a.armor = a.maxArmor; a.wounds = [];
      if (a.def !== a.baseDef) r.place();       // a mech pilot: the frame comes back
      else r.stats.lifeStart = -1;
      r.stats.lifeDmg = r.stats.lifeHits = r.stats.lifeCrits = 0; r.stats.frameDown = -1;
    }
    if (o.abilities) this.guard();
  }

  /** move toward a world-space direction (magnitude k) whatever way the hero faces */
  private steer(dx: number, dz: number, k: number) {
    const a = this.a, i = a.input, l = Math.hypot(dx, dz);
    if (!k || l < 1e-3) { i.mx = i.mz = 0; return; }
    const x = dx / l * k, z = dz / l * k, fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), rx = -Math.cos(a.yaw), rz = Math.sin(a.yaw);
    i.mz = x * fx + z * fz; i.mx = x * rx + z * rz;
  }

  private guard() {
    const a = this.a, i = a.input, w = this.r.w, t = w.time;
    const hitNow = t - a.lastDamagedAt < 0.35, underFire = t - a.lastDamagedAt < 1.2, hurt = a.health / a.maxHp < 0.6;
    for (const g of GUARD[a.baseDef.id] ?? []) {
      if (a.def !== a.baseDef) break;          // (a mech's pilot on foot has his own kit)
      if (g.hold) { if (underFire && a.barrier.hp > 40) i.alt = true; continue; }
      const want = g.on === 'hit' ? hitNow : hurt && underFire;
      if (!want || t < this.guardAt || !a.ready(g.id, t)) continue;
      if (g.dodge) {
        // step sideways out of the line of fire, not toward the shooter
        const me = this.r.player;
        const side = (a.pos.z - this.r.post.z) > 0 ? -1 : 1;
        if (me) i.yaw = wrap(Math.atan2(me.pos.x - a.pos.x, me.pos.z - a.pos.z) + side * Math.PI / 2);
        i.mz = 1; i.mx = 0;
      }
      i[g.slot] = true;
      this.guardAt = t + 0.3;           // released next tick: abilities fire on the press
      break;
    }
  }
}
