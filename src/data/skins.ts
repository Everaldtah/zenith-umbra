// Hero skins: shader-driven recolours of each hero's own texture (hue/saturation/value, tint, glow, legendary pattern).
export interface Skin { id: string; name: string; rarity: 'Classic' | 'Rare' | 'Epic' | 'Legendary'; hue: number; sat: number; val: number; tint: string; tintAmt: number; glow: number; pattern: number; patternColor: string; }

const base: Omit<Skin, 'id' | 'name' | 'rarity'> = { hue: 0, sat: 1, val: 1, tint: '#ffffff', tintAmt: 0, glow: 0, pattern: 0, patternColor: '#ffffff' };
const S = (id: string, name: string, rarity: Skin['rarity'], o: Partial<Skin>): Skin => ({ ...base, id, name, rarity, ...o });

const NAMES: Record<string, [string, string, string, string]> = {
  tenkai: ['Midnight Sun', 'Sakura Guardian', 'Neon Striker', 'Solar Emperor'],
  mirei: ['Eclipse Idol', 'Cherry Blossom', 'Synthwave Star', 'Celestial Queen'],
  kaien: ['Ink Monk', 'Spring Pilgrim', 'Cyber Sutra', 'Golden Mandala'],
  raijin: ['Black Thunder', 'Hanami Duelist', 'Neon Ronin', 'Storm God'],
  yuzu: ['Nightfall Archer', 'Petal Shot', 'Arcade Hunter', 'Radiant Huntress'],
  gorgoth: ['Bone Engine', 'Blood Blossom', 'Toxic Core', 'Obsidian Tyrant'],
  nocturne: ['Silver Moon', 'Rose Requiem', 'Club Nocturne', 'Crimson Empress'],
  hex: ['Paper Doll', 'Bloom Puppeteer', 'Glitch Theater', 'Void Maestro'],
  kagemaru: ['Snow Fang', 'Falling Petal', 'Neon Shinobi', 'Oni Shadow'],
  enra: ['Ash Oni', 'Spirit Blossom', 'Acid Oni', 'Inferno Lord'],
};

export function skinsFor(heroId: string, team: 'zenith' | 'umbra'): Skin[] {
  const n = NAMES[heroId] ?? ['Eclipse', 'Sakura', 'Neon', 'Legend'];
  const zen = team === 'zenith';
  return [
    S('classic', 'Classic', 'Classic', {}),
    S('eclipse', n[0], 'Rare', { hue: zen ? 200 : 170, sat: 0.9, val: 0.72, tint: zen ? '#3b4a8a' : '#d8dce8', tintAmt: 0.25 }),
    S('sakura', n[1], 'Rare', { hue: 0, sat: 0.85, val: 1.08, tint: '#ff9ec4', tintAmt: 0.38 }),
    S('neon', n[2], 'Epic', { hue: zen ? 130 : 95, sat: 1.45, val: 1, tint: zen ? '#20ffd2' : '#b6ff2a', tintAmt: 0.15, glow: 0.45, pattern: 0.4, patternColor: zen ? '#20ffd2' : '#b6ff2a' }),
    S('legend', n[3], 'Legendary', zen
      ? { hue: 0, sat: 0.55, val: 1.08, tint: '#ffd76a', tintAmt: 0.45, glow: 0.3, pattern: 1, patternColor: '#ffe9a0' }
      : { hue: 0, sat: 0.35, val: 0.45, tint: '#2a0a14', tintAmt: 0.3, glow: 0.2, pattern: 1, patternColor: '#ff2244' }),
  ];
}

const KEY = 'zu-skins-v1';
export function equippedSkin(heroId: string): string {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}')[heroId] ?? 'classic'; } catch { return 'classic'; }
}
export function equipSkin(heroId: string, skin: string) {
  try { const m = JSON.parse(localStorage.getItem(KEY) ?? '{}'); m[heroId] = skin; localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private mode */ }
}
