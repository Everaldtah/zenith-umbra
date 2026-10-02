// Fast Link replication - host-authoritative, for online PvP and campaign co-op.
//
// HOST (runs the only simulation):
//  - per peer, a snapshot stream at that link's own rate (Fast Link tiers: 60/40/30/20 Hz direct, 8 Hz through the
//    node), measured continuously (RTT, jitter, loss, WebRTC bandwidth estimate, send-queue backlog) and capped by the
//    host's uplink shared between its peers
//  - snapshots are binary: every actor's and projectile's "hot" row each time (position, velocity, aim, vitals), and
//    the "cold" state (hero, statuses, animation cues, scores, zones, the objective, your own cooldowns/ammo/ult) as
//    JSON only while the peer hasn't acknowledged its current version (acks ride on the peer's input packets)
//  - inputs arrive as binary with a sequence number and a press counter per button, so a tap is never lost to a
//    dropped packet (it is latched for one simulation step)
//  - lag compensation ("favour the shooter", as Overwatch does): while a remote player's weapons and abilities run,
//    everyone else is moved back to where that player saw them (their RTT/2 + interpolation delay, capped at 250 ms)
// CLIENT:
//  - a snapshot buffer: other heroes and projectiles are drawn between the two snapshots around (host time - an
//    adaptive interpolation delay sized from the update rate and the measured jitter), extrapolated briefly on loss
//  - its own hero is predicted locally (movement runs at once on input) and reconciled: the host's position for the
//    last input it applied is compared with where the client had predicted that input, and the error is eased out
//  - reliable events (damage numbers, kills, sounds, effects) arrive in order on the reliable channel
import type { World, GameEvent, Proj, Zone } from '../game/World';
import type { Actor, Input } from '../game/Actor';
import type { TeamId } from '../data/heroes';
import { HERO, PILOT_BY_ID } from '../data/heroes';
import { ROBOTS } from '../data/robots';
import * as K from './codec';
import { AdaptiveTier, TIER, tierCode, tierOf, type Tier } from './quality';
import type { NetSession } from './session';
import type { PeerLink } from './link';

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
/** the per-actor values the renderers / HUD read (timestamps mostly - they rarely change) */
const SV_KEYS = ['rebirthAt', 'fang', 'zoom', 'riseUntil', 'riseAt', 'track', 'wasLowAt', 'tideT0', 'tideDur', 'spin1', 'spin2', 'rhythm', 'rebornAt',
  'healedAt', 'tempo', 'swoopProg', 'susanooCast', 'strikes', 'strikeAt', 'phase', 'lastHitDmg', 'groove', 'grindSide', 'grindNz', 'grindNx', 'grind',
  'fellAt', 'fangTgt', 'fangAt', 'ammo2', 'chargeStart', 'rushStart', 'deflectStart', 'bassAt', 'roarAt'];
const LAGCOMP_MAX = 0.25;

function packEvent(e: GameEvent): any {
  const o: any = { ...e };
  for (const k of ['actor', 'target', 'src', 'tgt']) if (o[k]) o[k] = (o[k] as Actor).id;
  return o;
}

// ------------------------------------------------------------------ cold state
function actorCold(a: Actor, t: number) {
  const st: Record<string, number> = {};
  for (const [k, until] of Object.entries(a.st)) if (until > t) st[k] = r1(until + 0.049);
  const sv: Record<string, number> = {};
  for (const k of SV_KEYS) { const v = a.sv[k]; if (typeof v === 'number' && Number.isFinite(v)) sv[k] = r2(v); }
  const an = a.anim;
  return {
    d: a.def.id, b: a.baseDef.id, tm: a.team, n: a.netId, boss: a.isBoss ? Math.round(a.def.hp) : 0, rob: a.isRobot ? 1 : 0, own: a.owner?.id ?? 0,
    st, sv, f: a.forced ? [a.forced.kind, r2(a.forced.until)] : 0,
    an: [r2(an.attackAt), an.attackKind, an.attackSide, r2(an.castAt), an.castId, r2(an.hitAt), r2(an.landAt), r2(an.jumpAt), r2(an.fireL), r2(an.fireR), r2(an.deflectAt), an.deflectN],
    k: [a.kills, a.deaths, a.assists, Math.round(a.dmgDone), Math.round(a.healDone), r2(a.deathAt), a.respawnAt ? r2(a.respawnAt) : 0, Math.round(a.ult / Math.max(1, a.def.ult.charge) * 100), Math.round(a.mitigated)],
  };
}
/** what only the actor's own player needs */
function ownCold(a: Actor) {
  const cd: Record<string, number> = {};
  for (const [k, v] of Object.entries(a.cd)) cd[k] = r2(v);
  const x: Record<string, number> = {};
  for (const [k, v] of Object.entries(a.stats)) if (typeof v === 'number') x[k] = r1(v);
  return { u: Math.round(a.ult), am: a.ammo, rl: r2(a.reloadUntil), cd, fl: Math.round(a.flight), ch: r2(a.charge), sh: [a.shots, a.hits, a.crits, r1(a.objTime), a.ults, a.bestStreak, a.streak], x, cash: a.cash, it: a.items, pw: a.powers };
}
function matchCold(w: World) {
  const P = w.point, C = w.control, M = w.push;
  return {
    r: w.rules, tl: w.timeLimit, w: w.winner,
    p: [P.owner, r1(P.capture), P.capTeam, r1(P.progress.zenith), r1(P.progress.umbra), P.contested ? 1 : 0, P.unlockAt],
    c: [C.round, C.wins.zenith, C.wins.umbra, C.phase, r1(C.phaseEnd), C.overtime ? 1 : 0],
    m: [r1(M.d), r1(M.best.zenith), r1(M.best.umbra), M.owner, M.contested ? 1 : 0, M.unlockAt, M.half, r1(M.pos.x), r1(M.pos.y), r1(M.pos.z), M.checkpoint, M.overtime ? 1 : 0],
    k: w.packs.map(p => r1(p.readyAt)),
  };
}
function zonesCold(w: World) {
  return w.zones.map(z => [z.id, z.kind, z.team, r1(z.x), r1(z.y), r1(z.z), z.r, r2(z.born), r2(z.until), z.kind === 'tele' ? z.data : z.kind === 'tether' ? { target: z.data?.target?.id } : null, z.owner.id]);
}

