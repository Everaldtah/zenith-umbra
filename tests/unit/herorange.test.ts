// Training Grounds - the Hero Range (any hero as a target, attack or defense mode, a damage meter) and the ultimate
// charge packs (touch one: your ultimate is ready).
import { createMatch } from '../../src/game/setup';
import { HERO, isAbility, rosterFor } from '../../src/data/heroes';
import { GUARD, LANE, LEASH, RESPAWN_SECS, RESET_SECS, Tally, type HeroRange } from '../../src/game/herorange';
import { ULT_PACK, type World } from '../../src/game/World';
import type { Actor } from '../../src/game/Actor';

const DT = 1 / 60;
function run(w: World, secs: number, each?: () => void) { for (let i = 0; i < Math.round(secs / DT); i++) { each?.(); w.step(DT); w.events.length = 0; } }
function training(hero = 'raijin') {
  const m = createMatch('training', 'training', hero);
  const me = m.player!, r = m.range!;
  // stand on the firing line, facing down the lane
  me.pos = { x: LANE.x0, y: 0, z: LANE.z }; me.yaw = me.input.yaw = Math.PI / 2; me.clear('spawnprot');
  return { m, w: m.world, me, r };
}
const deploy = (r: HeroRange, o: Parameters<HeroRange['deploy']>[0]) => { const a = r.deploy(o)!; a.clear('spawnprot'); return a; };
const off = (r: HeroRange, a: Actor) => Math.hypot(a.pos.x - r.post.x, a.pos.z - r.post.z);

describe('Hero Range', () => {
  it('every guard ability is the hero\'s own (slot and id match the kit)', () => {
    for (const h of rosterFor(true)) {
      expect(GUARD[h.id], h.id).toBeDefined();
      for (const g of GUARD[h.id]) {
        const def = g.slot === 'a1' ? h.ability1 : g.slot === 'a2' ? h.ability2 : h.secondary;
        expect(isAbility(def) ? def.id : '', `${h.id} ${g.slot}`).toBe(g.id);
      }
    }
  });

  it('deploys any hero, on the enemy side, at its post down the lane', () => {
    const { w, r } = training();
    for (const id of ['gorgoth', 'mirei', 'raijin', 'tenkai']) {
      const a = deploy(r, { hero: id, dist: 15 });
      expect(a.baseDef.id).toBe(id);
      expect(a.team).toBe('umbra');
      expect(off(r, a)).toBeLessThan(0.01);
      expect(r.post.x - LANE.x0).toBe(15);
      expect(w.actors.filter(x => x.sv && x === r.bot).length).toBe(1);
    }
    // only one range hero at a time
    expect(w.actors.filter(x => !x.isRobot && !x.isPlayer).length).toBe(1);
  });

  it('defense: holds its post facing you and never fires', () => {
    const { w, me, r } = training();
    const a = deploy(r, { hero: 'kagemaru', mode: 'defense', abilities: false, move: 'hold', dist: 10 });
    const hp = me.health;
    let fired = 0;
    run(w, 6, () => { if (a.input.fire || a.input.alt || a.input.a1 || a.input.a2 || a.input.ult) fired++; });
    expect(fired).toBe(0);
    expect(me.health).toBe(hp);
    expect(off(r, a)).toBeLessThan(0.8);
    // facing the firing line (you)
    expect(Math.abs(Math.atan2(Math.sin(a.yaw + Math.PI / 2), Math.cos(a.yaw + Math.PI / 2)))).toBeLessThan(0.2);
  });

  it('defense strafe: moves side to side but stays in its lane', () => {
    const { w, r } = training();
    const a = deploy(r, { hero: 'hayate', mode: 'defense', move: 'strafe', dist: 10 });
    let minZ = 99, maxZ = -99;
    run(w, 8, () => { minZ = Math.min(minZ, a.pos.z); maxZ = Math.max(maxZ, a.pos.z); });
    expect(maxZ - minZ).toBeGreaterThan(1.5);
    expect(Math.max(Math.abs(maxZ - LANE.z), Math.abs(minZ - LANE.z))).toBeLessThan(LANE.strafe + 1.2);
  });

  it('meters your damage: hits, crits, last hit, DPS; a kill logs the time-to-kill and it is back at its post', () => {
    const { w, me, r } = training();
    const a = deploy(r, { hero: 'kagemaru', mode: 'defense' });
    // a hit every 0.25 s: 50 + a 100 crit, then 50s until it drops (225 hp)
    let n = 0;
    run(w, 1.2, () => { if (a.alive && w.time % 0.25 < DT) { n++; w.damage(me, a, n === 2 ? 100 : 50, { kind: 'hitscan', crit: n === 2 }); } });
    const s = r.stats;
    expect(a.alive).toBe(false);
    expect(s.kills).toBe(1);
    expect(s.dealt.hits).toBe(4);                    // 50 + 100 + 50 + 25 (the last only what it had left)
    expect(s.dealt.crits).toBe(1);
    expect(s.dealt.total).toBeCloseTo(225, 3);
    expect(s.dealt.max).toBeCloseTo(100, 3);
    expect(s.lastTtk!).toBeCloseTo(0.75, 1);         // first hit to the kill
    expect(s.log[0]).toMatchObject({ target: 'Kagemaru', mode: 'defense', hits: 4, crits: 1 });
    expect(s.dealt.dps()!).toBeGreaterThan(200);     // ~225 over 4 ticks spaced 0.25 s = 225 / 1.0 s
    expect(s.dealt.dps()!).toBeLessThan(260);
    run(w, RESPAWN_SECS + 0.2);
    expect(a.alive).toBe(true);
    expect(off(r, a)).toBeLessThan(0.5);
    expect(a.health).toBe(a.maxHp);
  });

  it('a shotgun blast counts as one hit; a beam or a bleed adds damage but no hits', () => {
    const t = new Tally();
    for (let i = 0; i < 8; i++) t.add(1, 6, i === 0, 'hitscan');
    expect(t.hits).toBe(1); expect(t.last).toBe(48); expect(t.crits).toBe(1);
    t.add(1.5, 3, false, 'beam'); t.add(1.5 + DT, 3, false, 'dot');
    expect(t.hits).toBe(1); expect(t.total).toBe(54); expect(t.by.dot).toBe(3); expect(t.by.weapon).toBe(51);
  });

  it('defense: back to full health a few seconds after the last hit (a clean burst every time)', () => {
    const { w, me, r } = training();
    const a = deploy(r, { hero: 'gorgoth', mode: 'defense' });
    w.damage(me, a, 300, { kind: 'hitscan' });
    expect(a.health).toBeLessThan(a.maxHp);
    run(w, RESET_SECS + 0.3);
    expect(a.health).toBe(a.maxHp);
  });

  it('defense with abilities: guards itself under fire (Tenkai-Oh\'s sun-shield, Gorgoth\'s plating)', () => {
    {
      const { w, me, r } = training();
      const a = deploy(r, { hero: 'tenkai', mode: 'defense', abilities: true });
      let up = 0;
      run(w, 1.5, () => { if (w.time % 0.3 < DT) w.damage(me, a, 20, { kind: 'hitscan' }); if (a.barrier.up) up++; });
      expect(up).toBeGreaterThan(30);
    }
    {
      const { w, me, r } = training();
      const a = deploy(r, { hero: 'gorgoth', mode: 'defense', abilities: true });
      run(w, 0.2, () => w.damage(me, a, 5, { kind: 'hitscan' }));
      expect(a.shieldAmt).toBeGreaterThan(0);
    }
    {   // off: nothing
      const { w, me, r } = training();
      const a = deploy(r, { hero: 'gorgoth', mode: 'defense', abilities: false });
      run(w, 0.5, () => w.damage(me, a, 5, { kind: 'hitscan' }));
      expect(a.shieldAmt).toBe(0);
    }
  });

  it('attack: the hero fights back (and stays leashed to its lane); the meter counts what it deals you', () => {
    for (const id of ['kagemaru', 'gantetsu', 'nocturne']) {
      const { w, me, r } = training();
      me.hp = me.def.hp * 50;            // (so the player outlives the test)
      const a = deploy(r, { hero: id, mode: 'attack', abilities: true, dist: 15, skill: 0.95 });
      let far = 0;
      run(w, 10, () => { far = Math.max(far, off(r, a)); });
      expect(r.stats.taken.total, id).toBeGreaterThan(20);
      expect(far, id).toBeLessThan(LEASH + 3);
    }
  });

  it('attack without abilities: weapon only', () => {
    const { w, me, r } = training();
    me.hp = me.def.hp * 50;
    const a = deploy(r, { hero: 'gorgoth', mode: 'attack', abilities: false, dist: 10, skill: 0.95 });
    const casts = new Set<string>();
    w.taps.push(e => { if (e.t === 'cast' && e.actor === a) casts.add(e.id); });
    a.ult = a.def.ult.charge;
    run(w, 10);
    expect([...casts]).toEqual([]);
    expect(r.stats.taken.total).toBeGreaterThan(20);
  });

  it('clear removes the hero and everything it summoned', () => {
    const { w, me, r } = training();
    me.hp = me.def.hp * 50;
    const a = deploy(r, { hero: 'hex', mode: 'attack', abilities: true, dist: 10 });
    a.ult = a.def.ult.charge; a.input.ult = true;
    w.step(DT); a.input.ult = false;
    run(w, 0.5);
    r.clear();
    expect(w.actors.includes(a)).toBe(false);
    expect(w.actors.some(x => x.owner === a)).toBe(false);
    expect(r.bot).toBeNull();
  });
});

