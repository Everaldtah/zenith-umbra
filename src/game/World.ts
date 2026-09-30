// Deterministic fixed-step simulation: movement, combat, projectiles, zones, capture point.
// Rendering, audio and HUD only read state and drain `events`.
import { HERO, PILOTS, PILOT_BY_ID, type HeroDef, type TeamId, isAbility } from '../data/heroes';
import { mapFor, type MapDef } from '../data/maps';
import { Level, STEP, type V3 } from '../engine/Physics';
import { Actor } from './Actor';
import { ROBOTS } from '../data/robots';
import { castAbility, stompLeap, tickAbilities, TIDE_HOLD, TIDE_MARK_AMP } from './abilities';
import { PUPPET_DEF, dropPuppets, tickPuppets } from './puppets';
import { updateWeapons } from './weapons';
import { Stadium } from './stadium';
import { FULL } from '../edition';

/** Tenkai-Oh's ult: 3.3m x 2.2 = 7.3m, four times an average hero's height */
export const TITAN_SCALE = 2.2;

export const G = 24;
/** Hibiki's Groove: the top of his jump-rhythm speed multiplier (tapping jump ~8.5x a second holds it) */
export const GROOVE_MAX = 20;
/** the tap rates (taps a second) the Groove spans: none below GROOVE_TAPS[0], the full GROOVE_MAX at GROOVE_TAPS[1] */
export const GROOVE_TAPS: [number, number] = [1.5, 8.5];
/** Hayate's Sun-Alloy Frame: the same tap-rate speed as Hibiki's Groove, up to this multiplier on his run and his climb */
export const KOI_GROOVE_MAX = 5;
/** Hayate's Mirror Water (Genji's Deflect): the window, and the least of it before E again ends it (the cooldown is in heroes.ts) */
export const DEFLECT_SECS = 2, DEFLECT_MIN = 0.27;
/** the Koryu brothers' wall climb: seconds of climbing per touch of the ground (jump taps add a little back) */
export const CLIMB_SECS = 2.2;
/** Grand Dohyo: height of the rope wall above the ring floor (m) */
export const RING_H = 8;
export type Mode = 'training' | 'skirmish' | 'stadium' | 'spectate' | 'aitest' | 'campaign' | 'gallery' | 'quickplay' | 'competitive' | 'practice';
/** how a match is won: the legacy single-round point (web build, AI lab), Overwatch-style Control (best of 3 rounds) or
 *  Mikoshi Rush (escort the festival float into the enemy's end) */
export type Rules = 'legacy' | 'control' | 'push';
export const ROUNDS_TO_WIN = 2;
/** Control: % per second while holding the point; capture speed per player on it (up to three count) */
export const HOLD_RATE = 1.3;
/** Mikoshi Rush: the float's speed (m/s) with one pusher, +10% per extra pusher (up to three), and the time limit */
export const FLOAT_SPEED = 1.2;
export const PUSH_TIME = 300;
/** health packs */
export const PACK = { small: { hp: 75, respawn: 10 }, big: { hp: 250, respawn: 15 } };

export type GameEvent =
  | { t: 'sfx'; id: string; pos?: V3; vol?: number; actor?: Actor }
  | { t: 'fx'; kind: string; pos: V3; to?: V3; r?: number; color?: string; dur?: number; side?: number; actor?: Actor; target?: Actor; mat?: string; n?: V3 }
  | { t: 'dmg'; src: Actor | null; tgt: Actor; amt: number; crit: boolean; heal?: boolean; pos: V3 }
  | { t: 'kill'; src: Actor | null; tgt: Actor }
  | { t: 'demech'; src: Actor | null; tgt: Actor }
  | { t: 'cast'; actor: Actor; id: string; name: string }
  | { t: 'counter'; actor: Actor; target: Actor; text: string }
  | { t: 'msg'; text: string; color?: string };

export interface Proj {
  id: number; owner: Actor; team: TeamId; pos: V3; vel: V3; dmg: number; splash: number; heal: boolean;
  fx: string; life: number; r: number; grav: number; special?: string; crit: number; hits: Set<number>; pierce?: boolean; homing?: number; born: number;
  /** drawn as this prop (WeaponDef.mesh), spinning at `spin` rad/s about its flat axis (Fx.syncProjectiles) */
  mesh?: string; spin?: number;
}
export interface Zone {
  id: number; kind: string; owner: Actor; team: TeamId; x: number; y: number; z: number; r: number; born: number; until: number; next: number; data?: any;
}

let PID = 1;

export class World {
  time = 0;
  level: Level;
  map: MapDef;
  actors: Actor[] = [];
  projs: Proj[] = [];
  zones: Zone[] = [];
  events: GameEvent[] = [];
  timers: { at: number; fn: () => void }[] = [];
  prevIn = new Map<number, { a1: boolean; a2: boolean; ult: boolean; alt: boolean; jump: boolean; fire: boolean; melee: boolean; swoop: boolean; descend: boolean }>();
  attackers = new Map<number, Map<number, number>>();
  // capture point
  point = { owner: null as TeamId | null, capture: 0, capTeam: null as TeamId | null, progress: { zenith: 0, umbra: 0 }, contested: false, unlockAt: 8, r: 6 };
  winner: TeamId | null = null;
  timeLimit = 360;
  rules: Rules = 'legacy';
  /** desktop edition features (Mirei's swoop, the new modes); the web build runs the lite game */
  full = true;
  /** Control: rounds (first to ROUNDS_TO_WIN), the transition between them, overtime */
  control = { round: 1, wins: { zenith: 0, umbra: 0 } as Record<TeamId, number>, phase: 'fight' as 'fight' | 'intermission', phaseEnd: 0, overtime: false };
  /** Mikoshi Rush: the float's signed distance from the centre along the path (+ toward the Umbra end), each team's
   *  furthest push, who is moving it */
  push = { d: 0, best: { zenith: 0, umbra: 0 } as Record<TeamId, number>, owner: null as TeamId | null, contested: false, unlockAt: 15, half: 0, pos: { x: 0, y: 0, z: 0 } as V3, checkpoint: 0, overtime: false };
  private pathPts: V3[] = []; private pathCum: number[] = [];
  /** health packs: position, size, and when each is back */
  packs: { x: number; y: number; z: number; big: boolean; readyAt: number }[] = [];
  /** campaign hooks: enemy/boss definitions and the encounter director */
  extraDefs: Record<string, HeroDef> = { puppet: PUPPET_DEF };
  /** the match's path finder, when it has one (summoned armies route around walls with it) */
  nav: { find(from: V3, to: V3, maxIter?: number): V3[] | null } | null = null;
  /** per-tick scratch values */
  sv: Record<string, number> = { puppetPaths: 0 };
  director: { update(dt: number): void; onKill?(a: Actor, src: Actor | null): void } | null = null;
  /** Stadium mode: rounds, the Armory, cash (null in every other mode) */
  stadium: Stadium | null = null;
  stats = { counters: 0, casts: {} as Record<string, number>, sfx: {} as Record<string, number>, fx: {} as Record<string, number> };

  constructor(mapId: string | MapDef, public mode: Mode, opts: { full?: boolean; rules?: Rules } = {}) {
    this.full = opts.full ?? FULL;
    this.map = typeof mapId === 'string' ? mapFor(mapId, this.full) : mapId;
    this.level = new Level(this.map);
    this.rules = opts.rules ?? (this.full && (mode === 'quickplay' || mode === 'competitive' || mode === 'practice' || mode === 'spectate') ? (this.map.objective ?? 'control') : 'legacy');
    for (const p of this.map.packs ?? []) {
      const y = p.y ?? Math.max(0, this.level.groundAt(p.x, p.z, 0.3));
      this.packs.push({ x: p.x, y, z: p.z, big: !!p.big, readyAt: 0 });
    }
    if (this.rules === 'control') { this.point.unlockAt = 12; this.timeLimit = 1500; }
    if (this.rules === 'push') {
      const path = this.map.path ?? [[-this.map.size[0] + 6, 0], [this.map.size[0] - 6, 0]];
      let cum = 0;
      path.forEach(([x, z], i) => {
        const p = { x, y: Math.max(0, this.level.groundAt(x, z, 20)), z };
        if (i) cum += Math.hypot(x - this.pathPts[i - 1].x, z - this.pathPts[i - 1].z);
        this.pathPts.push(p); this.pathCum.push(cum);
      });
      this.push.half = cum / 2;
      this.push.pos = this.pathAt(0);
      this.timeLimit = PUSH_TIME;
    }
  }

  /** a point on the push path, `d` metres from its centre (+ toward the Umbra end) */
  pathAt(d: number): V3 {
    const s = Math.max(0, Math.min(this.push.half * 2, this.push.half + d));
    const C = this.pathCum, P = this.pathPts;
    let i = 1; while (i < C.length - 1 && C[i] < s) i++;
    const k = (s - C[i - 1]) / Math.max(1e-6, C[i] - C[i - 1]);
    const x = P[i - 1].x + (P[i].x - P[i - 1].x) * k, z = P[i - 1].z + (P[i].z - P[i - 1].z) * k;
    return { x, y: Math.max(0, this.level.groundAt(x, z, 20)), z };
  }

  // ------------------------------------------------------------------ setup
  addHero(heroId: string, team?: TeamId): Actor {
    const def: HeroDef = HERO[heroId] ?? PILOT_BY_ID[heroId] ?? ROBOTS[heroId] ?? this.extraDefs[heroId];
    const a = new Actor(def, team ?? def.team);
    a.isRobot = !!ROBOTS[heroId] || !!def.summoned;
    a.spawn = this.map.spawns[a.team];
    this.actors.push(a);
    this.respawn(a, true);
    return a;
  }

  respawn(a: Actor, first = false) {
    if (!first && !a.isSummon && a.sv.puppetsCast !== undefined) dropPuppets(this, a);
    const [sx, sz] = a.spawn;
    const i = this.actors.filter(o => o.team === a.team).indexOf(a);
    const ang = i * 1.3;
    a.pos = { x: sx + Math.cos(ang) * 2.5 * (first ? 1 : Math.random() + 0.5), y: 0, z: sz + Math.sin(ang) * 3 };
    // the floor at spawn level (spawn rooms have roofs: sampling from high up would put the team on top of them)
    const g0 = this.level.groundAt(a.pos.x, a.pos.z, 1);
    a.pos.y = Math.max(0, g0 > -Infinity ? g0 : this.level.groundAt(a.pos.x, a.pos.z, 30));
    if (a.def.frame === 'drone') a.pos.y += 3;
    a.vel = { x: 0, y: 0, z: 0 };
    a.yaw = a.team === 'zenith' ? Math.PI / 2 : -Math.PI / 2;
    if (a.isRobot) a.yaw = -Math.PI / 2;
    a.pitch = 0;
    a.def = a.baseDef;
    a.hp = a.def.hp; a.maxArmor = a.def.armor + a.mods.armor; a.armor = a.maxArmor; a.scale = 1;
    a.shields = []; a.wounds = []; a.st = {}; a.sv = {}; a.src = {}; a.forced = null;
    a.alive = true; a.respawnAt = 0; a.flight = 100; a.flying = false;
    a.ammo = a.maxAmmo; a.reloadUntil = 0;
    if (a.def.dualGuns && !isAbility(a.def.secondary)) a.sv.ammo2 = Math.max(1, Math.round((a.def.secondary.ammo ?? 0) * (1 + a.mods.ammo)));
    if (a.barrier.max) a.barrier = { hp: a.barrier.max, max: a.barrier.max, up: false, regenAt: 0, brokenUntil: 0 };
    a.set('spawnprot', this.time, first ? 0 : 2);
    this.emit({ t: 'fx', kind: 'spawn', pos: { ...a.pos }, color: a.def.glow, actor: a });
  }

  // ------------------------------------------------------------------ helpers
  emit(e: GameEvent) {
    this.events.push(e);
    if (e.t === 'sfx') this.stats.sfx[e.id] = (this.stats.sfx[e.id] ?? 0) + 1;
    else if (e.t === 'fx') this.stats.fx[e.kind] = (this.stats.fx[e.kind] ?? 0) + 1;
    else if (e.t === 'counter') this.stats.counters++;
  }
  sfx(id: string, pos?: V3, actor?: Actor) { this.emit({ t: 'sfx', id, pos: pos ? { ...pos } : undefined, actor }); }
  fx(kind: string, pos: V3, extra: Partial<Extract<GameEvent, { t: 'fx' }>> = {}) { this.emit({ t: 'fx', kind, pos: { ...pos }, ...extra }); }
  after(delay: number, fn: () => void) { this.timers.push({ at: this.time + delay, fn }); }

