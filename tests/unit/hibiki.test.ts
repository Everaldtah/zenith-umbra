// Hibiki, The Street Frequency: Crossmix (Healing Groove / Tempo Rush on SHIFT), Max Volume, the Subwoofer Blaster's
// four-round burst, Scratch Wave's knockback, Mag-Grind (wall riding) and the empowered wave it charges, Bass Drop's
// decaying overhealth, and his counter to Gantetsu's Grand Dohyo.
import { World } from '../../src/game/World';
import type { Actor } from '../../src/game/Actor';
import { HERO, rosterFor } from '../../src/data/heroes';
import { lineup } from '../../src/game/setup';

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
const tap = (w: World, a: Actor, k: 'a1' | 'a2' | 'ult' | 'alt' | 'fire') => { (a.input as any)[k] = true; run(w, DT); (a.input as any)[k] = false; };
const arena = () => new World('training', 'training');

describe('Hibiki', () => {
  it('is a desktop-edition Zenith support the role queue can field', () => {
    expect(HERO.hibiki.role).toBe('support'); expect(HERO.hibiki.team).toBe('zenith');
    expect(rosterFor(false).some(h => h.id === 'hibiki')).toBe(false);
    expect(lineup('hibiki').some(h => h.id === 'hibiki')).toBe(true);
  });

  it('Crossmix: Healing Groove heals allies in 12m (not beyond), SHIFT swaps to Tempo Rush (+25% speed), Max Volume cranks both', () => {
    const w = arena();
    const h = place(w, 'hibiki', 'zenith', 0, 0), near = place(w, 'raijin', 'zenith', 6, 0), far = place(w, 'yuzu', 'zenith', 0, 20);
    near.hp = 100; far.hp = 100;
    run(w, 2);
    expect(near.hp).toBeGreaterThan(100 + 16 * 2 * 0.8);
    expect(far.hp).toBe(100);
    // Max Volume on the heal track: ~52/s
    near.hp = 60; tap(w, h, 'a2'); run(w, 1);
    expect(near.hp - 60).toBeGreaterThan(40);
    // swap to Tempo Rush: allies in range speed up by 25% (60% amped)
    run(w, 3);
    tap(w, h, 'a1');
    expect(h.sv.track).toBe(1);
    run(w, 0.2);
    expect(near.has('speed', w.time)).toBe(true);
    expect(near.sv.speed).toBeCloseTo(1.25, 2);
    h.cd.maxvolume = 0; tap(w, h, 'a2'); run(w, 0.2);
    expect(near.sv.speed).toBeCloseTo(1.6, 2);
    // and the swap back to healing
    run(w, 1); tap(w, h, 'a1'); expect(h.sv.track).toBe(0);
  });

  it('Subwoofer Blaster fires four-round bursts', () => {
    const w = arena();
    const h = place(w, 'hibiki', 'zenith', 0, 0);
    const before = h.ammo;
    h.input.fire = true; run(w, DT); h.input.fire = false; run(w, 0.4);
    expect(before - h.ammo).toBe(4);
    expect(h.shots).toBe(4);
  });

  it('Scratch Wave knocks enemies in front of him back hard for 35 - and 5s of grinding empowers it', () => {
    const w = arena();
    const h = place(w, 'hibiki', 'zenith', 0, 0, 0), foe = place(w, 'kagemaru', 'umbra', 0, 4);
    const hp0 = foe.hp, z0 = foe.pos.z;
    tap(w, h, 'alt'); run(w, 0.5);
    expect(hp0 - foe.hp).toBeCloseTo(35, 0);
    expect(foe.pos.z - z0).toBeGreaterThan(3);
    // empowered
    const w2 = arena();
    const h2 = place(w2, 'hibiki', 'zenith', 0, 0, 0), foe2 = place(w2, 'kagemaru', 'umbra', 0, 4);
    h2.set('pumped', w2.time, 30);
    const hp2 = foe2.hp;
    tap(w2, h2, 'alt');
    expect(hp2 - foe2.hp).toBeCloseTo(52.5, 0);
    expect(h2.has('pumped', w2.time)).toBe(false);
  });

  it('Mag-Grind: airborne with SPACE held beside a wall he rides it without falling, then kicks off it', () => {
    const w = arena();
    const h = w.addHero('hibiki', 'zenith');
    // the training grounds' north border wall: find its face
    const hit = w.level.ray({ x: -30, y: 2, z: 20 }, { x: 0, y: 0, z: 1 }, 20)!;
    const face = 20 + hit.t;
    h.pos = { x: -30, y: 2.2, z: face - h.radius - 0.35 }; h.vel = { x: 6.5, y: 0, z: 0 }; h.grounded = false; h.lastGroundedAt = -9;
    h.yaw = h.input.yaw = Math.PI / 2; h.clear('spawnprot');
    h.input.mz = 1; h.input.jumpHeld = true;
    const x0 = h.pos.x;
    run(w, 1.5);
    expect(h.has('grinding', w.time)).toBe(true);
    expect(h.pos.y).toBeGreaterThan(1.6);
    expect(h.pos.x - x0).toBeGreaterThan(8);
    expect(Math.hypot(h.vel.x, h.vel.z)).toBeGreaterThan(HERO.hibiki.speed * 1.15);
    // let go of SPACE: up and away from the wall
    h.input.jumpHeld = false; run(w, DT);
    expect(h.has('grinding', w.time)).toBe(false);
    expect(h.vel.y).toBeGreaterThan(4);
    expect(h.vel.z).toBeLessThan(-3);
    // five seconds of grinding pumps the next Scratch Wave
    const w2 = arena(); const h2 = w2.addHero('hibiki', 'zenith');
    h2.pos = { x: -38 + 3, y: 2.2, z: face - h2.radius - 0.35 }; h2.vel = { x: 6.5, y: 0, z: 0 }; h2.grounded = false; h2.lastGroundedAt = -9;
    h2.yaw = h2.input.yaw = Math.PI / 2; h2.input.mz = 1; h2.input.jumpHeld = true; h2.clear('spawnprot');
    let flips = 0;
    run(w2, 5.3, () => { if (h2.pos.x > 30 && h2.sv.grindDir === 1) { h2.input.mz = -1; flips++; } if (h2.pos.x < -30 && h2.sv.grindDir === -1) { h2.input.mz = 1; flips++; } });
    expect(h2.has('pumped', w2.time)).toBe(true);
  });

  it('Bass Drop: leap, land, and every ally within 30m gets 750 temporary health that fades out', () => {
    const w = arena();
    const h = place(w, 'hibiki', 'zenith', 0, 0), ally = place(w, 'raijin', 'zenith', 5, 10), far = place(w, 'yuzu', 'zenith', 20, 22);
    h.ult = h.def.ult.charge;
    tap(w, h, 'ult');
    expect(h.vel.y).toBeGreaterThan(8);
    run(w, 1.2);
    const s = ally.shields.find(x => x.kind === 'bassdrop');
    expect(s?.amt).toBeGreaterThan(700);
    expect(h.shields.find(x => x.kind === 'bassdrop')).toBeTruthy();
    run(w, 3);
    expect(ally.shields.find(x => x.kind === 'bassdrop')!.amt).toBeLessThan(500);
    run(w, 4);
    expect(ally.shields.find(x => x.kind === 'bassdrop')).toBeFalsy();
    void far;
  });

  it('COUNTER: an amped Tempo Rush carries trapped allies out of the Grand Dohyo', () => {
    const w = arena();
    const g = place(w, 'gantetsu', 'umbra', 0, 0), h = place(w, 'hibiki', 'zenith', 3, 2), r = place(w, 'raijin', 'zenith', 2, -2);
    g.ult = g.def.ult.charge; tap(w, g, 'ult');
    const ring = w.zones.find(z => z.kind === 'dohyo')!;
    expect(ring.data.trapped).toContain(r.id);
    // without the amp he's held inside
    r.input.mz = 1; r.input.yaw = r.yaw = Math.PI;
    run(w, 1.5);
    expect(Math.hypot(r.pos.x - ring.x, r.pos.z - ring.z)).toBeLessThan(ring.r);
    tap(w, h, 'a1'); tap(w, h, 'a2');
    const events: string[] = [];
    for (let i = 0; i < 90; i++) { w.step(DT); for (const e of w.events) if (e.t === 'counter') events.push(e.text); w.events.length = 0; }
    expect(Math.hypot(r.pos.x - ring.x, r.pos.z - ring.z)).toBeGreaterThan(ring.r);
    expect(events).toContain('Tempo Rush breaks out of the Grand Dohyo');
  });
});
