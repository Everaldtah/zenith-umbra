// Enra - Crimson Effigy: a giant crimson hologram of the oni himself rises behind him and fights beside him for
// EFFIGY_SECS, then fades. It is an Actor (drawn as Enra's own model, three times his size, as a red hologram - HeroDef
// `model` / `holo`), summoned like Hex's puppets (no respawn, no kill feed, no ultimate charge) but a ghost: nothing
// touches it (phased every tick), it walks through bodies, and it strikes on its own - every EFFIGY_HIT.every seconds
// a sweep of its blade lands on EVERY enemy inside EFFIGY_R of Enra that it can see, damage credited to him.
import type { HeroDef, AbilityDef } from '../data/heroes';
import type { V3 } from '../engine/Physics';
import { Actor } from './Actor';
import type { World } from './World';

/** how long the effigy stands */
export const EFFIGY_SECS = 10;
/** its perimeter: enemies this close to Enra (in the flat) are struck, up to EFFIGY_H above or below him */
export const EFFIGY_R = 12, EFFIGY_H = 4;
/** a sweep: damage to everyone in reach, seconds between sweeps, the first one's delay after the rise */
export const EFFIGY_HIT = { dmg: 45, every: 0.9, first: 0.8 };
/** rising out of the ground: this long before the first sweep and before it moves */
export const EFFIGY_RISE = 0.6;
/** it stands this far behind Enra (in the direction he faces, negative) and closes on that spot at this speed */
const BEHIND = 2.2, FOLLOW = 9;

const none = (id: string): AbilityDef => ({ id, name: '-', key: '-', cooldown: 999, desc: '' });
export const EFFIGY_DEF: HeroDef = {
  id: 'enra_effigy', name: 'Crimson Effigy', title: 'The Oni Unbound', team: 'umbra', role: 'dps', frame: 'human', rival: '',
  hp: 1e6, armor: 0, speed: FOLLOW, height: 2.05 * 3, radius: 0.6, color: '#ff2a2a', glow: '#ff4a2a',
  // (the blade is swung by the brain below: the weapon system never fires for the effigy)
  primary: { kind: 'melee', name: 'Effigy Blade', damage: EFFIGY_HIT.dmg, rate: 1 / EFFIGY_HIT.every, range: EFFIGY_R, sfx: 'none', fx: 'none' },
  secondary: none('none'), ability1: none('none'), ability2: none('none'), ult: { ...none('none'), charge: 1e9 },
  passive: { name: '', desc: '' }, lore: 'The oni as the old stories drew him: a mountain of red fire with a blade the size of a gate.', inspiration: '', voice: [80, 0.9],
  summoned: true, full: true,
  model: 'enra_susanoo', holo: '#ff2a2a', scale: 3,     // (system32-82's Tripo Susanoo form, published at 6.15 m)
};

class EffigyBrain {
  nextHit = 0;
  constructor(public w: World, public a: Actor) {}

