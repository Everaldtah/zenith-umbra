// Online play: the node's matchmaker (2 players are enough, late joiners fill a forming match, AI fills the rest), the
// Fast Link wire format and tiers, host <-> client replication in memory (FastSync: snapshots, acks, interpolation,
// prediction, input latching, lag compensation) and the online match's AI fill.
// @ts-ignore - the online node is plain JS (a Vercel function)
import { formMatches, placeInto, electHost } from '../../api/net.js';
import * as K from '../../src/net/codec';
import { classify, fitTier, AdaptiveTier, LinkStats, hostScore, TIER } from '../../src/net/quality';
import { FastHost, FastClient } from '../../src/net/FastSync';
import { createOnlineMatch } from '../../src/game/setup';
import { World } from '../../src/game/World';
import { HERO } from '../../src/data/heroes';
import type { NetSession } from '../../src/net/session';

const q = (id: string, role: string, o: Partial<{ mmr: number; at: number; score: number; q: string }> = {}) =>
  ({ id, name: id, q: o.q ?? 'qp', role, mmr: o.mmr ?? 1800, score: o.score ?? 100, at: o.at ?? 0, seen: 0, platform: 'desktop' });

describe('matchmaker (api/net.js)', () => {
  it('two players are enough for a match; one waits', () => {
    expect(formMatches([q('a', 'flex')], 1000)).toEqual([]);
    const m = formMatches([q('a', 'flex'), q('b', 'damage', { at: 5 })], 1000);
    expect(m.length).toBe(1);
    expect(m[0].players.map((p: any) => p.id).sort()).toEqual(['a', 'b']);
    expect(new Set(m[0].players.map((p: any) => p.team)).size).toBe(2);            // one on each side
  });
  it('fills at most 10 with role slots (1 tank, 2 damage, 2 support a side); the next two start their own', () => {
    const qs = Array.from({ length: 12 }, (_, i) => q('p' + i, 'flex', { at: i }));
    const m = formMatches(qs, 1000);
    expect(m.map((x: any) => x.players.length)).toEqual([10, 2]);
    const ps = m[0].players;
    expect(ps.length).toBe(10);
    for (const team of ['zenith', 'umbra']) {
      const side = ps.filter((p: any) => p.team === team);
      expect(side.filter((p: any) => p.role === 'tank').length).toBe(1);
      expect(side.filter((p: any) => p.role === 'damage').length).toBe(2);
      expect(side.filter((p: any) => p.role === 'support').length).toBe(2);
    }
    // three tanks: only two fit, the third waits for the next match
    const t = formMatches([q('t1', 'tank'), q('t2', 'tank', { at: 1 }), q('t3', 'tank', { at: 2 })], 1000);
    expect(t[0].players.length).toBe(2);
  });
  it('late joiners slot into a forming match on the side with fewer players', () => {
    const m = { players: [{ id: 'a', team: 'zenith', role: 'damage', mmr: 1800 }, { id: 'b', team: 'umbra', role: 'damage', mmr: 1800 }, { id: 'c', team: 'zenith', role: 'support', mmr: 1800 }] };
    const p = placeInto(m, q('d', 'support'));
    expect(p).toMatchObject({ team: 'umbra', role: 'support' });
    const full = { players: [{ id: 'x', team: 'zenith', role: 'tank', mmr: 1 }, { id: 'y', team: 'umbra', role: 'tank', mmr: 1 }] };
    expect(placeInto(full, q('z', 'tank'))).toBeNull();
  });
  it('the host is the best connection', () => {
    expect(electHost([q('a', 'flex', { score: 300 }), q('b', 'flex', { score: 800 }), q('c', 'flex', { score: 500 })])).toBe('b');
    expect(hostScore({ rtt: 20, upKbps: 40000, downKbps: 90000 }, true, 12)).toBeGreaterThan(hostScore({ rtt: 120, upKbps: 3000, downKbps: 20000 }, false, 4));
  });
});

