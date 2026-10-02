// Online play (desktop edition): matchmade Quick Play / Competitive and custom games against other players who have the
// game, through the online node on Vercel (api/net.js).
//
// Matchmade: QUEUE -> the node pairs you with whoever else is queued (two players are enough) and names the HOST (the
// best connection) -> ASSEMBLE: for one minute the match stays open - anyone else who queues joins it - while everyone
// links peer-to-peer to the host and picks a hero for their role -> the host STARTS it: every seat still empty on both
// sides is an AI hero. Custom game: a host opens a lobby, players join it from the list, the host starts it.
// In the match the host runs the simulation and streams it (FastSync); this session is the NetSession it uses.
import { NodeLobby, NET_URL } from './nodeLobby';
import { PeerLink, type LinkState } from './link';
import type { NetSession } from './session';
import type { Presence, LobbyMsg } from './lobby';
import { cachedSpeed, speedTest, type SpeedResult } from './quality';
import { HERO, rosterFor, type TeamId } from '../data/heroes';
import { FULL } from '../edition';

export type OnlineQueue = 'qp' | 'comp' | 'custom';
export type SeatRole = 'tank' | 'damage' | 'support' | 'flex';
export interface Seat { id: string; name: string; team: TeamId; role: SeatRole; mmr: number; hero: string; ready: boolean; link?: LinkState; ping?: number; platform?: string }
export type Phase = 'idle' | 'queue' | 'assemble' | 'playing';
export interface OnlineStart { match: string; q: OnlineQueue; map: string; seats: Seat[]; seed: number }

const ROLE_HERO: Record<string, string> = { tank: 'tank', damage: 'dps', support: 'support' };
const rid = () => Math.random().toString(36).slice(2, 10);
/** the heroes a seat may pick: its side, its role (flex = any role) */
export function heroPool(team: TeamId, role: SeatRole) {
  return rosterFor(FULL).filter(h => h.team === team && (role === 'flex' || h.role === ROLE_HERO[role]));
}

export class OnlineSession implements NetSession {
  lobby: NodeLobby;
  role: 'host' | 'client' | null = null;
  hostId = '';
  links = new Map<string, PeerLink>();
  phase: Phase = 'idle';
  q: OnlineQueue = 'qp';
  queueRole: SeatRole = 'flex';
  mmr = 1800;
  /** the match being assembled */
  match = ''; map = ''; seed = 0; seats: Seat[] = [];
  /** when the host starts it (local ms) */
  startAt = 0;
  queued = 0; queueSince = 0;
  speed: SpeedResult | null = cachedSpeed();
  players: Presence[] = [];
  /** set while you're in a forming match you joined late (the UI says so) */
  late = false;
  onChange: (() => void) | null = null;
  onStart: ((s: OnlineStart) => void) | null = null;
  onNotice: ((text: string) => void) | null = null;
  onMessage: ((from: string, m: any) => void) | null = null;
  onBinary: ((from: string, u: Uint8Array) => void) | null = null;
  private profCard: unknown = null; private profAt = 0;
  /** a queue join / leave waiting for the next poll to carry it */
  private pendingMm: Record<string, unknown> | null = null;
  private tick = 0;
  /** when this client was put in a forming match (the watchdog below) */
  private matchedAt = 0;
  private sids = new Map<string, string>();
  private startTimer = 0;
  private maps: string[] = [];

  constructor(public name: string, maps: string[], public profile: () => { card: unknown; lvl: number; rank: string }) {
    this.maps = maps;
    this.lobby = new NodeLobby(name, 'desktop');
    this.lobby.onPlayers = p => { this.players = p; this.onChange?.(); };
    this.lobby.onStatus = () => this.onChange?.();
    this.lobby.onMessage = m => this.handle(m);
    this.lobby.onPoll = j => {
      if (!j.mm || this.phase !== 'queue') return;
      this.queued = j.mm.queued;
      // (matched in this very poll: the match is in the inbox, handled right after)
      if (!j.mm.in && !j.inbox?.some((m: any) => m.t === 'mm_match') && Date.now() - this.queueSince > 4000) this.rejoin();
    };
    // the host refreshes everyone's roster (link state, ping) once a second while the match assembles
    this.tick = window.setInterval(() => {
      if (this.role === 'host' && this.phase === 'assemble' && this.links.size) this.pushRoster();
      // watchdog: a matchmade host that never links up (closed the game, crashed) or never starts - back to the queue
      if (this.role === 'client' && this.phase === 'assemble' && this.q !== 'custom' && this.matchedAt) {
        const l = this.links.get(this.hostId), now = Date.now();
        const noLink = !l && now - this.matchedAt > 20_000;
        const noStart = this.startAt && now > this.startAt + 25_000;
        if (noLink || noStart) {
          const q = this.q as 'qp' | 'comp', match = this.match;
          this.leave(true);
          this.onNotice?.('The host stopped responding - back in the queue.');
          this.queue(q, this.queueRole, this.mmr);
          // (leave that match on the node too, so the queue doesn't slot us straight back into it)
          this.pendingMm = { ...this.pendingMm, left: match };
        }
      }
    }, 1000);
    this.lobby.extra = () => this.extra();
    const pr = profile();
    this.lobby.me = { ...this.lobby.me, lvl: pr.lvl, rank: pr.rank, ...(this.speed ? { ping: this.speed.rtt, score: this.speed.score } : {}) };
    this.lobby.connect();
  }
  get me() { return this.lobby.id; }
  get online() { return this.lobby.ok; }
  get mySeat() { return this.seats.find(s => s.id === this.me) ?? null; }
  /** node clock -> local clock */
  local(nodeMs: number) { return nodeMs - this.lobby.nodeOffset; }

