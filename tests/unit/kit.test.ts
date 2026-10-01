// The Overwatch-style movement and kit work: Mirei's Starwing Swoop (guardian-angel flight with slingshot / superjump),
// Gantetsu's twin chainguns (spin-up, ignite, volatile crits, crowd-roar overhealth), Tachiai Rush + Shiko Stomp and the
// Grand Dohyo ring, the 5v5 role-queue lineup - and the animator's performance layer (flight tilt, squash, gun carry).
import * as THREE from 'three';
import { World, RING_H } from '../../src/game/World';
import { lineup } from '../../src/game/setup';
import { DOHYO_T, stompLeap } from '../../src/game/abilities';
import { HERO } from '../../src/data/heroes';
import type { Actor } from '../../src/game/Actor';
import { Animator, type AnimState } from '../../src/render/Animator';
import { mannequin } from '../../src/render/CharacterView';
import { Actor as ActorClass } from '../../src/game/Actor';

const DT = 1 / 60;
const arena = () => new World('training', 'training');
// a clear, flat lane of the training grounds: x = -10, z from -12 to +14 (positions below are relative to its start)
const OX = -10, OZ = -12;
function place(w: World, id: string, team: 'zenith' | 'umbra', x: number, z: number, yaw = 0): Actor {
  const a = w.addHero(id, team);
  x += OX; z += OZ;
  a.pos = { x, y: Math.max(0, w.level.groundAt(x, z, 30)), z }; a.vel = { x: 0, y: 0, z: 0 };
  a.yaw = a.input.yaw = yaw; a.clear('spawnprot');
  return a;
}
function run(w: World, secs: number, each?: () => void) { for (let i = 0; i < Math.round(secs / DT); i++) { each?.(); w.step(DT); w.events.length = 0; } }
function aimAt(a: Actor, p: { x: number; y: number; z: number }) {
  const e = a.eye;
  a.input.yaw = Math.atan2(p.x - e.x, p.z - e.z); a.input.pitch = Math.atan2(p.y - e.y, Math.hypot(p.x - e.x, p.z - e.z));
}
const tap = (w: World, a: Actor, k: 'swoop' | 'jump' | 'descend' | 'a1' | 'a2' | 'ult') => { (a.input as any)[k] = true; run(w, DT); (a.input as any)[k] = false; };
const flat = (a: Actor, b: Actor) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);

describe('role queue', () => {
  it('fields 5v5 with one tank, two supports and two damage heroes per team - the player\'s pick always plays', () => {
    for (const pick of [null, 'gantetsu', 'gorgoth', 'mirei']) {
      const L = lineup(pick);
      expect(L.length).toBe(10);
      for (const team of ['zenith', 'umbra']) for (const [role, n] of [['tank', 1], ['support', 2], ['dps', 2]] as const)
        expect([pick, team, role, L.filter(h => h.team === team && h.role === role).length]).toEqual([pick, team, role, n]);
      if (pick) expect(L.some(h => h.id === pick)).toBe(true);
    }
    expect(lineup('gantetsu').some(h => h.id === 'gorgoth')).toBe(false);
  });
});

describe('Mirei: Starwing Swoop', () => {
  it('streaks to the ally under the crosshair and flares to a stop beside them', () => {
    const w = arena(), m = place(w, 'mirei', 'zenith', 0, 0), al = place(w, 'kaien', 'zenith', 0, 20);
    expect(w.level.lineOfSight(m.eye, al.center)).toBe(true);
    aimAt(m, al.center); tap(w, m, 'swoop');
    expect(m.has('swoop', w.time)).toBe(true);
    let arrived = -1, top = 0;
    run(w, 2, () => { top = Math.max(top, Math.hypot(m.vel.x, m.vel.z)); if (arrived < 0 && flat(m, al) < 3) arrived = w.time; });
    expect(arrived).toBeGreaterThan(0);
    expect(arrived).toBeLessThan(1.8);          // ~20m at 13 -> 21 m/s
    expect(top).toBeGreaterThan(14);
    expect(m.has('swoop', w.time)).toBe(false);
    expect(m.ready('swoop', w.time)).toBe(false);   // then the cooldown
  });
  it('SPACE mid-swoop slingshots on with the momentum, CTRL superjumps straight up', () => {
    let w = arena(), m = place(w, 'mirei', 'zenith', 0, 0), al = place(w, 'kaien', 'zenith', 0, 25);
    aimAt(m, al.center); tap(w, m, 'swoop'); run(w, 0.5);
    tap(w, m, 'jump');
    expect(m.has('slingshot', w.time)).toBe(true);
    const sp0 = Math.hypot(m.vel.x, m.vel.z);
    run(w, 0.3);
    expect(sp0).toBeGreaterThan(10);
    expect(m.grounded).toBe(false);                                   // lofted, not skimming the floor
    expect(Math.hypot(m.vel.x, m.vel.z)).toBeGreaterThan(sp0 * 0.75);  // momentum carries (air control only nudges it)
    w = arena(); m = place(w, 'mirei', 'zenith', 0, 0); al = place(w, 'kaien', 'zenith', 0, 25);
    aimAt(m, al.center); tap(w, m, 'swoop'); run(w, 0.5);
    tap(w, m, 'descend');
    expect(m.vel.y).toBeGreaterThan(12);
    const y0 = m.pos.y; run(w, 0.5);
    expect(m.pos.y - y0).toBeGreaterThan(3);
  });
  it('needs an ally under the crosshair (no free swoops), and a grounding stops it', () => {
    const w = arena(), m = place(w, 'mirei', 'zenith', 0, 0);
    place(w, 'kaien', 'zenith', 0, 20);
    m.input.yaw = Math.PI; tap(w, m, 'swoop');
    expect(m.has('swoop', w.time)).toBe(false);
    expect(m.ready('swoop', w.time)).toBe(true);
  });
});

