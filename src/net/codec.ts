// Fast Link wire format: compact binary packets for the per-tick traffic (host snapshots, client inputs, pings).
// Positions stay float32 (cm-exact on these maps); velocities, angles and vitals are quantised; everything that changes
// rarely (hero, statuses, animation cues, scores, zones, the objective) travels as JSON "cold state" inside the
// snapshot, and only until the client has acknowledged it (see FastSync).

export const PK_SNAP = 1, PK_INPUT = 2, PK_PING = 3, PK_PONG = 4;

export class Writer {
  buf: ArrayBuffer; dv: DataView; n = 0;
  constructor(size = 2048) { this.buf = new ArrayBuffer(size); this.dv = new DataView(this.buf); }
  private room(k: number) {
    if (this.n + k <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2; while (size < this.n + k) size *= 2;
    const nb = new ArrayBuffer(size); new Uint8Array(nb).set(new Uint8Array(this.buf, 0, this.n));
    this.buf = nb; this.dv = new DataView(nb);
  }
  reset() { this.n = 0; return this; }
  u8(v: number) { this.room(1); this.dv.setUint8(this.n, v & 0xff); this.n += 1; return this; }
  i8(v: number) { this.room(1); this.dv.setInt8(this.n, Math.max(-128, Math.min(127, Math.round(v)))); this.n += 1; return this; }
  u16(v: number) { this.room(2); this.dv.setUint16(this.n, Math.max(0, Math.min(0xffff, Math.round(v))), true); this.n += 2; return this; }
  i16(v: number) { this.room(2); this.dv.setInt16(this.n, Math.max(-32768, Math.min(32767, Math.round(v))), true); this.n += 2; return this; }
  u32(v: number) { this.room(4); this.dv.setUint32(this.n, v >>> 0, true); this.n += 4; return this; }
  f32(v: number) { this.room(4); this.dv.setFloat32(this.n, v, true); this.n += 4; return this; }
  bytes(b: Uint8Array) { this.room(b.length); new Uint8Array(this.buf, this.n, b.length).set(b); this.n += b.length; return this; }
  /** utf-8 with a u32 length (cold JSON can pass 64 KB on a match's first snapshot) */
  str(s: string) { const b = enc.encode(s); this.u32(b.length); return this.bytes(b); }
  /** a copy of what was written */
  done(): Uint8Array { return new Uint8Array(this.buf.slice(0, this.n)); }
  view(): Uint8Array { return new Uint8Array(this.buf, 0, this.n); }
}
const enc = new TextEncoder(), dec = new TextDecoder();

export class Reader {
  dv: DataView; n = 0;
  constructor(public u: Uint8Array) { this.dv = new DataView(u.buffer, u.byteOffset, u.byteLength); }
  get left() { return this.u.byteLength - this.n; }
  u8() { const v = this.dv.getUint8(this.n); this.n += 1; return v; }
  i8() { const v = this.dv.getInt8(this.n); this.n += 1; return v; }
  u16() { const v = this.dv.getUint16(this.n, true); this.n += 2; return v; }
  i16() { const v = this.dv.getInt16(this.n, true); this.n += 2; return v; }
  u32() { const v = this.dv.getUint32(this.n, true); this.n += 4; return v; }
  f32() { const v = this.dv.getFloat32(this.n, true); this.n += 4; return v; }
  str() { const len = this.u32(); const s = dec.decode(this.u.subarray(this.n, this.n + len)); this.n += len; return s; }
}

// ---------------------------------------------------------------- quantisation
const TAU = Math.PI * 2;
export const qYaw = (a: number) => Math.round(((a % TAU + TAU) % TAU) / TAU * 65535);
export const dqYaw = (q: number) => { const a = q / 65535 * TAU; return a > Math.PI ? a - TAU : a; };
/** shortest-way angle lerp */
export function lerpAngle(a: number, b: number, k: number) {
  let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
  return a + d * k;
}
/** sequence numbers wrap at 16 bits: is a newer than b? */
export const seqNewer = (a: number, b: number) => ((a - b) & 0xffff) !== 0 && ((a - b) & 0xffff) < 0x8000;

// ---------------------------------------------------------------- the actor's hot row (every snapshot)
export const AF_ALIVE = 1, AF_GROUNDED = 2, AF_FLYING = 4, AF_BARRIER = 8, AF_BEAM = 16, AF_FLAME = 32, AF_CHARGING = 64, AF_BOSS = 128;
export interface HotActor {
  id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; pitch: number;
  hp: number; armor: number; shield: number; bhp: number; flags: number; scale: number; beam: number;
}
export function writeActor(w: Writer, a: HotActor) {
  w.u16(a.id).f32(a.x).f32(a.y).f32(a.z).i16(a.vx * 100).i16(a.vy * 100).i16(a.vz * 100)
    .u16(qYaw(a.yaw)).i16(a.pitch * 10000).u16(a.hp).u16(a.armor).u16(a.shield).u16(a.bhp).u8(a.flags).u8(a.scale * 50).u16(a.beam);
}
export function readActor(r: Reader): HotActor {
  return { id: r.u16(), x: r.f32(), y: r.f32(), z: r.f32(), vx: r.i16() / 100, vy: r.i16() / 100, vz: r.i16() / 100,
    yaw: dqYaw(r.u16()), pitch: r.i16() / 10000, hp: r.u16(), armor: r.u16(), shield: r.u16(), bhp: r.u16(), flags: r.u8(), scale: r.u8() / 50, beam: r.u16() };
}
export const ACTOR_BYTES = 36;

export interface HotProj { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number }
export function writeProj(w: Writer, p: HotProj) { w.u32(p.id).f32(p.x).f32(p.y).f32(p.z).i16(p.vx * 50).i16(p.vy * 50).i16(p.vz * 50); }
export function readProj(r: Reader): HotProj { return { id: r.u32(), x: r.f32(), y: r.f32(), z: r.f32(), vx: r.i16() / 50, vy: r.i16() / 50, vz: r.i16() / 50 }; }

// ---------------------------------------------------------------- packets
export interface SnapHeader { seq: number; time: number; ackInput: number; tier: number; hostMs: number }
/**
 * SNAP: u8 type, u16 seq, f64-ish time (f32 seconds + u16 sub-ms is overkill: f32 is 0.1 ms at 25 min), u16 the last
 * input seq the host applied, u8 tier, u16 host ms (for the client's clock filter), then the shared hot block, then the
 * peer's cold JSON ('' = nothing new).
 */
export function writeSnapHeader(w: Writer, h: SnapHeader) { w.u8(PK_SNAP).u16(h.seq).f32(h.time).u16(h.ackInput).u8(h.tier).u16(h.hostMs & 0xffff); }
export function readSnapHeader(r: Reader): SnapHeader { r.u8(); return { seq: r.u16(), time: r.f32(), ackInput: r.u16(), tier: r.u8(), hostMs: r.u16() }; }

/** the part of a snapshot every peer gets: actors and projectiles */
export function writeHot(w: Writer, actors: HotActor[], projs: HotProj[]) {
  w.u8(Math.min(255, actors.length)); for (const a of actors.slice(0, 255)) writeActor(w, a);
  w.u16(Math.min(1024, projs.length)); for (const p of projs.slice(0, 1024)) writeProj(w, p);
}
export function readHot(r: Reader): { actors: HotActor[]; projs: HotProj[] } {
  const actors: HotActor[] = []; for (let i = r.u8(); i > 0; i--) actors.push(readActor(r));
  const projs: HotProj[] = []; for (let i = r.u16(); i > 0; i--) projs.push(readProj(r));
  return { actors, projs };
}

/** INPUT (client -> host, ~30-60 Hz, unreliable) */
export const IN_BITS = ['jump', 'jumpHeld', 'descend', 'fire', 'alt', 'a1', 'a2', 'ult', 'reload', 'melee', 'swoop', 'grind'] as const;
/** buttons whose presses must never be lost (a counter per button: the host latches every new press for one step) */
export const IN_EDGES = ['jump', 'fire', 'alt', 'a1', 'a2', 'ult', 'reload', 'melee', 'swoop'] as const;
export interface InputPacket { seq: number; ackSnap: number; yaw: number; pitch: number; mx: number; mz: number; held: number; presses: number[]; viewMs: number }
export function writeInput(w: Writer, p: InputPacket) {
  w.u8(PK_INPUT).u16(p.seq).u16(p.ackSnap).f32(p.yaw).f32(p.pitch).i8(p.mx * 100).i8(p.mz * 100).u16(p.held);
  for (let i = 0; i < IN_EDGES.length; i++) w.u8(p.presses[i] ?? 0);
  w.u16(p.viewMs);
}
export function readInput(r: Reader): InputPacket {
  r.u8();
  const p: InputPacket = { seq: r.u16(), ackSnap: r.u16(), yaw: r.f32(), pitch: r.f32(), mx: r.i8() / 100, mz: r.i8() / 100, held: r.u16(), presses: [], viewMs: 0 };
  for (let i = 0; i < IN_EDGES.length; i++) p.presses.push(r.u8());
  p.viewMs = r.u16();
  return p;
}

/** PING / PONG (both ways, 4 Hz, unreliable): u8 type, u16 seq */
export const pingPacket = (type: number, seq: number) => new Writer(4).u8(type).u16(seq).done();

// ---------------------------------------------------------------- base64 (binary through the node's JSON relay)
export function toB64(u: Uint8Array): string {
  let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(s: string): Uint8Array { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
