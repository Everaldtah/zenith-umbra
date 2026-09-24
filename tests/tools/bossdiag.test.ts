import { createCampaign } from '../../src/game/setup';
import { writeFileSync } from 'node:fs';
it('boss death cause', () => {
  const m = createCampaign('c1_shipyard', [], 0.85);
  const w = m.world, d = m.director;
  d.cleared = new Set([0, 1]);
  for (const a of w.actors) if (a.team === 'zenith') a.pos = { x: 20, y: 0.01, z: (a.id % 3) * 2 };
  const out: string[] = [];
  const origKill = w.kill.bind(w);
  (w as any).kill = (tgt: any, src: any) => { if (tgt.isBoss) out.push(`KILL t=${w.time.toFixed(1)} hp=${tgt.hp.toFixed(0)} armor=${tgt.armor.toFixed(0)} pos=${tgt.pos.x.toFixed(1)},${tgt.pos.y.toFixed(1)},${tgt.pos.z.toFixed(1)} src=${src?.def.id} stack=${new Error().stack!.split('\n').slice(2, 5).join(' <- ')}`); origKill(tgt, src); };
  for (let i = 0; i < 60 * 240 && !w.winner; i++) { w.step(1 / 60); w.events.length = 0; }
  writeFileSync('tests/diag.txt', out.join('\n') + `\nwinner=${w.winner} t=${w.time.toFixed(0)}`);
});
