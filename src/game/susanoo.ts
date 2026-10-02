// Raijin - Storm Sovereign: a holographic giant of himself in the robes of a thunder god rises at his back. For five
// seconds every enemy inside the perimeter around the spot he cast it is struck by lightning from the sky - the giant
// facing the nearest of them and hurling each bolt down at it with its sword arm; for the next five the giant strides
// after every enemy in that perimeter or around Raijin himself and cuts them down (with no one to cut it keeps to his
// side); then it fades. Raijin fights on freely the whole time.
//
// The giant is an Actor from the same summon plumbing as Hex's puppets (def.summoned -> isSummon: no kill feed, no ult
// charge for hitting it, no respawn), untouchable ('phased') and drawn by its own view (HeroDef.model / holo / scale, the
// contract shared with Enra's Crimson Effigy), not the puppet swarm.
import type { HeroDef, AbilityDef } from '../data/heroes';
import type { V3 } from '../engine/Physics';
import { Actor } from './Actor';
import type { World } from './World';
import { dist3 } from './World';

/** the perimeter (m) around the spot he cast it */
export const SUSANOO_R = 12;
/** the two halves (s): the thunder, then the giant's blade */
export const SUSANOO_THUNDER = 5, SUSANOO_BLADE = 5;
/** the thunder: strikes at this cadence (s) for this much each; the first one stuns for STUN s; a roof keeps it out */
export const STRIKE_EVERY = 1, STRIKE_DMG = 40, STRIKE_STUN = 0.4, STRIKE_FIRST = 0.6;
/** the blade: a sweep this far around the giant (m) for this much, at this cadence (s); it walks at SPEED */
export const SLASH_R = 5.5, SLASH_DMG = 60, SLASH_EVERY = 1, SUSANOO_SPEED = 5;
export const SUSANOO_COLOR = '#8ad8ff';
/** where it rises (m): this far to his right and ahead (or behind him where walls are in the way) - in sight, and never
 *  with the camera inside it */
export const SUSANOO_SIDE = 3.5, SUSANOO_AHEAD = 4, SUSANOO_BEHIND = 3;
/** first person: the camera pulls out to third person this long after the cast (s) - the rise and the first bolt hurled */
export const SUSANOO_SHOWCASE = 1.5;
/** the blade half, with no one left to cut: it strides back to within this much of his side (m) */
export const SUSANOO_FOLLOW = 6;

const none = (id: string): AbilityDef => ({ id, name: '-', key: '-', cooldown: 999, desc: '' });
export const SUSANOO_DEF: HeroDef = {
  id: 'susanoo', name: 'Storm Sovereign', title: "Raijin's Susanoo", team: 'zenith', role: 'dps', frame: 'human', rival: '',
  hp: 1e6, armor: 0, speed: SUSANOO_SPEED, height: 5.4, radius: 1.2, color: '#ffe066', glow: SUSANOO_COLOR,
  // (the blade is swung by the brain below: the weapon system never fires for it)
  primary: { kind: 'melee', name: 'Storm Blade', damage: SLASH_DMG, rate: 1 / SLASH_EVERY, range: SLASH_R, sfx: 'none', fx: 'none' },
  secondary: none('none'), ability1: none('none'), ability2: none('none'), ult: { ...none('none'), charge: 1e9 },
  passive: { name: '', desc: '' }, lore: 'The thunder god Raijin sees in the mirror.', inspiration: '', voice: [120, 0.3],
  summoned: true, full: true,
  model: 'raijin_susanoo', holo: SUSANOO_COLOR, scale: 3,    // (system32-82's Tripo Zeus-robed giant, published at 5.4 m)
};

/** a strike from the sky reaches a target that has open sky above it (roofs keep the thunder out) */
export function skyOpen(w: World, x: Actor): boolean {
  return w.level.ceilingAt(x.pos.x, x.pos.z, x.pos.y + x.height) === Infinity;
}

class SusanooBrain {
  nextSlash = 0;
  target: Actor | null = null;
  constructor(public w: World, public a: Actor) {}

