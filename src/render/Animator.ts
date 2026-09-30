// Procedural animation for the shared humanoid rig (Blender auto-rig and the fallback mannequin use the same bone names).
// Everything is solved in MODEL space (Y up, +Z forward, +X = character's left) as a delta on top of the rest pose:
//  - legs: 2-bone IK toward foot targets driven by a distance-based gait phase, so planted feet never slide
//  - spine/neck/head: FK lean + aim pitch; arms: swing, or IK toward the aim line when attacking / casting
//  - flyers: body lean into velocity, dangling legs, flapping wing bones; mechs: slow heavy stride with stomp events
// On top sits the hero-shooter performance layer (after Blizzard's Overwatch animation talks - Gibson GDC16, Boehm GDC17,
// Davis GDC17): a per-hero PERSONA (stance, weight, carriage, contrapposto, spring-aim tightness), squash & stretch on
// jumps and landings, overshoot-and-settle springs everywhere, the body leading and the head following through on hits,
// a knockback tumble, and Mirei's angelic flight as a state machine (swoop, flare, superjump, descent, hover).
import * as THREE from 'three';

import { BONES, CHAIN_PREFIXES, RT_INDEX, type BoneName, type ChainPrefix, type RtBone } from './Rig';
import { HELD } from './HeldProps';
import { ClipLayer, poseDir, type LayerOut } from './ClipLayer';
import type { ClipLibrary } from './ClipLibrary';
import { FULL } from '../edition';
export { BONES };
/**
 * Hair and cloth: bone chains solved as XPBD particles in WORLD space (the method of VRM SpringBone / Kawaii Physics /
 * Dynamic Bone - what hero shooters use for capes, coats, hair and scarves): Verlet integration with drag (air
 * resistance - so a running hero's hair and coat stream behind and swing through when they stop), gravity, a stiffness
 * pull toward the animated pose, hard segment-length constraints, capsule / sphere colliders on the body measured from
 * each mesh (skirts can't pass through the legs, hair and capes can't pass through the torso or head), a ground plane,
 * ring constraints between neighbouring skirt panels (they don't split apart), angular limits, fixed 120 Hz sub-steps
 * with the anchors and colliders swept through the frame (fast dashes don't tunnel), and a light gusting wind.
 *   stiff / drag: fraction per 1/60 s toward the animated pose / of velocity lost; grav: g multiplier; maxA: radians
 */
type DynKind = 'hair' | 'tuft' | 'skirt' | 'cape' | 'sleeve';
// stiff / drag: [root, tip] per 1/60 s along the chain (roots hold the silhouette, tips carry the motion). inertT /
// inertR: how much of the character's own world move / turn the chain feels (1 = fully world space - at Hibiki's groove
// speed or a 180-degree flick that slammed every strand to its limit and through the colliders; Kawaii Physics' world
// damping). simW: sim vs the animated pose, a final blend (Blizzard's Ana coat: sim that still stays on-model).
// maxA: angular limit off the animated pose. Values: work/research_ow_dynamics.md (OW2: motion accents starts, stops,
// jumps and hits and settles within ~0.4 s; nothing crosses the face)
interface Dyn { stiff: [number, number]; drag: [number, number]; grav: number; maxA: number; wind: number; inertT: number; inertR: number; simW: number; cols: BoneName[] }
const DYN: Record<DynKind, Dyn> = {
  hair: { stiff: [0.26, 0.08], drag: [0.08, 0.11], grav: 0.6, maxA: 0.75, wind: 0.35, inertT: 0.55, inertR: 0.45, simW: 1, cols: ['head', 'neck', 'chest', 'spine', 'upperarm_L', 'upperarm_R'] },
  // hair standing up off the head (topknot, buns, dreadlocks): holds its shape against gravity, bounces with the head.
  // Solid masses (a bun is one lump of mesh): a small, stiff bounce - past ~15 degrees the mesh folds where the chain bends
  tuft: { stiff: [0.5, 0.3], drag: [0.12, 0.14], grav: 0.12, maxA: 0.26, wind: 0.15, inertT: 0.8, inertR: 0.7, simW: 1, cols: ['head'] },
  // wide sleeves: hang and swing off the forearm, can't pass through the torso, the thighs or the arm itself
  sleeve: { stiff: [0.3, 0.09], drag: [0.08, 0.1], grav: 0.95, maxA: 0.8, wind: 0.4, inertT: 0.6, inertR: 0.5, simW: 0.85, cols: ['spine', 'chest', 'hips', 'thigh_L', 'thigh_R', 'forearm_L', 'forearm_R'] },
  skirt: { stiff: [0.34, 0.12], drag: [0.08, 0.1], grav: 0.9, maxA: 0.55, wind: 0.3, inertT: 0.5, inertR: 0.4, simW: 0.7, cols: ['hips', 'spine', 'thigh_L', 'thigh_R', 'shin_L', 'shin_R'] },
  cape: { stiff: [0.24, 0.07], drag: [0.06, 0.09], grav: 1, maxA: 0.8, wind: 0.6, inertT: 0.4, inertR: 0.35, simW: 0.75, cols: ['spine', 'chest', 'hips', 'thigh_L', 'thigh_R', 'upperarm_L', 'upperarm_R'] },
};
/** per weight class (heavy cloth swings slower and less; silk gowns and flyers' hair stay livelier) and per hero */
const DYN_CLASS: Record<string, { stiff: number; drag: number; maxA: number; inertT: number }> = {
  heavy: { stiff: 1.25, drag: 1.2, maxA: 0.85, inertT: 0.9 }, light: { stiff: 0.85, drag: 0.9, maxA: 1.1, inertT: 1.05 },
};
const HERO_CLASS: Record<string, string> = { gantetsu: 'heavy', tomoe: 'heavy', enra: 'heavy', gorgoth: 'heavy', vorn: 'heavy', qelvaris: 'heavy', mirei: 'light', nocturne: 'light', yuzu: 'light' };
const HERO_DYN: Record<string, Partial<Record<DynKind, Partial<Dyn>>>> = {
  hibiki: { tuft: { inertT: 0.5, inertR: 0.5 } }, hibiki_armor: { tuft: { inertT: 0.5, inertR: 0.5 } },   // dreads at groove speed
  nocturne: { skirt: { simW: 0.6 } },                    // the ragged gown hem reads better with less sim
  kaien: { sleeve: { maxA: 0.65 } }, seiran: { sleeve: { maxA: 0.65 } },
};
/** character-relative particle speed limit (m/s): dashes stay readable and strands can't tunnel through the body */
const DYN_VMAX = 9;
const kindOf = (p: ChainPrefix): DynKind => p === 'hair_T' ? 'tuft' : p.startsWith('hair') ? 'hair' : p.startsWith('cape') ? 'cape' : p.startsWith('sleeve') ? 'sleeve' : 'skirt';
/** capsule colliders: bone head -> `to` bone head; radius as a fraction of the model height when the rig has no measurement */
const COLL: Partial<Record<BoneName, { to: BoneName; r: number }>> = {
  hips: { to: 'spine', r: 0.09 }, spine: { to: 'chest', r: 0.085 }, chest: { to: 'neck', r: 0.09 }, neck: { to: 'head', r: 0.035 },
  head: { to: 'head', r: 0.062 }, upperarm_L: { to: 'forearm_L', r: 0.035 }, upperarm_R: { to: 'forearm_R', r: 0.035 },
  forearm_L: { to: 'hand_L', r: 0.03 }, forearm_R: { to: 'hand_R', r: 0.03 },
  thigh_L: { to: 'shin_L', r: 0.052 }, thigh_R: { to: 'shin_R', r: 0.052 }, shin_L: { to: 'foot_L', r: 0.04 }, shin_R: { to: 'foot_R', r: 0.04 },
};
const SKIRT_RING: [ChainPrefix, ChainPrefix][] = [['skirt_F', 'skirt_L'], ['skirt_L', 'skirt_B'], ['skirt_B', 'skirt_R'], ['skirt_R', 'skirt_F']];
const chainChild: Partial<Record<BoneName, BoneName>> = {};
for (const pf of CHAIN_PREFIXES) for (let i = 1; i < 4; i++) chainChild[`${pf}_${i}` as BoneName] = `${pf}_${i + 1}` as BoneName;
const CHILD: Partial<Record<BoneName, BoneName>> = {
  ...chainChild,
  hips: 'spine', spine: 'chest', chest: 'neck', neck: 'head', shoulder_L: 'upperarm_L', upperarm_L: 'forearm_L', forearm_L: 'hand_L',
  shoulder_R: 'upperarm_R', upperarm_R: 'forearm_R', forearm_R: 'hand_R', thigh_L: 'shin_L', shin_L: 'foot_L', thigh_R: 'shin_R', shin_R: 'foot_R',
};

export interface AnimState {
  dt: number; time: number;
  vel: THREE.Vector3;       // world velocity
  yaw: number; pitch: number;
  grounded: boolean; flying: boolean; frame: string;
  attackAge: number; attackKind: string; castAge: number; castId: string; hitAge: number; landAge: number; jumpAge: number;
  stunned: boolean; charging: boolean; beam: boolean; barrier: boolean; rooted: boolean;
  parry?: boolean;          // a blade deflect held (Raijin's Thunder Parry, Hayate's Mirror Water)
  climb?: boolean;          // running up a wall (the Koryu brothers)
  charge?: number;          // how far a charge weapon is drawn (0..1)
  melee?: boolean;          // primary is a melee weapon (bigger swings, lunges)
  hammer?: boolean;         // two-handed hammer (Tenkai-Oh): arms follow the hammer's authored swing path
  move?: string;            // an ability pose in progress: 'dawncharge' | 'shatter' | 'jets' | 'reaping' | 'tide' (Tomoe's axe)
  swingSide?: number;       // +1 sweeps right-to-left, -1 left-to-right (swings alternate)
  angel?: boolean;          // Mirei: angelic combat-medic flight (upright hover, swept-back dash, glide)
  gliding?: boolean;        // slow-fall glide with the wings spread
  dead?: boolean;           // clip layer: play a death clip (CharacterView only keeps animating the dead if one exists)
  deathAge?: number;
  attackTime?: number;      // seconds between primary attacks (melee combo hits are time-scaled to it)
  reloadLeft?: number;      // seconds of reload remaining (0 = not reloading)
  reloadDur?: number;       // the weapon's full reload time (the reload clip is time-scaled into it)
  scale: number;            // world metres per model unit
  pos: THREE.Vector3;       // actor world position (feet)
  hero?: string;            // persona lookup
  hitDir?: [number, number];   // model-space direction TO the last attacker (x = the character's left, z = front)
  knocked?: boolean;        // shoved / pulled / launched: a floaty tumble with the body leading away from the push
  swoop?: number;           // Mirei: progress 0..1 of a Starwing Swoop in flight (-1 = none)
  swoopFlare?: number;      // seconds since a swoop arrived (the braking flare), 9 = long ago
  superjump?: boolean;      // launched straight up out of a swoop
  slingshot?: boolean;      // flung onward out of a swoop
  dual?: { fireL: number; fireR: number };   // twin chainguns: seconds since each gun last fired
  rush?: boolean;           // Gantetsu's Tachiai Rush (head down, shoulders in, guns tucked)
  twirl?: number;           // Tomoe's Crescent Warpath: the angle (radians) her axe and her Fang have spun in her hands
  leap?: boolean;           // Gantetsu's Shiko leap (status 'stompair'): knees wide, both guns hauled overhead for the slam
  knockdown?: number;       // knocked flat on the ground: seconds left (the last ~0.3 s is the get-up); 0 = standing
  skate?: boolean;          // Hibiki: mag-skates - a gliding skate stride instead of a run
  grind?: number;           // Hibiki's Mag-Grind: which side the wall is on (-1 / 1), 0 = not grinding
}

interface Rest { q: THREE.Quaternion; p: THREE.Vector3; dir: THREE.Vector3; }

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion(), _q5 = new THREE.Quaternion();
const WRIST_MAX = 0.7;       // radians of wrist bend a clip may add on top of the forearm (~40 deg)

/**
 * How a hero carries themselves (Gibson: the idle pose alone should say class, speed and personality; Boehm: spring aims
 * are tuned per hero - a gunslinger leads tight, a floating monk flows and snaps, a heavy swings loose).
 *  weight  0 light .. 1 heavy: staccato stomping gait, footfall punctuation, bigger landing squash, smaller takeoff stretch
 *  bounce  extra vertical bob in the run          lean    forward lean into the run
 *  stance  knee bend / weight low at idle          width   stance width (1 = the clip's own)
 *  chest   chest carriage: + proud and open, - hunched / aggressive
 *  hip     contrapposto: weight on one leg, hip cocked, shoulders countering (swaps every few seconds)
 *  sway    idle weight-shift amplitude             aimK / aimD   stiffness / damping of the upper body's aim lag spring
 *  lag     how far the upper body trails a fast turn (the eyes stay on target)   squash  squash & stretch amount
 */
interface Persona { weight: number; bounce: number; lean: number; stance: number; width: number; chest: number; hip: number; sway: number; aimK: number; aimD: number; lag: number; squash: number; }
const PERSONA: Record<string, Persona> = {
  // fast duellist: knees always bent, tight snappy aim, a springy run
  raijin: { weight: 0.2, bounce: 0.6, lean: 0.9, stance: 0.8, width: 1.12, chest: -0.04, hip: 0.15, sway: 0.5, aimK: 240, aimD: 21, lag: 0.5, squash: 1.0 },
  // archer: upright and composed, steady draw
  yuzu: { weight: 0.25, bounce: 0.45, lean: 0.55, stance: 0.35, width: 1.02, chest: 0.08, hip: 0.5, sway: 0.4, aimK: 200, aimD: 19, lag: 0.6, squash: 0.85 },
  // warding monk: wide rooted stance, smooth flowing aim that settles
  kaien: { weight: 0.3, bounce: 0.2, lean: 0.3, stance: 0.45, width: 1.18, chest: 0.06, hip: 0.1, sway: 0.3, aimK: 120, aimD: 13, lag: 0.9, squash: 0.5 },
  // angelic medic: light on her feet, feet close, graceful contrapposto, floaty aim
  // street skater: low, loose and bouncy, leaning into every push
  tomoe: { weight: 0.62, bounce: 0.35, lean: 0.62, stance: 0.72, width: 1.25, chest: 0.07, hip: 0.3, sway: 0.5, aimK: 115, aimD: 12, lag: 1.05, squash: 0.7 },
  hibiki: { weight: 0.1, bounce: 0.45, lean: 1.0, stance: 0.9, width: 1.1, chest: -0.02, hip: 0.35, sway: 0.9, aimK: 190, aimD: 17, lag: 0.7, squash: 1.1 },
  mirei: { weight: 0.08, bounce: 0.35, lean: 0.35, stance: 0.12, width: 0.8, chest: 0.12, hip: 0.95, sway: 0.7, aimK: 105, aimD: 11, lag: 1.0, squash: 0.75 },
  // diva: poised, chest high, cocked hip
  nocturne: { weight: 0.12, bounce: 0.25, lean: 0.3, stance: 0.06, width: 0.85, chest: 0.14, hip: 1.0, sway: 0.6, aimK: 115, aimD: 12, lag: 0.9, squash: 0.6 },
  // puppeteer: tall, hunched, an eerie loose drift
  hex: { weight: 0.3, bounce: 0.15, lean: 0.2, stance: 0.15, width: 0.92, chest: -0.14, hip: 0.3, sway: 0.85, aimK: 85, aimD: 9, lag: 1.1, squash: 0.4 },
  // shinobi: crouched low, very tight aim
  kagemaru: { weight: 0.15, bounce: 0.3, lean: 1.0, stance: 1.0, width: 1.22, chest: -0.12, hip: 0.0, sway: 0.3, aimK: 300, aimD: 24, lag: 0.4, squash: 1.1 },
  // oni brute: wide, low, aggressive, a heavy loose swing
  enra: { weight: 0.75, bounce: 0.5, lean: 0.8, stance: 0.9, width: 1.35, chest: -0.08, hip: 0.0, sway: 0.5, aimK: 95, aimD: 9, lag: 1.2, squash: 0.65 },
  // festival heavyweight: planted wide sumo stance, staccato stomping run, loose heavy aim, big landing squash
  gantetsu: { weight: 0.92, bounce: 0.7, lean: 0.55, stance: 0.85, width: 1.5, chest: 0.05, hip: 0.0, sway: 0.6, aimK: 80, aimD: 9, lag: 1.3, squash: 0.85 },
  // pilot on foot: eager, springy
  haruto: { weight: 0.3, bounce: 0.55, lean: 0.75, stance: 0.6, width: 1.1, chest: 0.05, hip: 0.2, sway: 0.4, aimK: 220, aimD: 20, lag: 0.6, squash: 1.0 },
};
const PERSONA_DEFAULT: Persona = { weight: 0.4, bounce: 0.4, lean: 0.5, stance: 0.5, width: 1.05, chest: 0, hip: 0.2, sway: 0.5, aimK: 150, aimD: 15, lag: 0.8, squash: 0.7 };
// hard-surface mechs: chunky loose aim, no stretch to speak of
const PERSONA_MECH: Persona = { weight: 1, bounce: 0.3, lean: 0.3, stance: 0.5, width: 1.3, chest: 0, hip: 0, sway: 0.2, aimK: 70, aimD: 10, lag: 1.4, squash: 0.15 };
export function personaOf(hero: string, mech = false): Persona { return PERSONA[hero] ?? (mech ? PERSONA_MECH : PERSONA_DEFAULT); }
/** the performance layer ships with the desktop edition; off, every hero moves exactly as the original animator did */
let PERF = FULL;
export function setPerformanceLayer(on: boolean) { PERF = on; }
// the original animator's constants expressed as a persona (no lag, no squash, no contrapposto)
const PERSONA_LEGACY: Persona = { weight: 0, bounce: 0.5, lean: 0.714, stance: 0.5, width: 1, chest: 0, hip: 0, sway: 0.5, aimK: 150, aimD: 15, lag: 0, squash: 0 };

