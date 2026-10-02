// Fast Link: how good is a connection, and how much game state should go over it.
//  - LinkStats: round-trip time, jitter and loss of one peer link (binary pings on the unreliable channel), plus the
//    bytes actually sent / received and WebRTC's own bandwidth estimate (getStats availableOutgoingBitrate)
//  - tiers: the update rate a link gets (snapshots per second from the host, inputs per second to it). A link drops a
//    tier at once when it degrades (loss, latency spikes, a send queue building up) and climbs back only after it has
//    been clean for a while, so the rate doesn't flap
//  - speedTest(): ping / download / upload against the online node, turned into a host score (the matchmaker gives
//    the match to the player with the best uplink)

export type Tier = 'ultra' | 'high' | 'medium' | 'low' | 'relay';
export const TIERS: Tier[] = ['ultra', 'high', 'medium', 'low', 'relay'];
export interface TierSpec { label: string; snapHz: number; inputHz: number; color: string }
export const TIER: Record<Tier, TierSpec> = {
  ultra: { label: 'ULTRA', snapHz: 60, inputHz: 60, color: '#58ffb0' },
  high: { label: 'HIGH', snapHz: 40, inputHz: 60, color: '#9cff6b' },
  medium: { label: 'MEDIUM', snapHz: 30, inputHz: 40, color: '#ffd25a' },
  low: { label: 'LOW', snapHz: 20, inputHz: 30, color: '#ff9a4a' },
  relay: { label: 'RELAY', snapHz: 8, inputHz: 15, color: '#ff5d6d' },
};
export const tierCode = (t: Tier) => TIERS.indexOf(t);
export const tierOf = (c: number): Tier => TIERS[Math.max(0, Math.min(TIERS.length - 1, c | 0))];

/** the best tier a link's numbers allow (before hysteresis and bandwidth limits) */
export function classify(s: { rtt: number; jitter: number; loss: number; relay?: boolean }): Tier {
  if (s.relay) return 'relay';
  if (s.loss > 0.12 || s.rtt > 260 || s.jitter > 60) return 'low';
  if (s.loss > 0.05 || s.rtt > 150 || s.jitter > 30) return 'medium';
  if (s.loss > 0.015 || s.rtt > 80 || s.jitter > 14) return 'high';
  return 'ultra';
}

/** the fastest tier whose snapshot stream fits in `kbps` (bytes per snapshot known) */
export function fitTier(kbps: number, snapBytes: number, cap: Tier = 'ultra'): Tier {
  for (let i = tierCode(cap); i < TIERS.length - 1; i++) {
    const t = TIERS[i];
    if (TIER[t].snapHz * (snapBytes + 48) * 8 / 1000 <= kbps) return t;     // (+48: SCTP/DTLS/UDP/IP overhead)
  }
  return 'low';
}

export class LinkStats {
  rtt = 0; jitter = 0; loss = 0;
  /** measured send / receive rates (kbit/s, last second) */
  kbpsOut = 0; kbpsIn = 0;
  /** WebRTC's estimate of the bandwidth available toward the peer (kbit/s), 0 = unknown */
  availKbps = 0;
  /** how the bytes travel: same network, direct over the internet, a TURN relay, or the online node's relay */
  path: 'lan' | 'direct' | 'turn' | 'node' | '?' = '?';
  /** the send queue is backing up (the link can't keep up with the rate) */
  congested = false;
  private seq = 0;
  private sent = new Map<number, number>();       // ping seq -> sent at (ms)
  private window: boolean[] = [];                 // last pings: answered?
  private bytesOut = 0; private bytesIn = 0; private rateAt = 0;
  private samples = 0;

  /** the next ping to send: [seq, sentAtMs] */
  nextPing(now: number): number {
    const s = this.seq = (this.seq + 1) & 0xffff;
    this.sent.set(s, now);
    // pings older than 2 s are lost
    for (const [k, at] of this.sent) if (now - at > 2000) { this.sent.delete(k); this.push(false); }
    return s;
  }
  pong(seq: number, now: number) {
    const at = this.sent.get(seq); if (at === undefined) return;
    this.sent.delete(seq);
    const r = now - at;
    this.jitter = this.samples ? this.jitter + (Math.abs(r - this.rtt) - this.jitter) * 0.15 : 0;
    this.rtt = this.samples ? this.rtt + (r - this.rtt) * (r > this.rtt ? 0.25 : 0.1) : r;   // spikes count faster
    this.samples++;
    this.push(true);
  }
  private push(ok: boolean) {
    this.window.push(ok); if (this.window.length > 40) this.window.shift();
    this.loss = this.window.length >= 8 ? this.window.filter(x => !x).length / this.window.length : 0;
  }
  out(bytes: number) { this.bytesOut += bytes; }
  in(bytes: number) { this.bytesIn += bytes; }
  /** once a frame: roll the byte counters into rates */
  tick(now: number) {
    if (!this.rateAt) this.rateAt = now;
    const dt = now - this.rateAt;
    if (dt >= 1000) {
      this.kbpsOut = this.bytesOut * 8 / dt; this.kbpsIn = this.bytesIn * 8 / dt;
      this.bytesOut = this.bytesIn = 0; this.rateAt = now;
    }
  }
  get measured() { return this.samples >= 3; }
}

