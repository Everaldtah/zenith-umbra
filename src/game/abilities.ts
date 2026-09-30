// Ability implementations. Each returns true when it actually fired (so cooldown / ult charge is spent).
import { isAbility, type WeaponDef } from '../data/heroes';
import type { V3 } from '../engine/Physics';
import type { Actor } from './Actor';
import { DEFLECT_SECS, dist3, norm, type Proj, type World, type Zone } from './World';
import { ignite, wound } from './weapons';
import { raisePuppets } from './puppets';
import { stellarRebirth } from './rebirth';
import { raiseEffigy } from './effigy';
import { raiseSusanoo } from './susanoo';

/** Hayate's Dragon Gate Blade: how long the nodachi stays drawn, and the blade he swings with it */
export const DRAGONBLADE_SECS = 15;
export const DRAGONBLADE: WeaponDef = { kind: 'melee', name: 'Dragon Gate Blade', damage: 110, rate: 1.25, range: 5, sfx: 'katana', fx: 'slash' };


let ZID = 1;
type Impl = (w: World, a: Actor) => boolean;

const CC = ['stun', 'root', 'silence', 'grounded', 'tethered'];
const DEBUFF = ['brand', 'bleed', 'wound', 'antiheal', 'slow', 'vuln', 'tidemark', ...CC];

