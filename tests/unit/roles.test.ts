// The Overwatch-style role and sub-role passives (src/game/roles.ts): universal regeneration, the damage role's healing
// cut, tank ultimate economy, overhealth ult charge, stalwart / bruiser tanks, flankers, sharpshooters, medics, tacticians.
import { World, TAIKO_DR } from '../../src/game/World';
import { castAbility } from '../../src/game/abilities';
import { HERO } from '../../src/data/heroes';
import type { Actor } from '../../src/game/Actor';
import { REGEN_RATE, REGEN_DELAY, HEALCUT, TANK_ULT_GEN, VS_TANK_ULT, OVERHEALTH_ULT, STALWART_KNOCK, BRUISER_CRIT, FLANKER_PACK, MEDIC_SELF, TACTICIAN_BANK, MITIGATION_CAP } from '../../src/game/roles';

const DT = 1 / 60;
const arena = () => new World('training', 'training');
const OX = -10, OZ = -12;
function place(w: World, id: string, team: 'zenith' | 'umbra', x: number, z: number, yaw = 0): Actor {
  const a = w.addHero(id, team);
  x += OX; z += OZ;
  a.pos = { x, y: Math.max(0, w.level.groundAt(x, z, 30)), z }; a.vel = { x: 0, y: 0, z: 0 };
  a.yaw = a.input.yaw = yaw; a.clear('spawnprot');
  return a;
}
function run(w: World, secs: number, each?: () => void) { for (let i = 0; i < Math.round(secs / DT); i++) { each?.(); w.step(DT); w.events.length = 0; } }

describe('roster shape (the OW 2026 health bands)', () => {
  it('every hero has a sub-role, damage and support heroes sit at 225-250 health, tanks at 525-650 and ult costs fall in the role bands', () => {
    for (const h of Object.values(HERO)) {
      expect([h.id, h.subrole !== undefined]).toEqual([h.id, true]);
      const total = h.hp + h.armor;
      if (h.role === 'tank') { expect(total).toBeGreaterThanOrEqual(525); expect(total).toBeLessThanOrEqual(650); expect(h.ult.charge).toBeGreaterThanOrEqual(2000); }
      else { expect(total).toBeGreaterThanOrEqual(200); expect(total).toBeLessThanOrEqual(250); }
      if (h.role === 'support') expect(h.ult.charge).toBeGreaterThanOrEqual(2200);
      if (h.role === 'dps') { expect(h.ult.charge).toBeGreaterThanOrEqual(1700); expect(h.ult.charge).toBeLessThanOrEqual(2400); }
    }
  });
});

describe('universal regeneration', () => {
  it('a hurt hero regenerates 20 HP/s once 5 s have passed without a hit - and not before', () => {
    const w = arena(), r = place(w, 'raijin', 'zenith', 0, 0), foe = place(w, 'kagemaru', 'umbra', 0, 5);
    w.damage(foe, r, 100, { kind: 'proj' });
    const hp0 = r.hp;
    run(w, REGEN_DELAY - 0.5);
    expect(r.hp).toBeCloseTo(hp0, 1);
    run(w, 2.5);
    expect(r.hp - hp0).toBeCloseTo(REGEN_RATE * 2, 0);
  });
  it('a fresh hit restarts the clock; Enra starts at 2.5 s; a tank regenerates armor after health', () => {
    const w = arena(), e = place(w, 'enra', 'umbra', 0, 0), g = place(w, 'gantetsu', 'umbra', 5, 0), foe = place(w, 'raijin', 'zenith', 0, 6);
    w.damage(foe, e, 100, { kind: 'proj' }); w.damage(foe, g, 300, { kind: 'proj' });
    const gh = g.hp + g.armor;
    run(w, 3.5);
    expect(e.hp).toBeGreaterThan(e.def.hp - 100 + 15);        // Oni Blood: about a second of regen already
    expect(g.hp + g.armor).toBeCloseTo(gh, 1);                 // the tank waits the full 5 s
    w.damage(foe, g, 1, { kind: 'proj' });
    run(w, 5.5 + 12);
    expect(g.hp).toBe(g.def.hp);                                // health first...
    expect(g.armor).toBeGreaterThan(0);                         // ...then the armor plates come back
  });
});

