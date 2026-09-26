// Ability implementations. Each returns true when it actually fired (so cooldown / ult charge is spent).
import { isAbility } from '../data/heroes';
import type { V3 } from '../engine/Physics';
import type { Actor } from './Actor';
import { dist3, norm, type Proj, type World, type Zone } from './World';

let ZID = 1;
type Impl = (w: World, a: Actor) => boolean;

const CC = ['stun', 'root', 'silence', 'grounded', 'tethered'];
const DEBUFF = ['brand', 'bleed', 'antiheal', 'slow', 'vuln', ...CC];

function ccBlocked(w: World, x: Actor) { return x.has('ccimmune', w.time) || x.has('linked', w.time); }
function applyCC(w: World, src: Actor, x: Actor, kind: string, dur: number): boolean {
  if (ccBlocked(w, x)) {
    w.fx('immune', x.center, { color: '#bfe8ff', actor: x });
    if (x.has('linked', w.time) && src.def.id === 'nocturne') {
      const m = w.actors.find(o => o.def.id === 'mirei' && o.team === x.team);
      if (m) w.emit({ t: 'counter', actor: m, target: src, text: 'Constellation Link shrugs off Silence Aria' });
    }
    return false;
  }
  x.set(kind, w.time, dur, undefined, src);
  if (kind === 'root' || kind === 'stun') { if (x.forced && x.forced.kind !== 'knock') interrupt(w, x, src); }
  return true;
}
/** cancel dashes, charges and channels */
function interrupt(w: World, x: Actor, by: Actor) {
  const f = x.forced;
  if (f && ['abysscharge', 'flashstep', 'dawndrive', 'dawncharge', 'chainpull', 'sunhop'].includes(f.kind)) {
    x.forced = null; x.vel.x *= 0.1; x.vel.z *= 0.1;
    w.fx('interrupt', x.center, { color: '#ffffff', actor: x }); w.sfx('interrupt', x.center);
    if (f.kind === 'abysscharge' && by.def.id === 'tenkai') w.emit({ t: 'counter', actor: by, target: x, text: 'Dawn Anchor stops the Abyss Charge' });
    if (f.kind === 'flashstep' && by.def.id === 'enra') w.emit({ t: 'counter', actor: by, target: x, text: 'Chain of Oblivion roots the Flash Step' });
    x.clear('charging'); x.sv.pinned = 0;
    return true;
  }
  return false;
}
function dash(a: Actor, dir: V3, dist: number, dur: number, kind: string, t: number, vy = 0, onEnd?: () => void) {
  a.forced = { vx: dir.x * dist / dur, vy, vz: dir.z * dist / dur, until: t + dur, kind, ignoreGravity: vy === 0 && kind !== 'knock', onEnd };
}
function flatDir(a: Actor): V3 { const f = a.forward(); return { x: f.x, y: 0, z: f.z }; }
function moveDir(a: Actor): V3 {
  const i = a.input;
  if (Math.hypot(i.mx, i.mz) < 0.2) return flatDir(a);
  const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), rx = -Math.cos(a.yaw), rz = Math.sin(a.yaw);
  return norm({ x: fx * i.mz + rx * i.mx, y: 0, z: fz * i.mz + rz * i.mx });
}
function zone(w: World, a: Actor, kind: string, p: V3, r: number, dur: number, data?: any): Zone {
  const z: Zone = { id: ZID++, kind, owner: a, team: a.team, x: p.x, y: p.y, z: p.z, r, born: w.time, until: w.time + dur, next: w.time, data };
  w.zones.push(z);
  return z;
}
const inZone = (z: Zone, x: Actor) => Math.hypot(x.pos.x - z.x, x.pos.z - z.z) < z.r + x.radius * 0.5 && x.pos.y > z.y - 2 && x.pos.y < z.y + 6;
function sealed(w: World, a: Actor) {
  if (a.has('sealed', w.time)) { w.fx('blocked', a.center, { color: '#ffe28a', actor: a }); w.sfx('denied', a.pos, a); return true; }
  return false;
}
/** safe teleport destination along a direction */
function blinkTarget(w: World, a: Actor, dir: V3, dist: number): V3 {
  const o = { x: a.pos.x, y: a.pos.y + 1, z: a.pos.z };
  const h = w.level.ray(o, dir, dist);
  let d = h ? Math.max(0, h.t - a.radius - 0.2) : dist;
  for (; d > 0; d -= 0.5) {
    const p = { x: o.x + dir.x * d, y: 0, z: o.z + dir.z * d };
    const g = w.level.groundAt(p.x, p.z, a.pos.y + 1.5 + dir.y * d, a.radius);
    if (g > -Infinity && g > a.pos.y - 6) { p.y = g; return p; }
  }
  return { ...a.pos };
}

