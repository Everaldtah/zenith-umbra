// Hayate's Sun-Alloy Frame (climb any wall to its top, the faster the jump taps the faster he runs and climbs - up to
// KOI_GROOVE_MAX) and Mirror Water after Genji's Deflect (a 2 s window: shots and blows from in front are turned on the
// blade - projectiles and gunfire go back out along his aim, melee stops dead; E again lowers it).
import { World, KOI_GROOVE_MAX, DEFLECT_SECS, DEFLECT_MIN } from '../../src/game/World';
import { castAbility } from '../../src/game/abilities';
import { fire, quickMelee } from '../../src/game/weapons';
import type { Actor } from '../../src/game/Actor';
import type { WeaponDef } from '../../src/data/heroes';

const DT = 1 / 60;
const arena = () => new World('training', 'training');
// a clear, flat lane of the training grounds (as kit.test.ts): x = -10, z from -12 to +14
const OX = -10, OZ = -12;
function place(w: World, id: string, team: 'zenith' | 'umbra', x: number, z: number, yaw = 0): Actor {
  const a = w.addHero(id, team);
  x += OX; z += OZ;
  a.pos = { x, y: Math.max(0, w.level.groundAt(x, z, 30)), z }; a.vel = { x: 0, y: 0, z: 0 };
  a.yaw = a.input.yaw = yaw; a.pitch = a.input.pitch = 0; a.clear('spawnprot');
  return a;
}
function run(w: World, secs: number, each?: (i: number) => void) { for (let i = 0; i < Math.round(secs / DT); i++) { each?.(i); w.step(DT); w.events.length = 0; } }
const flat = (a: Actor, b: Actor) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
const aimAt = (a: Actor, p: { x: number; y: number; z: number }) => {
  const e = a.eye; a.yaw = a.input.yaw = Math.atan2(p.x - e.x, p.z - e.z); a.pitch = a.input.pitch = Math.atan2(p.y - e.y, Math.hypot(p.x - e.x, p.z - e.z));
};
/** a straight shot from `from` at `at`'s chest with a plain projectile weapon */
function shoot(w: World, from: Actor, at: Actor) {
  aimAt(from, at.center);
  const W = from.def.primary as WeaponDef;
  fire(w, from, W, 'primary');
}

describe('Sun-Alloy Frame: the tap-rate speed', () => {
  it('runs up to five times faster when jump is tapped fast, and slows again when the taps stop', () => {
    // (the length of Sunset Mile's highway: at five times his pace he covers 30 m a second)
    const dist = (tapsPerSec: number) => {
      const w = new World('mile', 'practice'), h = w.addHero('hayate', 'zenith');
      for (const o of w.actors) if (o !== h) { o.pos = { x: 60, y: 0, z: -30 }; (o as any).controller = null; }
      h.pos = { x: -58, y: 0, z: 1.5 }; h.vel = { x: 0, y: 0, z: 0 }; h.yaw = h.input.yaw = Math.PI / 2; h.clear('spawnprot'); h.hp = 1e6;
      h.input.mz = 1;
      const every = tapsPerSec ? Math.round(1 / tapsPerSec / DT) : 0;
      let f = 0;
      run(w, 3, () => { h.input.jump = every > 0 && f++ % every === 0; h.input.jumpHeld = false; });      // 3 s to reach the rhythm
      const x0 = h.pos.x; f = 0;
      run(w, 1, () => { h.input.jump = every > 0 && f++ % every === 0; });
      return { d: h.pos.x - x0, rhythm: h.sv.rhythm ?? 1 };
    };
    const slow = dist(0), fast = dist(9);
    expect(slow.rhythm).toBeLessThan(1.05);
    expect(fast.rhythm).toBeGreaterThan(KOI_GROOVE_MAX - 0.3);
    expect(fast.rhythm).toBeLessThanOrEqual(KOI_GROOVE_MAX + 1e-6);
    expect(fast.d / slow.d).toBeGreaterThan(3.5);          // (the jumps themselves cost a little ground speed)
    // the beat stops: the speed follows it down within a second
    const w = arena(), h = place(w, 'hayate', 'zenith', 0, 0, 0);
    h.input.mz = 0; let f = 0;                                    // (on the spot: the lane is short)
    run(w, 3, () => { h.input.jump = f++ % 7 === 0; });
    expect(h.sv.rhythm).toBeGreaterThan(4);
    run(w, 1.5, () => { h.input.jump = false; });
    expect(h.sv.rhythm).toBeLessThan(1.3);
  });
});

