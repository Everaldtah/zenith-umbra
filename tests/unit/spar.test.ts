// Training Grounds - the Spar Arena: one-on-one with any hero at Easy / Medium / Hard; walking in seals a holographic
// box around the two of you until someone wins the spar; every round from full health at opposite ends.
import { createMatch } from '../../src/game/setup';
import { ARENA, COUNTDOWN, DONE_SECS, ROUND_END, SPAR_SKILL, SPAR_START, type Spar } from '../../src/game/spar';
import type { World } from '../../src/game/World';
import type { Actor } from '../../src/game/Actor';

const DT = 1 / 60;
function run(w: World, secs: number, each?: () => void) { for (let i = 0; i < Math.round(secs / DT); i++) { each?.(); w.step(DT); w.events.length = 0; } }
function training(hero = 'raijin') {
  const m = createMatch('training', 'training', hero);
  const me = m.player!;
  me.clear('spawnprot');
  return { m, w: m.world, me, s: m.spar! };
}
/** walk in: stand just inside the box's south wall */
const enter = (me: Actor) => { me.pos = { x: ARENA.x, y: 0, z: ARENA.z - ARENA.hz + 1.5 }; };
const kill = (w: World, by: Actor, a: Actor) => { w.damage(by, a, 5000, { kind: 'hitscan' }); };
function fight(w: World, s: Spar) { run(w, COUNTDOWN + 0.1); expect(s.phase).toBe('fight'); }

