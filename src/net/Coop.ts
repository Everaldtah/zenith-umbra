// Campaign co-op (up to 4): squads are advertised through the MQTT lobby; the host opens a PeerLink to every member.
// The host runs the whole simulation; clients send their input and render the host's snapshots (see NetSync).
import { Lobby, type Presence, type LobbyMsg } from './lobby';
import { PeerLink, type LinkState } from './link';
import { NodeLobby } from './nodeLobby';

export interface Member { id: string; name: string; hero: string; link?: LinkState; }

const rid = () => Math.random().toString(36).slice(2, 10);

export class Coop {
  lobby: Lobby | NodeLobby;
  role: 'host' | 'client' | null = null;
  links = new Map<string, PeerLink>();       // host: member id -> link ; client: host id -> link
  squad: Member[] = [];
  level = '';
  hostId = '';
  onSquad: ((m: Member[]) => void) | null = null;
  onPlayers: ((p: Presence[]) => void) | null = null;
  onStart: ((level: string, squad: Member[]) => void) | null = null;
  onMessage: ((from: string, m: any) => void) | null = null;
  onLeft: ((reason: string) => void) | null = null;
  onStatus: ((brokers: number) => void) | null = null;

  transport: 'vercel' | 'mqtt' = 'vercel';
  constructor(public name: string, public platform: 'web' | 'desktop') {
    // primary: the game's own Node lobby on Vercel; if it can't be reached, fall back to public MQTT brokers
    this.lobby = this.wire(new NodeLobby(name, platform));
    window.setTimeout(() => {
      if (!this.lobby.brokers && this.transport === 'vercel' && !this.role) {
        (this.lobby as NodeLobby).close?.();
        this.transport = 'mqtt';
        this.lobby = this.wire(new Lobby(name, platform));
        this.onStatus?.(0);
      }
    }, 6000);
  }
  private wire<T extends Lobby | NodeLobby>(l: T): T {
    l.onPlayers = p => this.onPlayers?.(p);
    l.onStatus = n => this.onStatus?.(n);
    l.onMessage = m => this.handle(m);
    l.connect();
    return l;
  }
  private updateFast() {
    if (this.lobby instanceof NodeLobby) this.lobby.fast = [...this.links.values()].some(l => l.state === 'connecting' || l.state === 'relay');
  }
  get me() { return this.lobby.id; }
  squads() { return [...this.lobby.players.values()].filter(p => p.status === 'squad'); }

  host(hero: string, level: string) {
    this.role = 'host'; this.level = level; this.hostId = this.me;
    this.squad = [{ id: this.me, name: this.lobby.me.name, hero }];
    this.lobby.setStatus('squad', level);
    this.emitSquad();
  }
  join(hostId: string, hero: string) {
    this.role = 'client'; this.hostId = hostId;
    this.lobby.send(hostId, { t: 'join', hero, name: this.lobby.me.name });
  }
  setHero(hero: string) {
    if (this.role === 'host') { this.squad[0].hero = hero; this.emitSquad(); }
    else this.sendHost({ t: 'hero', hero });
  }
  setLevel(level: string) { if (this.role === 'host') { this.level = level; this.lobby.setStatus('squad', level); this.emitSquad(); } }

  private handle(m: LobbyMsg) {
    if (m.t === 'join' && this.role === 'host') {
      if (this.squad.length >= 4 || this.squad.some(s => s.id === m.from)) { this.lobby.send(m.from, { t: 'full' }); return; }
      const sid = rid();
      this.squad.push({ id: m.from, name: String(m.name ?? 'Hero').slice(0, 20), hero: String(m.hero ?? 'mirei') });
      this.lobby.send(m.from, { t: 'accept', sid });
      this.link(m.from, sid, true);
      this.emitSquad();
    } else if (m.t === 'accept' && this.role === 'client' && m.from === this.hostId) {
      this.link(m.from, String(m.sid), false);
    } else if (m.t === 'full') {
      this.role = null; this.onLeft?.('That squad is full.');
    } else if (m.t === 'sig') {
      const l = this.links.get(m.from); if (l && l.sid === m.sid) l.handleSignal(m as any);
    } else if (m.t === 'relay') {
      const l = this.links.get(m.from); if (l && l.sid === m.sid) l.handleRelay((m as any).d);
    }
  }

  private link(peer: string, sid: string, initiator: boolean) {
    this.links.get(peer)?.close();
    const l = new PeerLink(this.lobby, peer, sid, initiator);
    this.links.set(peer, l);
    this.updateFast();
    l.onState = s => {
      this.updateFast();
      const mem = this.squad.find(x => x.id === peer); if (mem) mem.link = s;
      if (s === 'closed') {
        this.links.delete(peer);
        if (this.role === 'host') { this.squad = this.squad.filter(x => x.id !== peer); this.emitSquad(); }
        else this.onLeft?.('Lost connection to the squad host.');
      } else if (this.role === 'host') this.emitSquad();
    };
    l.onMessage = msg => this.recv(peer, msg);
  }

  private recv(from: string, m: any) {
    if (this.role === 'client') {
      if (m.t === 'squad') { this.squad = m.squad; this.level = m.level; this.onSquad?.(this.squad); return; }
      if (m.t === 'start') { this.onStart?.(m.level, m.squad); return; }
    } else if (this.role === 'host') {
      if (m.t === 'hero') { const mem = this.squad.find(x => x.id === from); if (mem) { mem.hero = m.hero; this.emitSquad(); } return; }
      if (m.t === 'leave') { this.links.get(from)?.close(); return; }
    }
    this.onMessage?.(from, m);
  }

  private emitSquad() {
    this.onSquad?.(this.squad);
    if (this.role === 'host') this.broadcast({ t: 'squad', squad: this.squad.map(({ id, name, hero }) => ({ id, name, hero })), level: this.level });
  }
  broadcast(m: any, reliable = true) { for (const l of this.links.values()) l.send(m, reliable); }
  sendHost(m: any, reliable = true) { this.links.get(this.hostId)?.send(m, reliable); }

  start() {
    if (this.role !== 'host') return;
    this.lobby.setStatus('playing', this.level);
    const squad = this.squad.map(({ id, name, hero }) => ({ id, name, hero }));
    this.broadcast({ t: 'start', level: this.level, squad });
    this.onStart?.(this.level, squad);
  }
  leave() {
    if (this.role === 'client') this.sendHost({ t: 'leave' });
    for (const l of this.links.values()) l.close();
    this.links.clear(); this.role = null; this.squad = [];
    this.lobby.setStatus('lobby');
  }
  close() { this.leave(); this.lobby.close(); }
}