  enemies(a: Actor) { return this.actors.filter(o => o.alive && o.team !== a.team); }
  allies(a: Actor, self = true) { return this.actors.filter(o => o.alive && o.team === a.team && (self || o !== a)); }
  within(p: V3, r: number, filter: (o: Actor) => boolean) {
    return this.actors.filter(o => o.alive && filter(o) && dist3(o.center, p) < r + o.radius);
  }
  visible(a: Actor, b: Actor) { return this.level.lineOfSight(a.eye, b.center); }
  /** can `viewer` see `b`? (stealth) */
  perceivable(viewer: Actor, b: Actor) {
    if (b.team === viewer.team) return true;
    if (!b.has('stealth', this.time)) return true;
    if (b.has('revealed', this.time)) return true;
    return dist3(viewer.pos, b.pos) < 2.5;
  }

  muzzle(a: Actor, slot?: string): V3 {
    if (a.def.dualGuns) {
      // twin chainguns held at the hips: LMB = the left gun, RMB = the right; barrels along the aim
      const side = slot === 'secondary' ? 1 : -1, rx = -Math.cos(a.yaw), rz = Math.sin(a.yaw), d = a.aimDir(), k = a.scale;
      return { x: a.pos.x + rx * side * 0.52 * k + d.x * 1.15 * k, y: a.pos.y + a.height * 0.48 + d.y * 1.15 * k, z: a.pos.z + rz * side * 0.52 * k + d.z * 1.15 * k };
    }
    const r = a.def.frame === 'mech' ? 1.1 : 0.32, d = a.def.frame === 'mech' ? 0.7 : 0.25;
    const e = a.eye, rx = -Math.cos(a.yaw), rz = Math.sin(a.yaw), f = a.forward();
    return { x: e.x + rx * r * a.scale + f.x * 0.4, y: e.y - d * a.scale, z: e.z + rz * r * a.scale + f.z * 0.4 };
  }