/** damped spring toward a target, sub-stepped so stiff springs stay stable on slow frames; returns the new value */
function spring(s: { x: number; v: number }, target: number, k: number, d: number, dt: number): number {
  const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
  for (let i = 0; i < n; i++) { s.v += ((target - s.x) * k - s.v * d) * h; s.x += s.v * h; }
  return s.x;
}
const clampA = (v: number, m: number) => Math.max(-m, Math.min(m, v));
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const rot = (axis: THREE.Vector3, a: number) => new THREE.Quaternion().setFromAxisAngle(axis, a);

// ---------------- Tenkai-Oh's rocket hammer, choreographed after a heavyweight hammer tank: swings alternate sides -
// wind up behind the shoulder, sweep flat through the front with the weight rolling onto the lead foot, follow through
// past the other shoulder, settle back into the guard (hammer upright in front, head by the right shoulder).
export const SWING_TIME = 0.96;          // Reinhardt: 0.96s per swing
// th: yaw of the haft around the body (0 = straight ahead, + = toward the left side), ph: haft elevation,
// d: grip distance from the shoulder centre in ARM LENGTHS (1 = arms locked straight), gy: grip height above the
// shoulders in body heights. Reference (Reinhardt): both hands together at the bottom of the haft, arms straight out
// at ~90 degrees to the torso at shoulder height through the whole sweep, the head travelling flat at that height.
type HPose = { th: number; ph: number; d: number; gy: number };
const GUARD: HPose = { th: -0.45, ph: 1.05, d: 0.8, gy: -0.2 };
const smooth = (u: number) => u * u * (3 - 2 * u);
function keyed(K: [number, HPose][], p: number) {
  let k = 0;
  while (k < K.length - 2 && p > K[k + 1][0]) k++;
  const [p0, a] = K[k], [p1, b] = K[k + 1];
  const u = smooth(Math.min(1, Math.max(0, (p - p0) / (p1 - p0))));
  const L = (x: number, y: number) => x + (y - x) * u;
  return { th: L(a.th, b.th), ph: L(a.ph, b.ph), d: L(a.d, b.d), gy: L(a.gy, b.gy) };
}
function hammerPose(p: number, side: number, shield: boolean, casting: boolean, mode: string, cp: number) {
  if (mode === 'dawncharge') return { th: -2.3, ph: -0.35, d: 0.85, gy: -0.25, imp: 0, w: 1, side: 1, lean: 0.2 };       // trailing low behind the right hip, shoulder down
  if (mode === 'shatter' && cp < 1) {
    // overhead wind-up, then the head is driven down into the ground in front
    const K: [number, HPose][] = [
      [0, GUARD],
      [0.32, { th: 0, ph: 1.35, d: 0.35, gy: 0.3 }],     // hammer raised high over the head, arms up
      [0.55, { th: 0, ph: 1.1, d: 0.45, gy: 0.36 }],     // top of the lift
      [0.72, { th: 0, ph: -0.95, d: 0.95, gy: -0.12 }],  // slam: arms long, head on the ground ahead
      [0.9, { th: 0, ph: -0.9, d: 0.9, gy: -0.14 }],
      [1, GUARD],
    ];
    const q = keyed(K, cp);
    // the whole body sells it: rear back as the hammer goes up, crunch forward over the knees into the slam
    const lean = cp < 0.55 ? -0.2 * Math.sin(Math.min(1, cp / 0.55) * Math.PI * 0.5) : cp < 0.9 ? -0.2 + 0.62 * smooth(Math.min(1, (cp - 0.55) / 0.2)) : 0.42 * (1 - (cp - 0.9) / 0.1);
    return { ...q, imp: Math.max(0, 1 - Math.abs(cp - 0.74) / 0.12) * 1.4, w: 1, side: 1, lean };
  }
  if (mode === 'reaping' && cp < 1) {
    // Tomoe's Crescent Reaping: the axe comes off her back high over the right shoulder, is heaved round and down through
    // the front on a diagonal (the cut lands ~0.42s in) and follows through low past the left hip, her weight rolling
    // onto the lead foot, then is shouldered again
    const K: [number, HPose][] = [
      [0, { th: -1.2, ph: 1.25, d: 0.3, gy: 0.2 }],
      [0.3, { th: -0.85, ph: 1.45, d: 0.42, gy: 0.36 }],   // loaded: axe high behind the right shoulder, torso coiled
      [0.5, { th: -0.15, ph: 0.35, d: 0.95, gy: 0.02 }],   // the cleave crossing the front, arms long
      [0.62, { th: 0.75, ph: -0.35, d: 1.0, gy: -0.12 }],  // through the target on the diagonal
      [0.8, { th: 1.45, ph: -0.6, d: 0.85, gy: -0.22 }],   // follow-through low past the left hip
      [1, { th: 1.1, ph: -0.2, d: 0.7, gy: -0.18 }],
    ];
    const q = keyed(K, cp);
    const lean = cp < 0.3 ? -0.14 * Math.sin(cp / 0.3 * Math.PI * 0.5) : cp < 0.8 ? -0.14 + 0.5 * smooth(Math.min(1, (cp - 0.3) / 0.32)) : 0.36 * (1 - (cp - 0.8) / 0.2);
    return { ...q, imp: Math.max(0, 1 - Math.abs(cp - 0.56) / 0.12) * 1.2, w: 1, side: -1, lean };
  }
  // Crescent Warpath (after Junker Queen's Rampage): she spins through the air, the great axe out wide in the right hand
  // at shoulder height, trailing the turn (the view spins the whole body; the Fang is out on the left - the arm below)
  if (mode === 'tide') return { th: -1.85, ph: 0.08, d: 0.92, gy: 0.0, imp: 0, w: 1, side: 1, lean: 0.1 };
  if (shield) return { th: -0.75, ph: -1.15, d: 0.6, gy: -0.36, imp: 0, w: 0, side, lean: 0 };      // lowered while the shield is up
  if (p >= 1 || p < 0) return { ...GUARD, th: GUARD.th + (casting ? -0.25 : 0), imp: 0, w: 0, side, lean: 0 };
  // Reinhardt's sweep (alternating, first one counter-clockwise from above = his right to his left): a short
  // anticipation that loads the hammer onto the start side with the torso coiled, a fast flat strike through the front at
  // shoulder height, a long follow-through well past the other shoulder (~220 deg of arc) and a held end pose - the
  // hitbox lingers there - before settling back to the guard.
  const K: [number, HPose][] = [
    [0, GUARD],
    [0.16, { th: -side * 1.95, ph: 0.3, d: 0.86, gy: 0.02 }],  // anticipation: coiled, head cocked on the start side
    [0.33, { th: -side * 0.2, ph: 0.02, d: 1.0, gy: -0.02 }],  // the strike: arms locked, head flat, crossing the front
    [0.46, { th: side * 1.5, ph: -0.04, d: 0.98, gy: -0.03 }], // follow-through at full reach
    [0.6, { th: side * 2.0, ph: 0.08, d: 0.9, gy: -0.05 }],    // end of the arc
    [0.78, { th: side * 1.85, ph: 0.22, d: 0.84, gy: -0.07 }], // held: the swing's weight still carrying him
    [1, GUARD],
  ];
  const q = keyed(K, p);
  return { ...q, imp: Math.max(0, 1 - Math.abs(p - 0.35) / 0.16), w: Math.min(1, p / 0.08, (1 - p) / 0.22), side, lean: -0.08 * Math.max(0, 1 - Math.abs(p - 0.16) / 0.12) + 0.1 * Math.max(0, 1 - Math.abs(p - 0.4) / 0.2) };
}

export class Animator {
  bones: Partial<Record<BoneName, THREE.Object3D>> = {};
  rest: Partial<Record<BoneName, Rest>> = {};
  parentQ = new Map<THREE.Object3D, THREE.Quaternion>();   // model-space rotation of non-rig parents
  hipsParentInv = new THREE.Matrix3();
  hipsRestLocal = new THREE.Vector3();
  legLen = 1; thigh = 0.5; shin = 0.5; hipW = 0.1; hipH = 1; footY = 0.05; armLen = 0.6; height = 1.8;
  phase = 0;                   // gait phase in cycles
  foot = [new THREE.Vector3(), new THREE.Vector3()];   // current foot targets (model space)
  lean = new THREE.Vector2();  // smoothed lean
  bob = 0; landDip = 0; flap = 0; moveBlend = 0; airBlend = 0; flyBlend = 0; atk = 0; cast = 0;
  /** the archer's draw (0..1): bow arm out, string hand at the cheek (Yuzu, Seiran) */
  drawW = 0;
  /** where the bow hand is being held this frame (model space), for the nock */
  private bowHandM = new THREE.Vector3();
  /** a blade guard held (0..1): the deflect stance */
  guardW = 0;
  onStep: ((side: number, heavy: boolean) => void) | null = null;
  ok = false;
  private lastStance = [true, true];
  /** world-space planted foot positions this frame (procedural gait or clip contacts): read by the AI Test Lab */
  plant: (THREE.Vector3 | null)[] = [null, null];
  private pplant: (THREE.Vector3 | null)[] = [null, null];      // procedural gait's planted feet
  // ---- clip layer (Quaternius UAL / Mixamo library, see ClipLayer.ts); null = fully procedural
  layer: ClipLayer | null = null;
  clip: LayerOut | null = null;
  private clipW = 0;                                              // eligibility fade (flying, mechs: procedural)
  private cplant: (THREE.Vector3 | null)[] = [null, null];
  private cerr = [new THREE.Vector3(), new THREE.Vector3()];
  private cLegs = 0;
  /** drive this rig from an animation library (null: back to fully procedural) */
  useClips(lib: ClipLibrary | null, seed = 0, hero = '') { this.layer = lib && this.ok ? new ClipLayer(lib, seed, hero) : null; }
  /** a death clip is available: the view keeps animating the body instead of tipping it over */
  get clipDeath() { return !!this.layer?.lib.has('death'); }
  private swingFrom: (THREE.Vector3 | null)[] = [null, null];
  private restepT = [0, 0];
  // dynamic layer (springs)
  private hipYaw = 0; private hipYawV = 0; private lastYaw = 0; private turnRoll = 0;
  private leanV = new THREE.Vector2(); private flinch = 0; private flinchV = 0; private lastHitAge = 9; private flinchDir = 1;
  private recoil = 0; private recoilV = 0; private lastAtkAge = 9; private readyW = 0;
  private punchExt = 0; private punchW = 0;
  /** optional held prop (model-space child of the rig root) posed along the hammer path each frame */
  prop: THREE.Object3D | null = null;
  hammerLen = 1;
  /** twin chaingun props (model-space children of the rig root) [left hand, right hand], barrels along the forearms */
  guns: [THREE.Object3D, THREE.Object3D] | null = null;
  /** a slot holding the nocked arrow: laid from the string hand through the bow hand (not along the forearm) */
  arrowSlot: [boolean, boolean] = [false, false];
  /** first person: roll a held bow by this much (radians) so it reads canted, the way archers hold it on screen */
  bowCant = 0;
  /** first person: the bow's canted top limb tipped away into the view (radians about the bow's own side axis) */
  bowTilt = 0;
  /** gun props to keep hidden (Tomoe: the Fang while it's thrown, both while the axe is out) */
  gunHide: [boolean, boolean] = [false, false];
  /** a held prop spun in its hand, flat like a propeller (radians about the model's vertical; Tomoe's Fang in the ult) */
  gunTwirl: [number, number] = [0, 0];
  /** a held bow stands upright in the fist (limbs vertical, facing where the forearm points) instead of lying along it */
  gunUpright: [boolean, boolean] = [false, false];
  /** skating (Hibiki): how much of the skate stroke is blended in, and each stroke's lateral weight shift */
  private skW = 0;
  /** skating fast (Hibiki's Groove): the speed-skater tuck, 0..1 */
  private tuck = 0;
  /** props clamped under the feet (Hibiki's mag-skates) */
  feet: [THREE.Object3D, THREE.Object3D] | null = null;
  /** a weapon slung across the back (Tomoe's great axe between swings), riding the chest */
  back: THREE.Object3D | null = null;
  // ---- performance layer outputs, applied by the view: whole-body tilt about a pivot at the hips, squash & stretch
  tilt = { pitch: 0, roll: 0 };
  sqY = 1; sqXZ = 1;
  private tiltP = { x: 0, v: 0 }; private tiltR = { x: 0, v: 0 };
  private sq = { x: 0, v: 0 }; private lastJump = 9; private lastLand = 9;
  private lagY = { x: 0, v: 0 }; private lagP = { x: 0, v: 0 }; private lastPitch = 0; private yawRate = 0;
  private headF = { x: 0, v: 0 };                  // the head's follow-through on hits (lags, then overshoots the body)
  private headStab = 0;                             // the head's counter-pitch against the body's lean (smoothed)
  private kick = { x: 0, v: 0 };                   // heavy footfall punctuation (chest + hips dip on each contact)
  private tumble = 0; private hitX = 0; private hitZ = 1;
  private leapW = 0; private slamDip = 0; private lastLeap = false;
  /** knocked flat: 0 standing .. 1 lying; downDir = the way the body fell (model space) - the view lays it down */
  down = 0; downDir = new THREE.Vector3(0, 0, -1);
  private shiftT = 0; private shift = { x: 0, v: 0 };   // contrapposto weight side
  private ang = { swoop: 0, sup: 0, glide: 0, flare: 0, hover: 0, sling: 0 };   // angel state weights (smoothed)
  private wLift = { x: 0, v: 0 }; private wSweep = { x: 0.5, v: 0 }; private wFidget = 0; private stepFlutter = 0;
  private prevVel = new THREE.Vector3(); private acc = new THREE.Vector3(); private isAngel = false;
  private gripG = new THREE.Vector3(); private gripH = new THREE.Vector3(0, 1, 0); private gripT = new THREE.Vector3(1, 0, 0);
  // hair / cloth chains (see DYN): discovered from the rig at bind time
  private chains: { pf: ChainPrefix; kind: DynKind; segs: BoneName[]; tip: BoneName; par: BoneName; len: number[];
    x: THREE.Vector3[]; prev: THREE.Vector3[]; anchor: THREE.Vector3 | null;
    /** per particle, per collider: its rest distance from that capsule (model units) - the most it may be pushed out to */
    rmax: Partial<Record<BoneName, number>>[];
    /** this rig's tuned values (DYN x weight class x hero); rface: per particle, its rest distance from the face guard */
    P: Dyn; rface: number[] | null }[] = [];
  private dynYaw: number | null = null;
  private heroId = '';
  private ring: { a: number; b: number; d: number[] }[] = [];
  /** collider radii (model units) measured from the mesh by the rigger (tripo_rig.py); missing = fractions of the height */
  colliders: Partial<Record<BoneName, number>> = {};
  private colPrev = new Map<BoneName, [THREE.Vector3, THREE.Vector3]>();
  private dynT = 0;
  private posCache = new Map<string, THREE.Vector3>();
  private hipsOffNow = new THREE.Vector3();

  /** a foot lands: the step event (sound, dust), the heavy chest/hips punctuation, a flutter through an angel's wings */
  private footfall(i: number, heavy: boolean, P: Persona) {
    this.onStep?.(i, heavy);
    this.kick.v += (heavy ? 1.6 : 2.4) * P.weight * this.moveBlend;
    if (this.isAngel) this.stepFlutter += 0.035;
  }

  /**
   * Mirei's arms per flight state, in the body frame: floating out to the sides in the descent, streamlined in a swoop with
   * the lead hand reaching for the ally, down along the sides in a superjump, thrown forward in the braking flare, relaxed
   * and drifting in a hover; standing, the right hand carries its blade across the front the way a medic carries a staff.
   * Null when the arm is busy (beam, casting, shooting) or no state applies.
   */
  private angelArm(i: number, side: number, sh: THREE.Vector3, Lr: number, s: AnimState, idleW: number, run: number) {
    if (!PERF || this.cast > 0.05 || (i === 1 && (s.beam || this.atk > 0.05)) || (i === 0 && this.atk > 0.3)) return null;
    const W = this.ang, t = s.time, lead = i === 1;
    const V = (x: number, y: number, z: number) => new THREE.Vector3(side * x, y, z).multiplyScalar(Lr);
    const targets: [THREE.Vector3, number][] = [
      [V(0.78, -0.5 + Math.sin(t * 1.5 + side) * 0.06, 0.08), W.glide],
      [lead ? V(-0.05, -0.3, 0.9) : V(0.28, -0.88, -0.32), W.swoop + W.sling],
      [V(0.2, -0.96, -0.18), W.sup],
      [V(0.62, -0.1, 0.55), W.flare],
      [V(0.55 + Math.sin(t * 1.1 + i) * 0.04, -0.72, 0.22), W.hover],
      [lead ? V(0.12, -0.6, 0.42) : V(0.3, -0.9, 0.1), idleW * (1 - 0.6 * run) * (s.grounded ? 1 : 0)],
    ];
    let tw = 0; const hand = new THREE.Vector3();
    for (const [v, w] of targets) if (w > 1e-3) { hand.addScaledVector(v, w); tw += w; }
    if (tw < 0.05) return null;
    hand.divideScalar(tw).add(sh);
    return { hand, w: Math.min(1, tw) * (lead ? 1 : 0.9), pole: new THREE.Vector3(side * 0.7, -0.4, -0.6) };
  }