describe('Fast Link wire format', () => {
  it('round-trips a snapshot (header, hot rows, cold JSON)', () => {
    const w = new K.Writer(16);
    K.writeSnapHeader(w, { seq: 65535, time: 123.456, ackInput: 77, tier: 2, hostMs: 99999 });
    K.writeHot(w, [{ id: 7, x: 12.345, y: 1.5, z: -40.25, vx: 3.21, vy: -9.8, vz: 0.5, yaw: -2.5, pitch: 0.3, hp: 250, armor: 25, shield: 75, bhp: 1400, flags: K.AF_ALIVE | K.AF_GROUNDED, scale: 2.2, beam: 3 }],
      [{ id: 100001, x: 1, y: 2, z: 3, vx: 60, vy: -4, vz: 0 }]);
    w.str(JSON.stringify({ a: { 7: { d: 'raijin' } } }));
    const r = new K.Reader(w.done());
    const h = K.readSnapHeader(r);
    expect(h).toMatchObject({ seq: 65535, ackInput: 77, tier: 2 });
    expect(h.time).toBeCloseTo(123.456, 3);
    const hot = K.readHot(r);
    const a = hot.actors[0];
    expect([a.id, a.hp, a.armor, a.shield, a.bhp, a.beam, a.flags]).toEqual([7, 250, 25, 75, 1400, 3, K.AF_ALIVE | K.AF_GROUNDED]);
    expect(a.x).toBeCloseTo(12.345, 4); expect(a.vx).toBeCloseTo(3.21, 2); expect(a.yaw).toBeCloseTo(-2.5, 3); expect(a.scale).toBeCloseTo(2.2, 1);
    expect(hot.projs[0]).toMatchObject({ id: 100001 }); expect(hot.projs[0].vx).toBeCloseTo(60, 1);
    expect(JSON.parse(r.str()).a[7].d).toBe('raijin');
  });
  it('round-trips an input packet; sequence numbers wrap', () => {
    const w = new K.Writer(8);
    K.writeInput(w, { seq: 3, ackSnap: 65000, yaw: 1.25, pitch: -0.4, mx: -1, mz: 0.7, held: 0b101, presses: [1, 2, 3, 4, 5, 6, 7, 8, 255], viewMs: 85 });
    const p = K.readInput(new K.Reader(w.done()));
    expect(p).toMatchObject({ seq: 3, ackSnap: 65000, mx: -1, mz: 0.7, held: 0b101, viewMs: 85 });
    expect(p.presses).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 255]);
    expect(K.seqNewer(2, 65530)).toBe(true); expect(K.seqNewer(65530, 2)).toBe(false);
    expect(K.fromB64(K.toB64(new Uint8Array([0, 255, 7])))).toEqual(new Uint8Array([0, 255, 7]));
  });
});

describe('Fast Link tiers', () => {
  it('classifies links and fits rates to bandwidth', () => {
    expect(classify({ rtt: 25, jitter: 3, loss: 0 })).toBe('ultra');
    expect(classify({ rtt: 120, jitter: 10, loss: 0 })).toBe('high');
    expect(classify({ rtt: 180, jitter: 10, loss: 0 })).toBe('medium');
    expect(classify({ rtt: 40, jitter: 4, loss: 0.2 })).toBe('low');
    expect(classify({ rtt: 20, jitter: 1, loss: 0, relay: true })).toBe('relay');
    expect(fitTier(100000, 1400)).toBe('ultra');
    expect(fitTier(300, 1400)).toBe('low');
  });
  it('drops a tier at once, climbs back one step at a time after a clean spell', () => {
    const s = new LinkStats(); let now = 0;
    for (let i = 0; i < 10; i++) { const n = s.nextPing(now); s.pong(n, now + 20); now += 250; }
    const t = new AdaptiveTier('ultra', 4000);
    expect(t.update(s, now, { relay: false })).toBe('ultra');
    s.rtt = 200;                                             // a latency spike
    expect(t.update(s, now += 100, { relay: false })).toBe('medium');
    s.rtt = 20;
    expect(t.update(s, now += 1000, { relay: false })).toBe('medium');
    expect(t.update(s, now += 4100, { relay: false })).toBe('high');
    expect(t.update(s, now += 4100, { relay: false })).toBe('ultra');
    expect(TIER.ultra.snapHz).toBe(60);
  });
});

// ---------------------------------------------------------------- host <-> client in memory
function pair() {
  const toHost: Uint8Array[] = [], toClient: Uint8Array[] = [], relClient: any[] = [];
  const mkStats = () => { const s = new LinkStats(); for (let i = 0; i < 5; i++) { const n = s.nextPing(i * 10); s.pong(n, i * 10 + 30); } return s; };
  const hostLink: any = { state: 'p2p', direct: true, stats: mkStats(), sendBin: (u: Uint8Array) => { toClient.push(u.slice()); return true; }, send: (m: any) => relClient.push(JSON.parse(JSON.stringify(m))) };
  const clientLink: any = { state: 'p2p', direct: true, stats: mkStats(), sendBin: (u: Uint8Array) => { toHost.push(u.slice()); return true; }, send() {} };
  const hostS: NetSession = { me: 'H', role: 'host', hostId: 'H', links: new Map([['C', hostLink]]), onMessage: null, onBinary: null, broadcast(m) { hostLink.send(m); }, sendHost() {} };
  const clientS: NetSession = { me: 'C', role: 'client', hostId: 'H', links: new Map([['H', clientLink]]), onMessage: null, onBinary: null, broadcast() {}, sendHost() {} };
  const deliver = () => {
    for (const u of toHost.splice(0)) hostS.onBinary?.('C', u);
    for (const u of toClient.splice(0)) clientS.onBinary?.('H', u);
    for (const m of relClient.splice(0)) clientS.onMessage?.('H', m);
  };
  return { hostS, clientS, deliver, hostLink, toHost };
}

