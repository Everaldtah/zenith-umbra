// The Koryu brothers: Hayate's Dragon Gate Blade (15 s of Genji-style blade: melee primary, +30% speed, his own weapons
// back after) and the wall climb both brothers share (jump at a wall and hold or keep tapping SPACE; Seiran also just by
// moving into it airborne), which vaults onto the roof and stops short of the arena's boundary walls.
import { World, CLIMB_SECS } from '../../src/game/World';
import type { Actor } from '../../src/game/Actor';
import { HERO } from '../../src/data/heroes';
import { DRAGONBLADE, DRAGONBLADE_SECS } from '../../src/game/abilities';
import type { Box } from '../../src/data/maps';

const DT = 1 / 60;
function run(w: World, secs: number, each?: () => void) { for (let i = 0; i < Math.round(secs / DT); i++) { each?.(); w.step(DT); w.events.length = 0; } }

/** a tall free-standing wall (not the boundary) with open floor in front of it: the face, its normal, where to stand */
function findWall(w: World) {
  const [X, Z] = w.level.size;
  for (const b of w.level.boxes as Box[]) {
    const top = (b.y ?? 0) + b.h;
    if (b.ramp || top < 2.8 || top > 12 || Math.abs(b.x) + b.w / 2 > X - 4 || Math.abs(b.z) + b.d / 2 > Z - 4 || b.w < 1.5) continue;
    // face on -z: stand 1.5 m in front of the middle of that face, facing +z
    const fz = b.z - b.d / 2, sx = b.x, sz = fz - 1.2;
    if (w.level.groundAt(sx, sz, 1) < -1 || w.level.groundAt(sx, sz, 1) > 0.5) continue;
    const blocked = (w.level.boxes as Box[]).some(o => o !== b && Math.abs(o.x - sx) < o.w / 2 + 0.6 && Math.abs(o.z - sz) < o.d / 2 + 0.6 && (o.y ?? 0) < 2);
    if (blocked) continue;
    return { box: b, top, stand: { x: sx, z: sz }, yaw: 0 };
  }
  return null;
}

function hero(w: World, id: string, x: number, z: number, yaw: number): Actor {
  const a = w.addHero(id, 'zenith');
  a.pos = { x, y: Math.max(0, w.level.groundAt(x, z, 30)), z }; a.vel = { x: 0, y: 0, z: 0 };
  a.yaw = a.input.yaw = yaw; a.clear('spawnprot');
  return a;
}

describe('Hayate - Dragon Gate Blade', () => {
  it('draws the nodachi for 15 s: melee primary, faster, then his own weapons back', () => {
    const w = new World('training', 'training');
    const h = hero(w, 'hayate', -10, -12, 0);
    const baseSpeed = HERO.hayate.speed;
    h.ult = h.def.ult.charge;
    h.input.ult = true; run(w, DT); h.input.ult = false;
    expect(h.has('dragonblade', w.time)).toBe(true);
    expect(h.def.primary).toBe(DRAGONBLADE);
    expect(h.def.id).toBe('hayate');
    // +30% move speed while it lasts
    h.input.mz = 1; run(w, 1.2);
    expect(Math.hypot(h.vel.x, h.vel.z)).toBeGreaterThan(baseSpeed * 1.2);
    h.input.mz = 0;
    run(w, DRAGONBLADE_SECS);
    expect(h.has('dragonblade', w.time)).toBe(false);
    expect(h.def).toBe(h.baseDef);
    expect(h.ammo).toBe(h.maxAmmo);
  });

  it('slashes cut for 110 within 5 m', () => {
    const w = new World('training', 'training');
    const h = hero(w, 'hayate', -10, -12, 0);
    const foe = w.addHero('kagemaru', 'umbra');
    foe.pos = { x: -10, y: h.pos.y, z: -8.5 }; foe.clear('spawnprot');
    h.ult = h.def.ult.charge; h.input.ult = true; run(w, DT); h.input.ult = false;
    run(w, 0.5);
    const hp0 = foe.hp;
    h.input.fire = true; run(w, DT * 2); h.input.fire = false;
    expect(hp0 - foe.hp).toBeCloseTo(110, 0);
  });
});

describe('Koryu wall climb', () => {
  it('Hayate runs up a wall holding jump and vaults onto the roof', () => {
    const w = new World('training', 'training');
    const W = findWall(w)!;
    expect(W).not.toBeNull();
    const h = hero(w, 'hayate', W.stand.x, W.stand.z, W.yaw);
    h.input.mz = 1; h.input.jumpHeld = true;
    let maxY = 0, f = 0;
    // (once on the roof he stops, or he'd run straight off the far side)
    run(w, CLIMB_SECS + 0.8, () => { maxY = Math.max(maxY, h.pos.y); h.input.jump = f++ === 0; if (h.grounded && h.pos.y > W.top - 0.3) h.input.mz = 0; });
    expect(maxY).toBeGreaterThan(Math.min(W.top, 4) - 0.2);
    // over the top: standing on the roof (walls up to ~10 m fit in the climb budget)
    if (W.top < 10) expect(h.pos.y).toBeGreaterThan(W.top - 0.3);
  });

  it('without jump he just runs into the wall', () => {
    const w = new World('training', 'training');
    const W = findWall(w)!;
    const h = hero(w, 'hayate', W.stand.x, W.stand.z, W.yaw);
    h.input.mz = 1;
    run(w, 1.5);
    expect(h.pos.y).toBeLessThan(0.6);
  });

  it('Seiran climbs by moving into a wall while airborne (Heir of the Falls)', () => {
    const w = new World('training', 'training');
    const W = findWall(w)!;
    const s = hero(w, 'seiran', W.stand.x, W.stand.z, W.yaw);
    s.input.mz = 1;
    let maxY = 0, f = 0;
    run(w, 1.5, () => { maxY = Math.max(maxY, s.pos.y); s.input.jump = f++ === 0; });
    expect(maxY).toBeGreaterThan(Math.min(W.top, 4) - 0.6);
  });

  it('the arena boundary walls cannot be climbed out of', () => {
    const w = new World('training', 'training');
    const hit = w.level.ray({ x: -30, y: 2, z: 20 }, { x: 0, y: 0, z: 1 }, 20)!;
    const face = 20 + hit.t;
    const h = hero(w, 'hayate', -30, face - 1.2, 0);
    h.input.mz = 1; h.input.jumpHeld = true;
    let f = 0;
    run(w, 3, () => { h.input.jump = f++ % 6 === 0; });
    expect(h.pos.y).toBeLessThan(5);
    expect(h.pos.z).toBeLessThan(face);
  });
});
