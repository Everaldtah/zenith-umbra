import { createCampaign } from '../../src/game/setup';
import { LEVELS } from '../../src/campaign/data';
import { appendFileSync } from 'node:fs';

describe('campaign levels are beatable by an AI squad', () => {
  const only = process.env.LEVELS?.split(',');
  for (const L of LEVELS.filter(l => !only || only.includes(l.id))) {
    it(`${L.id}`, () => {
      const m = createCampaign(L.id, [], 0.85);
      const w = m.world, d = m.director;
      const log: string[] = [];
      let lastState = '';
      // 15 minutes of game time: the claim is "beatable", and the squad's wins run from 145 to 598 s (median 409 s) - a
      // 10-minute cap cut off the slow tail (18% of c4_helios runs were still fighting the Phoenix, never a loss)
      for (let i = 0; i < 60 * 900 && !w.winner; i++) {
        w.step(1 / 60); w.events.length = 0;
        if (i % 3600 === 0) appendFileSync('tests/campaign-progress.log', `${L.id} t=${w.time.toFixed(0)} state=${d.state}${d.enc ?? ''} boss=${d.boss ? Math.round(d.boss.health) : '-'} alive=${w.actors.filter(a => a.alive).length} wall=${(performance.now() / 1000).toFixed(0)}
`);
        if (d.state !== lastState) { log.push(`${w.time.toFixed(0)}s:${d.state}${d.state === 'fight' ? d.enc : ''}`); lastState = d.state; }
      }
      const heroes = w.actors.filter(a => a.team === 'zenith');
      appendFileSync('tests/sim-report.jsonl', JSON.stringify({ level: L.id, won: w.winner, secs: Math.round(w.time), log: log.join(' '), bossHp: d.boss ? Math.round(d.boss.health) : null,
        deaths: heroes.reduce((s, a) => s + a.deaths, 0), casts: Object.keys(w.stats.casts).length }) + '\n');
      expect(w.winner).toBe('zenith');
    });
  }
});
