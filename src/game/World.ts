// Deterministic fixed-step simulation: movement, combat, projectiles, zones, capture point.
// Rendering, audio and HUD only read state and drain `events`.
import { HERO, type HeroDef, type TeamId, isAbility } from '../data/heroes';
import { MAP, type MapDef } from '../data/maps';
import { Level, STEP, type V3 } from '../engine/Physics';
import { Actor } from './Actor';
import { ROBOTS } from '../data/robots';
import { castAbility, tickAbilities } from './abilities';
import { updateWeapons } from './weapons';

/** Tenkai-Oh's ult: 3.3m x 2.2 = 7.3m, four times an average hero's height */
export const TITAN_SCALE = 2.2;

export const G = 24;
export type Mode = 'training' | 'skirmish' | 'spectate' | 'aitest' | 'campaign' | 'gallery';

export type GameEvent =
  | { t: 'sfx'; id: string; pos?: V3; vol?: number; actor?: Actor }
  | { t: 'fx'; kind: string; pos: V3; to?: V3; r?: number; color?: string; dur?: number; side?: number; actor?: Actor; target?: Actor }
  | { t: 'dmg'; src: Actor | null; tgt: Actor; amt: number; crit: boolean; heal?: boolean; pos: V3 }
  | { t: 'kill'; src: Actor | null; tgt: Actor }
  | { t: 'cast'; actor: Actor; id: string; name: string }
  | { t: 'counter'; actor: Actor; target: Actor; text: string }
  | { t: 'msg'; text: string; color?: string };

export interface Proj {
  id: number; owner: Actor; team: TeamId; pos: V3; vel: V3; dmg: number; splash: number; heal: boolean;
  fx: string; life: number; r: number; grav: number; special?: string; crit: number; hits: Set<number>; pierce?: boolean; homing?: number; born: number;
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
  prevIn = new Map<number, { a1: boolean; a2: boolean; ult: boolean; alt: boolean; jump: boolean; fire: boolean; melee: boolean }>();
  attackers = new Map<number, Map<number, number>>();
  // capture point
  point = { owner: null as TeamId | null, capture: 0, capTeam: null as TeamId | null, progress: { zenith: 0, umbra: 0 }, contested: false, unlockAt: 8, r: 6 };
  winner: TeamId | null = null;
  timeLimit = 360;
  /** campaign hooks: enemy/boss definitions and the encounter director */
  extraDefs: Record<string, HeroDef> = {};
  director: { update(dt: number): void; onKill?(a: Actor, src: Actor | null): void } | null = null;
  stats = { counters: 0, casts: {} as Record<string, number>, sfx: {} as Record<string, number>, fx: {} as Record<string, number> };

  constructor(mapId: string | MapDef, public mode: Mode) {
    this.map = typeof mapId === 'string' ? MAP[mapId] : mapId;
    this.level = new Level(this.map);
  }

  // ------------------------------------------------------------------ setup
  addHero(heroId: string, team?: TeamId): Actor {
    const def: HeroDef = HERO[heroId] ?? ROBOTS[heroId] ?? this.extraDefs[heroId];
    const a = new Actor(def, team ?? def.team);
    a.isRobot = !!ROBOTS[heroId];
    a.spawn = this.map.spawns[a.team];
    this.actors.push(a);
    this.respawn(a, true);
    return a;
  }

