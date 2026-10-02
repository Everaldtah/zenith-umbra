// What the in-match sync (FastSync) needs from a network session - the campaign's Coop squad and the online PvP
// session both provide it.
import type { PeerLink } from './link';

export interface NetSession {
  /** this player's id on the lobby */
  readonly me: string;
  role: 'host' | 'client' | null;
  hostId: string;
  /** host: member id -> link; client: host id -> link */
  links: Map<string, PeerLink>;
  /** JSON from a peer (reliable events, roster, ...) */
  onMessage: ((from: string, m: any) => void) | null;
  /** binary from a peer (snapshots, inputs) */
  onBinary: ((from: string, u: Uint8Array) => void) | null;
  broadcast(m: any, reliable?: boolean): void;
  sendHost(m: any, reliable?: boolean): void;
}