describe('the damage role: healing cut', () => {
  it('whoever a damage hero hits receives 15% less healing for 2 s; a support\'s hit does not cut', () => {
    const w = arena(), k = place(w, 'kaien', 'zenith', 0, 0), tgt = place(w, 'tenkai', 'zenith', 4, 0), dps = place(w, 'raijin', 'umbra', 0, 8), sup = place(w, 'hex', 'umbra', 3, 8);
    tgt.hp = 100;
    w.damage(dps, tgt, 10, { kind: 'proj' });
    expect(tgt.has('healcut', w.time)).toBe(true);
    expect(w.heal(k, tgt, 100)).toBeCloseTo(100 * (1 - HEALCUT), 3);
    run(w, 2.2);
    expect(tgt.has('healcut', w.time)).toBe(false);
    w.damage(sup, tgt, 10, { kind: 'proj' });
    expect(tgt.has('healcut', w.time)).toBe(false);
    expect(w.heal(k, tgt, 50)).toBeCloseTo(50, 3);
  });
});

describe('ultimate economy', () => {
  it('a point of damage is a point of charge for a damage hero; into a tank it is 60%; a tank\'s own damage builds at 60%; through overhealth at 50%', () => {
    const w = arena(), y = place(w, 'yuzu', 'zenith', 0, 0), tank = place(w, 'gorgoth', 'umbra', 0, 8), squishy = place(w, 'hex', 'umbra', 4, 8), tk = place(w, 'tenkai', 'zenith', 4, 0);
    // (80, not 100: Hex's Stitched Decoy eats a single hit over 90)
    y.ult = 0; w.damage(y, squishy, 80, { kind: 'proj' }); expect(y.ult).toBeCloseTo(80, 3);
    y.ult = 0; const d = w.damage(y, tank, 80, { kind: 'proj' }); expect(d).toBeCloseTo(80 * 0.7, 3); expect(y.ult).toBeCloseTo(d * VS_TANK_ULT, 3);
    tk.ult = 0; w.damage(tk, squishy, 80, { kind: 'proj' }); expect(tk.ult).toBeCloseTo(80 * TANK_ULT_GEN, 3);
    w.shield(squishy, 500, 5, 'test');
    y.ult = 0; w.damage(y, squishy, 80, { kind: 'proj' }); expect(y.ult).toBeCloseTo(80 * OVERHEALTH_ULT, 3);
  });
  it('healing a tank gives 60% charge; a tactician banks up to a quarter past full and keeps it after the ultimate', () => {
    const w = arena(), m = place(w, 'mirei', 'zenith', 0, 0), tank = place(w, 'tenkai', 'zenith', 4, 0), hib = place(w, 'hibiki', 'zenith', -4, 0), al = place(w, 'raijin', 'zenith', -4, 3);
    tank.hp = 100; m.ult = 0; w.heal(m, tank, 100); expect(m.ult).toBeCloseTo(100 * VS_TANK_ULT, 3);
    const cost = hib.def.ult.charge;
    hib.ult = cost; al.hp = 50;
    w.heal(hib, al, 100);                                       // past full: banked at 75%
    expect(hib.ult).toBeCloseTo(cost + 75, 1);
    hib.ult = cost * 2;                                          // the bank is capped
    w.heal(hib, al, 10);
    expect(hib.ult).toBeLessThanOrEqual(cost * (1 + TACTICIAN_BANK) + 1e-6);
    hib.ult = cost + 300;
    hib.grounded = true;
    expect(castAbility(w, hib, 'bassdrop', 'ult')).toBe(true);
    expect(hib.ult).toBeCloseTo(300, 3);                        // kept
    m.ult = m.def.ult.charge * 1.2;                              // a non-tactician never banks
    w.heal(m, al, 10); expect(m.ult).toBeLessThanOrEqual(m.def.ult.charge * 1.2);
  });
});

