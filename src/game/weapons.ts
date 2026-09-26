// Primary / secondary fire for every hero.
import { isAbility, type WeaponDef } from '../data/heroes';
import type { V3 } from '../engine/Physics';
import type { Actor } from './Actor';
import { dist3, norm, type World } from './World';

function spreadDir(d: V3, s: number): V3 {
  if (!s) return d;
  // random direction inside a cone of half-angle s
  const u = Math.random() * 2 * Math.PI, r = Math.sqrt(Math.random()) * s;
  const up = Math.abs(d.y) < 0.95 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const a = norm({ x: d.y * up.z - d.z * up.y, y: d.z * up.x - d.x * up.z, z: d.x * up.y - d.y * up.x });
  const b = { x: d.y * a.z - d.z * a.y, y: d.z * a.x - d.x * a.z, z: d.x * a.y - d.y * a.x };
  const cu = Math.cos(u) * r, su = Math.sin(u) * r;
  return norm({ x: d.x + a.x * cu + b.x * su, y: d.y + a.y * cu + b.y * su, z: d.z + a.z * cu + b.z * su });
}

function breakStealth(w: World, a: Actor) {
  if (a.has('stealth', w.time)) { a.clear('stealth'); a.set('ambush', w.time, 0.6); w.sfx('unveil', a.pos, a); }
}

/** everything hostile inside a frontal wedge (cosMin = cos of the half-angle) gets hit once; returns the hit count */
function meleeArc(w: World, a: Actor, reach: number, dmg: number, cosMin: number, vert: number, onHit?: (x: Actor) => void) {
  const f = a.forward();
  let n = 0;
  for (const x of w.enemies(a)) {
    const v = { x: x.pos.x - a.pos.x, z: x.pos.z - a.pos.z }, l = Math.hypot(v.x, v.z);
    if (l > reach + x.radius || Math.abs(x.pos.y - a.pos.y) > vert) continue;
    if ((v.x * f.x + v.z * f.z) / (l || 1) < cosMin && l > x.radius) continue;
    w.damage(a, x, dmg, { kind: 'melee' }); n++;
    w.fx('slash', x.center, { color: a.def.glow });
    onHit?.(x);
  }
  return n;
}

export const QUICK_MELEE = { damage: 40, cooldown: 0.9 };

/** C: every hero's quick melee - a short jab in front of them */
export function quickMelee(w: World, a: Actor) {
  const t = w.time;
  a.nextMelee = t + QUICK_MELEE.cooldown;
  a.anim.attackAt = t; a.anim.attackKind = 'punch';
  breakStealth(w, a);
  const n = meleeArc(w, a, 1.2 + a.radius * 1.3, QUICK_MELEE.damage, 0.45, 2 * a.scale);
  w.sfx(n ? 'punch' : 'whiff', a.center, a);
  if (n) w.fx('impact', { x: a.pos.x + a.forward().x * (a.radius + 0.9), y: a.pos.y + a.height * 0.6, z: a.pos.z + a.forward().z * (a.radius + 0.9) }, { color: a.def.glow });
}

