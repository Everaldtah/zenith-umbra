// The in-browser game: owns the renderer, runs the fixed-step World, drives views, camera, FX, audio and HUD.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { PLAY_MAPS } from '../data/maps';
import { HEROES, HERO } from '../data/heroes';
import { createMatch, type Match } from '../game/setup';
import type { Mode } from '../game/World';
import type { Actor } from '../game/Actor';
import { MapScene } from '../render/MapScene';
import { CharacterView } from '../render/CharacterView';
import { Fx } from '../render/Fx';
import { loadManifest } from '../render/Assets';
import { sfx } from '../audio/Sfx';
import { Input, KEYS } from './Input';
import { Hud } from './Hud';
import { AiLab } from './AiLab';
import { PRESETS, type Settings } from './Settings';

const DT = 1 / 60;

export interface StartOpts { mode: Mode; map: string; hero: string | null; }

export class Game {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer | null = null;
  bloom: UnrealBloomPass | null = null;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(90, 1, 0.08, 1200);
  input: Input;
  hud: Hud;
  match: Match | null = null;
  mapScene: MapScene | null = null;
  fx: Fx | null = null;
  views = new Map<number, CharacterView>();
  lab: AiLab | null = null;
  opts: StartOpts | null = null;
  running = false;
  paused = false;
  acc = 0;
  last = performance.now();
  fpsAvg = 60;
  camYaw = 0; camPitch = 0;
  specIdx = 0; specNextSwitch = 0; freeCam = false;
  camPos = new THREE.Vector3();
  timeScale = 1;
  labMapIdx = 0;
  onExit: (() => void) | null = null;
  onPause: ((p: boolean) => void) | null = null;
  onEnd: (() => void) | null = null;

