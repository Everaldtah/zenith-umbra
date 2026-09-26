// STADIUM - the third-person, round-based mode (after Overwatch 2's Stadium): first team to 4 round wins takes the
// match. Between rounds every hero shops in the Armory with the cash they earned (damage, healing, eliminations,
// assists, round result): stat ITEMS in three categories and three tiers (6 slots), and one hero POWER at the start of
// rounds 1, 3, 5 and 7 - each power upgrades a piece of that hero's own kit.
//
// Items and powers only ever change the actor's `mods` (see Mods below); World / weapons / abilities read them.
// Outside Stadium every mod is zero, so no other mode changes.
import { HERO, isAbility, type HeroDef, type TeamId } from '../data/heroes';
import type { Actor } from './Actor';
import type { World } from './World';

export interface Mods {
  weapon: number;      // weapon damage + weapon healing (fraction)
  ability: number;     // ability damage + ability healing
  atkspd: number;      // weapon fire rate
  cdr: number;         // all ability cooldowns (fraction removed)
  speed: number;       // move speed
  armor: number;       // bonus armor (points)
  lifesteal: number;   // fraction of damage dealt returned as health
  reload: number;      // reload speed
  ammo: number;        // magazine size
  ultgain: number;     // ultimate charge rate
  healing: number;     // healing dealt
  /** per-ability cooldown reduction (hero powers) */
  cdrBy: Record<string, number>;
}
export const noMods = (): Mods => ({ weapon: 0, ability: 0, atkspd: 0, cdr: 0, speed: 0, armor: 0, lifesteal: 0, reload: 0, ammo: 0, ultgain: 0, healing: 0, cdrBy: {} });

export type Tier = 'common' | 'rare' | 'epic';
export type Cat = 'weapon' | 'ability' | 'survival';
export interface Item { id: string; name: string; cat: Cat; tier: Tier; cost: number; mods: Partial<Omit<Mods, 'cdrBy'>>; desc: string; }

