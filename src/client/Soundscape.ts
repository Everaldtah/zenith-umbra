// The desktop edition's match audio, frame by frame: what the listener's surroundings sound like (occlusion, indoor room,
// wall reflections), who the biggest threats are (Overwatch's importance buckets decide how loud each enemy is), every
// looping sound (beams, flames, grinding skates, wind, Hibiki's tracks, the map's bed), physics sounds (footsteps by
// surface and weight, impacts by material, shell casings), and the stimuli that make heroes talk.
import * as THREE from 'three';
import { sfx, type PlayOpts } from '../audio/Sfx';
import { voice } from '../audio/Voice';
import { isAbility } from '../data/heroes';
import type { Actor } from '../game/Actor';
import type { GameEvent, World } from '../game/World';

type Prev = { jump: number; land: number; alive: boolean; low: boolean; swoop: boolean; grind: boolean; burning: boolean; reload: number; spin: number; flying: boolean };
const V = new THREE.Vector3();

export class Soundscape {
  private w: World | null = null;
  private me: Actor | null = null;
  private prev = new Map<number, Prev>();
  private hitMe = new Map<number, number>();    // enemy id -> when they last hurt the player
  private tSlow = 0;
  private obj: Record<string, any> = {};
  private lastHitSnd = 0;

  start(w: World, me: Actor | null) {
    this.w = w; this.me = me; this.prev.clear(); this.hitMe.clear(); this.obj = {};
    voice.reset(); voice.me = me;
    sfx.setSpace(w.map.id);
    const L = w.level;
    // occlusion: a wall between the listener and the sound muffles it; a floor between (upstairs / downstairs) more so
    sfx.occlude = p => {
      const l = sfx.listener;
      if (L.lineOfSight({ x: l.x, y: l.y, z: l.z }, { x: p.x, y: p.y + 0.8, z: p.z })) return 0;
      return Math.abs(p.y - l.y) > 3 ? 0.9 : 0.65;
    };
    if (me) setTimeout(() => voice.say(me, 'select', 'chatter'), 900);
    setTimeout(() => voice.announce('match_start'), 400);
  }

  stop() { sfx.stopAllLoops(); voice.reset(); sfx.occlude = null; sfx.threat.clear(); this.w = null; }

  private rel(a: Actor | null | undefined): PlayOpts['rel'] {
    const me = this.me;
    if (!a || !me) return undefined;
    return a === me ? 'self' : a.team === me.team ? 'ally' : 'enemy';
  }

  /** footsteps: the surface under the foot, the hero's weight, enemy steps louder than friendly ones */
  step(a: Actor, _heavy: boolean) {
    const w = this.w; if (!w) return;
    const rel = this.rel(a);
    let id: string;
    if (a.def.frame === 'mech') id = 'mechstep';
    else if (a.def.id === 'gantetsu') id = 'step_heavy';
    else if (a.def.id === 'hibiki') { if (Math.random() < 0.5) return; id = 'skate'; }
    else {
      const m = w.level.matAt(a.pos.x, a.pos.z, a.pos.y + 0.2);
      id = m === 'wood' ? 'step_wood' : m === 'trim' || m === 'glass' || m === 'window' || (w.map.id === 'hangar' && m !== 'accent') ? 'step_metal' : 'step_stone';
    }
    sfx.play(id, rel === 'self' ? undefined : a.pos, rel === 'self' ? 0.45 : 1, { actor: a, rel });
  }