  /** the connection test (ping / down / up to the node); its score decides who hosts */
  async test(onStep?: (s: string) => void) {
    this.speed = await speedTest(NET_URL, true, onStep);
    this.lobby.me = { ...this.lobby.me, ping: this.speed.rtt, score: this.speed.score };
    this.onChange?.();
    return this.speed;
  }

  private extra() {
    const x: Record<string, unknown> = {};
    if (this.pendingMm) { x.mm = this.pendingMm; this.pendingMm = null; }
    else if (this.phase === 'queue') x.mm = { op: 'stay', q: this.q, role: this.queueRole, mmr: Math.round(this.mmr), score: this.speed?.score ?? 50 };
    if (Date.now() - this.profAt > 60_000) { const p = this.profile(); this.profCard = p.card; this.profAt = Date.now(); x.prof = this.profCard; }
    return x;
  }

  // ---------------------------------------------------------------- queue
  queue(q: 'qp' | 'comp', role: SeatRole, mmr: number) {
    this.leave(true);
    this.q = q; this.queueRole = role; this.mmr = mmr; this.phase = 'queue'; this.queueSince = Date.now(); this.queued = 1;
    this.lobby.setStatus('queue', q);
    // the join goes with the next poll; after that every poll says we're still here
    this.pendingMm = { op: 'join', q, role, mmr: Math.round(mmr), score: this.speed?.score ?? 50 };
    this.lobby.now();
    this.onChange?.();
  }
  /** the node lost our queue entry (a missed poll): queue again */
  private rejoin() { if (this.phase === 'queue') { const s = this.queueSince; this.queue(this.q as 'qp' | 'comp', this.queueRole, this.mmr); this.queueSince = s; } }
  cancelQueue() { this.leave(); }

  // ---------------------------------------------------------------- custom games
  hostCustom(map: string) {
    this.leave(true);
    this.q = 'custom'; this.role = 'host'; this.hostId = this.me; this.match = 'c' + rid(); this.map = map; this.seed = (Math.random() * 2 ** 31) | 0;
    this.seats = [{ id: this.me, name: this.name, team: 'zenith', role: 'flex', mmr: this.mmr, hero: '', ready: false, platform: 'desktop' }];
    this.phase = 'assemble'; this.startAt = 0;
    this.advertise();
    this.onChange?.();
  }
  joinCustom(hostId: string) {
    this.leave(true);
    this.q = 'custom'; this.role = 'client'; this.hostId = hostId; this.phase = 'assemble'; this.seats = []; this.match = '';
    this.lobby.send(hostId, { t: 'cjoin', name: this.name, mmr: Math.round(this.mmr) });
    this.onChange?.();
  }
  customGames() { return this.players.filter(p => p.status === 'custom'); }
  setMap(map: string) { if (this.role === 'host' && this.phase === 'assemble') { this.map = map; this.pushRoster(); } }
  /** host: move a player to the other side */
  swapTeam(id: string) {
    if (this.role !== 'host') return;
    const s = this.seats.find(x => x.id === id); if (!s) return;
    const to: TeamId = s.team === 'zenith' ? 'umbra' : 'zenith';
    if (this.seats.filter(x => x.team === to).length >= 5) return;
    s.team = to; s.hero = ''; s.ready = false; this.pushRoster();
  }
  private advertise() {
    if (this.q !== 'custom' || this.role !== 'host') return;
    this.lobby.setStatus('custom', this.match, `${this.name}'s game · ${this.map} · ${this.seats.length}/10`);
    this.lobby.now();
  }