/** the Armory stock (original names; tiers roughly x1 / x3.5 / x8 in price and power) */
export const ITEMS: Item[] = [
  // ---- weapon
  { id: 'honed_edge', name: 'Honed Edge', cat: 'weapon', tier: 'common', cost: 1000, mods: { weapon: 0.05 }, desc: '+5% Weapon Power' },
  { id: 'quickdraw_grip', name: 'Quickdraw Grip', cat: 'weapon', tier: 'common', cost: 1000, mods: { atkspd: 0.05, reload: 0.15 }, desc: '+5% Attack Speed, +15% Reload Speed' },
  { id: 'deep_magazine', name: 'Deep Magazine', cat: 'weapon', tier: 'common', cost: 1000, mods: { ammo: 0.25, weapon: 0.02 }, desc: '+25% Max Ammo, +2% Weapon Power' },
  { id: 'sunforged_barrel', name: 'Sunforged Barrel', cat: 'weapon', tier: 'rare', cost: 3750, mods: { weapon: 0.12, atkspd: 0.05 }, desc: '+12% Weapon Power, +5% Attack Speed' },
  { id: 'bloodthirst_sigil', name: 'Bloodthirst Sigil', cat: 'weapon', tier: 'rare', cost: 4000, mods: { weapon: 0.08, lifesteal: 0.12 }, desc: '+8% Weapon Power, +12% Life Steal' },
  { id: 'eclipse_trigger', name: 'Eclipse Trigger', cat: 'weapon', tier: 'epic', cost: 9500, mods: { weapon: 0.2, atkspd: 0.12, ammo: 0.2 }, desc: '+20% Weapon Power, +12% Attack Speed, +20% Max Ammo' },
  // ---- ability
  { id: 'focus_charm', name: 'Focus Charm', cat: 'ability', tier: 'common', cost: 1000, mods: { ability: 0.05, ultgain: 0.05 }, desc: '+5% Ability Power, +5% Ultimate Charge' },
  { id: 'clockwork_heart', name: 'Clockwork Heart', cat: 'ability', tier: 'common', cost: 1250, mods: { cdr: 0.06 }, desc: '-6% Ability Cooldowns' },
  { id: 'starlit_rosary', name: 'Starlit Rosary', cat: 'ability', tier: 'rare', cost: 4000, mods: { ability: 0.12, healing: 0.1 }, desc: '+12% Ability Power, +10% Healing' },
  { id: 'rift_capacitor', name: 'Rift Capacitor', cat: 'ability', tier: 'rare', cost: 4000, mods: { cdr: 0.12, ultgain: 0.1 }, desc: '-12% Ability Cooldowns, +10% Ultimate Charge' },
  { id: 'crown_of_dawn', name: 'Crown of Dawn', cat: 'ability', tier: 'epic', cost: 10000, mods: { ability: 0.25, cdr: 0.1, ultgain: 0.15 }, desc: '+25% Ability Power, -10% Cooldowns, +15% Ultimate Charge' },
  // ---- survival
  { id: 'padded_plating', name: 'Padded Plating', cat: 'survival', tier: 'common', cost: 1000, mods: { armor: 25 }, desc: '+25 Armor' },
  { id: 'runner_soles', name: 'Runner Soles', cat: 'survival', tier: 'common', cost: 1000, mods: { speed: 0.05, armor: 10 }, desc: '+5% Move Speed, +10 Armor' },
  { id: 'medic_satchel', name: 'Medic Satchel', cat: 'survival', tier: 'common', cost: 1250, mods: { healing: 0.1 }, desc: '+10% Healing' },
  { id: 'aegis_weave', name: 'Aegis Weave', cat: 'survival', tier: 'rare', cost: 4000, mods: { armor: 75, speed: 0.03 }, desc: '+75 Armor, +3% Move Speed' },
  { id: 'vampiric_mantle', name: 'Vampiric Mantle', cat: 'survival', tier: 'rare', cost: 4500, mods: { armor: 40, lifesteal: 0.1 }, desc: '+40 Armor, +10% Life Steal' },
  { id: 'colossus_core', name: 'Colossus Core', cat: 'survival', tier: 'epic', cost: 10000, mods: { armor: 150, speed: 0.06, healing: 0.1 }, desc: '+150 Armor, +6% Move Speed, +10% Healing' },
];
export const ITEM: Record<string, Item> = Object.fromEntries(ITEMS.map(i => [i.id, i]));
export const MAX_ITEMS = 6;

export interface Power { id: string; name: string; desc: string; apply(m: Mods): void; }

/** six powers per hero, each one built from a piece of that hero's kit; a hero picks four over a match */
export function powersFor(def: HeroDef): Power[] {
  const p = def.primary, S = def.secondary, a1 = def.ability1, a2 = def.ability2, u = def.ult;
  const pname = p.name ?? (p.kind === 'melee' ? 'Blade' : p.kind === 'beam' ? 'Stream' : p.kind === 'charge' ? 'Bow' : 'Weapon');
  const out: Power[] = [
    { id: `${def.id}_a1`, name: `${a1.name}: Overclock`, desc: `${a1.name} recharges 35% faster and hits 15% harder.`, apply: m => { m.cdrBy[a1.id] = (m.cdrBy[a1.id] ?? 0) + 0.35; m.ability += 0.15; } },
    { id: `${def.id}_a2`, name: `${a2.name}: Amplified`, desc: `${a2.name} recharges 25% faster; abilities gain 20% power.`, apply: m => { m.cdrBy[a2.id] = (m.cdrBy[a2.id] ?? 0) + 0.25; m.ability += 0.2; } },
    { id: `${def.id}_ult`, name: `${u.name}: Resonance`, desc: `${u.name} charges 35% faster.`, apply: m => { m.ultgain += 0.35; } },
    { id: `${def.id}_wpn`, name: `${pname}: Signature`, desc: `${pname} deals 15% more damage and fires 10% faster.`, apply: m => { m.weapon += 0.15; m.atkspd += 0.1; } },
    { id: `${def.id}_guard`, name: def.role === 'tank' ? 'Unbreakable Frame' : def.role === 'support' ? 'Guardian Grace' : 'Killer Instinct',
      desc: def.role === 'tank' ? '+150 Armor and 10% Life Steal.' : def.role === 'support' ? '+25% Healing and +50 Armor.' : '+10% Weapon Power and 15% Life Steal.',
      apply: m => { if (def.role === 'tank') { m.armor += 150; m.lifesteal += 0.1; } else if (def.role === 'support') { m.healing += 0.25; m.armor += 50; } else { m.weapon += 0.1; m.lifesteal += 0.15; } } },
    { id: `${def.id}_move`, name: isAbility(S) ? `${S.name}: Momentum` : 'Momentum', desc: '+10% Move Speed, +30% Reload Speed, -10% Cooldowns.', apply: m => { m.speed += 0.1; m.reload += 0.3; m.cdr += 0.1; } },
  ];
  return out;
}