/** a link's update tier with hysteresis: down at once, up one step after `upAfter` ms of clean link */
export class AdaptiveTier {
  tier: Tier;
  private goodSince = 0;
  constructor(start: Tier = 'medium', public upAfter = 4000) { this.tier = start; }
  update(s: LinkStats, now: number, o: { relay: boolean; budgetKbps?: number; snapBytes?: number }): Tier {
    let want = classify({ rtt: s.rtt, jitter: s.jitter, loss: s.loss, relay: o.relay });
    if (o.budgetKbps && o.snapBytes) want = TIERS[Math.max(tierCode(want), tierCode(fitTier(o.budgetKbps, o.snapBytes)))];
    if (s.availKbps && o.snapBytes) want = TIERS[Math.max(tierCode(want), tierCode(fitTier(s.availKbps * 0.7, o.snapBytes)))];
    if (s.congested && !o.relay) want = TIERS[Math.min(TIERS.length - 2, Math.max(tierCode(want), tierCode(this.tier) + 1))];
    if (!s.measured && !o.relay) want = TIERS[Math.max(tierCode(want), tierCode('medium'))];
    const cur = tierCode(this.tier), w = tierCode(want);
    if (w > cur) { this.tier = want; this.goodSince = now; }                 // worse: drop now
    else if (w < cur) {
      if (now - this.goodSince > this.upAfter) { this.tier = TIERS[cur - 1]; this.goodSince = now; }   // better: one step at a time
    } else this.goodSince = Math.max(this.goodSince, now - this.upAfter / 2);
    return this.tier;
  }
}

// ---------------------------------------------------------------- connection test against the online node
export interface SpeedResult { rtt: number; jitter: number; downKbps: number; upKbps: number; score: number; tier: Tier; at: number }
const SPEED_KEY = 'zu-net-speed';
export function cachedSpeed(maxAgeMs = 15 * 60_000): SpeedResult | null {
  try { const s = JSON.parse(localStorage.getItem(SPEED_KEY) ?? 'null') as SpeedResult | null; return s && Date.now() - s.at < maxAgeMs ? s : null; } catch { return null; }
}
/**
 * The host score (0..1000): uplink matters most (the host streams the match to everyone), then latency to the node
 * (a stand-in for latency to the other players), then downlink, the desktop app and CPU cores.
 */
export function hostScore(r: { rtt: number; upKbps: number; downKbps: number }, desktop: boolean, cores = 4) {
  const up = Math.min(r.upKbps, 30000) / 30000 * 480, down = Math.min(r.downKbps, 60000) / 60000 * 120;
  const lat = Math.max(0, 250 - r.rtt) / 250 * 250;
  return Math.round(Math.max(0, Math.min(1000, up + down + lat + (desktop ? 100 : 0) + Math.min(50, cores * 4))));
}
export async function speedTest(url: string, desktop: boolean, onStep?: (s: string) => void): Promise<SpeedResult> {
  const t = () => performance.now();
  const sep = url.includes('?') ? '&' : '?';
  onStep?.('ping');
  const pings: number[] = [];
  for (let i = 0; i < 7; i++) {
    const t0 = t();
    try { await (await fetch(`${url}${sep}ping=1&n=${i}`, { cache: 'no-store' })).json(); pings.push(t() - t0); } catch { /* lost */ }
  }
  const ps = pings.slice(1).sort((a, b) => a - b);                  // (the first may pay for a cold start)
  const rtt = ps.length ? ps[Math.floor(ps.length / 2)] : 999;
  const jitter = ps.length > 1 ? ps.slice(1).reduce((s, x, i) => s + Math.abs(x - ps[i]), 0) / (ps.length - 1) : 0;
  onStep?.('download');
  let downKbps = 0;
  try {
    const n = 393216, t0 = t();
    const b = await (await fetch(`${url}${sep}bw=${n}`, { cache: 'no-store' })).arrayBuffer();
    downKbps = b.byteLength * 8 / Math.max(1, t() - t0 - rtt * 0.5);
  } catch { /* offline */ }
  onStep?.('upload');
  let upKbps = 0;
  try {
    const body = new Uint8Array(196608); crypto.getRandomValues(body.subarray(0, 65536)); body.set(body.subarray(0, 65536), 65536); body.set(body.subarray(0, 65536), 131072);
    const t0 = t();
    await (await fetch(`${url}${sep}bw=1`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body, cache: 'no-store' })).json();
    upKbps = body.byteLength * 8 / Math.max(1, t() - t0 - rtt * 0.5);
  } catch { /* offline */ }
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  const r: SpeedResult = { rtt: Math.round(rtt), jitter: Math.round(jitter), downKbps: Math.round(downKbps), upKbps: Math.round(upKbps), score: 0, tier: 'medium', at: Date.now() };
  r.score = hostScore(r, desktop, cores);
  // the tier you'd get as a client of a good host: latency + jitter to the node, and whether ~60 snapshots/s of
  // a full lobby (~1.4 KB each) fit in your downlink
  r.tier = TIERS[Math.max(tierCode(classify({ rtt: r.rtt, jitter: r.jitter, loss: 0 })), tierCode(fitTier(r.downKbps * 0.5, 1400)))];
  try { localStorage.setItem(SPEED_KEY, JSON.stringify(r)); } catch { /* ignore */ }
  return r;
}
