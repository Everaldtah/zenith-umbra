// Peer-to-peer game link between two players: WebRTC data channels (signalled through the lobby).
// "rel" is ordered + reliable (events, roster, chat), "fast" is unordered with no retransmits (snapshots, inputs, pings
// - binary, see codec.ts). The link measures itself (LinkStats: RTT, jitter, loss, WebRTC's bandwidth estimate, the
// path the bytes take, a backed-up send queue) so the session can pick each link's update rate (Fast Link tiers).
// If a direct connection can't be made within a few seconds (strict NAT/firewall), traffic is relayed through the
// lobby (the online node) instead, and the link keeps trying to go direct in the background. TURN servers, when the
// node is configured with them, come in through the ICE list (/api/net?ice=1).
import { LinkStats } from './quality';
import { PK_PING, PK_PONG, pingPacket, toB64, fromB64 } from './codec';

/** anything that can deliver a lobby message to a peer (MQTT lobby or the Vercel node) */
export interface Signaller { send(to: string, msg: { t: string; [k: string]: unknown }, reliable?: boolean): void; }

export type LinkState = 'connecting' | 'p2p' | 'relay' | 'closed';
const DEFAULT_ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
let iceList: Promise<RTCIceServer[]> | null = null;
/** the ICE servers (STUN + any TURN the node hands out), fetched once */
export function iceServers(nodeUrl?: string): Promise<RTCIceServer[]> {
  if (!nodeUrl) return Promise.resolve(DEFAULT_ICE);
  iceList ??= fetch(`${nodeUrl}${nodeUrl.includes('?') ? '&' : '?'}ice=1`, { cache: 'no-store' })
    .then(r => r.json()).then(j => (Array.isArray(j.iceServers) && j.iceServers.length ? j.iceServers : DEFAULT_ICE))
    .catch(() => { iceList = null; return DEFAULT_ICE; });
  return iceList;
}
/** the send queue above which a fast-channel packet is dropped instead of queued (the link is congested) */
const CONGESTED = 96 * 1024;

export class PeerLink {
  state: LinkState = 'connecting';
  stats = new LinkStats();
  onMessage: ((m: any) => void) | null = null;
  onBinary: ((u: Uint8Array) => void) | null = null;
  onState: ((s: LinkState) => void) | null = null;
  private pc: RTCPeerConnection | null = null;
  private rel: RTCDataChannel | null = null;
  private fast: RTCDataChannel | null = null;
  private pending: RTCIceCandidateInit[] = [];
  private lastRecv = Date.now();
  private timers: number[] = [];
  private pingAt = 0;

  constructor(private lobby: Signaller, readonly peer: string, readonly sid: string, readonly initiator: boolean, o: { forceRelay?: boolean; nodeUrl?: string } = {}) {
    if (!o.forceRelay && typeof RTCPeerConnection !== 'undefined') {
      iceServers(o.nodeUrl).then(ice => { if (this.state !== 'closed') try { this.setupRtc(ice); } catch { /* no WebRTC: relay only */ } });
    }
    // no direct channel after 6 s -> relay through the node (P2P may still come up later and take over)
    this.timers.push(window.setTimeout(() => { if (this.state === 'connecting') this.set('relay'); }, o.forceRelay ? 0 : 6000));
    this.timers.push(window.setInterval(() => this.tick(), 50));
    this.timers.push(window.setInterval(() => this.sampleRtc(), 2000));
  }
  /** round trip in ms (kept for older callers) */
  get rtt() { return this.stats.rtt; }
  get direct() { return this.state === 'p2p'; }

  private set(s: LinkState) {
    if (this.state === s) return;
    this.state = s; this.stats.path = s === 'relay' ? 'node' : this.stats.path === 'node' ? '?' : this.stats.path;
    this.onState?.(s);
  }

  private tick() {
    const now = performance.now();
    this.stats.tick(now);
    // pings: 4 Hz direct, 1 Hz through the node
    if (now - this.pingAt > (this.direct ? 250 : 1000) && this.state !== 'connecting') {
      this.pingAt = now;
      this.sendBin(pingPacket(PK_PING, this.stats.nextPing(now)));
    }
    if (Date.now() - this.lastRecv > 12_000 && this.state !== 'closed' && this.state !== 'connecting') this.close();   // partner gone
    if (this.state === 'connecting' && Date.now() - this.lastRecv > 30_000) this.close();
  }

  private setupRtc(ice: RTCIceServer[]) {
    const pc = this.pc = new RTCPeerConnection({ iceServers: ice });
    pc.onicecandidate = e => { if (e.candidate) this.lobby.send(this.peer, { t: 'sig', sid: this.sid, cand: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' && this.state === 'p2p') this.set('relay'); };
    if (this.initiator) {
      this.wire(pc.createDataChannel('rel', { ordered: true }));
      this.wire(pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }));
      pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => this.lobby.send(this.peer, { t: 'sig', sid: this.sid, sdp: pc.localDescription!.toJSON() }));
    } else {
      pc.ondatachannel = e => this.wire(e.channel);
    }
    for (const c of this.pending.splice(0)) if (pc.remoteDescription) pc.addIceCandidate(c).catch(() => {});
  }