/** recompute an actor's mods from what it owns */
export function recalc(a: Actor) {
  const m = noMods();
  for (const id of a.items) {
    const it = ITEM[id]; if (!it) continue;
    for (const [k, v] of Object.entries(it.mods) as [keyof Omit<Mods, 'cdrBy'>, number][]) m[k] += v;
  }
  const P = powersFor(a.baseDef);
  for (const id of a.powers) P.find(p => p.id === id)?.apply(m);
  m.cdr = Math.min(0.5, m.cdr);
  a.mods = m;
  // bought between rounds: the armor and the bigger magazine are there for the next round straight away
  a.maxArmor = a.def.armor + m.armor; a.armor = a.maxArmor;
  if (!a.reloadUntil) a.ammo = a.maxAmmo;
}

// ---------------------------------------------------------------- the match flow
export const ROUNDS_TO_WIN = 4;
export const ARMORY_SECS = 25;
export const FIRST_ARMORY_SECS = 35;
export const ROUND_SECS = 120;
export const POWER_ROUNDS = [1, 3, 5, 7];
export const START_CASH = 3500;

export type Phase = 'armory' | 'fight' | 'over';

export class Stadium {
  round = 1;
  wins: Record<TeamId, number> = { zenith: 0, umbra: 0 };
  phase: Phase = 'armory';
  phaseEnd: number;
  roundStart = 0;
  lastRound: { winner: TeamId; reason: string } | null = null;
  /** humans who pressed READY in the Armory (the phase ends early once all are ready) */
  ready = new Set<number>();
  private base = new Map<number, { dmg: number; heal: number; kills: number; assists: number }>();

  constructor(public w: World) {
    for (const a of w.actors) { a.cash = START_CASH; recalc(a); }
    this.phaseEnd = w.time + FIRST_ARMORY_SECS;
    this.snapshot();
  }

  get isPowerRound() { return POWER_ROUNDS.includes(this.round); }
  /** can this actor pick a power right now? */
  powerPending(a: Actor) { return this.phase === 'armory' && this.isPowerRound && a.powers.length < POWER_ROUNDS.indexOf(this.round) + 1; }

  buy(a: Actor, id: string): boolean {
    const it = ITEM[id];
    if (!it || this.phase !== 'armory' || a.cash < it.cost || a.items.length >= MAX_ITEMS || a.items.includes(id)) return false;
    a.cash -= it.cost; a.items.push(id); recalc(a); this.w.sfx('ui_buy', a.pos, a);
    return true;
  }
  sell(a: Actor, id: string): boolean {
    const i = a.items.indexOf(id);
    if (i < 0 || this.phase !== 'armory') return false;
    a.items.splice(i, 1); a.cash += ITEM[id].cost; recalc(a);
    return true;
  }
  pickPower(a: Actor, id: string): boolean {
    if (!this.powerPending(a) || a.powers.includes(id) || !powersFor(a.baseDef).some(p => p.id === id)) return false;
    a.powers.push(id); recalc(a); this.w.sfx('ult_ready', a.pos, a);
    return true;
  }
  setReady(a: Actor) { this.ready.add(a.id); }