const I: Record<string, Impl> = {
  // ================================================================ Tenkai-Oh
  anchor(w, a) {
    const muz = w.muzzle(a), aim = w.aimPoint(a, 25);
    w.spawnProj(a, muz, norm({ x: aim.x - muz.x, y: aim.y - muz.y, z: aim.z - muz.z }), 48, { dmg: 40, fx: 'fist', special: 'anchor', life: 25 / 48, r: 0.5 });
    w.sfx('rocketfist', muz, a);
    return true;
  },
  sunburst(w, a) {
    for (const x of w.allies(a)) if (dist3(x.pos, a.pos) < 10) {
      const had = DEBUFF.filter(s => x.has(s, w.time));
      for (const s of DEBUFF) x.clear(s);
      w.zones = w.zones.filter(z => !(z.kind === 'tether' && z.data?.target === x));
      x.set('ccimmune', w.time, 2);
      if (had.includes('brand') || had.includes('antiheal')) {
        const foe = x.src.brand ?? w.actors.find(o => o.def.id === (had.includes('brand') ? 'enra' : 'hex') && o.team !== a.team);
        if (foe) w.emit({ t: 'counter', actor: a, target: foe, text: had.includes('brand') ? 'Purging Sunburst burns away the Eclipse Brand' : 'Purging Sunburst purges the Grievous Hex' });
      }
    }
    for (const x of w.enemies(a)) if (dist3(x.pos, a.pos) < 10) w.damage(a, x, 30, { kind: 'ability' });
    w.fx('sunburst', a.center, { r: 10, color: '#ffd76a', actor: a }); w.sfx('sunburst', a.center, a);
    return true;
  },
  dawndrive(w, a) {
    const f = flatDir(a), t = w.time;
    a.forced = { vx: f.x * 13, vy: 11, vz: f.z * 13, until: t + 0.95, kind: 'dawndrive' };
    a.set('ccimmune', t, 1.3);
    w.sfx('ultcall', a.center, a); w.fx('ultflash', a.center, { color: '#ffd76a', actor: a });
    w.after(0.95, () => {
      if (!a.alive) return;
      a.vel.y = -30;
      w.after(0.12, () => {
        if (!a.alive) return;
        const p = { ...a.pos };
        for (const x of w.enemies(a)) if (dist3(x.pos, p) < 8) { w.damage(a, x, 200, { kind: 'ability' }); applyCC(w, a, x, 'stun', 1.5); }
        w.fx('slam', p, { r: 8, color: '#ffd76a', actor: a }); w.sfx('slam', p, a);
      });
    });
    return true;
  },
  dawncharge(w, a) {
    // a thruster-driven shoulder charge: steerable, pins the first enemy it meets, knocks everyone else aside
    const d = flatDir(a), t = w.time;
    a.sv.pinned = 0; a.sv.chargeWall = 0; a.sv.chargeStart = t; a.sv.chargeYaw = Math.atan2(d.x, d.z);
    (a as any)._chargeHit = new Set<number>();
    const sp = 17 * (a.scale > 1 ? 1.25 : 1);
    a.forced = { vx: d.x * sp, vy: 0, vz: d.z * sp, until: t + 2.2, kind: 'dawncharge', onEnd: () => {
      const pin = w.actors.find(x => x.id === a.sv.pinned);
      if (pin && pin.alive) {
        const wall = a.sv.chargeWall === 1;
        w.damage(a, pin, wall ? 250 : 80, { kind: 'ability' }); applyCC(w, a, pin, 'stun', wall ? 1.0 : 0.4);
        w.fx('slam', pin.pos, { r: wall ? 3.5 : 2, color: '#ffd76a', actor: a }); w.sfx(wall ? 'slam' : 'punch', pin.pos, a);
      } else if (a.sv.chargeWall === 1) { w.fx('slam', a.pos, { r: 2.5, color: '#ffd76a', actor: a }); w.sfx('mechland', a.pos, a); }
      a.sv.pinned = 0; a.vel.x *= 0.2; a.vel.z *= 0.2;
    } };
    a.set('charging', t, 2.2);
    w.sfx('charge', a.center, a); w.sfx('mechjump', a.pos, a); w.fx('chargetrail', a.center, { actor: a, color: '#ffd76a', dur: 2.2 });
    return true;
  },
  shatter(w, a) {
    // raise the hammer overhead, slam it down: a ground shockwave cone knocks down everything standing in front
    const t = w.time;
    a.forced = { vx: 0, vy: 0, vz: 0, until: t + 0.75, kind: 'shatter' };
    a.set('ccimmune', t, 0.6);
    w.sfx('ultcall', a.center, a);
    w.after(0.55, () => {
      if (!a.alive) return;
      const d = flatDir(a), o = { x: a.pos.x + d.x * 1.2 * a.scale, y: a.pos.y, z: a.pos.z + d.z * 1.2 * a.scale };
      const len = 16 * (a.scale > 1 ? 1.4 : 1), half = 0.42;
      for (const x of w.enemies(a)) {
        const v = { x: x.pos.x - o.x, z: x.pos.z - o.z }, along = v.x * d.x + v.z * d.z;
        if (along < -1 || along > len + x.radius) continue;
        const lat = Math.abs(v.x * -d.z + v.z * d.x);
        if (lat > Math.max(1.5, along * Math.tan(half)) + x.radius) continue;
        // it travels along the ground: fliers, jumpers and anything high above the slam point are untouched
        const g = w.level.groundAt(x.pos.x, x.pos.z, x.pos.y + 0.5);
        if (x.flying || x.pos.y - g > 0.6 || Math.abs(x.pos.y - a.pos.y) > 3) continue;
        const dir = norm({ x: v.x, y: 0, z: v.z }), bh = w.barrierHit(a.team, { x: o.x, y: o.y + 0.5, z: o.z }, dir, Math.hypot(v.x, v.z));
        if (bh) { w.hitBarrier(bh.owner, 300, a, bh.owner.center); continue; }
        w.damage(a, x, 90, { kind: 'ability' }); applyCC(w, a, x, 'stun', 1.6);
      }
      w.fx('shatter', o, { to: { x: o.x + d.x * len, y: o.y, z: o.z + d.z * len }, r: len, color: '#ffd76a', actor: a });
      w.sfx('slam', o, a); w.sfx('boom', o, a);
    });
    return true;
  },
  pilotroll(w, a) {
    dash(a, moveDir(a), 5, 0.3, 'roll', w.time);
    w.sfx('dash', a.pos, a);
    return true;
  },
  callmech(w, a) {
    // Tenkai-Oh drops out of the sky onto the pilot: full frame, the mech's saved ult comes back with it
    const t = w.time, def = a.baseDef, keep = a.sv.mechUlt ?? 0;
    a.def = def;
    a.hp = def.hp; a.maxArmor = def.armor; a.armor = def.armor; a.shields = [];
    if (a.barrier.max) a.barrier = { hp: a.barrier.max, max: a.barrier.max, up: false, regenAt: 0, brokenUntil: 0 };
    a.ammo = 'ammo' in def.primary && def.primary.ammo ? def.primary.ammo : 0; a.reloadUntil = 0; a.nextShot = t + 0.5;
    a.flight = 100; a.set('ccimmune', t, 1); a.set('spawnprot', t, 0.6);
    w.after(0.01, () => { a.ult = keep; });                  // castAbility zeroes the gauge after this returns
    for (const x of w.enemies(a)) if (dist3(x.pos, a.pos) < 5) { w.damage(a, x, 50, { kind: 'ability' }); }
    w.fx('ultflash', a.center, { color: def.glow, actor: a }); w.fx('slam', a.pos, { r: 5, color: def.glow, actor: a });
    w.sfx('mechland', a.pos, a); w.sfx('ultcall', a.center, a);
    w.emit({ t: 'msg', text: `${def.name.toUpperCase()} IS BACK`, color: def.color });
    return true;
  },
  colossus(w, a) {
    // Dawn Colossus Awakening: a pillar of dawnlight, a hop while the frame grows (World scales it up), a landing stomp
    const t = w.time;
    a.set('titan', t, 60);
    a.set('ccimmune', t, 1.4);
    a.maxArmor = a.def.armor + 800; a.armor = Math.min(a.maxArmor, a.armor + 800);
    a.forced = { vx: 0, vy: 7, vz: 0, until: t + 0.45, kind: 'ascend' };
    w.sfx('ultcall', a.center, a); w.sfx('mechjump', a.pos, a);
    w.fx('ultflash', a.center, { color: '#ffd76a', actor: a }); w.fx('burst', a.center, { r: 5, color: '#ffd76a' });
    w.emit({ t: 'msg', text: 'TENKAI-OH · DAWN COLOSSUS AWAKENS', color: '#ffd76a' });
    w.after(1.1, () => {
      if (!a.alive) return;
      const p = { ...a.pos };
      for (const x of w.enemies(a)) if (dist3(x.pos, p) < 9) { w.damage(a, x, 120, { kind: 'ability' }); applyCC(w, a, x, 'stun', 1); }
      w.fx('slam', p, { r: 9, color: '#ffd76a', actor: a }); w.sfx('slam', p, a); w.sfx('mechland', p, a);
    });
    return true;
  },
  // ================================================================ Mirei
  constellation(w, a) {
    const linked = w.allies(a).filter(x => dist3(x.pos, a.pos) < 15 && w.level.lineOfSight(a.eye, x.center));
    for (const x of linked) {
      x.set('linked', w.time, 5, undefined, a);
      for (const s of ['silence', 'grounded', 'root']) x.clear(s);
      w.fx('link', a.center, { target: x, actor: a, color: '#bfe8ff', dur: 5 });
    }
    w.sfx('constellation', a.center, a);
    return true;
  },
  wish(w, a) {
    const tg = w.coneTarget(a, 30, 12, x => x.team === a.team) ?? a;
    w.shield(tg, 300, 4, 'wish');
    w.fx('wish', tg.center, { actor: tg, color: '#bfe8ff', dur: 4 }); w.sfx('wish', tg.center, a);
    return true;
  },
  nova(w, a) {
    for (const x of w.allies(a)) if (dist3(x.pos, a.pos) < 25) { x.set('hot', w.time, 2.5, 140, a); x.set('dmgamp', w.time, 4); }
    w.fx('nova', a.center, { r: 25, color: '#bfe8ff', actor: a }); w.sfx('nova', a.center, a);
    return true;
  },
  // ================================================================ Kaien
  spiritstep(w, a) {
    if (sealed(w, a)) return false;
    const from = { ...a.pos };
    const p = blinkTarget(w, a, moveDir(a), 10);
    a.pos = p; a.vel = { x: 0, y: 0, z: 0 };
    w.fx('papers', from, { color: '#fff6d8' }); w.fx('papers', p, { color: '#fff6d8' }); w.sfx('spiritstep', p, a);
    return true;
  },
  seal(w, a) {
    const p = w.groundPoint(a, 20);
    zone(w, a, 'seal', p, 7, 6);
    w.fx('sealcast', p, { r: 7, color: '#ffe28a' }); w.sfx('seal', p, a);
    return true;
  },
  sanctuary(w, a) {
    zone(w, a, 'sanctuary', { ...a.pos }, 10, 5);
    w.fx('sanctuarycast', a.pos, { r: 10, color: '#ffe28a' }); w.sfx('sanctuary', a.pos, a);
    return true;
  },
  // ================================================================ Raijin
  flashstep(w, a) {
    if (sealed(w, a) || a.has('root', w.time)) return false;
    const d = moveDir(a);
    a.sv.dashHits = 0;
    (a as any)._dashHit = new Set<number>();
    dash(a, d, 12, 0.2, 'flashstep', w.time);
    w.fx('flash', a.center, { color: '#8ad8ff', actor: a, dur: 0.25 }); w.sfx('flashstep', a.center, a);
    return true;
  },
  parry(w, a) {
    a.set('parry', w.time, 1.2);
    w.fx('parrystance', a.center, { color: '#8ad8ff', actor: a, dur: 1.2 }); w.sfx('parrystance', a.center, a);
    return true;
  },
  judgment(w, a) {
    a.set('judgment', w.time, 6);
    a.cd.flashstep = 0;
    w.fx('ultflash', a.center, { color: '#8ad8ff', actor: a }); w.sfx('ultcall', a.center, a); w.sfx('thunderclap', a.center, a);
    return true;
  },
  // ================================================================ Yuzu
  sunhop(w, a) {
    a.vel.y = 13; a.grounded = false; a.set('glide', w.time, 1.8); a.anim.jumpAt = w.time;
    w.fx('sunhop', a.pos, { color: '#ffd27a' }); w.sfx('sunhop', a.pos, a);
    return true;
  },
  reveal(w, a) {
    const muz = w.muzzle(a), aim = w.aimPoint(a, 60);
    w.spawnProj(a, muz, norm({ x: aim.x - muz.x, y: aim.y - muz.y, z: aim.z - muz.z }), 90, { dmg: 20, fx: 'reveal', special: 'reveal', life: 60 / 90, r: 0.15 });
    w.sfx('bow', muz, a);
    return true;
  },
  hundredsuns(w, a) {
    const p = w.groundPoint(a, 50);
    zone(w, a, 'arrows', p, 8, 3, { left: 40 });
    w.fx('arrowsmark', p, { r: 8, color: '#ffd27a', dur: 3 }); w.sfx('ultcall', a.center, a); w.sfx('arrowrain', p, a);
    return true;
  },
  // ================================================================ Gorgoth
  plating(w, a) {
    w.shield(a, 250, 3, 'void');
    for (const x of w.allies(a, false)) if (dist3(x.pos, a.pos) < 8) { w.shield(x, 100, 3, 'void'); w.fx('voidshield', x.center, { actor: x, color: '#ff2244', dur: 3 }); }
    w.fx('voidshield', a.center, { actor: a, color: '#ff2244', dur: 3 }); w.sfx('plating', a.center, a);
    return true;
  },
  abysscharge(w, a) {
    const d = flatDir(a);
    a.sv.pinned = 0;
    dash(a, d, 15, 1.0, 'abysscharge', w.time, 0, () => {
      const pin = w.actors.find(x => x.id === a.sv.pinned);
      if (pin && pin.alive) { w.damage(a, pin, 60, { kind: 'ability' }); applyCC(w, a, pin, 'stun', 0.6); w.fx('slam', pin.pos, { r: 2.5, color: '#ff2244' }); w.sfx('slam', pin.pos, a); }
      a.sv.pinned = 0;
    });
    a.set('charging', w.time, 1.0);
    w.sfx('charge', a.center, a); w.fx('chargetrail', a.center, { actor: a, color: '#ff2244', dur: 1 });
    return true;
  },
  nulllance(w, a) {
    const e = { x: a.pos.x, y: a.pos.y + a.height * 0.5, z: a.pos.z }, d = flatDir(a);
    a.anim.attackAt = w.time; a.anim.attackKind = 'lance';
    // barriers first: the lance is built to crack them
    for (const b of w.actors) {
      if (!b.alive || !b.barrier.up || b.team === a.team) continue;
      const bf = b.forward(), c = { x: b.pos.x + bf.x * 1.7, z: b.pos.z + bf.z * 1.7 };
      const along = (c.x - a.pos.x) * d.x + (c.z - a.pos.z) * d.z, lat = Math.abs((c.x - a.pos.x) * -d.z + (c.z - a.pos.z) * d.x);
      if (along > 0 && along < 9 && lat < 2.6) w.hitBarrier(b, 70 * 4, a, { x: c.x, y: b.pos.y + 1.5, z: c.z });
    }
    for (const x of w.enemies(a)) {
      const v = { x: x.pos.x - a.pos.x, z: x.pos.z - a.pos.z };
      const along = v.x * d.x + v.z * d.z, lat = Math.abs(v.x * -d.z + v.z * d.x);
      if (along < 0 || along > 8 + x.radius || lat > 1.2 + x.radius || Math.abs(x.pos.y - a.pos.y) > 3) continue;
      w.damage(a, x, 70, { kind: 'ability', shieldMult: 4 });
    }
    w.fx('lance', e, { to: { x: e.x + d.x * 8, y: e.y, z: e.z + d.z * 8 }, color: '#ff2244', actor: a }); w.sfx('lance', e, a);
    return true;
  },
  singularity(w, a) {
    const d = flatDir(a);
    const p0 = { x: a.pos.x + d.x * 15, y: a.pos.y + 1, z: a.pos.z + d.z * 15 };
    const h = w.level.ray({ x: a.pos.x, y: a.pos.y + 1, z: a.pos.z }, d, 15);
    const dd = h ? h.t - 1 : 15;
    const p = { x: a.pos.x + d.x * dd, y: 0, z: a.pos.z + d.z * dd };
    p.y = Math.max(w.level.groundAt(p.x, p.z, p0.y + 2), a.pos.y - 4);
    zone(w, a, 'singularity', p, 10, 2.5);
    w.fx('singularity', p, { r: 10, color: '#ff2244', dur: 2.5 }); w.sfx('ultcall', a.center, a); w.sfx('singularity', p, a);
    return true;
  },
  // ================================================================ Nocturne
  silence(w, a) {
    const e = a.eye, d = a.aimDir();
    for (const x of w.enemies(a)) {
      const c = x.center, v = { x: c.x - e.x, y: c.y - e.y, z: c.z - e.z }, l = Math.hypot(v.x, v.y, v.z);
      if (l > 12 + x.radius || (v.x * d.x + v.y * d.y + v.z * d.z) / l < Math.cos(0.45)) continue;
      if (!w.level.lineOfSight(e, c)) continue;
      if (!applyCC(w, a, x, 'silence', 1.5)) continue;
      if (x.def.frame === 'flyer') {
        x.set('grounded', w.time, 3, undefined, a); x.flying = false;
        if (x.def.id === 'mirei') w.emit({ t: 'counter', actor: a, target: x, text: 'Silence Aria grounds the Starweaver' });
      }
      if (x.forced?.kind === 'flashstep') { interrupt(w, x, a); w.emit({ t: 'counter', actor: a, target: x, text: 'Silence Aria cuts the Flash Step' }); }
    }
    w.fx('soundcone', e, { to: { x: e.x + d.x * 12, y: e.y + d.y * 12, z: e.z + d.z * 12 }, color: '#ff4d6d', actor: a }); w.sfx('silence', e, a);
    return true;
  },
  bloodpact(w, a) {
    const tg = w.coneTarget(a, 30, 12, x => x.team === a.team) ?? a;
    tg.set('lifesteal', w.time, 4, 0.3); tg.set('speed', w.time, 4, 1.25);
    w.fx('bloodpact', tg.center, { actor: tg, color: '#ff2d55', dur: 4 }); w.sfx('bloodpact', tg.center, a);
    return true;
  },
  requiem(w, a) {
    for (const x of w.actors) {
      if (!x.alive || dist3(x.pos, a.pos) > 20) continue;
      if (x.team === a.team) x.set('hot', w.time, 3, 83, a);
      else x.set('bleed', w.time, 3, 33, a);
    }
    w.fx('requiem', a.center, { r: 20, color: '#ff2d55', actor: a }); w.sfx('ultcall', a.center, a); w.sfx('requiem', a.center, a);
    return true;
  },
  // ================================================================ Hex
  marionette(w, a) {
    const tg = w.coneTarget(a, 20, 9, x => x.team !== a.team && w.perceivable(a, x));
    if (!tg) return false;
    zone(w, a, 'tether', tg.pos, 0, 0.6, { target: tg });
    tg.set('tethered', w.time, 0.6, undefined, a);
    w.fx('strings', a.center, { target: tg, actor: a, color: '#c77dff', dur: 0.6 }); w.sfx('strings', a.center, a);
    w.after(0.6, () => {
      if (!a.alive || !tg.alive || !tg.has('tethered', w.time - 0.05) || tg.src.tethered !== a) return;
      tg.clear('tethered');
      if (ccBlocked(w, tg)) { w.fx('immune', tg.center, { actor: tg }); return; }
      const d = norm({ x: a.pos.x - tg.pos.x, y: 0, z: a.pos.z - tg.pos.z });
      const dist = Math.min(8, Math.max(0, dist3(a.pos, tg.pos) - 2));
      tg.forced = { vx: d.x * dist / 0.3, vy: 2, vz: d.z * dist / 0.3, until: w.time + 0.3, kind: 'pull' };
      w.after(0.3, () => applyCC(w, a, tg, 'root', 1));
      w.sfx('yank', tg.center, a);
    });
    return true;
  },
  grievous(w, a) {
    const muz = w.muzzle(a), d = a.aimDir();
    w.spawnProj(a, muz, norm({ x: d.x, y: d.y + 0.2, z: d.z }), 26, { dmg: 0, fx: 'hexbomb', special: 'grievous', life: 3, r: 0.25, grav: 16 });
    w.sfx('throw', muz, a);
    return true;
  },
  theater(w, a) {
    for (const x of w.enemies(a)) {
      if (dist3(x.pos, a.pos) > 15 || !w.level.lineOfSight(a.eye, x.center)) continue;
      x.set('vuln', w.time, 2.5, undefined, a);
      applyCC(w, a, x, 'root', 2.5);
      w.fx('strings', a.center, { target: x, actor: a, color: '#c77dff', dur: 2.5 });
    }
    w.fx('theater', a.center, { r: 15, color: '#c77dff', actor: a }); w.sfx('ultcall', a.center, a); w.sfx('theater', a.center, a);
    return true;
  },
  // ================================================================ Kagemaru
  shadowstep(w, a) {
    if (sealed(w, a)) return false;
    const from = { ...a.pos };
    const aim = w.aimPoint(a, 15);
    const d = norm({ x: aim.x - a.pos.x, y: 0, z: aim.z - a.pos.z });
    const dist = Math.min(15, Math.hypot(aim.x - a.pos.x, aim.z - a.pos.z));
    const p = blinkTarget(w, a, d, dist);
    a.pos = p; a.vel = { x: 0, y: 0, z: 0 };
    w.fx('smoke', from, { color: '#5a3d8c' }); w.fx('smoke', p, { color: '#5a3d8c' }); w.sfx('shadowstep', p, a);
    return true;
  },
  veil(w, a) {
    if (sealed(w, a)) {
      const k = w.actors.find(o => o.def.id === 'kaien' && o.team !== a.team);
      if (k) w.emit({ t: 'counter', actor: k, target: a, text: 'Warding Seal denies the Veil of Night' });
      return false;
    }
    a.set('stealth', w.time, 4);
    w.fx('smoke', a.pos, { color: '#5a3d8c' }); w.sfx('veil', a.pos, a);
    return true;
  },
  thousandcuts(w, a) {
    const tgs = w.enemies(a).filter(x => dist3(x.pos, a.pos) < 15 && w.level.lineOfSight(a.eye, x.center)).sort((p, q) => dist3(p.pos, a.pos) - dist3(q.pos, a.pos)).slice(0, 5);
    if (!tgs.length) return false;
    a.set('phased', w.time, tgs.length * 0.2 + 0.1);
    w.sfx('ultcall', a.center, a);
    tgs.forEach((x, i) => w.after(0.1 + i * 0.2, () => {
      if (!a.alive) return;
      const from = { ...a.center };
      if (x.alive) {
        const b = x.forward();
        const p = { x: x.pos.x - b.x * 1.4, y: x.pos.y, z: x.pos.z - b.z * 1.4 };
        const g = w.level.groundAt(p.x, p.z, x.pos.y + 1);
        a.pos = { x: p.x, y: g > -Infinity ? g : x.pos.y, z: p.z };
        a.yaw = a.input.yaw = Math.atan2(x.pos.x - a.pos.x, x.pos.z - a.pos.z);
        a.clear('phased'); w.damage(a, x, 120, { kind: 'ability' }); a.set('phased', w.time, (tgs.length - i) * 0.2);
        a.anim.attackAt = w.time; a.anim.attackKind = 'secondary';
      }
      w.fx('cut', from, { to: a.center, color: '#9d7bff' }); w.sfx('cut', a.center, a);
    }));
    return true;
  },
  // ================================================================ Enra
  chain(w, a) {
    const muz = w.muzzle(a), aim = w.aimPoint(a, 18);
    w.spawnProj(a, muz, norm({ x: aim.x - muz.x, y: aim.y - muz.y, z: aim.z - muz.z }), 55, { dmg: 25, fx: 'chain', special: 'chain', life: 18 / 55, r: 0.35 });
    w.sfx('chainthrow', muz, a);
    return true;
  },
  brand(w, a) {
    const f = flatDir(a);
    for (const x of w.enemies(a)) {
      const v = { x: x.pos.x - a.pos.x, z: x.pos.z - a.pos.z }, l = Math.hypot(v.x, v.z);
      if (l > 6 + x.radius || (v.x * f.x + v.z * f.z) / (l || 1) < Math.cos(0.62) || Math.abs(x.pos.y - a.pos.y) > 3) continue;
      x.set('brand', w.time, 5, undefined, a); x.set('slow', w.time, 5);
    }
    w.fx('brandcone', a.center, { to: { x: a.pos.x + f.x * 6, y: a.pos.y + 1, z: a.pos.z + f.z * 6 }, color: '#ff6a2a', actor: a }); w.sfx('brand', a.center, a);
    return true;
  },
  asura(w, a) {
    a.set('asura', w.time, 8);
    a.scale = 1.25; a.maxArmor = a.def.armor + 150; a.armor += 150;
    w.fx('ultflash', a.center, { color: '#ff6a2a', actor: a }); w.sfx('ultcall', a.center, a); w.sfx('roar', a.center, a);
    return true;
  },
};

