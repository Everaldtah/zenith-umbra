import type { HeroDef, TeamId } from '../data/heroes';
import type { V3 } from '../engine/Physics';

export interface Input {
  mx: number; mz: number;          // local move: right / forward, -1..1
  jump: boolean; jumpHeld: boolean; descend: boolean;
  fire: boolean; alt: boolean; a1: boolean; a2: boolean; ult: boolean; reload: boolean;
  yaw: number; pitch: number;
}
export const emptyInput = (): Input => ({ mx: 0, mz: 0, jump: false, jumpHeld: false, descend: false, fire: false, alt: false, a1: false, a2: false, ult: false, reload: false, yaw: 0, pitch: 0 });

export interface Forced { vx: number; vy: number; vz: number; until: number; kind: string; ignoreGravity?: boolean; onEnd?: () => void; }
export interface Shield { amt: number; until: number; kind: string; }

let NEXT = 1;

export class Actor {
  readonly id = NEXT++;
  pos: V3 = { x: 0, y: 0, z: 0 };
  vel: V3 = { x: 0, y: 0, z: 0 };
  yaw = 0; pitch = 0;
  input: Input = emptyInput();
  hp: number; armor: number; maxArmor: number;
  shields: Shield[] = [];
  alive = true; respawnAt = 0; deathAt = 0;
  grounded = false; lastGroundedAt = 0; airJumps = 0; flying = false; flight = 100;
  st: Record<string, number> = {};        // status -> until (sim time)
  sv: Record<string, number> = {};        // status values
  src: Record<string, Actor | undefined> = {};
  cd: Record<string, number> = {};        // ability id -> ready at
  ammo: number; reloadUntil = 0; nextShot = 0; nextAlt = 0; charge = 0; charging = false;
  ult = 0;
  forced: Forced | null = null;
  barrier = { hp: 0, max: 0, up: false, regenAt: 0, brokenUntil: 0 };
  beamTarget: Actor | null = null; beamOn = false; flameOn = false;
  lastDamagedAt = -99; lastHitBy: Actor | null = null; lastHitAt = -99;
  scale = 1;
  // stats
  kills = 0; deaths = 0; dmgDone = 0; healDone = 0; assists = 0;
  // animation cues read by the renderer
  anim = { attackAt: -9, attackKind: 'primary' as string, castAt: -9, castId: '', hitAt: -9, jumpAt: -9, landAt: -9, stepPhase: 0 };
  isPlayer = false;
  isRobot = false;
  noRespawn = false;
  isBoss = false;
  netId = '';                 // co-op: which peer controls this actor ('' = local / AI)
  controller: { think(dt: number): void } | null = null;
  spawn: [number, number] = [0, 0];

  constructor(public def: HeroDef, public team: TeamId) {
    this.hp = def.hp;
    this.armor = this.maxArmor = def.armor;
    this.ammo = 'ammo' in def.primary && def.primary.ammo ? def.primary.ammo : 0;
    if (def.id === 'tenkai') this.barrier = { hp: 1400, max: 1400, up: false, regenAt: 0, brokenUntil: 0 };
  }

  get maxHp() { return this.def.hp + this.maxArmor; }
  get health() { return this.hp + this.armor; }
  get height() { return this.def.height * this.scale; }
  get radius() { return this.def.radius * this.scale; }
  get eye(): V3 { return { x: this.pos.x, y: this.pos.y + this.height * (this.def.frame === 'mech' ? 0.78 : 0.9), z: this.pos.z }; }
  get center(): V3 { return { x: this.pos.x, y: this.pos.y + this.height * 0.55, z: this.pos.z }; }
  get shieldAmt() { return this.shields.reduce((s, x) => s + x.amt, 0); }

  aimDir(): V3 {
    const cp = Math.cos(this.pitch);
    return { x: Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: Math.cos(this.yaw) * cp };
  }
  forward(): V3 { return { x: Math.sin(this.yaw), y: 0, z: Math.cos(this.yaw) }; }

  has(s: string, t: number) { return (this.st[s] ?? -1) > t; }
  set(s: string, t: number, dur: number, v?: number, src?: Actor) {
    this.st[s] = Math.max(this.st[s] ?? 0, t + dur);
    if (v !== undefined) this.sv[s] = v;
    if (src) this.src[s] = src;
  }
  clear(s: string) { delete this.st[s]; delete this.sv[s]; delete this.src[s]; }
  ready(id: string, t: number) { return (this.cd[id] ?? 0) <= t; }
  cdLeft(id: string, t: number) { return Math.max(0, (this.cd[id] ?? 0) - t); }
}
