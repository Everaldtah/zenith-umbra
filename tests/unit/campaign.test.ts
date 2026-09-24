import { createCampaign } from '../../src/game/setup';
import { LEVELS } from '../../src/campaign/data';
import { appendFileSync } from 'node:fs';

describe('campaign levels are beatable by an AI squad', () => {
  for (const L of LEVELS) {
    it(`${L.id}`, () => {
      const m = createCampaign(L.id, [], 0.85);
      const w = m.world, d = m.director;
      const log: string[] = [];
      let lastState = '';
      for (let i = 0; i < 60 * 600 && !w.winner; i++) {
        w.step(1 / 60); w.events.length = 0;
        if (d.state !== lastState) { log.push(`${w.time.toFixed(0)}s:${d.state}${d.state === 'fight' ? d.enc : ''}`); lastState = d.state; }
      }
      const heroes = w.actors.filter(a => a.team === 'zenith');
      appendFileSync('tests/sim-report.jsonl', JSON.stringify({ level: L.id, won: w.winner, secs: Math.round(w.time), log: log.join(' '), bossHp: d.boss ? Math.round(d.boss.health) : null,
        deaths: heroes.reduce((s, a) => s + a.deaths, 0), casts: Object.keys(w.stats.casts).length }) + '\n');
      expect(w.winner).toBe('zenith');
    });
  }
});