// ------------------------------------------------------------------ host
interface Peer {
  id: string; tier: AdaptiveTier; next: number; seq: number;
  acked: Map<string, number>; sent: Map<string, { v: number; at: number }>; inflight: Map<number, [string, number][]>;
  lastInput: number; viewMs: number; presses: number[] | null; held: Partial<Input>; latch: Set<string>;
  bytes: number;
}
export class FastHost {
  /** events of this frame's steps (forwarded reliably) */
  events: any[] = [];
  peers = new Map<string, Peer>();
  /** a player whose link died mid-match (Game hands their hero to the AI) */
  onPeerLost: ((a: Actor) => void) | null = null;
  /** the host's measured uplink (kbit/s), shared between its peers */
  upKbps = 0;
  private cold = new Map<string, { json: string; v: number; val: unknown }>();
  private hot = new K.Writer(4096);
  private out = new K.Writer(8192);
  private hist = new Map<number, Float64Array>();      // actor id -> ring of [t, x, y, z] per step
  private histN = new Map<number, number>();
  private lastSnapBytes = 1200;
  constructor(public w: World, public s: NetSession) {
    s.onBinary = (from, u) => this.recv(from, u);
    s.onMessage = (from, m) => {
      // older clients / JSON fallback
      if (m.t === 'in') { const a = this.actorOf(from); if (a) Object.assign(a.input, m.i as Input); }
    };
    w.rewind = a => this.rewind(a);
  }
  private actorOf(peer: string) { return this.w.actors.find(x => x.netId === peer) ?? null; }
  private peer(id: string): Peer {
    let p = this.peers.get(id);
    if (!p) this.peers.set(id, p = { id, tier: new AdaptiveTier('medium'), next: 0, seq: 0, acked: new Map(), sent: new Map(), inflight: new Map(), lastInput: -1, viewMs: 100, presses: null, held: {}, latch: new Set(), bytes: 0 });
    return p;
  }

  private recv(from: string, u: Uint8Array) {
    if (u[0] !== K.PK_INPUT) return;
    const p = this.peer(from);
    let pk: K.InputPacket;
    try { pk = K.readInput(new K.Reader(u)); } catch { return; }
    this.ack(p, pk.ackSnap);
    if (p.lastInput >= 0 && !K.seqNewer(pk.seq, p.lastInput)) return;      // older than what we have (reordered)
    p.lastInput = pk.seq; p.viewMs = pk.viewMs;
    const held: Partial<Input> = { mx: pk.mx, mz: pk.mz, yaw: pk.yaw, pitch: pk.pitch };
    K.IN_BITS.forEach((k, i) => { (held as any)[k] = !!(pk.held & (1 << i)); });
    p.held = held;
    if (p.presses) K.IN_EDGES.forEach((k, i) => { if (pk.presses[i] !== p.presses![i]) p.latch.add(k); });
    p.presses = pk.presses;
    const a = this.actorOf(from);
    if (a) Object.assign(a.input, held);
  }
  private ack(p: Peer, s: number) {
    for (const [seq, keys] of p.inflight) {
      if (seq === s || K.seqNewer(s, seq)) {
        for (const [k, v] of keys) if ((p.acked.get(k) ?? -1) < v) p.acked.set(k, v);
        p.inflight.delete(seq);
      }
    }
  }