  think(_dt: number) {
    const { w, a } = this, t = w.time, i = a.input;
    i.fire = i.alt = i.a1 = i.a2 = i.ult = i.melee = i.reload = i.swoop = false; i.jump = false; i.jumpHeld = false;
    i.mx = i.mz = 0;
    const owner = a.owner!, anchor: V3 = { x: a.sv.ax, y: a.sv.ay, z: a.sv.az };
    const foes = w.actors.filter(x => x.alive && x.team !== a.team && !x.isSummon && !x.has('phased', t));
    const nearest = (xs: Actor[]) => { let b: Actor | null = null, bd = Infinity; for (const x of xs) { const d = dist3(x.pos, a.pos); if (d < bd) { bd = d; b = x; } } return [b, bd] as const; };
    const face = (p: V3) => { i.yaw = Math.atan2(p.x - a.pos.x, p.z - a.pos.z); i.pitch = 0; };
    // the first half: it stands planted, its free hand to the sky, and hurls the thunder down at the nearest foe it is
    // striking (tickSusanoo keeps it in place; sv.phase 0 -> 1)
    if (t < a.sv.bladeAt) {
      a.sv.phase = 0;
      const [tgt] = nearest(foes.filter(x => dist3(x.pos, anchor) <= SUSANOO_R + x.radius));
      if (tgt) face(tgt.pos); else i.yaw = owner.yaw;
      this.target = tgt;
      return;
    }
    a.sv.phase = 1;
    // the second half hunts the perimeter around the spot he cast it AND the ground around Raijin himself: the giant
    // fights at his side wherever the fight has moved, instead of standing guard over an empty circle
    const hunted = (x: Actor) => dist3(x.pos, anchor) <= SUSANOO_R + x.radius || (owner.alive && dist3(x.pos, owner.pos) <= SUSANOO_R + x.radius);
    const inside = foes.filter(hunted);
    const [best, bd] = nearest(inside);
    this.target = best;
    if (!best) {
      // no one to cut: stride back to his side and stand ready, facing where he looks
      const f = owner.forward(), spot: V3 = { x: owner.pos.x - f.x * SUSANOO_BEHIND, y: owner.pos.y, z: owner.pos.z - f.z * SUSANOO_BEHIND };
      if (Math.hypot(spot.x - a.pos.x, spot.z - a.pos.z) > SUSANOO_FOLLOW) { face(spot); i.mz = 1; } else i.yaw = owner.yaw;
      return;
    }
    face(best.pos);
    // close to blade reach (it walks wherever its quarry goes inside the hunting ground)
    const reach = a.radius + best.radius + SLASH_R * 0.6;
    if (bd > reach) i.mz = 1;
    if (t >= this.nextSlash) {
      this.nextSlash = t + SLASH_EVERY;
      a.anim.attackAt = t; a.anim.attackKind = 'primary'; a.anim.attackSide = (a.sv.swings = (a.sv.swings ?? 0) + 1) % 2;
      let n = 0;
      for (const x of inside) {
        if (dist3(x.pos, a.pos) > a.radius + x.radius + SLASH_R) continue;
        // the giant's damage is Raijin's (his kills, his damage done) but never feeds his next ultimate
        if (w.damage(owner, x, SLASH_DMG, { kind: 'ability', ability: 'susanoo', noLifesteal: true }) > 0) n++;
        w.fx('slash', x.center, { color: SUSANOO_COLOR });
      }
      w.fx('susanooslash', a.center, { r: SLASH_R, color: SUSANOO_COLOR, actor: a, dur: 0.5 }); w.sfx(n ? 'katana' : 'whiff', a.center, a);
      if (n) w.sfx('thunder', a.center, a);
      owner.stats.susanooHits = (owner.stats.susanooHits ?? 0) + n;
    }
  }
}

/** Raijin's standing giant, if one is up */
export function susanooOf(w: World, owner: Actor): Actor | undefined { return w.actors.find(x => x.isSummon && x.owner === owner && x.def.id === 'susanoo' && x.alive); }

/** the giant fades: at ten seconds, or when Raijin falls */
export function dismissSusanoo(w: World, owner: Actor) {
  const s = susanooOf(w, owner);
  if (!s) return false;
  s.alive = false; s.deathAt = w.time; s.respawnAt = 0; s.forced = null; s.sv.fellAt = w.time;
  owner.clear('sovereign');
  w.fx('susanoofade', s.center, { color: SUSANOO_COLOR, actor: s, dur: 0.8 }); w.sfx('spindown', s.center, s);
  return true;
}

/** the thunder: one strike on every enemy in the perimeter with open sky above (called on the cadence by tickSusanoo) */
function thunder(w: World, owner: Actor, s: Actor, first: boolean) {
  const t = w.time, anchor: V3 = { x: s.sv.ax, y: s.sv.ay, z: s.sv.az };
  let n = 0;
  for (const x of w.actors) {
    if (!x.alive || x.team === owner.team || x.isSummon || x.has('phased', t) || dist3(x.pos, anchor) > SUSANOO_R + x.radius) continue;
    if (!skyOpen(w, x)) continue;
    const dealt = w.damage(owner, x, STRIKE_DMG, { kind: 'ability', ability: 'susanoo', noLifesteal: true });
    if (first && !x.has('ccimmune', t) && !x.isBoss) x.set('stun', t, STRIKE_STUN, undefined, owner);
    w.fx('skybolt', x.pos, { color: SUSANOO_COLOR, actor: owner, target: x }); w.sfx('thunderclap', x.center, x);
    if (dealt > 0) n++;
  }
  owner.stats.thunderHits = (owner.stats.thunderHits ?? 0) + n;
  s.sv.strikes = (s.sv.strikes ?? 0) + 1;
  // the giant calls each bolt: the sky strikes its raised blade as it hurls the thunder down (the renderer's hurl is
  // timed off sv.strikeAt)
  s.sv.strikeAt = t;
  w.fx('stormcall', s.center, { color: SUSANOO_COLOR, actor: s });
  return n;
}

