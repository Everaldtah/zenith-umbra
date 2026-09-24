// ZENITH//UMBRA roster: 5 Zenith Vanguard heroes vs 5 Umbra Syndicate villains.
// Every hero has a rival on the other team, and each of them owns an ability that counters the other.

export type TeamId = 'zenith' | 'umbra';
export type Role = 'tank' | 'support' | 'dps';
export type Slot = 'primary' | 'secondary' | 'ability1' | 'ability2' | 'ult';
export type Frame = 'human' | 'mech' | 'flyer' | 'drone';

export interface WeaponDef {
  kind: 'projectile' | 'hitscan' | 'melee' | 'beam' | 'charge';
  damage: number;
  rate: number;          // shots (or ticks) per second
  range: number;
  speed?: number;        // projectile m/s
  splash?: number;       // splash radius
  pellets?: number;
  spread?: number;       // radians
  ammo?: number;
  reload?: number;
  heal?: boolean;        // beam / projectile heals allies instead of hurting enemies
  sfx: string;
  fx: string;            // colour key for projectile / beam effect
}

export interface AbilityDef {
  id: string;
  name: string;
  key: string;
  cooldown: number;      // seconds; ults use charge instead
  desc: string;
  counter?: string;      // what this ability counters on the rival
  hold?: boolean;
}

export interface HeroDef {
  id: string;
  name: string;
  title: string;
  team: TeamId;
  role: Role;
  frame: Frame;
  rival: string;
  hp: number;
  armor: number;         // armor hp: -30% damage per hit (min 1/2 dmg)
  speed: number;
  height: number;        // metres, feet to crown
  radius: number;
  color: string;         // primary team-tinted accent
  glow: string;          // effect colour
  primary: WeaponDef;
  secondary: WeaponDef | AbilityDef;
  ability1: AbilityDef;
  ability2: AbilityDef;
  ult: AbilityDef & { charge: number };
  passive: { name: string; desc: string };
  lore: string;
  inspiration: string;
  voice: [number, number];   // synth "voice" (base pitch, timbre) for ability callouts
  pilot?: { id: string; name: string; bio: string };   // tanks are piloted mecha: the pilot ejects when the frame falls
}

const isAbility = (x: WeaponDef | AbilityDef): x is AbilityDef => (x as AbilityDef).id !== undefined;
export { isAbility };

