// Training Grounds - the Spar Arena (desktop edition): one-on-one against any hero at Easy / Medium / Hard. The opponent
// waits in the arena; walking in seals a blue holographic box around the two of you, and it stays sealed until someone
// has won the spar (first to 1, 2 or 3 rounds). Every round starts from full health at opposite ends after a
// countdown and ends on a kill. Nothing crosses the walls while they are up - no one in or out, no shot in or out.
import { HERO } from '../data/heroes';
import { Bot } from '../ai/Bot';
import type { Nav } from '../ai/Nav';
import type { Actor } from './Actor';
import type { GameEvent, World } from './World';
import type { HeroRange } from './herorange';

export type SparDiff = 'easy' | 'medium' | 'hard';
/** the opponent's AI skill (Bot: aim error and reaction time) per difficulty */
export const SPAR_SKILL: Record<SparDiff, number> = { easy: 0.3, medium: 0.62, hard: 0.92 };
/** the box on the Proving Grounds: centre, half extents and height (clear floor between the spawn and the north wall) */
export const ARENA = { x: -29, z: 17, hx: 9, hz: 7, h: 9 };
/** where each side starts a round: the two ends of the box, facing each other */
export const SPAR_START = { you: { x: ARENA.x - 7, z: ARENA.z, yaw: Math.PI / 2 }, them: { x: ARENA.x + 7, z: ARENA.z, yaw: -Math.PI / 2 } };
export const SPAR_CONSOLE = { x: ARENA.x - 5, z: ARENA.z - ARENA.hz - 1.6 };
export const COUNTDOWN = 3;       // seconds frozen at the ends before FIGHT
export const ROUND_END = 3;       // seconds between a kill and the next countdown
export const DONE_SECS = 3;       // the result shows this long before the box opens
export interface SparOpts { hero: string; diff: SparDiff; firstTo: number }
export const DEFAULT_SPAR: SparOpts = { hero: 'kagemaru', diff: 'medium', firstTo: 2 };

export type SparPhase = 'off' | 'waiting' | 'countdown' | 'fight' | 'roundover' | 'done';
export interface SparRound { winner: 'you' | 'them' | 'draw'; secs: number; dealt: number; taken: number }
export interface SparResult { you: string; foe: string; diff: SparDiff; score: [number, number]; won: boolean }

export class Spar {
  opts: SparOpts = { ...DEFAULT_SPAR };
  phase: SparPhase = 'off';
  foe: Actor | null = null;
  brain: SparBrain | null = null;
  phaseAt = 0;
  round = 0;
  wins = { you: 0, them: 0 };
  /** this round: who won it (set at the first kill), and the damage each way */
  roundWinner: SparRound['winner'] | null = null;
  roundAt = 0; dealt = 0; taken = 0;
  rounds: SparRound[] = [];
  history: SparResult[] = [];
  /** the box just opened with you inside it: a new spar starts only once you have stepped out and back in */
  needExit = false;
  /** a fighter was put on their spot (the client turns your camera to face the opponent) */
  onPlace: ((a: Actor) => void) | null = null;

  constructor(public w: World, public nav: Nav, public range?: HeroRange) {
    w.tickers.push(dt => this.tick(dt));
    w.taps.push(e => this.observe(e));
    w.gate = (s, t) => this.allow(s, t);
  }

  get player(): Actor | null { return this.w.actors.find(a => a.isPlayer) ?? null; }
  get sealed() { return this.phase === 'countdown' || this.phase === 'fight' || this.phase === 'roundover' || this.phase === 'done'; }
  /** seconds left in the countdown / before the next round / before the box opens */
  get left() { const d = this.phase === 'countdown' ? COUNTDOWN : this.phase === 'roundover' ? ROUND_END : this.phase === 'done' ? DONE_SECS : 0; return Math.max(0, this.phaseAt + d - this.w.time); }

  inside(p: { x: number; z: number }, margin = 0) { return Math.abs(p.x - ARENA.x) <= ARENA.hx + margin && Math.abs(p.z - ARENA.z) <= ARENA.hz + margin; }
  /** a fighter's side: you or the opponent, or something one of you summoned */
  private duelist(a: Actor | null) { const me = this.player, f = this.foe; return !!a && (a === me || a === f || (!!a.owner && (a.owner === me || a.owner === f))); }