  // ---------------------------------------------------------------- hero select
  pick(hero: string) {
    const me = this.mySeat; if (!me || this.phase !== 'assemble') return;
    if (this.role === 'host') { this.applyPick(this.me, hero); return; }
    me.hero = hero; me.ready = true;                 // (optimistic; the host's roster is the truth)
    this.sendHost({ t: 'pick', hero });
    this.onChange?.();
  }
  private applyPick(id: string, hero: string) {
    const s = this.seats.find(x => x.id === id); const d = HERO[hero];
    if (!s || !d || !heroPool(s.team, s.role).some(h => h.id === hero)) return;
    if (this.seats.some(x => x !== s && x.team === s.team && x.hero === hero)) return;      // taken on that side
    s.hero = hero; s.ready = true;
    this.pushRoster();
  }
  /** host: everyone's roster and the map, to everyone */
  private pushRoster() {
    for (const s of this.seats) { const l = this.links.get(s.id); if (l) { s.link = l.state; s.ping = Math.round(l.stats.rtt); } }
    this.broadcast({ t: 'roster', match: this.match, q: this.q, map: this.map, seats: this.seats, startAt: this.startAt ? this.startAt + this.lobby.nodeOffset : 0, seed: this.seed });
    if (this.q === 'custom') this.advertise();
    this.onChange?.();
  }
  /** host: start now (custom games), or when the gather minute is up (matchmade) */
  start() {
    if (this.role !== 'host' || this.phase !== 'assemble') return;
    clearTimeout(this.startTimer);
    // players whose link never came up don't make it in (their seat goes to the AI)
    this.seats = this.seats.filter(s => s.id === this.me || (this.links.get(s.id)?.state ?? 'closed') === 'p2p' || this.links.get(s.id)?.state === 'relay');
    for (const s of this.seats) if (!s.hero) {
      const free = heroPool(s.team, s.role).find(h => !this.seats.some(x => x.team === s.team && x.hero === h.id));
      s.hero = free?.id ?? heroPool(s.team, 'flex')[0].id;
    }
    if (!this.map) this.map = this.maps[this.seed % this.maps.length];
    const st: OnlineStart = { match: this.match, q: this.q, map: this.map, seats: this.seats.map(s => ({ ...s })), seed: this.seed };
    this.broadcast({ t: 'start', ...st });
    this.phase = 'playing';
    this.lobby.setStatus('online', this.q);
    this.onStart?.(st);
  }

  // ---------------------------------------------------------------- lobby messages
  private handle(m: LobbyMsg) {
    const from = m.from as string;
    if (m.t === 'mm_match' && (this.phase === 'queue' || this.phase === 'idle')) {
      // the node formed (or slotted us into) a match
      this.phase = 'assemble'; this.match = String(m.match); this.q = (m as any).q; this.hostId = String(m.host); this.seed = +(m as any).seed || 0;
      this.late = !!(m as any).late;
      this.map = this.maps[this.seed % this.maps.length];
      this.seats = ((m as any).players as any[]).map(p => ({ id: p.id, name: p.name, team: p.team, role: p.role, mmr: p.mmr, hero: '', ready: false, platform: p.platform }));
      this.startAt = this.local(+(m as any).startAt || Date.now() + 60_000);
      this.matchedAt = Date.now();
      this.lobby.setStatus('online', this.q);
      if (this.hostId === this.me) {
        this.role = 'host';
        for (const s of this.seats) if (s.id !== this.me) this.offer(s.id);
        this.armStart();
      } else this.role = 'client';
      this.onNotice?.(this.late ? 'Joined a match that was forming' : 'Match found');
      this.onChange?.();
      return;
    }
    if (m.t === 'mm_add' && this.role === 'host' && String(m.match) === this.match && this.phase === 'assemble') {
      const p = (m as any).player;
      if (!this.seats.some(s => s.id === p.id)) this.seats.push({ id: p.id, name: p.name, team: p.team, role: p.role, mmr: p.mmr, hero: '', ready: false, platform: p.platform });
      this.startAt = this.local(+(m as any).startAt || this.startAt);
      this.armStart();
      this.offer(p.id);
      this.pushRoster();
      return;
    }
    if (m.t === 'mm_link' && this.role === 'client' && from === this.hostId) { this.link(from, String(m.sid), false); return; }
    if (m.t === 'cjoin' && this.role === 'host' && this.q === 'custom' && this.phase === 'assemble') {
      if (this.seats.length >= 10 || this.seats.some(s => s.id === from)) { this.lobby.send(from, { t: 'cfull' }); return; }
      const team: TeamId = this.seats.filter(s => s.team === 'zenith').length <= this.seats.filter(s => s.team === 'umbra').length ? 'zenith' : 'umbra';
      this.seats.push({ id: from, name: String((m as any).name ?? 'Hero').slice(0, 20), team, role: 'flex', mmr: +(m as any).mmr || 1800, hero: '', ready: false });
      this.offer(from);
      this.pushRoster();
      return;
    }
    if (m.t === 'cfull' && this.role === 'client') { this.onNotice?.('That game is full.'); this.leave(); return; }
    if (m.t === 'sig') { const l = this.links.get(from); if (l && l.sid === m.sid) l.handleSignal(m as any); return; }
    if (m.t === 'relay') { const l = this.links.get(from); if (l && l.sid === m.sid) l.handleRelay(m as any); }
  }
  /** host: open a link to a player (they answer on mm_link) */
  private offer(peer: string) {
    const sid = rid();
    this.lobby.send(peer, { t: 'mm_link', sid, match: this.match });
    this.link(peer, sid, true);
  }
  private armStart() {
    clearTimeout(this.startTimer);
    if (this.q === 'custom' || !this.startAt) return;
    this.startTimer = window.setTimeout(() => this.start(), Math.max(0, this.startAt - Date.now()));
  }