describe('Gantetsu', () => {
  it('twin chainguns spin up, set the target alight, crit it while it burns, and the crits feed the roar', () => {
    const w = arena(), g = place(w, 'gantetsu', 'umbra', 0, 0), x = place(w, 'tenkai', 'zenith', 0, 8);
    const a0 = g.ammo, b0 = g.sv.ammo2;
    let burned = false, roar = 0, fired1 = 0;
    run(w, 2, () => {
      aimAt(g, x.center); g.input.fire = g.input.alt = true;
      if (!fired1 && w.time > 0.2) fired1 = a0 - g.ammo;
      burned ||= x.has('burning', w.time);
      roar = Math.max(roar, g.shields.find(s => s.kind === 'roar')?.amt ?? 0);
    });
    expect(g.sv.spin1).toBeGreaterThan(0.95); expect(g.sv.spin2).toBeGreaterThan(0.95);
    const fired = a0 - g.ammo;
    expect(fired).toBeGreaterThan(20);                       // ~16 rounds/s once spun up
    expect(fired1 / 0.2).toBeLessThan(fired / 2);             // slower while spinning up
    expect(b0 - g.sv.ammo2).toBeGreaterThan(20);             // the right drum drains too
    expect(burned).toBe(true);
    expect(roar).toBeGreaterThan(0);
  });
  it('Tachiai Rush is unstoppable and the Shiko Stomp knocks everyone close off their feet', () => {
    const w = arena(), g = place(w, 'gantetsu', 'umbra', 0, 0, 0), e = place(w, 'raijin', 'zenith', 0.4, 4.5);
    tap(w, g, 'a1');
    expect(g.has('tachiai', w.time)).toBe(true);
    // unstoppable: a knockback slides off
    g.forced = { vx: 20, vy: 0, vz: 0, until: w.time + 0.3, kind: 'knock' };
    run(w, DT);
    expect(g.forced).toBe(null);
    tap(w, g, 'jump');
    expect(g.sv.stompArmed).toBe(1);
    const hp0 = e.health, d0 = Math.hypot(e.pos.x - g.pos.x, e.pos.z - g.pos.z);
    let down = 0, stunned = 0, landed = 0;
    run(w, 1.4, () => {
      if (e.has('knockdown', w.time)) down += DT;
      if (e.has('stun', w.time)) stunned += DT;
      if (!landed && !g.sv.stompArmed) landed = w.time;
    });
    expect(landed).toBeGreaterThan(0);
    expect(down).toBeGreaterThan(0.7);                        // flat on the ground...
    expect(stunned).toBeGreaterThan(0.7);                     // ...and stunned while he lies there
    expect(e.health).toBeLessThan(hp0 - 50);                 // 60 at the edge of the slam, 120 at its heart
    expect(Math.hypot(e.pos.x - g.pos.x, e.pos.z - g.pos.z)).toBeGreaterThan(d0);   // thrown back from the landing
  });
  it('Tachiai Rush ends in the leap by itself when the charge runs out - unless it was cut short', () => {
    const w = arena(), g = place(w, 'gantetsu', 'umbra', 0, -12, 0);
    tap(w, g, 'a1');
    let armed = false;
    run(w, 3.2, () => { armed ||= !!g.sv.stompArmed; });
    expect(armed).toBe(true);
    const w2 = arena(), g2 = place(w2, 'gantetsu', 'umbra', 0, -12, 0);
    tap(w2, g2, 'a1'); run(w2, 0.6); tap(w2, g2, 'a1');       // SHIFT again: the charge just stops
    expect(g2.has('tachiai', w2.time)).toBe(false);
    let armed2 = false;
    run(w2, 3, () => { armed2 ||= !!g2.sv.stompArmed; });
    expect(armed2).toBe(false);
  });
  it('the Shiko Stomp reaches 7m, hits hardest at its heart, and a colossus keeps its feet', () => {
    const w = arena(), g = place(w, 'gantetsu', 'umbra', 0, 0, 0);
    const near = place(w, 'raijin', 'zenith', 1, 1.5), far = place(w, 'yuzu', 'zenith', -5.5, 2), out = place(w, 'kaien', 'zenith', 9, 3), mech = place(w, 'tenkai', 'zenith', 3, -3);
    const hp = [near, far, out, mech].map(x => x.health);
    stompLeap(w, g);
    run(w, 1.2);
    expect(hp[0] - near.health).toBeGreaterThan(hp[1] - far.health);
    expect(hp[1] - far.health).toBeGreaterThan(50);
    expect(out.health).toBe(hp[2]);
    expect(far.st.knockdown).toBeGreaterThan(0);
    expect(mech.health).toBeLessThan(hp[3]);
    expect(mech.st.knockdown).toBeUndefined();
  });
  it('Grand Dohyo traps the enemies inside, keeps the rest out, blocks enemy fire across the wall and feeds the guns', () => {
    const w = arena(), g = place(w, 'gantetsu', 'umbra', 0, 0), e = place(w, 'raijin', 'zenith', 0, 4, 0), o = place(w, 'yuzu', 'zenith', 0, 20, Math.PI);
    g.ult = g.def.ult.charge; tap(w, g, 'ult');
    expect(w.zones.some(z => z.kind === 'dohyo')).toBe(true);
    e.input.mz = 1; o.input.mz = 1;                         // both walk at the wall
    run(w, 2.5);
    const c = { x: OX, z: OZ }, r = (a: Actor) => Math.hypot(a.pos.x - c.x, a.pos.z - c.z);
    expect(r(e)).toBeLessThan(9);                            // still inside
    expect(r(o)).toBeGreaterThan(9);                         // still outside
    const from = { x: OX, y: 1, z: OZ + 20 }, back = { x: 0, y: 0, z: -1 };
    expect(w.barrierHit('zenith', from, back, 30)?.t).toBeCloseTo(11, 0);
    expect(w.barrierHit('umbra', from, back, 30)).toBe(null);
    expect(w.barrierHit('zenith', { ...from, y: RING_H + 3 }, back, 30)).toBe(null);   // over the wall
    const a0 = g.ammo;
    run(w, 1, () => { aimAt(g, e.center); g.input.fire = true; });
    expect(g.ammo).toBe(a0);                                 // endless inside the ring
  });
  it('Grand Dohyo chains the enemies inside: no dashes, no flight, until the ring is gone', () => {
    const w = arena(), g = place(w, 'gantetsu', 'umbra', 0, 0), e = place(w, 'raijin', 'zenith', 0, 4, 0), m = place(w, 'mirei', 'zenith', 3, 3), o = place(w, 'kaien', 'zenith', 0, 20);
    g.ult = g.def.ult.charge; tap(w, g, 'ult');
    run(w, 0.2);
    expect(e.has('chained', w.time)).toBe(true);
    expect(m.has('grounded', w.time)).toBe(true);            // the flyer is pulled out of the air
    expect(o.has('chained', w.time)).toBe(false);
    const p0 = { ...e.pos };
    tap(w, e, 'a1');                                         // Flash Step: the chain holds
    expect(e.forced).toBe(null);
    expect(Math.hypot(e.pos.x - p0.x, e.pos.z - p0.z)).toBeLessThan(1);
    expect(w.zones.find(z => z.kind === 'dohyo')!.until - w.time).toBeGreaterThan(DOHYO_T - 0.5);
    run(w, DOHYO_T + 0.5);
    expect(e.has('chained', w.time)).toBe(false);
    tap(w, e, 'a1');
    expect(e.forced?.kind).toBe('flashstep');
  });
  it('Taiko Heartbeat: less damage taken, and the team heals by dealing damage', () => {
    const w = arena(), g = place(w, 'gantetsu', 'umbra', 0, 0), al = place(w, 'kagemaru', 'umbra', 3, 0), x = place(w, 'tenkai', 'zenith', 0, 9);
    al.hp = 100;
    tap(w, g, 'a2');
    expect(g.has('taiko', w.time)).toBe(true);
    run(w, DT);
    expect(al.has('lifesteal', w.time)).toBe(true);
    const before = al.hp;
    w.damage(al, x, 100, { kind: 'proj' });
    expect(al.hp).toBeGreaterThan(before + 20);
    const h0 = g.health; w.damage(x, g, 100, { kind: 'proj' });
    expect(h0 - g.health).toBeLessThan(80);
  });
});

