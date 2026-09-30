// Raijin - Storm Sovereign: a holographic giant of himself in the robes of a thunder god rises where he stands. For five
// seconds every enemy inside its perimeter is struck by lightning from the sky; for the next five the giant cuts down
// whoever is still standing in it; then it fades. Raijin fights on freely the whole time.
//
// The giant is an Actor from the same summon plumbing as Hex's puppets (def.summoned -> isSummon: no kill feed, no ult
// charge for hitting it, no respawn), untouchable ('phased') and drawn by its own view, not the puppet swarm.
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

const none = (id: string): AbilityDef => ({ id, name: '-', key: '-', cooldown: 999, desc: '' });
export const SUSANOO_DEF: HeroDef = {
  id: 'susanoo', name: 'Storm Sovereign', title: "Raijin's Susanoo", team: 'zenith', role: 'dps', frame: 'human', rival: '',
  hp: 1e6, armor: 0, speed: SUSANOO_SPEED, height: 5.4, radius: 1.2, color: '#ffe066', glow: SUSANOO_COLOR,
  // (the blade is swung by the brain below: the weapon system never fires for it)
  primary: { kind: 'melee', name: 'Storm Blade', damage: SLASH_DMG, rate: 1 / SLASH_EVERY, range: SLASH_R, sfx: 'none', fx: 'none' },
  secondary: none('none'), ability1: none('none'), ability2: none('none'), ult: { ...none('none'), charge: 1e9 },
  passive: { name: '', desc: '' }, lore: 'The thunder god Raijin sees in the mirror.', inspiration: '', voice: [120, 0.3],
  summoned: true, full: true,
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
    // the first half: it stands over the anchor, arms to the sky, and the thunder does the work (sv.phase 0 -> 1)
    if (t < a.sv.bladeAt) { a.sv.phase = 0; return; }
    a.sv.phase = 1;
    const inside = w.actors.filter(x => x.alive && x.team !== a.team && !x.isSummon && !x.has('phased', t) && dist3(x.pos, anchor) <= SUSANOO_R + x.radius);
    if (!inside.length) { this.target = null; return; }
    let best = inside[0], bd = Infinity;
    for (const x of inside) { const d = dist3(x.pos, a.pos); if (d < bd) { bd = d; best = x; } }
    this.target = best;
    i.yaw = Math.atan2(best.pos.x - a.pos.x, best.pos.z - a.pos.z); i.pitch = 0;
    // close to blade reach, never past the perimeter
    const reach = a.radius + best.radius + SLASH_R * 0.6;
    if (bd > reach && dist3(a.pos, anchor) < SUSANOO_R) { i.mz = 1; }
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
  s.pos = { ...a.pos }; s.vel = { x: 0, y: 0, z: 0 };
  s.yaw = s.input.yaw = a.yaw; s.pitch = 0;
  s.hp = SUSANOO_DEF.hp; s.armor = 0; s.scale = 1;
  s.shields = []; s.wounds = []; s.st = {}; s.sv = {}; s.forced = null;
  s.alive = true; s.respawnAt = 0; s.deathAt = -99; s.lastDamagedAt = t;
  s.set('phased', t, SUSANOO_THUNDER + SUSANOO_BLADE + 1);          // a hologram: nothing touches it, it touches nothing
  s.set('ccimmune', t, SUSANOO_THUNDER + SUSANOO_BLADE + 1);
  s.sv.ax = a.pos.x; s.sv.ay = a.pos.y; s.sv.az = a.pos.z; s.sv.risenAt = t;
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
    if (t < s.sv.bladeAt) { s.pos.x = s.sv.ax; s.pos.z = s.sv.az; s.vel.x = s.vel.z = 0; }
    if (t < s.sv.bladeAt && t >= s.sv.nextStrike && s.sv.strikes < Math.round(SUSANOO_THUNDER / STRIKE_EVERY)) {
      s.sv.nextStrike = t + STRIKE_EVERY;
      thunder(w, s.owner, s, s.sv.strikes === 0);
    }
  }
}
