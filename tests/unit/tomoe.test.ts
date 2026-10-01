// Tomoe, The Crescent Empress: the Crownfire Scattergun, the Crescent Fang (throw, stick, recall + yank, cut on the way
// home, cooldown from the catch), wounds and Blood Tide's healing, Horagai War Call, Crescent Reaping's cooldown refunds,
// Tide of Blades, and her counter to Lady Nocturne.
import { World } from '../../src/game/World';
import type { Actor } from '../../src/game/Actor';
import { HERO, rosterFor } from '../../src/data/heroes';
import { lineup } from '../../src/game/setup';
import { FANG_DMG, FANG_WOUND } from '../../src/game/abilities';

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
const tap = (w: World, a: Actor, k: 'a1' | 'a2' | 'ult' | 'alt' | 'fire' | 'melee') => { (a.input as any)[k] = true; run(w, DT); (a.input as any)[k] = false; };
const arena = () => new World('training', 'training');
const flat = (a: Actor, b: Actor) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);

describe('Tomoe', () => {
  it('is a desktop-edition Zenith tank the role queue can field', () => {
    expect(HERO.tomoe.role).toBe('tank'); expect(HERO.tomoe.team).toBe('zenith');
    expect(rosterFor(false).some(h => h.id === 'tomoe')).toBe(false);
    expect(rosterFor(true).some(h => h.id === 'tomoe')).toBe(true);
    expect(lineup('tomoe').some(h => h.id === 'tomoe')).toBe(true);
  });

  it('Crownfire Scattergun: ten pellets, a close-range blast lands most of its 80', () => {
    const w = arena();
    const q = place(w, 'tomoe', 'zenith', 0, 0), foe = place(w, 'gantetsu', 'umbra', 0, 3);
    const before = foe.health;
    tap(w, q, 'fire'); run(w, 0.1);
    expect(before - foe.health).toBeGreaterThan(35);          // (his armor takes 30% off every pellet, the Bruiser sub-role a quarter off the headshot pellets)
    expect(q.ammo).toBe(5);
  });

  it('Crescent Fang: sticks in the enemy it hits, the wound bleeds 30 and heals her 150% of it, RMB yanks them in', () => {
    const w = arena();
    const q = place(w, 'tomoe', 'zenith', 0, 0), foe = place(w, 'enra', 'umbra', 0, 12);
    q.hp = 300;
    const h0 = foe.health;
    tap(w, q, 'alt');
    run(w, 0.5);
    expect(q.sv.fang).toBe(3);                                   // riding the target
    expect(h0 - foe.health).toBeGreaterThanOrEqual(FANG_DMG - 1);
    run(w, 3);
    expect(foe.wounds.length).toBe(0);
    expect(q.hp).toBeGreaterThan(300 + FANG_WOUND * 1.5 * 0.9);
    // recall: the blade drags the target toward her and flies home
    const d0 = flat(q, foe);
    tap(w, q, 'alt');
    run(w, 0.4);
    expect(flat(q, foe)).toBeLessThan(d0 - 5);
    run(w, 1);
    expect(q.sv.fang).toBe(0);
    // the cooldown only started when it was caught
    expect(q.cdLeft('crescent', w.time)).toBeGreaterThan(4.5);
  });

  it('a throw into open air comes home by itself and cuts whoever is in its path', () => {
    const w = arena();
    const q = place(w, 'tomoe', 'zenith', 0, 0);
    q.input.pitch = 0.12;
    tap(w, q, 'alt');
    run(w, 1.2);
    if (q.sv.fang === 2) tap(w, q, 'alt');                      // it found a wall: call it back
    expect(q.sv.fang).toBe(4);
    // an enemy steps into the return path
    const foe = place(w, 'raijin', 'umbra', 0, 2.5);
    const h0 = foe.health;
    run(w, 2);
    expect(q.sv.fang).toBe(0);
    expect(foe.health).toBeLessThan(h0);
  });

  it('quick melee wounds with the blade in hand, not with it thrown', () => {
    const w = arena();
    const q = place(w, 'tomoe', 'zenith', 0, 0), foe = place(w, 'raijin', 'umbra', 0, 1.5);
    tap(w, q, 'melee');
    expect(foe.wounds.length).toBe(1);
    run(w, 3.5);
    foe.hp = foe.def.hp;
    // thrown the other way (not into him), then turn back and jab
    q.input.yaw = Math.PI; run(w, DT); tap(w, q, 'alt'); q.input.yaw = 0;
    run(w, 0.1);
    expect(q.sv.fang).toBeGreaterThan(0);
    tap(w, q, 'melee');
    expect(foe.wounds.length).toBe(0);
  });

  it('Horagai War Call: 150 for her, 75 for allies within 15m, +30% speed; not beyond 15m', () => {
    const w = arena();
    const q = place(w, 'tomoe', 'zenith', 0, 0), near = place(w, 'raijin', 'zenith', 5, 0), far = place(w, 'yuzu', 'zenith', 0, 22);
    tap(w, q, 'a1');
    expect(q.shields.find(s => s.kind === 'warcall')?.amt).toBe(150);
    expect(near.shields.find(s => s.kind === 'warcall')?.amt).toBe(75);
    expect(far.shields.some(s => s.kind === 'warcall')).toBe(false);
    expect(near.has('speed', w.time)).toBe(true); expect(near.sv.speed).toBeCloseTo(1.3, 2);
    run(w, 3.2);
    expect(near.shields.some(s => s.kind === 'warcall')).toBe(false);
  });

  it('Crescent Reaping: 90 + a 40 wound to everyone in front, a second off the cooldown per enemy cut', () => {
    const w = arena();
    const q = place(w, 'tomoe', 'zenith', 0, 0), a = place(w, 'raijin', 'umbra', -1.2, 3), b = place(w, 'yuzu', 'umbra', 1.5, 3.5), behind = place(w, 'hex', 'umbra', 0, -3);
    tap(w, q, 'a2');
    const cast = w.time;
    run(w, 0.6);
    expect(a.def.hp - a.hp).toBeGreaterThanOrEqual(90);
    expect(b.def.hp - b.hp).toBeGreaterThanOrEqual(90);
    expect(behind.hp).toBe(behind.def.hp);
    expect(a.wounds.length).toBe(1);
    expect(q.cd.reaping).toBeCloseTo(cast + 8 - 2, 1);
  });

  it('Tide of Blades: a 20m unstoppable charge that cuts, wounds and anti-heals the lane, then resets her cooldowns', () => {
    const w = arena();
    const q = place(w, 'tomoe', 'zenith', 0, 0), foe = place(w, 'raijin', 'umbra', 0.8, 8), off = place(w, 'yuzu', 'umbra', 6, 8);
    q.ult = q.def.ult.charge; q.cd.reaping = w.time + 8;
    const z0 = q.pos.z;
    tap(w, q, 'ult');
    expect(q.has('ccimmune', w.time)).toBe(true);
    run(w, 0.4);
    expect(foe.has('antiheal', w.time)).toBe(true);
    expect(foe.wounds.length).toBe(1);
    expect(off.hp).toBe(off.def.hp);
    run(w, 1);
    expect(q.pos.z - z0).toBeGreaterThan(15);
    expect(q.ready('reaping', w.time)).toBe(true);
  });

  it('recalled out of a flyer (Lady Nocturne), the Fang drags her down and grounds her', () => {
    const w = arena();
    const q = place(w, 'tomoe', 'zenith', 0, 0), noc = place(w, 'nocturne', 'umbra', 0, 10);
    noc.pos.y += 4; noc.flying = true;
    q.sv.fang = 3; q.sv.fangTgt = noc.id; q.sv.fangAt = w.time;
    const events: string[] = [];
    q.input.alt = true; w.step(DT);
    for (const e of w.events) if (e.t === 'counter') events.push(e.text);
    q.input.alt = false;
    expect(noc.has('grounded', w.time)).toBe(true);
    expect(noc.flying).toBe(false);
    expect(events.some(t => t.includes('Nocturne'))).toBe(true);
  });

  it("COUNTER: her wounds bleed through Gantetsu's armor at full strength", () => {
    const w = arena();
    const q = place(w, 'tomoe', 'zenith', 0, 0), g = place(w, 'gantetsu', 'umbra', 0, 1.8);
    const texts: string[] = [];
    q.input.melee = true; w.step(DT); q.input.melee = false;
    for (const e of w.events) if (e.t === 'counter') texts.push(e.text);
    expect(texts.some(t => t.includes('Gantetsu'))).toBe(true);
    const h0 = g.health;
    run(w, 3.2);
    // 15 over 3s, no armor reduction (a normal hit into armor loses 30%)
    expect(h0 - g.health).toBeGreaterThan(14);
    expect(HERO.tomoe.rival).toBe('gantetsu');
  });

  it('wounds stack, and a death closes them', () => {
    const w = arena();
    const q = place(w, 'tomoe', 'zenith', 0, 0), foe = place(w, 'raijin', 'umbra', 0, 1.5);
    tap(w, q, 'melee'); run(w, 1); tap(w, q, 'melee');
    expect(foe.wounds.length).toBe(2);
    w.damage(q, foe, 9999, { kind: 'ability' });
    expect(foe.alive).toBe(false);
    expect(foe.wounds.length).toBe(0);
  });
});
