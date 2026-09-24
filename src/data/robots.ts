// Zenith Academy training robots. They reuse HeroDef so the world, renderer and AI treat them like heroes.
import type { HeroDef, AbilityDef } from './heroes';

const none = (id: string): AbilityDef => ({ id, name: '-', key: '-', cooldown: 999, desc: '' });
const base = {
  team: 'umbra' as const, role: 'dps' as const, rival: '', armor: 0, color: '#ff8a3d', glow: '#4fc3ff',
  secondary: none('none'), ability1: none('none'), ability2: none('none'), ult: { ...none('none'), charge: 1e9 },
  passive: { name: '', desc: '' }, inspiration: '', voice: [300, 0.2] as [number, number],
};

export const ROBOTS: Record<string, HeroDef> = {
  bot_dummy: {
    ...base, id: 'bot_dummy', name: 'Target Unit MK-1', title: 'Training Dummy', frame: 'human', hp: 300, speed: 0, height: 1.9, radius: 0.5,
    primary: { kind: 'hitscan', damage: 0, rate: 0.01, range: 1, sfx: 'none', fx: 'none' },
    lore: 'A sturdy practice frame. It never fights back, and it always gets back up.',
  },
  bot_sentry: {
    ...base, id: 'bot_sentry', name: 'Sentry Walker', title: 'Live-Fire Drill', frame: 'human', hp: 250, speed: 2.4, height: 1.7, radius: 0.8,
    primary: { kind: 'projectile', damage: 8, rate: 1.5, range: 35, speed: 30, sfx: 'blaster', fx: 'sun' },
    lore: 'Patrols a lane and returns fire with low-power blasters.',
  },
  bot_drone: {
    ...base, id: 'bot_drone', name: 'Hover Seeker', title: 'Aerial Target', frame: 'drone', hp: 150, speed: 4.5, height: 1.0, radius: 0.55,
    primary: { kind: 'hitscan', damage: 0, rate: 0.01, range: 1, sfx: 'none', fx: 'none' },
    lore: 'An evasive drone for tracking practice.',
  },
};
