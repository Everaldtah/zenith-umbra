// The broadphase-gridded Level (src/engine/Physics.ts + Broadphase.ts) must answer every query exactly as the old
// test-every-box Level did (tests/unit/physicsRef.ts): thousands of random queries on every map, compared bit for bit.
import { Level } from '../../src/engine/Physics';
import { LevelRef } from './physicsRef';
import { MAPS } from '../../src/data/maps';

let seed = 12345;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const span = (lo: number, hi: number) => lo + (hi - lo) * rnd();

describe('level broadphase = brute force, on every map', () => {
  for (const map of MAPS) {
    it(map.id, () => {
      const L = new Level(map), R = new LevelRef(map);
      const [sx, sz] = map.size;
      const X = () => span(-sx * 0.6, sx * 0.6), Z = () => span(-sz * 0.6, sz * 0.6), Y = () => span(-2, 30);
      for (let i = 0; i < 1500; i++) {
        const x = X(), z = Z(), y = Y();
        expect(L.groundAt(x, z, y)).toBe(R.groundAt(x, z, y));
        expect(L.groundAt(x, z, y, 0.5)).toBe(R.groundAt(x, z, y, 0.5));
        expect(L.matAt(x, z, y)).toBe(R.matAt(x, z, y));
        expect(L.ceilingAt(x, z, y)).toBe(R.ceilingAt(x, z, y));
        // capsule push-out: same position, same contact flag
        const r = span(0.3, 1.6), h = span(1.4, 6);
        const p1 = { x, y, z }, p2 = { x, y, z };
        expect(L.collide(p1, r, h)).toBe(R.collide(p2, r, h));
        expect(p1).toEqual(p2);
      }
      for (let i = 0; i < 1500; i++) {
        // rays: short (projectile steps), mid (sight lines), long (camera / hitscan), some straight down or level
        const o = { x: X(), y: Y(), z: Z() };
        let d = { x: rnd() - 0.5, y: (rnd() - 0.5) * (i % 5 === 0 ? 0 : 1), z: rnd() - 0.5 };
        if (i % 17 === 0) d = { x: 0, y: -1, z: 0 };
        const l = Math.hypot(d.x, d.y, d.z); d = { x: d.x / l, y: d.y / l, z: d.z / l };
        const max = [0.6, 12, 60, 200][i % 4];
        expect(L.ray(o, d, max)).toEqual(R.ray(o, d, max));
        const b = { x: X(), y: Y(), z: Z() };
        expect(L.lineOfSight(o, b)).toBe(R.lineOfSight(o, b));
      }
    });
  }
});