describe('Sun-Alloy Frame: climb any wall', () => {
  // a 12 m face, higher than CLIMB_SECS of climb would reach at the base pace with no taps (2.2 s x 6.8 m/s = 15 m is the
  // old budget; the arena walls are the only thing that stops him now)
  function climb(map: string, x: number, z: number, yaw: number, y0: number, secs: number, taps: number) {
    const w = new World(map, 'practice');
    const h = w.addHero('hayate', 'zenith');
    for (const o of w.actors) if (o !== h) { o.pos = { x: 60, y: 0, z: 0 }; (o as any).controller = null; }
    h.pos = { x, y: Math.max(0, w.level.groundAt(x, z, y0 + 1)), z }; h.vel = { x: 0, y: 0, z: 0 };
    h.yaw = h.input.yaw = yaw; h.clear('spawnprot'); h.hp = 1e6;
    h.input.mz = 1;
    const every = taps ? Math.round(1 / taps / DT) : 0;
    let f = 0, climbing = 0, first = -1, stood = false, peak = 0;
    // (jump stays held the whole time, as a player holds it up a face; once on the top he keeps going, so what counts
    // is that he stood on the top at some point)
    run(w, secs, () => { h.input.jumpHeld = true; h.input.jump = every ? f++ % every === 0 : f++ === 0; peak = Math.max(peak, h.pos.y); if (h.has('wallclimb', w.time)) { climbing += DT; if (first < 0) first = w.time; } if (h.grounded && h.pos.y > y0 + 0.5 && !stood) stood = h.pos.y > peak - 0.3; });
    return { y: h.pos.y, grounded: h.grounded, climbing, first, x: h.pos.x, z: h.pos.z, stood, peak };
  }
  it('holds the climb the whole way up a 12 m face with jump only held (no budget)', () => {
    // mile's north butte from its 5 m ledge: the summit is 12 m, a 7 m face; and gulch's crag from the 6 m ledge
    const r = climb('mile', -28, 23.3, 0, 5, 4, 0);
    expect(r.peak).toBeGreaterThan(11.7); expect(r.stood).toBe(true);
    const g = climb('gulch', -11, -26.3, Math.PI, 6, 4, 0);
    expect(g.peak).toBeGreaterThan(11.7); expect(g.stood).toBe(true);
  });
  it('climbs faster with fast taps: the same face in a fraction of the time', () => {
    const w1 = climb('mile', -18, -22.3, Math.PI, 0, 6, 0), w2 = climb('mile', -18, -22.3, Math.PI, 0, 6, 9);
    expect(w1.y).toBeGreaterThan(7.7); expect(w2.y).toBeGreaterThan(7.7);
    // (with taps the rhythm builds during the climb, so the whole 8 m takes clearly less than the untapped 8 / 6.8 s)
    const t1 = w1.first, t2 = w2.first; void t1; void t2;
    expect(w2.climbing).toBeLessThan(w1.climbing * 0.75);
  });
  it("climbs the arena's own walls too, Genji-style: one 7.8 m climb per time in the air, never onto the top", () => {
    // the Proving Grounds: 10 m border walls and nothing else tall - the user's test map
    const r = climb('training', -30, 22, 0, 0, 4, 0);
    expect(r.climbing).toBeGreaterThan(0.5);                   // he ran up it...
    expect(r.peak).toBeGreaterThan(6); expect(r.peak).toBeLessThan(10 - 1.78);   // ...one climb's worth, never near the top
    expect(r.stood).toBe(false);                               // never stood anywhere but the ground
    expect(Math.abs(r.z)).toBeLessThan(26);
    // mile's 22 m walls with fast taps: he never gets above one climb's worth, never on top, never outside
    const w = new World('mile', 'practice'), h = w.addHero('hayate', 'zenith');
    for (const o of w.actors) if (o !== h) { o.pos = { x: 60, y: 0, z: -30 }; (o as any).controller = null; }
    h.pos = { x: -50, y: 0, z: 30 }; h.vel = { x: 0, y: 0, z: 0 }; h.yaw = h.input.yaw = 0; h.clear('spawnprot'); h.hp = 1e6; h.input.mz = 1;
    let f = 0, peak = 0, standing = 0;
    run(w, 6, () => { h.input.jumpHeld = true; h.input.jump = f++ % 7 === 0; peak = Math.max(peak, h.pos.y); if (h.grounded) standing = Math.max(standing, h.pos.y); });
    expect(peak).toBeGreaterThan(6); expect(peak).toBeLessThan(12);
    expect(standing).toBeLessThan(0.5);
    expect(Math.abs(h.pos.z)).toBeLessThan(34);
  });
});

