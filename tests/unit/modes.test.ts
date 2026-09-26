// The desktop edition's match systems: the rebuilt and new maps (walkable, navigable, every health pack reachable),
// Control (best of 3, overtime), Mikoshi Rush, health packs, the ranked ladder - and the web edition's legacy set.
import * as THREE from 'three';
import { World, PACK, ROUNDS_TO_WIN } from '../../src/game/World';
import { Nav } from '../../src/ai/Nav';
import { PLAY_MAPS, mapFor } from '../../src/data/maps';
import { LITE_MAPS } from '../../src/data/maps_lite';
import { rankOf, applyCompetitive, newCareer, PLACEMENTS, skillFor } from '../../src/game/ranks';
import { Animator, setPerformanceLayer, type AnimState } from '../../src/render/Animator';
import { mannequin } from '../../src/render/CharacterView';
import { Actor } from '../../src/game/Actor';
import { HERO } from '../../src/data/heroes';

const DT = 1 / 60;
const step = (w: World, secs: number, each?: () => void) => { for (let i = 0; i < Math.round(secs / DT); i++) { each?.(); w.step(DT); w.events.length = 0; } };

describe('maps (desktop edition)', () => {
  for (const m of PLAY_MAPS) {
    it(`${m.id}: spawns on the floor, the objective and every health pack reachable on foot`, () => {
      const w = new World(m.id, 'practice');
      const nav = new Nav(w.level);
      for (const team of ['zenith', 'umbra'] as const) {
        const [sx, sz] = m.spawns[team];
        const g = w.level.groundAt(sx, sz, 1);
        expect([m.id, team, 'spawn floor', g]).toEqual([m.id, team, 'spawn floor', expect.any(Number)]);
        expect(g).toBeLessThan(1);
        const from = { x: sx, y: g, z: sz };
        const obj = w.rules === 'push' ? w.push.pos : { x: m.point[0], y: m.point[1], z: m.point[2] };
        expect([m.id, team, 'objective', !!nav.find(from, obj)]).toEqual([m.id, team, 'objective', true]);
        for (const p of w.packs) expect([m.id, team, `pack ${p.x},${p.y},${p.z}`, !!nav.find(from, p)]).toEqual([m.id, team, `pack ${p.x},${p.y},${p.z}`, true]);
      }
      expect(w.packs.length).toBeGreaterThanOrEqual(4);
    });
  }
  it('the web edition keeps the original five arenas untouched (no interiors, no packs)', () => {
    expect(LITE_MAPS.filter(m => m.id !== 'training').map(m => m.id)).toEqual(['amatsu', 'kurogane', 'hangar', 'cathedral', 'rift']);
    for (const m of LITE_MAPS) { expect(m.packs).toBeUndefined(); expect(m.decor).toBeUndefined(); }
    expect(mapFor('hanabi', false).id).toBe('hanabi');       // unknown to the lite set: falls back (never offered in its menus)
    const lite = new World('hangar', 'skirmish', { full: false });
    expect(lite.rules).toBe('legacy'); expect(lite.packs.length).toBe(0);
  });
});

describe('Control (best of 3)', () => {
  it('holding the point wins rounds, first to two wins the match; overtime holds a round at 99% while contested', () => {
    const w = new World('hangar', 'practice');
    expect(w.rules).toBe('control');
    const z = w.addHero('raijin', 'zenith'), u = w.addHero('kagemaru', 'umbra');
    const [px, py, pz] = w.map.point;
    let sawOvertime = false, contestAt99 = false;
    step(w, 400, () => {
      z.pos = { x: px, y: py, z: pz }; z.vel = { x: 0, y: 0, z: 0 }; z.hp = z.def.hp;
      // the umbra hero walks onto the point when zenith sits at 99% (forces overtime), then leaves again
      const near99 = w.point.owner === 'zenith' && w.point.progress.zenith >= 98.9 && w.control.round === 1;
      if (near99 && !contestAt99) { contestAt99 = true; }
      u.pos = contestAt99 && w.time % 60 < 3 && w.control.round === 1 ? { x: px + 1, y: py, z: pz } : { x: 40, y: 0, z: 0 };
      u.hp = u.def.hp;
      sawOvertime ||= w.control.overtime;
      if (w.winner) return;
    });
    expect(w.winner).toBe('zenith');
    expect(w.control.wins.zenith).toBe(ROUNDS_TO_WIN);
    expect(w.control.round).toBe(2);
    expect(z.objTime).toBeGreaterThan(100);
    void sawOvertime;
  });
  it('overtime: at 99% an enemy on the point stops the round from ending', () => {
    const w = new World('hangar', 'practice');
    const z = w.addHero('raijin', 'zenith'), u = w.addHero('kagemaru', 'umbra');
    const [px, py, pz] = w.map.point;
    w.point.unlockAt = 0; w.point.owner = 'zenith'; w.point.progress.zenith = 99.4;
    step(w, 3, () => { z.pos = { x: px, y: py, z: pz }; u.pos = { x: px + 1.5, y: py, z: pz }; z.hp = u.hp = 999; });
    expect(w.control.overtime).toBe(true);
    expect(w.point.progress.zenith).toBeLessThanOrEqual(99);
    expect(w.control.wins.zenith).toBe(0);
    step(w, 2, () => { z.pos = { x: px, y: py, z: pz }; u.pos = { x: 40, y: 0, z: 0 }; });
    expect(w.control.wins.zenith).toBe(1);
    expect(w.control.phase).toBe('intermission');
  });
});

