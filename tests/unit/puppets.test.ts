// Hex - Grand Puppet Theater: fifty puppets rise, fight for him for 15 s, then fall; they fall with him too.
import { World } from '../../src/game/World';
import type { Actor } from '../../src/game/Actor';
import { PUPPET_COUNT, PUPPET_SECS, PUPPET_RISE, PUPPET_HEAL, PUPPET_HEAL_R, puppetsOf } from '../../src/game/puppets';

const DT = 1 / 60;
function run(w: World, secs: number, each?: () => void) { for (let i = 0; i < Math.round(secs / DT); i++) { each?.(); w.step(DT); w.events.length = 0; } }
function hero(w: World, id: string, team: 'zenith' | 'umbra', x: number, z: number): Actor {
  const a = w.addHero(id, team);
  a.pos = { x, y: Math.max(0, w.level.groundAt(x, z, 1)), z }; a.vel = { x: 0, y: 0, z: 0 }; a.clear('spawnprot');
  return a;
}
function cast(w: World, h: Actor) { h.ult = h.def.ult.charge; h.input.ult = true; run(w, DT); h.input.ult = false; }
const standing = (w: World, h: Actor) => puppetsOf(w, h).filter(p => p.alive);

describe('Hex - Grand Puppet Theater', () => {
  it('raises fifty puppets around him, on the floor, inside the arena', () => {
    const w = new World('training', 'training');
    const h = hero(w, 'hex', 'umbra', 0, -14);
    cast(w, h);
    const ps = standing(w, h);
    expect(ps.length).toBe(PUPPET_COUNT);
    const [X, Z] = w.level.size;
    for (const p of ps) {
      expect(p.team).toBe('umbra');
      expect(Math.hypot(p.pos.x - h.pos.x, p.pos.z - h.pos.z)).toBeLessThan(16);
      expect(Math.abs(p.pos.x)).toBeLessThan(X); expect(Math.abs(p.pos.z)).toBeLessThan(Z);
      expect(Math.abs(p.pos.y - h.pos.y)).toBeLessThan(1.7);
    }
    expect(h.ult).toBe(0);
  });

  it('they close on an enemy and claw it, for the puppeteer\'s damage and none of his ultimate charge', () => {
    const w = new World('training', 'training');
    const h = hero(w, 'hex', 'umbra', 0, -14);
    const foe = hero(w, 'tenkai', 'zenith', 9, -14);
    cast(w, h);
    const hp0 = foe.health;
    run(w, PUPPET_RISE + 4);
    expect(foe.health).toBeLessThan(hp0 - 40);
    expect(h.dmgDone).toBeGreaterThan(40);
    // (his ultimate still charges by itself over time: the same as a Hex who hit nothing)
    const w2 = new World('training', 'training');
    const h2 = hero(w2, 'hex', 'umbra', 0, -14);
    cast(w2, h2);
    run(w2, PUPPET_RISE + 4);
    expect(h.ult).toBeCloseTo(h2.ult, 3);
    expect(standing(w, h).every(p => p.dmgDone === 0)).toBe(true);
  });

  it('they are untouchable while rising, then die to gunfire without feeding kills or ultimate charge', () => {
    const w = new World('training', 'training');
    const h = hero(w, 'hex', 'umbra', 0, -14);
    const foe = hero(w, 'raijin', 'zenith', 30, 14);
    cast(w, h);
    const p = standing(w, h)[0];
    expect(w.damage(foe, p, 500)).toBe(0);                      // rising
    run(w, PUPPET_RISE + 0.5);
    const k0 = foe.kills, u0 = foe.ult;
    w.events.length = 0;
    expect(w.damage(foe, p, 500)).toBeGreaterThan(0);
    expect(p.alive).toBe(false);
    expect(foe.kills).toBe(k0); expect(foe.ult).toBe(u0); expect(foe.dmgDone).toBe(0);
    expect(w.events.some(e => e.t === 'kill')).toBe(false);
    run(w, 5);
    expect(p.alive).toBe(false);                                // no respawn
  });

  it(`the strings go slack after ${PUPPET_SECS} s, and a second cast reuses the same fifty bodies`, () => {
    const w = new World('training', 'training');
    const h = hero(w, 'hex', 'umbra', 0, -14);
    cast(w, h);
    const n0 = w.actors.length;
    run(w, PUPPET_SECS - 0.5);
    expect(standing(w, h).length).toBeGreaterThan(0);
    run(w, 0.7);
    expect(standing(w, h).length).toBe(0);
    cast(w, h);
    expect(standing(w, h).length).toBe(PUPPET_COUNT);
    expect(w.actors.length).toBe(n0);
  });

  it('they fall when the puppeteer falls', () => {
    const w = new World('training', 'training');
    const h = hero(w, 'hex', 'umbra', 0, -14);
    const foe = hero(w, 'raijin', 'zenith', 30, 14);
    cast(w, h);
    run(w, 2);
    h.cd.decoy = w.time + 99;                                   // (his Stitched Decoy would eat the blow)
    w.damage(foe, h, 5000);
    expect(h.alive).toBe(false);
    run(w, 0.1);
    expect(standing(w, h).length).toBe(0);
  });

  it('the life tithe: while the army stands, teammates within 15 m of Hex (and Hex) heal 20 a second, credited to him, with no ultimate charge back', () => {
    const w = new World('training', 'training');
    const h = hero(w, 'hex', 'umbra', 0, 0), near = hero(w, 'enra', 'umbra', 6, 2), far = hero(w, 'raijin', 'umbra', PUPPET_HEAL_R + 6, 0);
    near.hp = near.def.hp - 150; far.hp = far.def.hp - 150; h.hp = h.def.hp - 100;
    for (const x of [near, far, h]) x.lastDamagedAt = 1e9;                 // (no out-of-combat regen muddying the count)
    cast(w, h);
    const ult0 = h.ult, healed0 = h.healDone;
    run(w, 3);
    expect(near.has('tithe', w.time)).toBe(true);
    expect(far.has('tithe', w.time)).toBe(false);
    expect(near.def.hp - near.hp).toBeCloseTo(150 - PUPPET_HEAL * 3, 0);
    expect(far.def.hp - far.hp).toBeCloseTo(150, 0);
    expect(h.def.hp - h.hp).toBeCloseTo(100 - PUPPET_HEAL * 3, 0);
    expect(h.healDone - healed0).toBeCloseTo(PUPPET_HEAL * 3, 0);          // the teammate's share is his healing done
    expect(h.ult - ult0).toBeLessThan(3 * 6);                              // only the passive trickle, nothing from the tithe
    run(w, PUPPET_SECS);
    expect(standing(w, h)).toHaveLength(0);
    const hp = near.hp; run(w, 1);
    expect(near.hp).toBeCloseTo(hp, 0);                                    // the army is down: the tithe stops with it
  });

  it('puppets take no objective, health packs or scoreboard rows', () => {
    const w = new World('training', 'training');
    const h = hero(w, 'hex', 'umbra', 0, -14);
    cast(w, h);
    for (const p of puppetsOf(w, h)) { expect(p.isRobot).toBe(true); expect(p.isSummon).toBe(true); expect(p.noRespawn).toBe(true); }
  });
});