  constructor(public host: HTMLElement, public settings: Settings) {
    const q = PRESETS[settings.preset];
    this.renderer = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = q.shadows > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.append(this.renderer.domElement);
    this.renderer.domElement.className = 'game-canvas';
    this.input = new Input(this.renderer.domElement);
    this.hud = new Hud(host);
    this.hud.show(false);
    this.hud.onUltReady = () => sfx.play('ult_ready');
    this.applySettings(settings);
    addEventListener('resize', () => this.resize());
    this.renderer.domElement.addEventListener('click', () => { sfx.unlock(); if (this.running && !this.paused && this.match?.player) this.input.lock(); });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.running && this.match?.player && !this.match.world.winner) this.setPaused(true);
    });
    (window as any).__zu = { ...(window as any).__zu, game: this };
    requestAnimationFrame(t => this.loop(t));
  }

  applySettings(s: Settings) {
    this.settings = s;
    const q = PRESETS[s.preset];
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * q.pixelRatio);
    this.renderer.shadowMap.enabled = q.shadows > 0;
    this.input.sens = 0.0022 * s.sens;
    sfx.setVolume(s.volume);
    this.camera.fov = s.fov * 0.75;       // horizontal-ish FOV feel for 16:9
    this.composer = null;
    if (q.bloom) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.5, 0.82);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.resize();
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer?.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  async start(o: StartOpts) {
    this.stop();
    await loadManifest();
    this.opts = o;
    const q = PRESETS[this.settings.preset];
    this.scene = new THREE.Scene();
    if (this.composer) (this.composer.passes[0] as RenderPass).scene = this.scene;
    this.match = createMatch(o.map, o.mode, o.hero, this.settings.difficulty);
    const w = this.match.world;
    this.mapScene = new MapScene(w.map, w.level, q, this.scene);
    this.fx = new Fx(this.scene, q.fxCap);
    const viewerTeam = this.match.player?.team ?? 'zenith';
    for (const a of w.actors) this.addView(a, viewerTeam);
    this.hud.reset();
    this.hud.show(true);
    if (o.mode === 'aitest') { this.lab ??= new AiLab(this.host); this.lab.panel.style.display = ''; this.timeScale = 1; }
    else if (this.lab) this.lab.panel.style.display = 'none';
    this.running = true; this.paused = false; this.acc = 0;
    if (this.match.player) { this.camYaw = this.match.player.yaw; this.camPitch = 0; this.input.yaw = this.camYaw; this.input.pitch = 0; }
    sfx.unlock();
    sfx.music(o.mode === 'training' ? 'zenith' : 'battle');
    if (this.match.player) this.input.lock();
  }

  private addView(a: Actor, viewerTeam: string) {
    const v = new CharacterView(a, viewerTeam);
    v.onStep = (act, _side, heavy) => {
      if (!this.match) return;
      sfx.play(heavy ? 'mechstep' : 'step', act.pos, heavy ? 1 : 0.6);
      if (heavy) { this.fx?.onEvent({ t: 'fx', kind: 'step', pos: { ...act.pos } }, this.match.world.time, this.camPos); this.fx!.shake = Math.max(this.fx!.shake, 0.08 / (1 + this.camPos.distanceTo(new THREE.Vector3(act.pos.x, act.pos.y, act.pos.z)) / 8)); }
    };
    this.views.set(a.id, v);
    this.scene.add(v.group);
  }

  stop() {
    this.running = false;
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry) m.geometry.dispose(); });
    this.match = null; this.mapScene = null; this.fx = null;
    this.hud.show(false);
    sfx.music(null);
    this.input.unlock();
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (p) this.input.unlock(); else if (this.match?.player) this.input.lock();
    this.onPause?.(p);
  }

  swapHero(id: string) {
    const m = this.match; if (!m?.player || m.world.mode !== 'training') return;
    const old = m.player;
    const w = m.world;
    const a = w.addHero(id, 'zenith');
    a.isPlayer = true; a.pos = { ...old.pos }; a.yaw = old.yaw;
    w.actors = w.actors.filter(x => x !== old);
    const v = this.views.get(old.id); if (v) { this.scene.remove(v.group); v.dispose(); this.views.delete(old.id); }
    this.addView(a, 'zenith');
    m.player = a;
  }

  // ------------------------------------------------------------------ frame
  private loop(tms: number) {
    requestAnimationFrame(t => this.loop(t));
    const q = PRESETS[this.settings.preset];
    let dt = Math.min(0.1, (tms - this.last) / 1000);
    if (dt < 1 / q.maxFps - 0.002) return;
    this.last = tms;
    if (dt > 0) this.fpsAvg += (1 / dt - this.fpsAvg) * 0.05;
    const m = this.match;
    if (!this.running || !m || !this.mapScene || !this.fx) { this.input.endFrame(); return; }
    const w = m.world;
    const me = m.player;
    // ---- input
    if (this.input.once('Escape') && me && !this.paused) this.setPaused(true);
    if (this.input.once(KEYS.view)) { this.settings.view = this.settings.view === 'third' ? 'first' : 'third'; }
    if (w.mode === 'training' && me && !this.paused && this.input.once(KEYS.swap)) { this.paused = true; this.input.unlock(); (window as any).__zu.openSwap?.(); }
    if (!me) this.spectatorKeys();
    // ---- simulate
    if (!this.paused) {
      if (me) {
        this.camYaw = this.input.yaw; this.camPitch = this.input.pitch;
        const aim = this.solveAim(me);
        this.input.apply(me, aim.yaw, aim.pitch);
        if (!this.input.locked) { me.input.fire = false; me.input.alt = false; }
      }
      this.acc += dt * this.timeScale;
      let steps = 0;
      while (this.acc >= DT && steps < 8 * Math.max(1, this.timeScale)) {
        w.step(DT); this.acc -= DT; steps++;
        this.dispatch();
      }
      if (steps >= 8) this.acc = 0;
    }
    // ---- views
    const viewer = { team: me?.team ?? 'zenith', sees: (a: Actor) => !me || w.perceivable(me, a) };
    for (const a of w.actors) {
      if (!this.views.has(a.id)) this.addView(a, viewer.team);
      const v = this.views.get(a.id)!;
      v.update(dt * (this.paused ? 0 : this.timeScale), w.time, viewer);
      if (a === me && this.settings.view === 'first') v.group.visible = false;
    }
    this.fx.update(dt * (this.paused ? 0 : this.timeScale), w, w.time);
    this.mapScene.update(w.time, w.point, viewer.team);
    this.updateCamera(dt, me);
    sfx.setListener(this.camera.position, this.camera.getWorldDirection(new THREE.Vector3()));
    // ---- render
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    this.hud.update(w, me, this.camera, w.time, this.settings.showFps ? this.fpsAvg : 0, this.input.keys.has(KEYS.score), this.spectateLabel());
    if (this.lab && w.mode === 'aitest') {
      this.lab.frame(w, this.views, this.fx, dt * this.timeScale, this.renderer);
      if (Math.round(w.time * 60) % 30 === 0) this.lab.render();
    }
    // ---- match end
    if (w.winner && !(w as any).__ended) {
      (w as any).__ended = true;
      if (w.mode === 'aitest') {
        this.lab!.endMap(w, m.bots);
        setTimeout(() => this.nextLabMap(), 2500);
      } else setTimeout(() => { this.input.unlock(); this.onEnd?.(); }, 3500);
    }
    if (w.mode === 'aitest' && w.time > 240 && !w.winner) w.end(w.point.progress.zenith >= w.point.progress.umbra ? 'zenith' : 'umbra');
    this.input.endFrame();
  }

  nextLabMap() {
    this.labMapIdx++;
    if (this.labMapIdx >= PLAY_MAPS.length) { this.lab?.render(); (window as any).__zu.labDone = true; this.labMapIdx = 0; }
    this.start({ mode: 'aitest', map: PLAY_MAPS[this.labMapIdx].id, hero: null });
  }

  private dispatch() {
    const m = this.match!, w = m.world, me = m.player;
    const ev = w.events; w.events = [];
    for (const e of ev) {
      this.lab?.onEvent(e);
      if (e.t === 'fx') this.fx!.onEvent(e, w.time, this.camPos);
      else if (e.t === 'sfx') {
        // own weapon sounds play un-positioned (in your head), everything else in 3D
        const own = me && e.actor === me;
        sfx.play(e.id, own ? undefined : e.pos, own ? 0.8 : 1);
      } else {
        this.hud.event(e, me, w.time);
        if (e.t === 'counter') sfx.play('counter');
        if (e.t === 'kill' && me && e.src === me) sfx.play('kill');
        if (e.t === 'cast' && e.id === e.actor.def.ult.id && me && e.actor.team === me.team) void 0;
      }
    }
  }

  /** third person: find what the crosshair covers and aim the hero's eye at it (so shots land on the reticle) */
  private solveAim(me: Actor) {
    if (this.settings.view === 'first') return { yaw: this.camYaw, pitch: this.camPitch };
    const w = this.match!.world;
    const cp = this.cameraPose(me, this.camYaw, this.camPitch);
    const d = { x: Math.sin(this.camYaw) * Math.cos(this.camPitch), y: Math.sin(this.camPitch), z: Math.cos(this.camYaw) * Math.cos(this.camPitch) };
    const o = { x: cp.x, y: cp.y, z: cp.z };
    const lh = w.level.ray(o, d, 200);
    let t = lh ? lh.t : 200;
    const ah = w.rayActors(o, d, t, x => x !== me);
    if (ah) t = ah.t;
    t = Math.max(t, 4);
    const tgt = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
    const e = me.eye;
    return { yaw: Math.atan2(tgt.x - e.x, tgt.z - e.z), pitch: Math.atan2(tgt.y - e.y, Math.hypot(tgt.x - e.x, tgt.z - e.z)) };
  }

  private cameraPose(a: Actor, yaw: number, pitch: number): THREE.Vector3 {
    const mech = a.def.frame === 'mech';
    const zoom = a.sv.zoom ? 0.55 : 1;
    const back = (mech ? 6.8 : 3.3) * a.scale * zoom, right = (mech ? 1.5 : 0.7) * zoom, up = mech ? 0.6 : 0.3;
    const e = a.eye;
    const cp = Math.cos(pitch);
    const f = new THREE.Vector3(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
    const r = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const want = new THREE.Vector3(e.x, e.y + up, e.z).addScaledVector(r, right).addScaledVector(f, -back);
    // pull in against walls
    const o = { x: e.x, y: e.y + up, z: e.z };
    const dv = want.clone().sub(new THREE.Vector3(o.x, o.y, o.z)); const len = dv.length(); dv.normalize();
    const h = this.match!.world.level.ray(o, { x: dv.x, y: dv.y, z: dv.z }, len + 0.3);
    if (h) want.set(o.x, o.y, o.z).addScaledVector(dv, Math.max(0.3, h.t - 0.3));
    return want;
  }

  private updateCamera(dt: number, me: Actor | null) {
    const cam = this.camera;
    const shake = this.fx?.shake ?? 0;
    const zoomFov = me?.sv.zoom ? 38 : this.settings.fov * 0.75;
    cam.fov += (zoomFov - cam.fov) * Math.min(1, dt * 12); cam.updateProjectionMatrix();
    if (me) {
      if (this.settings.view === 'first' || !me.alive && false) {
        const e = me.eye; cam.position.set(e.x, e.y, e.z);
      } else cam.position.copy(this.cameraPose(me, this.camYaw, this.camPitch));
      if (!me.alive) {
        // death cam: rise and look at the body
        const k = Math.min(1, (this.match!.world.time - me.deathAt) / 1.2);
        cam.position.y += k * 3;
      }
      const f = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
      cam.lookAt(cam.position.clone().add(f));
    } else this.spectatorCamera(dt);
    if (shake > 0.002) { cam.position.x += (Math.random() - 0.5) * shake; cam.position.y += (Math.random() - 0.5) * shake; cam.rotation.z += (Math.random() - 0.5) * shake * 0.05; }
    this.camPos.copy(cam.position);
  }

  // ------------------------------------------------------------------ spectator / AI lab director
  private spectatorKeys() {
    const k = this.input;
    for (let i = 0; i < 10; i++) if (k.once(`Digit${(i + 1) % 10}`)) { this.specIdx = i; this.specNextSwitch = Infinity; this.freeCam = false; }
    if (k.once('KeyF')) this.freeCam = !this.freeCam;
    if (k.once('BracketRight')) this.timeScale = Math.min(8, this.timeScale * 2);
    if (k.once('BracketLeft')) this.timeScale = Math.max(0.25, this.timeScale / 2);
    if (k.once('KeyN') && this.match?.world.mode === 'aitest') { this.match.world.end('zenith'); }
    if (k.once('Escape')) this.onExit?.();
  }
  private spectateTarget(): Actor | null {
    const w = this.match!.world;
    const heroes = w.actors.filter(a => !a.isRobot);
    if (w.time > this.specNextSwitch || !heroes[this.specIdx]?.alive) {
      // director: cut to whoever is in the thick of it
      const busy = heroes.filter(a => a.alive).sort((p, q) => (w.time - q.lastDamagedAt < 2 ? 1 : 0) + q.anim.castAt - ((w.time - p.lastDamagedAt < 2 ? 1 : 0) + p.anim.castAt))[0];
      if (busy) this.specIdx = heroes.indexOf(busy);
      if (this.specNextSwitch !== Infinity || !heroes[this.specIdx]?.alive) this.specNextSwitch = w.time + 7;
    }
    return heroes[this.specIdx] ?? null;
  }
  private spectateLabel() {
    if (this.match?.player) return '';
    const a = this.match ? this.spectateTarget() : null;
    return a ? `SPECTATING ${a.def.name.toUpperCase()} · 1-0 pick hero · F free cam · [ ] speed ${this.timeScale}x${this.match?.world.mode === 'aitest' ? ' · N next map' : ''} · Esc exit` : '';
  }
  private spectatorCamera(dt: number) {
    const cam = this.camera;
    if (this.freeCam) {
      const k = this.input.keys, sp = 18 * dt;
      this.camYaw = this.input.yaw; this.camPitch = this.input.pitch;
      const f = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
      const r = new THREE.Vector3(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
      if (k.has('KeyW')) cam.position.addScaledVector(f, sp); if (k.has('KeyS')) cam.position.addScaledVector(f, -sp);
      if (k.has('KeyD')) cam.position.addScaledVector(r, sp); if (k.has('KeyA')) cam.position.addScaledVector(r, -sp);
      cam.lookAt(cam.position.clone().add(f));
      if (!this.input.locked) this.input.lock();
      return;
    }
    const a = this.spectateTarget();
    if (!a) return;
    const yaw = a.yaw, back = a.def.frame === 'mech' ? 8 : 5;
    const want = new THREE.Vector3(a.pos.x - Math.sin(yaw) * back - Math.cos(yaw) * 1.2, a.pos.y + a.height + 1.6, a.pos.z - Math.cos(yaw) * back + Math.sin(yaw) * 1.2);
    const o = { x: a.pos.x, y: a.pos.y + a.height, z: a.pos.z };
    const dv = want.clone().sub(new THREE.Vector3(o.x, o.y, o.z)); const len = dv.length(); dv.normalize();
    const h = this.match!.world.level.ray(o, { x: dv.x, y: dv.y, z: dv.z }, len);
    if (h) want.set(o.x, o.y, o.z).addScaledVector(dv, Math.max(0.5, h.t - 0.4));
    cam.position.lerp(want, Math.min(1, dt * 4));
    const look = new THREE.Vector3(a.pos.x + Math.sin(yaw) * 4, a.pos.y + a.height * 0.7, a.pos.z + Math.cos(yaw) * 4);
    cam.lookAt(look);
  }
}

export const ALL_HEROES = HEROES;
export { HERO };
