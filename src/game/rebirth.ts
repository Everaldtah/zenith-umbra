// Mirei - Stellar Rebirth: every teammate who fell within the last ten seconds inside her perimeter stands up again where
// they fell, at full health. Modelled on Mercy's launch-era Resurrect ultimate (docs/research/resurrect_study.md): an
// instant cast over a 15 m radius, through walls; the reborn are untouchable for 2.25 s and can't fight until that ends
// (they can walk after 1.5 s); she is untouchable herself for the flourish.
import type { Actor } from './Actor';
import type { World } from './World';
import { dist3 } from './World';

/** the perimeter (m, through walls, as Mercy's was) */
export const REBIRTH_R = 15;
/** how long a fallen teammate's soul can still be called back (s from the death) */
export const REBIRTH_WINDOW = 10;
/** the reborn: untouchable and unable to fight for this long ('reborn'), unable to walk for the first part ('rising') */
export const REBIRTH_GUARD = 2.25, REBIRTH_RISE = 1.5;
/** her own guard while she sings them back (s) */
export const REBIRTH_SELF_GUARD = 1.5;
export const REBIRTH_COLOR = '#ffe9a8';

/** a fallen teammate she could still call back: dead, not yet respawned, fell within the window, inside the perimeter */
export function soulsOf(w: World, a: Actor, r = REBIRTH_R): Actor[] {
  const t = w.time;
  return w.actors.filter(x => x !== a && x.team === a.team && !x.alive && !x.isSummon
    && !x.noRespawn && x.respawnAt > t && t - x.deathAt <= REBIRTH_WINDOW && dist3(x.pos, a.pos) <= r);
}

/** the soul of a fallen hero the renderer can show: any teammate a living Mirei could still call back */
export function soulLingers(w: World, x: Actor): boolean {
  const t = w.time;
  if (x.alive || x.isSummon || x.noRespawn || x.respawnAt <= t || t - x.deathAt > REBIRTH_WINDOW) return false;
  return w.actors.some(m => m.alive && m.team === x.team && m.def.ult.id === 'rebirth');
}

/** stand one fallen hero up where they fell */
export function resurrect(w: World, by: Actor, x: Actor) {
  const t = w.time;
  const at = { ...x.pos };
  // (a body that fell into the void, or is sinking through the floor, comes up on the nearest footing)
  const g = w.level.groundAt(at.x, at.z, at.y + 1.5);
  if (g > -Infinity && Math.abs(g - at.y) < 3) at.y = g;
  w.respawn(x);
  x.pos = at; x.vel = { x: 0, y: 0, z: 0 };
  x.yaw = x.input.yaw = Math.atan2(by.pos.x - at.x, by.pos.z - at.z);      // facing whoever sang them back
  x.clear('spawnprot');
  x.set('reborn', t, REBIRTH_GUARD); x.set('rising', t, REBIRTH_RISE);
  x.sv.rebornAt = t; x.sv.rebornBy = by.id;
  w.fx('rebirth', x.center, { color: REBIRTH_COLOR, actor: x, dur: REBIRTH_GUARD });
  w.sfx('rebirth', x.center, x);
  w.emit({ t: 'msg', text: `${x.def.name.toUpperCase()} RETURNS`, color: REBIRTH_COLOR });
  by.stats.rebirths = (by.stats.rebirths ?? 0) + 1;
}

/** Stellar Rebirth: the cast. Returns how many stood up. */
export function stellarRebirth(w: World, a: Actor): number {
  const t = w.time;
  const souls = soulsOf(w, a);
  a.set('spawnprot', t, REBIRTH_SELF_GUARD);
  a.sv.rebirthAt = t;
  w.fx('rebirthcast', a.center, { r: REBIRTH_R, color: REBIRTH_COLOR, actor: a, dur: REBIRTH_GUARD });
  w.sfx('ultcall', a.center, a); w.sfx('rebirthcast', a.center, a);
  for (const x of souls) resurrect(w, a, x);
  w.emit({ t: 'msg', text: souls.length ? `MIREI · STELLAR REBIRTH · ${souls.length} RETURN` : 'MIREI · STELLAR REBIRTH', color: a.def.color });
  return souls.length;
}
