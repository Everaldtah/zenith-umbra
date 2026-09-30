// Raijin's Storm Sovereign: a holographic thunder-god giant of himself rises where he stands; for 5 s every enemy within
// 12 m of it under open sky is struck from above (40 a second, the first strike stuns), for the next 5 s the giant cuts
// down whoever is still inside (60 a swing), then it fades; it fades at once if Raijin falls. He fights on freely.
import { World } from '../../src/game/World';
import type { Actor } from '../../src/game/Actor';
import { HERO } from '../../src/data/heroes';
import { FULL } from '../../src/edition';
import { SUSANOO_R, SUSANOO_THUNDER, SUSANOO_BLADE, STRIKE_DMG, SLASH_DMG, susanooOf } from '../../src/game/susanoo';

const DT = 1 / 60;
const OX = -10, OZ = -12;     // the clear lane of the training grounds (see kit.test.ts)
function place(w: World, id: string, team: 'zenith' | 'umbra', x: number, z: number, yaw = 0): Actor {
  const a = w.addHero(id, team);
  x += OX; z += OZ;
  a.pos = { x, y: Math.max(0, w.level.groundAt(x, z, 30)), z }; a.vel = { x: 0, y: 0, z: 0 };
  a.yaw = a.input.yaw = yaw; a.clear('spawnprot');
  return a;
}
function run(w: World, secs: number, each?: () => void) { for (let i = 0; i < Math.round(secs / DT); i++) { each?.(); w.step(DT); w.events.length = 0; } }
const tap = (w: World, a: Actor, k: 'ult' | 'fire') => { (a.input as any)[k] = true; run(w, DT); (a.input as any)[k] = false; };
const arena = () => new World('training', 'training');
function raijin(w: World, x = 0, z = 0) { const r = place(w, 'raijin', 'zenith', x, z); r.ult = r.def.ult.charge; return r; }
/** a target that stands still and never dies (so the counts are clean) */
function dummy(w: World, id: string, x: number, z: number) { const d = place(w, id, 'umbra', x, z, Math.PI); d.hp = 5000; d.maxArmor = d.armor = 0; return d; }

const d = FULL ? describe : describe.skip;
d('Raijin: Storm Sovereign', () => {
  it('is his desktop ultimate; the web build keeps Judgment', () => {
    expect(HERO.raijin.ult.id).toBe(FULL ? 'susanoo' : 'judgment');
  });

  it('the giant rises where he stands, untouchable, and fades after ten seconds', () => {
    const w = arena(), r = raijin(w);
    tap(w, r, 'ult');
    const s = susanooOf(w, r)!;
    expect(s).toBeTruthy();
    expect(s.isSummon).toBe(true);
    expect(Math.hypot(s.pos.x - r.pos.x, s.pos.z - r.pos.z)).toBeLessThan(0.05);
    expect(s.def.height).toBeCloseTo(HERO.raijin.height * 3, 1);
    const foe = dummy(w, 'kaien', 0, 4);
    expect(w.damage(foe, s, 500, { kind: 'weapon' })).toBe(0);
    expect(r.has('sovereign', w.time)).toBe(true);
    run(w, SUSANOO_THUNDER + SUSANOO_BLADE - 0.5);
    expect(susanooOf(w, r)).toBeTruthy();
    run(w, 1);
    expect(susanooOf(w, r)).toBeUndefined();
    expect(r.has('sovereign', w.time)).toBe(false);
    expect(r.alive).toBe(true);
  });

  it('the thunder: 5 strikes of 40 on every enemy inside 12 m under open sky, the first one stuns; not beyond, not under a roof', () => {
    const w = arena(), r = raijin(w);
    const inA = dummy(w, 'kaien', 3, 6), inB = dummy(w, 'yuzu', -6, -4), out = dummy(w, 'gantetsu', 0, SUSANOO_R + 3);
    tap(w, r, 'ult');
    run(w, 0.75);
    expect(inA.has('stun', w.time)).toBe(true);                     // the first strike
    expect(5000 - inA.hp).toBeCloseTo(STRIKE_DMG, 0);
    run(w, SUSANOO_THUNDER - 0.75 + 0.2);
    expect(5000 - inA.hp).toBeCloseTo(STRIKE_DMG * 5, 0);
    expect(5000 - inB.hp).toBeCloseTo(STRIKE_DMG * 5, 0);
    expect(out.hp).toBe(5000);
    expect(r.stats.thunderHits).toBe(10);
    // a roof: the depot on the Gulch keeps the sky out - here, a target moved under the training-room ceiling can't be struck
    const w2 = arena(), r2 = raijin(w2), roofed = dummy(w2, 'kaien', 3, 4);
    const [X] = w2.level.size;
    let spot: { x: number; z: number } | null = null;
    for (let x = -X + 2; x < X - 2 && !spot; x += 2) for (let z = -30; z < 30 && !spot; z += 2) {
      const g = w2.level.groundAt(x, z, 20);
      if (g > -Infinity && g < 0.5 && w2.level.ceilingAt(x, z, g + 2) < Infinity && Math.hypot(x - r2.pos.x, z - r2.pos.z) < SUSANOO_R - 1) spot = { x, z };
    }
    if (spot) {
      roofed.pos = { x: spot.x, y: 0, z: spot.z };
      tap(w2, r2, 'ult'); run(w2, SUSANOO_THUNDER + 0.2);
      expect(roofed.hp).toBe(5000);
    }
  });

  it('the blade: from 5 s the giant walks the perimeter and cuts everyone in reach for 60 a swing, never past 12 m', () => {
    const w = arena(), r = raijin(w);
    const near = dummy(w, 'kaien', 2, 5), out = dummy(w, 'yuzu', 0, SUSANOO_R + 4);
    tap(w, r, 'ult');
    run(w, SUSANOO_THUNDER + 0.1);
    const afterThunder = near.hp;
    const s = susanooOf(w, r)!;
    let farthest = 0;
    run(w, SUSANOO_BLADE - 0.2, () => { farthest = Math.max(farthest, Math.hypot(s.pos.x - r.pos.x, s.pos.z - r.pos.z)); });
    const cuts = (afterThunder - near.hp) / SLASH_DMG;
    expect(cuts).toBeGreaterThanOrEqual(3);
    expect(cuts).toBeLessThanOrEqual(5);
    expect(out.hp).toBe(5000);
    expect(farthest).toBeLessThan(SUSANOO_R + 0.5);
    expect(r.stats.susanooHits).toBeGreaterThanOrEqual(3);
  });

  it('the giant fades the moment Raijin falls, and never feeds his next ultimate', () => {
    const w = arena(), r = raijin(w), foe = dummy(w, 'kaien', 2, 5);
    tap(w, r, 'ult');
    run(w, 1.5);
    expect(susanooOf(w, r)).toBeTruthy();
    const ult = r.ult;
    run(w, 1);
    expect(r.ult - ult).toBeLessThan(6 * 1.01);                    // only the passive trickle (5 a second), no damage charge
    w.kill(r, foe);
    run(w, 0.3);
    expect(susanooOf(w, r)).toBeUndefined();
    expect(r.has('sovereign', w.time)).toBe(false);
  });
});