  respawn(a: Actor, first = false) {
    const [sx, sz] = a.spawn;
    const i = this.actors.filter(o => o.team === a.team).indexOf(a);
    const ang = i * 1.3;
    a.pos = { x: sx + Math.cos(ang) * 2.5 * (first ? 1 : Math.random() + 0.5), y: 0, z: sz + Math.sin(ang) * 3 };
    a.pos.y = Math.max(0, this.level.groundAt(a.pos.x, a.pos.z, 30));
    if (a.pos.y === -Infinity) a.pos.y = 0;
    if (a.def.frame === 'drone') a.pos.y += 3;
    a.vel = { x: 0, y: 0, z: 0 };
    a.yaw = a.team === 'zenith' ? Math.PI / 2 : -Math.PI / 2;
    if (a.isRobot) a.yaw = -Math.PI / 2;
    a.pitch = 0;
    a.hp = a.def.hp; a.maxArmor = a.def.armor; a.armor = a.def.armor; a.scale = 1;
    a.shields = []; a.st = {}; a.sv = {}; a.src = {}; a.forced = null;
    a.alive = true; a.respawnAt = 0; a.flight = 100; a.flying = false;
    a.ammo = 'ammo' in a.def.primary && a.def.primary.ammo ? a.def.primary.ammo : 0; a.reloadUntil = 0;
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

  muzzle(a: Actor): V3 {
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
  damage(src: Actor | null, tgt: Actor, amount: number, o: { crit?: boolean; kind?: string; shieldMult?: number; ability?: string; noLifesteal?: boolean } = {}): number {
    const t = this.time;
    if (!tgt.alive || amount <= 0) return 0;
    if (src && src.team === tgt.team && src !== tgt) return 0;
    if (tgt.has('phased', t) || tgt.has('spawnprot', t)) return 0;
    if (tgt.has('parry', t) && o.kind === 'melee' && src) {
      src.set('stun', t, 1);
      this.sfx('parry', tgt.center); this.fx('parry', tgt.center, { color: '#8ad8ff', actor: tgt });
      if (src.def.id === 'enra') this.emit({ t: 'counter', actor: tgt, target: src, text: 'Thunder Parry stuns Enra' });
      return 0;
    }
    let dmg = amount;
    if (src?.has('dmgamp', t)) dmg *= 1.3;
    if (src?.has('titan', t)) dmg *= 1.25;
    if (tgt.has('vuln', t)) dmg *= 1.3;
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
      if (s.amt <= 0 && sm > 1 && s.kind === 'wish' && src?.def.id === 'gorgoth') this.emit({ t: 'counter', actor: src, target: tgt, text: 'Null Lance shatters Wish Barrier' });
    }
    tgt.shields = tgt.shields.filter(s => s.amt > 0.5);
    if (dmg > 0 && tgt.armor > 0) {
      const eff = Math.max(dmg * 0.7, Math.min(dmg, dmg - 5));
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
      tgt.lastHitBy = src; tgt.lastHitAt = t;
      let m = this.attackers.get(tgt.id); if (!m) this.attackers.set(tgt.id, m = new Map());
      m.set(src.id, t);
      src.dmgDone += dealt;
      src.ult = Math.min(src.def.ult.charge, src.ult + dealt);
      if (src.def.id === 'yuzu') tgt.set('marked', t, 3);
      if (src.def.id === 'gorgoth') src.armor = Math.min(src.maxArmor, src.armor + dealt * 0.05);
      if (!o.noLifesteal) {
        let ls = src.has('lifesteal', t) ? (src.sv.lifesteal ?? 0.3) : 0;
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

  heal(src: Actor, tgt: Actor, amount: number, quiet = false): number {
    if (!tgt.alive || amount <= 0 || tgt.team !== src.team) return 0;
    let amt = amount;
    if (tgt.has('antiheal', this.time)) amt *= 0.2;
    const room = tgt.def.hp - tgt.hp;
    const h = Math.min(room, amt);
    if (h <= 0) return 0;
    tgt.hp += h;
    if (src !== tgt) {
      src.healDone += h; src.ult = Math.min(src.def.ult.charge, src.ult + h);
      if (src.def.id === 'kaien' && src.hp < src.def.hp) src.hp = Math.min(src.def.hp, src.hp + h * 0.25);
    }
    if (!quiet || h > 20) this.emit({ t: 'dmg', src, tgt, amt: h, crit: false, heal: true, pos: tgt.center });
    return h;
  }

  shield(tgt: Actor, amt: number, dur: number, kind: string) {
    tgt.shields = tgt.shields.filter(s => s.kind !== kind);
    tgt.shields.push({ amt, until: this.time + dur, kind });
  }

  kill(tgt: Actor, src: Actor | null) {
    if (!tgt.alive) return;
    tgt.alive = false; tgt.deathAt = this.time; tgt.deaths++;
    tgt.respawnAt = tgt.noRespawn ? 0 : this.time + (tgt.isRobot ? 3 : this.mode === 'aitest' ? 4 : this.mode === 'campaign' ? 8 : 6);
    tgt.forced = null; tgt.flying = false; tgt.barrier.up = false; tgt.beamOn = false; tgt.flameOn = false;
    const killer = src && src !== tgt ? src : (tgt.lastHitBy && this.time - tgt.lastHitAt < 6 ? tgt.lastHitBy : null);
    if (killer) {
      killer.kills++;
      if (killer.has('judgment', this.time)) killer.cd.flashstep = 0;
    }
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
    owner.barrier.hp -= dmg;
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
    for (const a of this.actors) if (a.alive && a.controller) a.controller.think(dt);
    for (const a of this.actors) this.updateActor(a, dt);
    this.separate();
    this.projs = this.projs.filter(p => this.stepProj(p, dt));
    tickAbilities(this, dt);
    this.zones = this.zones.filter(z => z.until > t);
    if (this.director) this.director.update(dt);
    else if (this.mode !== 'training') this.updatePoint(dt);
  }

  pressed(a: Actor, k: 'a1' | 'a2' | 'ult' | 'alt' | 'jump' | 'fire' | 'melee') {
    const p = this.prevIn.get(a.id);
    return a.input[k] && !(p && p[k]);
  }

  private updateActor(a: Actor, dt: number) {
    const t = this.time;
    if (!a.alive) {
      if (a.respawnAt && t >= a.respawnAt && this.winner === null) this.respawn(a);
      return;
    }
    // ---- statuses
    const per = (k: string) => a.has(k, t);
    if (per('brand')) this.damage(a.src.brand ?? null, a, 12 * dt, { kind: 'dot', noLifesteal: true });
    if (per('bleed')) this.damage(a.src.bleed ?? null, a, (a.sv.bleed ?? 33) * dt, { kind: 'dot', noLifesteal: true });
    if (per('hot') && a.src.hot) this.heal(a.src.hot, a, (a.sv.hot ?? 0) * dt, true);
    if (per('linked') && a.src.linked) this.heal(a.src.linked, a, 25 * dt, true);
    if (a.def.id === 'enra' && t - a.lastDamagedAt > 3 && a.hp < a.def.hp) a.hp = Math.min(a.def.hp, a.hp + 12 * dt);
    if (a.isRobot && t - a.lastDamagedAt > 4) a.hp = Math.min(a.def.hp, a.hp + 40 * dt);
    a.shields = a.shields.filter(s => s.until > t);
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
    a.ult = Math.min(a.def.ult.charge, a.ult + (this.mode === 'aitest' ? 30 : 5) * dt);
    if (a.barrier.max && !a.barrier.up && t > a.barrier.regenAt && t > a.barrier.brokenUntil) a.barrier.hp = Math.min(a.barrier.max, a.barrier.hp + 150 * dt);
    if (a.has('stealth', t) && (a.has('revealed', t) || a.has('sealed', t))) {
      a.clear('stealth');
      const k = this.actors.find(x => x.def.id === 'kaien' && x.team !== a.team);
      if (a.def.id === 'kagemaru' && k && a.has('sealed', t)) this.emit({ t: 'counter', actor: k, target: a, text: 'Warding Seal tears away the Veil of Night' });
    }
    this.move(a, dt);
    if (!a.alive) return;
    const stunned = a.has('stun', t);
    if (!stunned && !a.has('phased', t)) {
      updateWeapons(this, a, dt);
      const silenced = a.has('silence', t);
      if (!silenced) {
        if (this.pressed(a, 'a1')) castAbility(this, a, a.def.ability1.id, 'a1');
        if (this.pressed(a, 'a2')) castAbility(this, a, a.def.ability2.id, 'a2');
        if (this.pressed(a, 'ult') && a.ult >= a.def.ult.charge) castAbility(this, a, a.def.ult.id, 'ult');
        const S = a.def.secondary;
        if (isAbility(S) && !S.hold && this.pressed(a, 'alt')) castAbility(this, a, S.id, 'alt');
      }
    } else { a.barrier.up = false; a.beamOn = false; a.flameOn = false; a.charging = false; }
    const i = a.input;
    this.prevIn.set(a.id, { a1: i.a1, a2: i.a2, ult: i.ult, alt: i.alt, jump: i.jump, fire: i.fire, melee: i.melee });
  }

  /** movement integration only (also used by co-op clients to predict their own hero) */
  move(a: Actor, dt: number) {
    const t = this.time, d = a.def, inp = a.input, L = this.level;
    a.yaw = inp.yaw; a.pitch = Math.max(-1.45, Math.min(1.45, inp.pitch));
    const wasGrounded = a.grounded;
    // colossi can't be dragged, pulled or knocked around by heroes
    if (a.isBoss && a.forced && (a.forced.kind === 'pull' || a.forced.kind === 'knock')) a.forced = null;
    if (a.forced) {
      const f = a.forced;
      if (t >= f.until) { a.forced = null; f.onEnd?.(); a.vel.x *= 0.3; a.vel.z *= 0.3; if (f.ignoreGravity) a.vel.y = Math.min(a.vel.y, 0); }
      else { a.vel = { x: f.vx, y: f.ignoreGravity ? f.vy : a.vel.y - G * dt, z: f.vz }; }
    }
    if (!a.forced) {
      let spd = d.speed;
      if (a.has('slow', t)) spd *= 0.8;
      if (a.has('speed', t)) spd *= a.sv.speed ?? 1.25;
      if (a.has('titan', t)) spd *= 1.2;
      if (a.has('judgment', t) || a.has('stealth', t)) spd *= 1.3;
      if (a.charging) spd *= 0.7;
      if (a.barrier.up) spd *= 0.65;
      if (a.flameOn) spd *= 0.9;
      const rooted = a.has('root', t) || a.has('stun', t);
      let mx = inp.mx, mz = inp.mz;
      const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
      if (mz < 0) mz *= 0.9;
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), rx = -Math.cos(a.yaw), rz = Math.sin(a.yaw);
      let wx = (fx * mz + rx * mx) * spd, wz = (fz * mz + rz * mx) * spd;
      if (rooted) { wx = 0; wz = 0; }
      // flight
      const canFly = (d.frame === 'flyer' || d.frame === 'drone') && !a.has('grounded', t) && !rooted;
      if (d.frame === 'drone') a.flying = true;
      else if (canFly && inp.jumpHeld && a.flight > 5 && (!a.grounded || !this.pressed(a, 'jump'))) a.flying = true;
      if (!canFly || a.flight <= 0) a.flying = false;
      if (a.flying && d.frame !== 'drone') {
        const target = inp.jumpHeld ? 5.5 : inp.descend ? -7 : -1.1;
        a.vel.y += (target - a.vel.y) * Math.min(1, dt * 5);
        a.flight -= (inp.jumpHeld ? 15 : 4.5) * dt;
        if (a.grounded && !inp.jumpHeld) a.flying = false;
      } else if (d.frame === 'drone') {
        // over the void groundAt is -Infinity: hold the altitude of the last solid ground instead of diving forever
        const gnd = L.groundAt(a.pos.x, a.pos.z, a.pos.y);
        if (Number.isFinite(gnd)) a.sv.hoverGround = gnd;
        const want = a.sv.hoverY ?? ((a.sv.hoverGround ?? a.pos.y - 3.2) + 3.2);
        a.vel.y += ((want - a.pos.y) * 2 - a.vel.y) * Math.min(1, dt * 3);
      }
      const k = a.grounded ? 14 : a.flying ? 4 : 2.5;
      a.vel.x += (wx - a.vel.x) * Math.min(1, dt * k);
      a.vel.z += (wz - a.vel.z) * Math.min(1, dt * k);
      if (this.pressed(a, 'jump') && !rooted) {
        if (a.grounded || t - a.lastGroundedAt < 0.1) {
          a.vel.y = d.frame === 'mech' ? 8 : 8.6; a.grounded = false; a.anim.jumpAt = t; a.lastGroundedAt = -9;
          a.airJumps = d.id === 'raijin' ? 1 : 0;
          this.sfx(d.frame === 'mech' ? 'mechjump' : 'jump', a.pos, a);
        } else if (a.airJumps > 0) {
          a.airJumps--; a.vel.y = 8.2; a.anim.jumpAt = t; this.sfx('doublejump', a.pos, a); this.fx('doublejump', a.pos, { color: d.glow });
        }
      }
      if (!a.flying && d.frame !== 'drone') a.vel.y -= G * dt * (a.has('glide', t) && a.vel.y < 0 ? 0.18 : 1);
      // Mirei's angelic descent: out of flight energy, holding SPACE floats her down slowly instead of dropping
      if (d.id === 'mirei' && !a.flying && !a.grounded && inp.jumpHeld && a.vel.y < -2.2 && !a.forced) { a.vel.y = -2.2; a.set('angelglide', t, 0.15); }
    }
    // integrate with sub-steps so fast dashes don't tunnel
    // a non-finite velocity would make the sub-step count infinite and freeze the whole simulation
    if (!Number.isFinite(a.vel.x + a.vel.y + a.vel.z)) a.vel = { x: 0, y: 0, z: 0 };
    const sp = Math.hypot(a.vel.x, a.vel.y, a.vel.z) * dt;
    const n = Math.min(64, Math.max(1, Math.ceil(sp / 0.3)));
    let hitWall = false;
    const y0 = a.pos.y, x0 = a.pos.x, z0 = a.pos.z;
    for (let i = 0; i < n; i++) {
      a.pos.x += a.vel.x * dt / n; a.pos.y += a.vel.y * dt / n; a.pos.z += a.vel.z * dt / n;
      if (L.collide(a.pos, a.colRadius, a.colHeight)) hitWall = true;
    }
    if (hitWall && a.forced?.kind === 'abysscharge') a.forced.until = t;
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

  private separate() {
    const list = this.actors.filter(a => a.alive && !a.has('phased', this.time));
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
