// Per-character clip layer: turns gameplay state into a blended PoseClip pose for the Animator.
//  - base: idle <-> 8-way locomotion blend space (gait by speed, direction by velocity), phase-synced across clips and
//    advanced by DISTANCE travelled (playback rate = body speed / clip speed), so planted feet don't slide
//  - airborne: jump loop; one-shots: jump start, land, rolls / dashes / flips / vaults (full body), melee combos (split
//    hits, advanced per swing), punches, casts, throws, hit reactions (upper body), deaths (full body, held)
// The Animator keeps its procedural layer on top (aim pitch, recoil, flinch, hammer, IK feet, springs) and falls back
// to it wherever the library has no clip.
import * as THREE from 'three';
import type { ClipLibrary, Slot } from './ClipLibrary';
import { Pose, samplePose, accumulate, type PoseClip } from './Retarget';
import { RT, RT_INDEX, type RtBone } from './Rig';

export const UPPER: RtBone[] = ['spine', 'chest', 'neck', 'head', 'shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L', 'shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R'];
const UPPER_I = new Set(UPPER.map(b => RT_INDEX[b]));

/** ability -> the clip slots that sell it (first one the library has wins); everything else casts */
export const CAST_SLOT: Record<string, Slot[]> = {
  pilotroll: ['roll', 'dash'], sunhop: ['flip', 'vault', 'jump_start'], flashstep: ['dash', 'slide'], shadowstep: ['dash', 'flip'],
  spiritstep: ['flip', 'dash'], thousandcuts: ['dash', 'melee'], chain: ['throw', 'cast'], marionette: ['cast', 'throw'],
  reveal: ['shoot', 'cast'], hundredsuns: ['cast'], parry: ['block', 'cast'], veil: ['cast'], judgment: ['cast'], asura: ['cast'],
};
const FULL: Set<Slot> = new Set(['roll', 'dash', 'slide', 'vault', 'flip', 'jump_start', 'land', 'death', 'stun']);
// seconds each one-shot should take in game (its clip is time-scaled into this, within limits)
const TARGET: Partial<Record<Slot, number>> = { punch: 0.42, hit: 0.4, jump_start: 0.3, land: 0.35, roll: 0.55, dash: 0.35, slide: 0.45, flip: 0.7, vault: 0.6, cast: 0.6, throw: 0.55, shoot: 0.35, block: 1.2 };

export interface ClipInput { speed: number; angle: number; moveBlend: number; airBlend: number; eligible: boolean; }
export interface LayerOut {
  pose: Pose;
  legs: number;        // hips / legs / feet
  torso: number;       // spine .. head
  armsLoco: number;    // arms from idle / locomotion (the Animator lowers this while a weapon is held ready)
  armsAction: number;  // arms owned by a one-shot (melee combo, punch, cast): beats procedural aim reach
  loco: number;        // share of the base pose that is locomotion (feet lock on contacts)
  action: string;      // slot of the running one-shot, '' if none
  clipName: string;
}

interface Action { clip: PoseClip; slot: Slot; t: number; rate: number; full: boolean; w: number; hold: boolean; }

export class ClipLayer {
  private base = new Pose(); private tmp = new Pose(); private act = new Pose();
  phase = 0; idleT = 0;
  action: Action | null = null;
  combo = 0;
  private lastMelee = -9;
  private prev = { attack: 9, cast: 9, hit: 9, jump: 9, land: 9 };
  private death: PoseClip | null = null;
  private out: LayerOut = { pose: this.base, legs: 0, torso: 0, armsLoco: 0, armsAction: 0, loco: 0, action: '', clipName: '' };

  constructor(public lib: ClipLibrary, public seed = 0) {}

  private pick(slot: Slot, i = this.seed): PoseClip | null { const l = this.lib.get(slot); return l.length ? l[((i % l.length) + l.length) % l.length] : null; }

  private start(slot: Slot, clip: PoseClip | null, target?: number, hold = false) {
    if (!clip) return;
    const want = target ?? TARGET[slot] ?? clip.duration;
    const rate = Math.min(2.2, Math.max(0.6, clip.duration / Math.max(0.05, want)));
    this.action = { clip, slot, t: 0, rate, full: FULL.has(slot), w: 0, hold };
  }

