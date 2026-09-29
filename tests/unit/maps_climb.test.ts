// The climbers' desert maps (Sunset Mile, Iron Gulch): every climb route they're built around actually climbs - the
// Koryu wall run (hold jump, keep tapping on the tall ones) takes Hayate up each face and vaults him onto the top.
import { World, CLIMB_SECS } from '../../src/game/World';
import type { Actor } from '../../src/game/Actor';

const DT = 1 / 60;
function run(w: World, secs: number, each?: () => void) { for (let i = 0; i < Math.round(secs / DT); i++) { each?.(); w.step(DT); w.events.length = 0; } }

/** Hayate at (x, z) on the surface at or below y0 + 1, facing yaw (0 = +z), wall-running until he stands on the top */
function climb(map: string, x: number, z: number, yaw: number, y0: number, top: number): number {
  const w = new World(map, 'practice');
  const a: Actor = w.addHero('hayate', 'zenith');
  a.pos = { x, y: Math.max(0, w.level.groundAt(x, z, y0 + 1)), z }; a.vel = { x: 0, y: 0, z: 0 };
  a.yaw = a.input.yaw = yaw; a.clear('spawnprot');
  a.input.mz = 1; a.input.jumpHeld = true;
  let f = 0;
  // tap jump every 0.2 s (the rhythm that keeps a tall climb going); once he's up, let go (or he'd hop across the top)
  run(w, CLIMB_SECS * 2.5, () => { const up = a.pos.y > top - 0.3; a.input.jump = !up && f++ % 12 === 0; a.input.jumpHeld = !up; if (up) a.input.mz = 0; });
  return a.pos.y;
}

describe('climbers\' maps: the climb routes climb', () => {
  const routes: [string, string, number, number, number, number, number][] = [
    // map, route, x, z, yaw, standing height, top
    ['mile', 'butte ledge from the motel lot (5 m)', -28, 19.3, 0, 0, 5],
    ['mile', 'butte summit from the ledge (12 m)', -28, 23.3, 0, 5, 12],
    ['mile', 'south shelf from the road (8 m)', -18, -22.3, Math.PI, 0, 8],
    ['mile', 'the town-sign tower (6 m)', 0, 9.3, 0, 0, 6],
    ['gulch', 'a boxcar roof (4.2 m)', -40, 10.2, 0, 0, 4.2],
    ['gulch', 'the south ledge (6 m)', -14, -20.3, Math.PI, 0, 6],
    ['gulch', 'the crag from the ledge (12 m)', -11, -26.3, Math.PI, 6, 12],
    ['gulch', 'the west rock mass from its ledge (8 m)', -40, 21.8, 0, 5, 8],
  ];
  for (const [map, name, x, z, yaw, y0, top] of routes) {
    it(`${map}: ${name}`, () => {
      expect(climb(map, x, z, yaw, y0, top)).toBeGreaterThan(top - 0.3);
    });
  }
});
