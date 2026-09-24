// Campaign director: encounter triggers, waves, checkpoints, boss fights (telegraphed attack patterns), win / wipe.
// Runs inside World.step on the host (solo or co-op); clients only see its results through snapshots.
import type { V3 } from '../engine/Physics';
import type { Actor } from '../game/Actor';
import { dist3, norm, type World } from '../game/World';
import type { Nav } from '../ai/Nav';
import { BOSSES, ENEMIES, type BossDef, type Level } from './data';

type Tele = { shape: 'circle' | 'line'; x: number; z: number; x2?: number; z2?: number; r: number; dmg: number; knock: number; fx: string; color: string };

export class Director {
  state: 'explore' | 'fight' | 'boss' | 'victory' | 'wipe' = 'explore';
  enc = -1; wave = -1; cleared = new Set<number>();
  enemies: Actor[] = [];
  boss: Actor | null = null;
  phase2 = false;
  objective = 'Advance to the first platform';
  nextWaveAt = 0; wipeAt = 0; bossIntroAt = -1;
  events: { t: string; [k: string]: any }[] = [];      // story / cinematic cues for the client
  private brains = new Map<number, MinionBrain | BossBrain>();

  constructor(public w: World, public level: Level, public nav: Nav, public players: () => number) {
    for (const [k, d] of Object.entries({ ...ENEMIES, ...BOSSES })) w.extraDefs[k] = d;
  }

  get heroes() { return this.w.actors.filter(a => a.team === 'zenith'); }
  scale() { return Math.max(1, this.players()); }

  spawn(id: string, x: number, z: number): Actor {
    const w = this.w;
    const a = w.addHero(id, 'umbra');
    a.noRespawn = true;
    a.spawn = [x, z];
    const g = w.level.groundAt(x, z, 40);
    a.pos = { x, y: g > -Infinity ? g : 0, z };
    if (a.def.frame === 'drone') a.pos.y += 3;
    a.yaw = -Math.PI / 2;
    const b = BOSSES[id] as BossDef | undefined;
    if (b) {
      const hp = Math.round(b.hp * (1 + b.hpPerPlayer * (this.scale() - 1)));
      a.hp = hp; (a.def as any) = { ...a.def, hp };
      a.isBoss = true;
      const br = new BossBrain(this, a, b);
      this.brains.set(a.id, br); a.controller = br;
    } else {
      if (id === 'minion_sentinel') a.barrier = { hp: 600, max: 600, up: false, regenAt: 0, brokenUntil: 0 };
      const br = new MinionBrain(this, a);
      this.brains.set(a.id, br); a.controller = br;
    }
    w.fx('spawn', a.pos, { color: a.def.glow, actor: a }); w.sfx('pad', a.pos);
    this.enemies.push(a);
    return a;
  }

  private startWave(e: number, wv: number) {
    const E = this.level.encounters[e];
    const waves = E.waves[wv];
    const extra = this.scale() - 1;
    let i = 0;
    for (const [id, n] of waves) {
      const count = n + Math.floor(extra * n * 0.5);
      for (let k = 0; k < count; k++, i++) {
        const ang = i * 2.39996 + wv, r = 6 + (i % 3) * 3;
        this.spawn(id, E.at[0] + 8 + Math.cos(ang) * r, E.at[1] + Math.sin(ang) * r);
      }
    }
    this.w.emit({ t: 'msg', text: wv === 0 ? 'HOSTILES INBOUND' : `WAVE ${wv + 1}`, color: '#c77dff' });
    this.w.sfx('announce');
    this.objective = `Destroy the Star-Forger's robots (wave ${wv + 1}/${E.waves.length})`;
  }