describe('Spar Arena', () => {
  it('the opponent waits in the arena; walking in seals the box and starts round 1 with a countdown', () => {
    const { w, me, s } = training();
    const f = s.arm({ hero: 'kagemaru', diff: 'hard', firstTo: 2 })!;
    expect(s.phase).toBe('waiting');
    expect(s.inside(f.pos)).toBe(true);
    expect(s.brain!.bot.skill).toBe(SPAR_SKILL.hard);
    run(w, 1);
    expect(s.phase).toBe('waiting');
    enter(me); run(w, DT);
    expect(s.phase).toBe('countdown');
    expect(s.sealed).toBe(true);
    // both pinned at their ends through the countdown, and nobody can hurt anyone yet
    me.input.mz = 1;
    run(w, COUNTDOWN - 0.3);
    expect(Math.hypot(me.pos.x - SPAR_START.you.x, me.pos.z - SPAR_START.you.z)).toBeLessThan(0.2);
    expect(Math.hypot(f.pos.x - SPAR_START.them.x, f.pos.z - SPAR_START.them.z)).toBeLessThan(0.2);
    expect(w.damage(me, f, 50, { kind: 'hitscan' })).toBe(0);
    run(w, 0.4);
    expect(s.phase).toBe('fight');
    expect(w.damage(me, f, 50, { kind: 'hitscan' })).toBe(50);
  });

  it('a kill wins the round; the next one starts from full health at the ends; first to N takes the spar and the box opens', () => {
    const { w, me, s } = training();
    const f = s.arm({ hero: 'gorgoth', diff: 'easy', firstTo: 2 })!;
    enter(me); run(w, DT); fight(w, s);
    kill(w, me, f); kill(w, me, f);           // (a mech: the frame, then the pilot)
    expect(s.phase).toBe('roundover');
    expect(s.wins).toEqual({ you: 1, them: 0 });
    me.hp = 10;
    run(w, ROUND_END + 0.1);
    expect(s.phase).toBe('countdown');
    expect(s.round).toBe(2);
    expect(f.alive).toBe(true); expect(f.def.id).toBe('gorgoth'); expect(f.health).toBe(f.maxHp);
    expect(me.health).toBe(me.maxHp);
    expect(Math.hypot(me.pos.x - SPAR_START.you.x, me.pos.z - SPAR_START.you.z)).toBeLessThan(0.2);
    run(w, COUNTDOWN + 0.1);
    kill(w, me, f); kill(w, me, f);
    run(w, ROUND_END + 0.1);
    expect(s.phase).toBe('done');
    expect(s.sealed).toBe(true);
    expect(s.history[0]).toMatchObject({ foe: 'Gorgoth', diff: 'easy', score: [2, 0], won: true });
    run(w, DONE_SECS + 0.1);
    expect(s.phase).toBe('waiting');
    expect(s.sealed).toBe(false);
    // still standing in the arena: no rematch until you step out and back in
    run(w, 0.5); expect(s.phase).toBe('waiting');
    me.pos = { x: ARENA.x, y: 0, z: ARENA.z - ARENA.hz - 3 }; run(w, DT);
    enter(me); run(w, DT);
    expect(s.phase).toBe('countdown');
  });

  it('losing a round: you get back up at your end for the next round (not at the team spawn)', () => {
    const { w, me, s } = training();
    const f = s.arm({ hero: 'kagemaru', diff: 'medium', firstTo: 3 })!;
    enter(me); run(w, DT); fight(w, s);
    kill(w, f, me);
    expect(s.wins).toEqual({ you: 0, them: 1 });
    expect(me.alive).toBe(false);
    run(w, ROUND_END + 0.1);
    expect(me.alive).toBe(true);
    expect(s.inside(me.pos)).toBe(true);
    run(w, 6);                                   // the world's own respawn never moves you out
    expect(s.inside(me.pos)).toBe(true);
  });

  it('the walls: neither of you can leave, nobody else gets in, no shot crosses them', () => {
    const { m, w, me, s } = training();
    const f = s.arm({ hero: 'kagemaru', diff: 'easy', firstTo: 3 })!;
    const r = m.range!, out = r.deploy({ hero: 'raijin', mode: 'defense' })!;
    out.clear('spawnprot');
    enter(me); run(w, DT); fight(w, s);
    // a dash / teleport out of the box ends at the wall
    me.pos = { x: ARENA.x + ARENA.hx + 5, y: 0, z: ARENA.z }; run(w, DT);
    expect(s.inside(me.pos)).toBe(true);
    me.pos = { x: ARENA.x, y: ARENA.h + 4, z: ARENA.z }; run(w, DT);
    expect(me.pos.y + me.height).toBeLessThanOrEqual(ARENA.h + 0.01);
    f.pos = { x: ARENA.x, y: 0, z: ARENA.z - ARENA.hz - 6 }; run(w, DT);
    expect(s.inside(f.pos)).toBe(true);
    // an outsider walking in is put back out
    out.pos = { x: ARENA.x + 2, y: 0, z: ARENA.z }; run(w, DT);
    expect(s.inside(out.pos)).toBe(false);
    // shots across the wall do nothing, either way
    expect(w.damage(me, out, 50, { kind: 'hitscan' })).toBe(0);
    expect(w.damage(out, me, 50, { kind: 'hitscan' })).toBe(0);
    // and the Hero Range's hero stands down while the box is up
    expect(r.suspended).toBe(true);
  });

  it('the opponent fights back at every difficulty (a real AI, not a dummy)', () => {
    for (const diff of ['easy', 'hard'] as const) {
      const { w, me, s } = training();
      s.arm({ hero: 'nocturne', diff, firstTo: 3 });
      enter(me); run(w, DT); fight(w, s);
      run(w, 8);
      // (each round starts you from full health: count every round's damage)
      expect(s.taken + s.rounds.reduce((n, r) => n + r.taken, 0), diff).toBeGreaterThan(20);
    }
  });

  it('ending the spar from the console while sealed is a forfeit and opens the box', () => {
    const { w, me, s } = training();
    s.arm({ hero: 'kagemaru', diff: 'easy', firstTo: 2 });
    enter(me); run(w, DT); fight(w, s);
    s.cancel();
    expect(s.sealed).toBe(false);
    expect(s.foe).toBeNull();
    expect(s.history[0].won).toBe(false);
    expect(w.actors.some(a => a.baseDef.id === 'kagemaru')).toBe(false);
  });
});
