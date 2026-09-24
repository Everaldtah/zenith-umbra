import { createMatch } from '../../src/game/setup';
import { PLAY_MAPS } from '../../src/data/maps';
import { writeFileSync } from 'node:fs';
it('diag', () => {
  const out: string[] = [];
  for (const m of PLAY_MAPS) for (let rep = 0; rep < 3; rep++) {
    const { world } = createMatch(m.id, 'aitest', null, 0.8);
    const falls: string[] = [];
    for (let i = 0; i < 150 * 60 && !world.winner; i++) {
      const before = new Map(world.actors.map(a => [a.id, `${a.pos.x.toFixed(1)},${a.pos.z.toFixed(1)} f=${a.forced?.kind ?? ''}`]));
      const prevY = new Map(world.actors.map(a => [a.id, a.pos.y]));
      world.step(1 / 60);
      for (const a of world.actors) if (a.alive && prevY.get(a.id)! > -0.5 && a.pos.y < -0.5 && !(a as any)._fl) { (a as any)._fl = 1; falls.push(`${a.def.id}@${before.get(a.id)}`); }
      for (const a of world.actors) if (a.pos.y > -0.5) (a as any)._fl = 0;
      world.events.length = 0;
    }
    const k = { zenith: 0, umbra: 0 }; for (const a of world.actors) k[a.team] += a.kills;
    out.push(`${m.id} win=${world.winner} t=${world.time.toFixed(0)} kills z${k.zenith}/u${k.umbra} pt z${world.point.progress.zenith.toFixed(0)}/u${world.point.progress.umbra.toFixed(0)} falls=${falls.length} ${falls.slice(0, 6).join(' | ')}`);
  }
  writeFileSync('tests/diag.txt', out.join('\n'));
});
