// AI Test Lab: 10 bots play every map while this validates animation, movement, physics, effects and sound.
// The report is shown live and exposed as window.__zu.lab() for the headless e2e test.
import * as THREE from 'three';
import { HEROES } from '../data/heroes';
import type { World, GameEvent } from '../game/World';
import type { CharacterView } from '../render/CharacterView';
import type { Fx } from '../render/Fx';
import { sfx, SFX_IDS } from '../audio/Sfx';
import type { Bot } from '../ai/Bot';

const ANIM_STATES = ['idle', 'run', 'strafe', 'backpedal', 'jump', 'fall', 'attack', 'cast', 'hit', 'death'];
const ALL_ABILITIES = HEROES.flatMap(h => [h.ability1.id, h.ability2.id, h.ult.id, ...('id' in h.secondary && !['bulwark', 'zoom'].includes(h.secondary.id) ? [h.secondary.id] : [])]);
const COUNTERS = HEROES.map(h => [h.id, h.rival]);

interface HeroStats { states: Set<string>; slideSum: number; slideN: number; slideMax: number; nan: number; penetrate: number; sink: number; overspeed: number; frames: number; rig: string; flyFrames: number; wingFrames: number; }

export class AiLab {
  maps: Record<string, { secs: number; kills: number; falls: number; stuck: number; winner: string | null }> = {};
  heroes = new Map<string, HeroStats>();
  casts = new Set<string>();
  counters = new Map<string, string>();       // "a>b" -> text
  fxKinds: Record<string, number> = {};
  sfxIds: Record<string, number> = {};
  fps: number[] = [];
  drawCalls = 0; tris = 0;
  particlePeak = 0;
  projOrphans = 0; zoneOrphans = 0;
  startedAt = performance.now();
  panel: HTMLElement;
  private prevFoot = new Map<string, THREE.Vector3>();
  private wasPlanted = new Map<string, boolean>();
  private tmp = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.panel = document.createElement('div');
    this.panel.className = 'lab';
    parent.append(this.panel);
    (window as any).__zu = { ...(window as any).__zu, lab: () => this.report() };
  }

  private hs(id: string): HeroStats {
    let s = this.heroes.get(id);
    if (!s) { s = { states: new Set(), slideSum: 0, slideN: 0, slideMax: 0, nan: 0, penetrate: 0, sink: 0, overspeed: 0, frames: 0, rig: 'mannequin', flyFrames: 0, wingFrames: 0 }; this.heroes.set(id, s); }
    return s;
  }

  onEvent(e: GameEvent) {
    if (e.t === 'cast') this.casts.add(e.id);
    else if (e.t === 'counter') this.counters.set(`${e.actor.def.id}>${e.target.def.id}`, e.text);
    else if (e.t === 'fx') this.fxKinds[e.kind] = (this.fxKinds[e.kind] ?? 0) + 1;
    else if (e.t === 'sfx') this.sfxIds[e.id] = (this.sfxIds[e.id] ?? 0) + 1;
  }

  frame(w: World, views: Map<number, CharacterView>, fx: Fx, dt: number, renderer: THREE.WebGLRenderer) {
    const t = w.time;
    if (dt > 0) this.fps.push(1 / dt);
    if (this.fps.length > 600) this.fps.shift();
    this.drawCalls = renderer.info.render.calls; this.tris = renderer.info.render.triangles;
    this.particlePeak = Math.max(this.particlePeak, fx.parts.alive);
    this.projOrphans = Math.max(0, w.projs.length - fx.projMeshes.size);
    this.zoneOrphans = Math.max(0, w.zones.filter(z => z.kind !== 'tether').length - fx.zoneMeshes.size);
    for (const a of w.actors) {
      if (a.isRobot) continue;
      const s = this.hs(a.def.id);
      const v = views.get(a.id);
      if (!v) continue;
      s.rig = v.real ? (v.anim.ok ? 'rigged' : 'NO-RIG') : 'mannequin';
      if (!a.alive) { if (t - a.deathAt < 0.5) s.states.add('death'); continue; }
      s.frames++;
      // --- animation states actually exercised
      const lv = { x: a.vel.x, z: a.vel.z };
      const sp = Math.hypot(lv.x, lv.z);
      const f = a.forward();
      const fwd = (lv.x * f.x + lv.z * f.z) / (sp || 1);
      if (a.grounded && sp < 0.3) s.states.add('idle');
      if (a.grounded && sp > 1) s.states.add(fwd > 0.6 ? 'run' : fwd < -0.6 ? 'backpedal' : 'strafe');
      if (!a.grounded && a.vel.y > 1) s.states.add('jump');
      if (!a.grounded && a.vel.y < -1) s.states.add('fall');
      if (t - a.anim.attackAt < 0.05) s.states.add('attack');
      if (t - a.anim.castAt < 0.05) s.states.add('cast');
      if (t - a.anim.hitAt < 0.05) s.states.add('hit');
      if (a.flying) { s.states.add('fly'); s.flyFrames++; if (v.anim.bones.wing_L || !v.real) s.wingFrames++; }
      // --- bone sanity
      for (const b of Object.values(v.anim.bones)) if (b && (!Number.isFinite(b.quaternion.x) || !Number.isFinite(b.quaternion.w))) { s.nan++; break; }
      // --- foot sliding: a planted foot (grounded, walking, foot at its lowest) should not move in the world
      if (v.anim.ok && a.grounded && sp > 1 && !a.forced) {
        for (const side of ['L', 'R'] as const) {
          const bone = v.anim.bones[`foot_${side}`];
          if (!bone) continue;
          bone.getWorldPosition(this.tmp);
          const key = `${a.id}${side}`;
          const prev = this.prevFoot.get(key);
          const idx = side === 'L' ? 0 : 1;
          const planted = !!v.anim.plant[idx] && (this.wasPlanted.get(key) ?? false);
          this.wasPlanted.set(key, !!v.anim.plant[idx]);
          if (prev && planted && dt > 0) {
            const slide = Math.hypot(this.tmp.x - prev.x, this.tmp.z - prev.z) / dt;
            s.slideSum += slide / sp; s.slideN++; s.slideMax = Math.max(s.slideMax, slide / sp);
          }
          this.prevFoot.set(key, this.tmp.clone());
        }
      } else { this.prevFoot.delete(`${a.id}L`); this.prevFoot.delete(`${a.id}R`); }
      // --- physics
      const p = { ...a.pos };
      if (w.level.collide(p, a.radius * 0.8, a.height)) s.penetrate++;
      const g = w.level.groundAt(a.pos.x, a.pos.z, a.pos.y + 0.5);
      if (a.grounded && g > a.pos.y + 0.15) s.sink++;
      if (!a.forced && a.grounded && sp > a.def.speed * 1.6 * Math.max(1, a.scale) + 0.5 && !a.has('padflight', t)) s.overspeed++;
    }
  }

  endMap(w: World, bots: Bot[]) {
    const kills = w.actors.reduce((s, a) => s + a.kills, 0), deaths = w.actors.reduce((s, a) => s + a.deaths, 0);
    this.maps[w.map.id] = { secs: Math.round(w.time), kills, falls: deaths - kills, stuck: bots.reduce((s, b) => s + b.stuckCount, 0), winner: w.winner };
  }

  report() {
    const heroes: Record<string, any> = {};
    const fails: string[] = [];
    for (const [id, s] of this.heroes) {
      const slide = s.slideN ? s.slideSum / s.slideN : 0;
      const missing = ANIM_STATES.filter(x => !s.states.has(x) && !(x === 'backpedal' || x === 'strafe'));
      heroes[id] = { rig: s.rig, states: [...s.states].sort(), missing, footSlide: +slide.toFixed(3), footSlideMax: +s.slideMax.toFixed(2), nan: s.nan, penetrationFrames: s.penetrate, sinkFrames: s.sink, overspeed: s.overspeed, frames: s.frames };
      if (s.nan) fails.push(`${id}: NaN bones`);
      if (s.rig === 'NO-RIG') fails.push(`${id}: model has no usable rig`);
      // flyers take off / land constantly and their feet hang inside gowns: allow a little more
      const limit = id === 'mirei' || id === 'nocturne' ? 0.3 : 0.25;
      if (slide > limit) fails.push(`${id}: foot sliding ${(slide * 100).toFixed(0)}% of body speed`);
      if (s.frames > 600 && s.penetrate / s.frames > 0.02) fails.push(`${id}: wall penetration ${(s.penetrate / s.frames * 100).toFixed(1)}% of frames`);
      if (s.frames > 600 && s.sink / s.frames > 0.02) fails.push(`${id}: sinking into floor`);
      if (s.overspeed > Math.max(30, s.frames * 0.01)) fails.push(`${id}: moving faster than allowed (${s.overspeed} frames)`);
    }
    const missingCasts = ALL_ABILITIES.filter(x => !this.casts.has(x));
    const counterPairs = COUNTERS.map(([a, b]) => `${a}>${b}`);
    const countersSeen = counterPairs.filter(k => this.counters.has(k));
    const unknownSfx = [...sfx.unknown];
    if (unknownSfx.length) fails.push(`sounds without a recipe: ${unknownSfx.join(', ')}`);
    if (this.projOrphans > 2) fails.push(`projectiles without visuals: ${this.projOrphans}`);
    const avgFps = this.fps.length ? this.fps.reduce((s, x) => s + x, 0) / this.fps.length : 0;
    const sorted = [...this.fps].sort((a, b) => a - b);
    const p5 = sorted.length ? sorted[Math.floor(sorted.length * 0.05)] : 0;
    return {
      pass: fails.length === 0, fails, maps: this.maps, heroes,
      abilities: { cast: this.casts.size, of: ALL_ABILITIES.length, missing: missingCasts },
      counters: { seen: countersSeen.length, of: counterPairs.length, list: Object.fromEntries(this.counters) },
      effects: { kinds: Object.keys(this.fxKinds).length, particlePeak: this.particlePeak, counts: this.fxKinds },
      sounds: { ids: Object.keys(this.sfxIds).length, recipes: SFX_IDS.length, unknown: unknownSfx, audio: sfx.ctx?.state ?? 'none', counts: this.sfxIds },
      perf: { avgFps: +avgFps.toFixed(1), p5Fps: +p5.toFixed(1), drawCalls: this.drawCalls, tris: this.tris },
      minutes: +((performance.now() - this.startedAt) / 60000).toFixed(1),
    };
  }

  render() {
    const r = this.report();
    const ok = (b: boolean) => b ? '<i class="ok">✔</i>' : '<i class="bad">✖</i>';
    const rows = Object.entries(r.heroes).map(([id, h]: [string, any]) =>
      `<tr><td>${id}</td><td>${h.rig}</td><td>${ok(!h.missing.length)} ${h.states.length}/${ANIM_STATES.length}${h.missing.length ? ` <small>-${h.missing.join(',')}</small>` : ''}</td><td>${ok(h.footSlide < 0.25)} ${(h.footSlide * 100).toFixed(0)}%</td><td>${ok(h.penetrationFrames / Math.max(1, h.frames) < 0.02)} ${h.penetrationFrames}</td></tr>`).join('');
    this.panel.innerHTML = `<h4>AI TEST LAB ${r.pass ? '<i class="ok">PASSING</i>' : '<i class="bad">ISSUES</i>'}</h4>
      <div>Abilities ${ok(!r.abilities.missing.length)} ${r.abilities.cast}/${r.abilities.of} · Counters ${ok(r.counters.seen >= 8)} ${r.counters.seen}/${r.counters.of} · FX kinds ${r.effects.kinds} · SFX ${r.sounds.ids} (${r.sounds.audio}) · ${r.perf.avgFps} fps</div>
      <table><tr><th>hero</th><th>rig</th><th>anim states</th><th>foot slide</th><th>wall pen.</th></tr>${rows}</table>
      <div class="maps">${Object.entries(r.maps).map(([m, s]) => `${m}: ${s.winner ?? '-'} · ${s.kills}K · ${s.falls} falls · ${s.stuck} unstick`).join('<br>')}</div>
      ${r.fails.length ? `<div class="bad">${r.fails.slice(0, 6).join('<br>')}</div>` : ''}`;
  }
}
