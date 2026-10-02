// Career Profile: hero levels (150 XP/min, 20 rising levels then 10,000 XP each), Hero Skill Rating (5 qualifying
// placements, time share, 0-5000), the per-mode / per-hero totals, and the in-match tracker.
import * as C from '../../src/game/career';
import { createMatch } from '../../src/game/setup';

const slice = (hero: string, mins: number, o: Partial<C.HeroSlice> = {}): C.HeroSlice => ({
  hero, time: mins * 60, finalBlows: 10, assists: 5, deaths: 4, damage: 6000, healing: 0, mitigated: 0, shots: 300, hits: 120, crits: 20,
  objTime: 60, objKills: 3, ults: 2, streak: 4, multi: 2, stats: {}, ...o,
});
const match = (mode: C.CareerMode, result: C.Result, heroes: C.HeroSlice[], opp = 1800): C.MatchSummary => ({ mode, map: 'hanabi', at: Date.now(), secs: heroes.reduce((s, h) => s + h.time, 0), result, heroes, opp });

describe('hero levels', () => {
  it('levels 1-20 cost 500, 1000 ... 9500 XP, then 10,000 each', () => {
    expect(C.heroLevel(0).level).toBe(1);
    expect(C.heroLevel(499).level).toBe(1);
    expect(C.heroLevel(500).level).toBe(2);
    expect(C.heroLevel(95000).level).toBe(20);
    expect(C.heroLevel(95000 + 10000 * 5 + 1).level).toBe(25);
    expect(C.heroLevel(95000).ascended).toBe(1);
    expect(C.heroLevel(95000 + 10000 * 5).badge).toBe(1);
  });
  it('150 XP per minute in qualifying modes only', () => {
    const p = C.newProfile();
    C.recordMatch(p, match('quickplay', 'win', [slice('raijin', 10)]));
    expect(p.xp.raijin).toBe(1500);
    C.recordMatch(p, match('custom', 'win', [slice('raijin', 10)]));
    expect(p.xp.raijin).toBe(1500);
  });
});

describe('Hero Skill Rating', () => {
  it('places after 5 qualifying matches, moves with wins and losses, never above 5000', () => {
    const p = C.newProfile();
    for (let i = 0; i < 4; i++) C.recordMatch(p, match('online-comp', 'win', [slice('raijin', 8)]), () => 2000);
    expect(p.hsr['online-comp'].raijin.placed).toBe(4);
    expect(C.compareValue(p, 'online-comp', 'raijin', 'sr')).toBe(0);           // not placed: not shown
    const r = C.recordMatch(p, match('online-comp', 'win', [slice('raijin', 8)]), () => 2000);
    expect(r.hsr[0].placedNow).toBe(true);
    const sr = p.hsr['online-comp'].raijin.sr;
    expect(sr).toBeGreaterThan(C.toHsr(2000));
    C.recordMatch(p, match('online-comp', 'loss', [slice('raijin', 8)]), () => 2000);
    expect(p.hsr['online-comp'].raijin.sr).toBeLessThan(sr);
    expect(p.hsr.competitive.raijin).toBeUndefined();                           // the queues are separate
    expect(C.HSR_MAX).toBe(5000);
  });
  it('a hero needs 3 minutes and a top-3 spot to count a placement; time share sets the size of the move', () => {
    const p = C.newProfile();
    const r = C.recordMatch(p, match('competitive', 'win', [slice('raijin', 9), slice('yuzu', 2), slice('mirei', 5), slice('kaien', 4), slice('tenkai', 3.5)]));
    const by = Object.fromEntries(r.hsr.map(h => [h.hero, h]));
    expect(by.raijin.qualified).toBe(true);
    expect(by.yuzu.qualified).toBe(false);          // under 3 minutes
    expect(by.tenkai.qualified).toBe(false);        // 5th most played
    expect(Math.abs(by.raijin.delta)).toBeGreaterThan(Math.abs(by.yuzu.delta));
  });
});

describe('totals and comparisons', () => {
  it('adds up per mode and hero, keeps the best single game, and ranks Top Heroes', () => {
    const p = C.newProfile();
    C.recordMatch(p, match('online-qp', 'win', [slice('raijin', 10, { finalBlows: 20 })]));
    C.recordMatch(p, match('quickplay', 'loss', [slice('raijin', 5, { finalBlows: 8 }), slice('yuzu', 6)]));
    const all = C.line(p, 'all', 'raijin');
    expect(all.games).toBe(2); expect(all.wins).toBe(1); expect(all.finalBlows).toBe(28); expect(all.bFinal).toBe(20);
    expect(C.accuracy(all)).toBeCloseTo(40, 5);
    expect(C.per10(C.line(p, 'online-qp', 'raijin'), 20)).toBeCloseTo(20, 5);
    expect(C.topHeroes(p, 'all', 'time')[0].hero).toBe('raijin');
    expect(C.byRole(p, 'all').damage.time).toBe(21 * 60);
    expect(p.matches.length).toBe(2);
    expect(C.profileCard(p).top[0].hero).toBe('raijin');
  });
});

describe('CareerTracker', () => {
  it('follows the player through a match: time on the hero and the counters since it started', () => {
    const m = createMatch('hanabi', 'quickplay', 'raijin', 0.6);
    const w = m.world, me = m.player!;
    const t = new C.CareerTracker('quickplay', 'hanabi');
    me.kills = 3; me.shots = 50; me.hits = 20;             // before the tracker attached: not this match's
    const DT = 1 / 60;
    for (let i = 0; i < 300; i++) { w.step(DT); w.events.length = 0; t.frame(w, me, DT); if (i === 100) { me.kills += 2; } }
    me.shots += 30; me.hits += 15;
    const sum = t.finish(w, me, 'win');
    expect(sum.heroes.length).toBe(1);
    const s = sum.heroes[0];
    expect(s.hero).toBe('raijin');
    expect(s.time).toBeCloseTo(5, 1);
    expect(s.finalBlows).toBeGreaterThanOrEqual(2);
    expect(s.multi).toBeGreaterThanOrEqual(2);
    expect(s.shots - s.hits).toBeGreaterThanOrEqual(15);
  });
});