  update(dt: number) {
    const w = this.w, t = w.time;
    for (const z of w.zones) if (z.kind === 'tele' && t >= z.data.fireAt && !z.data.done) this.resolve(z.data as Tele & { fireAt: number; done: boolean }, z.owner), z.data.done = true, z.until = t + 0.25;
    this.enemies = this.enemies.filter(e => e.alive || t - e.deathAt < 4);
    w.actors = w.actors.filter(a => !(a.noRespawn && !a.alive && t - a.deathAt > 4));
    const heroes = this.heroes, alive = heroes.filter(h => h.alive);
    // squad wipe: everyone down at once -> regroup at the checkpoint
    if (heroes.length && !alive.length && this.state !== 'wipe' && this.state !== 'victory') {
      this.state = 'wipe'; this.wipeAt = t + 4;
      w.emit({ t: 'msg', text: 'SQUAD DOWN - REGROUPING', color: '#ff3b5c' });
    }
    if (this.state === 'wipe') {
      if (t >= this.wipeAt) {
        for (const h of heroes) { h.respawnAt = 0; w.respawn(h); }
        this.state = this.boss?.alive ? 'boss' : this.enemies.some(e => e.alive) ? 'fight' : 'explore';
      }
      return;
    }
    if (this.state === 'explore') {
      this.level.encounters.forEach((E, i) => {
        if (this.cleared.has(i) || this.state !== 'explore') return;
        if (alive.some(h => Math.hypot(h.pos.x - E.at[0], h.pos.z - E.at[1]) < E.r + 6)) { this.enc = i; this.wave = 0; this.state = 'fight'; this.startWave(i, 0); }
      });
      const [ax, az] = this.level.arena;
      if (this.state === 'explore' && this.cleared.size === this.level.encounters.length && alive.some(h => Math.hypot(h.pos.x - ax, h.pos.z - az) < 26)) this.startBoss(this.level.boss);
      if (this.state === 'explore') this.objective = this.cleared.size === this.level.encounters.length ? `Enter the arena - ${BOSSES[this.level.boss].name} awaits` : 'Advance - use the jump pads';
    } else if (this.state === 'fight') {
      if (!this.enemies.some(e => e.alive)) {
        if (!this.nextWaveAt) this.nextWaveAt = t + 2.5;
        else if (t >= this.nextWaveAt) {
          this.nextWaveAt = 0;
          const E = this.level.encounters[this.enc];
          if (this.wave + 1 < E.waves.length) { this.wave++; this.startWave(this.enc, this.wave); }
          else {
            this.cleared.add(this.enc); this.state = 'explore';
            for (const h of heroes) h.spawn = [E.at[0], E.at[1]];
            w.emit({ t: 'msg', text: 'AREA SECURED - CHECKPOINT', color: '#5cc8ff' }); w.sfx('capture');
            for (const h of alive) w.heal(h, h, h.maxHp);
          }
        }
      }
    } else if (this.state === 'boss') {
      if (this.boss && !this.boss.alive) {
        if (this.level.boss === 'boss_genesis' && !this.phase2) {
          // phase two: the Star-Forger himself steps out of the wreck
          this.phase2 = true;
          this.events.push({ t: 'bossintro', id: 'qelvaris' });
          w.emit({ t: 'msg', text: "QEL'VARIS EMERGES FROM THE WRECKAGE", color: '#ffd24a' });
          this.boss = this.spawn('qelvaris', this.boss.pos.x - 6, this.boss.pos.z);
          this.bossIntroAt = t;
        } else {
          this.state = 'victory'; this.objective = 'Victory';
          for (const e of this.enemies) if (e.alive) w.kill(e, null);
          w.end('zenith');
          this.events.push({ t: 'outro' });
        }
      }
    }
  }

  startBoss(id: string) {
    const [ax, az] = this.level.arena;
    this.boss = this.spawn(id, ax + 18, az);
    this.state = 'boss'; this.bossIntroAt = this.w.time;
    this.objective = `Destroy ${BOSSES[id].name} - aim for ${BOSSES[id].weak}`;
    this.events.push({ t: 'bossintro', id });
    this.w.emit({ t: 'msg', text: `${BOSSES[id].name} - ${BOSSES[id].title}`, color: BOSSES[id].glow });
    this.w.sfx('ultcall'); this.w.sfx('mechdown');
    for (const h of this.heroes) h.spawn = [ax - 26, az];
  }

  onKill(a: Actor) { this.brains.delete(a.id); }

  /** where the squad should head next (used by AI companions when no human is leading) */
  waypoint(): V3 {
    const w = this.w;
    const next = this.level.encounters.findIndex((_, i) => !this.cleared.has(i));
    let x: number, z: number;
    if (this.state === 'boss' && this.boss) { x = this.boss.pos.x - 10; z = this.boss.pos.z; }
    else if (this.state === 'fight') { [x, z] = this.level.encounters[this.enc].at; x += 4; }
    else if (next >= 0) [x, z] = this.level.encounters[next].at;
    else [x, z] = this.level.arena;
    return { x, y: Math.max(0, w.level.groundAt(x, z, 20)), z };
  }

