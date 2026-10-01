// ZENITH//UMBRA roster: 5 Zenith Vanguard heroes vs 6 Umbra Syndicate villains.
// Every hero has a rival on the other team, and each of them owns an ability that counters the other.

import { FULL } from '../edition';
import type { SubRole } from '../game/roles';

export type TeamId = 'zenith' | 'umbra';
export type Role = 'tank' | 'support' | 'dps';
export type Slot = 'primary' | 'secondary' | 'ability1' | 'ability2' | 'ult';
export type Frame = 'human' | 'mech' | 'flyer' | 'drone';

export interface WeaponDef {
  kind: 'projectile' | 'hitscan' | 'melee' | 'beam' | 'charge';
  name?: string;         // shown in the hero panels (defaults to the kind)
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
  mesh?: string;         // projectile drawn as this prop (a manifest id, e.g. Hayate's shuriken), lying flat along its flight
  spin?: number;         // ...spinning about its own flat axis, rad/s (a thrown shuriken: 30)
  bounce?: number;       // a ricochet shuriken: how many walls it skips off (World.stepProj)
  seek?: number;         // ...and the perimeter (m, around the thrower) it hunts enemies in after a bounce or a cut
  note?: string;         // a line under the weapon on the hero panel (what the ricochet does)
  sweep?: boolean;       // melee: a wide two-handed arc (alternating swing sides) instead of a thrust
  delay?: number;        // melee: seconds from the button press to the blow landing (heavy weapons wind up)
  burst?: number;        // rounds per trigger pull (fired burstGap seconds apart); rate is then bursts per second
  burstGap?: number;
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
  subrole?: SubRole;     // the role passive's flavour (src/game/roles.ts): stalwart / bruiser tanks, flanker / sharpshooter damage, medic / tactician supports
  frame: Frame;
  rival: string;
  hp: number;
  armor: number;         // armor hp: every hit into it is reduced 30% (wounds excepted); see World.damage
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
  jets?: number;         // seconds of boosted flight (mech foot thrusters), hold SPACE in the air
  gunProp?: boolean;     // carries a procedural sidearm (the pilot out of the mech)
  dualGuns?: boolean;    // a rotary chaingun in each fist: LMB fires the left, RMB the right, both spin up and reload together
  full?: boolean;        // desktop edition only
  summoned?: boolean;    // a summoned body (Hex's puppets): no respawn, no objective time, no kill feed, no ultimate charge
  model?: string;        // drawn with this other hero's model (a summoned effigy of its summoner)
  holo?: string;         // ...as a hologram in this colour (Enra's Crimson Effigy)
  scale?: number;        // ...at this size (the render side; the sim's height / radius above are already scaled)
}

const isAbility = (x: WeaponDef | AbilityDef): x is AbilityDef => (x as AbilityDef).id !== undefined;
export { isAbility };

