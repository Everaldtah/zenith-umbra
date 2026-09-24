// Online lobby: presence + direct messages over public MQTT brokers (WebSocket).
// Every open game publishes a retained presence record with a "last will" that clears it when the
// connection drops, so everyone subscribed sees who is online right away. Two brokers are used in
// parallel for redundancy; inbox messages carry an id so duplicates are dropped.
// Only lobby/signalling (and the relay fallback) goes through the brokers; gameplay runs peer-to-peer.
import mqtt, { type MqttClient } from 'mqtt';

const ROOT = 'zenith-umbra/starfall/v1';
const PROTO = 1;
export const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
const STALE_MS = 50_000;   // a presence we haven't heard from in this long is dropped (crashed clients)

export type Platform = 'web' | 'desktop';
export type Status = 'lobby' | 'squad' | 'playing';
export interface Presence { id: string; name: string; status: Status; platform: Platform; mission?: string; v: number }
export interface LobbyMsg { t: string; from: string; mid: string; [k: string]: unknown }

const rid = (n = 10) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
const dec = new TextDecoder();

export class Lobby {
  readonly id = rid();
  me: Presence;
  players = new Map<string, Presence & { seen: number }>();
  onPlayers: ((list: Presence[]) => void) | null = null;
  onMessage: ((m: LobbyMsg) => void) | null = null;
  onStatus: ((brokers: number) => void) | null = null;
  private clients: MqttClient[] = [];
  private seen = new Set<string>(); private seenQ: string[] = [];
  private timers: number[] = [];

  constructor(name: string, platform: Platform) {
    this.me = { id: this.id, name, status: 'lobby', platform, v: PROTO };
  }

  get brokers() { return this.clients.filter(c => c.connected).length; }

  connect() {
    BROKERS.forEach((url, i) => {
      const c = mqtt.connect(url, {
        clientId: `zu_${this.id}_${i}`, clean: true, keepalive: 20, reconnectPeriod: 4000, connectTimeout: 8000,
        will: { topic: `${ROOT}/p/${this.id}`, payload: new Uint8Array(0) as unknown as Buffer, retain: true, qos: 1 },
      });
      c.on('connect', () => {
        c.subscribe([`${ROOT}/p/+`, `${ROOT}/i/${this.id}`], { qos: 1 });
        this.publishPresence(c);
        this.onStatus?.(this.brokers);
      });
      c.on('close', () => this.onStatus?.(this.brokers));
      c.on('error', () => { /* reconnects on its own */ });
      c.on('message', (topic, payload) => this.handle(topic, payload));
      this.clients.push(c);
    });
    this.timers.push(window.setInterval(() => this.publishPresence(), 15_000));
    this.timers.push(window.setInterval(() => this.prune(), 5_000));
    addEventListener('beforeunload', () => this.close());
  }

  private handle(topic: string, payload: Uint8Array) {
    if (topic.startsWith(`${ROOT}/p/`)) {
      const id = topic.slice(ROOT.length + 3);
      if (id === this.id) return;
      if (!payload.length) { if (this.players.delete(id)) this.emit(); return; }
      try {
        const p = JSON.parse(dec.decode(payload)) as Presence;
        if (p.v !== PROTO || typeof p.name !== 'string') return;
        this.players.set(id, { ...p, id, name: p.name.slice(0, 20), seen: Date.now() });
        this.emit();
      } catch { /* ignore junk */ }
      return;
    }
    try {
      const m = JSON.parse(dec.decode(payload)) as LobbyMsg;
      if (!m.mid || this.seen.has(m.mid)) return;
      this.seen.add(m.mid); this.seenQ.push(m.mid);
      if (this.seenQ.length > 500) this.seen.delete(this.seenQ.shift()!);
      const p = this.players.get(m.from); if (p) p.seen = Date.now();
      this.onMessage?.(m);
    } catch { /* ignore junk */ }
  }

  private prune() {
    const now = Date.now(); let changed = false;
    for (const [id, p] of this.players) if (now - p.seen > STALE_MS) { this.players.delete(id); changed = true; }
    if (changed) this.emit();
  }
  private emit() { this.onPlayers?.([...this.players.values()]); }

  private publishPresence(only?: MqttClient) {
    const body = JSON.stringify(this.me);
    for (const c of only ? [only] : this.clients) if (c.connected) c.publish(`${ROOT}/p/${this.id}`, body, { retain: true, qos: 1 });
  }

  setStatus(status: Status, mission?: string) { this.me = { ...this.me, status, mission }; this.publishPresence(); }
  setName(name: string) { this.me = { ...this.me, name: name.slice(0, 20) }; this.publishPresence(); }

  /** Direct message. `all` = through every broker (reliable signalling); otherwise the first connected (relay traffic). */
  send(to: string, msg: { t: string; [k: string]: unknown }, all = true) {
    const body = JSON.stringify({ ...msg, from: this.id, mid: rid(8) });
    const live = this.clients.filter(c => c.connected);
    for (const c of all ? live : live.slice(0, 1)) c.publish(`${ROOT}/i/${to}`, body, { qos: all ? 1 : 0 });
  }

  close() {
    this.timers.forEach(t => clearInterval(t)); this.timers = [];
    for (const c of this.clients) { if (c.connected) c.publish(`${ROOT}/p/${this.id}`, '', { retain: true, qos: 1 }); c.end(false); }
    this.clients = [];
  }
}