  /** World events that sound: routed with who made them; pain, deaths, kills and casts become voice lines */
  event(e: GameEvent) {
    const w = this.w, me = this.me; if (!w) return;
    if (e.t === 'sfx') {
      // hit / crit ticks are the shooter's feedback (played from 'dmg' below), not a sound at the target
      if (e.id === 'hit' || e.id === 'crit') return;
      const rel = this.rel(e.actor);
      sfx.play(e.id, rel === 'self' ? undefined : e.pos, (e.vol ?? 1) * (rel === 'self' ? 0.85 : 1), { actor: e.actor, rel });
      // rotary cannons spit brass: a tinkle at his feet now and then
      if ((e.id === 'chaingun' || e.id === 'chaingun2') && e.actor && Math.random() < 0.35) {
        const p = { ...e.actor.pos }, r2 = this.rel(e.actor);
        setTimeout(() => sfx.play('casing', { x: p.x + (Math.random() - 0.5), y: p.y, z: p.z + (Math.random() - 0.5) }, 0.55, { actor: e.actor, rel: r2 === 'self' ? 'ally' : r2 }), 220 + Math.random() * 260);
      }
      return;
    }
    if (e.t === 'fx' && e.kind === 'impact' && !e.actor) {
      // bullets and blades hitting the world sound like what they hit
      const m = (e as any).mat as string | undefined;
      const id = m === 'wood' ? 'impact_wood' : m === 'trim' || m === 'glass' || m === 'window' || m === 'accent' ? 'impact_metal' : 'impact_stone';
      if (Math.random() < 0.6) sfx.play(id, e.pos, 0.8);
      return;
    }
    if (e.t === 'dmg' && !e.heal) {
      if (e.src === me && e.tgt !== me) {
        const t = performance.now();
        if (t - this.lastHitSnd > 45) { this.lastHitSnd = t; sfx.play(e.crit ? 'crit' : 'hit', undefined, e.crit ? 1 : 0.9); }
      }
      if (e.tgt === me) {
        if (e.src) this.hitMe.set(e.src.id, performance.now() / 1000);
        if (e.amt >= 20) sfx.play('impact_body', undefined, Math.min(1, e.amt / 90) * 0.7);
      }
      if (e.tgt.alive && e.amt >= 8) {
        const big = e.amt >= 60 || e.tgt.health / e.tgt.maxHp < 0.25;
        voice.say(e.tgt, big ? 'pain_big' : 'pain', 'pain', { involved: e.src });
      }
      return;
    }
    if (e.t === 'kill') {
      voice.say(e.tgt, 'death', 'death');
      const s = e.src;
      if (s && s.alive && s !== e.tgt) {
        const rival = s.def.rival === e.tgt.def.id || s.baseDef.rival === e.tgt.baseDef.id;
        setTimeout(() => voice.say(s, rival ? 'kill_rival' : 'kill', 'chatter', { involved: e.tgt }) || (rival && voice.say(s, 'kill', 'chatter', { involved: e.tgt })), 450);
      }
      return;
    }
    if (e.t === 'demech') { voice.say(e.tgt, 'eject', 'death'); return; }
    if (e.t === 'cast') {
      const a = e.actor, d = a.def;
      if (e.id === d.ult.id) {
        const pilot = d.ult.id === 'callmech';
        voice.say(a, pilot ? 'ult_pilot' : 'ult', 'critical', { allyKey: pilot ? 'ult_pilot_ally' : 'ult_ally' });
        return;
      }
      let key = e.id === d.ability1.id ? 'a1' : e.id === d.ability2.id ? 'a2' : isAbility(d.secondary) && e.id === d.secondary.id ? 'alt' : '';
      if (e.id === 'crossmix') key = a.sv.track ? 'speed_track' : 'heal_track';
      if (!key) return;
      // a grab or a charge is a warning the enemy should hear
      const warn = (d.id === 'enra' && key === 'a1') || (d.id === 'gantetsu' && key === 'a1');
      voice.say(a, key, warn ? 'critical' : 'chatter', { allyKey: key });
      return;
    }
  }