  /** the twin chainguns ride in the fists, barrels along the forearms - so they point wherever the arms aim */
  /** foot props follow the feet: under the ankle bone, pointing where the lower body faces */
  private placeFeet() {
    if (!this.feet) return;
    const R = this.rest as Record<BoneName, Rest>;
    (['L', 'R'] as const).forEach((S, i) => {
      const f = this.feet![i], fb = `foot_${S}` as BoneName;
      if (!this.bones[fb] || !R[fb]) { f.visible = false; return; }
      const p = this.modelPos(fb);
      // wheels on the floor under the foot (the ankle's height above its rest says how far the foot is lifted)
      f.position.set(p.x, Math.max(0, p.y - this.footY) - 0.004 * this.height, p.z + 0.015 * this.height);
      f.rotation.set(0, this.hipYaw, 0);
      f.visible = true;
    });
  }

  /** the slung weapon rides the chest: haft on the diagonal across the back, head over the left shoulder */
  private placeBack() {
    if (!this.back || !this.bones.chest || !this.rest.chest) return;
    const R = this.rest.chest, Q = (this.modelQ.get(this.bones.chest) ?? R.q).clone().multiply(R.q.clone().invert());
    const H = this.height;
    // pommel behind the right hip, haft up across the spine, the crescent head flat against the back over the left shoulder
    this.back.position.copy(this.modelPos('chest')).add(new THREE.Vector3(-0.08 * H, -0.27 * H, -0.11 * H).applyQuaternion(Q));
    this.back.quaternion.copy(Q).multiply(rot(Z, -0.42));
    this.back.scale.setScalar(0.85);
  }

