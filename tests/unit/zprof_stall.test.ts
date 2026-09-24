import { appendFileSync } from 'node:fs';
import { createCampaign } from '../../src/game/setup';
it.skipIf(!process.env.STALL)('which enemies stall an encounter', () => {
  const m = createCampaign(process.env.STALL!, [], 0.85), w = m.world, d = m.director;
  for (let i = 0; i < 60 * 150; i++) { w.step(1 / 60); w.events.length = 0; }
  const squad = w.actors.filter(a => a.team === 'zenith').map(a => `${a.def.id}@${a.pos.y.toFixed(1)}`);
  const alive = d.enemies.filter(e => e.alive).map(e => `${e.def.id} dy=${(e.pos.y - w.level.groundAt(e.pos.x, e.pos.z, e.pos.y + 1)).toFixed(1)} hp=${Math.round(e.health)}`);
  appendFileSync('tests/prof/stall.log', `${d.state}${d.enc} squad ${squad.join(' ')}\n alive ${alive.join(' | ')}\n`);
}, 600000);