  /** frozen at spawn while the teams shop */
  get frozen() { return this.phase !== 'fight'; }

  update(dt: number) {
    const w = this.w, t = w.time;
    if (this.phase === 'armory') {
      for (const a of w.actors) if (!a.isPlayer && !a.netId) botShop(this, a);
      const humans = w.actors.filter(a => a.isPlayer);
      if (humans.length && humans.every(h => this.ready.has(h.id) && !this.powerPending(h))) this.phaseEnd = Math.min(this.phaseEnd, t + 3);
      if (t >= this.phaseEnd) this.startRound();
      return;
    }
    if (this.phase !== 'fight') return;
    this.updatePoint(dt);
  }

  private startRound() {
    const w = this.w, t = w.time;
    this.phase = 'fight'; this.roundStart = t; this.ready.clear();
    // humans who never picked: the first power is theirs (no one enters a power round empty-handed)
    for (const a of w.actors) if (this.powerPending(a)) this.pickPower(a, powersFor(a.baseDef).find(p => !a.powers.includes(p.id))!.id);
    const P = w.point;
    P.owner = null; P.capture = 0; P.capTeam = null; P.progress = { zenith: 0, umbra: 0 }; P.contested = false; P.unlockAt = t + 6;
    w.emit({ t: 'msg', text: `ROUND ${this.round} - FIGHT!`, color: '#ffd76a' }); w.sfx('announce');
  }

  private updatePoint(dt: number) {
    const w = this.w, P = w.point, t = w.time;
    if (t < P.unlockAt) return;
    if (t - dt < P.unlockAt) { w.emit({ t: 'msg', text: 'THE POINT IS OPEN' }); w.sfx('announce'); }
    const [px, py, pz] = w.map.point;
    const on = { zenith: 0, umbra: 0 };
    for (const a of w.actors) if (a.alive && Math.hypot(a.pos.x - px, a.pos.z - pz) < P.r && a.pos.y > py - 1 && a.pos.y < py + 5) on[a.team]++;
    P.contested = on.zenith > 0 && on.umbra > 0;
    const solo: TeamId | null = P.contested ? null : on.zenith ? 'zenith' : on.umbra ? 'umbra' : null;
    if (solo && solo !== P.owner) {
      if (P.capTeam !== solo) { P.capture = Math.max(0, P.capture - dt * 30); if (P.capture === 0) P.capTeam = solo; }
      else P.capture = Math.min(100, P.capture + dt * (16 + 5 * Math.min(3, on[solo])));
      if (P.capture >= 100) {
        P.owner = solo; P.capture = 0; P.capTeam = null;
        w.emit({ t: 'msg', text: `${solo === 'zenith' ? 'ZENITH VANGUARD' : 'UMBRA SYNDICATE'} TOOK THE POINT`, color: solo === 'zenith' ? '#5cc8ff' : '#ff3b5c' });
        w.sfx('capture');
      }
    } else if (!solo && !P.contested) P.capture = Math.max(0, P.capture - dt * 10);
    if (P.owner && !P.contested) {
      P.progress[P.owner] = Math.min(100, P.progress[P.owner] + dt * 3.2);
      const other: TeamId = P.owner === 'zenith' ? 'umbra' : 'zenith';
      if (P.progress[P.owner] >= 100 && on[other] === 0) return this.endRound(P.owner, 'point secured');
    }
    if (t - this.roundStart > ROUND_SECS && !P.contested) {
      const z = P.progress.zenith, u = P.progress.umbra;
      if (z !== u) return this.endRound(z > u ? 'zenith' : 'umbra', 'time');
      const k = (team: TeamId) => w.actors.filter(a => a.team === team).reduce((s, a) => s + a.kills - (this.base.get(a.id)?.kills ?? 0), 0);
      return this.endRound(k('zenith') >= k('umbra') ? 'zenith' : 'umbra', 'eliminations');
    }
  }

  private snapshot() { for (const a of this.w.actors) this.base.set(a.id, { dmg: a.dmgDone, heal: a.healDone, kills: a.kills, assists: a.assists }); }

