// Tomoe's Crescent Warpath: a 20 m dash along the ground (Junker Queen's Rampage), through every enemy in the way like a
// ghost; whoever she passes is cut, wounded and MARKED for 10 s (more damage from anyone's hits); a click ends the dash;
// it never carries her out of the arena.
import { World } from '../../src/game/World';
import type { Actor } from '../../src/game/Actor';
import { TIDE_LEN, TIDE_SPEED, TIDE_MARK, TIDE_MARK_AMP, tideReach } from '../../src/game/abilities';

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
const tap = (w: World, a: Actor, k: 'ult' | 'alt' | 'fire') => { (a.input as any)[k] = true; run(w, DT); (a.input as any)[k] = false; };
const arena = () => new World('training', 'training');
function tomoe(w: World, x = 0, z = 0, yaw = 0) { const q = place(w, 'tomoe', 'zenith', x, z, yaw); q.ult = q.def.ult.charge; return q; }

describe('Tomoe: Crescent Warpath', () => {
  it('dashes 20 m along the ground, on her feet the whole way, and stops on the far side', () => {
    const w = arena(), q = tomoe(w);
    const z0 = q.pos.z, y0 = q.pos.y;
    tap(w, q, 'ult');
    expect(q.forced?.kind).toBe('tide');
    expect(q.sv.tideT0).toBeGreaterThan(0);
    expect(q.sv.tideDur).toBeCloseTo(TIDE_LEN / TIDE_SPEED, 1);
    let top = 0, air = 0;
    run(w, TIDE_LEN / TIDE_SPEED - 0.1, () => { top = Math.max(top, q.pos.y - y0); if (!q.grounded) air++; });
    expect(top).toBeLessThan(0.3);                          // no jump: Rampage runs
    expect(air).toBe(0);
    run(w, 0.6);
    expect(q.forced).toBeNull();
    expect(q.grounded).toBe(true);
    expect(q.pos.z - z0).toBeGreaterThan(TIDE_LEN - 1.5);
    expect(q.pos.z - z0).toBeLessThan(TIDE_LEN + 1.5);
  });

  it('passes straight through an enemy standing in her way', () => {
    const w = arena(), q = tomoe(w), foe = place(w, 'gantetsu', 'umbra', 0, 9);
    const x0 = q.pos.x, z0 = q.pos.z, fx = foe.pos.x, fz = foe.pos.z;
    tap(w, q, 'ult'); run(w, 1.5);
    expect(q.pos.z - z0).toBeGreaterThan(TIDE_LEN - 1.5);   // she came out the other side
    expect(Math.abs(q.pos.x - x0)).toBeLessThan(0.3);       // and wasn't shouldered off her line
    expect(Math.hypot(foe.pos.x - fx, foe.pos.z - fz)).toBeLessThan(0.3);
    expect(foe.has('tidemark', w.time)).toBe(true);
    expect(foe.has('antiheal', w.time)).toBe(true);
    expect(foe.wounds.length).toBe(1);
  });

  it('is a ghost to bodies for the whole dash: nobody in the lane is shoved and neither is she', () => {
    const w = arena(), q = tomoe(w);
    const near = place(w, 'raijin', 'umbra', 0, 1.6), far = place(w, 'raijin', 'umbra', 0, 18.6);
    const x0 = q.pos.x, n = { ...near.pos }, f = { ...far.pos };
    tap(w, q, 'ult');
    let off = 0;
    run(w, 0.7, () => { off = Math.max(off, Math.abs(q.pos.x - x0)); });
    expect(off).toBeLessThan(0.05);
    expect(Math.hypot(near.pos.x - n.x, near.pos.z - n.z)).toBeLessThan(0.05);
    expect(Math.hypot(far.pos.x - f.x, far.pos.z - f.z)).toBeLessThan(0.05);
    expect(near.has('tidemark', w.time)).toBe(true);
    expect(far.has('tidemark', w.time)).toBe(true);
  });

  it('marks those she passed for 10 s: they take 25% more from anyone; the rest of the field is untouched', () => {
    const w = arena(), q = tomoe(w);
    const hit = place(w, 'raijin', 'umbra', 0.8, 8), off = place(w, 'raijin', 'umbra', 7, 8), friend = place(w, 'yuzu', 'zenith', -3, 0);
    tap(w, q, 'ult'); run(w, 1.5);
    expect(hit.has('tidemark', w.time)).toBe(true);
    expect(off.has('tidemark', w.time)).toBe(false);
    expect(off.hp).toBe(off.def.hp);
    hit.hp = off.hp = 400;
    const a = w.damage(friend, hit, 50, { kind: 'weapon' }), b = w.damage(friend, off, 50, { kind: 'weapon' });
    expect(a / b).toBeCloseTo(TIDE_MARK_AMP, 2);
    // it doesn't stack on Hex's Puppeteer mark
    hit.set('vuln', w.time, 2); off.set('vuln', w.time, 2);
    expect(w.damage(friend, hit, 50, { kind: 'weapon' })).toBeCloseTo(w.damage(friend, off, 50, { kind: 'weapon' }), 3);
    hit.clear('vuln'); hit.hp = 400;
    run(w, TIDE_MARK - 1.5 - 0.6);
    expect(hit.has('tidemark', w.time)).toBe(true);
    run(w, 1.2);
    expect(hit.has('tidemark', w.time)).toBe(false);
  });

  it('a click stops the dash where she is; holding fire from before the cast does not', () => {
    const w = arena(), q = tomoe(w);
    const z0 = q.pos.z, ammo = q.ammo;
    tap(w, q, 'ult'); run(w, 0.3);
    tap(w, q, 'fire'); run(w, 2 * DT);
    expect(q.forced).toBeNull();
    expect(q.has('tideult', w.time)).toBe(false);
    run(w, 1);
    expect(q.grounded).toBe(true);
    expect(q.pos.z - z0).toBeGreaterThan(7);
    expect(q.pos.z - z0).toBeLessThan(12);
    expect(q.ammo).toBe(ammo);                              // the click stopped her; it didn't fire the scattergun

    const w2 = arena(), h = tomoe(w2), s0 = h.pos.z;
    h.input.fire = true; run(w2, 0.1);
    h.ult = h.def.ult.charge; h.input.ult = true; run(w2, DT); h.input.ult = false;
    run(w2, 1.5);
    expect(h.pos.z - s0).toBeGreaterThan(TIDE_LEN - 1.5);
  });

  it('never carries her out of the arena', () => {
    const w = arena(), [X] = w.level.size;
    const q = tomoe(w); q.pos = { x: X - 6, y: Math.max(0, w.level.groundAt(X - 6, OZ, 30)), z: OZ }; q.yaw = q.input.yaw = Math.PI / 2;
    expect(tideReach(w, q, { x: 1, y: 0, z: 0 })).toBeLessThanOrEqual(6);
    tap(w, q, 'ult');
    let far = 0;
    run(w, 2, () => { far = Math.max(far, q.pos.x); });
    expect(far).toBeLessThanOrEqual(X);
    expect(q.forced).toBeNull();
    expect(q.grounded).toBe(true);
  });
});