  // ------------------------------------------------------------------ telegraphed damage
  tele(owner: Actor, tl: Tele, delay: number) {
    const w = this.w;
    w.zones.push({ id: Math.floor(Math.random() * 1e9), kind: 'tele', owner, team: owner.team, x: tl.x, y: w.level.groundAt(tl.x, tl.z, owner.pos.y + 20), z: tl.z, r: tl.r, born: w.time, until: w.time + delay + 0.3, next: 1e9, data: { ...tl, fireAt: w.time + delay, done: false } });
  }
  private resolve(tl: Tele, owner: Actor) {
    const w = this.w;
    for (const h of this.heroes) {
      if (!h.alive) continue;
      let hit = false;
      if (tl.shape === 'circle') hit = Math.hypot(h.pos.x - tl.x, h.pos.z - tl.z) < tl.r + h.radius * 0.5;
      else {
        const ax = tl.x, az = tl.z, bx = tl.x2!, bz = tl.z2!;
        const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
        const k = Math.max(0, Math.min(1, ((h.pos.x - ax) * vx + (h.pos.z - az) * vz) / L2));
        hit = Math.hypot(h.pos.x - (ax + vx * k), h.pos.z - (az + vz * k)) < tl.r + h.radius * 0.5;
      }
      if (hit && h.pos.y - w.level.groundAt(h.pos.x, h.pos.z, h.pos.y + 1) < 2.2) {
        w.damage(owner, h, tl.dmg, { kind: 'ability' });
        if (tl.knock && h.def.frame !== 'mech' && !h.has('ccimmune', w.time)) {
          const d = norm({ x: h.pos.x - tl.x, y: 0, z: h.pos.z - tl.z });
          h.forced = { vx: d.x * tl.knock, vy: 7, vz: d.z * tl.knock, until: w.time + 0.3, kind: 'knock' };
        }
      }
    }
    const p = { x: tl.x, y: w.level.groundAt(tl.x, tl.z, 40), z: tl.z };
    w.fx(tl.fx, p, { r: tl.r, color: tl.color }); w.sfx(tl.fx === 'slam' ? 'slam' : 'boom', p);
  }
}

// ======================================================================== minions
class MinionBrain {
  target: Actor | null = null; path: V3[] = []; repath = 0; nextThink = 0;
  constructor(public d: Director, public a: Actor) {}
  think(dt: number) { minionThink(this, dt); }
}

function minionThink(b: MinionBrain, dt: number) {
  const { d, a } = b, w = d.w, t = w.time, i = a.input;
  i.fire = false; i.alt = false; i.jump = false; i.jumpHeld = false;
  if (t >= b.nextThink) {
    b.nextThink = t + 0.25;
    const heroes = w.actors.filter(h => h.alive && h.team === 'zenith');
    b.target = heroes.filter(h => dist3(h.pos, a.pos) < 60).sort((p, q) => dist3(p.pos, a.pos) - dist3(q.pos, a.pos))[0] ?? null;
    if (b.target && a.def.frame !== 'drone' && t >= b.repath) { b.repath = t + 1; b.path = d.nav.find(a.pos, b.target.pos) ?? []; }
  }
  const tg = b.target;
  if (!tg) { i.mx = i.mz = 0; return; }
  const c = tg.center, e = a.eye;
  i.yaw = Math.atan2(c.x - e.x, c.z - e.z);
  i.pitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z)) + (Math.random() - 0.5) * 0.06;
  const dd = dist3(tg.pos, a.pos);
  const to = { x: (tg.pos.x - a.pos.x) / (dd || 1), z: (tg.pos.z - a.pos.z) / (dd || 1) };
  const id = a.def.id;
  const steer = (dir: { x: number; z: number }) => {
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), rx = -Math.cos(a.yaw), rz = Math.sin(a.yaw);
    i.mz = dir.x * fx + dir.z * fz; i.mx = dir.x * rx + dir.z * rz;
  };
  const follow = () => {
    while (b.path.length && Math.hypot(b.path[0].x - a.pos.x, b.path[0].z - a.pos.z) < 0.8) b.path.shift();
    const wp = b.path[0] ?? tg.pos, l = Math.hypot(wp.x - a.pos.x, wp.z - a.pos.z) || 1;
    steer({ x: (wp.x - a.pos.x) / l, z: (wp.z - a.pos.z) / l });
  };
  const vis = w.visible(a, tg);
  if (id === 'minion_lancer') {
    if (dd > 2.6) follow(); else steer({ x: 0, z: 0 });
    i.fire = dd < 3.6 && vis;
  } else if (id === 'minion_sentinel') {
    if (dd > 16) follow(); else steer({ x: -to.z * 0.4, z: to.x * 0.4 });
    const cyc = (t + a.id) % 5;
    i.alt = false;
    a.barrier.up = cyc < 2.8 && a.barrier.hp > 50;
    i.fire = !a.barrier.up && vis && dd < 40;
  } else if (id === 'minion_swarmer') {
    const ang = t * 0.9 + a.id;
    const gx = tg.pos.x + Math.cos(ang) * 8, gz = tg.pos.z + Math.sin(ang) * 8;
    const l = Math.hypot(gx - a.pos.x, gz - a.pos.z) || 1;
    steer({ x: (gx - a.pos.x) / l, z: (gz - a.pos.z) / l });
    a.sv.hoverY = tg.pos.y + 4 + Math.sin(t * 2 + a.id) * 1.2;
    i.fire = vis && Math.sin(t * 1.3 + a.id) > -0.3;
  } else if (id === 'minion_bomber') {
    steer(to);
    a.sv.hoverY = tg.pos.y + 1.2;
    if (dd < 2.4) {
      for (const h of w.actors) if (h.alive && h.team !== a.team && dist3(h.pos, a.pos) < 4.5) w.damage(a, h, 55, { kind: 'splash' });
      w.fx('burst', a.center, { r: 4, color: '#ff2d55' }); w.sfx('boom', a.center);
      w.kill(a, null);
    }
  }
  void dt;
}

