import { createMatch } from '../../src/game/setup';
import { PLAY_MAPS } from '../../src/data/maps';
import { appendFileSync } from 'node:fs';

const DT = 1 / 60;

describe('AI vs AI simulation', () => {
  for (const m of PLAY_MAPS) {
    it(`${m.id}: 10 bots fight for 120s without breaking`, () => {
      const { world, bots } = createMatch(m.id, 'aitest', null, 0.8);
      for (let i = 0; i < 120 * 60 && !world.winner; i++) {
        world.step(DT);
        world.events.length = 0;
        for (const a of world.actors) {
          for (const k of ['x', 'y', 'z'] as const) if (!Number.isFinite(a.pos[k])) throw new Error(`${a.def.id} pos.${k} not finite`);
          if (!Number.isFinite(a.hp)) throw new Error(`${a.def.id} hp NaN`);
        }
      }
      const kills = world.actors.reduce((s, a) => s + a.kills, 0);
      const deaths = world.actors.reduce((s, a) => s + a.deaths, 0);
      const stuck = bots.reduce((s, b) => s + b.stuckCount, 0);
      const casts = Object.values(world.stats.casts).reduce((s, n) => s + n, 0);
      const row = {
        map: m.id, secs: Math.round(world.time), kills, envDeaths: deaths - kills, stuck, casts, counters: world.stats.counters,
        point: world.point.progress, winner: world.winner,
        byHero: world.actors.map(a => `${a.def.id}:${a.kills}/${a.deaths} d${Math.round(a.dmgDone)} h${Math.round(a.healDone)}`).join(' '),
      };
      appendFileSync('tests/sim-report.jsonl', JSON.stringify(row) + '\n');
      expect(kills).toBeGreaterThan(3);
      expect(casts).toBeGreaterThan(20);
    });
  }
});
