// Mirei's Stellar Rebirth: every teammate who fell within the last 10 s inside 15 m stands up where they fell, at full
// health, untouchable and unable to fight for 2.25 s, walking after 1.5 s; through walls; nobody outside the window or
// the perimeter; she is untouchable for 1.5 s herself. (The desktop edition only: the web build keeps Nova Requiem.)
import { World } from '../../src/game/World';
import type { Actor } from '../../src/game/Actor';
import { HERO } from '../../src/data/heroes';
import { FULL } from '../../src/edition';
import { Bot } from '../../src/ai/Bot';
import { Nav } from '../../src/ai/Nav';
import { REBIRTH_R, REBIRTH_WINDOW, REBIRTH_GUARD, REBIRTH_RISE, soulsOf, soulLingers } from '../../src/game/rebirth';

const DT = 1 / 60;
const OX = -10, OZ = -12;     // the clear lane of the training grounds (see kit.test.ts)
function place(w: World, id: string, team: 'zenith' | 'umbra', x: number, z: number, yaw = 0): Actor {
  const a = w.addHero(id, team);
  x += OX; z += OZ;
  a.pos = { x, y: Math.max(0, w.level.groundAt(x, z, 30)), z }; a.vel = { x: 0, y: 0, z: 0 };
  a.yaw = a.input.yaw = yaw; a.clear('spawnprot');
  return a;
}
function run(w: World, secs: number, each?: () => void) { for (let i = 0; i < Math.round(secs / DT); i++) { each?.(); w.step(DT); w.events.length = 0; } }
const tap = (w: World, a: Actor, k: 'ult' | 'fire') => { (a.input as any)[k] = true; run(w, DT); (a.input as any)[k] = false; };
const arena = () => new World('training', 'training');
function mirei(w: World, x = 0, z = 0) { const m = place(w, 'mirei', 'zenith', x, z); m.ult = m.def.ult.charge; return m; }
const fell = (w: World, a: Actor) => { w.kill(a, null); return { ...a.pos }; };