describe('Ultimate charge packs', () => {
  it('the Training Grounds has them; touching one makes your ultimate ready, then it is gone for a while', () => {
    const { w, me } = training();
    expect(w.ultPacks.length).toBeGreaterThanOrEqual(2);
    const p = w.ultPacks[0];
    me.ult = 0;
    me.pos = { x: p.x, y: p.y, z: p.z };
    run(w, 0.1);
    expect(me.ult).toBe(me.def.ult.charge);
    expect(p.readyAt).toBeGreaterThan(w.time);
    // gone: spend the ult charge and stand on it again - nothing until it is back
    me.ult = 0; run(w, 1);
    expect(me.ult).toBeLessThan(me.def.ult.charge);
    run(w, ULT_PACK.respawn);
    expect(me.ult).toBe(me.def.ult.charge);
  });

  it('a bot never takes one, and a ready ultimate leaves it there', () => {
    const { w, me, r } = training();
    const p = w.ultPacks[0];
    const a = deploy(r, { hero: 'kagemaru', mode: 'defense' });
    a.ult = 0; a.pos = { x: p.x, y: p.y, z: p.z }; r.opts.move = 'hold';
    w.step(DT);
    expect(a.ult).toBeLessThan(a.def.ult.charge);
    me.ult = me.def.ult.charge; me.pos = { x: p.x, y: p.y, z: p.z };
    run(w, 0.1);
    expect(p.readyAt).toBe(0);
  });

  it('only the desktop edition has them (the web demo stays as it was)', async () => {
    const { World } = await import('../../src/game/World');
    expect(new World('training', 'training', { full: false }).ultPacks.length).toBe(0);
    expect(HERO.raijin).toBeDefined();
  });
});