  /** where the crosshair ray lands (level or enemy), from the eye */
  aimPoint(a: Actor, max = 150): V3 {
    const o = a.eye, d = a.aimDir();
    const lh = this.level.ray(o, d, max);
    let t = lh ? lh.t : max;
    const ah = this.rayActors(o, d, t, x => x.team !== a.team && x !== a);
    if (ah) t = ah.t;
    return { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
  }

  /** ray vs actor capsules + head spheres */
  rayActors(o: V3, d: V3, max: number, filter: (x: Actor) => boolean): { actor: Actor; t: number; head: boolean } | null {
    let best: { actor: Actor; t: number; head: boolean } | null = null;
    for (const x of this.actors) {
      if (!x.alive || !filter(x) || x.has('phased', this.time)) continue;
      const hr = headR(x), hc = headC(x);
      const th = raySphere(o, d, hc, hr);
      if (th !== null && th <= max && (!best || th < best.t)) { best = { actor: x, t: th, head: true }; continue; }
      const r = x.radius * 0.9;
      const a0 = { x: x.pos.x, y: x.pos.y + r, z: x.pos.z }, a1 = { x: x.pos.x, y: x.pos.y + x.height - hr * 1.6, z: x.pos.z };
      const end = { x: o.x + d.x * max, y: o.y + d.y * max, z: o.z + d.z * max };
      const s = segSeg(o, end, a0, a1);
      if (s.d2 <= r * r) {
        const t = Math.max(0, s.s * max - Math.sqrt(Math.max(0, r * r - s.d2)));
        if (!best || t < best.t) best = { actor: x, t, head: false };
      }
    }
    return best;
  }

  /** nearest target near the crosshair within an aim cone (for lock-on abilities / heal beams) */
  coneTarget(a: Actor, range: number, deg: number, filter: (x: Actor) => boolean): Actor | null {
    const e = a.eye, d = a.aimDir(), cos = Math.cos(deg * Math.PI / 180);
    let best: Actor | null = null, bs = -1;
    for (const x of this.actors) {
      if (!x.alive || x === a || !filter(x)) continue;
      const c = x.center, v = { x: c.x - e.x, y: c.y - e.y, z: c.z - e.z }, l = Math.hypot(v.x, v.y, v.z);
      if (l > range + x.radius) continue;
      const dot = (v.x * d.x + v.y * d.y + v.z * d.z) / (l || 1);
      if (dot < cos && l > x.radius * 1.5) continue;
      if (!this.level.lineOfSight(e, c)) continue;
      const score = dot - l / range * 0.05;
      if (score > bs) { bs = score; best = x; }
    }
    return best;
  }

  groundPoint(a: Actor, range: number): V3 {
    const p = this.aimPoint(a, range);
    const g = this.level.groundAt(p.x, p.z, p.y + 0.5);
    return { x: p.x, y: g === -Infinity ? a.pos.y : g, z: p.z };
  }

  // ------------------------------------------------------------------ combat
  damage(src: Actor | null, tgt: Actor, amount: number, o: { crit?: boolean; kind?: string; shieldMult?: number; ability?: string; noLifesteal?: boolean; wound?: boolean } = {}): number {
    const t = this.time;
    if (!tgt.alive || amount <= 0) return 0;
    if (src && src.team === tgt.team && src !== tgt) return 0;
    if (tgt.has('phased', t) || tgt.has('spawnprot', t) || tgt.has('reborn', t)) return 0;
    if (tgt.has('parry', t) && o.kind === 'melee' && src) {
      src.set('stun', t, 1);
      this.sfx('parry', tgt.center); this.fx('parry', tgt.center, { color: '#8ad8ff', actor: tgt });
      if (src.def.id === 'enra') this.emit({ t: 'counter', actor: tgt, target: src, text: 'Thunder Parry stuns Enra' });
      return 0;
    }
    // Mirror Water (Genji's Deflect): a blow or a shot from in front of him is turned on the blade - melee stops dead,
    // hitscan fire goes back out along his aim at whoever is there
    if (src && tgt.has('deflect', t) && (o.kind === 'melee' || o.kind === 'hitscan') && this.deflected(tgt, src.pos, tgt.center)) {
      if (o.kind === 'hitscan') {
        const e = tgt.eye, d = this.aimDir(tgt);
        const lh = this.level.ray(e, d, 60), max = lh ? lh.t : 60;
        const ah = this.rayActors(e, d, max, x => x.team !== tgt.team && x !== tgt);
        const end = ah ? ah.t : max, endP = { x: e.x + d.x * end, y: e.y + d.y * end, z: e.z + d.z * end };
        this.fx('tracer', e, { to: endP, color: tgt.def.glow, actor: tgt });
        if (ah) this.damage(tgt, ah.actor, amount, { crit: o.crit, kind: 'hitscan' });
      }
      return 0;
    }
    let dmg = amount;
    // Stadium: weapon / ability power
    if (src) dmg *= 1 + (o.kind === 'ability' || o.kind === 'dot' ? src.mods.ability : src.mods.weapon);
    if (src?.has('dmgamp', t)) dmg *= 1.3;
    if (src?.has('titan', t)) dmg *= 1.25;
    if (tgt.has('vuln', t)) dmg *= 1.3;
    else if (tgt.has('tidemark', t)) dmg *= TIDE_MARK_AMP;      // Tomoe's mark: hurt more by anyone (it doesn't stack on the Puppeteer's)
    if (tgt.has('taiko', t)) { tgt.mitigated += dmg * 0.4; dmg *= 0.6; }
    if (src?.has('ambush', t) && o.kind !== 'dot') { dmg += 50; src.clear('ambush'); }
    // Hex: Stitched Decoy eats one huge hit
    if (tgt.def.id === 'hex' && dmg > 90 && tgt.ready('decoy', t)) {
      tgt.cd.decoy = t + 15;
      this.fx('decoy', tgt.center, { color: '#c77dff', actor: tgt }); this.sfx('decoy', tgt.center);
      if (src?.def.id === 'yuzu') this.emit({ t: 'counter', actor: tgt, target: src, text: 'Stitched Decoy eats the Dawnshot' });
      return 0;
    }
    let dealt = 0;
    // shields first
    const sm = o.shieldMult ?? 1;
    for (const s of tgt.shields) {
      if (dmg <= 0) break;
      const take = Math.min(s.amt, dmg * sm);
      s.amt -= take; dmg -= take / sm; dealt += take;
      (s.src ?? tgt).mitigated += take;
      if (s.amt <= 0 && sm > 1 && s.kind === 'wish' && src?.def.id === 'gorgoth') this.emit({ t: 'counter', actor: src, target: tgt, text: 'Null Lance shatters Wish Barrier' });
    }
    tgt.shields = tgt.shields.filter(s => s.amt > 0.5);
    if (dmg > 0 && tgt.armor > 0) {
      // wounds bleed straight through armor (Tomoe's counter to Gantetsu's plating)
      const eff = o.wound ? dmg : Math.max(dmg * 0.7, Math.min(dmg, dmg - 5));
      const take = Math.min(tgt.armor, eff);
      tgt.armor -= take; dealt += take; dmg -= take / (eff / dmg);
    }
    if (dmg > 0) {
      const floor = tgt.has('undying', t) ? 1 : 0;
      const take = Math.min(dmg, Math.max(0, tgt.hp - floor));
      tgt.hp -= take; dealt += take;
      if (floor && tgt.hp <= 1.01 && take < dmg) this.fx('undying', tgt.center, { color: '#ffe28a', actor: tgt });
    }
    if (dealt <= 0) return 0;
    tgt.lastDamagedAt = t;
    tgt.anim.hitAt = t;
    if (src && src !== tgt) {
      tgt.lastHitBy = src; tgt.lastHitAt = t; tgt.sv.lastHitDmg = dealt;
      let m = this.attackers.get(tgt.id); if (!m) this.attackers.set(tgt.id, m = new Map());
      m.set(src.id, t);
      // shooting a summoned puppet, or a puppet's own claws, never feeds an ultimate or the damage column
      if (!tgt.isSummon) src.dmgDone += dealt;
      if (!tgt.isSummon && o.ability !== 'puppet') src.ult = Math.min(src.def.ult.charge, src.ult + dealt * (1 + src.mods.ultgain));
      if (src.def.id === 'yuzu') tgt.set('marked', t, 3);
      if (src.def.id === 'gorgoth') src.armor = Math.min(src.maxArmor, src.armor + dealt * 0.05);
      // Gantetsu - Roar of the Crowd: critical hits turn half their damage into temporary health (max 150)
      if (src.def.id === 'gantetsu' && o.crit) {
        const s = src.shields.find(x => x.kind === 'roar');
        const before = s ? s.amt : 0;
        if (s) { s.amt = Math.min(150, s.amt + dealt * 0.5); s.until = t + 60; } else src.shields.push({ amt: Math.min(150, dealt * 0.5), until: t + 60, kind: 'roar' });
        src.stats.roar = (src.stats.roar ?? 0) + Math.min(150, before + dealt * 0.5) - before;
        src.sv.roarAt = t;
      }
      if (!o.noLifesteal) {
        let ls = (src.has('lifesteal', t) ? (src.sv.lifesteal ?? 0.3) : 0) + src.mods.lifesteal;
        if (src.has('asura', t)) ls += 0.3;
        if (ls > 0) this.heal(src, src, dealt * ls, true);
        if (src.def.id === 'nocturne') {
          const hurt = this.allies(src).filter(x => x.health < x.maxHp && dist3(x.pos, src.pos) < 20).sort((p, q) => p.health / p.maxHp - q.health / q.maxHp)[0];
          if (hurt) this.heal(src, hurt, dealt * 0.5, true);
        }
      }
    }
    this.emit({ t: 'dmg', src, tgt, amt: dealt, crit: !!o.crit, pos: tgt.center });
    if (tgt.health <= 0.01 && tgt.hp <= 0.01) this.kill(tgt, src);
    return dealt;
  }

  /** open wounds bleed; Tomoe drinks from her own (Blood Tide: heals 150% of the wound damage she deals) */
  private bleedWounds(a: Actor, dt: number) {
    const t = this.time;
    a.wounds = a.wounds.filter(w => w.until > t);
    for (const w of [...a.wounds]) {
      const dealt = this.damage(w.src, a, w.dps * dt, { kind: 'dot', noLifesteal: true, wound: true });
      if (dealt > 0 && w.src.alive && w.src.def.id === 'tomoe') {
        const h = this.heal(w.src, w.src, dealt * 1.5, true);
        w.src.stats.bloodtide = (w.src.stats.bloodtide ?? 0) + h;
      }
      if (!a.alive) break;
    }
  }

  heal(src: Actor, tgt: Actor, amount: number, quiet = false): number {
    if (!tgt.alive || amount <= 0 || tgt.team !== src.team) return 0;
    let amt = amount * (1 + src.mods.healing);
    if (tgt.has('antiheal', this.time)) amt *= 0.2;
    const room = tgt.def.hp - tgt.hp;
    let h = Math.min(room, amt);
    tgt.hp += Math.max(0, h);
    // Stadium: healing past full health restores bought armor
    if (this.stadium && amt > h && tgt.armor < tgt.maxArmor) { const ar = Math.min(tgt.maxArmor - tgt.armor, amt - Math.max(0, h)); tgt.armor += ar; h = Math.max(0, h) + ar; }
    if (h <= 0) return 0;
    if (src !== tgt) {
      src.healDone += h; src.ult = Math.min(src.def.ult.charge, src.ult + h * (1 + src.mods.ultgain));
      if (src.def.id === 'kaien' && src.hp < src.def.hp) src.hp = Math.min(src.def.hp, src.hp + h * 0.25);
    }
    if (src !== tgt) { tgt.sv.healedBy = src.id; tgt.sv.healedAt = this.time; }
    if (!quiet || h > 20) this.emit({ t: 'dmg', src, tgt, amt: h, crit: false, heal: true, pos: tgt.center });
    return h;
  }

  shield(tgt: Actor, amt: number, dur: number, kind: string, src?: Actor) {
    tgt.shields = tgt.shields.filter(s => s.kind !== kind);
    tgt.shields.push({ amt, until: this.time + dur, kind, src });
  }

  /** a destroyed frame: explode it, pop the pilot out on foot (keeps the mech's ult for later) */
  demech(a: Actor, src: Actor | null) {
    const t = this.time, p = PILOTS[a.def.id], f = a.forward();
    const killer = src && src !== a ? src : (a.lastHitBy && t - a.lastHitAt < 6 ? a.lastHitBy : null);
    this.fx('burst', a.center, { r: 4, color: a.def.glow }); this.fx('eject', { x: a.pos.x, y: a.pos.y + a.height * 0.62, z: a.pos.z }, { color: a.def.glow, actor: a });
    this.sfx('mechdown', a.center); this.sfx('eject', a.center);
    this.emit({ t: 'msg', text: `${a.def.name.toUpperCase()} DOWN - ${p.name.toUpperCase()} FIGHTS ON`, color: a.def.color });
    this.emit({ t: 'demech', src: killer, tgt: a });
    a.sv.mechUlt = a.ult;
    a.clear('titan'); a.scale = 1;
    a.def = p;
    a.hp = p.hp; a.maxArmor = 0; a.armor = 0; a.shields = [];
    a.barrier.up = false; a.forced = null; a.flying = false; a.charging = false;
    a.ult = 0; a.ammo = p.primary.ammo ?? 0; a.reloadUntil = 0; a.nextShot = t + 0.4;
    a.vel = { x: -f.x * 4, y: 9, z: -f.z * 4 }; a.grounded = false;
    a.set('spawnprot', t, 0.8);
  }

  kill(tgt: Actor, src: Actor | null) {
    if (!tgt.alive) return;
    if (tgt.isSummon) {
      // a puppet falls: no kill feed, no kill or assist, no respawn
      tgt.alive = false; tgt.deathAt = this.time; tgt.respawnAt = 0; tgt.forced = null; tgt.wounds = []; tgt.sv.fellAt = this.time;
      this.attackers.delete(tgt.id);
      this.fx('puppetfall', tgt.center, { color: tgt.def.glow, actor: tgt });
      return;
    }
    if (tgt.def === tgt.baseDef && PILOTS[tgt.def.id]) { this.demech(tgt, src); return; }
    tgt.alive = false; tgt.deathAt = this.time; tgt.deaths++;
    tgt.respawnAt = tgt.noRespawn ? 0 : this.time + (tgt.isRobot ? 3 : this.mode === 'aitest' ? 4 : this.mode === 'campaign' ? 8 : 6);
    tgt.forced = null; tgt.flying = false; tgt.barrier.up = false; tgt.beamOn = false; tgt.flameOn = false; tgt.wounds = [];
    const killer = src && src !== tgt ? src : (tgt.lastHitBy && this.time - tgt.lastHitAt < 6 ? tgt.lastHitBy : null);
    if (killer) {
      killer.kills++; killer.streak++; killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
      if (killer.has('judgment', this.time)) killer.cd.flashstep = 0;
      if (killer.def.id === 'hayate') killer.cd.currentdash = 0;     // Current Dash resets on an elimination
      // the healer keeping the killer alive gets the assist (Overwatch's healing assists)
      const healer = this.time - (killer.sv.healedAt ?? -99) < 4 ? this.actors.find(x => x.id === killer.sv.healedBy) : undefined;
      if (healer && healer !== killer) healer.stats.healAssists = (healer.stats.healAssists ?? 0) + 1;
    }
    tgt.streak = 0;
    const m = this.attackers.get(tgt.id);
    if (m) for (const [id, at] of m) if (this.time - at < 6 && id !== killer?.id) { const as = this.actors.find(x => x.id === id); if (as) as.assists++; }
    this.attackers.delete(tgt.id);
    this.zones = this.zones.filter(z => !(z.owner === tgt && z.kind === 'tether'));
    this.emit({ t: 'kill', src: killer, tgt });
    this.director?.onKill?.(tgt, killer);
    this.sfx(tgt.def.frame === 'mech' ? 'mechdown' : tgt.isRobot ? 'botdown' : 'down', tgt.center);
    this.fx('death', tgt.center, { color: tgt.def.glow, actor: tgt });
    if (tgt.def.pilot) {
      // the pilot punches out of the cockpit before the frame collapses
      this.fx('eject', { x: tgt.pos.x, y: tgt.pos.y + tgt.height * 0.62, z: tgt.pos.z }, { color: tgt.def.glow, actor: tgt });
      this.sfx('eject', tgt.center);
      this.emit({ t: 'msg', text: `${tgt.def.pilot.name.toUpperCase()} EJECTS!`, color: tgt.def.color });
    }
  }

  // ------------------------------------------------------------------ projectiles
  spawnProj(owner: Actor, from: V3, dir: V3, speed: number, o: Partial<Proj>) {
    const p: Proj = {
      id: PID++, owner, team: owner.team, pos: { ...from }, vel: { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed },
      dmg: 0, splash: 0, heal: false, fx: 'sun', life: 2, r: 0.12, grav: 0, crit: 1.5, hits: new Set(), born: this.time, ...o,
    };
    this.projs.push(p);
    return p;
  }

  private stepProj(p: Proj, dt: number): boolean {
    p.life -= dt;
    if (p.life <= 0) { if (p.special) this.projEnd(p, p.pos, null); return false; }
    if (p.homing) {
      const cand = this.actors.filter(x => x.alive && (p.heal ? x.team === p.team && x !== p.owner && x.health < x.maxHp : x.team !== p.team));
      const sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
      let best: Actor | null = null, bd = 0.97;
      for (const x of cand) {
        const c = x.center, v = { x: c.x - p.pos.x, y: c.y - p.pos.y, z: c.z - p.pos.z }, l = Math.hypot(v.x, v.y, v.z);
        const dot = (v.x * p.vel.x + v.y * p.vel.y + v.z * p.vel.z) / (l * sp);
        if (dot > bd && l < 30) { bd = dot; best = x; }
      }
      if (best) {
        const c = best.center, v = norm({ x: c.x - p.pos.x, y: c.y - p.pos.y, z: c.z - p.pos.z });
        const k = Math.min(1, p.homing * dt);
        const nv = norm({ x: p.vel.x / sp * (1 - k) + v.x * k, y: p.vel.y / sp * (1 - k) + v.y * k, z: p.vel.z / sp * (1 - k) + v.z * k });
        p.vel = { x: nv.x * sp, y: nv.y * sp, z: nv.z * sp };
      }
    }
    p.vel.y -= p.grav * dt;
    const a = p.pos, b = { x: a.x + p.vel.x * dt, y: a.y + p.vel.y * dt, z: a.z + p.vel.z * dt };
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len, z: (b.z - a.z) / len };
    // barriers (Solar Bulwark) block enemy projectiles
    const bh = this.barrierHit(p.team, a, dir, len);
    const lh = this.level.ray(a, dir, len);
    let tEnd = Math.min(len, lh ? lh.t : len, bh ? bh.t : len);
    // actors
    for (const x of this.actors) {
      if (!x.alive || x === p.owner || p.hits.has(x.id) || x.has('phased', this.time)) continue;
      const friendly = x.team === p.team;
      if (p.heal ? !friendly : friendly) continue;
      const hr = headR(x), hc = headC(x);
      const th = raySphere(a, dir, hc, hr + p.r);
      let hitT: number | null = th !== null && th <= tEnd ? th : null, head = hitT !== null;
      if (hitT === null) {
        const r = x.radius * 0.9 + p.r;
        const s = segSeg(a, { x: a.x + dir.x * tEnd, y: a.y + dir.y * tEnd, z: a.z + dir.z * tEnd }, { x: x.pos.x, y: x.pos.y + 0.2, z: x.pos.z }, { x: x.pos.x, y: x.pos.y + x.height - hr, z: x.pos.z });
        if (s.d2 <= r * r) hitT = s.s * tEnd;
      }
      if (hitT === null) continue;
      // Mirror Water (Genji's Deflect): a shot from in front of him leaves again along his aim, now his
      if (!friendly && x.has('deflect', this.time) && !p.heal && this.deflected(x, p.pos, { x: a.x + dir.x * hitT, y: a.y + dir.y * hitT, z: a.z + dir.z * hitT })) {
        const sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z), d = this.aimDir(x), e = x.eye;
        p.owner = x; p.team = x.team; p.vel = { x: d.x * sp, y: d.y * sp, z: d.z * sp }; p.hits.clear(); p.life = Math.max(p.life, 1);
        p.pos = { x: e.x + d.x * 0.5, y: e.y - 0.1 + d.y * 0.5, z: e.z + d.z * 0.5 };
        return true;
      }
      // Thunder Parry: reflect
      if (!friendly && x.has('parry', this.time) && !p.heal) {
        p.owner = x; p.team = x.team; p.vel = { x: -p.vel.x, y: -p.vel.y, z: -p.vel.z }; p.hits.clear(); p.life = Math.max(p.life, 1);
        this.sfx('parry', x.center); this.fx('parry', x.center, { color: '#8ad8ff', actor: x });
        if (p.special === 'chain') this.emit({ t: 'counter', actor: x, target: p.owner, text: 'Thunder Parry reflects the Chain of Oblivion' });
        return true;
      }
      const hitPos = { x: a.x + dir.x * hitT, y: a.y + dir.y * hitT, z: a.z + dir.z * hitT };
      if (p.heal) { this.heal(p.owner, x, p.dmg); this.fx('healhit', hitPos, { color: p.owner.def.glow }); this.sfx('healhit', hitPos); }
      else if (p.special) { this.projEnd(p, hitPos, x); return false; }
      else {
        p.owner.hits++; if (head) p.owner.crits++;
        this.damage(p.owner, x, p.dmg * (head ? p.crit : 1), { crit: head, kind: 'proj' });
        this.fx('hit', hitPos, { color: p.owner.def.glow });
        this.sfx(head ? 'crit' : 'hit', hitPos);
      }
      if (p.splash) this.splash(p, hitPos, x);
      p.hits.add(x.id);
      if (!p.pierce) return false;
    }
    if (tEnd < len) {
      const hp = { x: a.x + dir.x * tEnd, y: a.y + dir.y * tEnd, z: a.z + dir.z * tEnd };
      if (bh && bh.t <= tEnd + 1e-6) this.hitBarrier(bh.owner, p.dmg, p.owner, hp);
      else this.fx('impact', hp, { color: p.owner.def.glow });
      if (p.special) this.projEnd(p, hp, null);
      else if (p.splash) this.splash(p, hp, null);
      return false;
    }
    p.pos = b;
    return true;
  }

  private splash(p: Proj, at: V3, direct: Actor | null) {
    for (const x of this.enemies(p.owner)) {
      if (x === direct) continue;
      const d = dist3(x.center, at);
      if (d < p.splash + x.radius) this.damage(p.owner, x, p.dmg * 0.5 * (1 - d / (p.splash + x.radius) * 0.5), { kind: 'splash' });
    }
    this.fx('burst', at, { r: p.splash, color: p.owner.def.glow });
    this.sfx('boom', at);
  }

  private projEnd(p: Proj, at: V3, hit: Actor | null) {
    castAbility.onProj(this, p, at, hit);
  }

  barrierHit(team: TeamId, o: V3, d: V3, max: number): { t: number; owner: Actor } | null {
    let best: { t: number; owner: Actor } | null = null;
    // Grand Dohyo: a sacred rope wall around the ring - enemy fire can't cross it in either direction
    for (const z of this.zones) {
      if (z.kind !== 'dohyo' || z.team === team) continue;
      const ox = o.x - z.x, oz = o.z - z.z, A = d.x * d.x + d.z * d.z;
      if (A < 1e-8) continue;
      const B = 2 * (ox * d.x + oz * d.z), C = ox * ox + oz * oz - z.r * z.r, disc = B * B - 4 * A * C;
      if (disc < 0) continue;
      const s = Math.sqrt(disc);
      for (const tt of [(-B - s) / (2 * A), (-B + s) / (2 * A)]) {
        if (tt < 0 || tt > max || (best && tt > best.t)) continue;
        const y = o.y + d.y * tt;
        if (y < z.y - 1 || y > z.y + RING_H) continue;
        best = { t: tt, owner: z.owner }; break;
      }
    }
    for (const a of this.actors) {
      if (!a.alive || !a.barrier.up || a.team === team) continue;
      const f = a.forward(), k = a.scale, c = { x: a.pos.x + f.x * 1.7 * k, y: a.pos.y, z: a.pos.z + f.z * 1.7 * k };
      const den = d.x * f.x + d.z * f.z;
      if (den >= -1e-4) continue;                 // only blocks shots coming at its face
      const t = ((c.x - o.x) * f.x + (c.z - o.z) * f.z) / den;
      if (t < 0 || t > max || (best && t > best.t)) continue;
      const hx = o.x + d.x * t - c.x, hz = o.z + d.z * t - c.z, hy = o.y + d.y * t - c.y;
      const lateral = Math.abs(hx * -f.z + hz * f.x);
      if (lateral > 2.4 * k || hy < -0.2 || hy > 3.8 * k) continue;
      best = { t, owner: a };
    }
    return best;
  }

  hitBarrier(owner: Actor, dmg: number, src: Actor, at: V3) {
    // no shield of its own: the shot struck a Grand Dohyo wall (it has no health, it just lasts its 6 seconds)
    if (!owner.barrier.max) { this.fx('ringhit', at, { color: '#ffe6a8' }); owner.mitigated += dmg; return; }
    owner.barrier.hp -= dmg; owner.mitigated += Math.max(0, dmg + Math.min(0, owner.barrier.hp));
    owner.barrier.regenAt = this.time + 2;
    this.fx('barrierhit', at, { color: owner.def.glow, actor: owner });
    this.sfx('barrierhit', at);
    if (owner.barrier.hp <= 0) {
      owner.barrier.hp = 0; owner.barrier.up = false; owner.barrier.brokenUntil = this.time + 5;
      this.sfx('barrierbreak', at); this.fx('barrierbreak', at, { color: owner.def.glow, actor: owner });
      if (src.def.id === 'gorgoth') this.emit({ t: 'counter', actor: src, target: owner, text: 'Null Lance shatters the Solar Bulwark' });
    }
  }

  // ------------------------------------------------------------------ main step
  step(dt: number) {
    this.time += dt;
    const t = this.time;
    if (this.timers.length) {
      const due = this.timers.filter(x => x.at <= t);
      this.timers = this.timers.filter(x => x.at > t);
      for (const d of due) d.fn();
    }
    // Stadium Armory: everyone waits at spawn while the teams shop
    if (!this.stadium?.frozen) {
      for (const a of this.actors) if (a.alive && a.controller) a.controller.think(dt);
    } else {
      for (const a of this.actors) { const i = a.input; i.mx = i.mz = 0; i.fire = i.alt = i.a1 = i.a2 = i.ult = i.jump = i.jumpHeld = i.melee = i.reload = i.swoop = false; }
    }
    for (const a of this.actors) this.updateActor(a, dt);
    this.separate();
    this.projs = this.projs.filter(p => this.stepProj(p, dt));
    tickAbilities(this, dt);
    tickPuppets(this);
    this.zones = this.zones.filter(z => z.until > t);
    this.updatePacks();
    if (this.director) this.director.update(dt);
    else if (this.stadium) this.stadium.update(dt);
    else if (this.rules === 'push') this.updatePush(dt);
    else if (this.mode !== 'training') this.updatePoint(dt);
  }

  // ------------------------------------------------------------------ health packs
  private updatePacks() {
    const t = this.time;
    for (const p of this.packs) {
      if (t < p.readyAt) continue;
      for (const a of this.actors) {
        if (!a.alive || a.isRobot || a.isBoss || Math.hypot(a.pos.x - p.x, a.pos.z - p.z) > 1.1 || Math.abs(a.pos.y - p.y) > 1.3) continue;
        const dot = a.has('burning', t) || a.has('brand', t) || a.has('bleed', t) || a.wounds.length > 0;
        if (a.health >= a.maxHp - 0.5 && !dot) continue;
        // a pack heals through healing reduction and burns away damage over time (as in Overwatch)
        const P = p.big ? PACK.big : PACK.small;
        let left = P.hp;
        const h = Math.min(left, a.def.hp - a.hp); a.hp += h; left -= h;
        const ar = Math.min(left, a.maxArmor - a.armor); a.armor += ar;
        for (const s of ['burning', 'brand', 'bleed', 'wound']) a.clear(s);
        a.wounds = [];
        p.readyAt = t + P.respawn;
        a.stats.packs = (a.stats.packs ?? 0) + 1;
        this.emit({ t: 'dmg', src: a, tgt: a, amt: h + ar, crit: false, heal: true, pos: a.center });
        this.fx('healthpack', { x: p.x, y: p.y + 0.5, z: p.z }, { color: '#7dffb0', r: p.big ? 1.6 : 1 }); this.sfx('healthpack', { x: p.x, y: p.y, z: p.z }, a);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ Mikoshi Rush
  private updatePush(dt: number) {
    const t = this.time, M = this.push;
    if (this.winner) return;
    if (t < M.unlockAt) { M.pos = this.pathAt(M.d); return; }
    if (t - dt < M.unlockAt) { this.emit({ t: 'msg', text: 'THE MIKOSHI RISES - PUSH IT HOME' }); this.sfx('announce'); }
    const on = { zenith: 0, umbra: 0 };
    for (const a of this.actors) if (a.alive && !a.isRobot && Math.hypot(a.pos.x - M.pos.x, a.pos.z - M.pos.z) < 5 && Math.abs(a.pos.y - M.pos.y) < 4) { on[a.team]++; a.objTime += dt; }
    M.contested = on.zenith > 0 && on.umbra > 0;
    M.owner = M.contested ? M.owner : on.zenith ? 'zenith' : on.umbra ? 'umbra' : null;
    if (!M.contested && M.owner) {
      const n = on[M.owner], sp = FLOAT_SPEED * (1 + 0.1 * (Math.min(3, n) - 1));
      M.d += (M.owner === 'zenith' ? 1 : -1) * sp * dt;
      M.best.zenith = Math.max(M.best.zenith, M.d); M.best.umbra = Math.max(M.best.umbra, -M.d);
      // checkpoints every sixth of the route: the pushing team is told, the defenders hear the alarm
      const cp = Math.floor(Math.abs(M.d) / (M.half / 3));
      if (cp > M.checkpoint && cp < 3) { M.checkpoint = cp; this.emit({ t: 'msg', text: `${M.owner === 'zenith' ? 'ZENITH' : 'UMBRA'} REACHES CHECKPOINT ${cp}`, color: M.owner === 'zenith' ? '#5cc8ff' : '#ff3b5c' }); this.sfx('capture'); }
    }
    M.pos = this.pathAt(M.d);
    if (M.d >= M.half - 0.5) return this.end('zenith');
    if (-M.d >= M.half - 0.5) return this.end('umbra');
    // time: the furthest push wins; a push still moving the float (and contested) plays on in overtime
    if (t > this.timeLimit) {
      const lead: TeamId = M.best.zenith >= M.best.umbra ? 'zenith' : 'umbra';
      M.overtime = M.contested || (M.owner !== null && M.owner !== lead);
      if (!M.overtime || t > this.timeLimit + 30) this.end(M.best.zenith === M.best.umbra ? (M.d >= 0 ? 'zenith' : 'umbra') : lead);
    }
  }

  pressed(a: Actor, k: 'a1' | 'a2' | 'ult' | 'alt' | 'jump' | 'fire' | 'melee' | 'swoop' | 'descend') {
    const p = this.prevIn.get(a.id);
    return !!a.input[k] && !(p && p[k]);
  }

  private updateActor(a: Actor, dt: number) {
    const t = this.time;
    // Hayate's Dragon Gate Blade ran out (or he fell with it drawn): his own weapons back, full magazine
    if (a.def !== a.baseDef && a.def.id === 'hayate' && !a.has('dragonblade', t)) { a.def = a.baseDef; a.ammo = a.maxAmmo; a.nextShot = Math.max(a.nextShot, t + 0.3); }
    if (!a.alive) {
      if (a.respawnAt && t >= a.respawnAt && this.winner === null) this.respawn(a);
      return;
    }
    // ---- statuses
    const per = (k: string) => a.has(k, t);
    if (per('brand')) this.damage(a.src.brand ?? null, a, 12 * dt, { kind: 'dot', noLifesteal: true });
    if (per('bleed')) this.damage(a.src.bleed ?? null, a, (a.sv.bleed ?? 33) * dt, { kind: 'dot', noLifesteal: true });
    if (per('hot') && a.src.hot) this.heal(a.src.hot, a, (a.sv.hot ?? 0) * dt, true);
    if (per('burning')) this.damage(a.src.burning ?? null, a, 16 * dt, { kind: 'dot', noLifesteal: true });
    if (a.wounds.length) this.bleedWounds(a, dt);
    if (a.def.id === 'gantetsu') { const s = a.shields.find(x => x.kind === 'roar'); if (s && t - (a.sv.roarAt ?? 0) > 2) s.amt -= 12 * dt; }
    // Bass Drop's temporary health holds for a beat, then fades out over 6s
    { const s = a.shields.find(x => x.kind === 'bassdrop'); if (s && t - (a.sv.bassAt ?? 0) > 0.8) s.amt -= 750 / 6 * dt; }
    if (per('linked') && a.src.linked) this.heal(a.src.linked, a, 25 * dt, true);
    if (a.def.id === 'enra' && t - a.lastDamagedAt > 3 && a.hp < a.def.hp) a.hp = Math.min(a.def.hp, a.hp + 12 * dt);
    if (a.isRobot && !a.isSummon && t - a.lastDamagedAt > 4) a.hp = Math.min(a.def.hp, a.hp + 40 * dt);
    // the spawn room heals quickly (not the web build's legacy match)
    if (this.full && this.mode !== 'campaign' && t - a.lastDamagedAt > 1.5 && Math.hypot(a.pos.x - a.spawn[0], a.pos.z - a.spawn[1]) < 7) {
      a.hp = Math.min(a.def.hp, a.hp + 150 * dt); a.armor = Math.min(a.maxArmor, a.armor + 150 * dt);
    }
    a.shields = a.shields.filter(s => s.until > t && s.amt > 0.5);
    if (a.st.asura && !per('asura') && a.scale > 1) { a.scale = 1; a.maxArmor = a.def.armor; a.armor = Math.min(a.armor, a.maxArmor); }
    // Dawn Colossus: grow into the giant over ~1s, hold it for the ult's duration, then shrink back and drop the bonus armor
    if (a.st.titan !== undefined) {
      const on = per('titan');
      a.scale += ((on ? TITAN_SCALE : 1) - a.scale) * Math.min(1, dt * (on ? 2.6 : 3.2));
      if (!on && a.scale < 1.02) {
        a.scale = 1; a.maxArmor = a.def.armor; a.armor = Math.min(a.armor, a.maxArmor); a.clear('titan');
        this.fx('ultflash', a.center, { color: a.def.glow, actor: a }); this.sfx('barrierbreak', a.center, a);
      }
    }
    if (!a.alive) return;
    a.ult = Math.min(a.def.ult.charge, a.ult + (a.def !== a.baseDef ? 20 : this.mode === 'aitest' ? 30 : 5) * dt);
    if (a.barrier.max && !a.barrier.up && t > a.barrier.regenAt && t > a.barrier.brokenUntil) a.barrier.hp = Math.min(a.barrier.max, a.barrier.hp + 150 * dt);
    if (a.has('stealth', t) && (a.has('revealed', t) || a.has('sealed', t))) {
      a.clear('stealth');
      const k = this.actors.find(x => x.def.id === 'kaien' && x.team !== a.team);
      if (a.def.id === 'kagemaru' && k && a.has('sealed', t)) this.emit({ t: 'counter', actor: k, target: a, text: 'Warding Seal tears away the Veil of Night' });
    }
    this.move(a, dt);
    if (!a.alive) return;
    const stunned = a.has('stun', t) || a.has('reborn', t);       // (the reborn can't fight until their guard ends)
    if (!stunned && !a.has('phased', t)) {
      updateWeapons(this, a, dt);
      // Crescent Warpath: a click drops her out of the flight where she is
      if (a.forced?.kind === 'tide' && (this.pressed(a, 'fire') || this.pressed(a, 'alt')) && t - (a.sv.tideT0 ?? t) > TIDE_HOLD) a.forced.until = t;
      const silenced = a.has('silence', t);
      if (!silenced) {
        if (a.forced?.kind === 'dawncharge' && this.pressed(a, 'a1') && t - (a.sv.chargeStart ?? 0) > 0.3) a.forced.until = t;
        else if (a.has('tachiai', t) && this.pressed(a, 'a1') && t - (a.sv.rushStart ?? 0) > 0.3) a.clear('tachiai');
        else if (this.pressed(a, 'a1')) castAbility(this, a, a.def.ability1.id, 'a1');
        if (this.pressed(a, 'a2')) {
          if (a.has('deflect', t) && t - (a.sv.deflectStart ?? 0) >= DEFLECT_MIN) a.clear('deflect');     // Mirror Water ends on E again
          else castAbility(this, a, a.def.ability2.id, 'a2');
        }
        if (this.pressed(a, 'ult') && a.ult >= a.def.ult.charge) castAbility(this, a, a.def.ult.id, 'ult');
        const S = a.def.secondary;
        if (isAbility(S) && !S.hold && this.pressed(a, 'alt')) castAbility(this, a, S.id, 'alt');
      }
    } else { a.barrier.up = false; a.beamOn = false; a.flameOn = false; a.charging = false; }
    const i = a.input;
    this.prevIn.set(a.id, { a1: i.a1, a2: i.a2, ult: i.ult, alt: i.alt, jump: i.jump, fire: i.fire, melee: i.melee, swoop: !!i.swoop, descend: i.descend });
  }

  /** movement integration only (also used by co-op clients to predict their own hero) */
  move(a: Actor, dt: number) {
    const t = this.time, d = a.def, inp = a.input, L = this.level;
    a.yaw = inp.yaw; a.pitch = Math.max(-1.45, Math.min(1.45, inp.pitch));
    const wasGrounded = a.grounded;
    // colossi can't be dragged, pulled or knocked around by heroes
    if (a.isBoss && a.forced && (a.forced.kind === 'pull' || a.forced.kind === 'knock')) a.forced = null;
    // Tachiai Rush is unstoppable: shoves and pulls slide off it
    if (a.forced && a.has('tachiai', t) && (a.forced.kind === 'pull' || a.forced.kind === 'knock')) a.forced = null;
    if (a.forced) {
      const f = a.forced;
      if (t >= f.until) { a.forced = null; f.onEnd?.(); a.vel.x *= 0.3; a.vel.z *= 0.3; if (f.ignoreGravity) a.vel.y = Math.min(a.vel.y, 0); }
      else { a.vel = { x: f.vx, y: f.ignoreGravity ? f.vy : a.vel.y - G * dt, z: f.vz }; }
    }
    if (!a.forced) {
      let spd = d.speed * (1 + a.mods.speed);
      if (a.has('slow', t)) spd *= 0.8;
      if (a.has('speed', t)) spd *= a.sv.speed ?? 1.25;
      if (a.has('titan', t)) spd *= 1.2;
      if (a.has('judgment', t) || a.has('stealth', t)) spd *= 1.3;
      if (a.charging) spd *= 0.7;
      if (a.barrier.up) spd *= 0.65;
      if (a.flameOn) spd *= 0.9;
      if (a.has('reapwind', t)) spd *= 0.55;           // Tomoe heaving the axe round
      if (d.id === 'hibiki') spd *= this.grooveStep(a, dt);
      else if (d.id === 'hayate') spd *= this.grooveStep(a, dt, KOI_GROOVE_MAX);   // Sun-Alloy Frame: tap jump faster, run faster
      if (a.has('dragonblade', t)) spd *= 1.3;         // Hayate's Dragon Gate Blade
      const rooted = a.has('root', t) || a.has('stun', t) || a.has('rising', t);
      let mx = inp.mx, mz = inp.mz;
      const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
      if (mz < 0) mz *= 0.9;
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), rx = -Math.cos(a.yaw), rz = Math.sin(a.yaw);
      let wx = (fx * mz + rx * mx) * spd, wz = (fz * mz + rz * mx) * spd;
      if (rooted) { wx = 0; wz = 0; }
      // Gantetsu - Tachiai Rush: a straight-ahead charge the aim steers only slowly (the guns stay free to fire where he
      // looks); SPACE ends it in a leaping Shiko Stomp
      const rush = a.has('tachiai', t);
      if (rush) {
        const cur = a.sv.rushYaw ?? a.yaw;
        let dy = inp.yaw - cur; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
        const ny = cur + Math.max(-2.2 * dt, Math.min(2.2 * dt, dy));
        a.sv.rushYaw = ny;
        wx = Math.sin(ny) * spd * 1.85; wz = Math.cos(ny) * spd * 1.85;
        if (this.pressed(a, 'jump') && a.grounded) stompLeap(this, a);
      }
      // ...and past the top of the leap he drives himself down into the slam
      if (a.sv.stompArmed && !a.grounded && a.vel.y < 0) a.vel.y -= G * 1.5 * dt;
      // Mirei - Starwing Swoop: the swoop drives her velocity this step (flight, steering and gravity sit it out)
      const swooping = this.swoopStep(a, dt) || this.grindStep(a, dt, spd, rooted) || this.climbStep(a, dt, rooted);
      // flight
      const canFly = (d.frame === 'flyer' || d.frame === 'drone' || !!d.jets) && !a.has('grounded', t) && !rooted && !swooping;
      if (d.frame === 'drone') a.flying = true;
      else if (canFly && inp.jumpHeld && a.flight > 5 && (!a.grounded || !this.pressed(a, 'jump'))) a.flying = true;
      if (!canFly || a.flight <= 0) a.flying = false;
      if (a.flying && d.frame !== 'drone') {
        const target = inp.jumpHeld ? (d.jets ? 6.5 : 5.5) : inp.descend ? -7 : d.jets ? -1.8 : -1.1;
        a.vel.y += (target - a.vel.y) * Math.min(1, dt * 5);
        // thrusters burn a fixed fuel tank (d.jets seconds); wings hover cheaply
        a.flight -= (d.jets ? 100 / d.jets : inp.jumpHeld ? 15 : 4.5) * dt;
        if (d.jets) { wx *= 1.45; wz *= 1.45; if (t >= (a.sv.jetSfx ?? 0)) { a.sv.jetSfx = t + 0.35; this.sfx('flame', a.pos, a); } }
        if (a.grounded && !inp.jumpHeld) a.flying = false;
      } else if (d.frame === 'drone') {
        // over the void groundAt is -Infinity: hold the altitude of the last solid ground instead of diving forever
        const gnd = L.groundAt(a.pos.x, a.pos.z, a.pos.y);
        if (Number.isFinite(gnd)) a.sv.hoverGround = gnd;
        const want = a.sv.hoverY ?? ((a.sv.hoverGround ?? a.pos.y - 3.2) + 3.2);
        a.vel.y += ((want - a.pos.y) * 2 - a.vel.y) * Math.min(1, dt * 3);
      }
      // air control: a slingshot / superjump out of a swoop carries its momentum (steering nudges it, not brakes it)
      let k = a.grounded ? 14 : a.flying ? 4 : a.has('slingshot', t) || a.has('superjump', t) ? 0.55 : 2.5;
      // Hibiki skates (like Lucio): different acceleration / deceleration - pushes up to speed, glides when you let go,
      // carves (not snaps) through turns, and keeps his momentum into a jump
      if (d.id === 'hibiki') {
        const want = Math.hypot(wx, wz), cur = Math.hypot(a.vel.x, a.vel.z);
        const turning = want > 0.1 && cur > 0.5 && (wx * a.vel.x + wz * a.vel.z) / (want * cur) < 0.3;
        k = a.grounded ? (want < 0.1 ? 1.6 : turning ? 4 : want > cur ? 5.5 : 3) : 1.4;
      }
      if (!swooping) {
        a.vel.x += (wx - a.vel.x) * Math.min(1, dt * k);
        a.vel.z += (wz - a.vel.z) * Math.min(1, dt * k);
      }
      if (this.pressed(a, 'jump') && !rooted && !rush && !swooping) {
        if (a.grounded || t - a.lastGroundedAt < 0.1) {
          a.vel.y = d.frame === 'mech' ? 8 : 8.6; a.grounded = false; a.anim.jumpAt = t; a.lastGroundedAt = -9;
          a.airJumps = d.id === 'raijin' || d.id === 'hayate' ? 1 : 0;
          this.sfx(d.frame === 'mech' ? 'mechjump' : 'jump', a.pos, a);
        } else if (a.airJumps > 0) {
          a.airJumps--; a.vel.y = 8.2; a.anim.jumpAt = t; this.sfx('doublejump', a.pos, a); this.fx('doublejump', a.pos, { color: d.glow });
        }
      }
      if (!a.flying && d.frame !== 'drone' && !swooping) a.vel.y -= G * dt * (a.has('glide', t) && a.vel.y < 0 ? 0.18 : 1);
      // Mirei's angelic descent: holding SPACE while falling floats her down slowly instead of dropping
      if (d.id === 'mirei' && !a.flying && !a.grounded && !swooping && inp.jumpHeld && a.vel.y < -2.2 && !a.forced) { a.vel.y = -2.2; a.set('angelglide', t, 0.15); }
    }
    // integrate with sub-steps so fast dashes don't tunnel
    // a non-finite velocity would make the sub-step count infinite and freeze the whole simulation
    if (!Number.isFinite(a.vel.x + a.vel.y + a.vel.z)) a.vel = { x: 0, y: 0, z: 0 };
    const sp = Math.hypot(a.vel.x, a.vel.y, a.vel.z) * dt;
    const n = Math.min(64, Math.max(1, Math.ceil(sp / 0.3)));
    let hitWall = false;
    const y0 = a.pos.y, x0 = a.pos.x, z0 = a.pos.z;
    for (let i = 0; i < n; i++) {
      const head = a.pos.y + a.colHeight;
      a.pos.x += a.vel.x * dt / n; a.pos.y += a.vel.y * dt / n; a.pos.z += a.vel.z * dt / n;
      // ceilings: rising into a slab (an upper floor, a roof, a door lintel) stops the climb
      if (a.vel.y > 0) {
        const c = L.ceilingAt(a.pos.x, a.pos.z, head);
        if (a.pos.y + a.colHeight > c) { a.pos.y = c - a.colHeight - 0.01; a.vel.y = 0; }
      }
      if (L.collide(a.pos, a.colRadius, a.colHeight)) hitWall = true;
    }
    if (hitWall && (a.forced?.kind === 'abysscharge' || a.forced?.kind === 'dawncharge')) { if (a.forced.kind === 'dawncharge') a.sv.chargeWall = 1; a.forced.until = t; }
    // a swoop that runs into a wall stops dead instead of grinding along it
    if (hitWall && a.has('swoop', t) && Math.hypot(a.pos.x - x0, a.pos.z - z0) < Math.hypot(a.vel.x, a.vel.z) * dt * 0.25) { a.clear('swoop'); a.cd.swoop = t + 1.6; a.vel.x *= 0.2; a.vel.z *= 0.2; }
    this.ringClamp(a);
    const [X, Z] = L.size;
    a.pos.x = Math.max(-X - 1, Math.min(X + 1, a.pos.x)); a.pos.z = Math.max(-Z - 1, Math.min(Z + 1, a.pos.z));
    // AI walkers never step off a ledge into the void on their own (knockbacks / pulls still can)
    if (a.controller && !a.isPlayer && ((wasGrounded && !a.forced && a.vel.y <= 0) || a.isBoss) && !a.flying && a.def.frame !== 'drone'
      && L.groundAt(a.pos.x, a.pos.z, a.pos.y + 0.3) < a.pos.y - 5) {
      a.pos.x = x0; a.pos.z = z0; a.vel.x = 0; a.vel.z = 0;
      if (a.isBoss) a.forced = null;    // colossi stop at the edge instead of charging into the void
    }
    // colossi remember their last solid footing; separation pushes or charges that end over the void snap back
    if (a.isBoss && a.def.frame !== 'drone') {
      if (L.groundAt(a.pos.x, a.pos.z, a.pos.y + 0.5) > a.pos.y - 3) { a.sv.safeX = a.pos.x; a.sv.safeZ = a.pos.z; a.sv.safeY = a.pos.y; }
      else if (a.sv.safeX !== undefined) { a.pos.x = a.sv.safeX; a.pos.z = a.sv.safeZ; a.pos.y = Math.max(a.pos.y, a.sv.safeY); a.vel.x = a.vel.z = 0; a.forced = null; }
    }
    // sweep from last frame's height so fast falls can't tunnel through thin floors
    const g = L.groundAt(a.pos.x, a.pos.z, Math.max(a.pos.y, Math.min(y0, a.pos.y + 3)), a.radius);
    if (a.pos.y <= g + 1e-3 && a.vel.y <= 0.01) {
      if (!wasGrounded && a.vel.y < -7) { a.anim.landAt = t; this.sfx(d.frame === 'mech' ? 'mechland' : 'land', a.pos, a); if (d.frame === 'mech') this.fx('dust', a.pos, { r: 2.5 }); }
      a.pos.y = g; a.vel.y = 0; a.grounded = true; a.lastGroundedAt = t;
    } else if (wasGrounded && a.vel.y <= 0 && !a.flying && a.pos.y - g < STEP + 0.05 && !a.forced) {
      a.pos.y = g; a.vel.y = 0; a.grounded = true; a.lastGroundedAt = t;
    } else if (a.pos.y < g && a.vel.y > 0) {
      a.pos.y = g;
    } else a.grounded = false;
    if (a.grounded) { a.flight = Math.min(100, a.flight + 32 * dt); a.flying = false; }
    const pad = a.grounded && !a.forced ? L.padAt(a.pos.x, a.pos.z, a.pos.y) : null;
    if (pad) {
      a.vel = { x: pad.vx, y: pad.vy, z: pad.vz }; a.grounded = false; a.lastGroundedAt = -9; a.anim.jumpAt = t;
      this.sfx('pad', a.pos, a); this.fx('pad', a.pos, { color: this.map.tint });
      a.set('padflight', t, 2.5); a.sv.padvx = pad.vx; a.sv.padvz = pad.vz;
    }
    if (a.has('padflight', t) && !a.grounded && !a.forced) {
      // pads carry you over the gap: hold the launch velocity instead of letting input brake it
      if (a.sv.padvx || a.sv.padvz) { a.vel.x = a.sv.padvx; a.vel.z = a.sv.padvz; }
    }
    if (a.grounded) a.clear('padflight');
    if (a.pos.y < L.killY) {
      this.fx('fall', a.pos, {});
      this.kill(a, null);
    }
  }

  /**
   * Mirei's Starwing Swoop (a guardian-angel dash): F streaks her toward the ally under the crosshair within 30m, speeding
   * up as she goes; SPACE mid-swoop slingshots her onward with the swoop's momentum, CTRL launches her straight up.
   * Weapons and the heal beam keep working throughout. Returns true while the swoop owns her velocity this step.
   */
  /**
   * Hibiki - Mag-Grind (wall ride + climb), after Lucio: airborne with the grind button held (his own binding: left mouse
   * by default; bots use jump) beside a wall, he locks onto it and grinds along at +30% speed without falling.
   *  - LOOK UP while riding and the ride angles upward (steeper = slower along the wall), for up to 2.4s of climb per
   *    latch; look down to drop along it.
   *  - Head-on into a wall he rides straight up it.
   *  - At the top edge he mantles onto the roof and stays there.
   *  - Let go and he kicks off the wall - up and away, higher if he's looking up - so two walls criss-crossed climb an
   *    alley; every fresh latch refills the climb.
   * The wall ending, landing, a knockback or pushing away from the wall just drops him off. Grinding charges his
   * empowered Scratch Wave (abilities.ts).
   */
  private grindStep(a: Actor, dt: number, spd: number, rooted: boolean): boolean {
    const t = this.time, L = this.level, inp = a.input;
    if (a.def.id !== 'hibiki') return false;
    const on = a.has('grinding', t);
    const hold = inp.grind ?? inp.jumpHeld;
    const look = Math.max(-1, Math.min(1, a.pitch / 0.7));           // -1 looking down .. 1 looking well up
    const off = (kick: boolean) => {
      a.clear('grinding'); a.sv.grindCd = t + 0.3;
      if (kick) {
        const up = Math.max(0, look);
        a.vel.x += (a.sv.grindNx ?? 0) * (5.5 - 2 * up); a.vel.z += (a.sv.grindNz ?? 0) * (5.5 - 2 * up); a.vel.y = 6.2 + 3.6 * up;
        a.anim.jumpAt = t; this.sfx('jump', a.pos, a); this.fx('doublejump', a.pos, { color: a.def.glow });
      }
      return false;
    };
    if (a.grounded) a.sv.climbT = 0;
    if (rooted || a.forced || a.has('stun', t)) return on ? off(false) : false;
    if (!hold) return on ? off(true) : false;
    const y = a.pos.y + a.height * 0.5, reach = a.radius + 1.1;
    const probe = (nx: number, nz: number, py = y) => {
      const h = L.ray({ x: a.pos.x, y: py, z: a.pos.z }, { x: nx, y: 0, z: nz }, reach);
      return h && Math.abs(h.ny) < 0.35 ? h : null;
    };
    const hs = Math.hypot(a.vel.x, a.vel.z);
    if (!on) {
      if (t < (a.sv.grindCd ?? 0)) return false;
      const air = a.pos.y - L.groundAt(a.pos.x, a.pos.z, a.pos.y + 0.2);
      // from the ground he only latches running at a wall while looking up it (skating up the wall); in the air, any wall
      const fromGround = a.grounded || air < 0.5;
      // (or skating fast straight at it - the groove carries him up without having to look)
      if (fromGround && look < 0.12 && !(hs > 8 && (a.vel.x * Math.sin(a.yaw) + a.vel.z * Math.cos(a.yaw)) / hs > 0.7)) return false;
      const fx0 = Math.sin(a.yaw), fz0 = Math.cos(a.yaw);
      const vx = hs > 0.5 ? a.vel.x / hs : fx0, vz = hs > 0.5 ? a.vel.z / hs : fz0;
      let best: { t: number; nx: number; nz: number } | null = null;
      const dirs = fromGround ? [[fx0, fz0], [vx, vz]] : [[-vz, vx], [vz, -vx], [vx * 0.7 - vz * 0.7, vz * 0.7 + vx * 0.7], [vx * 0.7 + vz * 0.7, vz * 0.7 - vx * 0.7], [vx, vz], [fx0, fz0]];
      for (const [dx, dz] of dirs) {
        const l = Math.hypot(dx, dz) || 1, h = probe(dx / l, dz / l);
        if (h && (!best || h.t < best.t)) { const nl = Math.hypot(h.nx, h.nz) || 1; best = { t: h.t, nx: h.nx / nl, nz: h.nz / nl }; }
      }
      if (!best) return false;
      a.sv.grindNx = best.nx; a.sv.grindNz = best.nz;
      // ride the way he was already travelling along the wall; head-on (or from a standstill) he rides straight up it
      const along = a.vel.x * -best.nz + a.vel.z * best.nx;
      a.sv.grindDir = along >= 0 ? 1 : -1;
      a.sv.grindHeadOn = Math.abs(along) < Math.max(1.2, hs * 0.35) ? 1 : 0;
      a.sv.climbT = 0;
      if (fromGround) { a.grounded = false; a.lastGroundedAt = -9; a.pos.y += 0.05; }
      this.sfx('grindstart', a.pos, a);
    } else {
      // still a wall there? (corners and wall ends drop him off with his momentum)
      const h = probe(-(a.sv.grindNx ?? 0), -(a.sv.grindNz ?? 0));
      if (!h) {
        // ...unless he's at the top of it: then he mantles onto the roof
        if (this.mantle(a)) return false;
        return off(false);
      }
      const nl = Math.hypot(h.nx, h.nz) || 1; a.sv.grindNx = h.nx / nl; a.sv.grindNz = h.nz / nl;
    }
    const nx = a.sv.grindNx, nz = a.sv.grindNz, dir = a.sv.grindDir ?? 1;
    // steering: pushing away from the wall lets go; pushing back along it reverses the ride
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), rx = -Math.cos(a.yaw), rz = Math.sin(a.yaw);
    const ix = fx * inp.mz + rx * inp.mx, iz = fz * inp.mz + rz * inp.mx;
    if (ix * nx + iz * nz > 0.75) return off(false);
    const tx = -nz * dir, tz = nx * dir;
    if (ix * tx + iz * tz < -0.7) { a.sv.grindDir = -dir; a.sv.grindHeadOn = 0; }
    // climb: looking up angles the ride upward (for a while), looking down drops along the wall
    a.sv.climbT = (a.sv.climbT ?? 0) + dt;
    // head-on he can only skate a storey or so straight up; riding along the wall he climbs at an angle for longer
    const headOn = !!a.sv.grindHeadOn, climbMax = headOn ? 3.0 : 4.5;
    // wall hop: tapping jump on the wall kicks him up it and refreshes the climb (and keeps the groove going)
    if (this.pressed(a, 'jump')) {
      a.vel.y = Math.max(a.vel.y, 7.5); a.sv.climbT = Math.max(0, a.sv.climbT - 1.2); a.anim.jumpAt = t;
      this.sfx('jump', a.pos, a);
    }
    // (tapping climbs too, wherever he looks: the rhythm takes him up the wall)
    const tapped = t - (a.sv.tapAt ?? -9) < 0.4;
    const climbing = (look > 0.05 || tapped) && a.sv.climbT < climbMax;
    let up = climbing ? Math.max(look, tapped ? 0.7 : 0) * Math.min(1, (climbMax - a.sv.climbT) / 0.35) : 0;
    // the arena's boundary walls: he can ride them, but the climb stops short of their top (no leaving the map)
    const [BX, BZ] = L.size;
    const border = Math.abs(a.pos.x) > BX - 2.5 || Math.abs(a.pos.z) > BZ - 2.5;
    const capped = border && !probe(-nx, -nz, a.pos.y + a.height + 1.2);
    if (capped) up = 0;
    // on a wall the Groove lifts him (the climb below); along the wall it counts for a little over double at most - at
    // full groove speed he shot along the face and off its end before he ever reached the top
    const gr = Math.max(1, a.sv.rhythm ?? 1), spdW = spd / gr * Math.min(gr, 2.2);
    const sp = spdW * 1.3 * (headOn ? 0.15 : 1 - 0.55 * Math.max(0, up)), cur = a.vel.x * tx + a.vel.z * tz;
    const v = cur + (sp - cur) * Math.min(1, dt * 6);
    // a light pull toward the wall keeps the skates on it
    const gap = (probe(-nx, -nz)?.t ?? reach) - a.radius;
    const pull = Math.max(0, gap - 0.05) * 6;
    a.vel.x = tx * v - nx * pull; a.vel.z = tz * v - nz * pull;
    const lift = Math.min(2.5, Math.sqrt(a.sv.rhythm ?? 1));       // the groove climbs faster too
    const vyT = up > 0 ? (headOn ? 7 : 6) * up * lift : look < -0.25 ? -5 * -look : 0;
    a.vel.y += (vyT - a.vel.y) * Math.min(1, dt * (up > 0 ? 8 : 12));
    if (capped) a.vel.y = Math.min(a.vel.y, 0);
    // nearing the top of the wall on the way up: over the edge and onto the roof
    if (a.vel.y > 0.5 && (!probe(-nx, -nz, a.pos.y + a.height + 0.25) || !probe(-nx, -nz, a.pos.y + a.height + 1.2)) && this.mantle(a)) return false;
    a.set('grinding', t, 0.15); a.flying = false;
    a.sv.grindUp = up;
    // which side the wall is on relative to where he's facing (the animator leans away from it)
    a.sv.grindSide = (nx * rx + nz * rz) > 0 ? -1 : 1;
    return true;
  }

  /**
   * Hibiki - Groove: his speed follows how fast jump is being tapped. The tap rate (taps a second, counted on the ground,
   * in the air and on walls) maps straight onto a multiplier on his (half-speed) skate: x1 below GROOVE_TAPS[0], rising in
   * step with the rate to GROOVE_MAX at GROOVE_TAPS[1] - every extra tap a second is the same step up. The rate is live:
   * it can never read faster than the time since the last tap allows, so the moment the tapping slows the speed follows
   * it down. Movement sub-steps every 0.3m, so even at the top of the groove he can't skate through a wall.
   */
  private grooveStep(a: Actor, dt: number, max = GROOVE_MAX): number {
    const t = this.time;
    if (this.pressed(a, 'jump')) {
      const gap = t - (a.sv.tapAt ?? -9);
      a.sv.tapAt = t;
      const inst = gap > 0.04 ? Math.min(12, 1 / gap) : 12;
      a.sv.tapRate = (a.sv.tapRate ?? 0) * 0.4 + inst * 0.6;
    }
    // a slower beat shows at once: the rate is capped by the gap since the last tap (none for over a second = stopped)
    const since = t - (a.sv.tapAt ?? -9);
    a.sv.tapRate = since > 1.2 ? 0 : Math.min(a.sv.tapRate ?? 0, 1 / Math.max(1e-3, since) * 1.15);
    const x = Math.max(0, Math.min(1, ((a.sv.tapRate ?? 0) - GROOVE_TAPS[0]) / (GROOVE_TAPS[1] - GROOVE_TAPS[0])));
    const target = 1 + (max - 1) * x;
    // (sv.rhythm / status 'rhythm': 'groove' is the Healing Groove aura's status, which writes sv.groove every tick)
    const g0 = a.sv.rhythm ?? 1;
    a.sv.rhythm = g0 + (target - g0) * Math.min(1, dt * (target > g0 ? 2.2 : 3.5));
    if (a.sv.rhythm > 1.5) a.set('rhythm', t, 0.25);
    // deep in the groove his skates leave a light trail
    if (a.sv.rhythm > Math.min(4, max * 0.7) && t >= (a.sv.rhythmFx ?? 0)) { a.sv.rhythmFx = t + 0.3; this.fx('chargetrail', a.pos, { actor: a, dur: 0.4, color: a.def.glow }); }
    return a.sv.rhythm;
  }

  /**
   * The Koryu brothers climb (after Genji): run at a wall and jump - or keep tapping jump - and they run straight up it.
   * Holding jump climbs for CLIMB_SECS per touch of the ground; every tap adds a little back, so a fast rhythm of taps
   * keeps a climb going up a tall building (Lucio-style). Seiran's Heir of the Falls also climbs just by moving into a
   * wall while airborne. At the top they vault onto the roof; the arena's boundary walls stop the climb short.
   */
  private climbStep(a: Actor, dt: number, rooted: boolean): boolean {
    const id = a.def.id;
    if (id !== 'hayate' && id !== 'seiran') return false;
    const t = this.time, inp = a.input, L = this.level;
    if (a.grounded) a.sv.climbLeft = CLIMB_SECS;
    const stop = () => { if (a.has('wallclimb', t)) a.clear('wallclimb'); return false; };
    if (rooted || a.forced || a.has('stun', t) || inp.mz < (id === 'hayate' ? 0.05 : 0.3)) return stop();
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), reach = a.radius + 0.5;
    const wall = (y: number) => { const h = L.ray({ x: a.pos.x, y, z: a.pos.z }, { x: fx, y: 0, z: fz }, reach); return h && Math.abs(h.ny) < 0.35 ? h : null; };
    const h = wall(a.pos.y + a.height * 0.55);
    const on = a.has('wallclimb', t);
    if (!h) {
      // the wall ended under his hands: over the top and onto the roof
      if (on && this.mantle(a)) { a.clear('wallclimb'); return false; }
      return stop();
    }
    const [X, Z] = L.size;
    const border = Math.abs(a.pos.x) > X - 2.5 || Math.abs(a.pos.z) > Z - 2.5;
    // the arena's own walls: Seiran stops short of them; Hayate climbs them the way Genji climbs a map's edge - one
    // Cyber-Agility climb (7.8 m) per time in the air, never onto the top (mantle() refuses the border) - so the Proving
    // Grounds' walls climb, but nobody perches on the arena wall or leaves the map
    if (border && id !== 'hayate') return stop();
    if (a.grounded) a.sv.edgeClimb = 0;
    if (border) {
      const top = L.groundAt(a.pos.x + fx * (reach + 0.4), a.pos.z + fz * (reach + 0.4), 500);
      if ((Number.isFinite(top) && a.pos.y >= top - a.height - 0.3) || (a.sv.edgeClimb ?? 0) >= 7.8) { a.vel.y = Math.min(a.vel.y, 0); return stop(); }
    }
    const tap = this.pressed(a, 'jump');
    // (holding jump into a wall starts a climb too - Genji's - as does Seiran just moving into one in the air)
    const want = tap || inp.jumpHeld || (id === 'seiran' && !a.grounded && (on || a.vel.y < 2));
    if (!want) return on ? true : false;
    // Hayate's Sun-Alloy Frame climbs any wall or building to its top for as long as jump is held (or tapped) - Genji's
    // climb without its one-second limit; Seiran has CLIMB_SECS of climb per touch of the ground, every tap adding a little back
    if (id !== 'hayate') {
      if (tap) a.sv.climbLeft = Math.min(CLIMB_SECS, (a.sv.climbLeft ?? CLIMB_SECS) + 0.14);
      if ((a.sv.climbLeft ?? CLIMB_SECS) <= 0) return stop();
      a.sv.climbLeft = (a.sv.climbLeft ?? CLIMB_SECS) - dt;
    }
    const nl = Math.hypot(h.nx, h.nz) || 1;
    a.sv.grindNx = h.nx / nl; a.sv.grindNz = h.nz / nl; a.sv.grindDir = 1;
    // Hayate runs up at Genji's 7.8 m/s (Cyber-Agility), and the faster the jump taps, the faster the climb - the same
    // rhythm that drives his run
    const up = (id === 'hayate' ? 7.8 * Math.min(KOI_GROOVE_MAX, Math.max(1, a.sv.rhythm ?? 1)) : 6.8) * (a.has('dragonblade', t) ? 1.25 : 1);
    a.vel.y = up; a.vel.x = -a.sv.grindNx * 1.2; a.vel.z = -a.sv.grindNz * 1.2;          // hug the wall
    if (border) a.sv.edgeClimb = (a.sv.edgeClimb ?? 0) + up * dt;
    a.grounded = false; a.flying = false; a.lastGroundedAt = -9;
    if (!on) { a.anim.jumpAt = t; this.sfx('jump', a.pos, a); }
    a.set('wallclimb', t, 0.18);
    // reaching the top: the wall is gone at head height - vault over
    if (!wall(a.pos.y + a.height + 0.35) && this.mantle(a)) { a.clear('wallclimb'); return false; }
    return true;
  }

  /** where an actor is aiming (unit vector from yaw and pitch) */
  aimDir(a: Actor): V3 {
    const c = Math.cos(a.pitch);
    return { x: Math.sin(a.yaw) * c, y: Math.sin(a.pitch), z: Math.cos(a.yaw) * c };
  }
  /** Mirror Water: is something coming at him from in front (within 90 degrees of where he faces)? If so it is turned:
   *  the blade flicks toward where it came from (anim.deflectAt / deflectDir / deflectN for the animator, an fx
   *  'deflect' at the contact point with that direction in `n`) and the caller decides what becomes of it. */
  private deflected(x: Actor, from: V3, at: V3): boolean {
    const dx = from.x - x.pos.x, dz = from.z - x.pos.z, l = Math.hypot(dx, dz);
    if (l > 1e-3 && (dx * Math.sin(x.yaw) + dz * Math.cos(x.yaw)) / l < 0) return false;
    const dy = from.y - x.center.y, n = Math.hypot(l, dy) || 1;
    const dir = { x: dx / n, y: dy / n, z: dz / n };
    x.anim.deflectAt = this.time; x.anim.deflectDir = dir; x.anim.deflectN++;
    x.stats.deflects = (x.stats.deflects ?? 0) + 1;
    this.sfx('parry', at); this.fx('deflect', at, { color: '#8ad8ff', actor: x, n: dir });
    return true;
  }

  /** Mag-Grind top-out: if the wall he's riding ends in a roof within reach above his feet, pop up over the edge and land
   *  on it (he stays on top of the building). Returns true if he mantled. */
  private mantle(a: Actor): boolean {
    const L = this.level, nx = a.sv.grindNx ?? 0, nz = a.sv.grindNz ?? 0;
    const [X, Z] = L.size;
    for (const inset of [a.radius + 0.35, a.radius + 0.8]) {
      const px = a.pos.x - nx * inset, pz = a.pos.z - nz * inset;
      // never onto the arena's boundary walls
      if (Math.abs(px) > X - 1 || Math.abs(pz) > Z - 1) return false;
      const roof = L.groundAt(px, pz, a.pos.y + 2.8, a.radius * 0.5);
      // his hands reach the edge: the roof is at most ~2.4m above his skates (he vaults a ledge above his head)
      if (!Number.isFinite(roof) || roof < a.pos.y - 0.3 || roof > a.pos.y + 2.4) continue;
      // room to stand up there?
      if (L.ceilingAt(px, pz, roof + 0.05) < roof + a.height * 0.9) continue;
      const t = this.time;
      a.pos = { x: px, y: roof + 0.02, z: pz };
      const tx = -(a.sv.grindNz ?? 0) * (a.sv.grindDir ?? 1), tz = (a.sv.grindNx ?? 0) * (a.sv.grindDir ?? 1);
      const along = a.vel.x * tx + a.vel.z * tz;
      a.vel = { x: -nx * 3 + tx * along * 0.6, y: 0, z: -nz * 3 + tz * along * 0.6 };
      a.grounded = true; a.lastGroundedAt = t; a.anim.landAt = t;
      a.clear('grinding'); a.sv.grindCd = t + 0.35; a.sv.climbT = 0;
      a.stats.mantles = (a.stats.mantles ?? 0) + 1;
      this.sfx('land', a.pos, a); this.fx('doublejump', a.pos, { color: a.def.glow });
      return true;
    }
    return false;
  }

  private swoopStep(a: Actor, dt: number): boolean {
    const t = this.time;
    if (a.def.id !== 'mirei' || !this.full) return false;
    const blocked = a.has('grounded', t) || a.has('root', t) || a.has('stun', t) || a.has('silence', t) || !!a.forced;
    if (!a.has('swoop', t)) {
      if (!this.pressed(a, 'swoop') || blocked || !a.ready('swoop', t)) return false;
      const tg = this.coneTarget(a, 30, 14, x => x.team === a.team && x !== a && !x.isRobot);
      if (!tg) { this.sfx('denied', a.pos, a); return false; }
      a.sv.swoopT = tg.id; a.sv.swoopStart = t; a.sv.swoopD0 = dist3(tg.center, a.center);
      a.set('swoop', t, 2.4); a.flying = false; a.grounded = false; a.lastGroundedAt = -9;
      a.stats.swoops = (a.stats.swoops ?? 0) + 1;
      this.sfx('swoop', a.center, a); this.fx('swoop', a.center, { actor: a, target: tg, color: a.def.glow });
    }
    const tg = this.actors.find(x => x.id === a.sv.swoopT);
    const end = (keep: number) => { a.clear('swoop'); a.cd.swoop = t + 1.6; a.sv.swoopEndAt = t; a.vel.x *= keep; a.vel.y *= keep; a.vel.z *= keep; };
    if (!tg || !tg.alive || blocked) { end(0.5); return false; }
    const v = { x: tg.pos.x - a.pos.x, y: tg.pos.y + tg.height * 0.35 - a.pos.y - a.height * 0.35, z: tg.pos.z - a.pos.z };
    const dist = Math.hypot(v.x, v.y, v.z) || 1e-3, dir = { x: v.x / dist, y: v.y / dist, z: v.z / dist };
    const age = t - (a.sv.swoopStart ?? t), sp = Math.min(21, 13 + age * 16);
    const prog = Math.min(1, age / Math.max(0.35, (a.sv.swoopD0 ?? 12) / 17));
    a.sv.swoopProg = prog;
    if (this.pressed(a, 'jump')) {
      // slingshot: fling onward with the swoop's momentum (more the further into the swoop)
      const k = 0.55 + 0.45 * prog;
      a.vel = { x: dir.x * sp * k, y: Math.max(0, dir.y * sp * k) + 7 * k, z: dir.z * sp * k };
      end(1); a.set('slingshot', t, 1.2); a.anim.jumpAt = t;
      this.sfx('sunhop', a.pos, a); this.fx('swoopburst', a.center, { actor: a, color: a.def.glow });
      return true;
    }
    if (this.pressed(a, 'descend')) {
      // superjump: straight up, then Angelic descent takes over while SPACE is held
      const k = 0.55 + 0.45 * prog;
      a.vel = { x: a.vel.x * 0.2, y: 10 + 7 * k, z: a.vel.z * 0.2 };
      end(1); a.set('superjump', t, 1.4); a.anim.jumpAt = t;
      this.sfx('sunhop', a.pos, a); this.fx('swoopburst', a.center, { actor: a, color: a.def.glow });
      return true;
    }
    if (dist < 1.2 + tg.radius + a.radius) {
      // arrival: flare the wings and bleed off most of the speed beside the ally
      a.vel = { x: dir.x * sp * 0.28, y: Math.max(dir.y * sp * 0.2, 0) + 1.2, z: dir.z * sp * 0.28 };
      end(1); a.set('swoopflare', t, 0.4);
      return true;
    }
    a.vel = { x: dir.x * sp, y: dir.y * sp, z: dir.z * sp };
    // skim just above the floor rather than sliding along it
    if (a.vel.y < 0.4 && a.pos.y - this.level.groundAt(a.pos.x, a.pos.z, a.pos.y + 0.5) < 0.5) a.vel.y = 0.4;
    a.grounded = false;
    void dt;
    return true;
  }

  /** Grand Dohyo: enemies caught in the ring can't step out; the rest can't step in (allies pass freely) */
  private ringClamp(a: Actor) {
    for (const z of this.zones) {
      if (z.kind !== 'dohyo' || a.team === z.team || !a.alive) continue;
      if (a.pos.y < z.y - 2 || a.pos.y > z.y + RING_H) continue;
      const dx = a.pos.x - z.x, dz = a.pos.z - z.z, d = Math.hypot(dx, dz) || 1e-3;
      const inside = (z.data?.trapped as number[] | undefined)?.includes(a.id);
      if (inside && a.has('tempo', this.time) && (a.sv.speed ?? 1) >= 1.5) {
        // COUNTER (Hibiki): an amped Tempo Rush carries trapped heroes straight through the rope wall
        z.data.trapped = (z.data.trapped as number[]).filter(id => id !== a.id);
        const h = this.actors.find(x => x.def.id === 'hibiki' && x.team === a.team && x.alive);
        if (h && !z.data.broke) { z.data.broke = 1; this.emit({ t: 'counter', actor: h, target: z.owner, text: 'Tempo Rush breaks out of the Grand Dohyo' }); }
        continue;
      }
      const lim = inside ? z.r - a.radius : z.r + a.radius;
      if (inside ? d <= lim : d >= lim) continue;
      a.pos.x = z.x + dx / d * lim; a.pos.z = z.z + dz / d * lim;
      const out = (a.vel.x * dx + a.vel.z * dz) / d;          // velocity across the wall
      if (inside ? out > 0 : out < 0) { a.vel.x -= dx / d * out; a.vel.z -= dz / d * out; }
      this.level.collide(a.pos, a.colRadius, a.colHeight);
    }
  }

  private separate() {
    // (Tomoe in her Crescent Warpath passes through bodies like a ghost)
    const list = this.actors.filter(a => a.alive && !a.has('phased', this.time) && a.forced?.kind !== 'tide');
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.pos.y > b.pos.y + b.height || b.pos.y > a.pos.y + a.height) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, rr = (a.radius + b.radius) * 0.85, d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 0.01, push = (rr - d);
      const ma = a.def.frame === 'mech' ? 3 : 1, mb = b.def.frame === 'mech' ? 3 : 1;
      const ka = mb / (ma + mb), kb = ma / (ma + mb);
      a.pos.x -= dx / d * push * ka; a.pos.z -= dz / d * push * ka;
      b.pos.x += dx / d * push * kb; b.pos.z += dz / d * push * kb;
      this.level.collide(a.pos, a.colRadius, a.colHeight); this.level.collide(b.pos, b.colRadius, b.colHeight);
    }
  }

  // ------------------------------------------------------------------ capture point
  private updatePoint(dt: number) {
    const P = this.point, t = this.time;
    if (this.winner) return;
    if (this.rules === 'control') return this.updateControl(dt);
    if (t < P.unlockAt) return;
    if (t - dt < P.unlockAt) { this.emit({ t: 'msg', text: 'THE POINT IS OPEN' }); this.sfx('announce'); }
    const [px, py, pz] = this.map.point;
    const on = { zenith: 0, umbra: 0 };
    for (const a of this.actors) if (a.alive && !a.isRobot && Math.hypot(a.pos.x - px, a.pos.z - pz) < P.r && a.pos.y > py - 1 && a.pos.y < py + 5) on[a.team]++;
    P.contested = on.zenith > 0 && on.umbra > 0;
    const solo: TeamId | null = P.contested ? null : on.zenith ? 'zenith' : on.umbra ? 'umbra' : null;
    if (solo && solo !== P.owner) {
      if (P.capTeam !== solo) { P.capture = Math.max(0, P.capture - dt * 25); if (P.capture === 0) P.capTeam = solo; }
      else P.capture = Math.min(100, P.capture + dt * (12 + 4 * Math.min(3, on[solo])));
      if (P.capture >= 100) {
        P.owner = solo; P.capture = 0; P.capTeam = null;
        this.emit({ t: 'msg', text: `${solo === 'zenith' ? 'ZENITH VANGUARD' : 'UMBRA SYNDICATE'} TOOK THE POINT`, color: solo === 'zenith' ? '#5cc8ff' : '#ff3b5c' });
        this.sfx('capture');
      }
    } else if (!solo && !P.contested) P.capture = Math.max(0, P.capture - dt * 8);
    if (P.owner && !P.contested) {
      P.progress[P.owner] = Math.min(100, P.progress[P.owner] + dt * (this.mode === 'aitest' ? 4 : 1.6));
      if (P.progress[P.owner] >= 100 && !(on[P.owner === 'zenith' ? 'umbra' : 'zenith'] > 0)) this.end(P.owner);
    }
    if (t > this.timeLimit) this.end(P.progress.zenith >= P.progress.umbra ? 'zenith' : 'umbra');
  }

  /** Overwatch Control: the point unlocks, a team takes it (up to three players speed the capture), the holder climbs
   *  to 100% while the point is theirs and uncontested; at 99% an enemy on the point forces overtime. First to
   *  ROUNDS_TO_WIN rounds; between rounds everyone is reset to spawn and the point goes neutral. */
  private updateControl(dt: number) {
    const P = this.point, C = this.control, t = this.time;
    if (C.phase === 'intermission') {
      if (t >= C.phaseEnd) {
        C.round++; C.phase = 'fight'; C.overtime = false;
        P.owner = null; P.capture = 0; P.capTeam = null; P.progress = { zenith: 0, umbra: 0 }; P.contested = false;
        P.unlockAt = t + 10;
        this.emit({ t: 'msg', text: `ROUND ${C.round}` }); this.sfx('announce');
      }
      return;
    }
    if (t < P.unlockAt) return;
    if (t - dt < P.unlockAt) { this.emit({ t: 'msg', text: 'THE POINT IS OPEN' }); this.sfx('announce'); }
    const [px, py, pz] = this.map.point;
    const on = { zenith: 0, umbra: 0 };
    for (const a of this.actors) if (a.alive && !a.isRobot && Math.hypot(a.pos.x - px, a.pos.z - pz) < P.r && a.pos.y > py - 1 && a.pos.y < py + 5) { on[a.team]++; a.objTime += dt; }
    P.contested = on.zenith > 0 && on.umbra > 0;
    const solo: TeamId | null = P.contested ? null : on.zenith ? 'zenith' : on.umbra ? 'umbra' : null;
    if (solo && solo !== P.owner) {
      if (P.capTeam !== solo) { P.capture = Math.max(0, P.capture - dt * 25); if (P.capture === 0) P.capTeam = solo; }
      else P.capture = Math.min(100, P.capture + dt * 11 * (1 + 0.5 * (Math.min(3, on[solo]) - 1)));
      if (P.capture >= 100) {
        P.owner = solo; P.capture = 0; P.capTeam = null;
        this.emit({ t: 'msg', text: `${solo === 'zenith' ? 'ZENITH VANGUARD' : 'UMBRA SYNDICATE'} TOOK THE POINT`, color: solo === 'zenith' ? '#5cc8ff' : '#ff3b5c' });
        this.sfx('capture');
      }
    } else if (!solo && !P.contested) P.capture = Math.max(0, P.capture - dt * 8);
    if (P.owner) {
      const foe: TeamId = P.owner === 'zenith' ? 'umbra' : 'zenith';
      if (!P.contested) P.progress[P.owner] = Math.min(100, P.progress[P.owner] + dt * HOLD_RATE);
      // overtime: the round can't be won while an enemy stands on the point
      C.overtime = P.progress[P.owner] >= 99 && on[foe] > 0;
      if (C.overtime) P.progress[P.owner] = Math.min(P.progress[P.owner], 99);
      if (P.progress[P.owner] >= 100) {
        const w = P.owner;
        C.wins[w]++;
        this.emit({ t: 'msg', text: `${w === 'zenith' ? 'ZENITH VANGUARD' : 'UMBRA SYNDICATE'} WINS ROUND ${C.round}`, color: w === 'zenith' ? '#5cc8ff' : '#ff3b5c' });
        this.sfx('capture');
        if (C.wins[w] >= ROUNDS_TO_WIN) return this.end(w);
        C.phase = 'intermission'; C.phaseEnd = t + 7;
        // everyone back to spawn for the next round (ult charge is kept)
        this.after(3, () => { for (const a of this.actors) if (!a.isRobot) { const u = a.ult; this.respawn(a, true); a.ult = u; } });
      }
    }
    if (t > this.timeLimit) this.end(C.wins.zenith !== C.wins.umbra ? (C.wins.zenith > C.wins.umbra ? 'zenith' : 'umbra') : P.progress.zenith >= P.progress.umbra ? 'zenith' : 'umbra');
  }

  end(w: TeamId) {
    if (this.winner) return;
    this.winner = w;
    this.emit({ t: 'msg', text: w === 'zenith' ? 'ZENITH VANGUARD WINS' : 'UMBRA SYNDICATE WINS', color: w === 'zenith' ? '#5cc8ff' : '#ff3b5c' });
    this.sfx('victory');
  }
}

