// Match construction shared by the game client, the AI test lab and headless tests.
import { HEROES } from '../data/heroes';
import { Nav } from '../ai/Nav';
import { Bot } from '../ai/Bot';
import { World, type Mode } from './World';
import type { Actor } from './Actor';

export interface Match { world: World; nav: Nav; player: Actor | null; bots: Bot[]; }

export function createMatch(mapId: string, mode: Mode, playerHero: string | null, skill = 0.7): Match {
  const world = new World(mapId, mode);
  const nav = new Nav(world.level);
  const bots: Bot[] = [];
  let player: Actor | null = null;
  if (mode === 'training') {
    player = world.addHero(playerHero ?? 'raijin', 'zenith');
    player.isPlayer = true;
    const robots: [string, number, number][] = [
      ['bot_dummy', 8, -4], ['bot_dummy', 8, 4], ['bot_dummy', 14, 0],
      ['bot_sentry', 30, -10], ['bot_sentry', 30, 10],
      ['bot_drone', 20, -16], ['bot_drone', 20, 16],
    ];
    for (const [id, x, z] of robots) {
      const r = world.addHero(id, 'umbra');
      r.spawn = [x, z]; world.respawn(r, true);
      const b = new Bot(world, r, nav, skill); r.controller = b; bots.push(b);
    }
    return { world, nav, player, bots };
  }
  for (const h of HEROES) {
    const a = world.addHero(h.id);
    if (h.id === playerHero && mode === 'skirmish') { a.isPlayer = true; player = a; continue; }
    const b = new Bot(world, a, nav, skill);
    a.controller = b; bots.push(b);
  }
  return { world, nav, player, bots };
}