function ccBlocked(w: World, x: Actor) { return x.has('ccimmune', w.time) || x.has('linked', w.time) || x.has('tachiai', w.time); }
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
/** Grand Dohyo: a hero bound by the ring's chains can't dash, leap or teleport (the chain holds) */
export const LEASHED = new Set(['spiritstep', 'flashstep', 'currentdash', 'riverstep', 'shadowstep', 'dawncharge', 'abysscharge', 'sunhop', 'chain', 'pilotroll']);
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
      x.wounds = [];
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
    w.shield(tg, 300, 4, 'wish', a);
    w.fx('wish', tg.center, { actor: tg, color: '#bfe8ff', dur: 4 }); w.sfx('wish', tg.center, a);
    return true;
  },
  rebirth(w, a) {
    // Stellar Rebirth: every teammate who fell in the last 10 s within 15 m stands up where they fell (rebirth.ts)
    stellarRebirth(w, a);
    return true;
  },
  nova(w, a) {
    // (the web edition's Nova Requiem)
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
  susanoo(w, a) {
    // Storm Sovereign: the thunder-god giant of himself rises where he stands (susanoo.ts)
    raiseSusanoo(w, a);
    w.fx('ultflash', a.center, { color: '#8ad8ff', actor: a }); w.fx('susanoocast', a.center, { r: 12, color: '#8ad8ff', actor: a, dur: 10 });
    w.sfx('ultcall', a.center, a); w.sfx('thunderclap', a.center, a);
    w.emit({ t: 'msg', text: 'RAIJIN \u00b7 STORM SOVEREIGN', color: a.def.color });
    return true;
  },
  judgment(w, a) {
    // (the web edition's Judgment)
    a.set('judgment', w.time, 6);
    a.cd.flashstep = 0;
    w.fx('ultflash', a.center, { color: '#8ad8ff', actor: a }); w.sfx('ultcall', a.center, a); w.sfx('thunderclap', a.center, a);
    return true;
  },
  // ================================================================ Hayate
  currentdash(w, a) {
    if (sealed(w, a) || a.has('root', w.time)) return false;
    const d = moveDir(a);
    a.sv.dashHits = 0;
    (a as any)._dashHit = new Set<number>();
    dash(a, d, 15, 0.22, 'flashstep', w.time);
    w.fx('flash', a.center, { color: '#4fe3c1', actor: a, dur: 0.25 }); w.sfx('flashstep', a.center, a);
    return true;
  },
  mirrorwater(w, a) {
    // after Genji's Deflect: for DEFLECT_SECS everything that comes at him from in front is turned on the blade -
    // projectiles and hitscan fire go back out along his aim, melee stops dead (World.damage and the projectile hits,
    // through World.deflected); E again ends it early, after DEFLECT_MIN
    if (a.has('deflect', w.time)) return false;
    a.set('deflect', w.time, DEFLECT_SECS); a.sv.deflectStart = w.time; a.anim.deflectN = 0;
    w.fx('parrystance', a.center, { color: '#4fe3c1', actor: a, dur: DEFLECT_SECS }); w.sfx('parrystance', a.center, a);
    return true;
  },
  dragongate(w, a) {
    // Dragon Gate Blade (after Genji's Dragonblade): 15 s with the nodachi drawn - the primary becomes a sweeping blade
    // (DRAGONBLADE: 110 a slash, 0.8 s apart, 5 m), he moves 30% faster and every slash streaks the koi-dragon through
    // what it cuts; Current Dash still resets on an elimination. World.step puts his own weapons back when it ends.
    if (a.has('dragonblade', w.time)) return false;
    a.set('dragonblade', w.time, DRAGONBLADE_SECS);
    a.def = { ...a.baseDef, primary: DRAGONBLADE };
    a.nextShot = w.time + 0.45;                        // the draw
    a.anim.castAt = w.time; a.anim.castId = 'dragongate';
    w.fx('ultflash', a.center, { color: '#b36bff', actor: a }); w.sfx('ultcall', a.center, a);
    // the koi-dragon coils up around him as the nodachi is drawn (SpiritDragon.ts: once, at the draw)
    w.fx('dragoncoil', a.center, { actor: a, color: '#b36bff' });
    return true;
  },
  // ================================================================ Seiran
  riverstep(w, a) {
    if (sealed(w, a) || a.has('root', w.time)) return false;
    dash(a, moveDir(a), 7, 0.18, 'lunge', w.time, 2.5);
    a.anim.jumpAt = w.time;
    w.fx('doublejump', a.pos, { color: '#8ec5ff' }); w.sfx('doublejump', a.pos, a);
    return true;
  },
  echoarrow(w, a) {
    const muz = w.muzzle(a), aim = w.aimPoint(a, 60);
    w.spawnProj(a, muz, norm({ x: aim.x - muz.x, y: aim.y - muz.y, z: aim.z - muz.z }), 90, { dmg: 20, fx: 'reveal', special: 'reveal', life: 60 / 90, r: 0.15 });
    w.sfx('bow', muz, a);
    return true;
  },
  twinkoi(w, a) {
    // two giant spirit koi-dragons spiral out along the aim (flat), straight through walls: each step bites everything
    // within 4.5m of either dragon's head, wherever it is - no line of sight, like Dragonstrike
    const f = a.forward(), dir = norm({ x: f.x, y: 0, z: f.z }), side = { x: -dir.z, y: 0, z: dir.x };
    const o = { x: a.pos.x + dir.x * 1.5, y: a.pos.y + 1.2, z: a.pos.z + dir.z * 1.5 };
    const hitAt = new Map<number, number>();
    w.fx('ultflash', a.center, { color: '#8ec5ff', actor: a }); w.sfx('ultcall', a.center, a); w.sfx('arrowrain', o, a);
    // the twin koi-dragons pour out of a sigil at o and corkscrew along the same helix the bites follow (SpiritDragon.ts)
    w.fx('twinkoi', o, { to: { x: o.x + dir.x * 45, y: o.y, z: o.z + dir.z * 45 }, color: '#8ec5ff', actor: a });
    for (let k = 0; k <= 18; k++) w.after(0.25 + k * 0.1, () => {
      const along = k * 2.5, sw = Math.sin(along * TWIN_W) * TWIN_R;
      for (const sg of [1, -1]) {
        const p = { x: o.x + dir.x * along + side.x * sw * sg, y: o.y, z: o.z + dir.z * along + side.z * sw * sg };
        w.fx('flash', p, { color: sg > 0 ? '#8ec5ff' : '#3f7fff', dur: 0.35 });
        for (const x of w.enemies(a)) {
          if (!x.alive || Math.hypot(x.pos.x - p.x, x.pos.z - p.z) > 4.5 || Math.abs(x.pos.y + 1 - p.y) > 4) continue;
          if (w.time - (hitAt.get(x.id) ?? -9) < 0.19) continue;
          hitAt.set(x.id, w.time);
          w.damage(a, x, 42, { kind: 'ability' });
        }
      }
    });
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
    w.shield(a, 250, 3, 'void', a);
    for (const x of w.allies(a, false)) if (dist3(x.pos, a.pos) < 8) { w.shield(x, 100, 3, 'void', a); w.fx('voidshield', x.center, { actor: x, color: '#ff2244', dur: 3 }); }
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
    if (w.full) {
      // Grand Puppet Theater: fifty masked puppets rise around him and fight for him (puppets.ts)
      raisePuppets(w, a);
      w.fx('theater', a.center, { r: 12, color: '#c77dff', actor: a }); w.sfx('ultcall', a.center, a); w.sfx('theater', a.center, a);
      return true;
    }
    // the web edition keeps the original: every enemy within 15m rooted and vulnerable for 2.5s
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
  effigy(w, a) {
    // Crimson Effigy (effigy.ts): the giant hologram rises behind him and sweeps the perimeter for EFFIGY_SECS
    raiseEffigy(w, a);
    w.fx('ultflash', a.center, { color: '#ff2a2a', actor: a }); w.sfx('ultcall', a.center, a); w.sfx('roar', a.center, a);
    return true;
  },
  asura(w, a) {
    a.set('asura', w.time, 8);
    a.scale = 1.25; a.maxArmor = a.def.armor + 150; a.armor += 150;
    w.fx('ultflash', a.center, { color: '#ff6a2a', actor: a }); w.sfx('ultcall', a.center, a); w.sfx('roar', a.center, a);
    return true;
  },
  // ================================================================ Gantetsu
  tachiai(w, a) {
    if (a.has('root', w.time)) return false;
    const t = w.time;
    a.set('tachiai', t, RUSH_T); a.sv.rushYaw = a.yaw; a.sv.rushStart = t; a.sv.rushOn = 1;
    (a as any)._rushHit = new Set<number>();
    w.sfx('charge', a.center, a); w.sfx('roar', a.center, a);
    w.fx('chargetrail', a.center, { actor: a, color: a.def.glow, dur: RUSH_T });
    return true;
  },
  taiko(w, a) {
    a.set('taiko', w.time, 3); a.sv.taikoBeat = w.time;
    w.fx('taiko', a.center, { actor: a, color: '#ffb35c', r: 12 }); w.sfx('taiko', a.center, a);
    return true;
  },
  dohyo(w, a) {
    // the ring is stamped where he stands: everyone of the other team inside it is caught for the bout
    const t = w.time, g = w.level.groundAt(a.pos.x, a.pos.z, a.pos.y + 0.5);
    const p = { x: a.pos.x, y: g > -Infinity ? g : a.pos.y, z: a.pos.z };
    const trapped = w.enemies(a).filter(x => Math.hypot(x.pos.x - p.x, x.pos.z - p.z) < 9 + x.radius * 0.5 && Math.abs(x.pos.y - p.y) < 6).map(x => x.id);
    zone(w, a, 'dohyo', p, 9, DOHYO_T, { trapped });
    a.set('dohyo', t, DOHYO_T);
    // the binding chains snap onto everyone caught: dashes and flight end where they stand
    for (const x of w.enemies(a)) if (trapped.includes(x.id)) { leash(w, a, x); w.sfx('chainhit', x.center, a); }
    a.reloadUntil = 0; a.ammo = a.maxAmmo; if (!isAbility(a.def.secondary)) a.sv.ammo2 = Math.max(1, Math.round((a.def.secondary.ammo ?? 0) * (1 + a.mods.ammo)));
    w.fx('ultflash', a.center, { color: a.def.glow, actor: a }); w.fx('slam', p, { r: 9, color: '#ffe6a8', actor: a });
    w.sfx('ultcall', a.center, a); w.sfx('dohyo', p, a); w.sfx('slam', p, a);
    w.emit({ t: 'msg', text: 'GANTETSU · GRAND DOHYO', color: a.def.color });
    return true;
  },
  // ================================================================ Hibiki
  crossmix(w, a) {
    // swap tracks: 0 = Healing Groove, 1 = Tempo Rush (an amped track stays amped through the swap)
    a.sv.track = a.sv.track ? 0 : 1;
    w.fx('crossmix', a.center, { actor: a, color: a.sv.track ? '#ffd23f' : '#7dffcf', r: AURA_R });
    w.sfx(a.sv.track ? 'track_speed' : 'track_heal', a.center, a);
    return true;
  },
  maxvolume(w, a) {
    a.set('amp', w.time, 3);
    w.fx('amp', a.center, { actor: a, color: a.sv.track ? '#ffd23f' : '#7dffcf', r: AURA_R });
    w.sfx('amp', a.center, a);
    return true;
  },
  scratch(w, a) {
    const t = w.time, f = a.forward(), pumped = a.has('pumped', t);
    const dmg = pumped ? 52.5 : 35, push = pumped ? 1.25 : 1;
    let n = 0;
    for (const x of w.enemies(a)) {
      const v = { x: x.pos.x - a.pos.x, y: x.center.y - a.eye.y, z: x.pos.z - a.pos.z }, l = Math.hypot(v.x, v.z);
      if (l > 8 + x.radius || Math.abs(v.y) > 3.5) continue;
      if ((v.x * f.x + v.z * f.z) / (l || 1) < 0.5 && l > x.radius + 0.5) continue;
      if (!w.level.lineOfSight(a.eye, x.center)) continue;
      w.damage(a, x, dmg, { kind: 'ability' }); n++;
      if (ccBlocked(w, x) || x.def.frame === 'mech' || x.isBoss || x.has('tachiai', t)) continue;
      const nx = l > 0.1 ? v.x / l : f.x, nz = l > 0.1 ? v.z / l : f.z;
      x.vel.y = Math.max(x.vel.y, 3.2 * push); x.grounded = false; x.lastGroundedAt = -9;
      x.forced = { vx: nx * 13 * push, vy: 0, vz: nz * 13 * push, until: t + 0.32, kind: 'knock' };
    }
    if (pumped) a.clear('pumped');
    a.sv.grind = 0;
    w.fx('scratchwave', a.eye, { actor: a, color: pumped ? '#ffd23f' : '#9ef6ff', r: 8, side: pumped ? 1 : 0 });
    w.sfx(pumped ? 'scratch_big' : 'scratch', a.center, a);
    if (n) a.hits++;
    a.shots++;
    return true;
  },
  // ================================================================ Tomoe
  crescent(w, a) {
    // thrown from the left hand along the crosshair; it sticks in whatever it meets (onProj 'crescent')
    const t = w.time, e = a.eye, f = a.forward(), lx = Math.cos(a.yaw), lz = -Math.sin(a.yaw);
    const from = { x: e.x + lx * 0.3 * a.scale + f.x * 0.35, y: e.y - 0.3 * a.scale, z: e.z + lz * 0.3 * a.scale + f.z * 0.35 };
    const aim = w.aimPoint(a, FANG_RANGE);
    const p = w.spawnProj(a, from, norm({ x: aim.x - from.x, y: aim.y - from.y, z: aim.z - from.z }), FANG_SPEED, { dmg: FANG_DMG, fx: 'crescent', special: 'crescent', life: FANG_RANGE / FANG_SPEED, r: 0.3, grav: 1.5 });
    a.sv.fang = 1; a.sv.fangProj = p.id; a.sv.fangAt = t;
    w.sfx('throw', from, a);
    return true;
  },
  warcall(w, a) {
    const t = w.time;
    let n = 0;
    for (const x of w.allies(a)) {
      if (dist3(x.pos, a.pos) > WARCALL_R || (x !== a && !w.level.lineOfSight(a.eye, x.center))) continue;
      w.shield(x, x === a ? 200 : 100, 3, 'warcall', a);
      x.sv.speed = x.has('speed', t) ? Math.max(x.sv.speed ?? 1, 1.3) : 1.3; x.sv.speedFrom = a.id; x.set('speed', t, 3);
      x.set('warcall', t, 3);
      if (x !== a) { n++; w.fx('warcallally', x.center, { actor: x, color: a.def.glow }); }
    }
    a.stats.warcall = (a.stats.warcall ?? 0) + n;
    w.fx('warcall', a.center, { actor: a, color: a.def.glow, r: WARCALL_R }); w.sfx('warcall', a.center, a);
    return true;
  },
  reaping(w, a) {
    // the axe comes off her back and round in a heavy cleave; she slows as she heaves it
    const t = w.time;
    a.set('reapwind', t, 0.62);
    w.sfx('reapwind', a.center, a);
    w.after(REAP_HIT, () => {
      if (!a.alive || a.has('stun', w.time)) return;
      const f = a.forward();
      let n = 0;
      for (const x of w.enemies(a)) {
        const v = { x: x.pos.x - a.pos.x, z: x.pos.z - a.pos.z }, l = Math.hypot(v.x, v.z);
        if (l > REAP_R + x.radius || Math.abs(x.pos.y - a.pos.y) > 2.6 * a.scale) continue;
        if ((v.x * f.x + v.z * f.z) / (l || 1) < 0.34 && l > x.radius + 0.4) continue;
        if (!w.level.lineOfSight(a.eye, x.center)) continue;
        w.damage(a, x, 90, { kind: 'ability' }); wound(w, a, x, 40); n++;
        w.fx('slash', x.center, { color: a.def.glow });
      }
      // every enemy cut shortens the cooldown by a second
      if (n) { a.cd.reaping = Math.max(w.time, (a.cd.reaping ?? 0) - n); a.hits++; }
      a.shots++;
      w.fx('reaping', a.center, { actor: a, color: a.def.glow, r: REAP_R }); w.sfx(n ? 'reaping' : 'whiff', a.center, a);
      if (n) w.sfx('impact_body', a.center, a);
    });
    return true;
  },
  tide(w, a) {
    // Crescent Warpath: she zooms the lane along the ground, the axe wheeling around her, straight through every body in
    // the way; whoever she passes is cut, wounded, starved of healing and MARKED (tidemark). (TIDE_APEX > 0 makes it an
    // airborne arc instead - the first version, before the user asked for Junker Queen's ground dash.)
    const t = w.time, d = flatDir(a);
    const dist = tideReach(w, a, d), dur = Math.max(TIDE_MIN_SECS, dist / TIDE_SPEED);
    (a as any)._tideHit = new Set<number>();
    a.sv.tideT0 = t; a.sv.tideDur = dur; a.sv.tideApex = TIDE_APEX > 0 ? Math.max(1.2, TIDE_APEX * Math.sqrt(dist / TIDE_LEN)) : 0;
    a.sv.tideX = a.pos.x; a.sv.tideZ = a.pos.z; a.sv.tideStuck = 0;
    const air = a.sv.tideApex > 0;
    a.forced = { vx: d.x * dist / dur, vy: air ? 4 * a.sv.tideApex / dur : 0, vz: d.z * dist / dur, until: t + dur, kind: 'tide', ignoreGravity: air, onEnd: () => {
      // (the end of the lane, a click, a wall: wherever it ends, she stops there)
      a.clear('tideult'); a.set('ccimmune', w.time, 0.15);
      a.cd.reaping = 0;
      if (a.sv.fang) fangHome(w, a); else a.cd.crescent = 0;
      w.fx('slam', a.pos, { r: 3, color: a.def.glow, actor: a }); w.sfx('slam', a.pos, a);
    } };
    if (air) { a.grounded = false; a.lastGroundedAt = -9; a.anim.jumpAt = t; }
    a.set('ccimmune', t, dur + 0.15); a.set('tideult', t, dur + 0.05);
    w.fx('ultflash', a.center, { color: a.def.glow, actor: a }); w.fx('chargetrail', a.center, { actor: a, color: a.def.glow, dur });
    w.sfx('ultcall', a.center, a); w.sfx('charge', a.center, a); w.sfx('roar', a.center, a);
    w.emit({ t: 'msg', text: 'TOMOE · CRESCENT WARPATH', color: a.def.color });
    return true;
  },
  bassdrop(w, a) {
    // the leap: straight up; the drop lands when he touches down (or at the top of the arc if he's airborne)
    const t = w.time;
    a.vel.y = Math.max(a.vel.y, 8.5); a.grounded = false; a.lastGroundedAt = -9; a.anim.jumpAt = t;
    a.set('dropair', t, 1.2); a.sv.dropArmed = 1; a.sv.dropAt = t;
    w.fx('ultflash', a.center, { color: a.def.glow, actor: a });
    w.sfx('ultcall', a.center, a); w.sfx('bassrise', a.center, a);
    return true;
  },
};

// Tomoe's numbers
export const FANG_DMG = 55, FANG_WOUND = 30, FANG_SPEED = 42, FANG_RANGE = 30, FANG_BACK = 46, FANG_STICK = 6;
export const WARCALL_R = 15, REAP_R = 5.5, REAP_HIT = 0.42;
/** Crescent Warpath: the dash (m, m/s - Rampage runs 25 m in 0.7 s), the top of the arc if it flies (0 = along the
 *  ground, the user's call), the lane under the wheeling blades (half-width, m) */
export const TIDE_LEN = 20, TIDE_SPEED = 28, TIDE_APEX = 0, TIDE_HALF = 2.5, TIDE_MIN_SECS = 0.35;
/** ... the cut, the wound, the healing it denies (s) */
export const TIDE_CUT = 40, TIDE_WOUND = 90, TIDE_ANTIHEAL = 4.5;
/** ... the mark it leaves: seconds, damage taken from anyone (x), the colour of the glow */
export const TIDE_MARK = 10, TIDE_MARK_AMP = 1.25, TIDE_MARK_COLOR = '#4aa8ff';
/** ... a click ends the flight, once it has been under way this long (s) */
export const TIDE_HOLD = 0.15;
/** ... a landing needs footing no further below her than this (m) */
const TIDE_DROP = 6;

/** how far Crescent Warpath carries her along d: TIDE_LEN, pulled in to the last spot inside the arena with footing under it */
export function tideReach(w: World, a: Actor, d: V3): number {
  const [X, Z] = w.level.size;
  let reach = 0;
  for (let s = 1; s <= TIDE_LEN; s++) {
    const x = a.pos.x + d.x * s, z = a.pos.z + d.z * s;
    if (Math.abs(x) > X - a.radius || Math.abs(z) > Z - a.radius) break;
    if (w.level.groundAt(x, z, a.pos.y + TIDE_APEX + 1, a.radius) > a.pos.y - TIDE_DROP) reach = s;
  }
  return reach;
}
/** Twin Koi Torrent's double helix: the giant twin dragons (render/SpiritDragon.ts) and their bites share it - radius (m), turn (rad/m) */
export const TWIN_R = 2.2, TWIN_W = 0.3;

/** where the Crescent Fang is right now (flying, stuck, riding an enemy or on its way home), or null in her hand */
export function fangPos(w: World, a: Actor): V3 | null {
  const st = a.sv.fang ?? 0;
  if (st === 1) { const p = w.projs.find(q => q.id === a.sv.fangProj); return p ? p.pos : null; }
  if (st === 3) { const x = w.actors.find(o => o.id === a.sv.fangTgt); return x ? x.center : null; }
  if (st === 2 || st === 4) return { x: a.sv.fangX, y: a.sv.fangY, z: a.sv.fangZ };
  return null;
}
/** RMB again: call the blade back - out of an enemy it hauls them toward her first */
function recallFang(w: World, a: Actor) {
  const t = w.time;
  if (a.sv.fang === 3) {
    const x = w.actors.find(o => o.id === a.sv.fangTgt);
    if (x && x.alive) {
      const p = x.center;
      a.sv.fangX = p.x; a.sv.fangY = p.y; a.sv.fangZ = p.z;
      if (!ccBlocked(w, x) && x.def.frame !== 'mech' && !x.isBoss && !x.has('tachiai', t)) {
        const d = norm({ x: a.pos.x - x.pos.x, y: 0, z: a.pos.z - x.pos.z });
        const dist = Math.min(12, Math.max(0, dist3(a.pos, x.pos) - (a.radius + x.radius + 1.2)));
        interrupt(w, x, a);
        x.forced = { vx: d.x * dist / 0.34, vy: 2.5, vz: d.z * dist / 0.34, until: t + 0.34, kind: 'pull' };
        a.stats.yanks = (a.stats.yanks ?? 0) + 1;
        // COUNTER: out of the sky - a flyer is dragged down and grounded
        if (x.flying || x.def.frame === 'flyer') {
          x.flying = false; applyCC(w, a, x, 'grounded', 1.5);
          if (x.def.id === 'nocturne') w.emit({ t: 'counter', actor: a, target: x, text: 'Crescent Fang drags Lady Nocturne out of the sky' });
        }
        w.fx('chainline', a.center, { target: x, color: a.def.glow, dur: 0.34 }); w.sfx('yank', x.center, a);
      }
    }
  }
  a.sv.fang = 4; a.sv.fangAt = t;
  (a as any)._fangBack = new Set<number>([a.sv.fangTgt ?? -1]);
  a.anim.castAt = t; a.anim.castId = 'recall';
  w.sfx('fangreturn', { x: a.sv.fangX, y: a.sv.fangY, z: a.sv.fangZ }, a);
}
/** the blade is back in her hand: the cooldown starts now */
function fangHome(w: World, a: Actor) {
  const t = w.time;
  a.sv.fang = 0; a.sv.fangTgt = 0;
  const cd = (a.def.secondary as { cooldown: number }).cooldown ?? 6;
  a.cd.crescent = a.has('tideult', t) ? t : t + cd * (1 - a.mods.cdr) * (1 - (a.mods.cdrBy.crescent ?? 0));
  w.sfx('fangcatch', a.center, a);
}

/** Hibiki's aura reach (Crossmix / Max Volume) */
export const AURA_R = 12;
const BASS_HP = 750, BASS_R = 30;

/** Bass Drop lands: every ally in range he can see gets the drop's temporary health (it fades over 6s after a beat) */
function bassDrop(w: World, a: Actor) {
  const t = w.time, p = { ...a.pos };
  let n = 0;
  for (const x of w.allies(a)) {
    if (dist3(x.pos, p) > BASS_R || (x !== a && !w.level.lineOfSight(a.eye, x.center))) continue;
    x.shields = x.shields.filter(s => s.kind !== 'bassdrop');
    x.shields.push({ amt: BASS_HP, until: t + 7, kind: 'bassdrop', src: a });
    x.sv.bassAt = t; n++;
    w.fx('bassshield', x.center, { actor: x, color: a.def.glow });
  }
  a.stats.bassdrop = (a.stats.bassdrop ?? 0) + n;
  w.fx('bassdrop', p, { r: BASS_R, color: a.def.glow, actor: a }); w.fx('slam', p, { r: 7, color: '#9ef6ff', actor: a });
  w.sfx('bassdrop', p, a); w.sfx('slam', p, a);
  w.emit({ t: 'msg', text: 'HIBIKI · BASS DROP', color: a.def.color });
}

/** Tachiai Rush: how long the charge runs before it ends in the leap by itself */
export const RUSH_T = 2.5;
/** Grand Dohyo: how long the ring and its chains hold */
export const DOHYO_T = 8;
/** Shiko Stomp: the slam's reach, the heart of it (full damage, the longest knockdown), and how high it reaches */
export const STOMP_R = 7, STOMP_CORE = 2.5, STOMP_H = 3;

/** the leap out of a Tachiai Rush (SPACE, or by itself when the charge runs out): up, then driven down into the slam */
export function stompLeap(w: World, a: Actor) {
  const t = w.time;
  a.vel.y = 10; a.grounded = false; a.lastGroundedAt = -9; a.anim.jumpAt = t;
  a.clear('tachiai'); a.sv.rushOn = 0; a.set('stompair', t, 2.5); a.sv.stompArmed = 1;
  w.sfx('mechjump', a.pos, a);
}

/** Grand Dohyo: bind a hero to the ring - no flight, no dashes (castAbility), held inside the rope (World.ringClamp) */
function leash(w: World, by: Actor, x: Actor) {
  const t = w.time;
  x.set('chained', t, 0.3, undefined, by);
  if (x.def.frame === 'mech' || x.isBoss) return;
  x.set('grounded', t, 0.3, undefined, by); x.flying = false;
  if (x.forced && x.forced.kind !== 'knock' && x.forced.kind !== 'pull') interrupt(w, x, by);
}

/**
 * Shiko Stomp: the leap out of a Tachiai Rush lands. Everyone within 7m the shockwave can reach is thrown back off their
 * feet and left flat on the ground, stunned (1s at the heart of it, 0.8s further out), and set alight.
 */
function shikoStomp(w: World, a: Actor) {
  const t = w.time, p = { ...a.pos }, eye = { x: p.x, y: p.y + 0.6, z: p.z };
  for (const x of w.enemies(a)) {
    const dx = x.pos.x - p.x, dz = x.pos.z - p.z, d = Math.hypot(dx, dz);
    if (d > STOMP_R + x.radius || Math.abs(x.pos.y - p.y) > STOMP_H) continue;
    if (!w.level.lineOfSight(eye, x.center)) continue;                 // a wall between them takes the shockwave
    const core = d < STOMP_CORE + x.radius;
    w.damage(a, x, core ? 150 : 75, { kind: 'ability' }); ignite(w, a, x, 8);
    if (!x.alive || x.def.frame === 'mech' || x.isBoss || !applyCC(w, a, x, 'stun', core ? 1 : 0.8)) continue;
    x.set('knockdown', t, core ? 1 : 0.8, undefined, a);
    // swept off their feet, away from the landing: a low hop and a shove, then flat on the ground
    const n = d > 0.1 ? { x: dx / d, z: dz / d } : { x: Math.sin(a.yaw), z: Math.cos(a.yaw) };
    x.flying = false; x.vel.y = 4; x.grounded = false;
    x.forced = { vx: n.x * 8.5, vy: 0, vz: n.z * 8.5, until: t + 0.3, kind: 'knock' };
  }
  w.fx('slam', p, { r: STOMP_R, color: a.def.glow, actor: a }); w.fx('stomp', p, { r: STOMP_R, color: '#ffb35c', actor: a }); w.fx('dust', p, { r: 4 });
  w.sfx('slam', p, a); w.sfx('mechland', p, a);
}

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
    case 'crescent': {
      if (a.sv.fang !== 1 || a.sv.fangProj !== p.id) break;
      if (hit) {
        w.damage(a, hit, FANG_DMG, { kind: 'ability' }); wound(w, a, hit, FANG_WOUND);
        a.hits++;
        if (hit.alive) { a.sv.fang = 3; a.sv.fangTgt = hit.id; a.sv.fangAt = t; w.sfx('chainhit', at, a); }
        else { a.sv.fang = 2; a.sv.fangX = at.x; a.sv.fangY = at.y; a.sv.fangZ = at.z; a.sv.fangAt = t; }
        w.fx('slash', at, { color: a.def.glow });
      } else if (p.life <= 0) {
        // out of range in open air: it turns and comes home
        a.sv.fangX = at.x; a.sv.fangY = at.y; a.sv.fangZ = at.z; a.sv.fang = 4; a.sv.fangAt = t;
        (a as any)._fangBack = new Set<number>();
      } else {
        a.sv.fang = 2; a.sv.fangX = at.x; a.sv.fangY = at.y; a.sv.fangZ = at.z; a.sv.fangAt = t;
        w.fx('impact', at, { color: a.def.glow }); w.sfx('impact_metal', at, a);
      }
      a.shots++;
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
  // Gantetsu: Tachiai Rush shoves (and cracks barriers), the stomp lands, Taiko Heartbeat feeds the team's lifesteal
  for (const a of w.actors) {
    if (!a.alive) { a.sv.stompArmed = 0; continue; }
    if (a.has('tachiai', t)) {
      const hit: Set<number> = (a as any)._rushHit ?? ((a as any)._rushHit = new Set<number>());
      const ry = a.sv.rushYaw ?? a.yaw, f = { x: Math.sin(ry), z: Math.cos(ry) };
      for (const x of w.enemies(a)) {
        if (hit.has(x.id) || Math.hypot(x.pos.x - a.pos.x, x.pos.z - a.pos.z) > a.radius + x.radius + 0.5 || Math.abs(x.pos.y - a.pos.y) > 2.2) continue;
        hit.add(x.id);
        w.damage(a, x, 30, { kind: 'ability' }); ignite(w, a, x, 6);
        w.fx('impact', x.center, { color: a.def.glow }); w.sfx('punch', x.center, a);
        if (ccBlocked(w, x) || x.def.frame === 'mech' || x.isBoss) continue;
        // shoved aside, off the charge line
        const side = (x.pos.x - a.pos.x) * -f.z + (x.pos.z - a.pos.z) * f.x >= 0 ? 1 : -1;
        x.vel.y = Math.max(x.vel.y, 3.5); x.grounded = false;
        x.forced = { vx: -f.z * side * 9 + f.x * 6, vy: 0, vz: f.x * side * 9 + f.z * 6, until: t + 0.3, kind: 'knock' };
      }
      // COUNTER: ploughing into the Solar Bulwark cracks it
      for (const b of w.actors) {
        if (!b.alive || b.team === a.team || !b.barrier.up || hit.has(-b.id)) continue;
        const bf = b.forward(), c = { x: b.pos.x + bf.x * 1.7 * b.scale, y: b.pos.y + 1.5, z: b.pos.z + bf.z * 1.7 * b.scale };
        if (Math.hypot(c.x - a.pos.x, c.z - a.pos.z) > a.radius + 1.3) continue;
        hit.add(-b.id);
        w.hitBarrier(b, 300, a, c);
        w.emit({ t: 'counter', actor: a, target: b, text: 'Tachiai Rush cracks the Solar Bulwark' });
      }
    }
    else if (a.sv.rushOn) {
      // the charge ran its full course (not cut short with SHIFT): it ends in the leap by itself
      a.sv.rushOn = 0;
      if (t - (a.sv.rushStart ?? 0) >= RUSH_T - 0.05 && a.grounded && !a.has('stun', t) && !a.has('root', t)) stompLeap(w, a);
    }
    if (a.sv.stompArmed) {
      if (a.grounded && t - a.anim.jumpAt > 0.1) { a.sv.stompArmed = 0; a.clear('stompair'); shikoStomp(w, a); }
      else if (!a.has('stompair', t)) a.sv.stompArmed = 0;
    }
    if (a.has('taiko', t)) {
      for (const x of w.allies(a)) if (dist3(x.pos, a.pos) < 12) x.set('lifesteal', t, 0.3, x === a ? 1 : 0.5);
      if (t - (a.sv.taikoBeat ?? 0) > 0.5) { a.sv.taikoBeat = t; w.fx('taikopulse', a.center, { actor: a, color: '#ffb35c', r: 12 }); w.sfx('taikobeat', a.center, a); }
    }
  }
  // Hibiki: the track he's playing reaches every ally within 12m he can see; Max Volume cranks it; the drop lands
  for (const a of w.actors) {
    if (a.def.id !== 'hibiki') continue;
    if (!a.alive) { a.sv.dropArmed = 0; continue; }
    const amp = a.has('amp', t), speedTrack = !!a.sv.track;
    for (const x of w.allies(a)) {
      if (dist3(x.pos, a.pos) > AURA_R || (x !== a && !w.level.lineOfSight(a.eye, x.center))) continue;
      if (speedTrack) {
        const k = amp ? 1.6 : 1.25;
        x.sv.speed = x.has('speed', t) && x.sv.speedFrom !== a.id ? Math.max(x.sv.speed ?? 1, k) : k;
        x.sv.speedFrom = a.id; x.set('speed', t, 0.3); x.set('tempo', t, 0.3, amp ? 2 : 1);
      } else {
        w.heal(a, x, (amp ? 52 : 16) * (x === a ? 0.7 : 1) * dt, true); x.set('groove', t, 0.3, amp ? 2 : 1);
      }
    }
    if (a.has('grinding', t)) {
      a.sv.grind = (a.sv.grind ?? 0) + dt;
      if (a.sv.grind >= 5 && !a.has('pumped', t)) { a.set('pumped', t, 30); w.sfx('pumped', a.center, a); }
    }
    if (a.sv.dropArmed) {
      const since = t - (a.sv.dropAt ?? t);
      if ((a.grounded && since > 0.12) || (a.vel.y < 0 && since > 0.35) || !a.has('dropair', t)) { a.sv.dropArmed = 0; a.clear('dropair'); bassDrop(w, a); }
    }
  }
  // Tomoe: the Crescent Fang rides whoever it is stuck in, comes home on its own after a while, cuts its way back
  for (const a of w.actors) {
    if (a.def.id !== 'tomoe') continue;
    const st = a.sv.fang ?? 0;
    if (!a.alive) { if (st) { a.sv.fang = 0; a.sv.fangTgt = 0; } continue; }
    if (st) a.cd.crescent = Math.max(a.cd.crescent ?? 0, t + 0.1);            // no cooldown ticks while the blade is out
    if (st === 1 && !w.projs.some(q => q.id === a.sv.fangProj)) { if (a.sv.fang === 1) a.sv.fang = 0; continue; }
    if (st === 3) {
      const x = w.actors.find(o => o.id === a.sv.fangTgt);
      if (!x || !x.alive) { const c = x ? x.center : a.center; a.sv.fangX = c.x; a.sv.fangY = c.y; a.sv.fangZ = c.z; a.sv.fang = 2; a.sv.fangAt = t; }
      else if (t - (a.sv.fangAt ?? t) > FANG_STICK) recallFang(w, a);
    } else if (st === 2 && t - (a.sv.fangAt ?? t) > FANG_STICK + 2) recallFang(w, a);
    else if (st === 4) {
      const home = { x: a.pos.x, y: a.pos.y + a.height * 0.6, z: a.pos.z };
      const from = { x: a.sv.fangX, y: a.sv.fangY, z: a.sv.fangZ };
      const v = { x: home.x - from.x, y: home.y - from.y, z: home.z - from.z }, l = Math.hypot(v.x, v.y, v.z), step = FANG_BACK * dt;
      if (l <= step + 0.6) { fangHome(w, a); continue; }
      const to = { x: from.x + v.x / l * step, y: from.y + v.y / l * step, z: from.z + v.z / l * step };
      const cut: Set<number> = (a as any)._fangBack ?? ((a as any)._fangBack = new Set<number>());
      for (const x of w.enemies(a)) {
        if (cut.has(x.id)) continue;
        const c = x.center, q = { x: c.x - from.x, y: c.y - from.y, z: c.z - from.z };
        const s2 = Math.max(0, Math.min(step, (q.x * v.x + q.y * v.y + q.z * v.z) / l));
        const dx = from.x + v.x / l * s2 - c.x, dy = from.y + v.y / l * s2 - c.y, dz = from.z + v.z / l * s2 - c.z;
        if (dx * dx + dz * dz > (x.radius + 0.5) ** 2 || Math.abs(dy) > x.height * 0.55) continue;
        cut.add(x.id);
        w.damage(a, x, FANG_DMG, { kind: 'ability' }); wound(w, a, x, FANG_WOUND);
        w.fx('slash', c, { color: a.def.glow }); w.sfx('chainhit', c, a);
      }
      a.sv.fangX = to.x; a.sv.fangY = to.y; a.sv.fangZ = to.z;
    }
  }
  for (const z of w.zones) {
    if (z.kind !== 'dohyo' || t >= z.until) continue;
    if (!z.owner.alive) { z.until = t; continue; }
    // the chains: everyone caught stays bound, and an enemy who gets inside the rope (dropped in from above) is bound too
    const trapped = z.data.trapped as number[];
    for (const x of w.enemies(z.owner)) {
      if (!x.alive) continue;
      if (!trapped.includes(x.id)) {
        if (Math.hypot(x.pos.x - z.x, x.pos.z - z.z) > z.r - x.radius - 0.3 || x.pos.y < z.y - 2 || x.pos.y > z.y + 6) continue;
        trapped.push(x.id); w.sfx('chainhit', x.center, z.owner);
      }
      leash(w, z.owner, x);
    }
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
        if (x.has('tachiai', t)) {
          // COUNTER (Gantetsu): an unstoppable rush can't be pinned - the two heavyweights collide and the charge breaks
          a.forced.until = t; w.damage(a, x, 30, { kind: 'ability' });
          w.emit({ t: 'counter', actor: x, target: a, text: "Tachiai Rush can't be pinned" });
          w.fx('slam', x.pos, { r: 2.5, color: x.def.glow, actor: x }); w.sfx('slam', x.pos, a);
          break;
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
    } else if (a.forced.kind === 'tide') {
      // Crescent Warpath: each enemy under the wheel of blades is passed through once - cut, wounded, marked
      const hit: Set<number> = (a as any)._tideHit ?? ((a as any)._tideHit = new Set<number>());
      const f = norm({ x: a.forced.vx, y: 0, z: a.forced.vz });
      const live = a.sv.tideX !== undefined && a.forced.until < 1e8;        // (the Hero Viewer holds the pose without a dash)
      const air = live && !!a.forced.ignoreGravity && a.sv.tideApex > 0;
      if (live) {
        const s = (t - a.sv.tideT0) / a.sv.tideDur;
        // the arc, if it flies: up over the first half, down over the second
        if (air) a.forced.vy = 4 * a.sv.tideApex * (1 - 2 * s) / a.sv.tideDur;
        // stopped by a wall (or the rope of a Grand Dohyo), or a flight down early on higher ground: it ends there
        const want = Math.hypot(a.forced.vx, a.forced.vz) * dt, went = Math.hypot(a.pos.x - a.sv.tideX, a.pos.z - a.sv.tideZ);
        a.sv.tideStuck = want > 0.01 && went < want * 0.25 ? a.sv.tideStuck + 1 : 0;
        a.sv.tideX = a.pos.x; a.sv.tideZ = a.pos.z;
        if (a.sv.tideStuck >= 3 || (air && a.grounded && s > 0.5)) a.forced.until = t;
      }
      for (const x of w.enemies(a)) {
        if (hit.has(x.id) || x.has('phased', t)) continue;
        const v = { x: x.pos.x - a.pos.x, z: x.pos.z - a.pos.z }, along = v.x * f.x + v.z * f.z, lat = Math.abs(v.x * -f.z + v.z * f.x);
        if (along < -a.radius - x.radius - 0.5 || along > a.radius + x.radius + 1.4 || lat > TIDE_HALF + x.radius) continue;
        // (if it flies she is up to TIDE_APEX above the floor they stand on)
        if (x.pos.y + x.height < a.pos.y - TIDE_APEX - 1.5 || x.pos.y > a.pos.y + a.height + 1) continue;
        if (live && !w.level.lineOfSight(a.center, x.center)) continue;
        hit.add(x.id);
        x.set('tidemark', t, TIDE_MARK, undefined, a);
        w.damage(a, x, TIDE_CUT, { kind: 'ability' }); wound(w, a, x, TIDE_WOUND); x.set('antiheal', t, TIDE_ANTIHEAL, undefined, a);
        w.fx('slash', x.center, { color: a.def.glow }); w.fx('tidemark', x.center, { color: TIDE_MARK_COLOR, actor: x, dur: TIDE_MARK }); w.sfx('reaping', x.center, a);
        a.stats.tide = (a.stats.tide ?? 0) + 1;
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
  // Tomoe: RMB with the blade out calls it back (stuck anywhere) - no cooldown involved
  if (id === 'crescent' && a.sv.fang) { if (a.sv.fang === 2 || a.sv.fang === 3) { recallFang(w, a); return true; } return false; }
  if (slot !== 'ult' && !a.ready(id, t)) return false;
  if (a.forced && !['knock', 'pull'].includes(a.forced.kind) && id !== 'thousandcuts') return false;
  if (LEASHED.has(id) && a.has('chained', t)) { w.fx('blocked', a.center, { color: '#ffd27a', actor: a }); w.sfx('denied', a.pos, a); return false; }
  if (a.has('stealth', t) && id !== 'veil') { a.clear('stealth'); a.set('ambush', t, 0.6); }
  const ok = I[id](w, a);
  if (!ok) return false;
  const def = slot === 'a1' ? a.def.ability1 : slot === 'a2' ? a.def.ability2 : slot === 'ult' ? a.def.ult : (isAbility(a.def.secondary) ? a.def.secondary : null);
  if (slot === 'ult') { a.ult = 0; a.ults++; }
  else if (def) a.cd[id] = t + def.cooldown * (1 - a.mods.cdr) * (1 - (a.mods.cdrBy[id] ?? 0));   // Stadium cooldown items / powers
  a.anim.castAt = t; a.anim.castId = id;
  w.stats.casts[id] = (w.stats.casts[id] ?? 0) + 1;
  w.emit({ t: 'cast', actor: a, id, name: def?.name ?? id });
  return true;
}
castAbility.onProj = onProj;