// ------------------------------------------------------------------ math
export const dist3 = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const norm = (v: V3): V3 => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
export const headR = (x: Actor) => x.height * (x.def.frame === 'mech' ? 0.1 : 0.085) + 0.04;
export const headC = (x: Actor): V3 => ({ x: x.pos.x, y: x.pos.y + x.height - headR(x) * 1.1, z: x.pos.z });

export function raySphere(o: V3, d: V3, c: V3, r: number): number | null {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : (cc < 0 ? 0 : null);
}

/** closest points between segments p1q1 and p2q2 (Ericson). s is the param along the first segment. */
export function segSeg(p1: V3, q1: V3, p2: V3, q2: V3) {
  const d1 = { x: q1.x - p1.x, y: q1.y - p1.y, z: q1.z - p1.z }, d2 = { x: q2.x - p2.x, y: q2.y - p2.y, z: q2.z - p2.z };
  const r = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  if (a <= 1e-9 && e <= 1e-9) { s = t = 0; }
  else if (a <= 1e-9) { t = clamp01(f / e); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-9) { s = clamp01(-c / a); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den !== 0 ? clamp01((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const c1 = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.z + d1.z * s }, c2 = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, z: p2.z + d2.z * t };
  return { d2: (c1.x - c2.x) ** 2 + (c1.y - c2.y) ** 2 + (c1.z - c2.z) ** 2, s, t };
}
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
