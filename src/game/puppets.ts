// Hex - Grand Puppet Theater: fifty masked puppets rise around him and fight for him, then fall lifeless.
//
// The puppets are Actors (every weapon, ability and bot treats them like any other body on the field) from a pool that
// is reused by each cast, flagged by their def (`summoned`): no respawn, no objective time, no kill feed, no ultimate
// charge for shooting them. They are drawn as one instanced swarm (render/PuppetSwarm.ts), not as fifty characters.
import type { HeroDef, AbilityDef } from '../data/heroes';
import type { V3 } from '../engine/Physics';
import { Actor } from './Actor';
import type { World } from './World';

export const PUPPET_COUNT = 50;
/** how long the army fights before the strings go slack */
export const PUPPET_SECS = 15;
/** rising out of the floor: untouchable and still for this long */
export const PUPPET_RISE = 0.9;
/** a claw swipe: damage, reach (m, centre to centre beyond the two radii), seconds between swipes */
export const PUPPET_HIT = { dmg: 10, reach: 0.9, every: 0.9 };
/** cut the strings when the puppeteer falls */
export const PUPPETS_FALL_WITH_HEX = true;

const none = (id: string): AbilityDef => ({ id, name: '-', key: '-', cooldown: 999, desc: '' });
export const PUPPET_DEF: HeroDef = {
  id: 'puppet', name: 'Puppet', title: 'Stitched Student', team: 'umbra', role: 'dps', frame: 'human', rival: '',
  hp: 50, armor: 0, speed: 5.5, height: 1.75, radius: 0.34, color: '#b56dff', glow: '#c77dff',
  // (the claws are swung by the puppet's brain below: the weapon system never fires for a puppet)
  primary: { kind: 'melee', name: 'Claws', damage: PUPPET_HIT.dmg, rate: 1 / PUPPET_HIT.every, range: 1.6, sfx: 'none', fx: 'none' },
  secondary: none('none'), ability1: none('none'), ability2: none('none'), ult: { ...none('none'), charge: 1e9 },
  passive: { name: '', desc: '' }, lore: 'One of the Dollmaker\'s students, restitched and obedient.', inspiration: '', voice: [300, 0.2],
  summoned: true, full: true,
};

const d2 = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.z - b.z);

class PuppetBrain {
  target: Actor | null = null;
  path: V3[] = [];
  nextPick = 0; nextPath = 0; nextHit = 0;
  constructor(public w: World, public a: Actor) {}