  private link(peer: string, sid: string, initiator: boolean) {
    this.links.get(peer)?.close();
    this.sids.set(peer, sid);
    const l = new PeerLink(this.lobby, peer, sid, initiator, { nodeUrl: NET_URL });
    this.links.set(peer, l);
    this.updateFast();
    l.onState = s => {
      this.updateFast();
      if (s === 'closed') {
        if (this.links.get(peer) === l) this.links.delete(peer);
        if (this.role === 'host') {
          if (this.phase === 'assemble') { this.seats = this.seats.filter(x => x.id !== peer); this.pushRoster(); }
        } else if (peer === this.hostId) {
          const was = this.phase;
          this.reset();
          if (was === 'assemble' && this.q !== 'custom') { this.onNotice?.('The host left before the start - back in the queue.'); this.queue(this.q as 'qp' | 'comp', this.queueRole, this.mmr); }
          else this.onNotice?.(was === 'playing' ? 'Lost the connection to the host.' : 'The game closed.');
        }
      } else if (this.role === 'host') this.pushRoster();
      this.onChange?.();
    };
    l.onMessage = msg => this.recv(peer, msg);
    l.onBinary = u => this.onBinary?.(peer, u);
  }
  private updateFast() { this.lobby.fast = [...this.links.values()].some(l => l.state === 'connecting' || l.state === 'relay'); }

  private recv(from: string, m: any) {
    if (this.role === 'client' && from === this.hostId) {
      if (m.t === 'roster') {
        this.match = m.match; this.q = m.q; this.map = m.map; this.seats = m.seats; this.seed = m.seed;
        if (m.startAt) this.startAt = m.startAt - this.lobby.nodeOffset;
        this.onChange?.(); return;
      }
      if (m.t === 'start') { this.phase = 'playing'; this.seats = m.seats; this.map = m.map; this.lobby.setStatus('online', this.q); this.onStart?.(m as OnlineStart); return; }
    } else if (this.role === 'host') {
      if (m.t === 'pick') { this.applyPick(from, String(m.hero)); return; }
      if (m.t === 'leave') { this.links.get(from)?.close(); return; }
    }
    this.onMessage?.(from, m);
  }

  broadcast(m: any, reliable = true) { for (const l of this.links.values()) l.send(m, reliable); }
  sendHost(m: any, reliable = true) { this.links.get(this.hostId)?.send(m, reliable); }

  private reset() {
    clearTimeout(this.startTimer);
    for (const l of this.links.values()) l.close();
    this.links.clear(); this.role = null; this.seats = []; this.match = ''; this.phase = 'idle'; this.startAt = 0; this.late = false; this.matchedAt = 0;
    this.onMessage = null; this.onBinary = null;
  }
  /** leave whatever we're in (queue, forming match, custom game, a finished match) */
  leave(quiet = false) {
    const match = this.match, phase = this.phase;
    if (this.role === 'client') this.sendHost({ t: 'leave' });
    this.reset();
    if (phase === 'queue' || phase === 'assemble') this.pendingMm = { op: 'leave', match };
    this.lobby.setStatus('lobby');
    if (phase !== 'idle') this.lobby.now();
    if (!quiet) this.onChange?.();
  }
  /** after a match: back to the online lobby (the links stay up only for the match) */
  finish() { this.leave(); }
  close() { this.leave(true); clearInterval(this.tick); this.lobby.close(); }
}
