// Role and sub-role passives - the Overwatch (2026) framework applied to ZENITH//UMBRA. See docs/research/ow_balance_study.md
// for where every number comes from and docs/BALANCE_PATCH.md for the per-hero pass that goes with it.
//
// The idea (Blizzard's): a role's identity lives in a shared passive, not in every kit. Tanks are the biggest health pools
// and the biggest ult-charge batteries, so damage into them and their own damage feed ultimates less; damage heroes cut
// the healing on whoever they hit so focus fire sticks; every hero regenerates once the shooting stops so a support is a
// multiplier, not a prerequisite. The sub-roles (Feb 2026) then give each archetype inside a role a small, flavoured
// edge - a brawler tank shrugs off knockback, a sniper's headshots refund her mobility, a healer who heals is healed.
import type { Actor } from './Actor';
import type { HeroDef, Role } from '../data/heroes';

export type SubRole = 'stalwart' | 'bruiser' | 'initiator' | 'flanker' | 'sharpshooter' | 'recon' | 'specialist' | 'medic' | 'survivor' | 'tactician';

/** everyone: health regenerates once no damage has landed for REGEN_DELAY s (OW: 20 HP/s after 5 s, since Season 9) */
export const REGEN_RATE = 20, REGEN_DELAY = 5;
/** Enra's Oni Blood: his regeneration starts sooner */
export const ONI_REGEN_DELAY = 2.5;
/** tanks: ultimate charge from their own damage and healing x0.6 (OW Feb 2026: -40%) */
export const TANK_ULT_GEN = 0.6;
/** anyone: damage into / healing on a tank gives x0.6 the ultimate charge (OW Jul 2026: -40%) */
export const VS_TANK_ULT = 0.6;
/** damage absorbed by temporary health gives half the ultimate charge (OW2 launch) */
export const OVERHEALTH_ULT = 0.5;
/** damage heroes: whoever they hit receives HEALCUT less healing for HEALCUT_SECS (OW Jul 2026: 15%, 2 s) */
export const HEALCUT = 0.15, HEALCUT_SECS = 2;
/** the most any mix of armor and damage reduction can take off a hit (OW Aug 2025: 50% cap) */
export const MITIGATION_CAP = 0.5;

// sub-roles
/** stalwart tanks: knockback and slows x0.6 (OW: -40% / -40%) */
export const STALWART_KNOCK = 0.6, STALWART_SLOW = 0.6;
/** bruiser tanks: critical hits x0.75, +15% move speed under half health (OW Jul 2026: -25%, +15%) */
export const BRUISER_CRIT = 0.75, BRUISER_SPEED = 1.15;
/** initiator tanks: 40 healing over 1 s after a movement ability, every 4 s (OW Jul 2026) - no ZENITH//UMBRA tank is one yet */
export const INITIATOR_HEAL = 40, INITIATOR_CD = 4;
/** flankers: +50 from every health pack (OW Jul 2026: 125 / 300 instead of 75 / 250) */
export const FLANKER_PACK = 50;
/** sharpshooters: a critical hit takes SHARPSHOOTER_CD s per point of damage off the movement ability's cooldown (a 250 headshot: 2.5 s) */
export const SHARPSHOOTER_CD = 0.01;
/** recon: damaging an enemy under half health reveals them for 3.5 s */
export const RECON_REVEAL = 3.5;
/** specialists: an elimination reloads 1.5x faster for 3 s */
export const SPECIALIST_RELOAD = 0.5, SPECIALIST_SECS = 3;
/** medics: healing allies with the weapon heals the healer for 30% of it (OW Jul 2026: 40% -> 30%) */
export const MEDIC_SELF = 0.3;
/** tacticians: ultimate charge past full is banked, up to 25% of the next ultimate, at 75% rate */
export const TACTICIAN_BANK = 0.25, TACTICIAN_RATE = 0.75;

export const ROLE_PASSIVE: Record<Role, { name: string; desc: string }> = {
  tank: { name: 'Tank', desc: `Your damage and healing build ultimate 40% slower, and damage into you charges the enemy's ultimates 40% slower. Knockback and critical-hit resistance now come from your sub-role.` },
  dps: { name: 'Damage', desc: `Everyone you hit receives ${Math.round(HEALCUT * 100)}% less healing for ${HEALCUT_SECS}s.` },
  support: { name: 'Support', desc: `Your healing builds ultimate at full rate (tanks you heal: 60%). Your sub-role gives you your own sustain.` },
};
export const SUBROLE: Record<SubRole, { name: string; desc: string }> = {
  stalwart: { name: 'Stalwart', desc: 'Knockback and slows against you are 40% weaker.' },
  bruiser: { name: 'Bruiser', desc: 'Critical hits against you deal 25% less. Move 15% faster while below half health.' },
  initiator: { name: 'Initiator', desc: `Using a movement ability heals ${INITIATOR_HEAL} over 1s (every ${INITIATOR_CD}s).` },
  flanker: { name: 'Flanker', desc: `Health packs restore ${FLANKER_PACK} more.` },
  sharpshooter: { name: 'Sharpshooter', desc: 'Critical hits shorten your movement ability’s cooldown (1s per 100 damage).' },
  recon: { name: 'Recon', desc: `Damaging an enemy below half health reveals them for ${RECON_REVEAL}s.` },
  specialist: { name: 'Specialist', desc: `Eliminations make you reload 50% faster for ${SPECIALIST_SECS}s.` },
  medic: { name: 'Medic', desc: `Healing allies with your weapon heals you for ${Math.round(MEDIC_SELF * 100)}% of it.` },
  survivor: { name: 'Survivor', desc: 'Movement abilities start your health regeneration at once.' },
  tactician: { name: 'Tactician', desc: `Ultimate charge past full is banked: up to ${Math.round(TACTICIAN_BANK * 100)}% of your next ultimate.` },
};

export const subroleOf = (d: HeroDef): SubRole | undefined => d.subrole;
export const isSub = (a: Actor, s: SubRole) => a.def.subrole === s;
/** the hero's movement ability (what a sharpshooter's crits refund, what starts a survivor's regen) */
export const MOVE_ABILITY: Record<string, string> = { yuzu: 'sunhop', seiran: 'riverstep', raijin: 'flashstep', hayate: 'currentdash', kagemaru: 'shadowstep', kaien: 'spiritstep', enra: 'chain', tenkai: 'dawncharge', gorgoth: 'abysscharge', gantetsu: 'tachiai', haruto: 'pilotroll' };