export function fire(w: World, a: Actor, W: WeaponDef, slot: 'primary' | 'secondary', mult = 1) {
  const t = w.time;
  a.anim.attackAt = t; a.anim.attackKind = slot;
  breakStealth(w, a);
  const muz = w.muzzle(a);
  const aim = w.aimPoint(a, W.range * 1.5);
  const base = norm({ x: aim.x - muz.x, y: aim.y - muz.y, z: aim.z - muz.z });
  if (W.kind === 'projectile' || W.kind === 'charge') {
    const n = W.pellets ?? 1;
    for (let i = 0; i < n; i++) {
      const d = n > 1 ? spreadDir(base, (W.spread ?? 0.03) * (i === 0 ? 0 : 1)) : base;
      w.spawnProj(a, muz, d, (W.speed ?? 50) * (W.kind === 'charge' ? 0.5 + 0.5 * mult : 1), {
        dmg: W.damage * mult, splash: W.splash ?? 0, heal: !!W.heal, fx: W.fx, life: W.range / (W.speed ?? 50) * 1.3,
        r: W.heal ? 0.35 : W.splash ? 0.2 : 0.1, crit: W.kind === 'charge' && mult > 0.99 ? 2 : 1.5,
        homing: W.heal ? 5 : a.def.id === 'kaien' ? 1.2 : 0, grav: 0,
      });
    }
  } else if (W.kind === 'hitscan') {
    const n = W.pellets ?? 1, e = a.eye;
    const ed = norm({ x: aim.x - e.x, y: aim.y - e.y, z: aim.z - e.z });
    const hits = new Map<Actor, { dmg: number; head: boolean }>();
    for (let i = 0; i < n; i++) {
      const d = spreadDir(ed, W.spread ?? 0);
      const lh = w.level.ray(e, d, W.range);
      let max = lh ? lh.t : W.range;
      const bh = w.barrierHit(a.team, e, d, max);
      if (bh) max = bh.t;
      const ah = w.rayActors(e, d, max, x => x.team !== a.team);
      const end = ah ? ah.t : max;
      const endP = { x: e.x + d.x * end, y: e.y + d.y * end, z: e.z + d.z * end };
      if (ah) {
        const fall = end > W.range * 0.5 ? 1 - (end - W.range * 0.5) / W.range : 1;
        const h = hits.get(ah.actor) ?? { dmg: 0, head: false };
        h.dmg += W.damage * Math.max(0.3, fall) * (ah.head ? 1.5 : 1); h.head ||= ah.head;
        hits.set(ah.actor, h);
      } else if (bh) w.hitBarrier(bh.owner, W.damage, a, endP);
      else if (lh) w.fx('impact', endP, { color: a.def.glow });
      if (i < 4) w.fx('tracer', muz, { to: endP, color: a.def.glow });
    }
    for (const [x, h] of hits) { w.damage(a, x, h.dmg, { crit: h.head, kind: 'hitscan' }); w.sfx(h.head ? 'crit' : 'hit', x.center); }
  } else if (W.kind === 'melee') {
    if (W.sweep) {
      // two-handed hammer: swings alternate sides; the blow lands after a short wind-up, where the swinger is by then
      a.sv.swing = -(a.sv.swing || -1);
      a.anim.attackSide = a.sv.swing;
      const side = a.sv.swing;
      w.after(W.delay ?? 0, () => {
        if (!a.alive || a.has('stun', w.time)) return;
        const reach = W.range * (a.scale > 1 ? 1 + (a.scale - 1) * 0.5 : 1);
        w.fx('hammer', a.center, { color: a.def.glow, actor: a, side, r: reach });
        const n = meleeArc(w, a, reach, W.damage * mult, 0.1, a.height * 1.3);
        // the head of the hammer also batters enemy barriers it passes through
        const f = a.forward();
        for (const o of w.enemies(a)) {
          if (!o.barrier.up) continue;
          const bx = o.pos.x + o.forward().x * 1.7 * o.scale - a.pos.x, bz = o.pos.z + o.forward().z * 1.7 * o.scale - a.pos.z;
          const l = Math.hypot(bx, bz);
          if (l < reach + 1.5 && (bx * f.x + bz * f.z) / (l || 1) > 0.1) w.hitBarrier(o, W.damage * mult, a, o.center);
        }
        if (n) w.sfx('punch', a.center, a); else w.sfx('whiff', a.pos, a);
      });
    } else {
      const f = a.forward();
      const n = meleeArc(w, a, W.range * a.scale, W.damage * mult, 0.35, 2.5, (x) => {
        if (a.has('judgment', t)) {
          const chain = w.enemies(a).filter(o => o !== x && dist3(o.pos, x.pos) < 8).slice(0, 2);
          for (const o of chain) { w.damage(a, o, 40, { kind: 'ability' }); w.fx('lightning', x.center, { to: o.center, color: '#8ad8ff' }); }
          if (chain.length) w.sfx('chainlightning', x.center);
        }
        if (a.def.id === 'enra' && slot === 'secondary' && x.def.frame !== 'mech') {
          x.forced = { vx: f.x * 14, vy: 3, vz: f.z * 14, until: t + 0.25, kind: 'knock' };
        }
      });
      if (a.def.id === 'kagemaru' && slot === 'secondary') {
        // Severing Fang: slash through enemy seals / sanctums / curse zones
        const p = { x: a.pos.x + f.x * 2, y: a.pos.y, z: a.pos.z + f.z * 2 };
        for (const z of w.zones) {
          if (z.team === a.team || !['seal', 'sanctuary', 'wishzone'].includes(z.kind)) continue;
          if (Math.hypot(z.x - p.x, z.z - p.z) < z.r + 3.5) {
            z.until = t; w.fx('zonebreak', { x: z.x, y: z.y, z: z.z }, { r: z.r, color: '#9d7bff' }); w.sfx('zonebreak', p);
            w.emit({ t: 'counter', actor: a, target: z.owner, text: z.kind === 'seal' ? 'Severing Fang cuts the Warding Seal' : 'Severing Fang cuts the Sanctuary' });
          }
        }
      }
      w.fx('swing', a.center, { color: a.def.glow, actor: a });
      if (!n) w.sfx('whiff', a.pos, a);
    }
  }
  w.sfx(W.sfx, muz, a);
}