  /** before each simulation step: latched presses are seen for exactly one step */
  beforeStep() {
    for (const p of this.peers.values()) {
      if (!p.latch.size) continue;
      const a = this.actorOf(p.id); if (!a) { p.latch.clear(); continue; }
      for (const k of p.latch) (a.input as any)[k] = true;
    }
  }
  /** after each simulation step: release the latches, record positions for lag compensation */
  afterStep() {
    for (const p of this.peers.values()) {
      if (!p.latch.size) continue;
      const a = this.actorOf(p.id);
      if (a) for (const k of p.latch) (a.input as any)[k] = !!(p.held as any)[k];
      p.latch.clear();
    }
    const t = this.w.time;
    for (const a of this.w.actors) {
      let h = this.hist.get(a.id);
      if (!h) { h = new Float64Array(160 * 4).fill(-1e9); this.hist.set(a.id, h); this.histN.set(a.id, 0); }
      const n = this.histN.get(a.id)!, i = (n % 160) * 4;
      h[i] = t; h[i + 1] = a.pos.x; h[i + 2] = a.pos.y; h[i + 3] = a.pos.z;
      this.histN.set(a.id, n + 1);
    }
  }
  /** where an actor stood at time `t` (from the step history) */
  private posAt(id: number, t: number): { x: number; y: number; z: number } | null {
    const h = this.hist.get(id), n = this.histN.get(id) ?? 0; if (!h || !n) return null;
    let after = -1;
    for (let k = 0; k < Math.min(n, 160); k++) {
      const i = ((n - 1 - k) % 160) * 4;
      if (h[i] <= t) {
        if (after < 0) return { x: h[i + 1], y: h[i + 2], z: h[i + 3] };
        const t0 = h[i], t1 = h[after], f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
        return { x: h[i + 1] + (h[after + 1] - h[i + 1]) * f, y: h[i + 2] + (h[after + 2] - h[i + 2]) * f, z: h[i + 3] + (h[after + 3] - h[i + 3]) * f };
      }
      after = i;
    }
    return null;
  }
  /** lag compensation: everyone else as the remote shooter saw them; returns the undo */
  private rewind(shooter: Actor): (() => void) | null {
    const p = this.peers.get(shooter.netId); if (!p) return null;
    const link = this.s.links.get(shooter.netId);
    const back = Math.min(LAGCOMP_MAX, ((link?.stats.rtt ?? 0) / 2 + p.viewMs) / 1000);
    if (back < 0.005) return null;
    const t = this.w.time - back, moved: [Actor, number, number, number, number, number, number][] = [];
    for (const b of this.w.actors) {
      if (b === shooter || !b.alive) continue;
      const q = this.posAt(b.id, t); if (!q) continue;
      moved.push([b, b.pos.x, b.pos.y, b.pos.z, q.x, q.y, q.z]);
      b.pos.x = q.x; b.pos.y = q.y; b.pos.z = q.z;
    }
    return () => {
      // back to the present, keeping anything the shot itself did to them (knockback, pulls)
      for (const [b, x, y, z, qx, qy, qz] of moved) { b.pos.x = x + (b.pos.x - qx); b.pos.y = y + (b.pos.y - qy); b.pos.z = z + (b.pos.z - qz); }
    };
  }

  /** call once per sim step with that step's events (before the local game consumes them) */
  capture(ev: GameEvent[]) { for (const e of ev) if (e.t !== 'sfx' || e.id !== 'step') this.events.push(packEvent(e)); }

  private setCold(key: string, val: unknown, keep: Set<string>) {
    keep.add(key);
    const json = JSON.stringify(val), c = this.cold.get(key);
    if (!c) this.cold.set(key, { json, v: 1, val });
    else if (c.json !== json) { c.json = json; c.v++; c.val = val; }
  }