// ------------------------------------------------------------------ projectile specials
function onProj(w: World, p: Proj, at: V3, hit: Actor | null) {
  const a = p.owner, t = w.time;
  switch (p.special) {
    case 'anchor': {
      if (hit) {
        w.damage(a, hit, 40, { kind: 'ability' });
        interrupt(w, hit, a);
        if (hit.def.frame !== 'mech' || hit.forced == null) {
          const d = norm({ x: a.pos.x - hit.pos.x, y: 0, z: a.pos.z - hit.pos.z });
          const dist = Math.max(0, dist3(a.pos, hit.pos) * 0.7 - 1.5);
          if (!ccBlocked(w, hit)) hit.forced = { vx: d.x * dist / 0.35, vy: 3, vz: d.z * dist / 0.35, until: t + 0.35, kind: 'pull' };
        }
        w.fx('chainline', a.center, { target: hit, color: '#ffd76a', dur: 0.35 }); w.sfx('anchorhit', at, a);
      }
      w.fx('impact', at, { color: '#ffd76a' });
      break;
    }
    case 'reveal': {
      for (const x of w.enemies(a)) if (dist3(x.pos, at) < 10) {
        if (x.has('stealth', t) && x.def.id === 'kagemaru') w.emit({ t: 'counter', actor: a, target: x, text: 'Revealing Dawn Arrow exposes the Shade Fang' });
        x.set('revealed', t, 5); x.clear('stealth');
      }
      let severed = false;
      for (const x of w.allies(a)) if (dist3(x.pos, at) < 10) {
        if (x.has('tethered', t)) { x.clear('tethered'); severed = true; }
        if (x.has('antiheal', t)) { x.clear('antiheal'); severed = true; }
      }
      for (const z of w.zones) if (z.team !== a.team && (z.kind === 'grievous' || z.kind === 'tether') && Math.hypot(z.x - at.x, z.z - at.z) < 10 + z.r) { z.until = t; severed = true; }
      if (hit) w.damage(a, hit, 20, { kind: 'proj' });
      if (severed) { const hx = w.actors.find(o => o.def.id === 'hex' && o.team !== a.team); if (hx) w.emit({ t: 'counter', actor: a, target: hx, text: 'Dawn Arrow severs the Marionette Strings' }); }
      w.fx('revealburst', at, { r: 10, color: '#ffd27a' }); w.sfx('reveal', at, a);
      break;
    }
    case 'grievous': {
      const g = w.level.groundAt(at.x, at.z, at.y + 0.5);
      zone(w, a, 'grievous', { x: at.x, y: g > -Infinity ? g : at.y, z: at.z }, 6, 4);
      w.fx('hexburst', at, { r: 6, color: '#c77dff', dur: 4 }); w.sfx('hexburst', at, a);
      break;
    }
    case 'chain': {
      if (hit) {
        w.damage(a, hit, 25, { kind: 'ability' });
        const wasDash = hit.forced?.kind === 'flashstep';
        interrupt(w, hit, a);
        const rooted = applyCC(w, a, hit, 'root', 1.2);
        if (wasDash && rooted && hit.def.id === 'raijin' && a.def.id === 'enra') void 0;   // counter text emitted by interrupt()
        else if (rooted && hit.def.id === 'raijin' && a.def.id === 'enra') w.emit({ t: 'counter', actor: a, target: hit, text: 'Chain of Oblivion locks Raijin down' });
        // haul the thrower in
        const d = norm({ x: hit.pos.x - a.pos.x, y: 0, z: hit.pos.z - a.pos.z });
        const dist = Math.max(0, dist3(a.pos, hit.pos) - 2);
        if (dist > 0.5) dash(a, d, dist, Math.max(0.15, dist / 30), 'chainpull', t);
        w.fx('chainline', a.center, { target: hit, color: '#ff6a2a', dur: 0.4 }); w.sfx('chainhit', at, a);
      }
      break;
    }
  }
}

