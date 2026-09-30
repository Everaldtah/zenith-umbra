// Enra: the Hellfire Cleaver (a sweeping two-handed blade as his primary) and the Crimson Effigy (a giant untouchable
// hologram of himself that stands behind him for 10 s and sweeps everyone in his perimeter).
import { World } from '../../src/game/World';
import { castAbility } from '../../src/game/abilities';
import { fire } from '../../src/game/weapons';
import { EFFIGY_SECS, EFFIGY_R, EFFIGY_HIT, effigyOf } from '../../src/game/effigy';
import type { Actor } from '../../src/game/Actor';
import type { WeaponDef } from '../../src/data/heroes';

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
const aimAt = (a: Actor, p: { x: number; y: number; z: number }) => { const e = a.eye; a.yaw = a.input.yaw = Math.atan2(p.x - e.x, p.z - e.z); a.pitch = a.input.pitch = 0; };

describe('Hellfire Cleaver', () => {
  it('is a sweeping blade: a swing lands on everyone in front within reach, alternating sides', () => {
    const w = arena(), e = place(w, 'enra', 'umbra', 0, 0, 0);
    const a = place(w, 'raijin', 'zenith', -1, 3, Math.PI), b = place(w, 'yuzu', 'zenith', 1.2, 3.2, Math.PI), far = place(w, 'kaien', 'zenith', 0, 9, Math.PI);
    const hpA = a.health, hpB = b.health, hpF = far.health;
    expect(e.def.primary.kind).toBe('melee'); expect(e.def.primary.sweep).toBe(true);
    aimAt(e, a.center);
    fire(w, e, e.def.primary as WeaponDef, 'primary');
    const side1 = e.anim.attackSide;
    run(w, 0.4);
    expect(a.health).toBeLessThan(hpA); expect(b.health).toBeLessThan(hpB);
    expect(far.health).toBe(hpF);
    fire(w, e, e.def.primary as WeaponDef, 'primary');
    expect(e.anim.attackSide).toBe(-side1);
  });
});

describe('Crimson Effigy', () => {
  it('rises behind him, sweeps every enemy in his perimeter on its own, and fades after EFFIGY_SECS', () => {
    const w = arena(), e = place(w, 'enra', 'umbra', 0, 4, 0);
    const near1 = place(w, 'raijin', 'zenith', -4, 10, Math.PI), near2 = place(w, 'yuzu', 'zenith', 5, 2, Math.PI), out = place(w, 'kaien', 'zenith', 0, 24, Math.PI);
    for (const x of [near1, near2, out]) x.hp = 1e6;
    e.ult = e.def.ult.charge;
    expect(castAbility(w, e, 'effigy', 'ult')).toBe(true);
    const g = effigyOf(w, e)!;
    expect(g).toBeTruthy(); expect(g.alive).toBe(true); expect(g.isSummon).toBe(true); expect(g.owner).toBe(e);
    expect(g.def.model).toBe('enra'); expect(g.def.height).toBeGreaterThan(5);
    // behind him (he faces +z)
    expect(g.pos.z).toBeLessThan(e.pos.z);
    const h1 = near1.health, h2 = near2.health, ho = out.health;
    run(w, 3);
    expect(near1.health).toBeLessThan(h1 - EFFIGY_HIT.dmg * 1.5);       // struck more than once
    expect(near2.health).toBeLessThan(h2 - EFFIGY_HIT.dmg * 1.5);
    expect(out.health).toBe(ho);                                        // 20 m away: outside the perimeter
    expect(e.stats.effigyDmg).toBeGreaterThan(0);
    expect(e.ult).toBeLessThan(e.def.ult.charge * 0.5);                 // its damage doesn't refill his ultimate
    // untouchable: a shot at it does nothing
    const hpG = g.health;
    w.damage(near1, g, 500, { kind: 'proj' });
    expect(g.health).toBe(hpG);
    // it follows him
    e.input.mz = 1; run(w, 2); e.input.mz = 0;
    expect(Math.hypot(g.pos.x - e.pos.x, g.pos.z - e.pos.z)).toBeLessThan(5);
    run(w, EFFIGY_SECS - 5 + 0.3);
    expect(g.alive).toBe(false);
    expect(e.has('effigy', w.time)).toBe(false);
  });
  it('fades with him when he dies, and a second cast replaces the first', () => {
    const w = arena(), e = place(w, 'enra', 'umbra', 0, 4, 0), foe = place(w, 'raijin', 'zenith', 0, 9, Math.PI);
    e.ult = e.def.ult.charge; castAbility(w, e, 'effigy', 'ult');
    const g1 = effigyOf(w, e)!;
    run(w, 1);
    e.ult = e.def.ult.charge; castAbility(w, e, 'effigy', 'ult');
    const g2 = effigyOf(w, e)!;
    expect(w.actors.filter(x => x.isSummon && x.owner === e).length).toBe(1);   // one body, reused
    expect(g2).toBe(g1); expect(g2.alive).toBe(true);
    w.damage(foe, e, 1e6, { kind: 'ability' });
    expect(e.alive).toBe(false);
    run(w, 0.5);
    expect(g2.alive).toBe(false);
    expect(EFFIGY_R).toBe(12);
  });
});