  /** call once per rendered frame: events to everyone, and a snapshot to every peer whose turn it is */
  flush() {
    const s = this.s, w = this.w, now = performance.now();
    // links that died mid-match: their heroes go to the AI
    for (const a of w.actors) if (a.netId && !s.links.has(a.netId)) { const id = a.netId; this.peers.delete(id); this.onPeerLost?.(a); if (a.netId === id) a.netId = ''; }
    if (!s.links.size) { this.events.length = 0; return; }
    if (this.events.length) { s.broadcast({ t: 'ev', e: this.events }); this.events = []; }
    const due: [Peer, PeerLink][] = [];
    const nPeers = s.links.size;
    for (const [id, link] of s.links) {
      if (link.state === 'connecting' || link.state === 'closed') continue;
      const p = this.peer(id);
      link.stats.tick(now);
      p.tier.update(link.stats, now, { relay: !link.direct, budgetKbps: this.upKbps ? this.upKbps * 0.7 / nPeers : 0, snapBytes: this.lastSnapBytes });
      if (now >= p.next) { due.push([p, link]); const iv = 1000 / TIER[p.tier.tier].snapHz; p.next = Math.max(p.next + iv, now - iv); }
    }
    if (!due.length) return;
    // the shared hot block
    const t = w.time;
    this.hot.reset();
    K.writeHot(this.hot, w.actors.map(a => ({
      id: a.id, x: a.pos.x, y: a.pos.y, z: a.pos.z, vx: a.vel.x, vy: a.vel.y, vz: a.vel.z, yaw: a.yaw, pitch: a.pitch,
      hp: Math.max(0, a.hp), armor: Math.max(0, a.armor), shield: a.shieldAmt, bhp: Math.max(0, a.barrier.hp),
      flags: (a.alive ? K.AF_ALIVE : 0) | (a.grounded ? K.AF_GROUNDED : 0) | (a.flying ? K.AF_FLYING : 0) | (a.barrier.up ? K.AF_BARRIER : 0) | (a.beamOn ? K.AF_BEAM : 0) | (a.flameOn ? K.AF_FLAME : 0) | (a.charging ? K.AF_CHARGING : 0) | (a.isBoss ? K.AF_BOSS : 0),
      scale: a.scale, beam: a.beamTarget?.id ?? 0,
    })), w.projs.map(p => ({ id: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: p.vel.x, vy: p.vel.y, vz: p.vel.z })));
    const hot = this.hot.view();
    // the cold state's current versions
    const keep = new Set<string>();
    for (const a of w.actors) {
      this.setCold('a' + a.id, actorCold(a, t), keep);
      if (a.netId) this.setCold('o' + a.id, ownCold(a), keep);
    }
    for (const p of w.projs) if (!this.cold.has('p' + p.id)) this.setCold('p' + p.id, [p.fx, p.heal ? 1 : 0, p.splash, p.owner.id, p.grav, p.r, p.team], keep); else keep.add('p' + p.id);
    this.setCold('m', matchCold(w), keep);
    this.setCold('z', zonesCold(w), keep);
    const d = w.director as any;
    if (d) this.setCold('d', { state: d.state, obj: d.objective, boss: d.boss?.id ?? 0, lvl: d.level?.id }, keep);
    for (const k of this.cold.keys()) if (!keep.has(k)) this.cold.delete(k);
    // one packet per due peer: header + hot + what that peer hasn't acknowledged
    for (const [p, link] of due) {
      const mine = w.actors.find(a => a.netId === p.id);
      const resend = Math.max(60, link.stats.rtt * 1.3);
      const cold: any = {}, sentKeys: [string, number][] = [];
      for (const [k, c] of this.cold) {
        if (k[0] === 'o' && (!mine || k !== 'o' + mine.id)) continue;
        if ((p.acked.get(k) ?? 0) >= c.v) continue;
        const prev = p.sent.get(k);
        if (prev && prev.v === c.v && now - prev.at < resend) continue;
        p.sent.set(k, { v: c.v, at: now }); sentKeys.push([k, c.v]);
        const kind = k[0], id = k.slice(1);
        if (kind === 'a') (cold.a ??= {})[id] = c.val;
        else if (kind === 'o') cold.o = c.val;
        else if (kind === 'p') (cold.p ??= {})[id] = c.val;
        else cold[k] = c.val;
      }
      for (const k of p.sent.keys()) if (!this.cold.has(k)) { p.sent.delete(k); p.acked.delete(k); }
      const o = this.out.reset();
      p.seq = (p.seq + 1) & 0xffff;
      K.writeSnapHeader(o, { seq: p.seq, time: t, ackInput: Math.max(0, p.lastInput), tier: tierCode(p.tier.tier), hostMs: now });
      o.bytes(hot);
      o.str(sentKeys.length ? JSON.stringify(cold) : '');
      if (sentKeys.length) { p.inflight.set(p.seq, sentKeys); if (p.inflight.size > 256) p.inflight.delete(p.inflight.keys().next().value!); }
      const pkt = o.done();
      if (!link.sendBin(pkt)) { for (const [k] of sentKeys) p.sent.delete(k); }      // congested: dropped, resend later
      this.lastSnapBytes = this.lastSnapBytes * 0.9 + pkt.byteLength * 0.1;
      p.bytes = pkt.byteLength;
    }
  }
  /** per-peer link numbers (host HUD / Tab screen) */
  linkInfo(peer: string) {
    const l = this.s.links.get(peer), p = this.peers.get(peer);
    return l ? { rtt: Math.round(l.stats.rtt), loss: l.stats.loss, tier: p?.tier.tier ?? 'medium', path: l.stats.path, kbps: Math.round(l.stats.kbpsOut) } : null;
  }
}