describe('animation performance layer', () => {
  const base = (o: Partial<AnimState>): AnimState => ({
    dt: DT, time: 0, vel: new THREE.Vector3(), yaw: 0, pitch: 0, grounded: true, flying: false, frame: 'human',
    attackAge: 9, attackKind: 'primary', castAge: 9, castId: '', hitAge: 9, landAge: 9, jumpAge: 9,
    stunned: false, charging: false, beam: false, barrier: false, rooted: false, scale: 1, pos: new THREE.Vector3(), ...o,
  });
  it('Mirei leans her whole body along a swoop, flares back on arrival, and stays finite in every flight state', () => {
    const an = new Animator(mannequin(new ActorClass(HERO.mirei, 'zenith')));
    let t = 0;
    const tick = (o: Partial<AnimState>, secs: number) => { for (let i = 0; i < secs * 60; i++) { t += DT; an.update(base({ time: t, hero: 'mirei', angel: true, frame: 'flyer', ...o })); } };
    tick({ grounded: false, swoop: 0.5, vel: new THREE.Vector3(0, 0, 18) }, 0.6);
    expect(an.tilt.pitch).toBeGreaterThan(0.6);              // leaning into the travel direction
    tick({ grounded: false, swoopFlare: 0.1, vel: new THREE.Vector3(0, 1, 4) }, 0.35);
    expect(an.tilt.pitch).toBeLessThan(0.1);                 // flared back to brake
    for (const o of [{ superjump: true, vel: new THREE.Vector3(0, 14, 0) }, { gliding: true, vel: new THREE.Vector3(2, -2.2, 0) }, { flying: true, vel: new THREE.Vector3(5, 0, 3) }] as Partial<AnimState>[]) {
      tick({ grounded: false, ...o }, 0.4);
      for (const b of Object.values(an.bones)) { const q = b!.quaternion; expect(Number.isFinite(q.x + q.y + q.z + q.w)).toBe(true); }
      expect(Number.isFinite(an.tilt.pitch + an.tilt.roll)).toBe(true);
    }
  });
  it('landing squashes and settles, takeoff stretches', () => {
    const an = new Animator(mannequin(new ActorClass(HERO.raijin, 'zenith')));
    let t = 0, lo = 1, hi = 1;
    for (let i = 0; i < 40; i++) { t += DT; an.update(base({ time: t, hero: 'raijin', jumpAge: i < 2 ? i * DT : 9, grounded: i > 1 && i < 20 ? false : true, vel: new THREE.Vector3(0, i < 20 ? 8 : 0, 0) })); hi = Math.max(hi, an.sqY); }
    for (let i = 0; i < 40; i++) { t += DT; an.update(base({ time: t, hero: 'raijin', landAge: i * DT })); lo = Math.min(lo, an.sqY); }
    expect(hi).toBeGreaterThan(1.04); expect(lo).toBeLessThan(0.95);
    for (let i = 0; i < 120; i++) { t += DT; an.update(base({ time: t, hero: 'raijin' })); }
    expect(Math.abs(an.sqY - 1)).toBeLessThan(0.01);
  });
  it('Gantetsu carries both chainguns barrels-forward along the aim', () => {
    const an = new Animator(mannequin(new ActorClass(HERO.gantetsu, 'umbra')));
    an.guns = [new THREE.Object3D(), new THREE.Object3D()];
    for (let i = 0; i < 30; i++) an.update(base({ time: i * DT, hero: 'gantetsu', dual: { fireL: 0.02, fireR: 0.05 } }));
    for (const g of an.guns) {
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
      expect(fwd.z).toBeGreaterThan(0.7);
      expect(g.visible).toBe(true);
    }
  });
});
