// The AI plays Gantetsu's Mauga kit (#15): it leaps out of the Tachiai Rush into a crowd, empties both chainguns into
// whoever the Shiko Stomp knocked flat, rings a crowd with the Grand Dohyo - and a bot bound by the ring's chains
// doesn't keep pressing the dash it isn't allowed.
import { World } from '../../src/game/World';
import { Bot } from '../../src/ai/Bot';
import { Nav } from '../../src/ai/Nav';
import { STOMP_CORE, STOMP_R, castAbility } from '../../src/game/abilities';
import type { Actor } from '../../src/game/Actor';

const DT = 1 / 60;
const arena = () => new World('training', 'training');
// a clear, flat lane of the training grounds (as tests/unit/kit.test.ts): x = -10, z from -12 to +14
const OX = -10, OZ = -12;
function place(w: World, id: string, team: 'zenith' | 'umbra', x: number, z: number, yaw = 0): Actor {
  const a = w.addHero(id, team);
  x += OX; z += OZ;
  a.pos = { x, y: Math.max(0, w.level.groundAt(x, z, 30)), z }; a.vel = { x: 0, y: 0, z: 0 };
  a.yaw = a.input.yaw = yaw; a.clear('spawnprot');
  return a;
}
function bot(w: World, a: Actor) { const b = new Bot(w, a, new Nav(w.level), 1); a.controller = b; return b; }
/** step the world (it has the bot think every tick); `before` runs ahead of each tick, `each` sees the inputs the bot chose */
function run(w: World, _b: Bot, secs: number, each?: () => void, before?: () => void) {
  for (let i = 0; i < Math.round(secs / DT); i++) { before?.(); w.step(DT); each?.(); w.events.length = 0; }
}
/** the rush, cast for him (the bot owns his inputs) */
const rush = (w: World, a: Actor) => castAbility(w, a, 'tachiai', 'a1');
const flat = (a: Actor, b: Actor) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);

describe('Gantetsu bot', () => {
  it('leaps out of the rush when it has carried him into a crowd, and the slam knocks them down', () => {
    const w = arena(), g = place(w, 'gantetsu', 'umbra', 0, 0, 0);
    const e1 = place(w, 'raijin', 'zenith', -2, 9, Math.PI), e2 = place(w, 'yuzu', 'zenith', 2.5, 10, Math.PI);
    const b = bot(w, g);
    expect(rush(w, g)).toBe(true);
    expect(g.has('tachiai', w.time)).toBe(true);
    let leaptAt = 0, d1 = 0, d2 = 0, cancelled = false, down = 0;
    run(w, b, 3.5, () => {
      if (g.has('tachiai', w.time) && g.input.a1) cancelled = true;          // SHIFT again would end the rush with no leap
      if (!leaptAt && g.has('stompair', w.time)) { leaptAt = w.time; d1 = flat(g, e1); d2 = flat(g, e2); }
      if (e1.has('knockdown', w.time) || e2.has('knockdown', w.time)) down += DT;
    });
    expect(cancelled).toBe(false);
    expect(leaptAt).toBeGreaterThan(0);
    expect(Math.min(d1, d2)).toBeLessThan(STOMP_R);                         // he waited until they were in reach
    expect(down).toBeGreaterThan(0.5);
  });

  it('does not leap with nobody in reach (the rush runs on)', () => {
    const w = arena(), g = place(w, 'gantetsu', 'umbra', 0, 0, 0);
    place(w, 'raijin', 'zenith', 0, 24, Math.PI);
    const b = bot(w, g);
    expect(rush(w, g)).toBe(true);
    let early = false;
    run(w, b, 0.6, () => { if (g.input.jump || g.has('stompair', w.time)) early = true; });
    expect(early).toBe(false);
    expect(g.has('tachiai', w.time)).toBe(true);
  });

  it('leaps on a single target once he is right on top of it', () => {
    const w = arena(), g = place(w, 'gantetsu', 'umbra', 0, 0, 0), e = place(w, 'raijin', 'zenith', 0, 8, Math.PI);
    const b = bot(w, g);
    expect(rush(w, g)).toBe(true);
    let at = -1;
    run(w, b, 2, () => { if (at < 0 && g.has('stompair', w.time)) at = flat(g, e); });
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(STOMP_CORE + e.radius + 0.5);                   // (a tick of the rush past the line)
  });

  it('turns both chainguns on a target the stomp has knocked flat', () => {
    const w = arena(), g = place(w, 'gantetsu', 'umbra', 0, 0, 0);
    const up = place(w, 'yuzu', 'zenith', -3, 6, Math.PI), downed = place(w, 'raijin', 'zenith', 3, 7, Math.PI);
    const b = bot(w, g);
    up.hp = up.def.hp * 0.6;                                                // the standing one would otherwise be the pick
    let both = 0, onDowned = 0, ticks = 0;
    const t0 = w.time;
    run(w, b, 1.2, () => {
      if (w.time - t0 > 0.5) { ticks++; if (b.target === downed) onDowned++; if (g.input.fire && g.input.alt) both++; }
    }, () => { downed.set('knockdown', w.time, 0.3, undefined, g); downed.set('stun', w.time, 0.3, undefined, g); });
    expect(onDowned / ticks).toBeGreaterThan(0.9);
    expect(both / ticks).toBeGreaterThan(0.6);
  });

  it('casts the Grand Dohyo on a crowd of two within 8 m, and not on one healthy target', () => {
    const w = arena(), g = place(w, 'gantetsu', 'umbra', 0, 0, 0);
    const e1 = place(w, 'raijin', 'zenith', -3, 5, Math.PI), e2 = place(w, 'yuzu', 'zenith', 3, 6, Math.PI);
    const b = bot(w, g);
    g.ult = g.def.ult.charge;
    let bound = false;
    run(w, b, 1.5, () => { e1.hp = e2.hp = 1e6; if (e1.has('chained', w.time) && e2.has('chained', w.time)) bound = true; });
    expect(g.has('dohyo', w.time)).toBe(true);
    expect(bound).toBe(true);                                               // both caught by the chains

    const w2 = arena(), g2 = place(w2, 'gantetsu', 'umbra', 0, 0, 0);
    const lone = place(w2, 'raijin', 'zenith', 0, 6, Math.PI);
    const b2 = bot(w2, g2);
    g2.ult = g2.def.ult.charge;
    // (kept healthy: once his guns have a lone target under half health the ring is the right call - a duel he's winning)
    run(w2, b2, 1.5, undefined, () => { lone.hp = lone.def.hp; lone.armor = lone.maxArmor; });
    expect(g2.has('dohyo', w2.time)).toBe(false);
  });
});

describe('bots bound by the Grand Dohyo', () => {
  it('a chained Raijin does not press Flash Step (unchained, he does)', () => {
    const presses = (chained: boolean) => {
      const w = arena(), g = place(w, 'gantetsu', 'umbra', 0, 9, Math.PI), r = place(w, 'raijin', 'zenith', 0, 0, 0);
      const b = bot(w, r);
      g.hp = 1e6;
      let n = 0;
      run(w, b, 4, () => { if (r.input.a1) n++; }, () => { if (chained) r.set('chained', w.time, 0.3, undefined, g); });
      return n;
    };
    expect(presses(true)).toBe(0);
    expect(presses(false)).toBeGreaterThan(0);
  });
});