// ------------------------------------------------------------------ client
interface Snap { seq: number; time: number; recv: number; ackInput: number; tier: Tier; actors: Map<number, K.HotActor>; projs: K.HotProj[] }
export class FastClient {
  map = new Map<number, Actor>();
  me: Actor | null = null;
  fakeDirector: any = null;
  /** the host's update tier for this link, the measured snapshot rate and loss, the interpolation delay (ms) */
  tier: Tier = 'medium';
  snapHz = 0; loss = 0; interpMs = 70;
  private buf: Snap[] = [];
  private lastSeq = -1;
  private offset = NaN;                  // host time - local time (s)
  private offs: [number, number][] = [];
  private coldA = new Map<number, any>();
  private projMeta = new Map<number, any>();
  private projObj = new Map<number, Proj>();
  private own: any = null;
  // input
  private inSeq = 0; private inT = 0; private presses = new Array(K.IN_EDGES.length).fill(0);
  private prevHeld: Record<string, boolean> = {}; private orHeld = 0;
  private hist: { seq: number; x: number; y: number; z: number }[] = [];
  private corr = { x: 0, y: 0, z: 0 };
  private recvCount = 0; private recvAt = 0; private gapSeen = 0; private gapExp = 0;
  private arrJit = 0; private lastArr = 0;
  private w0: Writer = new K.Writer(64);

  constructor(public w: World, public s: NetSession, public onEvent: (e: GameEvent) => void, levelDef: any | null) {
    if (levelDef) {
      this.fakeDirector = { state: 'explore', objective: '', boss: null, level: levelDef, events: [] as any[], update() { /* host drives */ } };
      w.director = this.fakeDirector;
    }
    s.onBinary = (_from, u) => this.recvBin(u);
    s.onMessage = (_from, m) => { if (m.t === 'ev') for (const e of m.e) this.event(e); };
  }
  get link(): PeerLink | null { return this.s.links.get(this.s.hostId) ?? null; }
  private actor(id: number) { return this.map.get(id) ?? null; }
  private event(e: any) {
    // an event about a hero this client doesn't know yet (its first snapshot is still on the way) is dropped
    for (const k of ['actor', 'target', 'src', 'tgt']) if (typeof e[k] === 'number') { e[k] = this.actor(e[k]); if (!e[k]) return; }
    this.onEvent(e as GameEvent);
  }

  private recvBin(u: Uint8Array) {
    if (u[0] !== K.PK_SNAP) return;
    let r: K.Reader, h: K.SnapHeader, hot: ReturnType<typeof K.readHot>, coldStr: string;
    try { r = new K.Reader(u); h = K.readSnapHeader(r); hot = K.readHot(r); coldStr = r.left >= 4 ? r.str() : ''; } catch { return; }
    if (this.lastSeq >= 0 && !K.seqNewer(h.seq, this.lastSeq)) return;           // late duplicate / reordered: drop
    const now = performance.now();
    if (this.lastSeq >= 0) { this.gapExp += (h.seq - this.lastSeq) & 0xffff; this.gapSeen++; }
    this.lastSeq = h.seq;
    this.recvCount++;
    // arrival jitter (vs the expected interval)
    const iv = 1000 / TIER[tierOf(h.tier)].snapHz;
    if (this.lastArr) this.arrJit += (Math.abs(now - this.lastArr - iv) - this.arrJit) * 0.1;
    this.lastArr = now;
    this.tier = tierOf(h.tier);
    // clock: the least-delayed recent sample is the best estimate of host time - local time
    const sample = h.time - now / 1000;
    this.offs.push([now, sample]); while (this.offs.length && now - this.offs[0][0] > 2000) this.offs.shift();
    const best = Math.max(...this.offs.map(o => o[1]));
    this.offset = Number.isNaN(this.offset) || Math.abs(best - this.offset) > 0.25 ? best : this.offset + (best - this.offset) * 0.1;
    if (coldStr) { try { this.applyCold(JSON.parse(coldStr)); } catch { /* bad cold */ } }
    const snap: Snap = { seq: h.seq, time: h.time, recv: now, ackInput: h.ackInput, tier: this.tier, actors: new Map(hot.actors.map(a => [a.id, a])), projs: hot.projs };
    this.buf.push(snap); if (this.buf.length > 40) this.buf.shift();
    this.reconcile(snap);
  }

