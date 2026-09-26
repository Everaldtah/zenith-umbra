// Hero skins: palette recolours of each hero's own painted texture, the way a hero shooter's rare / epic skins work -
// the COSTUME changes colour (its dominant hue -> primary, its second hue -> accent, whites / blacks -> neutral tint)
// while skin tones and hair stay the hero's own; epic and legendary skins add emissive trims and animated energy.
// The costume hues are measured from each model's texture when it loads (CharacterView.analysePalette).
export interface Skin {
  id: string; name: string; rarity: 'Classic' | 'Rare' | 'Epic' | 'Legendary';
  primary: string | null;    // costume's dominant hue -> this colour (null = unchanged)
  accent: string | null;     // costume's second hue (trims, emblems) -> this colour
  neutral: string;           // multiplies whites / greys / blacks (cloth, plates): '#ffffff' = unchanged
  metal: number;             // extra metallic sheen on the accent colour (gold / chrome trims)
  glow: number; pattern: number; patternColor: string;
}

const base: Omit<Skin, 'id' | 'name' | 'rarity'> = { primary: null, accent: null, neutral: '#ffffff', metal: 0, glow: 0, pattern: 0, patternColor: '#ffffff' };
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
  haruto: ['Night Pilot', 'Blossom Ace', 'Arcade Ace', 'Sunforged Ace'],
};

export function skinsFor(heroId: string, team: 'zenith' | 'umbra'): Skin[] {
  const n = NAMES[heroId] ?? ['Eclipse', 'Sakura', 'Neon', 'Legend'];
  const zen = team === 'zenith';
  return [
    S('classic', 'Classic', 'Classic', {}),
    // rare: a full colourway
    S('eclipse', n[0], 'Rare', zen
      ? { primary: '#1c2340', accent: '#9fb2ff', neutral: '#5a6384' }
      : { primary: '#dfe3ee', accent: '#8f98b3', neutral: '#f4f6ff' }),
    S('sakura', n[1], 'Rare', { primary: '#f3b8cf', accent: '#e0527f', neutral: '#fff1f6' }),
    // epic: dark suit, neon trims that glow, a slow scanline
    S('neon', n[2], 'Epic', zen
      ? { primary: '#141a26', accent: '#20ffd2', neutral: '#3a4252', glow: 0.55, pattern: 0.4, patternColor: '#20ffd2' }
      : { primary: '#17121f', accent: '#b6ff2a', neutral: '#3b3346', glow: 0.55, pattern: 0.4, patternColor: '#b6ff2a' }),
    // legendary: regalia - gold / obsidian, metallic trims, flowing energy
    S('legend', n[3], 'Legendary', zen
      ? { primary: '#f6efdc', accent: '#ffc83d', neutral: '#fff8e8', metal: 0.8, glow: 0.3, pattern: 1, patternColor: '#ffe9a0' }
      : { primary: '#16070c', accent: '#ff2244', neutral: '#2a1a20', metal: 0.6, glow: 0.3, pattern: 1, patternColor: '#ff2244' }),
  ];
}

const KEY = 'zu-skins-v1';
export function equippedSkin(heroId: string): string {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}')[heroId] ?? 'classic'; } catch { return 'classic'; }
}
export function equipSkin(heroId: string, skin: string) {
  try { const m = JSON.parse(localStorage.getItem(KEY) ?? '{}'); m[heroId] = skin; localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private mode */ }
}
