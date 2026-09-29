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

  it('Mag-Grind climbs: looking up rides up the wall, and at a rooftop he mantles over the edge and stays on top', () => {
    // the 3m block on the training grounds (x 20..28, z -4..4): ride its west face looking up, pop onto its roof
    const w = arena();
    const h = w.addHero('hibiki', 'zenith'); h.clear('spawnprot');
    const hit = w.level.ray({ x: 14, y: 1.2, z: -3.2 }, { x: 1, y: 0, z: 0 }, 12)!;
    const face = 14 + hit.t;
    h.pos = { x: face - h.radius - 0.3, y: 0.9, z: -3.2 }; h.vel = { x: 0, y: 1, z: 6 }; h.grounded = false; h.lastGroundedAt = -9;
    h.yaw = h.input.yaw = 0; h.pitch = h.input.pitch = 0.6; h.input.grind = true; h.input.mz = 1;
    let maxY = 0, mantled = false;
    run(w, 2.5, () => { maxY = Math.max(maxY, h.pos.y); if ((h.stats.mantles ?? 0) > 0 && !mantled) { mantled = true; h.input.mz = 0; h.input.grind = false; } });
    expect(mantled).toBe(true);
    expect(h.pos.y).toBeGreaterThan(2.9);                      // standing on the roof
    expect(h.pos.x).toBeGreaterThan(face);                      // over the edge, not hanging off the wall
    h.input.grind = false; h.input.mz = 0; run(w, 1);
    expect(h.grounded).toBe(true); expect(h.pos.y).toBeGreaterThan(2.9);
  });

  it('Mag-Grind climbs a tall wall head-on while looking up, and a wall jump off it goes higher when looking up', () => {
    const w = arena();
    const h = w.addHero('hibiki', 'zenith'); h.clear('spawnprot');
    const hit = w.level.ray({ x: -30, y: 2, z: 20 }, { x: 0, y: 0, z: 1 }, 20)!;
    const face = 20 + hit.t;
    // standing at the 10m border wall, facing it, looking up: skates up the wall
    h.pos = { x: -30, y: 0, z: face - h.radius - 0.4 }; h.vel = { x: 0, y: 0, z: 3 };
    h.yaw = h.input.yaw = 0; h.pitch = h.input.pitch = 0.7; h.input.grind = true; h.input.mz = 1;
    let maxY = 0;
    run(w, 1.0, () => { maxY = Math.max(maxY, h.pos.y); });
    expect(h.has('grinding', w.time)).toBe(true);
    expect(maxY).toBeGreaterThan(3.5);
    // let go: kicked up and away
    h.input.grind = false; run(w, DT);
    expect(h.vel.y).toBeGreaterThan(8);
    expect(h.vel.z).toBeLessThan(-2);
    // however long he rides, the 10m arena wall can't be topped out of bounds
    const w2 = arena(); const h2 = w2.addHero('hibiki', 'zenith'); h2.clear('spawnprot');
    h2.pos = { x: -30, y: 0, z: face - h2.radius - 0.4 }; h2.vel = { x: 0, y: 0, z: 3 };
    h2.yaw = h2.input.yaw = 0; h2.pitch = h2.input.pitch = 0.7; h2.input.grind = true; h2.input.mz = 1;
    run(w2, 4);
    expect(h2.pos.z).toBeLessThan(face);
    expect(h2.pos.y).toBeLessThan(9);
  });

  it('skates like Lucio: glides when you let go instead of stopping dead', () => {
    const w = arena();
    const h = place(w, 'hibiki', 'zenith', 0, 0, 0), r = place(w, 'raijin', 'zenith', 4, 0, 0);
    for (const a of [h, r]) { a.input.mz = 1; }
    run(w, 1.5);
    for (const a of [h, r]) { a.input.mz = 0; }
    const z0h = h.pos.z, z0r = r.pos.z;
    run(w, 0.6);
    expect(h.pos.z - z0h).toBeGreaterThan(1.5);                  // still rolling
    expect(r.pos.z - z0r).toBeLessThan(0.8);                     // a runner stops
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

  describe('Groove (jump rhythm)', () => {
    /** tap jump `hz` times a second for `secs`, holding forward along the clear lane */
    const rhythm = (w: World, h: Actor, hz: number, secs: number) => {
      const every = Math.max(2, Math.round(1 / hz / DT)); let f = 0;
      // hopping on the spot: the rhythm builds from the taps alone (at 20x he'd leave the lane in a second)
      h.input.mz = 0;
      run(w, secs, () => { h.input.jump = f % every === 0; f++; });
      h.input.jump = false;
    };
    const flatSpeed = (h: Actor) => Math.hypot(h.vel.x, h.vel.z);

    it('tapping jump ~8x a second builds his speed toward 20x', () => {
      const w = arena();
      const h = place(w, 'hibiki', 'zenith', 0, 0, 0);
      rhythm(w, h, 8, 3);
      expect(h.sv.rhythm).toBeGreaterThan(15);
      expect(h.sv.rhythm).toBeLessThanOrEqual(20.001);
      expect(h.has('rhythm', w.time)).toBe(true);
      // and it's real speed: a short burst forward, still tapping, is many times his normal skate
      let f = 0; h.input.mz = 1; let top = 0;
      run(w, 0.4, () => { h.input.jump = f++ % 8 === 0; top = Math.max(top, flatSpeed(h)); });
      expect(top).toBeGreaterThan(HERO.hibiki.speed * 5);
    });

    it('a casual jump now and then leaves him at his normal speed', () => {
      const w = arena();
      const h = place(w, 'hibiki', 'zenith', 0, 0, 0);
      rhythm(w, h, 1, 3);
      expect(h.sv.rhythm ?? 1).toBeLessThan(1.3);
      expect(flatSpeed(h)).toBeLessThan(HERO.hibiki.speed * 1.4);
    });

    it('the groove bleeds off once the beat stops', () => {
      const w = arena();
      const h = place(w, 'hibiki', 'zenith', 0, 0, 0);
      rhythm(w, h, 8, 3);
      const peak = h.sv.rhythm;
      run(w, 4);
      expect(h.sv.rhythm).toBeLessThan(peak * 0.2);
    });

    it('at the top of the groove he still cannot skate through a wall', () => {
      const w = arena();
      const h = w.addHero('hibiki', 'zenith');
      const hit = w.level.ray({ x: -30, y: 2, z: 20 }, { x: 0, y: 0, z: 1 }, 20)!;
      const face = 20 + hit.t;
      h.pos = { x: -30, y: Math.max(0, w.level.groundAt(-30, face - 12, 30)), z: face - 12 }; h.vel = { x: 0, y: 0, z: 0 };
      h.yaw = h.input.yaw = 0; h.clear('spawnprot');
      h.sv.rhythm = 20; h.sv.tapRate = 12; h.sv.tapAt = w.time;
      h.vel = { x: 0, y: 0, z: HERO.hibiki.speed * 20 };
      h.input.mz = 1;
      run(w, 1);
      expect(h.pos.z).toBeLessThan(face);
    });
  });
});