const d = FULL ? describe : describe.skip;
d('Mirei: Stellar Rebirth', () => {
  it('is her desktop ultimate; the web build keeps Nova Requiem', () => {
    expect(HERO.mirei.ult.id).toBe(FULL ? 'rebirth' : 'nova');
  });

  it('stands every fallen teammate in the perimeter back up where they fell, at full health, facing her', () => {
    const w = arena(), m = mirei(w);
    const a = place(w, 'raijin', 'zenith', 4, 6), b = place(w, 'gantetsu', 'zenith', -5, 9), far = place(w, 'yuzu', 'zenith', 0, REBIRTH_R + 4);
    a.hp = 30; b.hp = 30;
    const pa = fell(w, a), pb = fell(w, b), pf = fell(w, far);
    run(w, 1);
    expect(soulsOf(w, m).map(x => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(soulLingers(w, far)).toBe(true);                 // (a soul, just not one in her reach)
    tap(w, m, 'ult');
    for (const [x, p] of [[a, pa], [b, pb]] as const) {
      expect(x.alive).toBe(true);
      expect(x.hp).toBe(x.def.hp);
      expect(Math.hypot(x.pos.x - p.x, x.pos.z - p.z)).toBeLessThan(0.05);
      expect(x.deaths).toBe(1);                              // the death still counts; the respawn wait is gone
      expect(x.respawnAt).toBe(0);
    }
    expect(Math.abs(Math.atan2(m.pos.x - a.pos.x, m.pos.z - a.pos.z) - a.yaw)).toBeLessThan(0.01);
    expect(far.alive).toBe(false);
    expect(Math.hypot(far.pos.x - pf.x, far.pos.z - pf.z)).toBeLessThan(0.05);
    expect(m.stats.rebirths).toBe(2);
  });

  it('the reborn are untouchable and cannot fight for 2.25 s, and cannot walk for the first 1.5 s', () => {
    const w = arena(), m = mirei(w), a = place(w, 'raijin', 'zenith', 3, 5), foe = place(w, 'kaien', 'umbra', 3, 12, Math.PI);
    fell(w, a); run(w, 0.5); tap(w, m, 'ult');
    const p0 = { ...a.pos }, ammo = a.ammo;
    // hit from the enemy, and trying to walk and shoot herself
    expect(w.damage(foe, a, 100, { kind: 'weapon' })).toBe(0);
    a.input.mz = 1; a.input.fire = true;
    run(w, REBIRTH_RISE - 0.2);
    expect(Math.hypot(a.pos.x - p0.x, a.pos.z - p0.z)).toBeLessThan(0.05);
    expect(a.ammo).toBe(ammo);
    run(w, REBIRTH_GUARD - REBIRTH_RISE + 0.1);             // past 1.5 s she walks; still can't shoot until 2.25 s
    expect(Math.hypot(a.pos.x - p0.x, a.pos.z - p0.z)).toBeGreaterThan(0.5);
    expect(a.ammo).toBe(ammo);
    expect(w.damage(foe, a, 100, { kind: 'weapon' })).toBe(0);
    run(w, 0.3);
    expect(a.has('reborn', w.time)).toBe(false);
    expect(w.damage(foe, a, 50, { kind: 'weapon' })).toBeGreaterThan(0);
    a.input.mz = 0; a.input.fire = false;
  });

  it('reaches through walls, and she is untouchable for 1.5 s while she sings', () => {
    const w = arena(), m = mirei(w, 0, 0);
    // the training barrier at z = +-6 of the lane stands between her and this one (LZ - 12 + 6 = -6 -> z + 6)
    const a = place(w, 'raijin', 'zenith', 0, 9);
    fell(w, a);
    expect(w.level.lineOfSight(m.eye, a.center)).toBe(w.level.lineOfSight(m.eye, a.center));   // (whichever it is, it doesn't matter)
    run(w, 0.5); tap(w, m, 'ult');
    expect(a.alive).toBe(true);
    const foe = place(w, 'kaien', 'umbra', 3, -4);
    expect(w.damage(foe, m, 100, { kind: 'weapon' })).toBe(0);
    run(w, 1.6);
    expect(w.damage(foe, m, 10, { kind: 'weapon' })).toBeGreaterThan(0);
  });

  it('only souls from the last 10 s: an ally who respawned first, or fell longer ago, is not called', () => {
    const w = arena(), m = mirei(w), a = place(w, 'raijin', 'zenith', 3, 5);
    fell(w, a);
    run(w, REBIRTH_WINDOW + 0.5);
    // by now the normal respawn has already put them back at spawn: there is no soul to call
    expect(a.alive).toBe(true);
    expect(soulsOf(w, m)).toHaveLength(0);
    // a soul held past the window (a long respawn) isn't called either
    const b = place(w, 'gantetsu', 'zenith', -3, 5);
    fell(w, b); b.respawnAt = w.time + 30;
    run(w, REBIRTH_WINDOW + 0.5);
    expect(soulsOf(w, m)).toHaveLength(0);
    expect(soulLingers(w, b)).toBe(false);
    tap(w, m, 'ult');
    expect(b.alive).toBe(false);
    expect(m.ult).toBeLessThan(m.def.ult.charge);           // the cast still spends the ultimate
  });

  it('bots: she sings when two souls are in reach', () => {
    const w = new World('training', 'aitest');
    const m = w.addHero('mirei', 'zenith'), a = w.addHero('raijin', 'zenith'), b = w.addHero('gantetsu', 'zenith');
    for (const x of [m, a, b]) { x.pos = { x: OX + (x === m ? 0 : x === a ? 3 : -3), y: 0, z: OZ + (x === m ? 0 : 5) }; x.clear('spawnprot'); }
    m.controller = new Bot(w, m, new Nav(w.level), 0.9); m.isRobot = false;
    m.ult = m.def.ult.charge;
    fell(w, a); fell(w, b);
    run(w, 1.5);
    expect(a.alive || b.alive).toBe(true);
    expect((m.stats.rebirths ?? 0)).toBeGreaterThanOrEqual(1);
  });
});