// ------------------------------------------------------------------ per-step upkeep for zones and dashes
export function tickAbilities(w: World, dt: number) {
  const t = w.time;
  for (const z of w.zones) {
    if (t < z.next) continue;
    z.next = t + 0.25;
    const k = 0.25;
    if (z.kind === 'seal') {
      for (const x of w.actors) if (x.alive && inZone(z, x)) {
        if (x.team !== z.team) {
          x.set('sealed', t, 0.35); x.set('revealed', t, 0.35);
          w.damage(z.owner, x, 15 * k, { kind: 'dot', noLifesteal: true });
        } else w.heal(z.owner, x, 20 * k, true);
      }
    } else if (z.kind === 'sanctuary') {
      for (const x of w.allies(z.owner)) if (inZone(z, x)) { x.set('undying', t, 0.35); w.heal(z.owner, x, 60 * k, true); }
    } else if (z.kind === 'grievous') {
      for (const x of w.actors) if (x.alive && x.team !== z.team && inZone(z, x)) {
        x.set('antiheal', t, 0.5, undefined, z.owner);
        w.damage(z.owner, x, 10 * k, { kind: 'dot', noLifesteal: true });
      }
    } else if (z.kind === 'singularity') {
      for (const x of w.actors) {
        if (!x.alive || x.team === z.team || x.def.frame === 'mech' || ccBlocked(w, x)) continue;
        const d = Math.hypot(x.pos.x - z.x, x.pos.z - z.z);
        if (d > z.r || d < 0.6) continue;
        x.forced = { vx: (z.x - x.pos.x) / d * 7, vy: 0.6, vz: (z.z - x.pos.z) / d * 7, until: t + 0.25, kind: 'pull' };
      }
      if (z.until - t <= 0.26) {
        for (const x of w.enemies(z.owner)) if (Math.hypot(x.pos.x - z.x, x.pos.z - z.z) < 6) w.damage(z.owner, x, 150, { kind: 'ability' });
        w.fx('implode', { x: z.x, y: z.y + 1, z: z.z }, { r: 6, color: '#ff2244' }); w.sfx('implode', { x: z.x, y: z.y, z: z.z });
      }
    }
  }
  // arrow rain: finer tick
  for (const z of w.zones) if (z.kind === 'arrows' && z.data.left > 0 && t - z.born > (40 - z.data.left) * 0.075) {
    z.data.left--;
    const ang = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * z.r;
    const p = { x: z.x + Math.cos(ang) * r, y: z.y, z: z.z + Math.sin(ang) * r };
    for (const x of w.enemies(z.owner)) if (Math.hypot(x.pos.x - p.x, x.pos.z - p.z) < 1.8 + x.radius) w.damage(z.owner, x, 25, { kind: 'ability' });
    w.fx('arrowhit', p, { color: '#ffd27a' });
    if (z.data.left % 4 === 0) w.sfx('arrowhit', p);
  }
  // dashes that interact with enemies on the way
  for (const a of w.actors) {
    if (!a.alive || !a.forced) continue;
    if (a.forced.kind === 'flashstep') {
      const hit: Set<number> = (a as any)._dashHit ?? new Set();
      for (const x of w.enemies(a)) if (!hit.has(x.id) && dist3(x.center, a.center) < 1.6 + x.radius) { hit.add(x.id); w.damage(a, x, 50, { kind: 'ability' }); w.fx('slash', x.center, { color: '#8ad8ff' }); }
    } else if (a.forced.kind === 'dawncharge') {
      // steer toward the aim (slowly: a charging mech carries its momentum)
      const cur = a.sv.chargeYaw ?? a.yaw;
      let dy = a.input.yaw - cur; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      const ny = cur + Math.max(-1.3 * dt, Math.min(1.3 * dt, dy));
      a.sv.chargeYaw = ny; a.yaw = ny;
      const sp = Math.hypot(a.forced.vx, a.forced.vz);
      a.forced.vx = Math.sin(ny) * sp; a.forced.vz = Math.cos(ny) * sp;
      const hit: Set<number> = (a as any)._chargeHit ?? new Set();
      let pin = w.actors.find(x => x.id === a.sv.pinned);
      for (const x of w.enemies(a)) {
        if (x === pin || hit.has(x.id) || dist3(x.pos, a.pos) > a.radius + x.radius + 0.7 || Math.abs(x.pos.y - a.pos.y) > 2.5 * a.scale) continue;
        hit.add(x.id);
        if (x.forced?.kind === 'abysscharge') {
          // COUNTER: two charging mechs meet head-on - the Abyss Charge breaks, Gorgoth is dazed
          interrupt(w, x, a); applyCC(w, a, x, 'stun', 1.2); w.damage(a, x, 80, { kind: 'ability' });
          w.emit({ t: 'counter', actor: a, target: x, text: 'Dawn Charge breaks the Abyss Charge head-on' });
          w.fx('slam', x.pos, { r: 3, color: '#ffd76a', actor: a }); w.sfx('slam', x.pos, a);
          a.forced.until = t; break;
        }
        if (!pin && !ccBlocked(w, x) && x.def.frame !== 'mech' && !x.isBoss) { pin = x; a.sv.pinned = x.id; w.sfx('pin', x.center, a); continue; }
        if (x.def.frame === 'mech' || x.isBoss) { w.damage(a, x, 60, { kind: 'ability' }); a.forced.until = t; w.fx('slam', x.pos, { r: 2, color: '#ffd76a' }); break; }
        // knocked aside, away from the charge line
        const f = a.forward(), side = (x.pos.x - a.pos.x) * -f.z + (x.pos.z - a.pos.z) * f.x >= 0 ? 1 : -1;
        w.damage(a, x, 30, { kind: 'ability' });
        if (!ccBlocked(w, x)) x.forced = { vx: -f.z * side * 11 + f.x * 5, vy: 4, vz: f.x * side * 11 + f.z * 5, until: t + 0.3, kind: 'knock' };
      }
      (a as any)._chargeHit = hit;
      if (pin && pin.alive) {
        const f = a.forward();
        pin.pos = { x: a.pos.x + f.x * (a.radius + pin.radius + 0.2), y: a.pos.y, z: a.pos.z + f.z * (a.radius + pin.radius + 0.2) };
        pin.vel = { x: 0, y: 0, z: 0 }; pin.set('stun', t, 0.1);
        w.level.collide(pin.pos, pin.radius, pin.height);
      }
    } else if (a.forced.kind === 'abysscharge') {
      let pin = w.actors.find(x => x.id === a.sv.pinned);
      if (!pin) {
        pin = w.enemies(a).find(x => dist3(x.pos, a.pos) < a.radius + x.radius + 0.6 && Math.abs(x.pos.y - a.pos.y) < 2);
        if (pin) {
          if (ccBlocked(w, pin) || pin.def.frame === 'mech') { w.damage(a, pin, 60, { kind: 'ability' }); a.forced.until = t; pin = undefined; }
          else { a.sv.pinned = pin.id; w.sfx('pin', pin.center, a); }
        }
      }
      if (pin && pin.alive) {
        const f = a.forward();
        pin.pos = { x: a.pos.x + f.x * (a.radius + pin.radius + 0.2), y: a.pos.y, z: a.pos.z + f.z * (a.radius + pin.radius + 0.2) };
        pin.vel = { x: 0, y: 0, z: 0 }; pin.set('stun', t, 0.1);
        w.level.collide(pin.pos, pin.radius, pin.height);
      }
    }
  }
  void dt;
}