describe('Mirror Water: Genji\'s Deflect', () => {
  it('turns a shot from in front back out along his aim, and it is his shot now', () => {
    const w = arena(), h = place(w, 'hayate', 'zenith', 0, 0, 0), e = place(w, 'kagemaru', 'umbra', 0, 8, Math.PI);
    const bystander = place(w, 'yuzu', 'umbra', 4, 9, Math.PI);
    expect(castAbility(w, h, 'mirrorwater', 'a2')).toBe(true);
    expect(h.has('deflect', w.time)).toBe(true);
    aimAt(h, bystander.center);                                  // he looks at the other one
    const hp0 = h.health, hpB = bystander.health, hpE = e.health;
    shoot(w, e, h);
    const p = w.projs[w.projs.length - 1];
    run(w, 0.5);
    expect(h.health).toBe(hp0);                                  // nothing got through
    expect(p.owner).toBe(h); expect(p.team).toBe('zenith');
    expect(bystander.health).toBeLessThan(hpB);                  // it went where he was aiming...
    expect(e.health).toBe(hpE);                                  // ...not back at the shooter
    expect(h.anim.deflectN).toBe(1);
    expect(h.anim.deflectDir.z).toBeGreaterThan(0.9);            // it came from straight ahead (+z)
    expect(h.stats.deflects).toBe(1);
  });
  it('a shot from behind still lands', () => {
    const w = arena(), h = place(w, 'hayate', 'zenith', 0, 0, 0), e = place(w, 'kagemaru', 'umbra', 0, -8, 0);
    castAbility(w, h, 'mirrorwater', 'a2');
    const hp0 = h.health;
    shoot(w, e, h);
    run(w, 0.5);
    expect(h.health).toBeLessThan(hp0);
    expect(h.anim.deflectN).toBe(0);
  });
  it('blocks a blow from in front, and turns hitscan fire on whoever is in his sights', () => {
    const w = arena(), h = place(w, 'hayate', 'zenith', 0, 0, 0), g = place(w, 'tomoe', 'umbra', 0, 1.7, Math.PI);
    castAbility(w, h, 'mirrorwater', 'a2');
    const hp0 = h.health, hpG = g.health;
    aimAt(g, h.center); quickMelee(w, g);
    expect(h.health).toBe(hp0);
    expect(h.anim.deflectN).toBe(1);                             // the blow reached the blade
    expect(g.has('stun', w.time)).toBe(false);                  // Genji's deflect stops the blow, it does not stagger
    // hitscan: the scattergun from in front, with Hayate aiming at the gunner
    aimAt(h, g.center); aimAt(g, h.center);
    fire(w, g, g.def.primary as WeaponDef, 'primary');
    expect(h.health).toBe(hp0);
    expect(g.health).toBeLessThan(hpG);
    expect(h.anim.deflectN).toBe(2);
  });
  it('lasts DEFLECT_SECS, and E again lowers the blade once DEFLECT_MIN has passed', () => {
    const w = arena(), h = place(w, 'hayate', 'zenith', 0, 0, 0);
    castAbility(w, h, 'mirrorwater', 'a2');
    run(w, DEFLECT_MIN * 0.5);
    h.input.a2 = true; run(w, DT); h.input.a2 = false;
    expect(h.has('deflect', w.time)).toBe(true);                 // too soon to end it
    run(w, DEFLECT_MIN);
    h.input.a2 = true; run(w, DT); h.input.a2 = false;
    expect(h.has('deflect', w.time)).toBe(false);                // E again: lowered
    expect(h.ready('mirrorwater', w.time)).toBe(false);          // and the cooldown runs
    const w2 = arena(), h2 = place(w2, 'hayate', 'zenith', 0, 0, 0);
    castAbility(w2, h2, 'mirrorwater', 'a2');
    run(w2, DEFLECT_SECS - 0.1);
    expect(h2.has('deflect', w2.time)).toBe(true);
    run(w2, 0.2);
    expect(h2.has('deflect', w2.time)).toBe(false);
  });
});

describe('Koi-Scale Shuriken: a prop projectile', () => {
  it('every shuriken he throws carries the prop id and its spin for the renderer', () => {
    const w = arena(), h = place(w, 'hayate', 'zenith', 0, 0, 0), e = place(w, 'kagemaru', 'umbra', 0, 12, Math.PI);
    shoot(w, h, e);
    const mine = w.projs.filter(p => p.owner === h);
    expect(mine.length).toBeGreaterThan(0);
    for (const p of mine) { expect(p.mesh).toBe('prop_hayate_shuriken'); expect(p.spin).toBe(30); }
    // the fan (RMB) throws the same shuriken
    fire(w, h, h.def.secondary as WeaponDef, 'secondary');
    expect(w.projs.filter(p => p.owner === h && p.mesh === 'prop_hayate_shuriken').length).toBeGreaterThan(mine.length);
    // other heroes' projectiles carry none
    shoot(w, e, h);
    expect(w.projs.filter(p => p.owner === e).every(p => !p.mesh)).toBe(true);
  });
});
