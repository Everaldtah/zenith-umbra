// Hero AI: role behaviour (tank / dps / support), nav-mesh movement, lead aiming, and per-hero ability logic
// that deliberately plays the rival counters so matches (and the AI test lab) exercise them.
import { isAbility } from '../data/heroes';
import type { V3 } from '../engine/Physics';
import type { Actor } from '../game/Actor';
import { dist3, type World } from '../game/World';
import type { Nav } from './Nav';

const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export class Bot {
  target: Actor | null = null;
  ally: Actor | null = null;         // heal / escort target
  path: V3[] = [];
  pathGoal: V3 | null = null;
  repathAt = 0; thinkAt = 0; abilityAt = 0;
  strafe = 1; strafeUntil = 0;
  stuck = { x: 0, z: 0, t: 0 }; stuckCount = 0;
  holdAlt = 0; holdFire = 0; flyUntil = 0;
  aimAt: V3 | null = null;
  snap = false;
  goal: V3 = { x: 0, y: 0, z: 0 };
  mode: 'fight' | 'objective' | 'retreat' | 'support' | 'patrol' = 'objective';
  react: number;
  aimErr: number;

  constructor(public w: World, public a: Actor, public nav: Nav, public skill = 0.7) {
    this.react = 0.35 - skill * 0.25;
    this.aimErr = 0.09 * (1 - skill) + 0.012;
  }

  think(dt: number) {
    const w = this.w, a = this.a, t = w.time, i = a.input;
    i.a1 = i.a2 = i.ult = i.jump = i.reload = false;
    if (a.isRobot) return this.robot(dt);
    if (t >= this.thinkAt) { this.thinkAt = t + 0.12 + Math.random() * 0.05; this.decide(); }
    if (t >= this.abilityAt) { this.abilityAt = t + this.react + Math.random() * 0.2; this.abilities(); }
    this.moveAlong(dt);
    this.aim(dt);
    this.shoot();
  }

  // ------------------------------------------------------------------ decisions
  private decide() {
    const w = this.w, a = this.a, t = w.time;
    const foes = w.enemies(a).filter(x => w.perceivable(a, x) && !x.isRobot || (x.isRobot && x.def.id !== 'bot_dummy'));
    const vis = foes.filter(x => dist3(x.pos, a.pos) < 55 && w.visible(a, x));
    // target: close + low + visible, sticky
    const score = (x: Actor) => dist3(x.pos, a.pos) + x.health / x.maxHp * 12 - (x === this.target ? 8 : 0) - (x.def.id === a.def.rival ? 5 : 0) - (x.has('marked', t) ? 4 : 0);
    this.target = vis.sort((p, q) => score(p) - score(q))[0] ?? null;
    const P = w.map.point;
    const pointOpen = w.mode !== 'training' && t > w.point.unlockAt - 4;
    const hurt = a.health / a.maxHp;
    const role = a.def.role;
    if (role === 'support') {
      const allies = w.allies(a, false).filter(x => !x.isRobot);
      this.ally = allies.filter(x => dist3(x.pos, a.pos) < 30).sort((p, q) => p.health / p.maxHp - q.health / q.maxHp)[0] ?? null;
      if (this.ally && this.ally.health / this.ally.maxHp > 0.93) {
        this.ally = allies.find(x => x.def.role === 'tank') ?? this.ally;
      }
    }
    // goal selection
    if (hurt < 0.3 && role !== 'tank' && this.target && dist3(this.target.pos, a.pos) < 14) {
      this.mode = 'retreat';
      const sup = w.allies(a, false).find(x => x.def.role === 'support' && x !== a);
      this.goal = sup ? { ...sup.pos } : { x: a.spawn[0], y: 0, z: a.spawn[1] };
    } else if (role === 'support' && this.ally && this.ally !== a) {
      this.mode = 'support';
      const al = this.ally.pos, tg = this.target;
      const away = tg ? norm2(al.x - tg.pos.x, al.z - tg.pos.z) : norm2(a.spawn[0] - al.x, a.spawn[1] - al.z);
      this.goal = { x: al.x + away.x * 5, y: al.y, z: al.z + away.z * 5 };
    } else if (this.target && (!pointOpen || dist3(this.target.pos, { x: P[0], y: P[1], z: P[2] }) < 22 || dist3(this.target.pos, a.pos) < 12)) {
      this.mode = 'fight';
      const tg = this.target.pos, d = dist3(tg, a.pos);
      const want = this.preferredRange();
      const k = d > 0.1 ? (d - want) / d : 0;
      this.goal = { x: a.pos.x + (tg.x - a.pos.x) * k, y: tg.y, z: a.pos.z + (tg.z - a.pos.z) * k };
      if (t > this.strafeUntil) { this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeUntil = t + 0.6 + Math.random() * 1.2; }
    } else if (pointOpen) {
      this.mode = 'objective';
      const ang = (a.id * 2.4) % (Math.PI * 2);
      this.goal = { x: P[0] + Math.cos(ang) * 3, y: P[1], z: P[2] + Math.sin(ang) * 3 };
    } else {
      this.mode = 'objective';
      const f = a.team === 'zenith' ? 1 : -1;
      this.goal = { x: P[0] - f * 14, y: P[1], z: P[2] + ((a.id % 5) - 2) * 3 };
    }
    // goals must sit on walkable ground (never in the void next to an island)
    const gk = this.nav.nearest(this.goal, 10);
    if (gk >= 0) { const c = this.nav.center(gk); this.goal = { x: c.x, y: c.y, z: c.z }; }
    // repath when the goal moved or on schedule
    if (!this.pathGoal || dist3(this.pathGoal, this.goal) > 2.5 || t > this.repathAt) {
      this.repathAt = t + 1.2 + Math.random() * 0.6;
      this.pathGoal = { ...this.goal };
      this.path = this.nav.find(a.pos, this.goal) ?? [];
    }
  }

  private preferredRange() {
    const a = this.a, P = a.def.primary;
    if (P.kind === 'melee') return 1.5;
    if (a.def.id === 'enra') return 4;
    if (a.def.id === 'gorgoth') return 7;
    if (a.def.id === 'tenkai') return 9;
    if (a.def.id === 'yuzu') return 26;
    if (a.def.id === 'kagemaru') return 11;
    return 15;
  }

  // ------------------------------------------------------------------ movement
  private moveAlong(dt: number) {
    const w = this.w, a = this.a, t = w.time, i = a.input;
    while (this.path.length && Math.hypot(this.path[0].x - a.pos.x, this.path[0].z - a.pos.z) < (this.path.length > 1 ? 0.7 : 0.4)) this.path.shift();
    let dir = { x: 0, z: 0 };
    const wp = this.path[0];
    if (wp) dir = norm2(wp.x - a.pos.x, wp.z - a.pos.z);
    else if (Math.hypot(this.goal.x - a.pos.x, this.goal.z - a.pos.z) > 1.2 && (a.def.frame === 'flyer' || a.def.frame === 'drone')) dir = norm2(this.goal.x - a.pos.x, this.goal.z - a.pos.z);
    // combat strafe
    if (this.mode === 'fight' && this.target && dist3(this.target.pos, a.pos) < 30) {
      const tx = this.target.pos.x - a.pos.x, tz = this.target.pos.z - a.pos.z, l = Math.hypot(tx, tz) || 1;
      const sx = -tz / l * this.strafe, sz = tx / l * this.strafe;
      const k = wp ? 0.55 : 1;
      dir = norm2(dir.x * (1 - k) + sx * k, dir.z * (1 - k) + sz * k);
      if (Math.random() < 0.004 && a.grounded) i.jump = true;
    }
    // wall avoidance: don't strafe off a ledge into the void
    const ahead = { x: a.pos.x + dir.x * 1.2, z: a.pos.z + dir.z * 1.2 };
    if (a.def.frame !== 'drone' && !a.flying) {
      const g = w.level.groundAt(ahead.x, ahead.z, a.pos.y + 0.3);
      if (g === -Infinity || g < a.pos.y - 5) { dir = wp ? norm2(wp.x - a.pos.x, wp.z - a.pos.z) : { x: 0, z: 0 }; this.strafe *= -1; }
    }
    // brake if momentum is carrying us over an edge
    if (a.grounded && a.def.frame !== 'drone') {
      const sp = Math.hypot(a.vel.x, a.vel.z);
      if (sp > 1) {
        const px = a.pos.x + a.vel.x / sp * (a.radius + 0.5), pz = a.pos.z + a.vel.z / sp * (a.radius + 0.5);
        const g = w.level.groundAt(px, pz, a.pos.y + 0.3);
        if (g === -Infinity || g < a.pos.y - 5) {
          const k = this.nav.nearest(a.pos, 4);
          const c = k >= 0 ? this.nav.center(k) : a.pos;
          dir = norm2(c.x - a.pos.x - a.vel.x * 0.3, c.z - a.pos.z - a.vel.z * 0.3);
        }
      }
    }
    // world dir -> local input
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), rx = -Math.cos(a.yaw), rz = Math.sin(a.yaw);
    i.mz = dir.x * fx + dir.z * fz;
    i.mx = dir.x * rx + dir.z * rz;
    // step-ups the nav allows but that need a hop (pads are walked onto)
    if (wp && wp.y - a.pos.y > 0.6 && a.grounded && Math.hypot(wp.x - a.pos.x, wp.z - a.pos.z) < 2.5) i.jump = true;
    // flyers: take to the air in fights and to reach high goals
    if (a.def.frame === 'flyer') {
      const hGoal = (this.pathGoal?.y ?? 0) - a.pos.y;
      const wantAir = (this.mode === 'fight' || this.mode === 'support') && a.flight > 30 && !a.has('grounded', t);
      if (wantAir && t > this.flyUntil) this.flyUntil = t + 1.5 + Math.random() * 1.5;
      const gnd = w.level.groundAt(a.pos.x, a.pos.z, a.pos.y);
      const alt = a.pos.y - (gnd === -Infinity ? a.pos.y - 5 : gnd);
      i.jumpHeld = (t < this.flyUntil && alt < 4.5 && a.flight > 10) || (hGoal > 1.2 && a.flight > 10) || (gnd === -Infinity && a.flight > 5);
      if (i.jumpHeld && a.grounded) i.jump = true;
      i.descend = false;
    } else i.jumpHeld = i.jump;
    // unstick
    if (t - this.stuck.t > 1.2) {
      const moved = Math.hypot(a.pos.x - this.stuck.x, a.pos.z - this.stuck.z);
      const wanted = Math.hypot(i.mx, i.mz) > 0.3 && !a.has('root', t) && !a.has('stun', t) && !a.barrier.up;
      if (wanted && moved < 0.35) {
        this.stuckCount++; i.jump = true; this.strafe *= -1; this.repathAt = 0;
        this.path = this.nav.find(a.pos, this.goal) ?? [];
      }
      this.stuck = { x: a.pos.x, z: a.pos.z, t };
    }
    void dt;
  }

  // ------------------------------------------------------------------ aiming / firing
  private aimPoint(): V3 | null {
    const a = this.a, w = this.w;
    if (this.aimAt) return this.aimAt;
    const S = a.def.secondary;
    if (this.mode === 'support' && this.ally && this.ally !== a && this.ally.health < this.ally.maxHp * 0.97 && !isAbility(S) && S.heal) {
      const c = this.ally.center;
      return { x: c.x, y: c.y, z: c.z };
    }
    const tg = this.target;
    if (!tg) {
      if (this.path[0]) { const p = this.path[Math.min(2, this.path.length - 1)]; return { x: p.x, y: a.eye.y, z: p.z }; }
      return null;
    }
    const W = a.def.primary;
    const c = tg.center;
    const sp = W.speed ?? (W.kind === 'charge' ? 100 : 0);
    const tt = sp ? dist3(a.eye, c) / sp : 0;
    const e = this.aimErr * dist3(a.eye, c);
    return { x: c.x + tg.vel.x * tt + (Math.random() - 0.5) * e, y: c.y + tg.vel.y * tt * 0.5 + (Math.random() - 0.5) * e * 0.6, z: c.z + tg.vel.z * tt + (Math.random() - 0.5) * e };
  }

  private aim(dt: number) {
    const a = this.a, i = a.input;
    const p = this.aimPoint();
    if (!p) return;
    const e = a.eye;
    const yaw = Math.atan2(p.x - e.x, p.z - e.z);
    const pitch = Math.atan2(p.y - e.y, Math.hypot(p.x - e.x, p.z - e.z));
    if (this.snap) { i.yaw = yaw; i.pitch = pitch; this.snap = false; return; }
    const rate = (4 + this.skill * 8) * dt;
    const dy = wrap(yaw - i.yaw), dp = pitch - i.pitch;
    i.yaw = wrap(i.yaw + Math.max(-rate, Math.min(rate, dy * Math.min(1, dt * 12))));
    i.pitch += Math.max(-rate, Math.min(rate, dp * Math.min(1, dt * 12)));
  }

  private onTarget(deg = 6) {
    const a = this.a, tg = this.target;
    if (!tg) return false;
    const e = a.eye, c = tg.center;
    const yaw = Math.atan2(c.x - e.x, c.z - e.z), pitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z));
    const tol = deg * Math.PI / 180 + Math.atan2(tg.radius, dist3(e, c));
    return Math.abs(wrap(yaw - a.input.yaw)) < tol && Math.abs(pitch - a.input.pitch) < tol + 0.1;
  }

  private shoot() {
    const w = this.w, a = this.a, t = w.time, i = a.input, tg = this.target;
    const P = a.def.primary, S = a.def.secondary;
    i.fire = false;
    i.alt = t < this.holdAlt;
    // supports heal first
    if (!isAbility(S) && S.heal && this.ally && this.ally !== a && this.ally.health < this.ally.maxHp * 0.97 && dist3(this.ally.pos, a.pos) < S.range + 2 && w.visible(a, this.ally)) {
      i.alt = true;
      if (S.kind === 'beam') return;
      if (!this.aimAtAlly()) i.alt = false;
      return;
    }
    if (!tg || !w.visible(a, tg)) { if (P.ammo && a.ammo < P.ammo * 0.4 && !tg) i.reload = true; if (P.kind === 'charge') i.fire = false; return; }
    const d = dist3(tg.pos, a.pos);
    if (P.kind === 'charge') {
      // hold to charge, release when full and on target
      if (a.charging && a.charge >= 0.95 && this.onTarget(2.5)) i.fire = false;
      else i.fire = d < P.range;
      return;
    }
    const inRange = d < P.range * (P.kind === 'hitscan' ? 0.8 : 1) + tg.radius;
    if (inRange && this.onTarget(P.kind === 'melee' ? 35 : P.kind === 'beam' ? 14 : 5)) i.fire = true;
    // melee secondaries / ranged secondaries
    if (!isAbility(S) && !S.heal) {
      if (S.kind === 'melee' && d < S.range + tg.radius && this.onTarget(35)) i.alt = true;
      if (S.kind === 'projectile' && d > 4 && d < S.range && this.onTarget(4) && Math.random() < 0.25) i.alt = true;
    }
    if (a.def.id === 'raijin' && d > P.range + 1) i.fire = false;
  }

  private aimAtAlly() {
    const a = this.a, al = this.ally!;
    const e = a.eye, c = al.center;
    const yaw = Math.atan2(c.x - e.x, c.z - e.z);
    return Math.abs(wrap(yaw - a.input.yaw)) < 0.12;
  }

  /** look at a point and fire an ability on the next tick */
  private castAt(slot: 'a1' | 'a2' | 'ult' | 'alt', p?: V3) {
    const i = this.a.input;
    if (p) { this.aimAt = p; this.snap = true; this.aim(0); this.aimAt = null; }
    if (slot === 'alt') { this.holdAlt = this.w.time + 0.1; i.alt = true; }
    else i[slot] = true;
  }

  // ------------------------------------------------------------------ per-hero abilities (incl. rival counters)
  private abilities() {
    const w = this.w, a = this.a, t = w.time, tg = this.target;
    if (a.has('silence', t) || a.has('stun', t)) return;
    const foes = w.enemies(a).filter(x => !x.isRobot || x.def.id !== 'bot_dummy');
    const allies = w.allies(a);
    const d = tg ? dist3(tg.pos, a.pos) : 99;
    const near = (p: V3, r: number, list: Actor[]) => list.filter(x => dist3(x.pos, p) < r);
    const ultReady = a.ult >= a.def.ult.charge;
    const rdy = (id: string) => a.ready(id, t);
    const rival = foes.find(x => x.def.id === a.def.rival);
    const lowAllies = allies.filter(x => x.health / x.maxHp < 0.5 && dist3(x.pos, a.pos) < 20);
    const vis = (x: Actor) => w.visible(a, x);
    switch (a.def.id) {
      case 'tenkai': {
        // COUNTER: Dawn Anchor the charging Gorgoth
        if (rival && rival.forced?.kind === 'abysscharge' && dist3(rival.pos, a.pos) < 24 && vis(rival) && rdy('anchor')) { this.castAt('a1', rival.center); break; }
        const cleanse = allies.some(x => dist3(x.pos, a.pos) < 10 && ['brand', 'antiheal', 'root', 'silence', 'tethered'].some(s => x.has(s, t)));
        if (cleanse && rdy('sunburst')) { this.castAt('a2'); break; }
        if (tg && d > 6 && d < 20 && vis(tg) && rdy('anchor') && Math.random() < 0.4) { this.castAt('a1', tg.center); break; }
        if (ultReady && tg && near(tg.pos, 8, foes).length >= 2 && d < 14) { this.castAt('ult', tg.pos); break; }
        // Solar Bulwark: raise when under fire
        if (t - a.lastDamagedAt < 0.8 && a.barrier.hp > 350 && tg && d > 5) this.holdAlt = t + 1.2 + Math.random();
        break;
      }
      case 'mirei': {
        const noct = foes.find(x => x.def.id === 'nocturne');
        const ccd = allies.some(x => ['silence', 'grounded', 'root', 'tethered'].some(s => x.has(s, t)) && dist3(x.pos, a.pos) < 15);
        // COUNTER: pre-empt Silence Aria when Nocturne closes in on the team
        if (rdy('constellation') && (ccd || (noct && near(noct.pos, 15, allies).length >= 2) || lowAllies.length >= 2)) { this.castAt('a1'); break; }
        const dying = allies.filter(x => x.health / x.maxHp < 0.4 && t - x.lastDamagedAt < 1 && dist3(x.pos, a.pos) < 28 && vis(x))[0];
        if (dying && rdy('wish')) { this.castAt('a2', dying.center); break; }
        if (ultReady && lowAllies.length >= 2) this.castAt('ult');
        break;
      }
      case 'kaien': {
        const kage = foes.find(x => x.def.id === 'kagemaru');
        // COUNTER: seal the Shade Fang (the AI knows roughly where he lurks even when veiled)
        if (kage && rdy('seal') && dist3(kage.pos, a.pos) < 18 && (kage.has('stealth', t) || dist3(kage.pos, a.pos) < 10)) { this.castAt('a2', { ...kage.pos }); break; }
        if (tg && rdy('seal') && near(tg.pos, 7, foes).length >= 2 && d < 20) { this.castAt('a2', { ...tg.pos }); break; }
        if (ultReady && lowAllies.length >= 2) { this.castAt('ult'); break; }
        if (rdy('spiritstep') && a.health / a.maxHp < 0.4 && tg && d < 8) this.castAt('a1');
        break;
      }
      case 'raijin': {
        const enra = foes.find(x => x.def.id === 'enra');
        const chainIncoming = w.projs.some(p => p.special === 'chain' && p.team !== a.team && dist3(p.pos, a.pos) < 12);
        // COUNTER: parry the chain / the oni's fists
        if (rdy('parry') && (chainIncoming || (enra && dist3(enra.pos, a.pos) < 4.5 && vis(enra)) || w.projs.filter(p => p.team !== a.team && dist3(p.pos, a.pos) < 6).length >= 3)) { this.castAt('a2'); break; }
        const land = tg ? { x: a.pos.x + (tg.pos.x - a.pos.x) / d * 12, z: a.pos.z + (tg.pos.z - a.pos.z) / d * 12 } : null;
        const safe = land && w.level.groundAt(land.x, land.z, a.pos.y + 1) > a.pos.y - 3 && w.level.groundAt((a.pos.x + land.x) / 2, (a.pos.z + land.z) / 2, a.pos.y + 1) > a.pos.y - 3;
        if (tg && safe && rdy('flashstep') && d > 5 && d < 13 && vis(tg) && !a.has('sealed', t)) { this.castAt('a1', tg.center); a.input.mz = 1; a.input.mx = 0; break; }
        if (ultReady && tg && d < 8 && a.health / a.maxHp > 0.45) this.castAt('ult');
        break;
      }
      case 'yuzu': {
        const hex = foes.find(x => x.def.id === 'hex');
        const strung = allies.find(x => x.has('tethered', t) || x.has('antiheal', t));
        // COUNTER: sever Hex's strings / hexes on allies
        if (strung && rdy('reveal') && dist3(strung.pos, a.pos) < 45) { this.castAt('a2', strung.center); break; }
        const kage = foes.find(x => x.def.id === 'kagemaru' && x.has('stealth', t) && allies.some(al => dist3(al.pos, x.pos) < 10));
        if (kage && rdy('reveal')) { this.castAt('a2', kage.center); break; }
        if (rdy('sunhop') && tg && d < 7) { this.castAt('a1'); break; }
        if (ultReady && tg && near(tg.pos, 8, foes).length >= 2) { this.castAt('ult', { ...tg.pos }); break; }
        if (hex && hex.has('tethered', t)) void 0;
        break;
      }
      case 'gorgoth': {
        const ten = foes.find(x => x.def.id === 'tenkai');
        // COUNTER: Null Lance straight into the Solar Bulwark
        if (ten && ten.barrier.up && dist3(ten.pos, a.pos) < 9 && rdy('nulllance')) { this.castAt('a2', ten.center); break; }
        const wished = foes.find(x => x.shields.some(s => s.kind === 'wish') && dist3(x.pos, a.pos) < 8);
        if (wished && rdy('nulllance')) { this.castAt('a2', wished.center); break; }
        if (tg && d < 8 && rdy('nulllance') && Math.random() < 0.5) { this.castAt('a2', tg.center); break; }
        if (tg && d > 5 && d < 14 && rdy('abysscharge') && vis(tg) && Math.abs(tg.pos.y - a.pos.y) < 1.5) { this.castAt('a1', tg.center); break; }
        if (rdy('plating') && t - a.lastDamagedAt < 0.5 && a.health / a.maxHp < 0.7) { this.castAt('alt'); break; }
        if (ultReady && tg && d < 16 && near(tg.pos, 9, foes).length >= 2) this.castAt('ult', tg.center);
        break;
      }
      case 'nocturne': {
        const mirei = foes.find(x => x.def.id === 'mirei' && x.flying && dist3(x.pos, a.pos) < 12 && vis(x));
        const rai = foes.find(x => x.def.id === 'raijin' && dist3(x.pos, a.pos) < 11 && vis(x));
        // COUNTER: ground the Starweaver
        if (rdy('silence') && (mirei || rai)) { this.castAt('a1', (mirei ?? rai)!.center); break; }
        if (rdy('silence') && tg && d < 10 && near(tg.pos, 5, foes).length >= 2) { this.castAt('a1', tg.center); break; }
        const fighter = allies.find(x => x !== a && x.def.role !== 'support' && this.target && dist3(x.pos, this.target.pos) < 10 && dist3(x.pos, a.pos) < 25 && vis(x));
        if (fighter && rdy('bloodpact')) { this.castAt('a2', fighter.center); break; }
        if (ultReady && lowAllies.length >= 2) this.castAt('ult');
        break;
      }
      case 'hex': {
        const heals = foes.filter(x => x.def.role === 'support');
        const healed = foes.find(x => heals.some(h => h.beamTarget === x || (h.def.id === 'kaien' && dist3(h.pos, x.pos) < 20)) && dist3(x.pos, a.pos) < 22 && vis(x));
        // COUNTER: curse whoever the Zenith healers are keeping alive
        if (rdy('grievous') && healed && healed.health / healed.maxHp < 0.8) { this.castAt('a2', healed.pos); break; }
        const yuzu = foes.find(x => x.def.id === 'yuzu' && dist3(x.pos, a.pos) < 19 && vis(x));
        if (rdy('marionette') && (yuzu || (tg && d < 19 && vis(tg)))) { this.castAt('a1', (yuzu ?? tg)!.center); break; }
        if (ultReady && near(a.pos, 14, foes).length >= 2) this.castAt('ult');
        break;
      }
      case 'kagemaru': {
        // COUNTER: slice Kaien's seals apart
        const seal = w.zones.find(z => z.team !== a.team && (z.kind === 'seal' || z.kind === 'sanctuary') && Math.hypot(z.x - a.pos.x, z.z - a.pos.z) < z.r + 9);
        if (seal) {
          this.goal = { x: seal.x, y: seal.y, z: seal.z }; this.path = this.nav.find(a.pos, this.goal) ?? [];
          if (Math.hypot(seal.x - a.pos.x, seal.z - a.pos.z) < seal.r + 3.5) { this.castAt('alt', { x: seal.x, y: seal.y + 1, z: seal.z }); break; }
        }
        if (tg && d > 16 && rdy('veil') && !a.has('stealth', t)) { this.castAt('a2'); break; }
        if (tg && d > 5 && d < 15 && rdy('shadowstep') && vis(tg)) { this.castAt('a1', tg.pos); break; }
        if (ultReady && (near(a.pos, 14, foes).length >= 2 || (tg && tg.health < 130 && d < 14))) this.castAt('ult');
        break;
      }
      case 'enra': {
        const rai = foes.find(x => x.def.id === 'raijin' && dist3(x.pos, a.pos) < 17 && vis(x));
        // COUNTER: chain Raijin (especially mid Flash Step)
        if (rdy('chain') && rai && (rai.forced?.kind === 'flashstep' || dist3(rai.pos, a.pos) > 5)) { this.castAt('a1', rai.center); break; }
        if (rdy('chain') && tg && d > 7 && d < 17 && vis(tg)) { this.castAt('a1', tg.center); break; }
        if (rdy('brand') && tg && d < 6) { this.castAt('a2', tg.center); break; }
        if (ultReady && tg && d < 10 && a.health / a.maxHp > 0.4) this.castAt('ult');
        break;
      }
    }
  }

  // ------------------------------------------------------------------ training robots
  private robot(dt: number) {
    const w = this.w, a = this.a, t = w.time, i = a.input;
    const players = w.enemies(a).filter(x => !x.isRobot);
    const tg = players.filter(x => dist3(x.pos, a.pos) < 35 && w.visible(a, x)).sort((p, q) => dist3(p.pos, a.pos) - dist3(q.pos, a.pos))[0];
    i.fire = false; i.mx = 0; i.mz = 0;
    if (a.def.id === 'bot_sentry') {
      // patrol along Z in its lane
      const base = a.spawn;
      const dir = Math.sin(t * 0.35 + a.id) > 0 ? 1 : -1;
      const f = { x: 0, z: dir };
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), rx = -Math.cos(a.yaw), rz = Math.sin(a.yaw);
      i.mz = f.x * fx + f.z * fz; i.mx = f.x * rx + f.z * rz;
      if (Math.abs(a.pos.z - base[1]) > 7 && Math.sign(a.pos.z - base[1]) === dir) { i.mz = 0; i.mx = 0; }
      if (tg) {
        this.target = tg;
        const c = tg.center, e = a.eye;
        i.yaw = Math.atan2(c.x - e.x, c.z - e.z); i.pitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z));
        i.fire = Math.sin(t * 1.3 + a.id) > -0.2;
      }
    } else if (a.def.id === 'bot_drone') {
      const r = 6, ang = t * 0.5 + a.id;
      const gx = a.spawn[0] + Math.cos(ang) * r, gz = a.spawn[1] + Math.sin(ang) * r;
      const d = norm2(gx - a.pos.x, gz - a.pos.z);
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), rx = -Math.cos(a.yaw), rz = Math.sin(a.yaw);
      i.mz = d.x * fx + d.z * fz; i.mx = d.x * rx + d.z * rz;
      a.sv.hoverY = 3 + Math.sin(t * 0.9 + a.id) * 1.5;
    }
    void dt;
  }
}

function norm2(x: number, z: number) { const l = Math.hypot(x, z) || 1; return { x: x / l, z: z / l }; }