  private wire(ch: RTCDataChannel) {
    ch.binaryType = 'arraybuffer';
    if (ch.label === 'rel') this.rel = ch; else this.fast = ch;
    ch.onopen = () => { if (this.rel?.readyState === 'open' && this.fast?.readyState === 'open') { this.set('p2p'); this.sampleRtc(); } };
    ch.onclose = () => { if (this.state === 'p2p') this.set('relay'); };
    ch.onmessage = e => {
      if (typeof e.data === 'string') { this.stats.in(e.data.length); this.receive(JSON.parse(e.data)); }
      else { const u = new Uint8Array(e.data as ArrayBuffer); this.stats.in(u.byteLength); this.receiveBin(u); }
    };
  }

  /** WebRTC's own view: the selected candidate pair's RTT, the bandwidth estimate, and the path type */
  private async sampleRtc() {
    const pc = this.pc; if (!pc || this.state !== 'p2p') return;
    try {
      const rep = await pc.getStats();
      let pair: any = null;
      rep.forEach((r: any) => { if (r.type === 'candidate-pair' && (r.nominated || r.selected) && r.state === 'succeeded') pair = pair && pair.bytesSent > r.bytesSent ? pair : r; });
      if (!pair) return;
      if (pair.availableOutgoingBitrate) this.stats.availKbps = pair.availableOutgoingBitrate / 1000;
      const lc: any = rep.get(pair.localCandidateId), rc: any = rep.get(pair.remoteCandidateId);
      const kinds = [lc?.candidateType, rc?.candidateType];
      this.stats.path = kinds.includes('relay') ? 'turn' : kinds.every(k => k === 'host') ? 'lan' : 'direct';
    } catch { /* stats are best-effort */ }
  }

  /** Signalling from the lobby for this session. */
  async handleSignal(m: { sdp?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit }) {
    this.lastRecv = Date.now();
    const pc = this.pc;
    if (!pc) { if (m.cand) this.pending.push(m.cand); else if (m.sdp) window.setTimeout(() => this.handleSignal(m), 150); return; }
    try {
      if (m.sdp) {
        await pc.setRemoteDescription(m.sdp);
        for (const c of this.pending.splice(0)) await pc.addIceCandidate(c);
        if (m.sdp.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          this.lobby.send(this.peer, { t: 'sig', sid: this.sid, sdp: pc.localDescription!.toJSON() });
        }
      } else if (m.cand) {
        if (pc.remoteDescription) await pc.addIceCandidate(m.cand); else this.pending.push(m.cand);
      }
    } catch { /* a bad candidate is not fatal */ }
  }
  /** Relayed payload from the lobby (JSON, or binary as base64). */
  handleRelay(m: { d?: any; b?: string }) {
    if (typeof m.b === 'string') { const u = fromB64(m.b); this.stats.in(u.byteLength); this.receiveBin(u); }
    else if (m.d !== undefined) this.receive(m.d);
  }

  private receive(m: any) {
    this.lastRecv = Date.now();
    if (m.t === '_ping' || m.t === '_pong') return;          // (older builds' JSON pings)
    this.onMessage?.(m);
  }
  private receiveBin(u: Uint8Array) {
    this.lastRecv = Date.now();
    if (u[0] === PK_PING) { this.sendBin(pingPacket(PK_PONG, u[1] | (u[2] << 8))); return; }
    if (u[0] === PK_PONG) { this.stats.pong(u[1] | (u[2] << 8), performance.now()); return; }
    this.onBinary?.(u);
  }

  /** reliable: ordered JSON events. */
  send(msg: any, reliable = true) {
    if (this.state === 'closed') return;
    const ch = reliable ? this.rel : this.fast;
    if (ch && ch.readyState === 'open') { const s = JSON.stringify(msg); this.stats.out(s.length); ch.send(s); return; }
    if (this.state === 'relay') this.lobby.send(this.peer, { t: 'relay', sid: this.sid, d: msg }, reliable);
  }
  /**
   * Binary on the fast channel (or reliable). Returns false when the packet was dropped because the send queue is
   * backed up - the caller's rate is too high for this link right now.
   */
  sendBin(u: Uint8Array, reliable = false): boolean {
    if (this.state === 'closed') return false;
    const ch = reliable ? this.rel : this.fast;
    if (ch && ch.readyState === 'open') {
      this.stats.congested = ch.bufferedAmount > CONGESTED;
      if (this.stats.congested && !reliable) return false;
      this.stats.out(u.byteLength + 28);
      ch.send(u as Uint8Array<ArrayBuffer>);
      return true;
    }
    if (this.state === 'relay') { this.stats.out(u.byteLength); this.lobby.send(this.peer, { t: 'relay', sid: this.sid, b: toB64(u) }, reliable); return true; }
    return false;
  }

  close() {
    if (this.state === 'closed') return;
    this.timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    try { this.rel?.close(); this.fast?.close(); this.pc?.close(); } catch { /* ignore */ }
    this.set('closed');
  }
}