  /** put the opponent in the arena, waiting for you to walk in (re-arming while sealed is refused) */
  arm(o: Partial<SparOpts> = {}) {
    if (this.sealed) return null;
    const next = { ...this.opts, ...o };
    if (!HERO[next.hero]) return null;
    next.firstTo = Math.max(1, Math.min(5, Math.round(next.firstTo)));
    this.opts = next;
    if (!this.foe || this.foe.baseDef.id !== next.hero) {
      this.remove();
      this.foe = this.w.addHero(next.hero, 'umbra');
    }
    const a = this.foe;
    a.spawn = [SPAR_START.them.x, SPAR_START.them.z];
    this.brain = new SparBrain(this, a);
    a.controller = this.brain;
    this.reset(a, SPAR_START.them);
    this.phase = 'waiting'; this.phaseAt = this.w.time;
    const me = this.player;
    this.needExit = !!me && this.inside(me.pos);
    return a;
  }

  /** the opponent leaves (sealed: you forfeit the spar) */
  cancel() {
    if (this.sealed && this.phase !== 'done') { this.wins.them = Math.max(this.wins.them, this.opts.firstTo); this.finish(); }
    this.remove();
    this.phase = 'off';
  }

  private remove() {
    const f = this.foe; if (!f) return;
    this.w.actors = this.w.actors.filter(x => x !== f && x.owner !== f);
    this.w.zones = this.w.zones.filter(z => z.owner !== f);
    this.w.projs = this.w.projs.filter(p => p.owner !== f);
    f.controller = null; f.alive = false;
    this.foe = null; this.brain = null;
  }

  /** full health, cooldowns and ammo, nothing of theirs left in the world, standing on the spot */
  private reset(a: Actor, at: { x: number; z: number; yaw: number }) {
    const w = this.w, ult = a.ult;
    w.actors = w.actors.filter(x => !(x.isSummon && x.owner === a));
    w.zones = w.zones.filter(z => z.owner !== a);
    w.projs = w.projs.filter(p => p.owner !== a);
    w.respawn(a, true);
    a.ult = ult;
    const g = w.level.groundAt(at.x, at.z, 4);
    a.pos = { x: at.x, y: Math.max(0, g > -Infinity ? g : 0), z: at.z };
    a.vel = { x: 0, y: 0, z: 0 };
    a.yaw = a.input.yaw = at.yaw; a.input.pitch = 0;
    a.cd = {};
    this.onPlace?.(a);
  }

  private startRound() {
    const me = this.player, f = this.foe; if (!me || !f) return;
    this.round++;
    this.reset(me, SPAR_START.you); this.reset(f, SPAR_START.them);
    this.roundWinner = null; this.dealt = this.taken = 0;
    this.phase = 'countdown'; this.phaseAt = this.w.time;
    this.w.sfx('announce');          // (the scoreboard and the big centre text are the client's: RangeUI)
  }

  private finish() {
    const me = this.player, won = this.wins.you > this.wins.them;
    this.history.unshift({ you: me?.def.name ?? '-', foe: this.foe?.baseDef.name ?? '-', diff: this.opts.diff, score: [this.wins.you, this.wins.them], won });
    this.history.length = Math.min(this.history.length, 6);
    this.phase = 'done'; this.phaseAt = this.w.time;
    this.w.sfx('announce');
  }

  private tick(_dt: number) {
    const w = this.w, t = w.time, me = this.player, f = this.foe;
    if (this.range) this.range.suspended = this.sealed;
    if (this.phase === 'off' || !f) return;
    if (this.phase === 'waiting') {
      if (!me?.alive) return;
      if (!this.inside(me.pos)) { this.needExit = false; return; }
      if (this.needExit) return;
      // you walked in: the box seals
      this.round = 0; this.wins = { you: 0, them: 0 }; this.rounds = [];
      this.startRound();
      return;
    }
    if (this.phase === 'countdown') {
      // frozen at the ends (no damage either way: allow()); the cooldowns start fresh on FIGHT
      for (const [a, s] of [[me, SPAR_START.you], [f, SPAR_START.them]] as const) {
        if (!a?.alive) continue;
        a.pos.x = s.x; a.pos.z = s.z; a.vel.x = a.vel.z = 0; if (a.vel.y > 0) a.vel.y = 0;
      }
      if (t >= this.phaseAt + COUNTDOWN) {
        for (const a of [me, f]) if (a) { a.cd = {}; a.ammo = a.maxAmmo; a.reloadUntil = 0; }
        this.phase = 'fight'; this.phaseAt = t; this.roundAt = t;
      }
    } else if (this.phase === 'roundover') {
      if (t >= this.phaseAt + ROUND_END) {
        if (this.wins.you >= this.opts.firstTo || this.wins.them >= this.opts.firstTo) this.finish();
        else this.startRound();
      }
    } else if (this.phase === 'done') {
      if (t >= this.phaseAt + DONE_SECS) {
        // the box opens; the opponent is back on its feet at its end, waiting for a rematch
        this.reset(f, SPAR_START.them);
        this.phase = 'waiting'; this.phaseAt = t;
        this.needExit = !!me && this.inside(me.pos);
      }
    }
    if (this.sealed) this.walls();
  }