  private applyCold(c: any) {
    if (c.a) for (const [id, v] of Object.entries(c.a)) this.coldA.set(+id, v);
    if (c.o) this.own = c.o;
    if (c.p) for (const [id, v] of Object.entries(c.p)) this.projMeta.set(+id, v);
    const w = this.w;
    if (c.m) {
      const m = c.m, P = w.point, C = w.control, M = w.push;
      w.rules = m.r; w.timeLimit = m.tl;
      [P.owner, P.capture, P.capTeam, P.progress.zenith, P.progress.umbra] = m.p; P.contested = !!m.p[5]; P.unlockAt = m.p[6];
      [C.round, C.wins.zenith, C.wins.umbra, C.phase, C.phaseEnd] = m.c; C.overtime = !!m.c[5];
      [M.d, M.best.zenith, M.best.umbra, M.owner] = m.m; M.contested = !!m.m[4]; M.unlockAt = m.m[5]; M.half = m.m[6];
      M.pos = { x: m.m[7], y: m.m[8], z: m.m[9] }; M.checkpoint = m.m[10]; M.overtime = !!m.m[11];
      m.k?.forEach((at: number, i: number) => { if (w.packs[i]) w.packs[i].readyAt = at; });
      if (m.w && !w.winner) w.winner = m.w;
    }
    if (c.z) w.zones = c.z.map((z: any) => ({ id: z[0], kind: z[1], team: z[2], x: z[3], y: z[4], z: z[5], r: z[6], born: z[7], until: z[8], next: 0, data: z[1] === 'tether' ? { target: this.map.get(z[9]?.target) } : z[9], owner: this.map.get(z[10]) ?? w.actors[0] }) as Zone);
    if (c.d && this.fakeDirector) { const fd = this.fakeDirector; fd.state = c.d.state; fd.objective = c.d.obj; fd.boss = c.d.boss ? this.map.get(c.d.boss) ?? null : null; }
  }

  /** the host's view of my own hero vs my prediction for the input it last applied */
  private reconcile(s: Snap) {
    const me = this.me; if (!me) return;
    const h = s.actors.get(me.id); if (!h) return;
    const i = this.hist.findIndex(x => x.seq === s.ackInput);
    if (!this.predicting(me) || i < 0) return;
    const e = this.hist[i];
    const ex = h.x - e.x, ey = h.y - e.y, ez = h.z - e.z, err = Math.hypot(ex, ey, ez);
    this.hist.splice(0, i + 1);
    if (err > 3.5) {
      // too far off (a dash, a knockback, a respawn): take the host's word for it
      me.pos = { x: h.x, y: h.y, z: h.z }; me.vel = { x: h.vx, y: h.vy, z: h.vz };
      this.corr = { x: 0, y: 0, z: 0 }; this.hist.length = 0;
      return;
    }
    if (err < 0.02) return;
    this.corr.x += ex; this.corr.y += ey; this.corr.z += ez;
    for (const x of this.hist) { x.x += ex; x.y += ey; x.z += ez; }
  }
  /** own hero is predicted unless the host is moving it (forced moves, stuns, death) */
  private predicting(me: Actor) {
    const t = this.w.time;
    return me.alive && !me.forced && !me.has('stun', t) && !me.has('root', t) && !me.has('knockdown', t) && !me.has('reborn', t);
  }