  /** `aim` (first person, model space): point both barrels at this spot ahead of the reticle instead of along the forearms */
  private placeGuns(aim?: THREE.Vector3) {
    if (!this.guns) return;
    const R = this.rest as Record<BoneName, Rest>;
    (['L', 'R'] as const).forEach((S, i) => {
      const g = this.guns![i], fa = `forearm_${S}` as BoneName, hn = `hand_${S}` as BoneName;
      if (!this.bones[fa] || !R[fa]) { g.visible = false; return; }
      const fq = this.modelQ.get(this.bones[fa]!) ?? R[fa].q;
      const at = this.modelPos(this.bones[hn] && R[hn] ? hn : fa);
      let Zv = aim ? aim.clone().sub(at).normalize() : R[fa].dir.clone().applyQuaternion(fq.clone().multiply(R[fa].q.clone().invert())).normalize();
      if (this.arrowSlot[i]) {
        const o = i === 0 ? 'R' : 'L', ob = `hand_${o}` as BoneName, of = `forearm_${o}` as BoneName;
        const other = this.modelPos(this.bones[ob] && R[ob] ? ob : of);
        if (other.distanceToSquared(at) > 1e-6) Zv = other.clone().sub(at).normalize();
      }
      if (this.gunUpright[i]) {
        // the bow faces where the forearm points across the ground (straight ahead when the arm hangs), limbs up
        Zv = new THREE.Vector3(Zv.x, 0, Zv.z);
        if (Zv.lengthSq() < 0.09) Zv.set(0, 0, 1);
        Zv.normalize();
      }
      const Yv = new THREE.Vector3(0, 1, 0).addScaledVector(Zv, -Zv.y);
      if (Yv.lengthSq() < 1e-4) Yv.set(0, 0, 1);
      Yv.normalize();
      const Xv = new THREE.Vector3().crossVectors(Yv, Zv);
      g.position.copy(at).addScaledVector(Yv, -0.018 * this.height);
      g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(Xv, Yv, Zv));
      if (this.gunTwirl[i]) g.quaternion.premultiply(_q.setFromAxisAngle(Y, this.gunTwirl[i]));
      g.visible = !this.gunHide[i];
    });
  }

  /**
   * Held props when a mixer (the first-person Blender clips) drives the bones directly: the animator's own pose state
   * doesn't move then, so read the real forearm / hand transforms back into the props' parent space - the same frame
   * placeGuns builds (origin in the fist, +Z along the forearm, +Y up across it).
   */
  placeGunsFromBones(aim?: THREE.Vector3) {
    if (!this.guns) return;
    this.model.updateMatrixWorld(true);
    const wa = new THREE.Vector3(), wh = new THREE.Vector3();
    (['L', 'R'] as const).forEach((S, i) => {
      const g = this.guns![i], fa = this.bones[`forearm_${S}` as BoneName], hn = this.bones[`hand_${S}` as BoneName] ?? fa;
      const par = g.parent;
      if (!fa || !hn || !par) { g.visible = false; return; }
      fa.getWorldPosition(wa); hn.getWorldPosition(wh);
      const at = par.worldToLocal(wh.clone()), from = par.worldToLocal(wa.clone());
      let Zv = aim ? aim.clone().sub(at) : at.clone().sub(from);
      if (this.arrowSlot[i]) {
        const ob = this.bones[`hand_${i === 0 ? 'R' : 'L'}` as BoneName];
        if (ob) Zv = par.worldToLocal(ob.getWorldPosition(new THREE.Vector3())).sub(at);
      }
      if (Zv.lengthSq() < 1e-10) Zv.set(0, 0, 1);
      Zv.normalize();
      if (this.gunUpright[i]) { Zv = new THREE.Vector3(Zv.x, 0, Zv.z); if (Zv.lengthSq() < 0.09) Zv.set(0, 0, 1); Zv.normalize(); }
      const Yv = new THREE.Vector3(0, 1, 0).addScaledVector(Zv, -Zv.y);
      if (Yv.lengthSq() < 1e-4) Yv.set(0, 0, 1);
      Yv.normalize();
      // an archer's cant in first person: the bow's top limb tipped in toward the reticle
      if (this.gunUpright[i] && this.bowCant) Yv.applyAxisAngle(Zv, -this.bowCant).normalize();
      if (this.gunUpright[i] && this.bowTilt) {
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3().crossVectors(Yv, Zv).normalize(), this.bowTilt);
        Yv.applyQuaternion(q).normalize(); Zv.applyQuaternion(q).normalize();
      }
      const Xv = new THREE.Vector3().crossVectors(Yv, Zv);
      g.position.copy(at).addScaledVector(Yv, -0.018 * this.height);
      g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(Xv, Yv, Zv));
      if (this.gunTwirl[i]) g.quaternion.premultiply(_q.setFromAxisAngle(Y, this.gunTwirl[i]));
      g.visible = !this.gunHide[i];
    });
  }

  /** current model-space position of a bone head (FK from the deltas applied this frame) */
  private modelPos(n: BoneName): THREE.Vector3 {
    const c = this.posCache.get(n); if (c) return c;
    const R = this.rest[n]!;
    let p: THREE.Vector3;
    if (n === 'hips' || !this.bones[n]?.parent) p = R.p.clone().add(this.hipsOffNow);
    else {
      const parObj = this.bones[n]!.parent!;
      const parName = (Object.keys(this.bones) as BoneName[]).find(k => this.bones[k] === parObj);
      if (!parName || !this.rest[parName]) p = R.p.clone().add(this.hipsOffNow);
      else {
        const pq = this.modelQ.get(parObj) ?? this.rest[parName]!.q;
        const delta = pq.clone().multiply(this.rest[parName]!.q.clone().invert());
        p = this.modelPos(parName).clone().add(R.p.clone().sub(this.rest[parName]!.p).applyQuaternion(delta));
      }
    }
    this.posCache.set(n, p);
    return p;
  }

  /** find the hair / cloth chains on this rig: prefix_1..prefix_n, the highest index is the tip marker */
  private bindChains() {
    this.chains = [];
    for (const pf of CHAIN_PREFIXES) {
      const idx: BoneName[] = [];
      for (let i = 1; i <= 4; i++) { const n = `${pf}_${i}` as BoneName; if (this.bones[n] && this.rest[n]) idx.push(n); else break; }
      if (idx.length < 2) continue;
      const tip = idx[idx.length - 1], segs = idx.slice(0, -1);
      const parObj = this.bones[segs[0]]!.parent;
      const par = (Object.keys(this.bones) as BoneName[]).find(k => this.bones[k] === parObj)
        ?? (pf.startsWith('hair') ? 'head' : pf === 'sleeve_L' ? 'forearm_L' : pf === 'sleeve_R' ? 'forearm_R' : 'hips');
      if (!this.rest[par]) continue;
      const len = segs.map((n, k) => this.rest[n]!.p.distanceTo(this.rest[idx[k + 1]]!.p));
      // cloth modelled inside a collider (a heavy hero's measured hip capsule is wider than the robe hanging off it) must
      // not be shoved out of it every frame - that stretched Gantetsu's back panel into long dark spikes. Each particle
      // may be pushed out only as far as it sat from that capsule in the bind pose (less a hair).
      const kind = kindOf(pf);
      const rmax = idx.slice(1).map(n => {
        const q = this.rest[n]!.p, out: Partial<Record<BoneName, number>> = {};
        for (const cn of DYN[kind].cols) {
          const c = COLL[cn];
          if (!c || !this.rest[cn] || !this.rest[c.to]) continue;
          let A = this.rest[cn]!.p.clone(), B = this.rest[c.to]!.p.clone();
          if (cn === 'head') { const r = (this.colliders.head ?? c.r * this.height); A = A.add(new THREE.Vector3(0, r * 0.85, 0)); B = A.clone(); }
          const ab = B.clone().sub(A), l2 = ab.lengthSq();
          const u = l2 > 1e-9 ? Math.max(0, Math.min(1, q.clone().sub(A).dot(ab) / l2)) : 0;
          out[cn] = q.distanceTo(A.addScaledVector(ab, u)) * 0.97;
        }
        return out;
      });
      // face guard (head-anchored hair): a sphere in front of the skull the strands can't fold into; like the capsules,
      // a strand modelled inside it (bangs) may only be pushed out to where it hung in the bind pose
      const fc = par === 'head' && kind === 'hair' ? this.faceGuard(this.rest.head!.p, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), 1) : null;
      const rface = fc ? idx.slice(1).map(n => Math.min(fc.r, this.rest[n]!.p.distanceTo(fc.c) * 0.97)) : null;
      this.chains.push({ pf, kind, segs, tip, par, len, x: [], prev: [], anchor: null, rmax, P: this.dynFor(kind, pf), rface });
    }
    // neighbouring skirt panels keep their rest spacing (within +-25%) level by level
    this.ring = [];
    for (const [pa, pb] of SKIRT_RING) {
      const A = this.chains.findIndex(c => c.pf === pa), B = this.chains.findIndex(c => c.pf === pb);
      if (A < 0 || B < 0 || this.chains[A].segs.length !== this.chains[B].segs.length) continue;
      const pts = (c: { segs: BoneName[]; tip: BoneName }) => [...c.segs.slice(1), c.tip].map(n => this.rest[n]!.p);
      const pa2 = pts(this.chains[A]), pb2 = pts(this.chains[B]);
      this.ring.push({ a: A, b: B, d: pa2.map((p, k) => p.distanceTo(pb2[k])) });
    }
  }

  /** the head's face guard sphere: centre in front of the skull, radius (the head collider scaled by `sc`) */
  private faceGuard(head: THREE.Vector3, up: THREE.Vector3, fwd: THREE.Vector3, sc: number) {
    const r = (this.colliders.head ?? (COLL.head!.r * this.height)) * sc;
    return { c: head.clone().addScaledVector(up, r * 0.6).addScaledVector(fwd, r * 0.35), r: r * 0.9 };
  }

  private dynFor(kind: DynKind, pf: ChainPrefix): Dyn {
    const b = DYN[kind], m = DYN_CLASS[HERO_CLASS[this.heroId] ?? ''] ?? { stiff: 1, drag: 1, maxA: 1, inertT: 1 };
    const o = HERO_DYN[this.heroId]?.[kind] ?? {};
    return {
      ...b, ...o,
      stiff: [Math.min(0.95, b.stiff[0] * m.stiff), Math.min(0.95, b.stiff[1] * m.stiff)],
      drag: [Math.min(0.9, b.drag[0] * m.drag), Math.min(0.9, b.drag[1] * m.drag)],
      // front locks hang beside the face: a tighter limit
      maxA: (o.maxA ?? (kind === 'hair' && (pf === 'hair_L' || pf === 'hair_R') ? 0.45 : b.maxA)) * m.maxA,
      inertT: Math.min(1, (o.inertT ?? b.inertT) * m.inertT),
    };
  }

  /** the hero this rig belongs to (weight class and per-hero dynamics) and the collider radii the rigger measured */
  setBody(heroId: string, colliders?: Partial<Record<BoneName, number>>) {
    this.heroId = heroId;
    if (colliders) this.colliders = colliders;
    if (this.ok) this.bindChains();
  }

  /** the hair / cloth solver (DYN): world space, fixed sub-steps, body colliders, then the bones are aimed down the chains */
  private dynamics(s: AnimState, dt: number) {
    if (!this.chains.length || dt <= 0) return;
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw), sc = s.scale;
    const toW = (m: THREE.Vector3) => new THREE.Vector3(s.pos.x + (m.x * cy + m.z * sy) * sc, s.pos.y + m.y * sc, s.pos.z + (-m.x * sy + m.z * cy) * sc);
    const dirW = (m: THREE.Vector3) => new THREE.Vector3(m.x * cy + m.z * sy, m.y, -m.x * sy + m.z * cy);
    const dirToM = (w: THREE.Vector3) => new THREE.Vector3(w.x * cy - w.z * sy, w.y, w.x * sy + w.z * cy).normalize();
    const H = this.height * sc;
    // colliders this frame (world), swept from last frame's through the sub-steps
    const cols: Partial<Record<BoneName, { a0: THREE.Vector3; b0: THREE.Vector3; a1: THREE.Vector3; b1: THREE.Vector3; r: number }>> = {};
    for (const n of Object.keys(COLL) as BoneName[]) {
      const c = COLL[n]!;
      if (!this.bones[n] || !this.rest[n] || !this.rest[c.to]) continue;
      let A = toW(this.modelPos(n)), B = toW(this.modelPos(c.to));
      const def = c.r * this.height, meas = this.colliders[n];
      const r = (meas ? Math.min(Math.max(meas, def * 0.5), def * 1.45) : def) * sc;
      if (n === 'head') {       // the skull: a sphere above the head joint
        const hq = (this.modelQ.get(this.bones.head!) ?? this.rest.head!.q).clone().multiply(this.rest.head!.q.clone().invert());
        const up = dirW(new THREE.Vector3(0, 1, 0).applyQuaternion(hq));
        A = A.clone().addScaledVector(up, r * 0.85); B = A.clone();
      }
      const pv = this.colPrev.get(n), tele = !pv || pv[0].distanceTo(A) > H * 1.5;
      cols[n] = { a0: tele ? A : pv![0], b0: tele ? B : pv![1], a1: A, b1: B, r };
      this.colPrev.set(n, [A.clone(), B.clone()]);
    }
    const h = 1 / 120, steps = Math.min(5, Math.max(1, Math.ceil(dt / h))), hs = dt / steps, f = hs * 60;
    this.dynT += dt;
    const t = this.dynT, g = 9.8;
    // a light gusting breeze; the wind of the hero's own motion comes from the drag acting in world space
    const gust = 0.6 + 0.4 * Math.sin(t * 0.63) * Math.sin(t * 0.21 + 1.3);
    const wind = new THREE.Vector3(Math.sin(t * 0.37) * 1.4, 0, Math.cos(t * 0.29) * 1.1).multiplyScalar(gust * 0.9);
    const cp = new THREE.Vector3(), ab = new THREE.Vector3(), tmp = new THREE.Vector3(), CA = new THREE.Vector3(), CB = new THREE.Vector3();
    const pushOut = (x: THREE.Vector3, A: THREE.Vector3, B: THREE.Vector3, r: number) => {
      ab.subVectors(B, A); const l2 = ab.lengthSq();
      const u = l2 > 1e-9 ? Math.max(0, Math.min(1, tmp.subVectors(x, A).dot(ab) / l2)) : 0;
      cp.copy(A).addScaledVector(ab, u);
      tmp.subVectors(x, cp); const d = tmp.length();
      if (d < r) { if (d > 1e-6) x.copy(cp).addScaledVector(tmp, r / d); else x.y = cp.y + r; }
    };
    // per chain: anchor + rigid (animated) directions in model space for this frame
    const frames = this.chains.map(c => {
      const parObj = this.bones[c.segs[0]]!.parent!;
      const pq = this.modelQ.get(parObj) ?? this.rest[c.par]!.q;
      const base = pq.clone().multiply(this.rest[c.par]!.q.clone().invert());
      // leg-driven skirts (the way games rig long coats and robes): a side panel follows its own thigh part of the way, the
      // front / back panel the thigh swinging into it, so the legs don't sweep through the cloth and the cloth doesn't
      // hang back while the trousers under it stride away (the torn strands behind Gantetsu's run); physics rides on top
      if (c.kind === 'skirt' && this.bones.thigh_L && this.bones.thigh_R && this.rest.thigh_L && this.rest.thigh_R) {
        const dq = (n: 'thigh_L' | 'thigh_R') => (this.modelQ.get(this.bones[n]!) ?? this.rest[n]!.q).clone().multiply(this.rest[n]!.q.clone().invert());
        const qL = dq('thigh_L'), qR = dq('thigh_R');
        const zL = this.rest.thigh_L.dir.clone().applyQuaternion(qL).z, zR = this.rest.thigh_R.dir.clone().applyQuaternion(qR).z;
        // (a full-strength follow made coat tails and loincloths kick out as stiff flat sheets on every stride)
        const [q, w] = c.pf === 'skirt_L' ? [qL, 0.35] : c.pf === 'skirt_R' ? [qR, 0.35] : c.pf === 'skirt_F' ? [zL > zR ? qL : qR, 0.25] : [zL < zR ? qL : qR, 0.25];
        base.slerp(q, w);
      }
      const anchor = toW(this.modelPos(c.segs[0]));
      const rigid = c.segs.map(n => this.rest[n]!.dir.clone().applyQuaternion(base));
      return { anchor, rigid };
    });
    // the character's own turn this frame (for the rotation inertia)
    let dYaw = this.dynYaw === null ? 0 : s.yaw - this.dynYaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    this.dynYaw = s.yaw;
    const moving = Math.hypot(s.vel.x, s.vel.z) > 0.3 || !s.grounded;
    // face guard this frame (world): hair anchored on the head can't fold into the eyes
    let face: { c: THREE.Vector3; r: number } | null = null;
    if (this.bones.head && this.chains.some(c => c.rface)) {
      const hq = (this.modelQ.get(this.bones.head) ?? this.rest.head!.q).clone().multiply(this.rest.head!.q.clone().invert());
      face = this.faceGuard(toW(this.modelPos('head')), dirW(new THREE.Vector3(0, 1, 0).applyQuaternion(hq)), dirW(new THREE.Vector3(0, 0, 1).applyQuaternion(hq)), sc);
    }
    const vA: THREE.Vector3[] = [];
    this.chains.forEach((c, ci) => {
      const F = frames[ci];
      vA[ci] = new THREE.Vector3();
      if (c.anchor && c.anchor.distanceTo(F.anchor) <= H * 1.5 && c.x.length === c.segs.length) {
        // inertia: carry the chain along with the anchor by the part of its move (and turn) the chain doesn't feel;
        // moving x and prev together keeps each particle's own velocity
        const dA = F.anchor.clone().sub(c.anchor);
        vA[ci].copy(dA).multiplyScalar(c.P.inertT);
        const carry = dA.multiplyScalar(1 - c.P.inertT), turn = (1 - c.P.inertR) * dYaw;
        const cs = Math.cos(turn), sn = Math.sin(turn);
        for (const arr of [c.x, c.prev]) for (const x of arr) {
          x.add(carry);
          if (turn) { const dx = x.x - F.anchor.x, dz = x.z - F.anchor.z; x.x = F.anchor.x + dx * cs + dz * sn; x.z = F.anchor.z - dx * sn + dz * cs; }
        }
      }
      if (!c.anchor || c.anchor.distanceTo(F.anchor) > H * 1.5 || c.x.length !== c.segs.length) {
        // first frame / respawn / teleport: start at the animated pose
        c.x = []; c.prev = [];
        let p = F.anchor.clone();
        c.segs.forEach((_, k) => { p = p.clone().addScaledVector(dirW(F.rigid[k]), c.len[k] * sc); c.x.push(p.clone()); c.prev.push(p.clone()); });
        c.anchor = F.anchor.clone();
      }
    });
    for (let st = 1; st <= steps; st++) {
      const u = st / steps;
      this.chains.forEach((c, ci) => {
        const P = c.P, F = frames[ci], n = c.segs.length;
        const vS = vA[ci].clone().divideScalar(steps), vmax = DYN_VMAX * hs;
        let prevP = c.anchor!.clone().lerp(F.anchor, u), rot = new THREE.Quaternion();
        for (let k = 0; k < n; k++) {
          const x = c.x[k], pv = c.prev[k], L = c.len[k] * sc;
          // root -> tip: stiff roots hold the silhouette, loose tips carry the motion; extra drag at rest (no micro-jitter)
          const tk = n > 1 ? Math.pow(k / (n - 1), 0.8) : 1;
          const stiff = P.stiff[0] + (P.stiff[1] - P.stiff[0]) * tk, drag = Math.min(0.9, (P.drag[0] + (P.drag[1] - P.drag[0]) * tk) * (moving ? 1 : 1.6));
          const keep = Math.pow(1 - drag, f), pull = 1 - Math.pow(1 - stiff, f);
          // the animated direction of this segment, carried by the simulated rotation of the segments above it
          const rigidW = dirW(F.rigid[k].clone().applyQuaternion(rot)).normalize();
          const target = prevP.clone().addScaledVector(rigidW, L);
          // Verlet with drag (air resistance in world space), gravity and wind
          // velocity relative to the anchor's own (felt) motion, clamped
          tmp.subVectors(x, pv).sub(vS);
          if (tmp.lengthSq() > vmax * vmax) tmp.setLength(vmax);
          tmp.add(vS).multiplyScalar(keep);
          pv.copy(x);
          x.add(tmp);
          x.y -= g * P.grav * hs * hs;
          x.addScaledVector(wind, P.wind * hs * hs);
          // stiffness: back toward the animated pose
          x.lerp(target, pull);
          // body colliders (capsules swept through the frame) and the ground
          for (const n of P.cols) {
            const C = cols[n]; if (!C) continue;
            const lim = c.rmax[k]?.[n];
            const r = Math.min(C.r + 0.008 * H, lim !== undefined ? lim * sc : Infinity);
            if (r > 0) pushOut(x, CA.copy(C.a0).lerp(C.a1, u), CB.copy(C.b0).lerp(C.b1, u), r);
          }
          if (face && c.rface) { const r = c.rface[k] * sc; if (r > 0) pushOut(x, face.c, face.c, r); }
          if (s.grounded && x.y < s.pos.y + 0.01 * H) x.y = s.pos.y + 0.01 * H;
          // hard segment length, and an angular limit off the animated pose
          tmp.subVectors(x, prevP);
          let dir = tmp.lengthSq() > 1e-10 ? tmp.clone().normalize() : rigidW.clone();
          const ang = dir.angleTo(rigidW);
          if (ang > P.maxA) dir = rigidW.clone().lerp(dir, P.maxA / ang).normalize();
          x.copy(prevP).addScaledVector(dir, L);
          rot = new THREE.Quaternion().setFromUnitVectors(dirToM(rigidW), dirToM(dir)).multiply(rot);
          prevP = x;
        }
      });
      // skirt panels hold together (a PBD distance band between matching levels of neighbouring panels)
      for (const R of this.ring) {
        const A = this.chains[R.a], B = this.chains[R.b];
        for (let k = 0; k < A.x.length; k++) {
          const d0 = R.d[k] * sc; tmp.subVectors(B.x[k], A.x[k]); const d = tmp.length();
          if (d < 1e-6) continue;
          const want = Math.min(Math.max(d, d0 * 0.75), d0 * 1.25);
          if (want === d) continue;
          tmp.multiplyScalar((d - want) / d * 0.5);
          A.x[k].add(tmp); B.x[k].sub(tmp);
        }
      }
    }
    // aim the bones down the solved chains
    this.chains.forEach((c, ci) => {
      const F = frames[ci];
      c.anchor = F.anchor.clone();
      let head = F.anchor;
      // the shown chain: the sim blended toward the animated pose by 1 - simW (the sim itself keeps its own state)
      let shown = c.x;
      if (c.P.simW < 1) {
        let p = F.anchor.clone();
        shown = c.x.map((x, k) => { p = p.clone().addScaledVector(dirW(F.rigid[k]), c.len[k] * sc); return x.clone().lerp(p, 1 - c.P.simW); });
      }
      for (let k = 0; k < c.segs.length; k++) {
        const seg = c.segs[k];
        const parObj = this.bones[seg]!.parent!;
        const parName = k === 0 ? c.par : c.segs[k - 1];
        const pq = this.modelQ.get(parObj) ?? this.rest[parName]!.q;
        const base = pq.clone().multiply(this.rest[parName]!.q.clone().invert());
        this.aimBone(seg, dirToM(shown[k].clone().sub(head)), base);
        this.posCache.delete(k + 1 < c.segs.length ? c.segs[k + 1] : c.tip);
        head = shown[k];
      }
    });
  }

  constructor(public model: THREE.Object3D) {
    model.traverse(o => {
      const n = o.name.replace(/\./g, '_') as BoneName;
      if ((BONES as readonly string[]).includes(n) && !this.bones[n]) this.bones[n] = o;
    });
    const need: BoneName[] = ['hips', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R', 'chest', 'head'];
    this.ok = need.every(n => this.bones[n]);
    if (this.ok) this.bind();
  }

  private bind() {
    const m = this.model;
    const inv = new THREE.Matrix4().copy(m.matrixWorld).invert();
    m.updateMatrixWorld(true);
    inv.copy(m.matrixWorld).invert();
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (const n of BONES) {
      const b = this.bones[n]; if (!b) continue;
      new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld).decompose(pos, q, s);
      this.rest[n] = { q: q.clone(), p: pos.clone(), dir: new THREE.Vector3(0, 1, 0) };
      // parents that aren't rig bones: remember their (static) model-space rotation
      const par = b.parent;
      if (par && !this.parentQ.has(par)) {
        new THREE.Matrix4().multiplyMatrices(inv, par.matrixWorld).decompose(pos, q, s);
        this.parentQ.set(par, q.clone());
      }
    }
    for (const n of BONES) {
      const r = this.rest[n]; if (!r) continue;
      const c = CHILD[n];
      if (c && this.rest[c]) r.dir.copy(this.rest[c]!.p).sub(r.p).normalize();
      else if (n.startsWith('foot')) r.dir.set(0, -0.2, 1).normalize();
      else if (n.startsWith('hand')) r.dir.copy(this.rest[n.replace('hand', 'forearm') as BoneName]?.dir ?? Y);
      else if (n.startsWith('wing')) r.dir.set(n.endsWith('L') ? 1 : -1, 0.3, -0.3).normalize();
      else if (n === 'head') r.dir.set(0, 1, 0);
    }
    const R = this.rest as Record<BoneName, Rest>;
    this.thigh = R.thigh_L.p.distanceTo(R.shin_L.p);
    this.shin = R.shin_L.p.distanceTo(R.foot_L.p);
    this.legLen = this.thigh + this.shin;
    this.hipW = Math.abs(R.thigh_L.p.x - R.thigh_R.p.x) / 2;
    this.hipH = R.hips.p.y;
    this.footY = (R.foot_L.p.y + R.foot_R.p.y) / 2;
    this.height = R.head.p.y * 1.08;
    if (R.upperarm_L && R.hand_L) this.armLen = R.upperarm_L.p.distanceTo(R.forearm_L.p) + R.forearm_L.p.distanceTo(R.hand_L.p);
    const hp = this.bones.hips!.parent!;
    const pm = new THREE.Matrix4().multiplyMatrices(inv, hp.matrixWorld);
    this.hipsParentInv.setFromMatrix4(pm).invert();
    this.hipsRestLocal.copy(this.bones.hips!.position);
    this.foot[0].set(R.foot_L.p.x, this.footY, R.foot_L.p.z);
    this.foot[1].set(R.foot_R.p.x, this.footY, R.foot_R.p.z);
    this.bindChains();
  }

  /** model-space rotation currently applied to a bone's parent */
  private modelQ = new Map<THREE.Object3D, THREE.Quaternion>();
  private setModelQ(n: BoneName, Qm: THREE.Quaternion) {
    const b = this.bones[n]; if (!b) return;
    const par = b.parent!;
    const pq = this.modelQ.get(par) ?? this.parentQ.get(par) ?? new THREE.Quaternion();
    b.quaternion.copy(pq).invert().multiply(Qm);
    this.modelQ.set(b, Qm.clone());
  }
  /** delta D (model space) applied on top of the rest orientation */
  private applyDelta(n: BoneName, D: THREE.Quaternion) {
    const r = this.rest[n]; if (!r) return;
    this.setModelQ(n, _q.copy(D).multiply(r.q));
  }
  /** rotate a bone so its rest direction points along `dir` (model space), keeping twist minimal */
  private aimBone(n: BoneName, dir: THREE.Vector3, base?: THREE.Quaternion): THREE.Quaternion {
    const r = this.rest[n]; if (!r) return new THREE.Quaternion();
    const from = base ? _v3.copy(r.dir).applyQuaternion(base) : r.dir;
    const D = new THREE.Quaternion().setFromUnitVectors(_v2.copy(from).normalize(), _v.copy(dir).normalize());
    if (base) D.multiply(base);
    this.applyDelta(n, D);
    return D;
  }

  /** 2-bone IK: returns [upperDir, lowerDir] model space */
  private ik(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
    const d = _v.copy(target).sub(root);
    let len = d.length();
    const maxL = (l1 + l2) * 0.999;
    if (len > maxL) { d.multiplyScalar(maxL / len); len = maxL; }
    len = Math.max(len, Math.abs(l1 - l2) + 1e-3);
    const dir = d.clone().normalize();
    const a = (l1 * l1 - l2 * l2 + len * len) / (2 * len);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const pd = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
    if (pd.lengthSq() < 1e-6) pd.set(0, 0, 1); pd.normalize();
    const knee = root.clone().add(dir.clone().multiplyScalar(a)).add(pd.multiplyScalar(h));
    const end = root.clone().add(d);
    return [knee.clone().sub(root).normalize(), end.sub(knee).normalize()];
  }

  /**
   * First-person viewmodel pose: torso and legs at rest, head (and its hair) collapsed out of the camera, arms solved by
   * IK to hand targets given in MODEL space. `hands[i]` null leaves that arm hanging (out of view). `prop` places the
   * held prop (Tenkai-Oh's hammer) along a grip.
   */
  updateFirstPerson(o: { hands: [THREE.Vector3 | null, THREE.Vector3 | null]; poles?: [THREE.Vector3, THREE.Vector3]; wrist?: [THREE.Quaternion | null, THREE.Quaternion | null];
    prop?: { pos: THREE.Vector3; dir: THREE.Vector3; side: THREE.Vector3 } | null; gunAim?: THREE.Vector3 }) {
    if (!this.ok) return;
    const R = this.rest as Record<BoneName, Rest>;
    this.modelQ.clear();
    for (const n of ['hips', 'spine', 'chest', 'neck', 'head', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R', 'wing_L', 'wing_R'] as BoneName[]) if (this.bones[n]) this.applyDelta(n, new THREE.Quaternion());
    this.bones.hips!.position.copy(this.hipsRestLocal);
    // the head (and its hair) out of the camera; not the neck - high collars are weighted to it and would smear
    for (const n of ['head'] as BoneName[]) this.bones[n]?.scale.setScalar(1e-3);
    for (let i = 0; i < 2; i++) {
      const S = i === 0 ? 'L' : 'R', side = i === 0 ? 1 : -1;
      const ua = `upperarm_${S}` as BoneName, fa = `forearm_${S}` as BoneName, hn = `hand_${S}` as BoneName;
      if (!this.bones[ua] || !this.bones[fa]) continue;
      if (this.bones[`shoulder_${S}` as BoneName]) this.applyDelta(`shoulder_${S}` as BoneName, new THREE.Quaternion());
      const l1 = R[ua].p.distanceTo(R[fa].p), l2 = R[fa].p.distanceTo((R[hn] ?? R[fa]).p) || l1;
      const tgt = o.hands[i];
      if (tgt) {
        const [u, l] = this.ik(R[ua].p, tgt, l1, l2, o.poles?.[i] ?? new THREE.Vector3(side * 0.7, -1, -0.2));
        this.aimBone(ua, u); this.aimBone(fa, l);
      } else {
        const down = new THREE.Vector3(side * 0.15, -1, 0).normalize();
        this.aimBone(ua, down); this.aimBone(fa, down);
      }
      if (this.bones[hn]) {
        const Qh = (this.modelQ.get(this.bones[fa]!) ?? new THREE.Quaternion()).clone().multiply(_q2.copy(R[fa].q).invert()).multiply(R[hn].q);
        const w = o.wrist?.[i];
        if (w) Qh.premultiply(w);
        this.setModelQ(hn, Qh);
      }
    }
    this.hipsOffNow.set(0, 0, 0); this.posCache.clear();
    this.placeGuns(o.gunAim);
    if (this.prop) {
      this.prop.visible = !!o.prop;
      if (o.prop) {
        const H = o.prop.dir.clone().normalize(), T = o.prop.side.clone().addScaledVector(H, -o.prop.side.dot(H)).normalize();
        this.prop.position.copy(o.prop.pos).addScaledVector(H, -0.1 * this.hammerLen);
        this.prop.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(T, H, new THREE.Vector3().crossVectors(T, H)));
      }
    }
  }
  /** undo the first-person head collapse (the view is reused in third person) */
  restoreHead() { this.bones.head?.scale.setScalar(1); }

  /**
   * Knocked flat (Gantetsu's Shiko slam): the limbs sprawl over whatever the body was doing - arms flung out, knees a
   * little up, the spine straight, chin up. Model space, parents first; the view lays the whole body down along the
   * push (down, downDir).
   */
  private sprawl(w: number) {
    const cur = (n: BoneName) => (this.modelQ.get(this.bones[n]!) ?? this.rest[n]!.q).clone().multiply(this.rest[n]!.q.clone().invert());
    const toQ = (n: BoneName, D: THREE.Quaternion, k = 1) => { if (this.bones[n] && this.rest[n]) this.applyDelta(n, cur(n).slerp(D, w * k)); };
    const toDir = (n: BoneName, x: number, y: number, z: number) => {
      const r = this.rest[n]; if (!this.bones[n] || !r) return;
      toQ(n, new THREE.Quaternion().setFromUnitVectors(r.dir, new THREE.Vector3(x, y, z).normalize()));
    };
    const I = new THREE.Quaternion();
    for (const n of ['hips', 'spine', 'chest', 'neck'] as BoneName[]) toQ(n, I, 0.85);
    toQ('head', new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.22));
    for (const [S, side] of [['L', 1], ['R', -1]] as const) {
      toQ(`shoulder_${S}` as BoneName, I, 0.85);
      toDir(`upperarm_${S}` as BoneName, side, 0.3, 0.12);
      toDir(`forearm_${S}` as BoneName, side * 0.7, 0.7, 0.3);
      toDir(`thigh_${S}` as BoneName, side * 0.24, -1, 0.26);
      toDir(`shin_${S}` as BoneName, side * 0.1, -1, -0.22);
      const sh = `shin_${S}` as BoneName, ft = `foot_${S}` as BoneName;
      if (this.bones[sh] && this.rest[sh] && this.bones[ft]) toQ(ft, cur(sh));
    }
  }

  update(s: AnimState) {
    if (!this.ok) return;
    const R = this.rest as Record<BoneName, Rest>;
    const dt = Math.min(0.05, s.dt);
    this.modelQ.clear();
    const heavy = s.frame === 'mech';
    const flyer = s.frame === 'flyer';
    const PS = PERF ? personaOf(s.hero ?? '', heavy) : PERSONA_LEGACY;
    this.isAngel = !!s.angel;
    // velocity in model space (character faces +Z at its yaw)
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    const lvx = (s.vel.x * cy - s.vel.z * sy) / s.scale, lvz = (s.vel.x * sy + s.vel.z * cy) / s.scale;
    // rig units: the model is scaled to hero height, so convert m/s into model units
    const k = this.height / Math.max(0.5, s.scale);
    void k;
    const speed = Math.hypot(lvx, lvz);
    const moving = s.grounded && speed > 0.4 && !s.rooted ? 1 : 0;
    this.moveBlend += (moving - this.moveBlend) * Math.min(1, dt * 10);
    this.airBlend += ((s.grounded ? 0 : 1) - this.airBlend) * Math.min(1, dt * 8);
    this.flyBlend += ((s.flying ? 1 : 0) - this.flyBlend) * Math.min(1, dt * 5);
    // ---------------- clip layer: a baked mocap / keyframed pose, blended per body region below
    const angelAir = PERF && !!s.angel && ((s.swoop ?? -1) >= 0 || !!s.gliding || !!s.superjump || !!s.slingshot || (s.swoopFlare ?? 9) < 0.4);
    const skating = PERF && !!s.skate && (moving > 0 || !!s.grind);
    const eligible = !heavy && s.frame !== 'drone' && !s.flying && !s.hammer && !s.move && !angelAir && !skating;
    this.clipW += ((eligible || s.dead ? 1 : 0) - this.clipW) * Math.min(1, dt * 8);
    const L = this.layer ? this.layer.update(s, { speed: speed / this.legLen, angle: Math.atan2(lvx, lvz), moveBlend: this.moveBlend, airBlend: this.airBlend, eligible: this.clipW > 0.01 || !!s.dead }) : null;
    this.clip = L;
    const cw = L ? (s.dead ? 1 : this.clipW) : 0;
    const wLegs = L ? L.legs * cw : 0, wTorso = L ? L.torso * cw : 0;
    const cq = (b: RtBone) => (L && L.pose.w[RT_INDEX[b]] ? L.pose.q[RT_INDEX[b]] : null);
    this.cLegs = wLegs;
    this.atk = Math.max(0, 1 - s.attackAge / (s.attackKind === 'secondary' || s.attackKind === 'lance' ? 0.45 : 0.3));
    const punching = s.attackKind === 'punch', swinging = !!s.hammer && s.attackKind === 'primary';
    if (punching || swinging) this.atk = 0;
    // quick melee jab (left hand): short pull-back, snap out, slower recovery
    const pq = punching ? s.attackAge / 0.42 : 9;
    this.punchExt = pq < 0.14 ? -0.35 * pq / 0.14 : pq < 0.26 ? -0.35 + 1.35 * (pq - 0.14) / 0.12 : Math.max(0, 1 - (pq - 0.26) / 0.74);
    this.punchW = pq >= 1 ? 0 : pq < 0.85 ? 1 : (1 - pq) / 0.15;
    const cp = s.move === 'shatter' ? s.castAge / 0.75 : s.move === 'reaping' ? s.castAge / 0.75 : 9;
    const hs = s.hammer ? hammerPose(swinging ? s.attackAge / SWING_TIME : 9, s.swingSide ?? 1, s.barrier, this.cast > 0.05 && s.move !== 'shatter', s.move ?? '', cp) : null;
    const charging = s.move === 'dawncharge';
    const hTw = hs ? Math.max(-1.1, Math.min(1.1, hs.th * 0.6)) * hs.w : 0;
    const pTw = -0.45 * Math.max(0, this.punchExt) * this.punchW;
    this.cast = Math.max(0, 1 - s.castAge / 0.55);
    this.landDip = Math.max(0, 1 - s.landAge / 0.3) * (heavy ? 0.14 : 0.1);
    // ---------------- squash & stretch (Gibson: Tracer's jump - stretch the torso on takeoff, hang a little at the top,
    // squash hard on landing with the head tucked, then settle past neutral)
    if (s.jumpAge < this.lastJump - 1e-6) this.sq.v += 1.6 * PS.squash * (1 - 0.55 * PS.weight);
    if (s.landAge < this.lastLand - 1e-6) this.sq.v -= (1.1 + 1.4 * PS.weight) * PS.squash;
    this.lastJump = s.jumpAge; this.lastLand = s.landAge;
    const rise = !s.grounded && !s.flying ? Math.max(-0.4, Math.min(1, s.vel.y / 12)) : 0;
    spring(this.sq, rise * 0.05 * PS.squash, 160, 11, dt);
    this.sqY = 1 + Math.max(-0.2, Math.min(0.18, this.sq.x)); this.sqXZ = 1 / Math.sqrt(this.sqY);
    // model-space acceleration (world m/s^2): legs and wings swing behind it like pendulums
    const vNow = new THREE.Vector3(lvx * s.scale, s.vel.y, lvz * s.scale);
    if (dt > 0) this.acc.lerp(vNow.clone().sub(this.prevVel).divideScalar(dt), Math.min(1, dt * 8));
    this.prevVel.copy(vNow);
    // knocked about in the air: a tumble pose blends in (Davis: knockbacks spring between directional float poses)
    this.tumble += ((PERF && s.knocked && !s.grounded ? 1 : 0) - this.tumble) * Math.min(1, dt * 7);
    // Gantetsu's Shiko leap: up with the guns overhead, then the two-footed slam - a deep squat the frame he lands
    const leaping = PERF && !!s.leap && !s.grounded;
    this.leapW += ((leaping ? 1 : 0) - this.leapW) * Math.min(1, dt * (leaping ? 9 : 16));
    if (PERF && this.lastLeap && !s.leap && s.grounded) { this.slamDip = 1; this.sq.v -= 2.2 * PS.squash; }
    this.lastLeap = !!s.leap;
    this.slamDip = Math.max(0, this.slamDip - dt / 0.5);
    // knocked flat by a slam: falls along the push (away from whoever hit), lies there, gets up over the last 0.3 s
    const kd = s.knockdown ?? 0;
    if (kd > 0 && this.down < 0.02) {
      this.downDir.set(s.hitDir ? -s.hitDir[0] : 0, 0, s.hitDir ? -s.hitDir[1] : -1);
      if (this.downDir.lengthSq() < 1e-6) this.downDir.set(0, 0, -1);
      this.downDir.normalize();
    }
    this.down += ((kd > 0.32 ? 1 : 0) - this.down) * Math.min(1, dt * (kd > 0.32 ? 11 : 5.5));
    if (this.down < 1e-3) this.down = 0;
    // angel state weights (Mirei): smoothed so every change of state reads as a follow-through, not a pop
    const AW = this.ang, angel = !!s.angel;
    const inSwoop = angel && (s.swoop ?? -1) >= 0;
    const tw = (k: 'swoop' | 'sup' | 'glide' | 'flare' | 'hover' | 'sling', on: boolean, rate: number) => { AW[k] += ((on ? 1 : 0) - AW[k]) * Math.min(1, dt * rate); };
    tw('swoop', inSwoop, 14); tw('flare', angel && (s.swoopFlare ?? 9) < 0.35, 16);
    tw('sup', angel && !!s.superjump && s.vel.y > 1.5, 9); tw('sling', angel && !!s.slingshot && !s.grounded && !inSwoop, 9);
    tw('glide', angel && !!s.gliding && !inSwoop, 6); tw('hover', angel && s.flying && !inSwoop, 6);
    const idleW = (1 - this.moveBlend) * (1 - this.airBlend);
    // ---------------- lower-body yaw: legs face where we move, the torso twists back to the aim (hero-shooter strafing)
    {
      let mv = speed > 0.6 && moving ? Math.atan2(lvx, lvz) : 0;
      if (Math.abs(mv) > 1.95) mv -= Math.sign(mv) * Math.PI;          // backpedal: legs face forward, walk backwards
      const target = Math.max(-1.05, Math.min(1.05, mv)) * this.moveBlend * (1 - wLegs);   // 8-way clips turn the legs themselves
      const yawRate = (() => { let d = s.yaw - this.lastYaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return dt > 0 ? d / dt : 0; })();
      this.lastYaw = s.yaw; this.yawRate = yawRate;
      // when turning in place the legs lag behind the torso for a beat
      this.hipYawV += ((target - this.hipYaw) * 90 - this.hipYawV * 14) * dt;
      this.hipYaw += this.hipYawV * dt - (this.moveBlend < 0.5 ? yawRate * dt * 0.35 : 0);
      this.hipYaw = Math.max(-1.2, Math.min(1.2, this.hipYaw)) * (this.moveBlend < 0.1 ? 0.97 : 1);
      this.turnRoll += (Math.max(-0.22, Math.min(0.22, -yawRate * 0.04 * this.moveBlend)) - this.turnRoll) * Math.min(1, dt * 8);
    }
    // ---------------- gait. Feet are LOCKED IN WORLD SPACE while planted (no sliding when the body turns or
    // changes speed); each swing lands on the spot the stride predicts. Phase advances with distance travelled.
    // faster = higher cadence + shorter stance, not longer reach: a planted foot must stay inside the leg's range
    const run = Math.min(1, speed / (this.legLen * 7));
    const stride = this.legLen * (heavy ? 0.6 + 0.4 * run : 0.55 + 0.55 * run);
    const duty = heavy ? 0.6 - 0.1 * run : 0.62 - 0.22 * run;
    const cycleLen = stride * 2;                    // one cycle = a left and a right step
    const travel = cycleLen * duty;                 // how far the body moves over a planted foot
    // skating strokes don't speed up past a strong rhythm (Hibiki's Groove reaches 20x: at that speed he tucks and
    // glides - long strokes, not a blur of legs)
    this.phase += Math.min(speed / cycleLen, s.skate ? 2.4 : Infinity) * dt * (moving ? 1 : 0);
    const tuckT = PERF && s.skate && s.grounded ? Math.max(0, Math.min(1, (speed - 9) / 14)) : 0;
    this.tuck += (tuckT - this.tuck) * Math.min(1, dt * 4);
    const md = speed > 0.01 ? _v2.set(lvx / speed, 0, lvz / speed).clone() : new THREE.Vector3(0, 0, 1);
    const lift = this.legLen * (heavy ? 0.16 : 0.22) * Math.min(1, speed / 3 + 0.3);
    // skating (Hibiki, after Lucio / inline speed skating): long push-glide strokes, about one per leg per second.
    // sph = each leg's stroke phase: 0-0.42 push (knee extends, foot drives out and back on the diagonal), 0.42-0.62
    // recovery (low arc back under the hips), 0.62-1 glide (weight on it, knee ~105 deg)
    const skateGait = PERF && !!s.skate && s.grounded && moving > 0;
    this.skW += ((skateGait ? 1 : 0) - this.skW) * Math.min(1, dt * 6);
    const sph0 = ((this.phase * 0.36) % 1 + 1) % 1, sphOf = (i: number) => (sph0 + i * 0.5) % 1;
    const hipsOff = new THREE.Vector3();
    const toModel = (w: THREE.Vector3) => { const dx = (w.x - s.pos.x) / s.scale, dz = (w.z - s.pos.z) / s.scale; return new THREE.Vector3(dx * cy - dz * sy, (w.y - s.pos.y) / s.scale, dx * sy + dz * cy); };
    const toWorld = (m: THREE.Vector3) => new THREE.Vector3(s.pos.x + (m.x * cy + m.z * sy) * s.scale, s.pos.y + m.y * s.scale, s.pos.z + (-m.x * sy + m.z * cy) * s.scale);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      // feet sit under the hips, which turn toward the movement direction (lower-body yaw)
      const restFoot = new THREE.Vector3((i === 0 ? R.foot_L : R.foot_R).p.x + side * this.hipW * 0.05, this.footY, (i === 0 ? R.foot_L : R.foot_R).p.z).applyAxisAngle(Y, this.hipYaw);
      const ph = ((this.phase + i * 0.5) % 1 + 1) % 1;
      let tgt: THREE.Vector3;
      if (!s.grounded || this.airBlend > 0.5) {
        this.pplant[i] = null;
        tgt = restFoot.clone();
      } else if (moving && PERF && s.skate) {
        // no planted foot - the wheels roll with him
        const sp = sphOf(i);
        let out: number, back: number, up = 0;
        if (sp < 0.42) {                       // push: out and back on the diagonal, the knee straightening
          const u = sp / 0.42, e = u * u * (3 - 2 * u);
          out = 0.05 + 0.36 * e; back = 0.08 - 0.42 * e;
        } else if (sp < 0.62) {                // recovery: a low arc back in under the hips
          const u = (sp - 0.42) / 0.2, e = u * u * (3 - 2 * u);
          out = 0.41 - 0.36 * e; back = -0.34 + 0.46 * e; up = Math.sin(u * Math.PI) * 0.09;
        } else { out = 0.05; back = 0.12 - 0.04 * (sp - 0.62) / 0.38; }   // glide: under the body, slightly ahead
        const amp = 1 - 0.55 * this.tuck;     // tucked: shorter strokes, feet close under the hips
        tgt = restFoot.clone().add(new THREE.Vector3(side * out * amp * this.legLen, 0, back * amp * this.legLen).applyAxisAngle(Y, this.hipYaw));
        tgt.y = this.footY + up * amp * this.legLen;
        const pushing = sp < 0.42;
        if (pushing && !this.lastStance[i] && this.cLegs < 0.5) this.footfall(i, heavy, PS);
        this.lastStance[i] = pushing;
        this.pplant[i] = null;
      } else if (moving) {
        const stance = ph < duty;
        if (stance) {
          if (!this.pplant[i]) {
            // touch-down: plant where the stride says this foot lands, then keep it there in the world
            const land = restFoot.clone().addScaledVector(md, travel * (0.5 - ph / duty));
            this.pplant[i] = toWorld(land); this.pplant[i]!.y = s.pos.y + this.footY * s.scale;
            if (this.cLegs < 0.5) this.footfall(i, heavy, PS);
          }
          tgt = toModel(this.pplant[i]!);
        } else {
          // swing: from lift-off toward the predicted landing spot, with a lift arc
          const u = (ph - duty) / (1 - duty);
          if (this.pplant[i]) { this.swingFrom[i] = toModel(this.pplant[i]!); this.pplant[i] = null; }
          const from = this.swingFrom[i] ?? restFoot.clone().addScaledVector(md, -travel / 2);
          const land = restFoot.clone().addScaledVector(md, travel / 2);
          const k = u * u * (3 - 2 * u);
          tgt = from.clone().lerp(land, k);
          tgt.y = this.footY + Math.sin(u * Math.PI) * lift;
          // swingFrom is in model space of lift-off; body has moved since, so correct by the distance covered
          this.swingFrom[i] = from.addScaledVector(md, -(speed * dt));
        }
        this.lastStance[i] = stance;
      } else {
        // standing: feet stay put in the world; re-step if the body turned or drifted too far from them
        if (!this.pplant[i]) { this.pplant[i] = toWorld(restFoot); this.pplant[i]!.y = s.pos.y + this.footY * s.scale; }
        let m = toModel(this.pplant[i]!);
        if (m.distanceTo(restFoot) > this.legLen * 0.32 && this.restepT[i] <= 0 && this.restepT[1 - i] <= 0) { this.restepT[i] = 0.22; this.swingFrom[i] = m.clone(); }
        if (this.restepT[i] > 0) {
          this.restepT[i] -= dt;
          const u = 1 - Math.max(0, this.restepT[i]) / 0.22;
          m = this.swingFrom[i]!.clone().lerp(restFoot, u); m.y = this.footY + Math.sin(u * Math.PI) * lift * 0.5;
          if (this.restepT[i] <= 0) { this.pplant[i] = toWorld(restFoot); this.pplant[i]!.y = s.pos.y + this.footY * s.scale; if (this.cLegs < 0.5) this.footfall(i, heavy, PS); }
        }
        tgt = m;
      }
      if (PERF && s.grind) {
        // Mag-Grind: both skates on the wall side, knees bent, the outside leg a little behind
        const g = s.grind;
        tgt = restFoot.clone().add(new THREE.Vector3(g * this.legLen * 0.1, this.legLen * 0.12, (side === g ? 0.12 : -0.2) * this.legLen));
      }
      // airborne: knees up (jump), trailing dangle (flying)
      else if (this.airBlend > 0.01) {
        const tuck = flyer ? 0.25 : Math.max(0, Math.min(1, (s.vel.y + 4) / 10));
        const air = new THREE.Vector3((i === 0 ? R.foot_L : R.foot_R).p.x + side * this.hipW * 0.1, this.footY + this.legLen * (0.35 * tuck + 0.1), (flyer ? -0.25 : i === 0 ? 0.15 : -0.05) * this.legLen);
        if (flyer) { air.y += Math.sin(s.time * 2.2 + i) * 0.03 * this.legLen; air.z += Math.sin(s.time * 1.7 + i * 2) * 0.05 * this.legLen; }
        if (s.angel && !PERF) {
          // (web edition) the original angel legs: together and long, trailing back when fast, straight down gliding
          const fastK = Math.min(1, speed / (this.legLen * 6));
          air.set((i === 0 ? R.foot_L : R.foot_R).p.x * 0.35,
            this.footY + this.legLen * (s.gliding ? 0.04 : (i === 1 ? 0.14 : 0.05) * (1 - fastK) + 0.08 * fastK),
            this.legLen * (-0.04 - 0.5 * fastK - (i === 1 && !s.gliding ? 0.1 * (1 - fastK) : 0)));
          air.y += Math.sin(s.time * 1.6 + i * 0.6) * 0.015 * this.legLen;
        } else if (s.angel) {
          // angelic flight. The whole body tilts into a swoop (the view rotates it), so these targets are in the BODY frame:
          //  hover - legs together and long, one knee softly bent, the feet swinging behind the acceleration (pendulum)
          //  swoop / slingshot - legs straight and trailing, one knee bent, toes pointed; superjump - a locked straight dart
          //  descent - knees soft, feet drifting back with a slow flutter kick; flare - knees up to brake
          const Lg = this.legLen, rx = (i === 0 ? R.foot_L : R.foot_R).p.x, bent = i === 1 ? 1 : 0;
          const T = (x: number, y: number, z: number) => new THREE.Vector3(rx * x, this.footY + Lg * y, Lg * z);
          const pend = new THREE.Vector3(this.acc.x, 0, this.acc.z).multiplyScalar(-Lg * 0.3 / 24);
          const hover = T(0.35, 0.05 + 0.09 * bent, -0.05 - 0.1 * bent).add(pend);
          hover.y += Math.sin(s.time * 1.6 + i * 0.6) * 0.015 * Lg;
          const dart = T(0.28, 0.02 + 0.13 * bent * (1 - AW.sup), -0.1 - 0.14 * bent * (1 - AW.sup));
          const desc = T(0.4, 0.07 + 0.05 * bent, -0.12 - 0.08 * bent + Math.sin(s.time * 2.3 + i * Math.PI) * 0.035);
          const flare = T(0.45, 0.24 - 0.06 * bent, 0.1);
          const wd = AW.swoop + AW.sling + AW.sup, tot = AW.hover + wd + AW.glide + AW.flare;
          if (tot > 1e-3) air.lerp(hover.multiplyScalar(AW.hover).addScaledVector(dart, wd).addScaledVector(desc, AW.glide).addScaledVector(flare, AW.flare).divideScalar(tot), Math.min(1, tot));
          else { air.x *= 0.7; if (i === 1) { air.y += 0.06 * Lg; air.z -= 0.06 * Lg; } }   // a plain jump: one knee up, graceful
        }
        tgt.lerp(air, this.airBlend);
      }
      // never reach further than the leg allows (keeps IK stable on hard stops)
      const off = tgt.clone().sub(restFoot); off.y = 0;
      const maxOff = this.legLen * 0.75;
      if (off.length() > maxOff) { tgt.sub(off).add(off.setLength(maxOff)); this.pplant[i] = null; }
      this.foot[i].copy(tgt);
    }
    // clip feet: the clip's foot positions (scaled to this rig's legs) locked in the world while in contact
    if (L && wLegs > 0.001) {
      for (let i = 0; i < 2; i++) {
        // the clip's foot relative to its own hip joint, hung from this rig's hip joint (moved by the clip's hips): feet
        // land where the clip puts them whatever the source rest pose (straight T / A pose or not) and stance width
        const fb: RtBone = i === 0 ? 'foot_L' : 'foot_R', tb: RtBone = i === 0 ? 'thigh_L' : 'thigh_R';
        const P = L.pose.p, dh = L.pose.d[RT_INDEX.hips];
        const ct = P[RT_INDEX[fb]].clone().sub(P[RT_INDEX[tb]]).add(dh).multiplyScalar(this.legLen).add(R[tb].p);
        ct.y += this.footY - (R[tb].p.y - this.legLen);    // a straight standing leg in the clip = this rig's rest ankle height
        let tgt = ct;
        if (L.pose.contact[i] > 0.5 && L.loco > 0.5 && moving && s.grounded) {
          if (!this.cplant[i]) { this.cplant[i] = toWorld(ct); if (wLegs > 0.5) this.footfall(i, heavy, PS); }
          const lk = toModel(this.cplant[i]!); lk.y = ct.y;
          if (lk.distanceTo(ct) > this.legLen * 0.25) { this.cplant[i] = null; this.cerr[i].copy(lk).sub(ct); }
          else { tgt = lk; this.cerr[i].copy(lk).sub(ct); }
        } else {
          // released: ease out the lock error instead of popping to the clip
          this.cplant[i] = null;
          this.cerr[i].multiplyScalar(Math.exp(-dt * 18));
          tgt = ct.clone().add(this.cerr[i]);
        }
        this.foot[i].lerp(tgt, wLegs);
      }
    } else { this.cplant[0] = this.cplant[1] = null; }
    // persona stance width at rest (a sumo's planted base, a medic's feet together) - on top of clip or procedural feet
    if (idleW > 0.01 && Math.abs(PS.width - 1) > 0.01) for (let i = 0; i < 2; i++) this.foot[i].x += (i === 0 ? 1 : -1) * this.hipW * (PS.width - 1) * 0.9 * idleW;
    for (let i = 0; i < 2; i++) this.plant[i] = wLegs > 0.5 ? this.cplant[i] : this.pplant[i];
    // body bob: lowest at mid-stance (twice per cycle)
    const bobPh = this.phase * 2 * Math.PI * 2;
    // heavies drop hard onto each foot and pop back up (staccato); light heroes float through the stride
    const bc = 0.5 - Math.cos(bobPh) * 0.5;
    this.bob = -Math.pow(bc, 1 + PS.weight * 2.5) * this.legLen * (heavy ? 0.06 : 0.02 + 0.03 * PS.bounce) * this.moveBlend;
    // combat stance: knees soft, weight low (per hero); melee heroes lunge into their swings
    const stance = idleW * (heavy ? 0.03 : 0.02 + 0.05 * PS.stance);
    const lunge = s.melee ? Math.sin(Math.min(1, this.atk) * Math.PI) * 0.12 * this.legLen : 0;
    hipsOff.y = this.bob - this.landDip * this.legLen - (s.charging ? 0.04 * this.legLen : 0) - stance * this.legLen - lunge * 0.3;
    // skating: knees ~105 deg (hips low), weight rolls over the gliding leg every stroke; standing, he nods to the beat
    const skSway = Math.sin(2 * Math.PI * sph0 + Math.PI);
    if (this.skW > 0.01) { hipsOff.y -= (0.12 + 0.1 * this.tuck) * this.legLen * this.skW; hipsOff.x += skSway * 0.085 * (1 - 0.6 * this.tuck) * this.legLen * this.skW; }
    if (PERF && s.skate && idleW > 0.01) hipsOff.y -= (0.5 - 0.5 * Math.cos(s.time * Math.PI * 3)) * 0.018 * this.legLen * idleW;
    hipsOff.z += lunge;
    // hammer: weight rolls onto the front foot at impact; jab: a small step into the punch
    if (hs) { hipsOff.z += hs.imp * 0.09 * this.legLen; hipsOff.y -= hs.imp * 0.06 * this.legLen + (hs.w > 0 ? 0.02 * this.legLen : 0); hipsOff.x += Math.sin(hs.th) * 0.05 * this.legLen * hs.w; }
    if (charging) hipsOff.y -= 0.07 * this.legLen;
    hipsOff.z += Math.max(0, this.punchExt) * this.punchW * 0.05 * this.legLen;
    if (s.barrier) hipsOff.y -= 0.06 * this.legLen;
    if (s.angel && s.flying) hipsOff.y += Math.sin(s.time * 1.8) * 0.025 * this.legLen * (1 - Math.min(1, speed / (this.legLen * 6)));
    if (L && wLegs > 0) hipsOff.lerp(L.pose.d[RT_INDEX.hips].clone().multiplyScalar(this.legLen), wLegs);
    // ---- overlays that ride on clips too: contrapposto (weight on one leg, swapping every few seconds), stance depth,
    // footfall punctuation
    const wsh = spring(this.shift, Math.tanh(Math.sin(s.time * 0.19 + 1.3) * 5) * PS.hip * idleW, 30, 9, dt);
    spring(this.kick, 0, 180, 12, dt);
    hipsOff.x += wsh * 0.045 * this.legLen;
    hipsOff.y -= (L && wLegs > 0 ? idleW * 0.03 * PS.stance + Math.abs(wsh) * 0.012 : 0) * this.legLen + this.kick.x * 0.05 * this.legLen;
    // lean into velocity with a damped spring (overshoots when you stop or turn) + roll into turns
    const leanTarget = new THREE.Vector2(
      Math.max(-1, Math.min(1, lvx / 8)) * (flyer && s.flying ? (!PERF ? 0.35 : s.angel ? 0.1 : 0.2) : 0.14) + this.turnRoll,
      Math.max(-1, Math.min(1, lvz / 8)) * (flyer && s.flying ? (!PERF ? (s.angel ? 0.75 : 0.45) : s.angel ? 0.15 : 0.3) : heavy ? 0.1 : 0.08 + 0.14 * PS.lean) + (s.rush ? 0.3 : 0));
    this.leanV.x += ((leanTarget.x - this.lean.x) * 70 - this.leanV.x * 9) * dt;
    this.leanV.y += ((leanTarget.y - this.lean.y) * 70 - this.leanV.y * 9) * dt;
    this.lean.x += this.leanV.x * dt; this.lean.y += this.leanV.y * dt;
    // hit flinch + weapon recoil: impulses into springs
    if (s.hitAge < this.lastHitAge) {
      this.flinchV += 7;
      // directional (Davis: a pose per hit direction on a spring): shoved away from the attacker, the body leads and the
      // head follows through a beat later
      if (PERF && s.hitDir) { this.hitX = s.hitDir[0]; this.hitZ = s.hitDir[1]; } else if (PERF) { this.hitX = Math.random() < 0.5 ? -0.5 : 0.5; this.hitZ = 0.85; }
      else { this.hitX = (Math.random() < 0.5 ? -1 : 1) * 0.89; this.hitZ = 1; }
      this.flinchDir = this.hitX >= 0 ? 1 : -1;
    }
    this.lastHitAge = s.hitAge;
    this.flinchV += (-this.flinch * 160 - this.flinchV * 14) * dt; this.flinch += this.flinchV * dt;
    spring(this.headF, this.flinch, 70, 6, dt);
    if (s.attackAge < this.lastAtkAge && !s.melee && s.attackKind !== 'punch') this.recoilV += s.dual ? 0.7 : heavy ? 3 : 5;
    this.lastAtkAge = s.attackAge;
    this.recoilV += (-this.recoil * 220 - this.recoilV * 16) * dt; this.recoil += this.recoilV * dt;
    const hipSway = Math.sin(this.phase * 2 * Math.PI) * (heavy ? 0.09 : 0.06) * this.moveBlend;
    const idleShift = Math.sin(s.time * 0.55) * 0.03 * (1 - this.moveBlend);
    const stepRoll = heavy ? Math.sin(this.phase * 2 * Math.PI) * 0.05 * this.moveBlend : 0;   // mechs rock side to side per stomp
    // ---------------- hips (face the movement direction)
    const tumP = -0.45 * this.tumble * this.hitZ, tumR = 0.4 * this.tumble * this.hitX;
    const Dh = rot(Y, this.hipYaw + hipSway + hTw * 0.34).premultiply(rot(X, this.lean.y * 0.4 + tumP)).premultiply(rot(Z, -this.lean.x * 0.5 + idleShift * PS.sway * 2 + stepRoll + wsh * 0.07 + tumR));
    if (s.stunned) Dh.premultiply(rot(Z, Math.sin(s.time * 9) * 0.06));
    // clip torso: the clip's deltas with the gameplay additives on top (aim pitch, flinch, recoil)
    const withAim = (q: THREE.Quaternion | null, pitch: number) => q ? q.clone().premultiply(rot(X, pitch)) : null;
    const blendD = (D: THREE.Quaternion, q: THREE.Quaternion | null, w: number) => { if (q && w > 0) D.slerp(q, w); return D; };
    // the slam's landing: down into a deep squat within two frames, then back up
    if (this.slamDip > 0.01) hipsOff.y -= (this.slamDip > 0.85 ? (1 - this.slamDip) / 0.15 : this.slamDip / 0.85) * 0.14 * this.height;
    // getting up off the floor: through a crouch, not like a plank on a hinge
    if (this.down > 0.01 && kd <= 0.32) hipsOff.y -= Math.sin(this.down * Math.PI) * 0.13 * this.height;
    blendD(Dh, cq('hips'), wLegs);
    this.applyDelta('hips', Dh);
    const hb = this.bones.hips!;
    hb.position.copy(this.hipsRestLocal).add(_v.copy(hipsOff).applyMatrix3(this.hipsParentInv));
    // ---------------- spine chain (unwinds the hip yaw so the chest faces the aim)
    const aimP = -s.pitch;   // pitch up = negative X rotation in this frame
    const breath = Math.sin(s.time * 1.6) * 0.015;
    // an archer draws side-on, the bow shoulder toward the target (Hanzo's stance), and holds it through the release
    const archer = !!(s.hero && HELD[s.hero]?.L?.kind === 'bow');
    const shotAge = s.attackKind === 'primary' || s.attackKind === 'secondary' ? s.attackAge : 9;
    this.drawW += ((archer && (s.charging || shotAge < 0.85) ? 1 : 0) - this.drawW) * Math.min(1, dt * (s.charging ? 14 : 6));
    this.guardW += ((s.parry ? 1 : 0) - this.guardW) * Math.min(1, dt * (s.parry ? 16 : 8));
    const twist = this.atk * (s.melee || s.attackKind === 'secondary' ? -0.55 : -0.12) * (1 - this.drawW) + 0.55 * this.drawW;
    // the upper body trails a fast aim turn and springs back past centre, the eyes stay on target (Boehm's spring aims:
    // tight for duellists, flowing for the floaty, loose for heavies)
    const pitchRate = dt > 0 ? (s.pitch - this.lastPitch) / dt : 0; this.lastPitch = s.pitch;
    const lagYaw = spring(this.lagY, clampA(-this.yawRate * 0.045 * PS.lag, 0.35), PS.aimK, PS.aimD, dt);
    const lagPitch = spring(this.lagP, clampA(pitchRate * 0.03 * PS.lag, 0.2), PS.aimK, PS.aimD, dt);
    const carriage = -PS.chest * 0.28 * (1 - this.moveBlend * 0.4) - (s.rush ? 0.1 : 0);   // proud and open, or hunched
    const fP = -this.flinch * this.hitZ, fR = this.flinch * 0.45 * this.hitX;           // shoved away from the hit
    // hero-shooter carriage on the run: mocap sprints lean ~28 deg into the stride; an Overwatch hero stays upright with
    // the weapon forward (readability), so the clip's lean is pulled back up as the run speeds up
    const upright = PERF ? -0.2 * this.moveBlend * run * (heavy ? 0.4 : 1) : 0;
    // the clip's own torso keeps these additives (aim, flinch, lag, carriage)
    const withAdd = (q: THREE.Quaternion | null, p: number, y: number, r: number) => q ? q.clone().premultiply(rot(Z, r)).premultiply(rot(Y, y)).premultiply(rot(X, p)) : null;
    const skLean = this.skW * (0.24 + 0.36 * this.tuck), skTwist = this.skW * skSway * 0.14 * (1 - 0.6 * this.tuck);
    const Ds = Dh.clone().multiply(rot(X, this.lean.y * 0.5 + aimP * 0.2 + fP * 0.6 + breath + this.cast * 0.1 + stance * 1.2 + (hs ? hs.imp * 0.16 + hs.lean : 0) + (charging ? 0.38 : 0) + lagPitch * 0.3 + carriage * 0.4 + this.kick.x * 0.06 + upright + skLean))
      .multiply(rot(Y, -(this.hipYaw + hipSway + hTw * 0.22) * 0.45 + twist * 0.4 + (hTw + pTw) * 0.4 + lagYaw * 0.35 + skTwist)).multiply(rot(Z, fR - wsh * 0.04 - skSway * 0.06 * this.skW));
    blendD(Ds, withAdd(cq('spine'), aimP * 0.2 + fP * 0.6 + lagPitch * 0.3 + carriage * 0.4 + this.kick.x * 0.06 + upright, lagYaw * 0.35, fR - wsh * 0.04), wTorso);
    if (this.bones.spine) this.applyDelta('spine', Ds);
    const Dc = Ds.clone().multiply(rot(X, aimP * 0.3 + fP * 0.4 - this.recoil * 0.9 + breath + lagPitch * 0.7 + carriage * 0.6 + this.kick.x * 0.08 + upright * 0.6))
      .multiply(rot(Y, -(this.hipYaw + hipSway + hTw * 0.22) * 0.55 + twist * 0.6 - idleShift * 0.5 + (hTw + pTw) * 0.6 + (charging ? -0.35 : 0) + lagYaw * 0.65)).multiply(rot(Z, -wsh * 0.08));
    blendD(Dc, withAdd(cq('chest'), aimP * 0.5 + fP - this.recoil * 0.9 + lagPitch * 0.7 + carriage * 0.6 + this.kick.x * 0.08 + upright * 0.6, lagYaw * 0.65, -wsh * 0.08), wTorso);
    this.applyDelta('chest', Dc);
    const Dn = Dc.clone().multiply(rot(X, aimP * 0.2));
    blendD(Dn, withAim(cq('neck'), aimP * 0.7 + fP), wTorso);
    if (this.bones.neck) this.applyDelta('neck', Dn);
    // the head keeps the eyes on the aim, glances around when idle, follows a hit through, tucks on a hard landing,
    // and looks back up out of a swoop
    const look = Math.sin(s.time * 0.37) * 0.12 * (1 - this.moveBlend) * (1 - Math.min(1, this.atk * 3));
    const headFollow = PERF ? (this.headF.x - this.flinch) * -this.hitZ * 1.1 : 0;
    const headP = -lagPitch * 0.9 - carriage * 0.8 + (PERF ? this.landDip * 2.5 : 0) + headFollow - this.tilt.pitch * 0.55 - upright * 1.3;
    const Dhd = Dn.clone().multiply(rot(Y, look - twist * 0.5 - (hTw + pTw) * 0.85 - lagYaw * 0.95)).multiply(rot(X, aimP * 0.3 + this.recoil * 0.3 + Math.sin(s.time * 0.7) * 0.02 + headP));
    blendD(Dhd, withAdd(cq('head'), aimP + this.recoil * 0.3 + fP + headP, -lagYaw * 0.95, 0), wTorso);
    // head stabilisation (Overwatch keeps the eyes level with the aim while the body leans into the run): whatever pitch
    // the lean, the clip and the spine chain left on the head, most of it is taken back out on the move - the run's lean
    // put the head 20-30 deg down and the bangs over the eyes. Intended head motion stays: the aim, a landing tuck, a
    // hit's follow-through, recoil
    const stabW = PERF && !s.dead && !s.climb ? 0.85 * this.moveBlend : 0;
    if (stabW > 0.01 || Math.abs(this.headStab) > 1e-3) {
      const fwd = _v.set(0, 0, 1).applyQuaternion(Dhd);
      const want = aimP + this.recoil * 0.3 + fP + (PERF ? this.landDip * 2.5 : 0) + headFollow - lagPitch * 0.9;
      const has = -Math.asin(Math.max(-1, Math.min(1, fwd.y)));
      this.headStab += (clampA((want - has) * stabW, 0.6) - this.headStab) * (1 - Math.exp(-dt * 25));
      const axis = _v2.set(fwd.z, 0, -fwd.x);                 // the head's own horizontal right-hand axis (Y x fwd)
      if (axis.lengthSq() > 1e-6) Dhd.premultiply(_q2.setFromAxisAngle(axis.normalize(), this.headStab));
    }
    this.applyDelta('head', Dhd);
    // ---------------- legs (IK)
    const hipsPos = R.hips.p.clone().add(hipsOff);
    for (let i = 0; i < 2; i++) {
      const L_ = i === 0 ? 'L' : 'R';
      const th = R[`thigh_${L_}` as BoneName], sh = R[`shin_${L_}` as BoneName];
      const hipJ = th.p.clone().sub(R.hips.p).applyQuaternion(Dh).add(hipsPos);
      const ft = this.foot[i].clone(); ft.y = Math.max(ft.y, this.footY * 0.6);
      // the Shiko leap: knees up and wide, a sumo's stomp wound up in the air
      if (this.leapW > 0.01) { ft.y += this.leapW * 0.26 * this.legLen; ft.z += this.leapW * 0.1 * this.legLen; ft.x += (i === 0 ? 1 : -1) * this.leapW * 0.14 * this.legLen; }
      const pole = new THREE.Vector3(0, 0, 1).applyQuaternion(Dh);
      if (L && wLegs > 0) {
        // the clip's knee direction (off the hip-ankle line) steers the IK bend: deep crouches, rolls, kneeling deaths
        const P = L.pose.p, a = P[RT_INDEX[`thigh_${L_}` as RtBone]], k = P[RT_INDEX[`shin_${L_}` as RtBone]], f = P[RT_INDEX[`foot_${L_}` as RtBone]];
        const af = f.clone().sub(a).normalize(), kd = k.clone().sub(a); kd.addScaledVector(af, -kd.dot(af));
        if (kd.lengthSq() > 1e-6) pole.lerp(kd.normalize(), wLegs).normalize();
      }
      const [ud, ld] = this.ik(hipJ, ft, this.thigh, this.shin, pole);
      const Dt = this.aimBone(`thigh_${L_}` as BoneName, ud);
      void sh;
      this.aimBone(`shin_${L_}` as BoneName, ld);
      void Dt;
      // feet stay level with the ground, toes pitch a little during swing
      const toe = (this.foot[i].y - this.footY) / Math.max(1e-3, this.legLen) * -1.2;
      this.applyDelta(`foot_${L_}` as BoneName, blendD(rot(X, toe).premultiply(rot(Y, hipSway * 0.3)), cq(`foot_${L_}` as RtBone), wLegs));
    }
    // ---------------- arms
    const armSwing = Math.sin(this.phase * 2 * Math.PI) * (heavy ? 0.25 : 0.4) * this.moveBlend * Math.min(1, speed / 5 + 0.3);
    const carry = s.hero ? HELD[s.hero] : undefined;             // a held blade / bow (HeldProps)
    const aimDir = new THREE.Vector3(0, Math.sin(s.pitch), Math.cos(s.pitch)).normalize();
    // a tilted body (a swoop) still aims where the camera looks: undo the whole-body tilt on the aim line
    if (Math.abs(this.tilt.pitch) + Math.abs(this.tilt.roll) > 1e-3) aimDir.applyQuaternion(rot(X, this.tilt.pitch).multiply(rot(Z, this.tilt.roll)).invert());
    const armAct = L ? L.armsAction * cw : 0;
    for (let i = 0; i < 2; i++) {
      const S = i === 0 ? 'L' : 'R', side = i === 0 ? 1 : -1;
      const ua = `upperarm_${S}` as BoneName, fa = `forearm_${S}` as BoneName;
      if (!this.bones[ua] || !this.bones[fa]) continue;
      const cu = L && L.pose.w[RT_INDEX[ua as RtBone]] && L.pose.w[RT_INDEX[fa as RtBone]] ? poseDir(L.pose, ua as RtBone, fa as RtBone) : null;
      const cl = L && L.pose.w[RT_INDEX[fa as RtBone]] && L.pose.w[RT_INDEX[`hand_${S}` as RtBone]] ? poseDir(L.pose, fa as RtBone, `hand_${S}` as RtBone) : null;
      const shoulder = R[ua].p.clone().sub(R.chest.p).applyQuaternion(Dc).add(R.chest.p).add(hipsOff);
      const l1 = R[ua].p.distanceTo(R[fa].p), l2 = R[fa].p.distanceTo((R[`hand_${S}` as BoneName] ?? R[fa]).p) || l1;
      // relaxed pose: rest direction pulled 25% toward straight down, swung with the gait
      const restD = R[ua].dir.clone().applyQuaternion(Dc);
      const relaxed = restD.clone().lerp(new THREE.Vector3(side * 0.25, -1, 0.05), s.angel ? 0.1 : flyer && s.flying ? 0.05 : 0.3).normalize();
      relaxed.applyAxisAngle(new THREE.Vector3(side, 0, 0).applyQuaternion(Dc).normalize(), -armSwing * side * (i === 0 ? 1 : 1) * (1 - this.skW));
      // the speed tuck: arms swept back along the body
      if (this.tuck > 0.01) relaxed.lerp(new THREE.Vector3(side * 0.22, -0.5, -0.84).applyQuaternion(Dc).normalize(), this.tuck * 0.85).normalize();
      if (this.skW > 0.01 && i === 0) {
        const sw = Math.sin(2 * Math.PI * sphOf(1) + 0.19);            // forward while the right leg pushes
        relaxed.applyAxisAngle(new THREE.Vector3(1, 0, 0).applyQuaternion(Dc).normalize(), -sw * 0.85 * this.skW);
        relaxed.applyAxisAngle(new THREE.Vector3(0, 1, 0), -sw * 0.35 * this.skW);
      }
      if (flyer && s.flying) relaxed.applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.3 * this.flyBlend);
      if (s.angel && (s.flying || s.gliding)) relaxed.lerp(new THREE.Vector3(side * 0.55, -0.8, -0.15), 0.35 * Math.max(this.flyBlend, s.gliding ? 1 : 0)).normalize();
      // weapon-ready stance: elbows forward, hands up in front of the body; relaxes into arm swing at full sprint
      // angelic medic: arms stay low and relaxed (the held feather-blades hang at her sides) instead of a weapon guard
      const readyW = (1 - 0.7 * run) * (1 - this.airBlend * 0.5) * (heavy ? 0.45 : 0.72) * (flyer && s.flying ? 0.35 : 1) * (s.angel ? 0.12 : 1);
      relaxed.lerp(new THREE.Vector3(side * 0.3, -0.72, 0.62).applyQuaternion(Dc).normalize(), readyW).normalize();
      this.readyW = readyW;
      // attack / cast: reach along the aim line (right arm leads primaries, both for casts)
      // overrides: the hammer's grip (both hands, or the right one while the left is busy) and the left-hand jab
      let over: { hand: THREE.Vector3; w: number; pole?: THREE.Vector3 } | null = null;
      const leftFree = s.move === 'shatter' || s.move === 'reaping' ? false : (s.move === 'tide' || s.barrier || (this.cast > 0.05 && s.move !== 'dawncharge') || this.punchW > 0.01 || charging);
      if (hs && (i === 1 || !leftFree)) {
        const HH = this.height;
        const Sh = R.upperarm_L && R.upperarm_R ? R.upperarm_L.p.clone().add(R.upperarm_R.p).multiplyScalar(0.5).add(hipsOff) : R.chest.p.clone().add(hipsOff);
        const dirH = new THREE.Vector3(Math.sin(hs.th), 0, Math.cos(hs.th));
        const H = new THREE.Vector3(Math.sin(hs.th) * Math.cos(hs.ph), Math.sin(hs.ph), Math.cos(hs.th) * Math.cos(hs.ph));
        const G = Sh.clone().add(new THREE.Vector3(0, hs.gy * HH, 0)).addScaledVector(dirH, hs.d * this.armLen);
        const hand = i === 1 ? G : G.clone().addScaledVector(H, 0.12 * this.hammerLen);
        // the off hand lets go at the extremes (grip behind its shoulder or out of reach): a two-handed grip there
        // tears an auto-rigged shoulder; it rejoins the haft as the hammer comes round
        let wh = 1;
        if (i === 0) {
          const rel = hand.clone().sub(shoulder), reach = l1 + l2;
          wh = Math.min(1, Math.max(0, 1 - (rel.length() / reach - 1.0) * 4)) * Math.min(1, Math.max(0, rel.z / (0.35 * reach) + 0.6));
        }
        over = { hand, w: wh };
        if (i === 1) { this.gripG.copy(G); this.gripH.copy(H); this.gripT.set(Math.cos(hs.th), 0, -Math.sin(hs.th)).multiplyScalar(hs.side); }
      } else if (i === 0 && s.move === 'tide') {
        // Crescent Warpath: the Crescent Fang held out wide on the left, trailing the spin like the axe on the right
        over = { hand: shoulder.clone().add(new THREE.Vector3(side * 0.9, 0.03, -0.3).multiplyScalar(l1 + l2).applyQuaternion(Dc)), w: 1, pole: new THREE.Vector3(side * 0.3, -0.4, -0.9) };
      } else if (i === 0 && charging) {
        over = { hand: shoulder.clone().add(new THREE.Vector3(-0.15, 0.05, 0.75).multiplyScalar(l1 + l2)), w: 1 };
      } else if (i === 0 && this.punchW > 0.01 && armAct < 0.3) {
        const hand = shoulder.clone().addScaledVector(aimDir, (l1 + l2) * (0.35 + 0.63 * Math.max(this.punchExt, -0.35)));
        hand.x += -side * (l1 + l2) * 0.12; hand.y -= 0.05 * (l1 + l2);
        over = { hand, w: this.punchW };
      } else if (s.climb) {
        // up the wall hand over hand: each hand reaches high on the wall in turn, pulls down past the shoulder
        const Lr = l1 + l2, ph = s.time * 7 + (i === 0 ? 0 : Math.PI);
        const reach = 0.5 + 0.5 * Math.sin(ph);
        const hand = shoulder.clone().add(new THREE.Vector3(side * 0.28 * Lr, (-0.1 + 0.95 * reach) * Lr, 0.62 * Lr).applyQuaternion(Dc));
        over = { hand, w: 1, pole: new THREE.Vector3(side * 0.8, -0.6, -0.2) };
      } else if (archer && this.drawW > 0.02) {
        // the draw: the bow arm straight out along the aim, the string hand pulled back to the cheek with the elbow
        // high behind; on the release the string hand snaps back and open (follow-through), the bow arm holds
        const Lr = l1 + l2, face = (R.neck ? R.neck.p : R.chest.p).clone().add(hipsOff).add(new THREE.Vector3(0, 0.06 * this.height, 0));
        const bowHand = shoulder.clone();          // (the left shoulder on i === 0; recomputed for the right hand below)
        if (i === 0) {
          const hand = bowHand.addScaledVector(aimDir, Lr * 0.97);
          this.bowHandM.copy(hand);
          over = { hand, w: this.drawW, pole: new THREE.Vector3(side * 0.6, -0.8, 0) };
        } else {
          // Hanzo's cycle, string hand: at the jaw while drawing; loose - it snaps back past the ear, open; reaches over
          // the right shoulder to the quiver; brings the next arrow down to the bow and nocks it; rests on the string
          const anchor = face.clone().addScaledVector(aimDir, 0.05 * this.height).add(new THREE.Vector3(-side * 0.05 * this.height, 0, 0));
          const nock = this.bowHandM.clone().addScaledVector(aimDir, -0.12 * Lr).add(new THREE.Vector3(-side * 0.03 * Lr, 0, 0));
          const quiver = shoulder.clone().add(new THREE.Vector3(-side * 0.08 * Lr, 0.34 * Lr, -0.42 * Lr).applyQuaternion(Dc));
          const snap = anchor.clone().add(new THREE.Vector3(-side * 0.14 * Lr, 0.05 * Lr, -0.26 * Lr).applyQuaternion(Dc));
          const k = (a: number, b: number) => Math.max(0, Math.min(1, (shotAge - a) / (b - a))), ez = (u: number) => u * u * (3 - 2 * u);
          let hand: THREE.Vector3;
          if (s.charging) hand = nock.clone().lerp(anchor, Math.min(1, 0.25 + (s.charge ?? 1)));
          else if (shotAge < 0.1) hand = anchor.clone().lerp(snap, ez(k(0, 0.07)));
          else if (shotAge < 0.34) hand = snap.clone().lerp(quiver, ez(k(0.1, 0.34)));
          else if (shotAge < 0.6) hand = quiver.clone().lerp(nock, ez(k(0.4, 0.6)));
          else hand = nock;
          over = { hand, w: this.drawW, pole: new THREE.Vector3(side * 0.9, 0.5, -0.9) };
        }
      } else if (this.guardW > 0.02 && carry?.R?.kind === 'blade') {
        // the deflect guard (Genji's): the blade hand in front of the chest, the blade across the body and turning in a
        // slow circle; the off hand low and forward, ready
        const Lr = l1 + l2, t = s.time * 5.5;
        const hand = i === 1
          ? shoulder.clone().add(new THREE.Vector3(side * 0.55 * Lr + Math.cos(t) * 0.06 * Lr, -0.12 * Lr + Math.sin(t) * 0.06 * Lr, 0.62 * Lr).applyQuaternion(Dc))
          : shoulder.clone().add(new THREE.Vector3(-side * 0.1 * Lr, -0.42 * Lr, 0.5 * Lr).applyQuaternion(Dc));
        over = { hand, w: this.guardW, pole: new THREE.Vector3(side * 0.9, -0.5, -0.3) };
      } else if (s.dual) {
        // twin chainguns held at the hips, barrels along the aim; each gun kicks back on its own rounds and chatters while
        // it fires; running they ride lower and bounce, in the rush they tuck in under the shoulders
        const age = i === 0 ? s.dual.fireL : s.dual.fireR, Lr = l1 + l2, kickG = Math.max(0, 1 - age / 0.06);
        const hand = shoulder.clone().add(new THREE.Vector3(side * 0.34 * Lr, -0.44 * Lr, 0.12 * Lr)).addScaledVector(aimDir, (0.58 - 0.07 * kickG) * Lr);
        if (age < 0.12) hand.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, 0).multiplyScalar(0.02 * Lr));
        hand.y -= (0.06 * run + Math.abs(armSwing) * 0.05 + (s.rush ? 0.08 : 0)) * Lr;
        if (s.rush) hand.x -= side * 0.06 * Lr;
        // the leap: both guns hauled up overhead; the slam drives them down in front as he lands
        if (this.leapW > 0.01) hand.lerp(shoulder.clone().add(new THREE.Vector3(side * 0.2 * Lr, 0.8 * Lr, 0.2 * Lr).applyQuaternion(Dc)), this.leapW);
        if (this.slamDip > 0.01) hand.lerp(shoulder.clone().add(new THREE.Vector3(side * 0.3 * Lr, -0.62 * Lr, 0.5 * Lr).applyQuaternion(Dc)), Math.min(1, this.slamDip * 1.6));
        over = { hand, w: 1, pole: new THREE.Vector3(side * 0.9, -0.6, -0.5) };
      } else if (s.angel) {
        over = this.angelArm(i, side, shoulder, l1 + l2, s, idleW, run);
      } else if (carry && this.moveBlend > 0.05) {
        // a blade or a bow carried on the move: the sword hand low and back (the blade trailing, a samurai's run),
        // the bow hand low at the side, bow upright - instead of pumping the weapon through the arm swing. Any attack
        // or cast takes the arm straight back.
        const it = i === 0 ? carry.L : carry.R;
        if (it && it.kind !== 'arrow') {
          const Lr = l1 + l2, busy = Math.min(1, Math.max(this.atk, this.cast, s.charging ? 1 : 0) * 1.6);
          const local = it.kind === 'blade' ? new THREE.Vector3(side * 0.3, -0.76, -0.3) : new THREE.Vector3(side * 0.36, -0.8, 0.06);
          const hand = shoulder.clone().add(local.multiplyScalar(Lr).applyQuaternion(Dc));
          hand.z += armSwing * side * 0.05 * Lr;
          const w = this.moveBlend * (1 - busy);
          if (w > 0.01) over = { hand, w, pole: new THREE.Vector3(side * 0.6, -0.4, -0.8) };
        }
      }
      const lead = i === 1 ? 1 : 0.35;
      const act = (1 - armAct) * Math.max(this.atk * lead * (s.attackKind === 'secondary' && i === 0 ? 2.5 : 1), this.cast * 0.9, s.beam ? 0.9 * lead : 0, s.charging ? 1 * (i === 0 ? 1 : 0.8) : 0, s.barrier && i === 0 ? 1 : 0);
      // clip arms: a one-shot (combo hit, punch, cast) owns them; idle / locomotion arms give way to the weapon guard
      const wArm = over ? 0 : armAct + (1 - armAct) * (L ? L.armsLoco * cw : 0) * (1 - readyW * 0.8) * (1 - Math.min(1, act));
      const put = (n: BoneName, dir: THREE.Vector3, c: THREE.Vector3 | null) => this.aimBone(n, c && wArm > 0 ? dir.clone().lerp(c, wArm).normalize() : dir);
      if (this.bones[`shoulder_${S}` as BoneName]) this.applyDelta(`shoulder_${S}` as BoneName, blendD(Dc.clone(), cq(`shoulder_${S}` as RtBone), wArm));
      if (over) {
        const [u, l] = this.ik(shoulder, over.hand, l1, l2, over.pole ?? new THREE.Vector3(side * 0.5, -1, -0.4));
        this.aimBone(ua, relaxed.clone().lerp(u, over.w).normalize());
        this.aimBone(fa, relaxed.clone().lerp(l, over.w).normalize());
      } else if (act > 0.01) {
        const reach = aimDir.clone().multiplyScalar((l1 + l2) * (0.72 + 0.15 * Math.sin(Math.min(1, act) * Math.PI)));
        const hand = shoulder.clone().add(reach);
        hand.x += -side * (l1 + l2) * 0.25;             // hands converge toward the centre line
        if (s.attackKind === 'secondary' && this.atk > 0) hand.x += side * Math.sin(this.atk * Math.PI) * (l1 + l2) * 0.8;   // slash arc
        const [u, l] = this.ik(shoulder, hand, l1, l2, new THREE.Vector3(side * 0.4, -1, -0.6));
        const w = Math.min(1, act);
        const uD = relaxed.clone().lerp(u, w).normalize();
        const Du = put(ua, uD, cu);
        const lD = relaxed.clone().lerp(l, w).normalize();
        put(fa, lD, cl);
        void Du;
      } else {
        const Du = put(ua, relaxed, cu);
        // slight natural elbow bend
        // forearms bend up toward the centre line (holding the weapon / focus) in the ready stance
        const fore = new THREE.Vector3(-side * 0.35, -0.12, 1).applyQuaternion(Dc).normalize();
        // angel: the forearm keeps its sculpted angle to the upper arm (the long feather-blades in her hands hang straight
        // down as designed) with only a hint of bend while moving
        const lD = s.angel
          ? R[fa].dir.clone().applyQuaternion(Du).lerp(fore, 0.04 + 0.08 * this.moveBlend).normalize()
          : relaxed.clone().lerp(fore, 0.18 + 0.15 * this.moveBlend + this.readyW * 0.55).normalize();
        put(fa, lD, cl);
        void Du;
      }
      const hn = `hand_${S}` as BoneName;
      if (this.bones[hn]) {
        const Qh = (this.modelQ.get(this.bones[fa]!) ?? new THREE.Quaternion()).clone().multiply(_q2.copy(R[fa].q).invert()).multiply(R[hn].q);
        const ch = cq(hn as RtBone);
        if (ch && wArm > 0) {
          // clip wrist: bend only. Auto-rigged meshes weight sleeve cuffs, gauntlets and held weapons to the hand, so the
          // mocap's forearm roll (palms turning in) spins a sleeve or a blade around the arm; swing-twist split about
          // the forearm axis, twist dropped, bend clamped to a natural wrist range
          const fq = this.modelQ.get(this.bones[fa]!) ?? _q3.identity();
          const axis = _v3.copy(R[fa].dir).applyQuaternion(_q2.copy(fq).multiply(_q4.copy(R[fa].q).invert())).normalize();
          const rel = _q5.copy(ch).multiply(R[hn].q).multiply(_q2.copy(Qh).invert());
          const d = rel.x * axis.x + rel.y * axis.y + rel.z * axis.z;
          const tw = _q2.set(axis.x * d, axis.y * d, axis.z * d, rel.w);
          if (tw.lengthSq() < 1e-9) tw.identity(); else tw.normalize();
          const sw = rel.multiply(tw.invert());
          const ang = 2 * Math.acos(Math.min(1, Math.abs(sw.w)));
          if (ang > WRIST_MAX) sw.slerp(_q4.identity(), 1 - WRIST_MAX / ang);
          Qh.premultiply(_q4.identity().slerp(sw, wArm));
        }
        this.setModelQ(hn, Qh);
      }
    }
    // ---------------- held hammer: pommel just below the right hand, haft along the swing path, head across it
    if (this.prop) {
      this.prop.visible = !!hs;
      if (hs) {
        // Crescent Warpath: the great axe spun in her hand, flat like a propeller, the hand at its hub
        if (s.move === 'tide' && s.twirl) { this.gripH.set(Math.sin(s.twirl), 0.1, Math.cos(s.twirl)).normalize(); this.gripT.set(0, 1, 0); }
        const H = this.gripH, T = this.gripT.clone().addScaledVector(H, -this.gripT.dot(H));
        if (T.lengthSq() < 1e-6) T.set(1, 0, 0);
        T.normalize();
        const Zb = new THREE.Vector3().crossVectors(T, H);
        this.prop.position.copy(this.gripG).addScaledVector(H, -0.1 * this.hammerLen);
        this.prop.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(T, H, Zb));
      }
    }
    // ---------------- wings
    if ((this.bones.wing_L || this.bones.wing_R) && s.angel && !PERF) {
      // (web edition) the original angel wings: spread with slow strokes hovering, swept back fast, raised gliding
      const fastK = Math.min(1, speed / (this.legLen * 6)) * this.flyBlend;
      const air = Math.max(this.flyBlend, s.gliding ? 1 : 0);
      this.flap += dt * (s.gliding ? 0.4 : 1.1 + 0.8 * fastK);
      const beat = Math.sin(this.flap * 2 * Math.PI) * (s.gliding ? 0.04 : 0.16 * (1 - fastK) + 0.06);
      const lift = s.gliding ? 0.38 : 0.12 * (1 - fastK) * air;
      const sweep = 0.55 * fastK + (1 - air) * 0.12;
      for (const [n, side] of [['wing_L', 1], ['wing_R', -1]] as [BoneName, number][]) {
        if (!this.bones[n]) continue;
        this.applyDelta(n, Dc.clone().multiply(rot(Z, side * (beat * air + lift - (1 - air) * 0.06 + (1 - air) * Math.sin(s.time * 1.3) * 0.02))).multiply(rot(Y, side * sweep)));
      }
    } else if ((this.bones.wing_L || this.bones.wing_R) && s.angel) {
      // angel wings on springs, so every change of state snaps and overshoots: folded back on the ground (with a stretch
      // now and then - Juno's idle fidget), a flare on takeoff, spread wide with slow deep strokes when hovering, swept
      // hard back in a swoop, thrown forward to brake on arrival, folded up like a dart in a superjump, a raised wide V
      // for the angelic descent
      const W = this.ang, fastK = Math.min(1, speed / (this.legLen * 6)) * this.flyBlend, sw = W.swoop + W.sling;
      const air = Math.min(1, Math.max(W.hover, W.glide, sw, W.sup, W.flare, this.airBlend)), ground = 1 - air;
      this.wFidget = Math.max(0, this.wFidget - dt);
      if (ground > 0.9 && this.moveBlend < 0.1 && Math.random() < dt / 7) this.wFidget = 1.1;
      const fid = this.wFidget > 0 ? Math.sin((1.1 - this.wFidget) / 1.1 * Math.PI) : 0;
      const jumpFlare = !s.grounded && s.jumpAge < 0.5 ? Math.sin(Math.min(1, s.jumpAge / 0.5) * Math.PI) * (1 - W.hover) : 0;
      // lift: + raises / opens; sweep: + back along the body
      // (folded well back on the ground: the wing roots arc up beside the head, and a shallower fold pushed them into her hair)
      const liftT = ground * (-0.13 + 0.26 * fid) + W.hover * 0.1 + sw * 0.16 + W.glide * 0.32 + W.sup * 0.42 + W.flare * 0.38 + jumpFlare * 0.3;
      const sweepT = ground * (0.46 - 0.3 * fid + 0.04 * this.moveBlend) + W.hover * (0.05 + 0.3 * fastK) + sw * 0.55 - W.glide * 0.06 + W.sup * 0.5 - W.flare * 0.3 - jumpFlare * 0.25;
      const lift = spring(this.wLift, liftT, 85, 8, dt), sweep = spring(this.wSweep, sweepT, 85, 8, dt);
      // strokes: slow and deep hovering, a fast shiver in a swoop, a slow sway in the descent, a flutter per footstep
      this.flap += dt * (0.9 * W.hover + 6 * sw + 0.55 * W.glide + 1.6 * fastK * W.hover + 0.3 * ground);
      this.stepFlutter *= Math.exp(-dt * 10);
      const beat = Math.sin(this.flap * 2 * Math.PI) * (0.17 * W.hover * (1 - 0.5 * fastK) + 0.025 * sw + 0.05 * W.glide + 0.015 * ground) + this.stepFlutter;
      for (const [n, side] of [['wing_L', 1], ['wing_R', -1]] as [BoneName, number][]) {
        if (!this.bones[n]) continue;
        this.applyDelta(n, Dc.clone().multiply(rot(Z, side * (lift + beat))).multiply(rot(Y, side * sweep)));
      }
    } else if (this.bones.wing_L || this.bones.wing_R) {
      const rate = s.flying ? (s.vel.y > 1 ? 4.2 : 2.6) : 0.8;
      this.flap += dt * rate;
      const amp = s.flying ? (s.vel.y > 1 ? 0.55 : 0.35) : 0.08;
      const f = Math.sin(this.flap * 2 * Math.PI) * amp;
      const fold = (1 - this.flyBlend) * 0.35;
      for (const [n, side] of [['wing_L', 1], ['wing_R', -1]] as [BoneName, number][]) {
        if (!this.bones[n]) continue;
        this.applyDelta(n, Dc.clone().multiply(rot(Z, side * (f - fold))).multiply(rot(Y, side * fold * 0.6)));
      }
    }
    // ---------------- whole-body tilt, applied by the view about the hips: the angel leans her whole body along a swoop
    // (Mercy's guardian-angel flight), flares back to brake, rocks gently in the descent and banks into a hover; every
    // flyer banks into its flight
    {
      let pT = 0, rT = 0, k = 55, d = 9;
      const hs2 = Math.hypot(lvx, lvz) * s.scale, dx = hs2 > 0.5 ? lvx * s.scale / hs2 : 0, dz = hs2 > 0.5 ? lvz * s.scale / hs2 : 0;
      if (s.angel) {
        const W = this.ang, wt = W.swoop + W.sling * 0.8;
        const along = hs2 > 0.5 ? Math.min(1.2, Math.atan2(hs2, s.vel.y) * 0.8) : 0;     // 0 = straight up
        pT = wt * along * dz - W.flare * 0.42 - W.sup * 0.1 + W.glide * (-0.1 + clampA(lvz * s.scale * 0.025, 0.2))
          + W.hover * (clampA(lvz * s.scale / 9, 1) * 0.4 + clampA(this.acc.z / 30, 0.25));
        rT = -wt * along * dx + W.glide * (Math.sin(s.time * 2.9) * 0.08 - clampA(lvx * s.scale * 0.025, 0.2))
          - W.hover * (clampA(lvx * s.scale / 9, 1) * 0.35 + clampA(this.acc.x / 30, 0.25));
        if (W.swoop > 0.5) { k = 90; d = 11; } else if (W.glide > 0.5) { k = 40; d = 7; }
      } else if (flyer && s.flying) {
        pT = clampA(lvz * s.scale / 9, 1) * 0.3; rT = -clampA(lvx * s.scale / 9, 1) * 0.3;
      }
      if (s.grind) { rT += -s.grind * 0.42; pT += 0.16; k = 70; d = 10; }
      else if (s.skate && s.grounded) { pT += clampA(lvz * s.scale / 8, 1) * 0.14; rT += -clampA(lvx * s.scale / 8, 1) * 0.12 + Math.sin(this.phase * Math.PI * 1.1) * 0.05 * this.moveBlend; }
      if (!PERF) { pT = 0; rT = 0; }
      this.tilt.pitch = spring(this.tiltP, pT, k, d, dt); this.tilt.roll = spring(this.tiltR, rT, k, d, dt);
    }
    // ---------------- secondary motion: hair / coat tails / skirts
    if (this.down > 0.01) this.sprawl(kd > 0.32 ? this.down : this.down * this.down);
    // (the Fang is half a turn behind the axe, so one blade is always crossing in front of her)
    this.gunTwirl[0] = s.move === 'tide' && s.twirl ? s.twirl + Math.PI : 0;
    this.hipsOffNow.copy(hipsOff); this.posCache.clear();
    this.dynamics(s, dt);
    this.placeGuns();
    this.placeFeet();
    this.placeBack();
  }
}
