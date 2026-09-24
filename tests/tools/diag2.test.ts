import { createMatch } from '../../src/game/setup';
import { writeFileSync } from 'node:fs';
it('trace', () => {
  const { world } = createMatch('rift', 'aitest', null, 0.8);
  const y = world.actors.find(a => a.def.id === 'yuzu')!;
  const out: string[] = [];
  for (let i = 0; i < 60 * 30; i++) {
    world.step(1 / 60); world.events.length = 0;
    if (i % 6 === 0) out.push(`${world.time.toFixed(1)} ${y.pos.x.toFixed(1)},${y.pos.y.toFixed(1)},${y.pos.z.toFixed(1)} v=${y.vel.x.toFixed(1)},${y.vel.y.toFixed(1)} g=${y.grounded} f=${y.forced?.kind ?? ''} pf=${y.has('padflight', world.time)} ${(y.controller as any).mode} alive=${y.alive}`);
    if (!y.alive) break;
  }
  writeFileSync('tests/diag.txt', out.slice(-40).join('\n'));
});