  /** once per rendered frame: send input, place everything for this frame */
  apply(dt: number, myInput: Input | null) {
    const w = this.w, now = performance.now();
    if (Number.isNaN(this.offset)) return;
    const hostNow = now / 1000 + this.offset;
    w.time = hostNow;
    this.stats(now);
    // ---- interpolation delay: ~1.5 update intervals + the arrival jitter, eased
    const iv = 1000 / TIER[this.tier].snapHz;
    const want = Math.max(25, Math.min(300, iv * 1.5 + this.arrJit * 2 + 6));
    this.interpMs += (want - this.interpMs) * Math.min(1, dt * 1.5);
    const rt = hostNow - this.interpMs / 1000;
    // ---- input to the host
    if (myInput) this.sendInput(dt, myInput, now);
    const newest = this.buf[this.buf.length - 1]; if (!newest) return;
    // ---- actors: create / remove from the newest snapshot, then place
    const seen = new Set<number>();
    for (const [id, h] of newest.actors) {
      seen.add(id);
      let a = this.map.get(id);
      const c = this.coldA.get(id);
      if (!a) {
        if (!c) continue;                                     // its hero isn't known yet (cold state on its way)
        const def = [c.b, c.d].find((x: string) => HERO[x] || PILOT_BY_ID[x] || ROBOTS[x] || w.extraDefs[x]);
        if (!def) continue;
        a = w.addHero(def, c.tm as TeamId);
        a.controller = null; a.noRespawn = true;
        a.pos = { x: h.x, y: h.y, z: h.z }; a.yaw = h.yaw; a.pitch = h.pitch;
        this.map.set(id, a);
      }
      if (c) this.applyActorCold(a, c);
      const mine = !!a.netId && a.netId === this.s.me;
      if (mine) { if (this.me !== a) { this.me = a; this.hist.length = 0; } a.isPlayer = true; }
      this.applyVitals(a, h, mine);
    }
    for (const [id, a] of this.map) if (!seen.has(id)) { this.map.delete(id); w.actors = w.actors.filter(x => x !== a); if (this.me === a) this.me = null; }
    // remote heroes between snapshots
    let s0: Snap | null = null, s1: Snap | null = null;
    for (let i = this.buf.length - 1; i >= 0; i--) if (this.buf[i].time <= rt) { s0 = this.buf[i]; s1 = this.buf[i + 1] ?? null; break; }
    for (const [id, a] of this.map) {
      if (a === this.me) continue;
      const h1 = s1?.actors.get(id), h0 = s0?.actors.get(id);
      if (h0 && h1) {
        const f = Math.max(0, Math.min(1, (rt - s0!.time) / Math.max(1e-4, s1!.time - s0!.time)));
        a.pos = { x: h0.x + (h1.x - h0.x) * f, y: h0.y + (h1.y - h0.y) * f, z: h0.z + (h1.z - h0.z) * f };
        a.yaw = K.lerpAngle(h0.yaw, h1.yaw, f); a.pitch = h0.pitch + (h1.pitch - h0.pitch) * f; a.vel = { x: h1.vx, y: h1.vy, z: h1.vz };
      } else {
        // past the newest snapshot (loss / a late packet): carry on along its velocity for up to 0.2 s
        const h = (s0 ?? newest).actors.get(id) ?? newest.actors.get(id); if (!h) continue;
        const k = Math.max(-0.1, Math.min(0.2, rt - (s0 ?? newest).time));
        a.pos = { x: h.x + h.vx * k, y: h.y + h.vy * k, z: h.z + h.vz * k }; a.yaw = h.yaw; a.pitch = h.pitch; a.vel = { x: h.vx, y: h.vy, z: h.vz };
      }
      a.input.yaw = a.yaw; a.input.pitch = a.pitch;
    }
    // own hero: predicted movement (input applied at once), corrections eased in
    const me = this.me;
    if (me) {
      if (this.predicting(me)) {
        if (myInput) { me.input = { ...me.input, ...myInput }; me.yaw = myInput.yaw; me.pitch = myInput.pitch; }
        // (sub-stepped: a slow frame still moves the hero the whole way, as the host's fixed steps will)
        for (let left = Math.min(dt, 0.25); left > 1e-4; left -= 1 / 60) w.move(me, Math.min(left, 1 / 60));
        const k = Math.min(1, dt * 10);
        me.pos.x += this.corr.x * k; me.pos.y += this.corr.y * k; me.pos.z += this.corr.z * k;
        this.corr.x -= this.corr.x * k; this.corr.y -= this.corr.y * k; this.corr.z -= this.corr.z * k;
      } else {
        const h = newest.actors.get(me.id);
        if (h) { const k = Math.min(0.1, Math.max(0, hostNow - newest.time)); me.pos = { x: h.x + h.vx * k, y: h.y + h.vy * k, z: h.z + h.vz * k }; me.vel = { x: h.vx, y: h.vy, z: h.vz }; }
        this.hist.length = 0; this.corr = { x: 0, y: 0, z: 0 };
        if (myInput) { me.yaw = myInput.yaw; me.pitch = myInput.pitch; }
      }
    }
    // ---- projectiles: the newest rows, drawn at the same moment as the heroes around them
    const projs: Proj[] = [], k = Math.max(-0.25, Math.min(0.2, rt - newest.time));
    for (const hp of newest.projs) {
      const m = this.projMeta.get(hp.id); if (!m) continue;
      let p = this.projObj.get(hp.id);
      if (!p) { p = { id: hp.id, fx: m[0], heal: !!m[1], splash: m[2], owner: this.map.get(m[3]) ?? w.actors[0], grav: m[4], r: m[5], team: m[6], pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, dmg: 0, life: 1, crit: 1, hits: new Set(), born: newest.time } as Proj; this.projObj.set(hp.id, p); }
      p.pos = { x: hp.x + hp.vx * k, y: hp.y + hp.vy * k - 0.5 * (p.grav || 0) * k * Math.abs(k), z: hp.z + hp.vz * k };
      p.vel = { x: hp.vx, y: hp.vy, z: hp.vz };
      projs.push(p);
    }
    const live = new Set(newest.projs.map(p => p.id));
    let oldest = Infinity; for (const id of live) oldest = Math.min(oldest, id);
    for (const id of this.projObj.keys()) if (!live.has(id)) this.projObj.delete(id);
    // (ids only grow: meta older than every live projectile belongs to one that is gone)
    for (const id of this.projMeta.keys()) if (!live.has(id) && (id < oldest || this.projMeta.size > 600)) this.projMeta.delete(id);
    w.projs = projs;
    if (this.own && me) this.applyOwn(me, this.own);
  }

