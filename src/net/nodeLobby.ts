// Lobby transport through the game's own Node API on Vercel (/api/net): presence, squad listing, WebRTC
// signalling and a low-rate relay fallback. Same surface as the MQTT Lobby so Coop can use either.
import type { Presence, LobbyMsg, Platform, Status } from './lobby';

const PROTO = 1;
const PROD = 'https://zenith-umbra.vercel.app/api/net';
/** the web build talks to its own origin; the desktop app / dev server talk to the production node */
export const NET_URL = /vercel\.app$|zenith-umbra/.test(location.hostname) ? '/api/net' : ((import.meta as any).env?.VITE_NET_URL ?? PROD);
const rid = (n = 10) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');

export class NodeLobby {
  readonly id = rid();
  me: Presence;
  players = new Map<string, Presence & { seen: number }>();
  onPlayers: ((list: Presence[]) => void) | null = null;
  onMessage: ((m: LobbyMsg) => void) | null = null;
  onStatus: ((brokers: number) => void) | null = null;
  /** set by Coop while links are connecting / relaying: poll fast */
  fast = false;
  ok = false;
  failures = 0;
  private out: { to: string; msg: any }[] = [];
  private seen = new Set<string>(); private seenQ: string[] = [];
  private timer = 0; private n = 0; private busy = false; private closed = false;

  constructor(name: string, platform: Platform) { this.me = { id: this.id, name, status: 'lobby', platform, v: PROTO }; }
  get brokers() { return this.ok ? 1 : 0; }

  connect() { this.loop(); addEventListener('beforeunload', () => this.close()); }

  private async loop() {
    if (this.closed) return;
    await this.poll();
    const delay = this.fast ? 140 : this.me.status === 'playing' ? 2500 : 900;
    this.timer = window.setTimeout(() => this.loop(), delay);
  }

  private async poll(bye = false) {
    if (this.busy) return; this.busy = true;
    const out = this.out.splice(0, 64);
    const list = this.n++ % 3 === 0;
    try {
      const r = await fetch(NET_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: this.id, me: bye ? undefined : this.me, out, list, bye }), keepalive: bye });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      if (!this.ok) { this.ok = true; this.onStatus?.(1); }
      this.failures = 0;
      if (j.players) {
        const now = Date.now();
        this.players = new Map((j.players as Presence[]).filter(p => p.v === PROTO).map(p => [p.id, { ...p, seen: now }]));
        this.onPlayers?.([...this.players.values()]);
      }
      for (const m of j.inbox as LobbyMsg[]) {
        if (m.mid) { if (this.seen.has(m.mid)) continue; this.seen.add(m.mid); this.seenQ.push(m.mid); if (this.seenQ.length > 500) this.seen.delete(this.seenQ.shift()!); }
        this.onMessage?.(m);
      }
    } catch {
      this.out.unshift(...out.filter(o => o.msg.t !== 'relay'));   // retry signalling, drop stale relay traffic
      this.failures++;
      if (this.ok && this.failures > 2) { this.ok = false; this.onStatus?.(0); }
    } finally { this.busy = false; }
  }

  setStatus(status: Status, mission?: string) { this.me = { ...this.me, status, mission }; }
  setName(name: string) { this.me = { ...this.me, name: name.slice(0, 20) }; }

  send(to: string, msg: { t: string; [k: string]: unknown }, _reliable = true) {
    this.out.push({ to, msg: { ...msg, mid: rid(8) } });
    if (this.out.length > 200) this.out.splice(0, this.out.length - 200);
    // signalling should not wait for the next idle poll
    if (msg.t !== 'relay' && !this.fast) { clearTimeout(this.timer); this.timer = window.setTimeout(() => this.loop(), 30); }
  }

  close() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.timer);
    this.poll(true);
  }
}
