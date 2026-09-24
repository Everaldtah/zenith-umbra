// Host-authoritative replication for co-op. Host: serialise world state at 20 Hz + forward events every step.
// Client: mirror actors/projectiles/zones from snapshots, predict its own movement, and send input to the host.
import type { World, GameEvent, Proj, Zone } from '../game/World';
import type { Actor, Input } from '../game/Actor';
import type { Coop } from './Coop';
import { HERO, PILOT_BY_ID } from '../data/heroes';

const ST = ['stun', 'root', 'silence', 'grounded', 'antiheal', 'brand', 'bleed', 'tethered', 'linked', 'ccimmune', 'stealth', 'revealed', 'sealed', 'undying', 'dmgamp', 'vuln', 'judgment', 'asura', 'lifesteal', 'parry', 'phased', 'spawnprot', 'hot', 'marked', 'glide', 'speed', 'slow'];
const r2 = (v: number) => Math.round(v * 100) / 100;

function packEvent(e: GameEvent): any {
  const o: any = { ...e };
  for (const k of ['actor', 'target', 'src', 'tgt']) if (o[k]) o[k] = (o[k] as Actor).id;
  return o;
}

// ------------------------------------------------------------------ host
export class HostSync {
  private tick = 0;
  events: any[] = [];
  constructor(public w: World, public coop: Coop) {
    coop.onMessage = (from, m) => {
      if (m.t !== 'in') return;
      const a = w.actors.find(x => x.netId === from);
      if (a) Object.assign(a.input, m.i as Input);
    };
  }
  /** call once per sim step with that step's events (before the local game consumes them) */
  capture(ev: GameEvent[]) { for (const e of ev) if (e.t !== 'sfx' || e.id !== 'step') this.events.push(packEvent(e)); }
  /** call once per rendered frame */
  flush() {
    if (!this.coop.links.size) { this.events.length = 0; return; }
    if (this.events.length) { this.coop.broadcast({ t: 'ev', e: this.events }); this.events = []; }
    // 20 Hz to peers on a direct WebRTC link; ~6 Hz to peers relayed through the Vercel node
    const t = ++this.tick;
    if (t % 3) return;
    let snap: any = null;
    for (const l of this.coop.links.values()) {
      if (!l.direct && t % 9) continue;
      snap ??= snapshot(this.w);
      l.send(snap, false);
    }
  }
}

export function snapshot(w: World) {
  const t = w.time;
  const d = w.director as any;
  return {
    t: 'snap', time: r2(t),
    a: w.actors.map(a => {
      const st: Record<string, number> = {};
      for (const s of ST) if (a.has(s, t)) st[s] = r2(a.st[s] - t);
      const net = !!a.netId;
      return [a.id, a.def.id, a.team, r2(a.pos.x), r2(a.pos.y), r2(a.pos.z), r2(a.vel.x), r2(a.vel.y), r2(a.vel.z), r2(a.yaw), r2(a.pitch),
        Math.round(a.hp), Math.round(a.armor), Math.round(a.shieldAmt), a.alive ? 1 : 0, r2(a.deathAt),
        (a.grounded ? 1 : 0) | (a.flying ? 2 : 0) | (a.barrier.up ? 4 : 0) | (a.beamOn ? 8 : 0) | (a.flameOn ? 16 : 0) | (a.charging ? 32 : 0) | (a.isBoss ? 64 : 0),
        a.beamTarget?.id ?? 0, r2(a.scale), Math.round(a.barrier.hp), st,
        [r2(a.anim.attackAt), a.anim.attackKind, r2(a.anim.castAt), a.anim.castId, r2(a.anim.hitAt), r2(a.anim.landAt), r2(a.anim.jumpAt)],
        a.netId, net ? { ult: Math.round(a.ult), ammo: a.ammo, rl: r2(a.reloadUntil), cd: a.cd, fl: Math.round(a.flight), ch: r2(a.charge), sv: { zoom: a.sv.zoom ?? 0 } } : 0,
        a.kills, a.deaths, a.assists, Math.round(a.dmgDone), Math.round(a.healDone), a.respawnAt ? r2(a.respawnAt) : 0];
    }),
    p: w.projs.map(p => [p.id, p.fx, r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.vel.x), r2(p.vel.y), r2(p.vel.z), p.heal ? 1 : 0, p.splash, p.owner.id]),
    z: w.zones.map(z => [z.id, z.kind, z.team, r2(z.x), r2(z.y), r2(z.z), z.r, r2(z.born), r2(z.until), z.kind === 'tele' ? z.data : z.kind === 'tether' ? { target: z.data?.target?.id } : null, z.owner.id]),
    d: d ? { state: d.state, obj: d.objective, boss: d.boss?.id ?? 0, lvl: d.level.id } : null,
    win: w.winner,
  };
}

// ------------------------------------------------------------------ client
export class ClientSync {
  map = new Map<number, Actor>();
  last: any = null;
  me: Actor | null = null;
  fakeDirector: any = null;
  private sendT = 0;
  constructor(public w: World, public coop: Coop, public onEvent: (e: GameEvent) => void, levelDef: any) {
    this.fakeDirector = { state: 'explore', objective: '', boss: null, level: levelDef, events: [] as any[], update() { /* host drives */ } };
    w.director = this.fakeDirector;
    coop.onMessage = (_from, m) => {
      if (m.t === 'snap') this.last = m;
      else if (m.t === 'ev') for (const e of m.e) this.event(e);
    };
  }
  private actor(id: number) { return this.map.get(id) ?? null; }
  private event(e: any) {
    for (const k of ['actor', 'target', 'src', 'tgt']) if (typeof e[k] === 'number') e[k] = this.actor(e[k]);
    if ((e.t === 'dmg' || e.t === 'kill') && !e.tgt) return;
    if (e.t === 'counter' && (!e.actor || !e.target)) return;
    this.onEvent(e as GameEvent);
  }