  think(_dt: number) {
    const { w, a } = this, t = w.time, i = a.input;
    i.fire = i.alt = i.a1 = i.a2 = i.ult = i.melee = i.reload = i.swoop = false;
    i.jump = false; i.jumpHeld = false;
    if (t < (a.sv.riseUntil ?? 0)) { i.mx = i.mz = 0; return; }
    if (t >= this.nextPick) {
      this.nextPick = t + 0.4 + (a.id % 7) * 0.03;
      this.target = pickTarget(w, a);
    }
    const tg = this.target;
    if (!tg || !tg.alive) { i.mx = i.mz = 0; this.target = null; return; }
    const d = d2(tg.pos, a.pos), reach = a.radius + tg.radius + PUPPET_HIT.reach;
    const dy = tg.pos.y - a.pos.y;
    // a path when the way isn't straight (staggered, and a few searches a tick for the whole army)
    if (w.nav && t >= this.nextPath && (d > 5 || Math.abs(dy) > 1.2) && w.sv.puppetPaths < 3) {
      this.nextPath = t + 1.1 + (a.id % 9) * 0.07;
      if (!w.level.lineOfSight(a.eye, tg.center)) { w.sv.puppetPaths++; this.path = w.nav.find(a.pos, tg.pos, 9000) ?? []; }
      else this.path = [];
    }
    while (this.path.length && d2(this.path[0], a.pos) < 0.9) this.path.shift();
    const wp = this.path[0] ?? tg.pos;
    const lx = wp.x - a.pos.x, lz = wp.z - a.pos.z, l = Math.hypot(lx, lz) || 1;
    i.yaw = Math.atan2(tg.pos.x - a.pos.x, tg.pos.z - a.pos.z);
    i.pitch = 0;
    if (d > reach * 0.85) {
      // steer along the way, in the puppet's own frame (it faces its target)
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), rx = -Math.cos(a.yaw), rz = Math.sin(a.yaw);
      const dx = lx / l, dz = lz / l;
      i.mz = dx * fx + dz * fz; i.mx = dx * rx + dz * rz;
      // a low ledge in the way: hop it
      if (a.grounded && this.path.length && wp.y > a.pos.y + 0.4) i.jump = true;
    } else { i.mx = i.mz = 0; }
    if (d <= reach && Math.abs(dy) < 2.2 && t >= this.nextHit && !a.has('stun', t) && !a.has('knockdown', t)) {
      this.nextHit = t + PUPPET_HIT.every * (0.9 + (a.id % 5) * 0.05);
      a.anim.attackAt = t; a.anim.attackKind = 'primary';
      const owner = a.owner && a.owner.team === a.team ? a.owner : a;
      // the damage is the puppeteer's (his kills, his damage done), but it never feeds his next ultimate
      const dealt = w.damage(owner, tg, PUPPET_HIT.dmg, { kind: 'ability', ability: 'puppet', noLifesteal: true });
      if (dealt > 0) { w.sfx('scratch', tg.center); owner.stats.puppetDmg = (owner.stats.puppetDmg ?? 0) + dealt; }
    }
  }
}

/** the nearest enemy hero, spread out so the whole army doesn't pile onto one body */
function pickTarget(w: World, a: Actor): Actor | null {
  const t = w.time;
  const foes = w.actors.filter(x => x.alive && x.team !== a.team && !x.isSummon && x.def.id !== 'bot_dummy'
    && !x.has('phased', t) && !(x.has('stealth', t) && !x.has('revealed', t)));
  const pool = foes.length ? foes : w.actors.filter(x => x.alive && x.team !== a.team && !x.isSummon);
  if (!pool.length) return null;
  const army = w.actors.filter(x => x.alive && x.isSummon && x.team === a.team && x !== a);
  const cap = Math.ceil((army.length + 1) / pool.length) + 2;
  let best: Actor | null = null, bs = Infinity;
  for (const x of pool) {
    const d = Math.hypot(x.pos.x - a.pos.x, x.pos.z - a.pos.z) + Math.abs(x.pos.y - a.pos.y) * 2;
    if (d > 70) continue;
    const on = army.reduce((n, p) => n + ((p.controller as PuppetBrain | null)?.target === x ? 1 : 0), 0);
    const s = d + (on >= cap ? 25 : 0);
    if (s < bs) { bs = s; best = x; }
  }
  return best;
}

/** this caster's puppets (standing or fallen) */
export function puppetsOf(w: World, owner: Actor) { return w.actors.filter(x => x.isSummon && x.owner === owner); }

/** the strings go slack: every puppet of this caster falls where it stands */
export function dropPuppets(w: World, owner: Actor) {
  const t = w.time;
  let n = 0;
  for (const p of puppetsOf(w, owner)) {
    if (!p.alive) continue;
    p.alive = false; p.deathAt = t; p.respawnAt = 0; p.forced = null; p.sv.fellAt = t;
    n++;
  }
  owner.clear('puppeteer');
  if (n) { w.fx('puppetsfall', owner.center, { color: '#c77dff', actor: owner }); w.sfx('spindown', owner.center, owner); }
  return n;
}