export const HEROES: HeroDef[] = [
  // ============================================================ ZENITH VANGUARD
  {
    id: 'tenkai', name: 'Tenkai-Oh', title: 'The Dawn Colossus', team: 'zenith', role: 'tank', frame: 'mech', rival: 'gorgoth',
    hp: 400, armor: 250, speed: 5.0, height: 3.3, radius: 0.95, color: '#f4d35e', glow: '#ffd76a',
    primary: { kind: 'projectile', damage: 22, splash: 1.6, rate: 5, range: 60, speed: 62, ammo: 30, reload: 1.8, sfx: 'cannon', fx: 'sun' },
    secondary: { id: 'bulwark', name: 'Solar Bulwark', key: 'RMB', cooldown: 0, hold: true, desc: 'Raise a 1400 HP sun-shield in front of you. Regenerates when lowered.' },
    ability1: { id: 'anchor', name: 'Dawn Anchor', key: 'SHIFT', cooldown: 8, desc: 'Launch a rocket fist that drags the first enemy hit toward you (40 dmg).', counter: "Interrupts Gorgoth's Abyss Charge and every channel." },
    ability2: { id: 'sunburst', name: 'Purging Sunburst', key: 'E', cooldown: 12, desc: 'Burst of dawnlight: cleanse nearby allies of curses, burns, roots and silence, 2s immunity. 30 dmg to enemies.', counter: "Burns away Enra's Eclipse Brand and Hex's Grievous Hex." },
    ult: { id: 'dawndrive', name: 'Final Dawn Drive', key: 'Q', cooldown: 0, charge: 1900, desc: 'Leap skyward and slam a blazing sun-sword: 200 dmg and 1.5s stun in 8m.' },
    passive: { name: 'Heavy Frame', desc: 'Immune to knockback. Armor absorbs 30% of every hit.' },
    lore: 'Tenkai-Oh was forged in Hangar Zero as the first Guardian Frame, piloted by Haruto Daimon - a mechanic\'s son who refused to let the Eclipse take another city. Its sun-reactor was stolen by the Syndicate once. It will not happen twice.',
    inspiration: 'Classic super robot shows - hot-blooded pilot, combining-sword finishers, dawn-light transformation.',
    voice: [110, 0.8],
    pilot: { id: 'haruto', name: 'Haruto Daimon', bio: "Seventeen, hot-blooded, and the only pilot Tenkai-Oh's sun-reactor ever synchronised with. Ejects in a golden escape pod when the frame goes down - and is back in the cockpit before the dust settles." },
  },
  {
    id: 'mirei', name: 'Mirei', title: 'The Starweaver', team: 'zenith', role: 'support', frame: 'flyer', rival: 'nocturne',
    hp: 200, armor: 0, speed: 5.6, height: 1.65, radius: 0.42, color: '#8fd3ff', glow: '#bfe8ff',
    primary: { kind: 'projectile', damage: 22, rate: 3, range: 50, speed: 55, ammo: 24, reload: 1.4, sfx: 'star', fx: 'star' },
    secondary: { kind: 'beam', damage: 62, rate: 10, range: 18, heal: true, sfx: 'healbeam', fx: 'star' },
    ability1: { id: 'constellation', name: 'Constellation Link', key: 'SHIFT', cooldown: 12, desc: 'Link allies within 15m for 5s: 25 HP/s and immunity to silence, grounding and roots.', counter: "Linked allies shrug off Nocturne's Silence Aria." },
    ability2: { id: 'wish', name: 'Wish Barrier', key: 'E', cooldown: 10, desc: 'Wrap the ally you aim at (or yourself) in a 300 HP star shield for 4s.' },
    ult: { id: 'nova', name: 'Nova Requiem', key: 'Q', cooldown: 0, charge: 2000, desc: 'A healing supernova: allies within 25m heal 350 over 2.5s and deal +30% damage for 4s.' },
    passive: { name: 'Starwing Flight', desc: 'Hold SPACE to fly on holographic star wings. Flight energy regenerates on the ground.' },
    lore: 'The last apprentice of the Amatsu Star Choir, Mirei stitched her wings from the constellations the night the Eclipse swallowed her teacher\'s voice. She sings to keep the Vanguard alive - and to drown out a song she once loved.',
    inspiration: 'Magical-girl transformation shows and idol-singer anime.',
    voice: [520, 0.2],
  },
  {
    id: 'kaien', name: 'Kaien', title: 'The Warding Monk', team: 'zenith', role: 'support', frame: 'human', rival: 'kagemaru',
    hp: 225, armor: 0, speed: 5.5, height: 1.8, radius: 0.45, color: '#e8e4ff', glow: '#ffe28a',
    primary: { kind: 'projectile', damage: 17, pellets: 3, spread: 0.035, rate: 1.6, range: 45, speed: 48, ammo: 12, reload: 1.6, sfx: 'talisman', fx: 'talisman' },
    secondary: { kind: 'projectile', damage: 60, rate: 1.25, range: 40, speed: 40, heal: true, sfx: 'blessing', fx: 'talisman' },
    ability1: { id: 'spiritstep', name: 'Spirit Step', key: 'SHIFT', cooldown: 8, desc: 'Vanish into a scatter of paper and reappear 10m ahead.' },
    ability2: { id: 'seal', name: 'Warding Seal', key: 'E', cooldown: 14, desc: 'Inscribe a 7m seal for 6s: enemies inside are revealed, cannot stealth, teleport or dash, and burn 15/s. Allies heal 20/s.', counter: "Pins Kagemaru: no Veil of Night, no Shadow Step." },
    ult: { id: 'sanctuary', name: 'Thousand Seal Sanctuary', key: 'Q', cooldown: 0, charge: 2200, desc: 'Raise a 10m sanctum for 5s: allies inside cannot fall below 1 HP and heal 60/s.' },
    passive: { name: 'Prayer Beads', desc: 'Healing an ally also heals Kaien for 25% of the amount.' },
    lore: 'Kaien kept the gate of the Amatsu Sky Shrine alone for nine years. When a wolf-masked shadow slipped past him and set the shrine\'s sacred tree ablaze, he left the mountain for the first time - with ten thousand talismans and one name.',
    inspiration: 'Onmyoji exorcist and shrine-guardian anime.',
    voice: [180, 0.4],
  },
  {
    id: 'raijin', name: 'Raijin', title: 'The Stormblade', team: 'zenith', role: 'dps', frame: 'human', rival: 'enra',
    hp: 225, armor: 0, speed: 6.2, height: 1.8, radius: 0.44, color: '#ffe066', glow: '#8ad8ff',
    primary: { kind: 'melee', damage: 48, rate: 2.2, range: 3.2, sfx: 'katana', fx: 'bolt' },
    secondary: { kind: 'projectile', damage: 42, rate: 1.1, range: 40, speed: 70, ammo: 3, reload: 2.4, sfx: 'thunder', fx: 'bolt' },
    ability1: { id: 'flashstep', name: 'Flash Step', key: 'SHIFT', cooldown: 6, desc: 'Lightning dash 12m, 50 dmg to every enemy you pass through.' },
    ability2: { id: 'parry', name: 'Thunder Parry', key: 'E', cooldown: 10, desc: '1.2s stance: reflect projectiles and hooks, stun melee attackers for 1s.', counter: "Reflects Enra's Chain of Oblivion and stuns him on contact." },
    ult: { id: 'judgment', name: "Raijin's Judgment", key: 'Q', cooldown: 0, charge: 1700, desc: '6s: +30% speed, each slash chains lightning to 2 enemies (40 dmg), Flash Step resets on kills.' },
    passive: { name: 'Double Jump', desc: 'Jump again in mid-air.' },
    lore: 'Neo-Kurogane\'s underground dueling champion, Raijin carries a katana that was struck by lightning on the night of his mother\'s funeral. The oni who burned his district down is still out there, laughing in the red.',
    inspiration: 'Lightning-swordsman shonen rivals and cyberpunk samurai anime.',
    voice: [240, 0.6],
  },
  {
    id: 'yuzu', name: 'Yuzu', title: 'The Dawnshot', team: 'zenith', role: 'dps', frame: 'human', rival: 'hex',
    hp: 200, armor: 0, speed: 5.6, height: 1.62, radius: 0.4, color: '#ffa94d', glow: '#ffd27a',
    primary: { kind: 'charge', damage: 130, rate: 1.1, range: 120, speed: 120, ammo: 1, sfx: 'bow', fx: 'sun' },
    secondary: { id: 'zoom', name: 'Hawk Eye', key: 'RMB', cooldown: 0, hold: true, desc: 'Zoom in. Full-charge headshots deal double damage.' },
    ability1: { id: 'sunhop', name: 'Sunhop', key: 'SHIFT', cooldown: 7, desc: 'Leap high and glide for 1.5s.' },
    ability2: { id: 'reveal', name: 'Revealing Dawn Arrow', key: 'E', cooldown: 12, desc: 'An arrow that bursts in 10m: reveals enemies through walls for 5s, severs marionette strings and cleanses hexes.', counter: "Severs Hex's Marionette Strings and strips his curses." },
    ult: { id: 'hundredsuns', name: 'Hundred Suns Barrage', key: 'Q', cooldown: 0, charge: 1900, desc: 'Call 40 arrows of light down on the target area over 3s (25 dmg each).' },
    passive: { name: 'Dawn Eyes', desc: 'Enemies she damages are marked for allies for 3s.' },
    lore: 'Top of her class at Zenith Academy, Yuzu can split a falling leaf at three hundred metres. Her twin brother vanished into the Eclipse Rift during a training exercise. The puppeteer\'s newest doll wears his scarf.',
    inspiration: 'Archery-club sports anime meets post-apocalyptic sniper series.',
    voice: [440, 0.3],
  },
  // ============================================================ UMBRA SYNDICATE
  {
    id: 'gorgoth', name: 'Gorgoth', title: 'The Abyss Engine', team: 'umbra', role: 'tank', frame: 'mech', rival: 'tenkai',
    hp: 450, armor: 200, speed: 4.8, height: 3.4, radius: 0.95, color: '#ff3355', glow: '#ff2244',
    primary: { kind: 'hitscan', damage: 9, pellets: 9, spread: 0.075, rate: 1.7, range: 22, ammo: 8, reload: 2.0, sfx: 'shotgun', fx: 'void' },
    secondary: { id: 'plating', name: 'Void Plating', key: 'RMB', cooldown: 10, desc: 'Coat yourself (250) and allies within 8m (100) in a 3s void shield.' },
    ability1: { id: 'abysscharge', name: 'Abyss Charge', key: 'SHIFT', cooldown: 9, desc: 'Charge 15m. The first enemy hit is pinned and slammed for 60 dmg.' },
    ability2: { id: 'nulllance', name: 'Null Lance', key: 'E', cooldown: 10, desc: 'Drill-lance thrust 8m: 70 dmg, x4 damage to barriers, shields and deployables.', counter: "Shatters Tenkai-Oh's Solar Bulwark and Mirei's Wish Barrier." },
    ult: { id: 'singularity', name: 'Eclipse Singularity', key: 'Q', cooldown: 0, charge: 2000, desc: 'A gravity well 15m ahead drags enemies in 10m for 2.5s, then implodes for 150.' },
    passive: { name: 'Abyss Core', desc: 'Immune to knockback. Regains 5% of damage dealt as armor.' },
    lore: 'Built beside Tenkai-Oh in Hangar Zero from the same stolen blueprints, Gorgoth runs on a reactor that eats light. Its pilot, Warlord Vorn, was once Haruto Daimon\'s instructor - the man who taught him never to hold back.',
    inspiration: 'Dark-rival real-robot shows: the enemy ace in a mirrored machine.',
    voice: [70, 0.95],
    pilot: { id: 'vorn', name: 'Warlord Vorn', bio: "Former Vanguard flight instructor, now the Syndicate's iron fist. He stole Gorgoth from Hangar Zero himself, and pilots it with the cold patience of a man who has already lost everything." },
  },
  {
    id: 'nocturne', name: 'Lady Nocturne', title: 'The Crimson Diva', team: 'umbra', role: 'support', frame: 'flyer', rival: 'mirei',
    hp: 200, armor: 0, speed: 5.6, height: 1.75, radius: 0.42, color: '#ff4d6d', glow: '#ff2d55',
    primary: { kind: 'projectile', damage: 20, rate: 4, range: 45, speed: 50, ammo: 28, reload: 1.5, sfx: 'note', fx: 'blood' },
    secondary: { kind: 'beam', damage: 56, rate: 10, range: 18, heal: true, sfx: 'healbeam2', fx: 'blood' },
    ability1: { id: 'silence', name: 'Silence Aria', key: 'SHIFT', cooldown: 12, desc: 'A 12m sonic cone: silences enemies for 1.5s and grounds flyers for 3s.', counter: "Rips Mirei out of the sky and cuts off Raijin's Flash Step." },
    ability2: { id: 'bloodpact', name: 'Blood Pact', key: 'E', cooldown: 10, desc: 'Grant the ally you aim at (or yourself) 30% lifesteal and +25% speed for 4s.' },
    ult: { id: 'requiem', name: 'Requiem of the Crimson Moon', key: 'Q', cooldown: 0, charge: 2000, desc: 'Allies within 20m heal 250 over 3s; enemies within 20m bleed 100 over 3s.' },
    passive: { name: 'Blood Harmony', desc: 'Hold SPACE to fly on crimson bat wings. 50% of damage dealt heals the most injured nearby ally.' },
    lore: 'Once the prima voice of the Amatsu Star Choir - and Mirei\'s teacher - Nocturne traded her light for eternal youth beneath the Crimson Moon. She says she sings for the Syndicate now. She still hums Mirei\'s lullaby when she thinks no one is listening.',
    inspiration: 'Gothic vampire-queen anime and tragic idol villainesses.',
    voice: [330, 0.5],
  },
  {
    id: 'hex', name: 'Hex', title: 'The Dollmaker', team: 'umbra', role: 'support', frame: 'human', rival: 'yuzu',
    hp: 225, armor: 0, speed: 5.3, height: 1.95, radius: 0.42, color: '#b56dff', glow: '#c77dff',
    primary: { kind: 'projectile', damage: 15, pellets: 3, spread: 0.03, rate: 3, range: 40, speed: 75, ammo: 30, reload: 1.5, sfx: 'needle', fx: 'hex' },
    secondary: { kind: 'projectile', damage: 55, rate: 1.2, range: 35, speed: 35, heal: true, sfx: 'stitch', fx: 'hex' },
    ability1: { id: 'marionette', name: 'Marionette Strings', key: 'SHIFT', cooldown: 10, desc: 'Tether an enemy within 20m; after 0.6s they are yanked 8m toward you and rooted for 1s.' },
    ability2: { id: 'grievous', name: 'Grievous Hex', key: 'E', cooldown: 12, desc: 'A curse bomb: 6m zone for 4s, enemies inside receive 80% less healing and take 10/s.', counter: "Starves Mirei's and Kaien's heals." },
    ult: { id: 'theater', name: 'Grand Puppet Theater', key: 'Q', cooldown: 0, charge: 2100, desc: 'Every enemy within 15m is rooted and takes +30% damage for 2.5s.' },
    passive: { name: 'Stitched Decoy', desc: 'A single hit over 90 damage is taken by a doll instead (15s cooldown). Counters Yuzu\'s charged shots.' },
    lore: 'No one has seen the face behind the porcelain. Hex collects "students" from the Eclipse Rift and restitches them into perfect, obedient dolls. His favourite still whispers a girl\'s name.',
    inspiration: 'Creepy puppeteer antagonists from dark-fantasy anime.',
    voice: [150, 0.7],
  },
  {
    id: 'kagemaru', name: 'Kagemaru', title: 'The Shade Fang', team: 'umbra', role: 'dps', frame: 'human', rival: 'kaien',
    hp: 200, armor: 0, speed: 6.4, height: 1.78, radius: 0.42, color: '#7b61ff', glow: '#9d7bff',
    primary: { kind: 'projectile', damage: 30, rate: 3, range: 50, speed: 90, ammo: 18, reload: 1.4, sfx: 'kunai', fx: 'shadow' },
    secondary: { kind: 'melee', damage: 55, rate: 1.2, range: 3.2, sfx: 'fang', fx: 'shadow' },
    ability1: { id: 'shadowstep', name: 'Shadow Step', key: 'SHIFT', cooldown: 7, desc: 'Teleport up to 15m to the point you aim at, leaving smoke.' },
    ability2: { id: 'veil', name: 'Veil of Night', key: 'E', cooldown: 12, desc: 'Turn invisible for 4s with +30% speed; your first strike from the veil deals +50.' },
    ult: { id: 'thousandcuts', name: 'Thousand Shadow Cuts', key: 'Q', cooldown: 0, charge: 1800, desc: 'Blink through up to 5 enemies within 15m, 120 dmg each.' },
    passive: { name: 'Severing Fang', desc: 'Twin Fang slashes (RMB) shatter enemy seals, sanctums and zones within 3m.' },
    lore: 'Kagemaru was the shrine\'s orphan, raised by Kaien\'s master and passed over for the guardian\'s seal. He burned the sacred tree to prove seals mean nothing. He is still trying to prove it.',
    inspiration: 'Shinobi-clan revenge anime and masked rival brothers.',
    voice: [200, 0.85],
    // Severing Fang (secondary) is his counter to Kaien
  },
  {
    id: 'enra', name: 'Enra', title: 'The Crimson Oni', team: 'umbra', role: 'dps', frame: 'human', rival: 'raijin',
    hp: 275, armor: 0, speed: 5.8, height: 2.05, radius: 0.5, color: '#ff5a1f', glow: '#ff6a2a',
    primary: { kind: 'beam', damage: 95, rate: 10, range: 9, sfx: 'flame', fx: 'flame' },
    secondary: { kind: 'melee', damage: 70, rate: 0.4, range: 3.4, sfx: 'punch', fx: 'flame' },
    ability1: { id: 'chain', name: 'Chain of Oblivion', key: 'SHIFT', cooldown: 8, desc: 'Hurl a chain 18m: roots the target for 1.2s and hauls you to them.', counter: "Roots Raijin mid-dash and cancels Flash Step." },
    ability2: { id: 'brand', name: 'Eclipse Brand', key: 'E', cooldown: 10, desc: 'Brand enemies in a 6m cone: 12 dmg/s and -20% speed for 5s.' },
    ult: { id: 'asura', name: 'Asura Awakening', key: 'Q', cooldown: 0, charge: 1800, desc: '8s: grow huge, +150 armor, +50% flame range, 30% lifesteal.' },
    passive: { name: 'Oni Blood', desc: 'Regenerate 12 HP/s after 3s without taking damage.' },
    lore: 'An oni sealed beneath Neo-Kurogane for a thousand years until the Eclipse cracked the city\'s foundation stone. Enra burned the district to find the one blade that ever wounded him - and found it in a boy\'s hands.',
    inspiration: 'Demon-slaying shonen and oni folklore berserkers.',
    voice: [95, 0.9],
  },
];

export const HERO: Record<string, HeroDef> = Object.fromEntries(HEROES.map(h => [h.id, h]));
export const TEAM_NAME: Record<TeamId, string> = { zenith: 'Zenith Vanguard', umbra: 'Umbra Syndicate' };
export const TEAM_COLOR: Record<TeamId, string> = { zenith: '#5cc8ff', umbra: '#ff3b5c' };
