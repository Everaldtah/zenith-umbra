// Kaien's Divine Seal Storm (after Senbonzakura Kageyoshi): 15 s of golden seals - a shield of them on him that re-forms,
// the rest bursting on every enemy in reach he can see, every half second.
import { World } from '../../src/game/World';
import { castAbility, SEALSTORM_SECS, SEALSTORM_SHIELD, SEALSTORM_R, SEALSTORM_DMG, SEALSTORM_REFORM, SEALSTORM_HEAL } from '../../src/game/abilities';
import type { Actor } from '../../src/game/Actor';

const DT = 1 / 60;
const arena = () => new World('training', 'training');
const OX = -10, OZ = -12;
function place(w: World, id: string, team: 'zenith' | 'umbra', x: number, z: number, yaw = 0): Actor {
  const a = w.addHero(id, team);
  x += OX; z += OZ;
  a.pos = { x, y: Math.max(0, w.level.groundAt(x, z, 30)), z }; a.vel = { x: 0, y: 0, z: 0 };
  a.yaw = a.input.yaw = yaw; a.pitch = a.input.pitch = 0; a.clear('spawnprot');
  return a;
}
function run(w: World, secs: number, each?: () => void) { for (let i = 0; i < Math.round(secs / DT); i++) { each?.(); w.step(DT); w.events.length = 0; } }
const seal = (a: Actor) => a.shields.find(s => s.kind === 'sealshield');

describe('Divine Seal Storm', () => {
  it('shields him with seals and bursts on every enemy in reach he can see, for SEALSTORM_SECS', () => {
    const w = arena(), k = place(w, 'kaien', 'zenith', 0, 4, 0);
    const n1 = place(w, 'raijin', 'umbra', -5, 12, Math.PI), n2 = place(w, 'enra', 'umbra', 6, 8, Math.PI), far = place(w, 'hex', 'umbra', 0, 25, Math.PI);
    k.ult = k.def.ult.charge;
    expect(castAbility(w, k, 'sealstorm', 'ult')).toBe(true);
    expect(k.has('sealstorm', w.time)).toBe(true);
    expect(seal(k)?.amt).toBe(SEALSTORM_SHIELD);
    const h1 = n1.health, h2 = n2.health, hf = far.health;
    run(w, 3);
    // about six beats: each of the two in reach took most of them
    expect(h1 - n1.health).toBeGreaterThan(SEALSTORM_DMG * 4); expect(h2 - n2.health).toBeGreaterThan(SEALSTORM_DMG * 4);
    expect(far.health).toBe(hf);                                            // 21 m: out of reach
    expect(k.stats.sealstormDmg).toBeGreaterThan(0);
    expect(Math.hypot(far.pos.x - k.pos.x, far.pos.z - k.pos.z)).toBeGreaterThan(SEALSTORM_R);
    // the shield takes a hit for him, and re-forms once spent
    const hp0 = k.health;
    w.damage(n1, k, 200, { kind: 'proj' });
    expect(k.health).toBe(hp0); expect(seal(k)!.amt).toBe(SEALSTORM_SHIELD - 200);
    w.damage(n1, k, 150, { kind: 'proj' });
    expect(k.health).toBeLessThan(hp0);                                     // 50 got through
    run(w, SEALSTORM_REFORM + 0.2);
    expect(seal(k)?.amt).toBeGreaterThan(0);                                // re-formed
    // it ends
    run(w, SEALSTORM_SECS - 3 - SEALSTORM_REFORM);
    expect(k.has('sealstorm', w.time)).toBe(false);
    const hAfter = n1.health;
    run(w, 1.5);
    expect(n1.health).toBeGreaterThanOrEqual(hAfter);                   // no more bursts (regen may tick)
  });
  it('does not burst through walls or on a phased body', () => {
    // the training grounds' ramp (x 15-20) and 3 m wall block (x 20-28) on z = 0: Kaien before them, the enemy behind
    const w = arena(), k = w.addHero('kaien', 'zenith'), e = w.addHero('kagemaru', 'umbra');
    k.pos = { x: 13, y: 0, z: 0 }; k.yaw = k.input.yaw = Math.PI / 2; k.clear('spawnprot');
    e.pos = { x: 30, y: 0, z: 0 }; e.clear('spawnprot');
    k.ult = k.def.ult.charge; castAbility(w, k, 'sealstorm', 'ult');
    const h = e.health;
    run(w, 2);
    expect(e.health).toBe(h);
    e.pos = { x: 13, y: 0, z: 6 };                                       // out in the open beside him
    run(w, 1.2);
    expect(e.health).toBeLessThan(h);
    const h2 = e.health;
    run(w, 1.2, () => e.set('phased', w.time, 0.3));
    expect(e.health).toBe(h2);
  });
  it('bursts on training dummies too (the Proving Grounds targets, the Ult Viewer)', () => {
    const w = arena(), k = place(w, 'kaien', 'zenith', 0, 4, 0), d = w.addHero('bot_dummy', 'umbra');
    d.pos = { x: OX + 2, y: 0, z: OZ + 12 }; d.clear('spawnprot');
    const hd = d.health;
    k.ult = k.def.ult.charge; castAbility(w, k, 'sealstorm', 'ult');
    run(w, 2);
    expect(d.health).toBeLessThan(hd);
  });
  it('mends every ally in reach he can see, credited to him', () => {
    const w = arena(), k = place(w, 'kaien', 'zenith', 0, 4, 0), al = place(w, 'raijin', 'zenith', 4, 8), farAl = place(w, 'yuzu', 'zenith', 0, 26);
    al.hp = 50; farAl.hp = 50;
    k.ult = k.def.ult.charge; castAbility(w, k, 'sealstorm', 'ult');
    run(w, 3);
    expect(al.hp).toBeGreaterThan(50 + SEALSTORM_HEAL * 4);              // about six beats
    expect(farAl.hp).toBe(50);                                            // 22 m: out of reach
    expect(k.stats.sealstormHeal).toBeGreaterThan(0);
    expect(k.healDone).toBeGreaterThan(0);                                // feeds his ult economy like any heal
  });
});
