// Peer-to-peer game link between two players: WebRTC data channels (signalled through the lobby).
// "rel" is ordered + reliable (events), "fast" is unordered with no retransmits (state snapshots).
// If a direct connection can't be made within a few seconds (strict NAT/firewall), traffic is relayed
// through the lobby's MQTT broker instead, and the link keeps trying to go direct in the background.
import type { Lobby } from './lobby';

export type LinkState = 'connecting' | 'p2p' | 'relay' | 'closed';
const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export class PeerLink {
  state: LinkState = 'connecting';
  rtt = 0;
  onMessage: ((m: any) => void) | null = null;
  onState: ((s: LinkState) => void) | null = null;
  private pc: RTCPeerConnection | null = null;
  private rel: RTCDataChannel | null = null;
  private fast: RTCDataChannel | null = null;
  private pending: RTCIceCandidateInit[] = [];
  private lastRecv = Date.now();
  private timers: number[] = [];

  constructor(private lobby: Lobby, readonly peer: string, readonly sid: string, readonly initiator: boolean, forceRelay = false) {
    if (!forceRelay && typeof RTCPeerConnection !== 'undefined') {
      try { this.setupRtc(); } catch { /* no WebRTC: relay only */ }
    }
    // no direct channel after 6 s -> relay through the broker (P2P may still come up later and take over)
    this.timers.push(window.setTimeout(() => { if (this.state === 'connecting') this.set('relay'); }, forceRelay ? 0 : 6000));
    this.timers.push(window.setInterval(() => {
      this.send({ t: '_ping', ts: performance.now() }, false);
      if (Date.now() - this.lastRecv > 12_000 && this.state !== 'closed') this.close();   // partner gone
    }, 1000));
  }

  private set(s: LinkState) { if (this.state !== s) { this.state = s; this.onState?.(s); } }

  private setupRtc() {
    const pc = this.pc = new RTCPeerConnection({ iceServers: ICE });
    pc.onicecandidate = e => { if (e.candidate) this.lobby.send(this.peer, { t: 'sig', sid: this.sid, cand: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' && this.state === 'p2p') this.set('relay'); };
    if (this.initiator) {
      this.wire(pc.createDataChannel('rel', { ordered: true }));
      this.wire(pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }));
      pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => this.lobby.send(this.peer, { t: 'sig', sid: this.sid, sdp: pc.localDescription!.toJSON() }));
    } else {
      pc.ondatachannel = e => this.wire(e.channel);
    }
  }

  private wire(ch: RTCDataChannel) {
    if (ch.label === 'rel') this.rel = ch; else this.fast = ch;
    ch.onopen = () => { if (this.rel?.readyState === 'open' && this.fast?.readyState === 'open') this.set('p2p'); };
    ch.onclose = () => { if (this.state === 'p2p') this.set('relay'); };
    ch.onmessage = e => this.receive(JSON.parse(e.data));
  }

  /** Signalling from the lobby for this session. */
  async handleSignal(m: { sdp?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit }) {
    const pc = this.pc; if (!pc) return;
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
  /** Relayed payload from the lobby. */
  handleRelay(d: any) { this.receive(d); }

  private receive(m: any) {
    this.lastRecv = Date.now();
    if (m.t === '_ping') { this.send({ t: '_pong', ts: m.ts }, false); return; }
    if (m.t === '_pong') { this.rtt = performance.now() - m.ts; return; }
    this.onMessage?.(m);
  }

  /** reliable: ordered events. Unreliable state goes on the fast channel (or is rate-limited on the relay). */
  send(msg: any, reliable = true) {
    if (this.state === 'closed') return;
    const ch = reliable ? this.rel : this.fast;
    if (ch && ch.readyState === 'open') { ch.send(JSON.stringify(msg)); return; }
    if (this.state === 'relay') this.lobby.send(this.peer, { t: 'relay', sid: this.sid, d: msg }, reliable);
  }
  get direct() { return this.state === 'p2p'; }

  close() {
    if (this.state === 'closed') return;
    this.timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    try { this.rel?.close(); this.fast?.close(); this.pc?.close(); } catch { /* ignore */ }
    this.set('closed');
  }
}