/** Storm Sovereign: the giant rises where Raijin stands */
export function raiseSusanoo(w: World, a: Actor) {
  const t = w.time;
  dismissSusanoo(w, a);                                // a second cast replaces the first giant
  let s = w.actors.find(x => x.isSummon && x.owner === a && x.def.id === 'susanoo');
  if (!s) {
    s = new Actor(SUSANOO_DEF, a.team);
    s.owner = a; s.isRobot = true; s.noRespawn = true; s.alive = false;
    s.controller = new SusanooBrain(w, s);
    w.actors.push(s);
  }
  s.team = a.team;
  // it rises at his right shoulder, a few steps ahead - in the right of a first-person view and beside him in third person,
  // never with the camera inside its robes (the perimeter stays centred on the spot he cast it). A wall there: the left
  // shoulder, then his back, then where he stands
  const f = a.forward(), rt = { x: -f.z, z: f.x }, [X, Z] = w.level.size, eye = a.pos.y + 1.4;
  const spots = [[SUSANOO_SIDE, SUSANOO_AHEAD], [-SUSANOO_SIDE, SUSANOO_AHEAD], [0, -SUSANOO_BEHIND], [0, 0]].map(([r, fw]) => ({
    x: Math.max(-X + 2, Math.min(X - 2, a.pos.x + rt.x * r + f.x * fw)), y: a.pos.y, z: Math.max(-Z + 2, Math.min(Z - 2, a.pos.z + rt.z * r + f.z * fw)) }));
  const p: V3 = spots.find(q => w.level.lineOfSight({ x: a.pos.x, y: eye, z: a.pos.z }, { x: q.x, y: eye, z: q.z })) ?? spots[3];
  const g = w.level.groundAt(p.x, p.z, a.pos.y + 1.5);
  if (g !== -Infinity && Math.abs(g - a.pos.y) < 2) p.y = g;
  s.pos = p; s.vel = { x: 0, y: 0, z: 0 };
  s.yaw = s.input.yaw = a.yaw; s.pitch = 0;
  s.hp = SUSANOO_DEF.hp; s.armor = 0; s.scale = 1;
  s.shields = []; s.wounds = []; s.st = {}; s.sv = {}; s.forced = null;
  s.alive = true; s.respawnAt = 0; s.deathAt = -99; s.lastDamagedAt = t;
  s.set('phased', t, SUSANOO_THUNDER + SUSANOO_BLADE + 1);          // a hologram: nothing touches it, it touches nothing
  s.set('ccimmune', t, SUSANOO_THUNDER + SUSANOO_BLADE + 1);
  s.sv.ax = a.pos.x; s.sv.ay = a.pos.y; s.sv.az = a.pos.z; s.sv.risenAt = t;
  s.sv.gx = p.x; s.sv.gz = p.z;                        // where it stands planted through the thunder
  // (the renderer's contract, shared with the Enra effigy: when it rose, when it is fully up, when it goes)
  s.sv.riseAt = t; s.sv.riseUntil = t + 0.6; s.sv.until = t + SUSANOO_THUNDER + SUSANOO_BLADE; s.sv.bladeAt = t + SUSANOO_THUNDER; s.sv.fadeAt = t + SUSANOO_THUNDER + SUSANOO_BLADE;
  s.sv.nextStrike = t + STRIKE_FIRST; s.sv.strikes = 0; s.sv.phase = 0;
  (s.controller as SusanooBrain).nextSlash = t + SUSANOO_THUNDER + 0.4;
  a.set('sovereign', t, SUSANOO_THUNDER + SUSANOO_BLADE);
  const cast = t; a.sv.susanooCast = cast;
  w.after(SUSANOO_THUNDER + SUSANOO_BLADE, () => { if (a.sv.susanooCast === cast) dismissSusanoo(w, a); });
  return s;
}

/** per tick: the thunder cadence, and the giant fading with its summoner */
export function tickSusanoo(w: World) {
  const t = w.time;
  for (const s of w.actors) {
    if (!s.alive || !s.isSummon || s.def.id !== 'susanoo' || !s.owner) continue;
    if (!s.owner.alive) { dismissSusanoo(w, s.owner); continue; }
    // the giant stays planted over its anchor through the thunder, whatever shoves come its way
    if (t < s.sv.bladeAt) { s.pos.x = s.sv.gx; s.pos.z = s.sv.gz; s.vel.x = s.vel.z = 0; }
    if (t < s.sv.bladeAt && t >= s.sv.nextStrike && s.sv.strikes < Math.round(SUSANOO_THUNDER / STRIKE_EVERY)) {
      s.sv.nextStrike = t + STRIKE_EVERY;
      thunder(w, s.owner, s, s.sv.strikes === 0);
    }
  }
}