/** spots around the caster where a puppet can stand: rings on his own floor, in sight of him, clear of walls */
function spots(w: World, a: Actor, n: number): V3[] {
  const out: V3[] = [];
  const [X, Z] = w.level.size;
  let ring = 0;
  for (let tries = 0; out.length < n && tries < 12; tries++, ring++) {
    const r = 2.4 + ring * 1.15, k = Math.max(6, Math.round((2 * Math.PI * r) / 1.25));
    for (let j = 0; j < k && out.length < n; j++) {
      const ang = (j / k) * Math.PI * 2 + ring * 0.37;
      const x = a.pos.x + Math.cos(ang) * r, z = a.pos.z + Math.sin(ang) * r;
      if (Math.abs(x) > X - 1 || Math.abs(z) > Z - 1) continue;
      const g = w.level.groundAt(x, z, a.pos.y + 1.2);
      if (g === -Infinity || Math.abs(g - a.pos.y) > 1.6) continue;
      const p = { x, y: g, z };
      const before = { ...p };
      w.level.collide(p, PUPPET_DEF.radius, PUPPET_DEF.height);
      if (Math.hypot(p.x - before.x, p.z - before.z) > 0.25) continue;      // it was inside a wall
      if (!w.level.lineOfSight(a.eye, { x: p.x, y: p.y + 1.2, z: p.z })) continue;
      out.push(p);
    }
  }
  // a cramped room: the rest stand in a tight ring around him
  for (let j = 0; out.length < n; j++) { const ang = j * 2.4; out.push({ x: a.pos.x + Math.cos(ang) * 1.6, y: a.pos.y, z: a.pos.z + Math.sin(ang) * 1.6 }); }
  return out;
}

/** Grand Puppet Theater: raise the army */
export function raisePuppets(w: World, a: Actor, count = PUPPET_COUNT, secs = PUPPET_SECS) {
  const t = w.time;
  dropPuppets(w, a);                                  // a second cast replaces the first army
  const pool = puppetsOf(w, a);
  while (pool.length < count) {
    const p = new Actor(PUPPET_DEF, a.team);
    p.owner = a; p.isRobot = true; p.noRespawn = true; p.alive = false;
    p.controller = new PuppetBrain(w, p);
    w.actors.push(p); pool.push(p);
  }
  const at = spots(w, a, count);
  for (let k = 0; k < count; k++) {
    const p = pool[k], s = at[k];
    p.team = a.team;
    p.pos = { ...s }; p.vel = { x: 0, y: 0, z: 0 };
    p.yaw = p.input.yaw = Math.atan2(s.x - a.pos.x, s.z - a.pos.z);
    p.pitch = 0; p.hp = PUPPET_DEF.hp; p.armor = 0; p.scale = 1;
    p.shields = []; p.wounds = []; p.st = {}; p.sv = {}; p.forced = null;
    p.alive = true; p.respawnAt = 0; p.deathAt = -99; p.lastDamagedAt = t;
    const rise = PUPPET_RISE + (k % 10) * 0.035;       // they come up in a ripple, not as one
    p.sv.riseAt = t; p.sv.riseUntil = t + rise;
    p.set('spawnprot', t, rise);
    const b = p.controller as PuppetBrain; b.target = null; b.path = []; b.nextPick = t + rise; b.nextPath = 0; b.nextHit = t + rise + 0.2;
  }
  a.set('puppeteer', t, secs);
  a.sv.puppetsUntil = t + secs;
  const cast = t;
  w.after(secs, () => { if (a.sv.puppetsCast === cast) dropPuppets(w, a); });
  a.sv.puppetsCast = cast;
  return count;
}

/** per tick: the path budget, and the puppeteer's own fall */
export function tickPuppets(w: World) {
  w.sv.puppetPaths = 0;
  if (!PUPPETS_FALL_WITH_HEX) return;
  for (const a of w.actors) if (!a.alive && !a.isSummon && a.sv.puppetsCast !== undefined && a.deathAt >= a.sv.puppetsCast && w.time - a.deathAt < 0.2) {
    if (puppetsOf(w, a).some(p => p.alive)) dropPuppets(w, a);
  }
}