describe('FastSync (host-authoritative replication)', () => {
  it('an online match: humans take their seats, AI fills the rest of both sides', () => {
    const m = createOnlineMatch('hanabi', 'quickplay', [{ hero: 'raijin', team: 'zenith', netId: 'local' }, { hero: 'enra', team: 'umbra', netId: 'peer1' }], 0.6, () => 0.3);
    const w = m.world;
    expect(w.actors.length).toBe(10);
    expect(m.player?.def.id).toBe('raijin');
    expect(w.actors.find(a => a.netId === 'peer1')?.def.id).toBe('enra');
    expect(m.bots.length).toBe(8);
    for (const team of ['zenith', 'umbra'] as const) {
      const side = w.actors.filter(a => a.team === team);
      expect(side.length).toBe(5);
      expect(new Set(side.map(a => a.def.id)).size).toBe(5);
      expect(side.filter(a => a.def.role === 'tank').length).toBe(1);
    }
  });

  it('mirrors the host world on the client, applies the client input on the host, and rewinds for lag compensation', async () => {
    const { hostS, clientS, deliver } = pair();
    const m = createOnlineMatch('hanabi', 'quickplay', [{ hero: 'raijin', team: 'zenith', netId: 'local' }, { hero: 'yuzu', team: 'zenith', netId: 'C' }], 0.6, () => 0.5);
    const hw = m.world;
    const host = new FastHost(hw, hostS);
    const cw = new World('hanabi', 'quickplay');
    const client = new FastClient(cw, clientS, () => {}, null);
    const remote = hw.actors.find(a => a.netId === 'C')!;
    const DT = 1 / 120;
    const input = { mx: 0, mz: 1, jump: false, jumpHeld: false, descend: false, fire: false, alt: false, a1: false, a2: false, ult: false, reload: false, melee: false, swoop: false, yaw: remote.yaw, pitch: 0 };
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const x0 = { ...remote.pos };
    // ~1.5 s of "frames": 2 host steps per frame, snapshots + inputs delivered each frame
    for (let f = 0; f < 90; f++) {
      for (let s = 0; s < 2; s++) { host.beforeStep(); hw.step(DT); host.afterStep(); hw.events.length = 0; for (const b of m.bots) void b; }
      host.flush();
      deliver();
      client.apply(1 / 60, f > 30 ? input : { ...input, mz: 0 });
      deliver();
      await sleep(16);
    }
    // the client knows every hero and which one is its own
    expect(cw.actors.length).toBe(hw.actors.length);
    expect(client.me?.def.id).toBe('yuzu');
    expect(client.snapHz).toBeGreaterThan(5);
    // the host moved the client's hero by its input (forward for ~1 s)
    expect(Math.hypot(remote.pos.x - x0.x, remote.pos.z - x0.z)).toBeGreaterThan(2);
    // the client's predicted hero agrees with the host's within a step or two of movement
    expect(Math.hypot(client.me!.pos.x - remote.pos.x, client.me!.pos.z - remote.pos.z)).toBeLessThan(1.5);
    // other heroes sit near their host positions (drawn ~one update interval behind)
    const other = hw.actors.find(a => a !== remote && a.alive)!;
    const mirror = cw.actors.find(a => a.def.id === other.def.id && a.team === other.team)!;
    expect(Math.hypot(mirror.pos.x - other.pos.x, mirror.pos.z - other.pos.z)).toBeLessThan(2.5);
    // match state arrived through the cold channel
    expect(cw.rules).toBe(hw.rules);
    // lag compensation: while the remote shooter's weapons run, the others stand where they were ~100+ ms ago
    expect(hw.rewind).toBeTruthy();
    const before = other.pos.x;
    const undo = hw.rewind!(remote);
    if (undo) { undo(); expect(other.pos.x).toBeCloseTo(before, 6); }
  });

  it('a press between two packets is never lost (latched for one step)', () => {
    const { hostS, clientS, deliver, toHost } = pair();
    const m = createOnlineMatch('hanabi', 'quickplay', [{ hero: 'raijin', team: 'zenith', netId: 'local' }, { hero: 'yuzu', team: 'zenith', netId: 'C' }], 0.6, () => 0.5);
    const hw = m.world, host = new FastHost(hw, hostS), remote = hw.actors.find(a => a.netId === 'C')!;
    const cw = new World('hanabi', 'quickplay'), client = new FastClient(cw, clientS, () => {}, null);
    host.flush(); deliver();
    const base = { mx: 0, mz: 0, jump: false, jumpHeld: false, descend: false, fire: false, alt: false, a1: false, a2: false, ult: false, reload: false, melee: false, swoop: false, yaw: 0, pitch: 0 };
    client.apply(1, base); deliver();                     // first packet: the counters' baseline
    // a1 tapped and released inside one send interval, and the packet carrying it is LOST...
    client.apply(0.001, { ...base, a1: true });
    client.apply(1, base);
    expect(toHost.length).toBe(1); toHost.length = 0;
    // ...the next packet says a1 is up, but its press counter moved: the host still sees the press for one step
    client.apply(1, base); deliver();
    host.beforeStep(); const seen = remote.input.a1; hw.step(1 / 120); host.afterStep();
    expect(seen).toBe(true);
    expect(remote.input.a1).toBe(false);
    expect(HERO[remote.def.id]).toBeTruthy();
  });
});