// ======================================================================== bosses
class BossBrain {
  nextAttack = 3; target: Actor | null = null; busyUntil = 0; nextThink = 0;
  sweep: { t0: number; dur: number; from: number; to: number; len: number } | null = null;
  beam: { until: number; tg: Actor } | null = null;
  shock: { t0: number; hit: Set<number> } | null = null;
  submerged = false;
  constructor(public d: Director, public a: Actor, public def: BossDef) {
    a.sv.hoverY = a.pos.y + (def.frame === 'drone' ? 7 : 0);
  }
  think(dt: number) { bossThink(this, dt); }
}

function bossThink(b: BossBrain, dt: number) {
  const { d, a, def } = b, w = d.w, t = w.time, i = a.input;
  i.fire = false; i.a1 = false;
  const heroes = w.actors.filter(h => h.alive && h.team === 'zenith');
  if (t >= b.nextThink) { b.nextThink = t + 0.5; b.target = heroes.sort((p, q) => dist3(p.pos, a.pos) - dist3(q.pos, a.pos))[Math.random() < 0.3 ? 1 : 0] ?? heroes[0] ?? null; }
  const tg = b.target;
  if (!tg) { i.mx = i.mz = 0; return; }
  const c = tg.center, e = a.eye;
  if (!b.beam) i.yaw = Math.atan2(c.x - e.x, c.z - e.z);
  i.pitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z));
  const dd = Math.hypot(tg.pos.x - a.pos.x, tg.pos.z - a.pos.z);
  // movement: keep a fighting distance, drift around the arena
  const want = def.frame === 'drone' ? 16 : def.id === 'qelvaris' ? 12 : 10;
  const k = t < b.busyUntil ? 0 : dd > want + 3 ? 1 : dd < want - 3 ? -0.6 : 0;
  i.mz = k; i.mx = Math.sin(t * 0.3 + a.id) * 0.5;
  if (def.frame === 'drone') a.sv.hoverY = w.level.groundAt(a.pos.x, a.pos.z, 60) + (b.submerged ? -20 : 6 + Math.sin(t * 0.6) * 2);
  i.fire = !b.submerged && t > b.busyUntil && Math.random() < 0.6;
  // weak point pulse after phase changes
  // ---- continuous attacks
  if (b.sweep) {
    const s = b.sweep, k2 = (t - s.t0) / s.dur;
    if (k2 >= 1) b.sweep = null;
    else {
      const ang = s.from + (s.to - s.from) * k2;
      const o = { x: a.pos.x, y: a.pos.y + 1, z: a.pos.z }, end = { x: o.x + Math.sin(ang) * s.len, y: o.y, z: o.z + Math.cos(ang) * s.len };
      w.fx('bossbeam', { x: o.x, y: a.pos.y + a.height * 0.5, z: o.z }, { to: end, color: def.glow });
      for (const h of heroes) {
        const vx = end.x - o.x, vz = end.z - o.z, L2 = vx * vx + vz * vz;
        const q = Math.max(0, Math.min(1, ((h.pos.x - o.x) * vx + (h.pos.z - o.z) * vz) / L2));
        const dist = Math.hypot(h.pos.x - (o.x + vx * q), h.pos.z - (o.z + vz * q));
        if (dist < 1.3 && h.pos.y - a.pos.y < 1.4) w.damage(a, h, 110 * dt, { kind: 'ability', noLifesteal: true });   // jump it!
      }
    }
  }
  if (b.beam) {
    if (t > b.beam.until || !b.beam.tg.alive) b.beam = null;
    else {
      const bt = b.beam.tg, o = { x: a.pos.x, y: a.pos.y + a.height * 0.7, z: a.pos.z };
      const dv = norm({ x: bt.center.x - o.x, y: bt.center.y - o.y, z: bt.center.z - o.z });
      const L = dist3(o, bt.center);
      const bar = w.barrierHit(a.team, o, dv, L), lh = w.level.ray(o, dv, L);
      const endT = Math.min(bar ? bar.t : L, lh ? lh.t : L);
      const end = { x: o.x + dv.x * endT, y: o.y + dv.y * endT, z: o.z + dv.z * endT };
      w.fx('bossbeam', o, { to: end, color: def.glow });
      if (bar && bar.t <= endT + 0.01) w.hitBarrier(bar.owner, 60 * dt, a, end);
      else if (!lh || lh.t >= L - 0.5) w.damage(a, bt, 45 * dt, { kind: 'beam', noLifesteal: true });
    }
  }
  if (b.shock) {
    const r = (t - b.shock.t0) * 12;
    if (r > 32) b.shock = null;
    else for (const h of heroes) if (!b.shock.hit.has(h.id) && Math.abs(Math.hypot(h.pos.x - a.pos.x, h.pos.z - a.pos.z) - r) < 1.1 && h.pos.y - w.level.groundAt(h.pos.x, h.pos.z, h.pos.y + 1) < 1) {
      b.shock.hit.add(h.id); w.damage(a, h, 45, { kind: 'ability' });
    }
  }
  if (t < b.nextAttack || t < b.busyUntil) return;
  // ---- choose the next attack (faster when hurt)
  const hurt = 1 - a.health / a.maxHp;
  b.nextAttack = t + 4.2 - hurt * 1.8 + Math.random();
  const atk = def.attacks[Math.floor(Math.random() * def.attacks.length)];
  a.anim.castAt = t; a.anim.castId = atk;
  const P = (h: Actor) => ({ x: h.pos.x, z: h.pos.z });
  const col = def.glow;
  switch (atk) {
    case 'stomp': d.tele(a, { shape: 'circle', ...P(tg), r: 7, dmg: 70, knock: 14, fx: 'slam', color: col }, 1.3); b.busyUntil = t + 1.4; w.sfx('mechjump', a.pos); break;
    case 'bite': { const f = a.forward(); d.tele(a, { shape: 'circle', x: a.pos.x + f.x * 8, z: a.pos.z + f.z * 8, r: 6, dmg: 80, knock: 10, fx: 'slam', color: col }, 0.9); b.busyUntil = t + 1; break; }
    case 'charge': {
      const f = norm({ x: tg.pos.x - a.pos.x, y: 0, z: tg.pos.z - a.pos.z });
      const L = 30;
      d.tele(a, { shape: 'line', x: a.pos.x, z: a.pos.z, x2: a.pos.x + f.x * L, z2: a.pos.z + f.z * L, r: a.radius, dmg: 60, knock: 16, fx: 'dust', color: col }, 1.2);
      w.after(1.1, () => { if (a.alive) a.forced = { vx: f.x * L / 0.8, vy: 0, vz: f.z * L / 0.8, until: w.time + 0.8, kind: 'bosscharge', ignoreGravity: true }; });
      b.busyUntil = t + 2; w.sfx('charge', a.pos); break;
    }
    case 'barrage': case 'firerain': {
      const n = atk === 'firerain' ? 14 : 8;
      for (let k = 0; k < n; k++) {
        const h = heroes[k % heroes.length], ang = Math.random() * 6.28, r = Math.random() * 7;
        d.tele(a, { shape: 'circle', x: h.pos.x + Math.cos(ang) * r, z: h.pos.z + Math.sin(ang) * r, r: 3.2, dmg: 40, knock: 6, fx: 'burst', color: col }, 1.4 + k * 0.12);
      }
      w.fx('ultflash', a.center, { color: col, actor: a }); w.sfx('rocketfist', a.pos); break;
    }
    case 'sweep': {
      const base = a.yaw;
      b.sweep = { t0: t + 0.8, dur: 1.8, from: base - 1.2, to: base + 1.2, len: 34 };
      w.emit({ t: 'msg', text: 'JUMP THE BEAM!', color: col }); w.sfx('lance', a.pos); b.busyUntil = t + 2.8; break;
    }
    case 'beam': b.beam = { until: t + 2.5, tg }; w.sfx('charge', a.pos); b.busyUntil = t + 2.6; break;
    case 'shockwave': b.shock = { t0: t + 0.6, hit: new Set() }; w.fx('sunburst', a.pos, { r: 30, color: col }); w.sfx('slam', a.pos); break;
    case 'crescents': case 'halo': case 'orbs': {
      const n = atk === 'halo' ? 12 : atk === 'orbs' ? 5 : 3;
      for (let k = 0; k < n; k++) {
        const ang = atk === 'halo' ? k / n * Math.PI * 2 : a.yaw + (k - (n - 1) / 2) * 0.25;
        const from = { x: a.pos.x, y: a.pos.y + Math.min(a.height * 0.5, 4), z: a.pos.z };
        const dir = atk === 'orbs' ? norm({ x: Math.sin(ang), y: 0.4, z: Math.cos(ang) }) : norm({ x: Math.sin(ang), y: atk === 'crescents' ? (c.y - from.y) / Math.max(1, dd) : 0, z: Math.cos(ang) });
        w.spawnProj(a, from, dir, atk === 'orbs' ? 16 : 26, { dmg: atk === 'orbs' ? 22 : 35, fx: 'hex', life: 3, r: atk === 'crescents' ? 1.1 : 0.5, homing: atk === 'orbs' ? 2.5 : 0 });
      }
      w.sfx('silence', a.pos); break;
    }
    case 'summon': {
      const n = 2 + d.scale();
      for (let k = 0; k < n; k++) d.spawn(def.summon, a.pos.x + Math.cos(k * 2) * 6, a.pos.z + Math.sin(k * 2) * 6);
      w.emit({ t: 'msg', text: 'REINFORCEMENTS', color: '#c77dff' }); break;
    }
    case 'blink': case 'warp': {
      const h = heroes[Math.floor(Math.random() * heroes.length)];
      const ang = Math.random() * 6.28, r = def.id === 'qelvaris' ? 8 : 14;
      const p = { x: h.pos.x + Math.cos(ang) * r, z: h.pos.z + Math.sin(ang) * r };
      if (w.level.groundAt(p.x, p.z, a.pos.y + 5) > -Infinity) { w.fx('smoke', a.pos, { color: col }); a.pos.x = p.x; a.pos.z = p.z; w.fx('smoke', a.pos, { color: col }); w.sfx('shadowstep', a.pos); }
      break;
    }
    case 'dive': {
      b.submerged = true; a.set('phased', t, 2.6); w.fx('burst', a.pos, { r: 6, color: col });
      const p = P(tg);
      d.tele(a, { shape: 'circle', ...p, r: 6, dmg: 85, knock: 16, fx: 'slam', color: col }, 2);
      w.after(2, () => { b.submerged = false; a.pos.x = p.x; a.pos.z = p.z; a.pos.y = w.level.groundAt(p.x, p.z, 40); });
      b.busyUntil = t + 2.5; w.sfx('singularity', a.pos); break;
    }
    case 'divebomb': {
      const p = P(tg);
      d.tele(a, { shape: 'circle', ...p, r: 7, dmg: 75, knock: 14, fx: 'slam', color: col }, 1.5);
      w.after(1.1, () => { if (!a.alive) return; const dx = p.x - a.pos.x, dz = p.z - a.pos.z; a.forced = { vx: dx / 0.4, vy: -8, vz: dz / 0.4, until: w.time + 0.4, kind: 'bosscharge', ignoreGravity: true }; });
      b.busyUntil = t + 2; break;
    }
    case 'gravity': {
      const p = { ...tg.pos };
      w.zones.push({ id: Math.floor(Math.random() * 1e9), kind: 'singularity', owner: a, team: a.team, x: p.x, y: p.y, z: p.z, r: 8, born: t, until: t + 2.5, next: t, data: null });
      w.fx('singularity', p, { r: 8, color: col, dur: 2.5 }); w.sfx('singularity', p); break;
    }
  }
}