  /** apply the newest snapshot; returns true on the first snapshot (world became ready) */
  apply(dt: number, myInput: Input | null): void {
    const w = this.w, s = this.last;
    // send input at ~30 Hz
    this.sendT += dt;
    if (myInput && this.sendT > 1 / 30) { this.sendT = 0; this.coop.sendHost({ t: 'in', i: myInput }, false); }
    if (!s) return;
    this.last = null;
    w.time = s.time;
    const seen = new Set<number>();
    for (const r of s.a) {
      const [id, defId, team, x, y, z, vx, vy, vz, yaw, pitch, hp, armor, shield, alive, deathAt, flags, beamT, scale, bhp, st, an, netId, own, k, dth, as, dmg, heal, respawnAt] = r;
      seen.add(id);
      let a = this.map.get(id);
      if (!a) {
        a = w.addHero(defId, team);
        a.controller = null; a.noRespawn = true; a.isBoss = !!(flags & 64);
        if (a.isBoss) { a.hp = hp; (a.def as any) = { ...a.def, hp: Math.max(hp, a.def.hp) }; }
        this.map.set(id, a);
        a.pos = { x, y, z };
      }
      // mech destroyed / called back on the host: follow the hero swap (Tenkai-Oh <-> Haruto on foot)
      if (a.def.id !== defId) { const nd = HERO[defId] ?? PILOT_BY_ID[defId] ?? w.extraDefs[defId]; if (nd) a.def = nd; }
      const mine = netId === this.coop.me;
      if (mine) {
        this.me = a; a.isPlayer = true;
        // prediction reconcile: snap if far off, otherwise ease toward the host
        const ex = x - a.pos.x, ey = y - a.pos.y, ez = z - a.pos.z, err = Math.hypot(ex, ey, ez);
        if (err > 2.5 || !alive) a.pos = { x, y, z };
        else { a.pos.x += ex * 0.15; a.pos.y += ey * 0.15; a.pos.z += ez * 0.15; }
        if (own) { a.ult = own.ult; a.ammo = own.ammo; a.reloadUntil = own.rl; a.cd = own.cd; a.flight = own.fl; a.charge = own.ch; a.sv.zoom = own.sv.zoom; }
      } else {
        a.pos = { x, y, z }; a.yaw = yaw; a.pitch = pitch; a.vel = { x: vx, y: vy, z: vz };
        a.input.yaw = yaw; a.input.pitch = pitch;
      }
      if (!mine) { a.grounded = !!(flags & 1); a.flying = !!(flags & 2); }
      a.hp = hp; a.armor = armor; a.shields = shield > 0 ? [{ amt: shield, until: s.time + 1, kind: 'net' }] : [];
      a.alive = !!alive; a.deathAt = deathAt; a.scale = scale; a.barrier.up = !!(flags & 4); a.barrier.hp = bhp;
      a.beamOn = !!(flags & 8); a.flameOn = !!(flags & 16); a.charging = !!(flags & 32);
      a.beamTarget = beamT ? this.map.get(beamT) ?? null : null;
      a.st = {}; for (const [n, left] of Object.entries(st as Record<string, number>)) a.st[n] = s.time + left;
      [a.anim.attackAt, a.anim.attackKind, a.anim.castAt, a.anim.castId, a.anim.hitAt, a.anim.landAt, a.anim.jumpAt] = an;
      a.kills = k; a.deaths = dth; a.assists = as; a.dmgDone = dmg; a.healDone = heal; a.respawnAt = respawnAt;
    }
    w.actors = w.actors.filter(a => { const id = [...this.map.entries()].find(([, v]) => v === a)?.[0]; if (id !== undefined && !seen.has(id)) { this.map.delete(id); return false; } return true; });
    // projectiles & zones are plain mirrors
    w.projs = s.p.map((p: any) => ({ id: p[0], fx: p[1], pos: { x: p[2], y: p[3], z: p[4] }, vel: { x: p[5], y: p[6], z: p[7] }, heal: !!p[8], splash: p[9], owner: this.map.get(p[10]) ?? w.actors[0], team: 'umbra', dmg: 0, life: 1, r: 0.1, grav: 0, crit: 1, hits: new Set(), born: s.time }) as Proj);
    w.zones = s.z.map((z: any) => ({ id: z[0], kind: z[1], team: z[2], x: z[3], y: z[4], z: z[5], r: z[6], born: z[7], until: z[8], next: 0, data: z[1] === 'tether' ? { target: this.map.get(z[9]?.target) } : z[9], owner: this.map.get(z[10]) ?? w.actors[0] }) as Zone);
    if (s.d) { const fd = this.fakeDirector; fd.state = s.d.state; fd.objective = s.d.obj; fd.boss = s.d.boss ? this.map.get(s.d.boss) ?? null : null; }
    if (s.win && !w.winner) w.winner = s.win;
  }
}