export function castAbility(w: World, a: Actor, id: string, slot: 'a1' | 'a2' | 'ult' | 'alt'): boolean {
  const t = w.time;
  if (id === 'none' || !I[id]) return false;
  if (slot !== 'ult' && !a.ready(id, t)) return false;
  if (a.forced && !['knock', 'pull'].includes(a.forced.kind) && id !== 'thousandcuts') return false;
  if (a.has('stealth', t) && id !== 'veil') { a.clear('stealth'); a.set('ambush', t, 0.6); }
  const ok = I[id](w, a);
  if (!ok) return false;
  const def = slot === 'a1' ? a.def.ability1 : slot === 'a2' ? a.def.ability2 : slot === 'ult' ? a.def.ult : (isAbility(a.def.secondary) ? a.def.secondary : null);
  if (slot === 'ult') a.ult = 0;
  else if (def) a.cd[id] = t + def.cooldown * (1 - a.mods.cdr) * (1 - (a.mods.cdrBy[id] ?? 0));   // Stadium cooldown items / powers
  a.anim.castAt = t; a.anim.castId = id;
  w.stats.casts[id] = (w.stats.casts[id] ?? 0) + 1;
  w.emit({ t: 'cast', actor: a, id, name: def?.name ?? id });
  return true;
}
castAbility.onProj = onProj;