  /** once per rendered frame */
  frame(w: World, me: Actor | null, cam: THREE.Camera, dt: number) {
    this.me = me; voice.me = me;
    const t = w.time, L = w.level;
    sfx.beginFrame();
    // ---- the listener's space (4 Hz)
    this.tSlow -= dt;
    if (this.tSlow <= 0) {
      this.tSlow = 0.25;
      const l = sfx.listener;
      sfx.setIndoor(L.ceilingAt(l.x, l.z, l.y) < l.y + 14 ? 1 : 0);
      cam.getWorldDirection(V); V.y = 0; V.normalize();
      const dirs = [[V.x, V.z], [-V.z, V.x], [-V.x, -V.z], [V.z, -V.x]];
      sfx.setReflections(dirs.map(([x, z]) => L.ray({ x: l.x, y: l.y, z: l.z }, { x, y: 0, z }, 60)?.t ?? Infinity));
      this.threat(w, me);
    }
    // ---- loops
    sfx.loop('amb', `amb_${w.map.id}`, null, 0.85);
    for (const a of w.actors) {
      if (!a.alive || a.isRobot) continue;
      const rel = this.rel(a), o: PlayOpts = { actor: a, rel };
      const at = rel === 'self' ? null : a.center;
      if (a.flameOn) sfx.loop(`fl${a.id}`, 'flame', at, 0.9, o);
      if (a.beamOn && !isAbility(a.def.secondary)) sfx.loop(`bm${a.id}`, a.def.secondary.sfx === 'healbeam2' ? 'healbeam2' : 'healbeam', at, 0.7, o);
      if (a.has('burning', t)) sfx.loop(`bu${a.id}`, 'burn', at, 0.6, o);
      const hs = Math.hypot(a.vel.x, a.vel.z);
      if (a.def.id === 'hibiki') {
        if (a.has('grinding', t)) sfx.loop(`gr${a.id}`, 'grind', at, 0.8, o);
        else if (a.grounded && hs > 1.5) sfx.loop(`sk${a.id}`, 'skate_roll', at, Math.min(1, hs / 8) * 0.6, { ...o, rate: 0.85 + hs / 30 });
        // his track plays out of the speaker rig: you hear the groove when you're near him
        const amp = a.has('amp', t);
        sfx.loop(`mx${a.id}`, a.sv.track ? 'groove_speed' : 'groove_heal', rel === 'self' ? null : a.center, amp ? 0.55 : 0.3, o);
      }
      if (rel === 'self' && (a.flying || a.has('swoop', t) || !a.grounded) && Math.hypot(hs, a.vel.y) > 9) sfx.loop('wind', 'wind', null, Math.min(1, (Math.hypot(hs, a.vel.y) - 9) / 12) * 0.7, o);
      this.stimuli(w, a, rel);
    }
    sfx.endFrame();
    this.objective(w, me);
  }