export const HEROES: HeroDef[] = [
  // ============================================================ ZENITH VANGUARD
  {
    id: 'tenkai', name: 'Tenkai-Oh', title: 'The Dawn Colossus', team: 'zenith', role: 'tank', subrole: 'stalwart', frame: 'mech', rival: 'gorgoth',
    hp: 400, armor: 250, speed: 5.0, height: 3.3, radius: 0.95, color: '#f4d35e', glow: '#ffd76a',
    primary: { kind: 'melee', name: 'Dawnbreaker Rocket Hammer', damage: 90, rate: 1.04, range: 5, sweep: true, delay: 0.24, sfx: 'hammer', fx: 'sun' },
    secondary: { id: 'bulwark', name: 'Solar Bulwark', key: 'RMB', cooldown: 0, hold: true, desc: 'Raise a 1400 HP sun-shield in front of you. Regenerates when lowered.' },
    ability1: { id: 'dawncharge', name: 'Dawn Charge', key: 'SHIFT', cooldown: 7, desc: 'Rocket forward (steer with the mouse). The first enemy hit is pinned and carried; drive them into a wall for 225 damage and a stun. Others in the way are knocked aside. SHIFT again to stop.', counter: "Meets Gorgoth's Abyss Charge head-on: it breaks and Gorgoth is stunned." },
    ability2: { id: 'shatter', name: 'Solar Shatter', key: 'E', cooldown: 16, desc: 'Slam the hammer into the ground: a 16m shockwave knocks every grounded enemy in front of you off their feet (75 dmg, 1s knockdown). Enemy barriers block it.' },
    ult: { id: 'colossus', name: 'Dawn Colossus Awakening', key: 'Q', cooldown: 0, charge: 2400, desc: 'The sun-reactor goes critical: Tenkai-Oh grows into a 7-metre giant - four times a hero’s height - for 15s. +600 armor, +25% damage, +20% speed and a longer hammer reach; the landing stomp deals 120 and stuns for 1s. Shrinks back when it ends.' },
    passive: { name: 'Heavy Frame / Sun Thrusters', desc: 'Immune to knockback, armor absorbs 30% of every hit. Hold SPACE in the air to fly on the foot thrusters for up to 6s. When the frame is destroyed Haruto fights on foot until he can call Tenkai-Oh back.' },
    jets: 6,
    lore: 'Tenkai-Oh was forged in Hangar Zero as the first Guardian Frame, piloted by Haruto Daimon - a mechanic\'s son who refused to let the Eclipse take another city. Its sun-reactor was stolen by the Syndicate once. It will not happen twice.',
    inspiration: 'Classic super robot shows - hot-blooded pilot, a rocket-driven hammer, the giant dawn-light transformation.',
    voice: [110, 0.8],
    pilot: { id: 'haruto', name: 'Haruto Daimon', bio: "Seventeen, hot-blooded, and the only pilot Tenkai-Oh's sun-reactor ever synchronised with. Ejects in a golden escape pod when the frame goes down - and is back in the cockpit before the dust settles." },
  },
  {
    id: 'mirei', name: 'Mirei', title: 'The Starweaver', team: 'zenith', role: 'support', subrole: 'medic', frame: 'flyer', rival: 'nocturne',
    hp: 225, armor: 0, speed: 5.6, height: 1.7, radius: 0.42, color: '#8fd3ff', glow: '#bfe8ff',
    primary: { kind: 'projectile', damage: 22, rate: 4, range: 50, speed: 55, ammo: 24, reload: 1.4, sfx: 'star', fx: 'star' },
    secondary: { kind: 'beam', damage: 55, rate: 10, range: 18, heal: true, sfx: 'healbeam', fx: 'star' },
    ability1: { id: 'constellation', name: 'Constellation Link', key: 'SHIFT', cooldown: 12, desc: 'Link allies within 15m for 5s: 25 HP/s and immunity to silence, grounding and roots.', counter: "Linked allies shrug off Nocturne's Silence Aria." },
    ability2: { id: 'wish', name: 'Wish Barrier', key: 'E', cooldown: 10, desc: 'Wrap the ally you aim at (or yourself) in a 200 HP star shield for 4s.' },
    ult: FULL
      ? { id: 'rebirth', name: 'Stellar Rebirth', key: 'Q', cooldown: 0, charge: 2400, desc: 'Call every teammate who fell within the last 10s back to their feet: all of them within 15m, through walls, at full health where they fell. The reborn are untouchable for 2.25s and can move after 1.5s; you are untouchable for 1.5s while you sing.' }
      : { id: 'nova', name: 'Nova Requiem', key: 'Q', cooldown: 0, charge: 2200, desc: 'A healing supernova: allies within 25m heal 350 over 2.5s and deal +30% damage for 4s.' },
    passive: { name: 'Starwing Flight', desc: 'Hold SPACE to fly on crystal star-wings; out of flight energy, keep holding SPACE to float down slowly. F: Starwing Swoop - streak to the ally under your crosshair (30m, 2s cooldown); mid-swoop, SPACE slingshots you onward and CTRL launches you straight up. Energy regenerates on the ground.' },
    lore: 'The last apprentice of the Amatsu Star Choir, Mirei stitched her wings from the constellations the night the Eclipse swallowed her teacher\'s voice. She sings to keep the Vanguard alive - and to drown out a song she once loved.',
    inspiration: 'Angelic combat medics of team hero shooters, with a starlit idol-singer soul.',
    voice: [520, 0.2],
  },
  {
    id: 'kaien', name: 'Kaien', title: 'The Warding Monk', team: 'zenith', role: 'support', subrole: 'medic', frame: 'human', rival: 'kagemaru',
    hp: 225, armor: 0, speed: 5.5, height: 1.8, radius: 0.45, color: '#e8e4ff', glow: '#ffe28a',
    primary: { kind: 'projectile', damage: 17, pellets: 3, spread: 0.035, rate: 1.6, range: 45, speed: 48, ammo: 12, reload: 1.6, sfx: 'talisman', fx: 'talisman' },
    secondary: { kind: 'projectile', damage: 60, rate: 1.25, range: 40, speed: 40, heal: true, sfx: 'blessing', fx: 'talisman' },
    ability1: { id: 'spiritstep', name: 'Spirit Step', key: 'SHIFT', cooldown: 8, desc: 'Vanish into a scatter of paper and reappear 10m ahead.' },
    ability2: { id: 'seal', name: 'Warding Seal', key: 'E', cooldown: 14, desc: 'Inscribe a 7m seal for 6s: enemies inside are revealed, cannot stealth, teleport or dash, and burn 15/s. Allies heal 20/s.', counter: "Pins Kagemaru: no Veil of Night, no Shadow Step." },
    ult: { id: 'sealstorm', name: 'Divine Seal Storm', key: 'Q', cooldown: 0, charge: 2700, desc: '15s: ten thousand golden seals storm around you - a shield of them on you (300, re-formed every 4s), the rest hunt every enemy within 18m in sight (14 every half second) and mend every ally within 18m (22/s).' },
    passive: { name: 'Prayer Beads', desc: 'Healing an ally also heals Kaien for 30% of the amount (the Medic sub-role).' },
    lore: 'Kaien kept the gate of the Amatsu Sky Shrine alone for nine years. When a wolf-masked shadow slipped past him and set the shrine\'s sacred tree ablaze, he left the mountain for the first time - with ten thousand talismans and one name.',
    inspiration: 'Onmyoji exorcist and shrine-guardian anime.',
    voice: [180, 0.4],
  },
  {
    id: 'raijin', name: 'Raijin', title: 'The Stormblade', team: 'zenith', role: 'dps', subrole: 'flanker', frame: 'human', rival: 'enra',
    hp: 225, armor: 0, speed: 6.2, height: 1.8, radius: 0.44, color: '#ffe066', glow: '#8ad8ff',
    primary: { kind: 'melee', damage: 48, rate: 2.2, range: 3.2, sfx: 'katana', fx: 'bolt' },
    secondary: { kind: 'projectile', damage: 42, rate: 1.1, range: 40, speed: 70, ammo: 3, reload: 2.4, sfx: 'thunder', fx: 'bolt' },
    ability1: { id: 'flashstep', name: 'Flash Step', key: 'SHIFT', cooldown: 7, desc: 'Lightning dash 12m, 50 dmg to every enemy you pass through.' },
    ability2: { id: 'parry', name: 'Thunder Parry', key: 'E', cooldown: 10, desc: '1.2s stance: reflect projectiles and hooks, stun melee attackers for 1s.', counter: "Reflects Enra's Chain of Oblivion and stuns him on contact." },
    ult: FULL
      ? { id: 'susanoo', name: 'Storm Sovereign', key: 'Q', cooldown: 0, charge: 2400, desc: 'A holographic giant of yourself in the robes of a thunder god rises where you stand. For 5s every enemy within 12m of it is struck by lightning from the sky (40 a second, the first strike stuns); for the next 5s the giant cuts down whoever is still inside (60 a swing); then it fades. You fight on freely.' }
      : { id: 'judgment', name: "Raijin's Judgment", key: 'Q', cooldown: 0, charge: 1700, desc: '6s: +30% speed, each slash chains lightning to 2 enemies (40 dmg), Flash Step resets on kills.' },
    passive: { name: 'Double Jump', desc: 'Jump again in mid-air.' },
    lore: 'Neo-Kurogane\'s underground dueling champion, Raijin carries a katana that was struck by lightning on the night of his mother\'s funeral. The oni who burned his district down is still out there, laughing in the red.',
    inspiration: 'Lightning-swordsman shonen rivals and cyberpunk samurai anime.',
    voice: [240, 0.6],
  },
  {
    id: 'yuzu', name: 'Yuzu', title: 'The Dawnshot', team: 'zenith', role: 'dps', subrole: 'sharpshooter', frame: 'human', rival: 'hex',
    hp: 200, armor: 0, speed: 5.6, height: 1.62, radius: 0.4, color: '#ffa94d', glow: '#ffd27a',
    primary: { kind: 'charge', damage: 125, rate: 1.1, range: 120, speed: 120, ammo: 1, sfx: 'bow', fx: 'sun' },
    secondary: { id: 'zoom', name: 'Hawk Eye', key: 'RMB', cooldown: 0, hold: true, desc: 'Zoom in. Full-charge headshots deal double damage.' },
    ability1: { id: 'sunhop', name: 'Sunhop', key: 'SHIFT', cooldown: 7, desc: 'Leap high and glide for 1.5s.' },
    ability2: { id: 'reveal', name: 'Revealing Dawn Arrow', key: 'E', cooldown: 12, desc: 'An arrow that bursts in 10m: reveals enemies through walls for 5s, severs marionette strings and cleanses hexes.', counter: "Severs Hex's Marionette Strings and strips his curses." },
    ult: { id: 'hundredsuns', name: 'Hundred Suns Barrage', key: 'Q', cooldown: 0, charge: 2000, desc: 'Call 40 arrows of light down on the target area over 3s (25 dmg each).' },
    passive: { name: 'Dawn Eyes', desc: 'Enemies she damages are marked for allies for 3s.' },
    lore: 'Top of her class at Zenith Academy, Yuzu can split a falling leaf at three hundred metres. Her twin brother vanished into the Eclipse Rift during a training exercise. The puppeteer\'s newest doll wears his scarf.',
    inspiration: 'Archery-club sports anime meets post-apocalyptic sniper series.',
    voice: [440, 0.3],
  },
  // ============================================================ UMBRA SYNDICATE
  {
    id: 'gorgoth', name: 'Gorgoth', title: 'The Abyss Engine', team: 'umbra', role: 'tank', subrole: 'bruiser', frame: 'mech', rival: 'tenkai',
    hp: 450, armor: 200, speed: 4.8, height: 3.4, radius: 0.95, color: '#ff3355', glow: '#ff2244',
    primary: { kind: 'hitscan', damage: 9, pellets: 9, spread: 0.075, rate: 1.7, range: 22, ammo: 8, reload: 2.0, sfx: 'shotgun', fx: 'void' },
    secondary: { id: 'plating', name: 'Void Plating', key: 'RMB', cooldown: 12, desc: 'Coat yourself (250) and allies within 8m (100) in a 3s void shield.' },
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
    id: 'nocturne', name: 'Lady Nocturne', title: 'The Crimson Diva', team: 'umbra', role: 'support', subrole: 'medic', frame: 'flyer', rival: 'mirei',
    hp: 225, armor: 0, speed: 5.6, height: 1.75, radius: 0.42, color: '#ff4d6d', glow: '#ff2d55',
    primary: { kind: 'projectile', damage: 20, rate: 4, range: 45, speed: 50, ammo: 28, reload: 1.5, sfx: 'note', fx: 'blood' },
    secondary: { kind: 'beam', damage: 55, rate: 10, range: 18, heal: true, sfx: 'healbeam2', fx: 'blood' },
    ability1: { id: 'silence', name: 'Silence Aria', key: 'SHIFT', cooldown: 12, desc: 'A 12m sonic cone: silences enemies for 1s and grounds flyers for 2.5s.', counter: "Rips Mirei out of the sky and cuts off Raijin's Flash Step." },
    ability2: { id: 'bloodpact', name: 'Blood Pact', key: 'E', cooldown: 10, desc: 'Grant the ally you aim at (or yourself) 30% lifesteal and +25% speed for 4s.' },
    ult: { id: 'requiem', name: 'Requiem of the Crimson Moon', key: 'Q', cooldown: 0, charge: 2300, desc: 'Allies within 20m heal 250 over 3s; enemies within 20m bleed 100 over 3s.' },
    passive: { name: 'Blood Harmony', desc: 'Hold SPACE to fly on crimson bat wings. 50% of damage dealt heals the most injured nearby ally.' },
    lore: 'Once the prima voice of the Amatsu Star Choir - and Mirei\'s teacher - Nocturne traded her light for eternal youth beneath the Crimson Moon. She says she sings for the Syndicate now. She still hums Mirei\'s lullaby when she thinks no one is listening.',
    inspiration: 'Gothic vampire-queen anime and tragic idol villainesses.',
    voice: [330, 0.5],
  },
  {
    id: 'hex', name: 'Hex', title: 'The Dollmaker', team: 'umbra', role: 'support', subrole: 'tactician', frame: 'human', rival: 'yuzu',
    hp: 225, armor: 0, speed: 5.3, height: 1.95, radius: 0.42, color: '#b56dff', glow: '#c77dff',
    primary: { kind: 'projectile', damage: 12, pellets: 3, spread: 0.03, rate: 3, range: 40, speed: 75, ammo: 30, reload: 1.5, sfx: 'needle', fx: 'hex' },
    secondary: { kind: 'projectile', damage: 55, rate: 1.2, range: 35, speed: 35, heal: true, sfx: 'stitch', fx: 'hex' },
    ability1: { id: 'marionette', name: 'Marionette Strings', key: 'SHIFT', cooldown: 12, desc: 'Tether an enemy within 20m; after 0.6s they are yanked 8m toward you and rooted for 1s.' },
    ability2: { id: 'grievous', name: 'Grievous Hex', key: 'E', cooldown: 12, desc: 'A curse bomb: 6m zone for 3s, enemies inside receive 80% less healing and take 10/s.', counter: "Starves Mirei's and Kaien's heals." },
    ult: { id: 'theater', name: 'Grand Puppet Theater', key: 'Q', cooldown: 0, charge: 2500, desc: FULL ? 'Fifty masked puppets rise around you and fight for you for 15s, then fall lifeless. While they stand, every teammate within 15m of you (you too) is mended 20 HP/s. They fall at once if you do.' : 'Every enemy within 15m is rooted and takes +30% damage for 2.5s.' },
    passive: { name: 'Stitched Decoy', desc: 'A single hit over 90 damage is taken by a doll instead (15s cooldown). Counters Yuzu\'s charged shots.' },
    lore: 'No one has seen the face behind the porcelain. Hex collects "students" from the Eclipse Rift and restitches them into perfect, obedient dolls. His favourite still whispers a girl\'s name.',
    inspiration: 'Creepy puppeteer antagonists from dark-fantasy anime.',
    voice: [150, 0.7],
  },
  {
    id: 'kagemaru', name: 'Kagemaru', title: 'The Shade Fang', team: 'umbra', role: 'dps', subrole: 'flanker', frame: 'human', rival: 'kaien',
    hp: 225, armor: 0, speed: 6.4, height: 1.78, radius: 0.42, color: '#7b61ff', glow: '#9d7bff',
    primary: { kind: 'projectile', damage: 28, rate: 3, range: 50, speed: 90, ammo: 18, reload: 1.4, sfx: 'kunai', fx: 'shadow' },
    secondary: { kind: 'melee', damage: 55, rate: 1.2, range: 3.2, sfx: 'fang', fx: 'shadow' },
    ability1: { id: 'shadowstep', name: 'Shadow Step', key: 'SHIFT', cooldown: 6, desc: 'Teleport up to 15m to the point you aim at, leaving smoke.' },
    ability2: { id: 'veil', name: 'Veil of Night', key: 'E', cooldown: 12, desc: 'Turn invisible for 4s with +30% speed; your first strike from the veil deals +50.' },
    ult: { id: 'thousandcuts', name: 'Thousand Shadow Cuts', key: 'Q', cooldown: 0, charge: 2100, desc: 'Blink through up to 5 enemies within 15m, 120 dmg each.' },
    passive: { name: 'Severing Fang', desc: 'Twin Fang slashes (RMB) shatter enemy seals, sanctums and zones within 3m.' },
    lore: 'Kagemaru was the shrine\'s orphan, raised by Kaien\'s master and passed over for the guardian\'s seal. He burned the sacred tree to prove seals mean nothing. He is still trying to prove it.',
    inspiration: 'Shinobi-clan revenge anime and masked rival brothers.',
    voice: [200, 0.85],
    // Severing Fang (secondary) is his counter to Kaien
  },
  {
    id: 'enra', name: 'Enra', title: 'The Crimson Oni', team: 'umbra', role: 'dps', subrole: 'flanker', frame: 'human', rival: 'raijin',
    hp: 250, armor: 0, speed: 5.8, height: 2.05, radius: 0.5, color: '#ff5a1f', glow: '#ff6a2a',
    // the Hellfire Chains (after Kratos' Blades of Chaos): two curved blades on chains from the wrists - the primary a wide
    // alternating arc that lands on everyone in it, the secondary a blade thrown out on its chain, straight and far
    primary: { kind: 'melee', name: 'Hellfire Chains', damage: 55, rate: 1.6, range: 5, sweep: true, delay: 0.12, sfx: 'katana', fx: 'flame' },
    secondary: { kind: 'melee', name: 'Chain Throw', damage: 80, rate: 0.55, range: 7.5, sfx: 'chainhit', fx: 'flame' },
    ability1: { id: 'chain', name: 'Chain of Oblivion', key: 'SHIFT', cooldown: 8, desc: 'Hurl a chain 18m: roots the target for 1.2s and hauls you to them.', counter: "Roots Raijin mid-dash and cancels Flash Step." },
    ability2: { id: 'brand', name: 'Eclipse Brand', key: 'E', cooldown: 10, desc: 'Brand enemies in a 6m cone: 12 dmg/s and -20% speed for 5s.' },
    ult: { id: 'effigy', name: 'Crimson Effigy', key: 'Q', cooldown: 0, charge: 2000, desc: '10s: a giant crimson hologram of the oni rises behind you and fights on its own - every 0.9s its chain blades land on every enemy within 12m of you (45 damage, knocked back). Nothing can touch it.' },
    passive: { name: 'Oni Blood', desc: 'Your health regeneration (20 HP/s) starts 2.5s after you were last hit instead of 5s.' },
    lore: 'An oni sealed beneath Neo-Kurogane for a thousand years until the Eclipse cracked the city\'s foundation stone. Enra burned the district to find the one blade that ever wounded him - and found it in a boy\'s hands.',
    inspiration: 'Demon-slaying shonen and oni folklore berserkers.',
    voice: [95, 0.9],
  },
  {
    id: 'gantetsu', name: 'Gantetsu', title: 'The Iron Yokozuna', team: 'umbra', role: 'tank', subrole: 'bruiser', frame: 'human', rival: 'tenkai',
    hp: 425, armor: 200, speed: 5.2, height: 2.4, radius: 0.62, color: '#34d1bf', glow: '#ff8a3d',
    primary: { kind: 'hitscan', name: 'Hinoko Incendiary Chaingun', damage: 4.5, rate: 16, range: 32, spread: 0.032, ammo: 250, reload: 1.7, sfx: 'chaingun', fx: 'flame' },
    secondary: { kind: 'hitscan', name: 'Hanabi Volatile Chaingun', damage: 4.5, rate: 16, range: 32, spread: 0.032, ammo: 250, reload: 1.7, sfx: 'chaingun2', fx: 'flame' },
    ability1: { id: 'tachiai', name: 'Tachiai Rush', key: 'SHIFT', cooldown: 8, desc: 'Charge forward for up to 2.5s, unstoppable and still firing (steer with the mouse). Enemies you plough into are shoved aside for 30 damage and set alight. Press SPACE - or let the charge run out - to leap into a Shiko Stomp: every enemy within 7m is thrown off their feet and left stunned on the ground (120 damage at the heart of the slam, 60 further out).', counter: "Unstoppable: Dawn Charge can't pin him, and ploughing into the Solar Bulwark cracks it for 300." },
    ability2: { id: 'taiko', name: 'Taiko Heartbeat', key: 'E', cooldown: 12, desc: 'Pound the festival rhythm on your chest for 3s: you take 30% less damage, and you and every ally within 12m heal by dealing damage - allies for half of it, Gantetsu for all of it.' },
    ult: { id: 'dohyo', name: 'Grand Dohyo', key: 'Q', cooldown: 0, charge: 2400, desc: 'Stamp a sacred sumo ring 18m wide around you for 8s. Holographic chains bind every enemy caught inside to the ring: they cannot leave, dash, teleport or fly. Enemy fire cannot cross the rope wall, and your chainguns never need reloading.' },
    passive: { name: 'Roar of the Crowd', desc: 'Critical hits - headshots, or Hanabi rounds into burning enemies - grant temporary health (up to 150) that fades 2s after your last crit. Hinoko rounds set enemies alight after sustained fire.' },
    lore: 'Gantetsu was the youngest grand champion the festival rings of Neo-Kurogane ever crowned - until he threw a title bout rather than let the Syndicate fix it, and was banished from every dohyo in the city. Now he fights in the Syndicate\'s underground arenas for the only thing they cannot take from him: the roar of the crowd. He still bows before every fight. He still laughs through every one.',
    inspiration: 'Festival sumo champions, taiko drummers and big-hearted brawler rivals of shonen tournament arcs.',
    voice: [85, 0.85], dualGuns: true, full: true,
  },
  {
    id: 'hibiki', name: 'Hibiki', title: 'The Street Frequency', team: 'zenith', role: 'support', subrole: 'tactician', frame: 'human', rival: 'gantetsu',
    hp: 225, armor: 0, speed: 3.05, height: 1.82, radius: 0.42, color: '#39d6ff', glow: '#7dffcf',
    primary: { kind: 'projectile', name: 'Subwoofer Blaster', damage: 20, rate: 1.15, burst: 4, burstGap: 0.065, range: 40, speed: 52, ammo: 20, reload: 1.5, sfx: 'sonic', fx: 'sonic' },
    secondary: { id: 'scratch', name: 'Scratch Wave', key: 'RMB', cooldown: 4, desc: 'Scratch a shockwave off the deck: enemies in an 8m cone in front of you take 35 damage and are knocked back hard. After 5s of Mag-Grinding the next Scratch Wave is empowered (+50% damage, +25% knockback).' },
    ability1: { id: 'crossmix', name: 'Crossmix', key: 'SHIFT', cooldown: 0.4, desc: 'Swap tracks. Healing Groove: allies within 12m you can see heal 20 HP/s (you 12 HP/s). Tempo Rush: they move 25% faster.', counter: 'Max Volume on Tempo Rush lets allies break out of the Grand Dohyo.' },
    ability2: { id: 'maxvolume', name: 'Max Volume', key: 'E', cooldown: 12, desc: 'Crank the current track for 3s: Healing Groove heals 56 HP/s, Tempo Rush becomes +60% speed.' },
    ult: { id: 'bassdrop', name: 'Bass Drop', key: 'Q', cooldown: 0, charge: 2800, desc: 'Leap up and slam the drop: every ally within 30m you can see gains 750 temporary health that fades away over 6s.' },
    passive: { name: 'Mag-Grind', desc: 'Jump at a wall and hold SPACE to grind along it on your mag-skates (+30% speed, no falling). Release SPACE to launch off it. 5s of grinding empowers your next Scratch Wave.' },
    lore: "Hibiki ran pirate radio out of a flooded subway car under Neo-Kurogane - the Night Frequency, the only station the Syndicate could never find or silence. When the Eclipse cut the city's power he wired his decks to a stolen Zenith reactor cell and discovered that the right bassline could knit bone and put wings on a tired runner's feet. Now the Vanguard's street team has a DJ, and every fight has a soundtrack.",
    inspiration: 'Street DJs, jet-set rollerblade culture, pirate radio and the healers of shonen team battles who fight with rhythm.',
    voice: [150, 0.55], full: true,
  },
  {
    id: 'tomoe', name: 'Tomoe', title: 'The Crescent Empress', team: 'zenith', role: 'tank', subrole: 'stalwart', frame: 'human', rival: 'gantetsu',
    hp: 525, armor: 0, speed: 5.6, height: 2.0, radius: 0.5, color: '#e9c46a', glow: '#5ff2e0',
    primary: { kind: 'hitscan', name: 'Crownfire Scattergun', damage: 8, pellets: 10, spread: 0.07, rate: 1.25, range: 24, ammo: 6, reload: 1.6, sfx: 'scattergun', fx: 'tide' },
    secondary: { id: 'crescent', name: 'Crescent Fang', key: 'RMB', cooldown: 6, desc: 'Throw your jagged blade: 55 damage and a wound (30 over 3s). It sticks in whatever it hits - press RMB again to recall it. Stuck in an enemy, it drags them toward you; flying back, it cuts everyone in its path. Recalled out of a flyer, it drags them down and grounds them for 1.5s. The cooldown starts when it is back in your hand.' },
    ability1: { id: 'warcall', name: 'Horagai War Call', key: 'SHIFT', cooldown: 15, desc: 'Sound the war conch: you gain 150 and every ally within 15m you can see gains 75 temporary health for 3s, and all of you move 30% faster.' },
    ability2: { id: 'reaping', name: 'Crescent Reaping', key: 'E', cooldown: 8, desc: 'Heave the great axe round in a cleave (5.5m, wide): 90 damage and a wound (40 over 3s). Every enemy it cuts takes 1s off the cooldown.', counter: "Her wounds bleed straight through Gantetsu's armor plating - no reduction, and his Taiko Heartbeat lifesteal can't outpace a Warpath's anti-heal." },
    ult: { id: 'tide', name: 'Crescent Warpath', key: 'Q', cooldown: 0, charge: 2600, desc: 'Zoom 20m forward, unstoppable, the axe wheeling around you, straight through every enemy in the way. Each one you pass is cut for 40, wounded (90 over 3s), cannot be healed for 3.5s, and is MARKED for 8s: a blue glow, and 20% more damage from every hit, anyone\'s. Click to stop early. Crescent Reaping and the Crescent Fang are ready again when it ends.' },
    passive: { name: 'Blood Tide', desc: 'Heal for 150% of the damage your wounds deal. Quick melee with the Crescent Fang in hand wounds too (15 over 3s).' },
    lore: "Tomoe held the Salt Gate - the last harbour gate of Neo-Kurogane the Syndicate never breached - for eleven nights with a shotgun, an axe and a blade she could call back to her hand. The dock clans crowned her on the twelfth morning with a circlet cut from the gate's own brass horns. She never asked for a throne; she asked for a fight worth the crown. The Vanguard gave her one.",
    inspiration: 'Onna-musha of the war chronicles, harbour warlords, and the battle-queens of shonen arcs who lead from the front and heal from the fight itself.',
    voice: [120, 0.7], full: true,
  },
  // ============================================================ the Koryu brothers (desktop edition)
  {
    id: 'hayate', name: 'Hayate', title: 'The Rebuilt Blade', team: 'zenith', role: 'dps', subrole: 'flanker', frame: 'human', rival: 'seiran', full: true,
    hp: 225, armor: 0, speed: 6.4, height: 1.78, radius: 0.42, color: '#4fe3c1', glow: '#7ff5d8',
    // the big koi-scale shuriken (prop_hayate_shuriken_v2, Tripo; the first, smaller one until it is published): every one
    // skips off up to two walls and, off a wall or out of a body, turns on the next enemy within 12 m of him it hasn't cut
    // (SEEK_DMG of the damage for each extra target) - a ricochet he can bank round corners
    primary: { kind: 'projectile', name: 'Koi-Scale Shuriken', damage: 27, rate: 1.05, range: 45, speed: 62, burst: 3, burstGap: 0.08, ammo: 24, reload: 1.4, sfx: 'shuriken', fx: 'tide', mesh: 'prop_hayate_shuriken_v2', spin: 30, bounce: 2, seek: 12,
      note: 'Ricochets off walls, and off a wall or out of an enemy it hunts the next enemy within 12m of you (70% damage per extra target).' },
    secondary: { kind: 'projectile', name: 'Fan of Scales', damage: 27, rate: 1.4, range: 38, speed: 62, pellets: 3, spread: 0.11, sfx: 'shuriken', fx: 'tide', mesh: 'prop_hayate_shuriken_v2', spin: 30, bounce: 2, seek: 12 },
    ability1: { id: 'currentdash', name: 'Current Dash', key: 'SHIFT', cooldown: 8, desc: 'Dash 15m through enemies, cutting each for 50. Resets when you get an elimination.' },
    ability2: { id: 'mirrorwater', name: 'Mirror Water', key: 'E', cooldown: 8, desc: '2s: the blade comes up and everything that comes at you from in front is turned on it - shots and gunfire go back out where you are aiming, blows stop dead. E again to lower it.', counter: "Turns Seiran's Scatter Current back on him." },
    ult: { id: 'dragongate', name: 'Dragon Gate Blade', key: 'Q', cooldown: 0, charge: 2000, desc: 'Draw the nodachi for 8s: your primary becomes a sweeping blade (110 damage a slash, 5m) that looses the koi-dragon through every cut, and you move 30% faster. Current Dash still resets on an elimination.' },
    passive: { name: 'Sun-Alloy Frame', desc: 'Double jump, and climb any wall or building: jump at it and hold SPACE (or keep tapping it) to run up it and vault onto the roof. The faster you tap SPACE, the faster he runs and climbs - up to five times his pace.' },
    lore: "The younger son of the Koryu, the waterfront clan that bowed to the Syndicate. Hayate laughed at the clan, at the debt, at the Syndicate - until his brother was ordered to silence him on the Dragon Gate falls. The river gave him back to Hangar Zero, where Haruto's father rebuilt him in sun-alloy around what was left. Now he fights beside the Vanguard, and carries the koi-dragon his brother still thinks he killed.",
    inspiration: 'The cyber-ninja brother of a feuding assassin clan: rebuilt body, dash-and-deflect duelling, a spirit dragon in the blade.',
    voice: [300, 0.55],
  },
  {
    id: 'seiran', name: 'Seiran', title: 'The Silent Current', team: 'umbra', role: 'dps', subrole: 'sharpshooter', frame: 'human', rival: 'hayate', full: true,
    hp: 225, armor: 0, speed: 5.6, height: 1.84, radius: 0.43, color: '#3f7fff', glow: '#8ec5ff',
    primary: { kind: 'charge', name: 'Riverbow', damage: 125, rate: 1.05, range: 120, speed: 115, ammo: 1, sfx: 'bow', fx: 'tide' },
    secondary: { kind: 'projectile', name: 'Scatter Current', damage: 25, rate: 0.55, range: 60, speed: 105, pellets: 5, spread: 0.1, sfx: 'bow', fx: 'tide' },
    ability1: { id: 'riverstep', name: 'Riverstep', key: 'SHIFT', cooldown: 4, desc: 'Kick off the air in the direction you are moving - a 7m lunge, even mid-air.' },
    ability2: { id: 'echoarrow', name: 'Echo Arrow', key: 'E', cooldown: 11, desc: 'An arrow that sings where it lands: reveals every enemy within 10m through walls for 5s.', counter: 'Hayate can hide from the eye, never from the ear - Echo Arrow exposes him mid-dash.' },
    ult: { id: 'twinkoi', name: 'Twin Koi Torrent', key: 'Q', cooldown: 0, charge: 2000, desc: 'Loose the twin spirit koi of the clan: they swim 45m through walls in a spiral, tearing through everything in their path.' },
    passive: { name: 'Heir of the Falls', desc: 'Climb walls by moving into them while airborne.' },
    lore: "Heir of the Koryu and his father's debt, Seiran did what the Syndicate asked of the clan: he cut his brother down on the Dragon Gate falls. The clan was absorbed anyway. Now he is Warlord Vorn's marksman, a man who belongs to no one, and every year on the anniversary he floats a koi lantern down the river - for a brother who is fighting on the other side, and whom he has not yet recognised.",
    inspiration: 'The elder archer brother of a feuding assassin clan: discipline, regret and a pair of spirit dragons.',
    voice: [150, 0.5],
  },
];

