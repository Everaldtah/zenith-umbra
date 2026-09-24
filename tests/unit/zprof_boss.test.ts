// Profiling harness for a campaign level's boss fight (run: LVL=c4_helios npx vitest run tests/unit/zprof_boss.test.ts)
import { appendFileSync } from 'node:fs';
import { createCampaign } from '../../src/game/setup';

const log = (s: string) => appendFileSync('tests/prof/steps.log', s + '\n');

it.skipIf(!process.env.LVL)('profile boss phase', () => {
  const m = createCampaign(process.env.LVL!, [], 0.85);
  const w = m.world, d = m.director;
  for (let i = 0; i < 60 * 900 && !w.winner; i++) {
    const s = performance.now();
    
    if (false) log(`pre ${w.time.toFixed(2)} state=${d.state}`);
    w.step(1 / 60); w.events.length = 0;
    const e = performance.now() - s;
    if (e > 100 || i % 1200 === 0) log(`i=${i} t=${w.time.toFixed(0)} ${e.toFixed(0)}ms state=${d.state} boss=${d.boss ? Math.round(d.boss.health) : '-'} projs=${w.projs.length} actors=${w.actors.length}`);
  }
  log(`bad angle: ${(globalThis as any).__badAngle}`);
  log(`winner ${w.winner} t=${w.time.toFixed(0)} boss=${d.boss ? Math.round(d.boss.health) : '-'}`);
}, 600000);