export function updateWeapons(w: World, a: Actor, dt: number) {
  const t = w.time, P = a.def.primary, inp = a.input;
  if (a.reloadUntil && t >= a.reloadUntil) { a.reloadUntil = 0; a.ammo = a.maxAmmo; }
  if (P.ammo && inp.reload && a.ammo < a.maxAmmo && !a.reloadUntil && P.kind !== 'charge') { a.reloadUntil = t + a.reloadTime(P.reload ?? 1.5); w.sfx('reload', a.pos, a); }
  const S = a.def.secondary;
  // ---- secondary holds
  if (isAbility(S)) {
    if (S.id === 'bulwark') {
      const want = inp.alt && a.barrier.hp > 1 && t > a.barrier.brokenUntil;
      if (want && !a.barrier.up) w.sfx('barrierup', a.pos, a);
      a.barrier.up = want;
    }
    if (S.id === 'zoom') a.sv.zoom = inp.alt ? 1 : 0;
  }
  const busy = a.barrier.up || (a.forced && a.forced.kind !== 'knock' && a.forced.kind !== 'pull');
  // ---- quick melee (interrupts a reload, not a wind-up already in flight)
  if (inp.melee && !busy && t >= a.nextMelee && t >= a.nextShot - (1 / a.rate(P.rate)) * 0.5) { quickMelee(w, a); a.nextShot = Math.max(a.nextShot, t + 0.35); }
  // ---- primary
  if (P.kind === 'charge') {
    if (inp.fire && !busy && t >= a.nextShot) { if (!a.charging) w.sfx('bowdraw', a.pos, a); a.charging = true; a.charge = Math.min(1, a.charge + dt / 0.9); }
    else if (a.charging) {
      a.charging = false;
      if (!busy) fire(w, a, P, 'primary', 0.3 + 0.7 * a.charge);
      a.charge = 0; a.nextShot = t + 1 / a.rate(P.rate) * 0.6;
    }
  } else if (P.kind === 'beam') {
    const on = inp.fire && !busy;
    if (on && !a.flameOn) w.sfx('flamestart', a.pos, a);
    a.flameOn = on;
    if (on && t >= a.nextShot) {
      a.nextShot = t + 1 / a.rate(P.rate);
      a.anim.attackAt = t; a.anim.attackKind = 'primary';
      breakStealth(w, a);
      const range = P.range * (a.has('asura', t) ? 1.5 : 1) * a.scale;
      const e = a.eye, d = a.aimDir();
      for (const x of w.enemies(a)) {
        const c = x.center, v = { x: c.x - e.x, y: c.y - e.y, z: c.z - e.z }, l = Math.hypot(v.x, v.y, v.z);
        if (l > range + x.radius) continue;
        if ((v.x * d.x + v.y * d.y + v.z * d.z) / l < Math.cos(0.26) && l > 1.5) continue;
        if (!w.level.lineOfSight(e, c)) continue;
        const bh = w.barrierHit(a.team, e, norm(v), l);
        if (bh) { w.hitBarrier(bh.owner, P.damage / P.rate, a, c); continue; }
        w.damage(a, x, P.damage / P.rate, { kind: 'beam' });
      }
    }
  } else if (inp.fire && !busy && t >= a.nextShot && !a.reloadUntil && P.damage > 0) {
    if (!P.ammo || a.ammo > 0) {
      fire(w, a, P, 'primary');
      a.nextShot = t + 1 / a.rate(P.rate);
      if (P.ammo) { a.ammo--; if (a.ammo <= 0) { a.reloadUntil = t + a.reloadTime(P.reload ?? 1.5); w.sfx('reload', a.pos, a); } }
    }
  }
  // ---- secondary weapons
  if (!isAbility(S)) {
    if (S.kind === 'beam') {
      // heal beam: lock onto the ally under the crosshair and stay on them
      let tg = a.beamTarget;
      if (inp.alt && !busy) {
        const keep = tg && tg.alive && dist3(tg.center, a.eye) < S.range + 4 && w.level.lineOfSight(a.eye, tg.center);
        if (!keep) tg = w.coneTarget(a, S.range, 22, x => x.team === a.team);
        if (tg && !a.beamOn) w.sfx(S.sfx, a.pos, a);
        a.beamTarget = tg; a.beamOn = !!tg;
        if (tg && t >= a.nextAlt) {
          a.nextAlt = t + 1 / a.rate(S.rate);
          a.anim.attackAt = t; a.anim.attackKind = 'secondary';
          w.heal(a, tg, S.damage / S.rate, true);
        }
      } else { a.beamOn = false; a.beamTarget = null; }
    } else if (inp.alt && !busy && t >= a.nextAlt) {
      a.nextAlt = t + 1 / a.rate(S.rate);
      fire(w, a, S, 'secondary');
    }
  }
}
