// Hero balance census: AI-vs-AI matches on every map, aggregated per hero and per role (the way Blizzard reads win rates
// and damage / healing per 10 minutes before a balance pass). Not part of `npm test`:
//   BAL_REPS=2 BAL_SECS=150 BAL_OUT=path.json npx vitest run -c tests/tools/vitest.config.ts tests/tools/balance.test.ts
// Bots are the measuring instrument here, so the numbers say where a kit is out of line (a cooldown that kills every
// time it is cast, a support out-damaging the damage role), not what humans would do with it.
import { createMatch } from '../../src/game/setup';
import { PLAY_MAPS } from '../../src/data/maps';
import { HERO } from '../../src/data/heroes';
import { writeFileSync } from 'node:fs';

const DT = 1 / 60;
const REPS = Number(process.env.BAL_REPS ?? 2), SECS = Number(process.env.BAL_SECS ?? 150);
const OUT = process.env.BAL_OUT ?? 'docs/balance-census.json';

interface Row { games: number; alive: number; kills: number; deaths: number; dmg: number; heal: number; mit: number; ults: number; wins: number; ultSecs: number[]; }
const row = (): Row => ({ games: 0, alive: 0, kills: 0, deaths: 0, dmg: 0, heal: 0, mit: 0, ults: 0, wins: 0, ultSecs: [] });

it('balance census', () => {
  const by: Record<string, Row> = {};
  const teamWins = { zenith: 0, umbra: 0 };
  let games = 0;
  for (const m of PLAY_MAPS) for (let rep = 0; rep < REPS; rep++) {
    const { world } = createMatch(m.id, 'aitest', null, 0.8);
    const heroes = world.actors.filter(a => !a.isSummon && !a.isRobot);
    const alive = new Map(heroes.map(a => [a.id, 0]));
    const ultAt = new Map(heroes.map(a => [a.id, 0]));
    const ultSecs = new Map(heroes.map(a => [a.id, [] as number[]]));
    for (let i = 0; i < SECS * 60 && !world.winner; i++) {
      world.step(DT);
      for (const e of world.events) if (e.t === 'cast' && (e as any).id === e.actor.baseDef.ult.id && ultAt.has(e.actor.id)) {
        ultSecs.get(e.actor.id)!.push(world.time - ultAt.get(e.actor.id)!); ultAt.set(e.actor.id, world.time);
      }
      world.events.length = 0;
      for (const a of heroes) if (a.alive) alive.set(a.id, alive.get(a.id)! + DT);
    }
    games++;
    if (world.winner) teamWins[world.winner]++;
    for (const a of heroes) {
      const id = a.baseDef.id, r = by[id] ??= row();
      r.games++; r.alive += alive.get(a.id)!; r.kills += a.kills; r.deaths += a.deaths; r.dmg += a.dmgDone; r.heal += a.healDone; r.mit += a.mitigated; r.ults += a.ults;
      if (world.winner === a.team) r.wins++;
      r.ultSecs.push(...ultSecs.get(a.id)!);
    }
  }
  const report = Object.entries(by).map(([id, r]) => {
    const min = r.alive / 60, med = r.ultSecs.length ? [...r.ultSecs].sort((p, q) => p - q)[Math.floor(r.ultSecs.length / 2)] : 0;
    return { id, role: HERO[id].role, games: r.games, winRate: +(r.wins / r.games).toFixed(2), kd: +(r.kills / Math.max(1, r.deaths)).toFixed(2),
      killsPer10: +(r.kills / min * 10).toFixed(1), deathsPer10: +(r.deaths / min * 10).toFixed(1), dmgPer10: Math.round(r.dmg / min * 10), healPer10: Math.round(r.heal / min * 10),
      mitPer10: Math.round(r.mit / min * 10), ultsPer10: +(r.ults / min * 10).toFixed(1), ultEvery: Math.round(med) };
  }).sort((p, q) => p.role.localeCompare(q.role) || q.dmgPer10 - p.dmgPer10);
  const roles: Record<string, { dmg: number; heal: number; kills: number; deaths: number; n: number }> = {};
  for (const h of report) { const x = roles[h.role] ??= { dmg: 0, heal: 0, kills: 0, deaths: 0, n: 0 }; x.dmg += h.dmgPer10; x.heal += h.healPer10; x.kills += h.killsPer10; x.deaths += h.deathsPer10; x.n++; }
  const roleAvg = Object.fromEntries(Object.entries(roles).map(([k, x]) => [k, { dmgPer10: Math.round(x.dmg / x.n), healPer10: Math.round(x.heal / x.n), killsPer10: +(x.kills / x.n).toFixed(1), deathsPer10: +(x.deaths / x.n).toFixed(1) }]));
  const out = { games, reps: REPS, secs: SECS, teamWins, roleAvg, heroes: report };
  writeFileSync(OUT, JSON.stringify(out, null, 1));
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  console.log(`\n${games} games (${REPS} per map, ${SECS}s)  team wins z${teamWins.zenith}/u${teamWins.umbra}`);
  console.log(`${'hero'.padEnd(10)}${pad('role', 8)}${pad('win', 6)}${pad('K/D', 6)}${pad('K/10', 6)}${pad('D/10', 6)}${pad('dmg/10', 8)}${pad('heal/10', 8)}${pad('mit/10', 8)}${pad('ult/10', 7)}${pad('ult s', 6)}`);
  for (const h of report) console.log(`${h.id.padEnd(10)}${pad(h.role, 8)}${pad(h.winRate, 6)}${pad(h.kd, 6)}${pad(h.killsPer10, 6)}${pad(h.deathsPer10, 6)}${pad(h.dmgPer10, 8)}${pad(h.healPer10, 8)}${pad(h.mitPer10, 8)}${pad(h.ultsPer10, 7)}${pad(h.ultEvery, 6)}`);
  console.log('role averages', JSON.stringify(roleAvg));
  expect(games).toBeGreaterThan(0);
});