  /** Overwatch's importance buckets: 1 HIGH, 2 NORMAL, 4-10 LOW, the rest culled; teammates sit in LOW */
  private threat(w: World, me: Actor | null) {
    sfx.threat.clear();
    if (!me) return;
    const t = w.time, now = performance.now() / 1000, e = me.eye, md = me.aimDir();
    const scored: [Actor, number][] = [];
    for (const x of w.actors) {
      if (!x.alive || x === me) continue;
      if (x.team === me.team) { sfx.threat.set(x.id, 0.7); continue; }
      const v = { x: e.x - x.eye.x, y: e.y - x.eye.y, z: e.z - x.eye.z }, d = Math.hypot(v.x, v.y, v.z) || 1, xd = x.aimDir();
      let s = 0;
      if ((v.x * xd.x + v.y * xd.y + v.z * xd.z) / d > 0.975) s += 40;              // looking at me
      if (now - (this.hitMe.get(x.id) ?? -99) < 2) s += 30;                           // hurting me
      if (d < 10) s += 20; else if (d < 20) s += 10;                                  // close
      if (t - x.anim.attackAt < 0.5) s += 25;                                         // shooting
      if (t - x.anim.castAt < 3 && x.anim.castId === x.def.ult.id) s += 35;          // a dangerous ability
      if ((-v.x * md.x - v.y * md.y - v.z * md.z) / d > 0.985) s += 15;               // I'm looking at them
      scored.push([x, s]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    scored.forEach(([x], i) => sfx.threat.set(x.id, i === 0 ? 1.25 : i < 3 ? 1 : i < 10 ? 0.7 : 0.35));
  }

  /** edges in a hero's state that make them speak (efforts, calls for help, thanks) or make a physical sound */
  private stimuli(w: World, a: Actor, rel: PlayOpts['rel']) {
    const t = w.time;
    let p = this.prev.get(a.id);
    const cur: Prev = { jump: a.anim.jumpAt, land: a.anim.landAt, alive: a.alive, low: a.health / a.maxHp < 0.35, swoop: a.has('swoop', t),
      grind: a.has('grinding', t), burning: a.has('burning', t), reload: a.reloadUntil, spin: Math.max(a.sv.spin1 ?? 0, a.sv.spin2 ?? 0), flying: a.flying };
    if (!p) { this.prev.set(a.id, cur); return; }
    if (cur.jump !== p.jump && t - cur.jump < 0.2) voice.say(a, 'jump', 'exert');
    if (cur.land !== p.land && t - cur.land < 0.2) voice.say(a, 'land', 'exert');
    if (cur.low && !p.low) voice.say(a, 'low_hp', 'chatter');
    if (cur.swoop && !p.swoop) { voice.say(a, 'swoop', 'chatter'); sfx.play('wings', rel === 'self' ? undefined : a.center, 0.8, { actor: a, rel }); }
    if (cur.flying && !p.flying && a.def.frame === 'flyer') sfx.play('wings', rel === 'self' ? undefined : a.center, 0.6, { actor: a, rel });
    if (cur.grind && !p.grind) voice.say(a, 'grind', 'chatter');
    if (cur.burning && !p.burning) voice.say(a, 'burn', 'pain', { involved: a.src.burning as Actor | undefined });
    if (rel === 'self' && cur.reload > t && p.reload <= t && a.ammo <= 0) voice.say(a, 'reload', 'chatter');
    if (p.spin > 0.5 && cur.spin <= 0.5 && a.def.dualGuns) sfx.play('spindown', rel === 'self' ? undefined : a.center, 0.7, { actor: a, rel });
    // a solid heal from someone else when he needed it
    if (a.sv.healedAt && t - a.sv.healedAt < 0.1 && a.health / a.maxHp > 0.8 && (a.sv.wasLowAt ?? -99) > t - 6) { a.sv.wasLowAt = -99; voice.say(a, 'thanks', 'chatter'); }
    if (cur.low) a.sv.wasLowAt = t;
    if (rel === 'self' && cur.alive && !p.alive) voice.say(a, 'respawn', 'chatter');
    this.prev.set(a.id, cur);
  }

  /** the announcer and the player's objective calls, from the objective's state changes */
  private objective(w: World, me: Actor | null) {
    const O = this.obj, my = me?.team ?? 'zenith', t = w.time;
    const once = (k: string, v: any, fn: () => void) => { if (O[k] !== undefined && O[k] !== v) fn(); O[k] = v; };
    if (w.winner) { once('win', w.winner, () => voice.announce(w.winner === my ? 'victory' : 'defeat')); return; }
    if (w.rules === 'control') {
      const P = w.point, C = w.control;
      once('open', t >= P.unlockAt && C.phase === 'fight', () => { if (t >= P.unlockAt && C.phase === 'fight') { voice.announce('point_open'); if (me) setTimeout(() => voice.say(me, 'attack_point', 'chatter'), 1600); } });
      once('cap', P.capTeam, () => { if (P.capTeam) voice.announce(P.capTeam === my ? 'we_capture' : 'they_capture'); });
      once('owner', P.owner, () => { if (P.owner) voice.announce(P.owner === my ? 'point_taken' : 'point_lost'); if (P.owner && P.owner !== my && me) setTimeout(() => voice.say(me, 'contest', 'chatter'), 1500); });
      once('ot', C.overtime, () => { if (C.overtime) voice.announce('overtime'); });
      once('wins', `${C.wins.zenith}-${C.wins.umbra}`, () => { const mine = C.wins[my], theirs = C.wins[my === 'zenith' ? 'umbra' : 'zenith']; voice.announce(mine > (O.mine ?? 0) ? 'round_won' : 'round_lost'); O.mine = mine; O.theirs = theirs; });
      once('round', C.round, () => voice.announce(C.round >= 3 ? 'round_3' : 'round_2'));
    } else if (w.rules === 'push') {
      const M = w.push;
      once('open', t >= M.unlockAt, () => { if (t >= M.unlockAt) { voice.announce('float_unlock'); if (me) setTimeout(() => voice.say(me, 'push', 'chatter'), 2600); } });
      once('owner', M.owner, () => { if (M.owner) voice.announce(M.owner === my ? 'float_moving' : 'float_enemy'); });
      once('con', M.contested, () => { if (M.contested) voice.announce('float_contested'); });
    }
    const left = w.timeLimit - t;
    once('thirty', left < 30, () => { if (left < 30 && left > 0) voice.announce('thirty'); });
  }
}