  think(_dt: number) {
    const { w, a } = this, t = w.time, i = a.input, o = a.owner;
    i.fire = i.alt = i.a1 = i.a2 = i.ult = i.melee = i.reload = i.swoop = false; i.jump = false; i.jumpHeld = false;
    i.mx = i.mz = 0;
    // a ghost: nothing hits it, it walks through bodies
    a.set('phased', t, 0.3);
    if (!o || !o.alive || t >= (a.sv.until ?? 0)) { dropEffigy(w, a); return; }
    if (t < (a.sv.riseUntil ?? 0)) return;
    // stand behind Enra, facing where he faces
    const f = o.forward();
    const want = { x: o.pos.x - f.x * BEHIND, z: o.pos.z - f.z * BEHIND };
    const dx = want.x - a.pos.x, dz = want.z - a.pos.z, d = Math.hypot(dx, dz);
    i.yaw = o.yaw; i.pitch = 0;
    if (d > 0.4) {
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), rx = -Math.cos(a.yaw), rz = Math.sin(a.yaw);
      const ux = dx / d, uz = dz / d, k = Math.min(1, d / 2);
      i.mz = (ux * fx + uz * fz) * k; i.mx = (ux * rx + uz * rz) * k;
    }
    // far behind (Enra dashed off, or it got stuck): it simply appears at his back
    if (d > 14) { a.pos = { x: want.x, y: o.pos.y, z: want.z }; a.vel = { x: 0, y: 0, z: 0 }; }
    if (t < this.nextHit) return;
    this.nextHit = t + EFFIGY_HIT.every;
    // the sweep: everyone inside the perimeter it can see
    const eye = { x: a.pos.x, y: a.pos.y + a.height * 0.6, z: a.pos.z };
    let n = 0;
    for (const x of w.enemies(o)) {
      if (!x.alive || x.isSummon || x.def.id === 'bot_dummy') continue;
      if (Math.hypot(x.pos.x - o.pos.x, x.pos.z - o.pos.z) > EFFIGY_R + x.radius || Math.abs(x.pos.y - o.pos.y) > EFFIGY_H) continue;
      if (!w.level.lineOfSight(eye, x.center)) continue;
      const dealt = w.damage(o, x, EFFIGY_HIT.dmg, { kind: 'ability', ability: 'effigy', noLifesteal: true });
      if (dealt > 0) { n++; o.stats.effigyDmg = (o.stats.effigyDmg ?? 0) + dealt; w.fx('hit', x.center, { color: '#ff2a2a' }); }
      // shoved back from the blade, off their feet a little
      if (dealt > 0 && x.def.frame !== 'mech' && !x.isBoss && !x.has('ccimmune', t)) {
        const kx = x.pos.x - a.pos.x, kz = x.pos.z - a.pos.z, kl = Math.hypot(kx, kz) || 1;
        x.forced = { vx: kx / kl * 6, vy: 0, vz: kz / kl * 6, until: t + 0.15, kind: 'knock' };
      }
    }
    a.anim.attackAt = t; a.anim.attackKind = 'primary'; a.anim.attackSide = -(a.anim.attackSide || -1);
    w.fx('effigyswing', a.center, { color: '#ff2a2a', actor: a, r: EFFIGY_R });
    w.sfx(n ? 'punch' : 'whiff', a.center, a);
  }
}

/** Enra's effigy, standing or gone */
export function effigyOf(w: World, owner: Actor) { return w.actors.find(x => x.isSummon && x.def === EFFIGY_DEF && x.owner === owner) ?? null; }

/** the effigy fades where it stands */
export function dropEffigy(w: World, e: Actor) {
  if (!e.alive) return;
  const t = w.time;
  e.alive = false; e.deathAt = t; e.respawnAt = 0; e.forced = null; e.sv.fellAt = t;
  e.owner?.clear('effigy');
  w.fx('effigyfade', e.center, { color: '#ff2a2a', actor: e }); w.sfx('spindown', e.center, e);
}

/** Crimson Effigy: raise it behind him */
export function raiseEffigy(w: World, a: Actor, secs = EFFIGY_SECS): Actor {
  const t = w.time;
  let e = effigyOf(w, a);
  if (e) dropEffigy(w, e);                             // a second cast replaces the first
  if (!e) {
    e = new Actor(EFFIGY_DEF, a.team);
    e.owner = a; e.isRobot = true; e.noRespawn = true; e.alive = false;
    e.controller = new EffigyBrain(w, e);
    w.actors.push(e);
  }
  const f = a.forward();
  const p: V3 = { x: a.pos.x - f.x * BEHIND, y: a.pos.y, z: a.pos.z - f.z * BEHIND };
  const [X, Z] = w.level.size;
  p.x = Math.max(-X + 2, Math.min(X - 2, p.x)); p.z = Math.max(-Z + 2, Math.min(Z - 2, p.z));
  const g = w.level.groundAt(p.x, p.z, a.pos.y + 1.5);
  if (g !== -Infinity && Math.abs(g - a.pos.y) < 2) p.y = g;
  e.team = a.team;
  e.pos = p; e.vel = { x: 0, y: 0, z: 0 };
  e.yaw = e.input.yaw = a.yaw; e.pitch = 0; e.hp = EFFIGY_DEF.hp; e.armor = 0; e.scale = 1;
  e.shields = []; e.wounds = []; e.st = {}; e.sv = {}; e.forced = null;
  e.alive = true; e.respawnAt = 0; e.deathAt = -99; e.lastDamagedAt = t;
  e.sv.riseAt = t; e.sv.riseUntil = t + EFFIGY_RISE; e.sv.until = t + secs;
  e.set('phased', t, 0.3); e.set('spawnprot', t, EFFIGY_RISE);
  const b = e.controller as EffigyBrain; b.nextHit = t + EFFIGY_RISE + EFFIGY_HIT.first;
  a.set('effigy', t, secs);
  return e;
}