  update(s: {
    dt: number; time: number; attackAge: number; attackKind: string; castAge: number; castId: string; hitAge: number; jumpAge: number; landAge: number;
    melee?: boolean; hammer?: boolean; stunned: boolean; dead?: boolean; deathAge?: number; attackTime?: number; grounded: boolean;
  }, k: ClipInput): LayerOut | null {
    // real elapsed time (not the Animator's 50 ms clamp): the gait phase must keep up with the distance the body really
    // covered, or locked feet fall behind the clip on slow frames
    const dt = Math.min(0.25, Math.max(0, s.dt));
    const o = this.out;
    o.action = ''; o.armsAction = 0; o.clipName = '';
    // ---- death: full body, held on the last frame
    if (s.dead) {
      this.death ??= this.pick('death');
      if (!this.death) return null;
      samplePose(this.death, Math.min(this.death.duration, (s.deathAge ?? 0) * Math.max(1, this.death.duration / 1.6)), this.base);
      o.legs = o.torso = o.armsAction = 1; o.armsLoco = 0; o.loco = 0; o.action = 'death'; o.clipName = this.death.name;
      return o;
    }
    this.death = null;
    // ---- one-shot triggers (ages drop to ~0 when a new event happens)
    const P = this.prev;
    if (s.attackAge < P.attack - 1e-6) {
      if (s.attackKind === 'punch') this.start('punch', this.pick('punch', 0) ?? this.pick('melee', 0));
      else if (s.melee && !s.hammer && this.lib.has('melee')) {
        // melee combos: each swing plays the next hit of the combo, reset after a pause
        this.combo = s.time - this.lastMelee < 1.1 ? this.combo + 1 : 0;
        this.lastMelee = s.time;
        const c = this.pick('melee', this.combo);
        this.start('melee', c, Math.max(0.3, (s.attackTime ?? c?.duration ?? 0.6) * 1.05));
      }
    }
    if (s.castAge < P.cast - 1e-6 && s.castId) {
      const slots = CAST_SLOT[s.castId] ?? ['cast'];
      const slot = slots.find(x => this.lib.has(x));
      if (slot) this.start(slot, this.pick(slot, slot === 'melee' ? 0 : this.seed + Math.floor(s.time)));
    }
    if (s.hitAge < P.hit - 1e-6 && (!this.action || this.action.slot === 'hit')) this.start('hit', this.pick('hit', Math.floor(s.time * 7)));
    if (s.jumpAge < P.jump - 1e-6 && (!this.action || !this.action.full)) this.start('jump_start', this.pick('jump_start', 0));
    if (s.landAge < P.land - 1e-6 && s.jumpAge > 0.25 && (!this.action || this.action.slot === 'jump_start')) this.start('land', this.pick('land', 0));
    P.attack = s.attackAge; P.cast = s.castAge; P.hit = s.hitAge; P.jump = s.jumpAge; P.land = s.landAge;
    if (!k.eligible) { this.action = null; return null; }
    // ---- base: idle / locomotion / airborne / stunned
    const base = this.base.reset();
    const air = k.airBlend;
    const idleClip = s.stunned ? this.pick('stun', 0) ?? this.pick('idle', 0) : this.pick('idle', 0);
    this.idleT += dt;
    const locoList = this.lib.blend(k.angle, k.speed);
    const wLoco = locoList.length ? k.moveBlend : 0;
    const wIdle = idleClip ? 1 - k.moveBlend : 0;
    const ground = (wLoco + wIdle) * (1 - air);
    if (wLoco > 0 && air < 1) {
      // distance-driven phase: one cycle = the blended stride
      let D = 0, W = 0;
      for (const e of locoList) { D += e.w * e.clip.speed * e.clip.duration; W += e.w; }
      D /= Math.max(1e-6, W);
      if (D > 1e-4) this.phase = (this.phase + k.speed * dt / D) % 1;
      for (const e of locoList) {
        const c = e.clip;
        samplePose(c, ((this.phase + c.phase0) % 1) * c.duration, this.tmp);
        accumulate(base, this.tmp, e.w * wLoco * (1 - air));
      }
    }
    if (wIdle > 0 && air < 1 && idleClip) accumulate(base, samplePose(idleClip, this.idleT, this.tmp), wIdle * (1 - air));
    const jl = air > 0.01 ? this.pick('jump_loop', 0) : null;
    if (jl) accumulate(base, samplePose(jl, this.idleT, this.tmp), air);
    const baseW = Math.min(1, ground + (jl ? air : 0));
    const cw = (wLoco + wIdle) > 0 ? 1 / Math.max(1e-6, wLoco + wIdle) : 0;
    if (air > 0.5) base.contact[0] = base.contact[1] = 0;
    else { const n = cw / (1 - air); base.contact[0] *= n; base.contact[1] *= n; }
    o.loco = (wLoco * (1 - air)) / Math.max(1e-6, baseW);
    o.legs = o.torso = o.armsLoco = baseW;
    // ---- one-shot on top
    const a = this.action;
    if (a) {
      a.t += dt * a.rate;
      const real = a.clip.duration / a.rate, tr = a.t / a.rate;
      if (a.t >= a.clip.duration && !a.hold) this.action = null;
      else {
        a.w = Math.min(1, tr / 0.08, a.clip.loop ? 1 : Math.max(0, (real - tr) / 0.15));
        samplePose(a.clip, a.t, this.act);
        // full-body moves own the legs; melee owns them only while standing (you can swing on the run)
        const legW = a.full ? a.w : a.slot === 'melee' ? a.w * (1 - k.moveBlend * 0.85) : 0;
        for (let i = 0; i < RT.length; i++) {
          if (!this.act.w[i]) continue;
          const w = UPPER_I.has(i) ? a.w * (a.slot === 'hit' ? 0.65 : 1) : legW;
          if (w <= 0) continue;
          if (!base.w[i]) { base.q[i].copy(this.act.q[i]); base.p[i].copy(this.act.p[i]); base.d[i].copy(this.act.d[i]); base.w[i] = 1; }
          else { base.q[i].slerp(this.act.q[i], w); base.p[i].lerp(this.act.p[i], w); base.d[i].lerp(this.act.d[i], w); }
        }
        if (legW > 0) {
          base.contact[0] = base.contact[0] * (1 - legW) + this.act.contact[0] * legW; base.contact[1] = base.contact[1] * (1 - legW) + this.act.contact[1] * legW;
          o.legs = o.legs + (1 - o.legs) * legW; o.loco *= 1 - legW;
        }
        const up = a.w * (a.slot === 'hit' ? 0.65 : 1);
        o.torso = o.torso + (1 - o.torso) * up;
        o.armsAction = up;
        o.action = a.slot; o.clipName = a.clip.name;
      }
    }
    return o;
  }
}

/** model-space direction of a limb in a pose (canonical frame == the Animator's model frame) */
export function poseDir(p: Pose, a: RtBone, b: RtBone, out = new THREE.Vector3()) {
  return out.copy(p.p[RT_INDEX[b]]).sub(p.p[RT_INDEX[a]]).normalize();
}