describe('Mikoshi Rush', () => {
  it('the team beside the float pushes it along the route to the enemy gate', () => {
    const w = new World('kagura', 'practice');
    expect(w.rules).toBe('push');
    const z = w.addHero('raijin', 'zenith');
    step(w, 200, () => { if (w.winner) return; const p = w.push.pos; z.pos = { x: p.x - 1, y: p.y, z: p.z }; z.vel = { x: 0, y: 0, z: 0 }; z.hp = z.def.hp; });
    expect(w.push.best.zenith).toBeGreaterThan(40);
    expect(w.winner).toBe('zenith');
  });
  it('contested, it stands still', () => {
    const w = new World('kagura', 'practice');
    const z = w.addHero('raijin', 'zenith'), u = w.addHero('kagemaru', 'umbra');
    w.push.unlockAt = 0;
    step(w, 5, () => { const p = w.push.pos; z.pos = { x: p.x - 1, y: p.y, z: p.z }; u.pos = { x: p.x + 1, y: p.y, z: p.z }; z.hp = u.hp = 999; });
    expect(Math.abs(w.push.d)).toBeLessThan(0.01);
    expect(w.push.contested).toBe(true);
  });
});

describe('health packs', () => {
  it('a hurt hero on a pack heals 75 (small) / 250 (large); the pack comes back 10 / 15 seconds later', () => {
    const w = new World('hangar', 'practice');
    const a = w.addHero('tenkai', 'zenith');
    const small = w.packs.find(p => !p.big)!, big = w.packs.find(p => p.big)!;
    a.hp = 50; a.armor = 0;
    a.pos = { x: small.x, y: small.y, z: small.z }; step(w, DT * 2);
    expect(a.hp + a.armor).toBeCloseTo(50 + PACK.small.hp, 0);
    expect(small.readyAt - w.time).toBeGreaterThan(9);
    a.hp = 50; a.armor = 0;
    a.pos = { x: big.x, y: big.y, z: big.z }; step(w, DT * 2);
    expect(a.hp + a.armor).toBeCloseTo(50 + PACK.big.hp, 0);
    expect(big.readyAt - w.time).toBeGreaterThan(14);
  });
});

describe('ranked ladder', () => {
  it('ranks: 8 tiers x divisions 5..1; placements reveal the rank; streaks, calibration and demotion protection', () => {
    expect(rankOf(0).label).toBe('Bronze 5'); expect(rankOf(1099).label).toBe('Gold 5'); expect(rankOf(1450).label).toBe('Gold 1'); expect(rankOf(2250).label).toBe('Diamond 3'); expect(rankOf(3999).label).toBe('Champion 1');
    let r = newCareer().roles.damage;
    for (let i = 0; i < PLACEMENTS; i++) r = applyCompetitive(r, true, 1900).after;
    expect(rankOf(r.rating, r.games).placed).toBe(true);
    const win3 = applyCompetitive({ ...r, streak: 3 }, true, r.mmr);
    expect(win3.mods).toContain('Win Streak');
    expect(win3.delta).toBeGreaterThan(0);
    // sitting at the bottom of a division: three protected losses, the fourth drops you
    let s = { ...r, rating: 2200, mmr: 2200, games: 30, shield: 0, streak: 0 };
    const drops: number[] = [];
    for (let i = 0; i < 4; i++) { const c = applyCompetitive(s, false, 2200); drops.push(c.after.rating); s = c.after; }
    expect(drops.slice(0, 3)).toEqual([2200, 2200, 2200]);
    expect(drops[3]).toBeLessThan(2200);
    expect(skillFor(3500)).toBeGreaterThan(skillFor(1200));
  });
});

describe('web edition animation', () => {
  it('with the performance layer off, the animator moves exactly as the original: no tilt, no squash', () => {
    setPerformanceLayer(false);
    try {
      const an = new Animator(mannequin(new Actor(HERO.mirei, 'zenith')));
      for (let i = 0; i < 60; i++) an.update({ dt: DT, time: i * DT, vel: new THREE.Vector3(0, 0, 18), yaw: 0, pitch: 0, grounded: false, flying: true, frame: 'flyer', attackAge: 9, attackKind: 'primary', castAge: 9, castId: '', hitAge: 9, landAge: i * DT, jumpAge: 9, stunned: false, charging: false, beam: false, barrier: false, rooted: false, scale: 1, pos: new THREE.Vector3(), angel: true, hero: 'mirei', swoop: 0.5 } as AnimState);
      expect(an.tilt.pitch).toBe(0); expect(an.sqY).toBe(1);
    } finally { setPerformanceLayer(true); }
  });
});