  /** the sealed box: the two of you (and what you summoned) can't leave it, nobody else can come in */
  private walls() {
    const r0 = (a: Actor) => a.radius + 0.05;
    for (const a of this.w.actors) {
      if (!a.alive) continue;
      const lo = { x: ARENA.x - ARENA.hx, z: ARENA.z - ARENA.hz }, hi = { x: ARENA.x + ARENA.hx, z: ARENA.z + ARENA.hz };
      if (this.duelist(a)) {
        const r = r0(a);
        if (a.pos.x < lo.x + r) { a.pos.x = lo.x + r; if (a.vel.x < 0) a.vel.x = 0; }
        if (a.pos.x > hi.x - r) { a.pos.x = hi.x - r; if (a.vel.x > 0) a.vel.x = 0; }
        if (a.pos.z < lo.z + r) { a.pos.z = lo.z + r; if (a.vel.z < 0) a.vel.z = 0; }
        if (a.pos.z > hi.z - r) { a.pos.z = hi.z - r; if (a.vel.z > 0) a.vel.z = 0; }
        const top = ARENA.h - a.height;
        if (a.pos.y > top) { a.pos.y = top; if (a.vel.y > 0) a.vel.y = 0; }
      } else if (this.inside(a.pos, a.radius)) {
        // pushed out through the nearest wall
        const r = r0(a), dx = a.pos.x - ARENA.x, dz = a.pos.z - ARENA.z;
        const ex = ARENA.hx + r - Math.abs(dx), ez = ARENA.hz + r - Math.abs(dz);
        if (ex < ez) a.pos.x = ARENA.x + Math.sign(dx || 1) * (ARENA.hx + r); else a.pos.z = ARENA.z + Math.sign(dz || 1) * (ARENA.hz + r);
      }
    }
  }

  /** while the box is up nothing crosses it, and the two of you only hurt each other between FIGHT and the kill */
  private allow(src: Actor | null, tgt: Actor): boolean {
    if (!this.sealed || !src) return true;
    const sIn = this.duelist(src) || this.inside(src.pos), tIn = this.duelist(tgt) || this.inside(tgt.pos);
    if (sIn !== tIn) return false;
    return !sIn || this.phase === 'fight';
  }

  observe(e: GameEvent) {
    const me = this.player, f = this.foe;
    if (!f || !me) return;
    if (e.t === 'dmg' && !e.heal && this.phase === 'fight') {
      const src = e.src ? (e.src.owner ?? e.src) : null;
      if (e.tgt === f && src === me) this.dealt += e.amt;
      else if (e.tgt === me && src === f) this.taken += e.amt;
    }
    if (e.t !== 'kill' || (e.tgt !== me && e.tgt !== f)) return;
    if (!this.sealed) return;
    // the spar brings the fallen back for the next round (not the world's respawn at the team spawn)
    e.tgt.respawnAt = 0;
    if (this.phase === 'fight') {
      const winner = e.tgt === f ? 'you' : 'them';
      this.wins[winner]++;
      this.roundWinner = winner;
      this.rounds.push({ winner, secs: this.w.time - this.roundAt, dealt: this.dealt, taken: this.taken });
      this.phase = 'roundover'; this.phaseAt = this.w.time;
    } else if (this.phase === 'roundover' && this.phaseAt === this.w.time && this.roundWinner && this.roundWinner !== 'draw') {
      // both fell on the same tick: nobody takes the round
      this.wins[this.roundWinner]--;
      this.roundWinner = 'draw';
      this.rounds[this.rounds.length - 1].winner = 'draw';
    }
  }
}

/** the opponent's controller: the hero AI while the round is on, still and facing you otherwise */
export class SparBrain {
  bot: Bot;
  constructor(public s: Spar, public a: Actor) { this.bot = new Bot(s.w, a, s.nav, SPAR_SKILL[s.opts.diff]); }
  think(dt: number) {
    const s = this.s, a = this.a, i = a.input, me = s.player;
    if (s.phase === 'fight') { this.bot.think(dt); return; }
    i.fire = i.alt = i.melee = i.a1 = i.a2 = i.ult = i.jump = i.jumpHeld = i.reload = i.swoop = i.descend = false;
    i.mx = i.mz = 0;
    if (me?.alive && (s.phase !== 'waiting' || s.inside(me.pos, 12))) {
      const c = me.center, e = a.eye;
      i.yaw = Math.atan2(c.x - e.x, c.z - e.z); i.pitch = 0;
    }
  }
}