  /** cash for the round just played: performance + the round result (the losing side gets a catch-up bonus) */
  private payout(winner: TeamId) {
    for (const a of this.w.actors) {
      const b = this.base.get(a.id) ?? { dmg: 0, heal: 0, kills: 0, assists: 0 };
      const earned = (a.dmgDone - b.dmg) * 1.0 + (a.healDone - b.heal) * 1.1 + (a.kills - b.kills) * 350 + (a.assists - b.assists) * 150;
      a.cash += Math.round(Math.min(9000, earned) + (a.team === winner ? 2000 : 2800));
    }
    this.snapshot();
  }

  private endRound(winner: TeamId, reason: string) {
    const w = this.w, t = w.time;
    this.wins[winner]++;
    this.lastRound = { winner, reason };
    const name = winner === 'zenith' ? 'ZENITH VANGUARD' : 'UMBRA SYNDICATE';
    w.emit({ t: 'msg', text: `ROUND ${this.round} - ${name} (${this.wins.zenith}-${this.wins.umbra})`, color: winner === 'zenith' ? '#5cc8ff' : '#ff3b5c' });
    this.payout(winner);
    if (this.wins[winner] >= ROUNDS_TO_WIN) { this.phase = 'over'; w.end(winner); return; }
    // the next round: everyone back to spawn, fresh, shopping; ultimate charge carries over
    this.round++;
    this.phase = 'armory'; this.phaseEnd = t + ARMORY_SECS;
    w.projs = []; w.zones = []; w.timers = [];
    for (const a of w.actors) { const ult = a.ult; w.respawn(a, true); a.cd = {}; a.ult = ult; a.kills = a.kills; }
    w.sfx('victory');
  }
}

// ---------------------------------------------------------------- AI shopping
const WANT: Record<string, Cat[]> = { tank: ['survival', 'ability', 'weapon'], support: ['ability', 'survival', 'weapon'], dps: ['weapon', 'ability', 'survival'] };

/** bots: take a power when one is due, then buy the best item they can afford in their role's order (once a phase) */
export function botShop(s: Stadium, a: Actor) {
  if (s.powerPending(a)) {
    const P = powersFor(a.baseDef), role = a.baseDef.role;
    const order = role === 'support' ? ['_ult', '_guard', '_a2', '_a1', '_move', '_wpn'] : role === 'tank' ? ['_guard', '_a1', '_ult', '_a2', '_move', '_wpn'] : ['_wpn', '_a1', '_ult', '_guard', '_a2', '_move'];
    const pick = order.map(k => P.find(p => p.id.endsWith(k))).find(p => p && !a.powers.includes(p.id));
    if (pick) s.pickPower(a, pick.id);
  }
  if ((a.sv.shoppedRound ?? 0) === s.round) return;
  a.sv.shoppedRound = s.round;
  const cats = WANT[a.baseDef.role] ?? WANT.dps;
  for (let guard = 0; guard < 8; guard++) {
    if (a.items.length >= MAX_ITEMS) {
      // full: trade the cheapest item up when a pricier one is affordable
      const cheapest = [...a.items].sort((x, y) => ITEM[x].cost - ITEM[y].cost)[0];
      const up = ITEMS.filter(i => !a.items.includes(i.id) && i.cost > ITEM[cheapest].cost * 2 && i.cost <= a.cash + ITEM[cheapest].cost && cats.slice(0, 2).includes(i.cat)).sort((x, y) => y.cost - x.cost)[0];
      if (!up) break;
      s.sell(a, cheapest); if (!s.buy(a, up.id)) break;
      continue;
    }
    const pick = cats.flatMap(c => ITEMS.filter(i => i.cat === c && !a.items.includes(i.id) && i.cost <= a.cash).sort((x, y) => y.cost - x.cost)).at(0);
    if (!pick || !s.buy(a, pick.id)) break;
  }
}

export const heroName = (id: string) => HERO[id]?.name ?? id;
