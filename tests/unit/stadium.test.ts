// Stadium: a whole best-of-7 match played by bots - rounds end and pay out, the Armory freezes play, bots buy items and
// pick powers on rounds 1/3/5/7, the stats they buy really change the combat numbers, and the match ends at 4 wins.
import { createMatch } from '../../src/game/setup';
import { ITEM, ITEMS, powersFor, recalc, ROUNDS_TO_WIN, START_CASH, MAX_ITEMS } from '../../src/game/stadium';
import { HERO } from '../../src/data/heroes';
import { Actor } from '../../src/game/Actor';

const DT = 1 / 60;

describe('Stadium mode', () => {
  it('items and powers change the numbers the combat code reads', () => {
    const a = new Actor(HERO.raijin, 'zenith');
    recalc(a);
    expect(a.mods.weapon).toBe(0);
    a.items = ['sunforged_barrel', 'aegis_weave'];
    a.powers = ['raijin_a1'];
    recalc(a);
    expect(a.mods.weapon).toBeCloseTo(0.12);
    expect(a.maxArmor).toBe(HERO.raijin.armor + 75);
    expect(a.mods.cdrBy.flashstep).toBeCloseTo(0.35);
    expect(a.rate(2)).toBeCloseTo(2.1);
    // every hero gets six distinct powers named after its own kit
    for (const h of Object.values(HERO)) {
      const P = powersFor(h);
      expect(new Set(P.map(p => p.id)).size).toBe(6);
      expect(P.some(p => p.name.includes(h.ability1.name))).toBe(true);
    }
    expect(ITEMS.every(i => ITEM[i.id] === i && i.cost > 0)).toBe(true);
  });

  it('bots play a full match: rounds, Armory, purchases, powers, a winner at 4 round wins', () => {
    const { world } = createMatch('kurogane', 'stadium', null, 0.8);
    const S = world.stadium!;
    expect(S.phase).toBe('armory');
    expect(world.actors.every(a => a.cash === START_CASH)).toBe(true);
    // the Armory freezes play
    const p0 = world.actors.map(a => ({ ...a.pos }));
    for (let i = 0; i < 60 * 5; i++) world.step(DT);
    world.events.length = 0;
    expect(world.actors.every((a, i) => Math.hypot(a.pos.x - p0[i].x, a.pos.z - p0[i].z) < 0.5)).toBe(true);
    expect(world.actors.every(a => a.items.length > 0 && a.powers.length === 1)).toBe(true);
    const rounds: string[] = [];
    let last = 1;
    for (let i = 0; i < 60 * 60 * 25 && !world.winner; i++) {
      world.step(DT);
      world.events.length = 0;
      if (S.round !== last) { rounds.push(`${S.lastRound?.winner}:${S.lastRound?.reason}`); last = S.round; }
      for (const a of world.actors) if (!Number.isFinite(a.pos.x) || !Number.isFinite(a.hp)) throw new Error(`${a.def.id} broke`);
    }
    console.log('stadium rounds', rounds, S.wins, 'winner', world.winner, Math.round(world.time), 's',
      world.actors.map(a => `${a.baseDef.id}:${a.items.length}i/${a.powers.length}p $${a.cash}`).join(' '));
    expect(world.winner).toBeTruthy();
    expect(Math.max(S.wins.zenith, S.wins.umbra)).toBe(ROUNDS_TO_WIN);
    expect(S.phase).toBe('over');
    // powers on rounds 1, 3, 5, 7 (as many as the match lasted), items bought and never over the slot limit
    const played = S.wins.zenith + S.wins.umbra;
    const powerRounds = [1, 3, 5, 7].filter(r => r <= played).length;
    for (const a of world.actors) {
      expect(a.powers.length).toBe(powerRounds);
      expect(a.items.length).toBeGreaterThan(0);
      expect(a.items.length).toBeLessThanOrEqual(MAX_ITEMS);
    }
  }, 600_000);
});