describe('tank sub-roles', () => {
  it('stalwart (Tomoe): knockbacks are 40% weaker, slows 40% weaker; bruiser (Gantetsu): crits do 25% less, he runs 15% faster under half health', () => {
    const w = arena(), q = place(w, 'tomoe', 'zenith', 0, 0), g = place(w, 'gantetsu', 'umbra', 6, 0), foe = place(w, 'raijin', 'zenith', 0, 6);
    q.forced = { vx: 10, vy: 0, vz: 0, until: w.time + 0.3, kind: 'knock' };
    const qx0 = q.pos.x;
    run(w, 0.3);
    expect(q.pos.x - qx0).toBeGreaterThan(10 * STALWART_KNOCK * 0.3 * 0.8);
    expect(q.pos.x - qx0).toBeLessThan(10 * 0.3 * 0.8);                       // well short of the unscaled shove
    const hp0 = g.hp + g.armor;
    w.damage(foe, g, 100, { kind: 'hitscan', crit: true });
    const took = hp0 - (g.hp + g.armor);
    expect(took).toBeLessThan(100 * BRUISER_CRIT * 0.71);     // the crit cut, then the armor's 30%
    expect(took).toBeGreaterThan(100 * BRUISER_CRIT * 0.69);
    g.hp = 50; g.armor = 0; g.input.mz = 1; q.input.mz = 1;
    const x0 = g.pos.x, z0 = g.pos.z, qx = q.pos.x, qz = q.pos.z;
    run(w, 1);
    const gd = Math.hypot(g.pos.x - x0, g.pos.z - z0), qd = Math.hypot(q.pos.x - qx, q.pos.z - qz);
    expect(gd / qd).toBeGreaterThan(1.1 * HERO.gantetsu.speed / HERO.tomoe.speed);
  });
  it('armor and Taiko Heartbeat together never take more than half a hit', () => {
    const w = arena(), g = place(w, 'gantetsu', 'umbra', 0, 0), foe = place(w, 'raijin', 'zenith', 0, 6);
    castAbility(w, g, 'taiko', 'a2');
    const hp0 = g.hp + g.armor;
    w.damage(foe, g, 100, { kind: 'proj' });
    expect(hp0 - (g.hp + g.armor)).toBeCloseTo(100 * (1 - MITIGATION_CAP), 1);
    expect(TAIKO_DR).toBeLessThan(MITIGATION_CAP);
  });
});

describe('damage and support sub-roles', () => {
  it('flankers get 50 more from a health pack; sharpshooters\' crits refund the movement ability', () => {
    const w = arena(), k = place(w, 'kagemaru', 'umbra', 0, 0), y = place(w, 'yuzu', 'zenith', 0, 0), tgt = place(w, 'enra', 'umbra', 0, 10);
    tgt.hp = 5000;                                              // (no armor, no decoy: the refund reads the damage dealt)
    w.packs.push({ x: k.pos.x, y: k.pos.y, z: k.pos.z, big: false, readyAt: 0 });
    k.hp = 50; run(w, DT);
    expect(k.hp).toBeCloseTo(50 + 75 + FLANKER_PACK, 0);
    y.cd.sunhop = w.time + 7;
    w.damage(y, tgt, 250, { kind: 'proj', crit: true });
    expect(y.cdLeft('sunhop', w.time)).toBeCloseTo(7 - 2.5, 1);
    w.damage(y, tgt, 250, { kind: 'proj', crit: false });
    expect(y.cdLeft('sunhop', w.time)).toBeCloseTo(7 - 2.5, 1);
  });
  it('medics heal themselves for 30% of what they heal others; a tactician does not', () => {
    const w = arena(), m = place(w, 'mirei', 'zenith', 0, 0), h = place(w, 'hibiki', 'zenith', 3, 0), al = place(w, 'raijin', 'zenith', 0, 4);
    m.hp = 100; h.hp = 100; al.hp = 50;
    w.heal(m, al, 100); expect(m.hp).toBeCloseTo(100 + 100 * MEDIC_SELF, 3);
    al.hp = 50; w.heal(h, al, 100); expect(h.hp).toBe(100);
  });
});