  private applyActorCold(a: Actor, c: any) {
    const w = this.w;
    if (a.def.id !== c.d) { const nd = HERO[c.d] ?? PILOT_BY_ID[c.d] ?? w.extraDefs[c.d]; if (nd) a.def = nd; }
    a.netId = c.n || ''; a.team = c.tm; a.isRobot = !!c.rob;
    if (c.boss && !a.isBoss) { a.isBoss = true; (a.def as any) = { ...a.def, hp: Math.max(c.boss, a.def.hp) }; }
    a.owner = c.own ? this.map.get(c.own) ?? null : null;
    a.st = { ...c.st };
    for (const [k, v] of Object.entries(c.sv as Record<string, number>)) a.sv[k] = v;
    a.forced = c.f ? { kind: c.f[0], until: c.f[1], vx: 0, vy: 0, vz: 0 } : null;
    const an = a.anim, x = c.an;
    [an.attackAt, an.attackKind, an.attackSide, an.castAt, an.castId, an.hitAt, an.landAt, an.jumpAt, an.fireL, an.fireR, an.deflectAt, an.deflectN] = x;
    [a.kills, a.deaths, a.assists, a.dmgDone, a.healDone, a.deathAt, a.respawnAt] = c.k;
    a.mitigated = c.k[8] ?? a.mitigated;
    if (a !== this.me) a.ult = c.k[7] / 100 * a.def.ult.charge;
  }
  private applyVitals(a: Actor, h: K.HotActor, mine: boolean) {
    a.hp = h.hp; a.armor = h.armor; a.maxArmor = Math.max(a.maxArmor, h.armor);
    a.shields = h.shield > 0 ? [{ amt: h.shield, until: this.w.time + 1, kind: 'net' }] : [];
    a.alive = !!(h.flags & K.AF_ALIVE); a.scale = h.scale || 1;
    a.barrier.up = !!(h.flags & K.AF_BARRIER); a.barrier.hp = h.bhp;
    a.beamOn = !!(h.flags & K.AF_BEAM); a.flameOn = !!(h.flags & K.AF_FLAME); a.charging = !!(h.flags & K.AF_CHARGING);
    a.beamTarget = h.beam ? this.map.get(h.beam) ?? null : null;
    if (!mine || !this.predicting(a)) { a.grounded = !!(h.flags & K.AF_GROUNDED); a.flying = !!(h.flags & K.AF_FLYING); }
  }
  private applyOwn(me: Actor, o: any) {
    me.ult = o.u; me.ammo = o.am; me.reloadUntil = o.rl; me.cd = { ...o.cd }; me.flight = o.fl; me.charge = o.ch;
    [me.shots, me.hits, me.crits, me.objTime, me.ults, me.bestStreak, me.streak] = o.sh;
    me.stats = { ...o.x }; me.cash = o.cash ?? me.cash; me.items = o.it ?? me.items; me.powers = o.pw ?? me.powers;
  }

  private sendInput(dt: number, i: Input, now: number) {
    // rising edges since the last frame -> press counters; held = anything held since the last packet
    let bits = 0;
    K.IN_BITS.forEach((k, b) => { if ((i as any)[k]) bits |= 1 << b; });
    K.IN_EDGES.forEach((k, e) => { const v = !!(i as any)[k]; if (v && !this.prevHeld[k]) this.presses[e] = (this.presses[e] + 1) & 0xff; this.prevHeld[k] = v; });
    this.orHeld |= bits;
    this.inT += dt;
    const hz = TIER[this.tier].inputHz;
    if (this.inT < 1 / hz) return;
    this.inT = 0;
    this.inSeq = (this.inSeq + 1) & 0xffff;
    const w = this.w0.reset();
    K.writeInput(w, { seq: this.inSeq, ackSnap: Math.max(0, this.lastSeq), yaw: i.yaw, pitch: i.pitch, mx: i.mx, mz: i.mz, held: this.orHeld | bits, presses: this.presses, viewMs: Math.round(this.interpMs) });
    this.orHeld = 0;
    this.link?.sendBin(w.done());
    const me = this.me;
    if (me) { this.hist.push({ seq: this.inSeq, x: me.pos.x, y: me.pos.y, z: me.pos.z }); if (this.hist.length > 120) this.hist.shift(); }
  }

  private stats(now: number) {
    if (!this.recvAt) this.recvAt = now;
    if (now - this.recvAt >= 1000) {
      this.snapHz = this.recvCount * 1000 / (now - this.recvAt); this.recvCount = 0; this.recvAt = now;
      this.loss = this.gapExp > 0 ? Math.max(0, 1 - this.gapSeen / this.gapExp) : 0; this.gapExp = this.gapSeen = 0;
    }
  }
}
type Writer = K.Writer;