export const HERO: Record<string, HeroDef> = Object.fromEntries(HEROES.map(h => [h.id, h]));
/** the roster an edition offers (the web build keeps the original ten) */
export const rosterFor = (full: boolean) => HEROES.filter(h => full || !h.full);

// ---- pilots on foot: when Tenkai-Oh's frame is destroyed, Haruto ejects and keeps fighting (a mech-pilot tank in the
// hero-shooter tradition) until his Call Mech gauge fills and the frame drops back from the sky
export const PILOTS: Record<string, HeroDef> = {
  tenkai: {
    id: 'haruto', name: 'Haruto Daimon', title: "Tenkai-Oh's pilot", team: 'zenith', role: 'tank', frame: 'human', rival: 'gorgoth',
    hp: 175, armor: 0, speed: 5.9, height: 1.75, radius: 0.4, color: '#f4d35e', glow: '#ffd76a',
    primary: { kind: 'hitscan', name: 'Sunspark Blaster', damage: 16, rate: 7, range: 35, spread: 0.012, ammo: 20, reload: 1.3, sfx: 'blaster', fx: 'sun' },
    secondary: { kind: 'projectile', name: 'Flare Round', damage: 45, splash: 1.5, rate: 0.8, range: 40, speed: 45, sfx: 'cannon', fx: 'sun' },
    ability1: { id: 'pilotroll', name: 'Combat Roll', key: 'SHIFT', cooldown: 5, desc: 'Roll 5m in the direction you are moving.' },
    ability2: { id: 'none', name: 'Out of the mech', key: 'E', cooldown: 0, desc: 'Survive until Tenkai-Oh is back.' },
    ult: { id: 'callmech', name: 'Call Tenkai-Oh', key: 'Q', cooldown: 0, charge: 400, desc: 'Tenkai-Oh drops from the sky at full health and Haruto climbs back into the cockpit.' },
    passive: { name: 'Pilot', desc: 'Out of the mech, the Call Tenkai-Oh gauge charges fast (20/s plus damage dealt).' },
    lore: "Seventeen, hot-blooded, and the only pilot Tenkai-Oh's sun-reactor ever synchronised with.",
    inspiration: 'The mech pilot who keeps fighting after the frame goes down.',
    voice: [180, 0.3], gunProp: true,
  },
};
export const PILOT_BY_ID: Record<string, HeroDef> = Object.fromEntries(Object.values(PILOTS).map(p => [p.id, p]));
export const TEAM_NAME: Record<TeamId, string> = { zenith: 'Zenith Vanguard', umbra: 'Umbra Syndicate' };
export const TEAM_COLOR: Record<TeamId, string> = { zenith: '#5cc8ff', umbra: '#ff3b5c' };
