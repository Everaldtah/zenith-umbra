// The in-browser game: owns the renderer, runs the fixed-step World, drives views, camera, FX, audio and HUD.
import * as THREE from 'three';
import { FULL } from '../edition';
import { Soundscape } from './Soundscape';
import { voice } from '../audio/Voice';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PLAY_MAPS } from '../data/maps';
import { HEROES, HERO } from '../data/heroes';
import { createMatch, createCampaign, type Match } from '../game/setup';
import { bossCard } from '../campaign/Cinematic';
import type { Director } from '../campaign/Director';
import { ENEMIES, BOSSES, LEVEL } from '../campaign/data';
import type { Coop } from '../net/Coop';
import { HostSync, ClientSync } from '../net/NetSync';
import { World as WorldCls } from '../game/World';
import { Nav } from '../ai/Nav';
import type { Mode, GameEvent } from '../game/World';
import type { Actor } from '../game/Actor';
import { MapScene } from '../render/MapScene';
import { CharacterView } from '../render/CharacterView';
import { FirstPersonArms } from '../render/FirstPerson';
import { Armory } from './Armory';
import { equippedSkin } from '../data/skins';
import { Fx } from '../render/Fx';
import { loadManifest } from '../render/Assets';
import { animLibrary } from '../render/ClipLibrary';
import { sfx } from '../audio/Sfx';
import { Input, KEYS } from './Input';
import { Hud } from './Hud';
import { AiLab } from './AiLab';
import { PRESETS, IS_DESKTOP, quality, type Settings } from './Settings';
import { UI_COLORS } from '../render/CharacterView';

/** Image Sharpening (Settings > Video): a light unsharp mask after tone mapping */
const SHARPEN = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0 }, texel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; uniform vec2 texel; varying vec2 vUv;
    void main(){ vec4 c=texture2D(tDiffuse,vUv);
      vec3 n=texture2D(tDiffuse,vUv+vec2(texel.x,0.)).rgb+texture2D(tDiffuse,vUv-vec2(texel.x,0.)).rgb+texture2D(tDiffuse,vUv+vec2(0.,texel.y)).rgb+texture2D(tDiffuse,vUv-vec2(0.,texel.y)).rgb;
      gl_FragColor=vec4(clamp(c.rgb+(c.rgb*4.0-n)*amount,0.0,1.0),c.a); }`,
};

/** colour-blind correction filters (Settings > Accessibility): daltonisation matrices mixed with identity by strength */
const CB: Record<string, number[]> = {
  protanopia: [0.567, 0.433, 0, 0.558, 0.442, 0, 0, 0.242, 0.758],
  deuteranopia: [0.625, 0.375, 0, 0.7, 0.3, 0, 0, 0.3, 0.7],
  tritanopia: [0.95, 0.05, 0, 0, 0.433, 0.567, 0, 0.475, 0.525],
};
function colorBlindFilter(kind: string, strength: number): string {
  if (kind === 'none' || !CB[kind] || typeof document === 'undefined') return '';
  let svg = document.getElementById('zu-cb') as SVGSVGElement | null;
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.id = 'zu-cb';
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute';
    svg.innerHTML = '<filter id="zu-cb-f" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix"/></filter>';
    document.body.append(svg);
  }
  const m = CB[kind], k = Math.max(0, Math.min(1, strength)), I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  // the simulated deficiency's error, shifted into channels the viewer can see (Fidaner daltonisation), by strength
  const mix = m.map((v, i) => I[i] + (I[i] - v) * k * 0.7);
  const row = (r: number) => `${mix[r * 3].toFixed(3)} ${mix[r * 3 + 1].toFixed(3)} ${mix[r * 3 + 2].toFixed(3)} 0 0`;
  svg.querySelector('feColorMatrix')!.setAttribute('values', `${row(0)} ${row(1)} ${row(2)} 0 0 0 1 0`);
  return 'url(#zu-cb-f)';
}

// physics rate: the desktop build simulates at 120 Hz (finer collisions, snappier input); the web build at 60 Hz
const DT = 1 / (IS_DESKTOP ? 120 : 60);

export interface StartOpts { mode: Mode; map: string; hero: string | null; squad?: { hero: string; netId: string }[]; net?: { coop: Coop; role: 'host' | 'client' }; skill?: number; }

/** modes whose camera is fixed (Overwatch 2 style): Normal matches in first person, Stadium in third person */
const FIXED_VIEW: Partial<Record<string, 'first' | 'third'>> = { skirmish: 'first', stadium: 'third', quickplay: 'first', competitive: 'first', practice: 'first' };

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
  /** first-person arms (viewmodel), drawn in their own pass over the world */
  fp: FirstPersonArms | null = null;
  private fpAim = { yaw: 0, pitch: 0 };
  lab: AiLab | null = null;
  opts: StartOpts | null = null;
  running = false;
  paused = false;
  acc = 0;
  last = performance.now();
  fpsAvg = 60;
  camYaw = 0; camPitch = 0;
  /** first person, Overwatch-style: some abilities pull the camera out to third person while they last (Reinhardt's
   *  Barrier Field / Charge -> Tenkai-Oh's Solar Bulwark / Dawn Charge). 0 = eyes, 1 = over the shoulder */
  abilityCam = 0;
  /** barrier free look: the shield's facing, held while the camera pans (hold primary fire with the shield up) */
  private freeLook: { yaw: number; pitch: number } | null = null;
  /** abilities that play in third person (as in Overwatch) */
  static readonly THIRD_PERSON: Record<string, (a: Actor) => boolean> = {
    tenkai: a => a.barrier.up || a.forced?.kind === 'dawncharge',
  };
  specIdx = 0; specNextSwitch = 0; freeCam = false;
  camPos = new THREE.Vector3();
  timeScale = 1;
  labMapIdx = 0;
  galleryAngle = 0;
  framesRendered = 0;
  envTex: THREE.Texture | null = null;
  bossCam: { actor: Actor; until: number; t0: number } | null = null;
  /** dynamic render scale: the fraction of the chosen render scale being drawn right now */
  dynScale = 1;
  private dynAt = 0;
  hostSync: HostSync | null = null;
  clientSync: ClientSync | null = null;
  onCampaignEnd: ((won: boolean) => void) | null = null;
  get director(): Director | null { return (this.match?.world.director as Director) ?? null; }
  onExit: (() => void) | null = null;
  onPause: ((p: boolean) => void) | null = null;
  onEnd: (() => void) | null = null;

  constructor(public host: HTMLElement, public settings: Settings) {
    const q = PRESETS[settings.preset];
    this.renderer = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Khronos PBR Neutral: keeps painted base colours true and saturated (ACES desaturates and hue-shifts the
    // highlights) - the punchy, clean hero-shooter palette
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = q.shadows > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.append(this.renderer.domElement);
    this.renderer.domElement.className = 'game-canvas';
    this.input = new Input(this.renderer.domElement);
    this.input.settings = settings;
    this.hud = new Hud(host);
    this.hud.show(false);
    voice.onLine = (n, c, text, cat, secs) => this.hud.subtitle(n, c, text, cat, secs);
    this.hud.onUltReady = () => { sfx.play('ult_ready'); if (FULL && this.match?.player) voice.say(this.match.player, 'ult_ready', 'chatter'); };
    this.applySettings(settings);
    addEventListener('resize', () => this.resize());
    this.renderer.domElement.addEventListener('click', () => { sfx.unlock(); if (this.running && !this.paused && this.match?.player) this.input.lock(); });
    document.addEventListener('pointerlockchange', () => {
      // losing the mouse pauses the match - except in the Stadium Armory, which frees the cursor on purpose
      if (!document.pointerLockElement && this.running && this.match?.player && !this.match.world.winner && !this.armory?.open) this.setPaused(true);
    });
    (window as any).__zu = { ...(window as any).__zu, game: this, sfx, voice };
    requestAnimationFrame(t => this.loop(t));
  }

  applySettings(s: Settings) {
    this.settings = s;
    this.input.settings = s;
    const Q = quality(s), v = s.video, o = s.sound, A = s.access;
    if (!v.dynamicRes) this.dynScale = 1;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * Q.pixelRatio * this.dynScale);
    this.renderer.shadowMap.enabled = Q.shadows > 0;
    const st = Q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.renderer.shadowMap.type !== st) { this.renderer.shadowMap.type = st; this.renderer.shadowMap.needsUpdate = true; }
    this.renderer.toneMappingExposure = 0.95 * v.gamma;
    this.input.sens = 0.0022 * s.sens;
    // sound: master, the category buses, the mix preset, background audio
    sfx.setVolume(o.master);
    Object.assign(sfx.mix, { sfx: o.sfx, voice: o.voice, announcer: o.announcer, ambience: o.ambience, ui: o.ui, hitmarker: o.hitmarker, music: o.music, preset: o.mix, background: o.background });
    sfx.latencyHint = o.latency;
    sfx.applyMix();
    this.camera.fov = s.fov * 0.75;       // horizontal-ish FOV feel for 16:9
    this.buildComposer();
    // brightness / contrast / colour-blind correction on the final picture
    const cb = colorBlindFilter(A.colorblind, A.cbStrength);
    this.renderer.domElement.style.filter = [v.brightness !== 1 ? `brightness(${v.brightness.toFixed(2)})` : '', v.contrast !== 1 ? `contrast(${v.contrast.toFixed(2)})` : '', cb].filter(Boolean).join(' ');
    // team UI colours: health bars, outlines
    UI_COLORS.ally = A.allyColor; UI_COLORS.enemy = A.enemyColor;
    document.documentElement.style.setProperty('--ally', A.allyColor); document.documentElement.style.setProperty('--enemy', A.enemyColor);
    for (const vw of this.views.values()) vw.rimColor.set(this.match?.player && vw.actor.team !== this.match.player.team ? A.enemyColor : A.allyColor);
    this.hud.applySettings(s);
    document.body.classList.toggle('nohints', !s.gameplay.hints);      // Gameplay > Show Hints: lobby / loading tips
    if (!this.running && FULL) sfx.music(s.sound.menuMusic ? 'menu' : null);
    this.applySceneDetail();
    this.displayMode(v.displayMode);
    this.resize();
  }

  /** the post chain the options ask for: ambient occlusion, bloom (glow quality), tone mapping, FXAA, sharpening */
  private buildComposer() {
    const s = this.settings, Q = quality(s), v = s.video;
    const ao = v.ao !== 'off', sharp = v.sharpen > 0;
    this.composer = null; this.bloom = null;
    if (!Q.bloom && !Q.fxaa && !ao && !sharp) return;
    const c = new EffectComposer(this.renderer);
    c.addPass(new RenderPass(this.scene, this.camera));
    if (ao) {
      const g = new GTAOPass(this.scene, this.camera, innerWidth, innerHeight);
      g.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1, thickness: 1, scale: 1, samples: { off: 8, low: 8, medium: 12, high: 16 }[v.ao] });
      g.blendIntensity = { off: 0, low: 0.6, medium: 0.8, high: 1 }[v.ao];
      c.addPass(g);
    }
    if (Q.bloom) {
      const k = { low: 0.5, medium: 0.75, high: 1 }[v.refraction];
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth * k, innerHeight * k), 0.55, 0.5, 0.82);
      c.addPass(this.bloom);
    }
    c.addPass(new OutputPass());
    if (Q.fxaa) c.addPass(new FXAAPass());
    if (sharp) { const p = new ShaderPass(SHARPEN); p.uniforms.amount.value = v.sharpen / 100 * 0.6; c.addPass(p); }
    this.composer = c;
    if (this.bloom && this.match) { const day = FULL && this.match.world.map.sun.intensity >= 2.1; this.bloom.threshold = day ? 0.97 : 0.82; this.bloom.strength = day ? 0.38 : 0.55; }
  }

  /** detail options that live in the scene: reflections, fog distance, texture filtering, effects density, waypoint */
  applySceneDetail() {
    const s = this.settings, Q = quality(s), v = s.video, A = s.access;
    this.scene.environmentIntensity = Q.envIntensity * (v.localReflections ? 1 : 0.8);
    const fog = this.scene.fog as (THREE.Fog & { __base?: [number, number] }) | null;
    if (fog && 'near' in fog) {
      fog.__base ??= [fog.near, fog.far];
      const k = { low: 1.4, medium: 1.15, high: 1 }[v.fog];
      fog.near = fog.__base[0] * k; fog.far = fog.__base[1] * k;
    }
    const aniso = Math.min(this.renderer.capabilities.getMaxAnisotropy(), v.texFilter);
    this.scene.traverse(ob => {
      const m = (ob as THREE.Mesh).material;
      for (const mt of Array.isArray(m) ? m : m ? [m] : []) {
        const t = (mt as THREE.MeshStandardMaterial).map;
        if (t && t.anisotropy !== aniso) { t.anisotropy = aniso; t.needsUpdate = true; }
      }
    });
    if (this.fx) { this.fx.lodScale = Q.particles; this.fx.damageScale = { low: 0.5, default: 1, high: 1.4 }[v.damageFx]; this.fx.flashScale = A.flashReduction ? 0.3 : 1; }
    const beam = this.mapScene?.group.getObjectByName('pointBeam') as THREE.Mesh | undefined;
    if (beam) { (beam.material as THREE.MeshBasicMaterial).opacity = 0.12 * s.gameplay.waypointOpacity; beam.visible = s.gameplay.waypointOpacity > 0.01; }
  }

  private displayMode(m: Settings['video']['displayMode']) {
    try {
      const full = !!document.fullscreenElement;
      if (m !== 'windowed' && !full) document.documentElement.requestFullscreen?.().catch(() => { /* needs a user gesture */ });
      else if (m === 'windowed' && full) document.exitFullscreen?.().catch(() => { /* ignore */ });
    } catch { /* not allowed here */ }
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer?.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  async start(o: StartOpts) {
    this.stop();
    // hero GLB manifest + the animation clip library (public/anim; missing = fully procedural) before any view exists
    await Promise.all([loadManifest(), animLibrary()]);
    this.opts = o;
    const q = PRESETS[this.settings.preset];
    this.scene = new THREE.Scene();
    if (this.composer) (this.composer.passes[0] as RenderPass).scene = this.scene;
    this.hostSync = null; this.clientSync = null;
    if (o.net?.role === 'client') {
      // co-op client: an empty mirror world, filled from the host's snapshots
      const w = new WorldCls(LEVEL[o.map].map, 'campaign');
      Object.assign(w.extraDefs, ENEMIES, BOSSES);
      this.match = { world: w, nav: new Nav(w.level), player: null, bots: [] };
      this.clientSync = new ClientSync(w, o.net.coop, e => this.handleEvent(e), LEVEL[o.map]);
    } else {
      this.match = o.mode === 'campaign'
        ? createCampaign(o.map, o.squad ?? [{ hero: o.hero ?? 'tenkai', netId: 'local' }], this.settings.difficulty)
        : createMatch(o.map, o.mode, o.hero, o.skill ?? this.settings.difficulty);
      if (o.net?.role === 'host') this.hostSync = new HostSync(this.match.world, o.net.coop);
    }
    this.bossCam = null;
    const w = this.match.world;
    this.mapScene = new MapScene(w.map, w.level, q, this.scene);
    // bright daylight maps (pale plaster, white stone): only real highlights bloom, or sunlit walls glow white
    if (this.bloom) { const day = FULL && w.map.sun.intensity >= 2.1; this.bloom.threshold = day ? 0.97 : 0.82; this.bloom.strength = day ? 0.38 : 0.55; }
    // image-based lighting so metallic / dark generated materials still catch light
    this.envTex ??= new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.55;
    this.fx = new Fx(this.scene, quality(this.settings).fxCap);
    // scene detail options now, and again once the heroes' models have streamed in (texture filtering)
    this.buildComposer(); this.applySceneDetail();
    for (const ms of [3000, 9000]) setTimeout(() => { if (this.running) this.applySceneDetail(); }, ms);
    // first person: your rounds leave the viewmodel's gun(s) - right hand, or alternating hands for twin guns
    let hand = 1;
    this.fx.muzzleFor = (a, from) => {
      if (!this.match || a !== this.match.player || this.view !== 'first') return from;
      const c = this.camera, f = c.getWorldDirection(new THREE.Vector3()), r = new THREE.Vector3().crossVectors(f, c.up).normalize(), u = new THREE.Vector3().crossVectors(r, f);
      if (a.def.dualGuns) hand = -hand;
      const side = a.def.dualGuns ? hand * 0.42 : 0.24;
      const p = c.position.clone().addScaledVector(f, 1.45).addScaledVector(r, side * 1.15).addScaledVector(u, -0.3);
      return { x: p.x, y: p.y, z: p.z };
    };
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
    if (FULL) this.sound.start(w, this.match.player);
    if (this.match.player) this.input.lock();
  }
  /** desktop edition: the match's soundscape (space, threat mix, loops, physics sounds, voice lines) */
  sound = new Soundscape();

  /** the camera for this match: fixed by the mode (Normal = first person, Stadium = third person), else the setting */
  get view(): 'first' | 'third' { const m = this.match?.world.mode; return (m && FIXED_VIEW[m]) || this.settings.view; }

  armory: Armory | null = null;
  /** Stadium: open the Armory between rounds (cursor free), close and re-grab the mouse when the round starts */
  private updateArmory(w: WorldCls, me: Actor | null) {
    const S = w.stadium;
    if (!S || !me || this.paused) { if (this.armory?.open) this.armory.hide(); return; }
    this.armory ??= new Armory(this.host);
    this.armory.onClose = () => { if (this.running && !this.paused) this.input.lock(); };
    const want = S.phase === 'armory' && !S.ready.has(me.id);
    if (want && !this.armory.open) { this.input.unlock(); this.armory.show(w, me); }
    if (!want && this.armory.open) { this.armory.hide(); this.input.lock(); }
    // shopping needs the cursor: a locked pointer would send every click to the canvas
    if (this.armory.open && this.input.locked) this.input.unlock();
    this.armory.update();
  }

  private addView(a: Actor, viewerTeam: string) {
    const v = new CharacterView(a, viewerTeam, a.isPlayer ? equippedSkin(a.def.id) : 'classic');
    v.onStep = (act, _side, heavy) => {
      if (!this.match) return;
      if (FULL) this.sound.step(act, heavy); else sfx.play(heavy ? 'mechstep' : 'step', act.pos, heavy ? 1 : 0.6);
      if (heavy) { this.fx?.onEvent({ t: 'fx', kind: 'step', pos: { ...act.pos } }, this.match.world.time, this.camPos); this.fx!.shake = Math.max(this.fx!.shake, 0.08 / (1 + this.camPos.distanceTo(new THREE.Vector3(act.pos.x, act.pos.y, act.pos.z)) / 8)); }
    };
    this.views.set(a.id, v);
    this.scene.add(v.group);
  }

  stop() {
    this.running = false;
    if (FULL) this.sound.stop();
    this.armory?.hide();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.fp?.dispose(); this.fp = null;
    this.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry) m.geometry.dispose(); });
    this.match = null; this.mapScene = null; this.fx = null;
    this.hud.show(false);
    sfx.music(null);
    this.input.unlock();
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (p) this.input.unlock(); else if (this.match?.player && !this.armory?.open) this.input.lock();
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
    const Q = quality(this.settings), v = this.settings.video;
    let dt = Math.min(0.1, (tms - this.last) / 1000);
    if (dt < 1 / Q.maxFps - 0.002) return;
    this.last = tms;
    if (dt > 0) this.fpsAvg += (1 / dt - this.fpsAvg) * 0.05;
    // dynamic render scale: hold the frame-rate target (the cap, or 60) by trading resolution, a step at a time
    if (v.dynamicRes && this.running && tms - this.dynAt > 500) {
      this.dynAt = tms;
      const target = v.fpsCap || 60, prev = this.dynScale;
      if (this.fpsAvg < target * 0.92) this.dynScale = Math.max(0.5, this.dynScale - 0.05);
      else if (this.fpsAvg > target * 1.08) this.dynScale = Math.min(1, this.dynScale + 0.03);
      if (this.dynScale !== prev) { this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * Q.pixelRatio * this.dynScale); this.resize(); }
    }
    const m = this.match;
    if (!this.running || !m || !this.mapScene || !this.fx) { this.input.endFrame(); return; }
    const w = m.world;
    if (this.clientSync) m.player = this.clientSync.me;
    const me = m.player;
    const online = !!(this.clientSync || this.hostSync);
    // ---- input
    if (this.input.once('Escape') && me && !this.paused) this.setPaused(true);
    // Normal matches are first person and Stadium third person (as in Overwatch 2); elsewhere V toggles
    if (this.input.pressed('view') && !FIXED_VIEW[w.mode]) { this.settings.view = this.settings.view === 'third' ? 'first' : 'third'; }
    if (this.input.pressed('perf')) { const o = ['off', 'simple', 'advanced'] as const; this.settings.video.perfStats = o[(o.indexOf(this.settings.video.perfStats) + 1) % 3]; }
    this.updateArmory(w, me);
    if (w.mode === 'training' && me && !this.paused && this.input.pressed('swap')) { this.paused = true; this.input.unlock(); (window as any).__zu.openSwap?.(); }
    if (!me && !online) this.spectatorKeys();
    // ---- simulate (a shared co-op world never pauses)
    if (!this.paused || online) {
      if (me) {
        this.camYaw = this.input.yaw; this.camPitch = this.input.pitch;
        const tp = this.view === 'first' && me.alive && !!Game.THIRD_PERSON[me.def.id]?.(me);
        this.abilityCam += ((tp ? 1 : 0) - this.abilityCam) * Math.min(1, dt * 9);
        // barrier free look: primary fire held with the shield up pans the camera; the shield keeps its facing
        const fl = this.settings.controls.barrierFreeLook && me.barrier.up && this.input.held('fire');
        if (fl && !this.freeLook) this.freeLook = { yaw: me.yaw, pitch: me.pitch };
        if (!fl && this.freeLook) { this.input.yaw = this.freeLook.yaw; this.input.pitch = this.freeLook.pitch; this.camYaw = this.input.yaw; this.camPitch = this.input.pitch; this.freeLook = null; }
        const aim = this.freeLook ?? this.solveAim(me);
        this.input.apply(me, aim.yaw, aim.pitch);
        if (this.freeLook) {
          me.input.fire = false;
          if (this.settings.controls.freeLookRelative) {
            // WASD follows the camera, not the shield
            const d = this.camYaw - this.freeLook.yaw, c = Math.cos(d), s = Math.sin(d), mx = me.input.mx, mz = me.input.mz;
            me.input.mx = mx * c + mz * s; me.input.mz = mz * c - mx * s;
          }
        }
        if (!this.input.locked || this.paused) { me.input.fire = false; me.input.alt = false; me.input.mx = me.input.mz = 0; }
      }
      if (this.clientSync) {
        this.clientSync.apply(dt, me ? me.input : null);
        if (me && me.alive) { w.time += 0; w.move(me, Math.min(dt, 0.05)); }
      } else {
        this.acc += dt * this.timeScale;
        let steps = 0;
        while (this.acc >= DT && steps < 16 * Math.max(1, this.timeScale)) {
          w.step(DT); this.acc -= DT; steps++;
          this.dispatch();
        }
        if (steps >= 16) this.acc = 0;
        this.hostSync?.flush();
      }
    }
    // ---- views
    const viewer = { team: me?.team ?? 'zenith', sees: (a: Actor) => !me || w.perceivable(me, a) };
    for (const a of w.actors) {
      // the World swaps hero defs (Tenkai-Oh's pilot ejecting / calling the mech back): rebuild that actor's view
      const old = this.views.get(a.id);
      if (old && old.defId !== a.def.id) { this.scene.remove(old.group); old.dispose(); this.views.delete(a.id); }
      if (!this.views.has(a.id)) this.addView(a, viewer.team);
      const v = this.views.get(a.id)!;
      v.update(dt * (this.paused ? 0 : this.timeScale), w.time, viewer);
      if (a === me && this.view === 'first' && this.abilityCam < 0.08) v.group.visible = false;
    }
    // ---- first-person arms: rebuilt when the hero changes (mech <-> pilot), hidden while scoped, dead or in a boss intro
    const wantFp = !!me && me.alive && this.view === 'first' && !me.sv.zoom && !this.bossCam && this.abilityCam < 0.08;
    if (this.fp && (!me || this.fp.actor !== me || this.fp.defId !== me.def.id)) { this.fp.dispose(); this.fp = null; }
    if (wantFp && !this.fp) this.fp = new FirstPersonArms(me!, equippedSkin(me!.def.id));
    if (this.fp && wantFp) {
      const fdt = dt * (this.paused ? 0 : this.timeScale);
      let dy = this.camYaw - this.fpAim.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      const rate = (d: number) => (fdt > 1e-4 ? d / fdt : 0);
      this.fp.scene.environment = this.scene.environment;
      this.fp.update({ dt: fdt, time: w.time, yawRate: rate(dy), pitchRate: rate(this.camPitch - this.fpAim.pitch), aspect: this.camera.aspect });
    }
    this.fpAim.yaw = this.camYaw; this.fpAim.pitch = this.camPitch;
    this.fx.wfx?.cam.copy(this.camera.position);
    this.fx.fpActor = wantFp ? me : null;
    this.fx.update(dt * (this.paused ? 0 : this.timeScale), w, w.time);
    this.mapScene.update(w.time, w.point, viewer.team, w.packs, w.rules === 'push' ? w.push : null);
    this.updateCamera(dt, me);
    sfx.setListener(this.camera.position, this.camera.getWorldDirection(new THREE.Vector3()));
    if (FULL && !this.paused) this.sound.frame(w, me, this.camera, dt);
    // ---- render
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    if (this.fp && wantFp) {
      // viewmodel pass: own depth so the arms never clip into walls
      const r = this.renderer;
      r.autoClear = false; r.localClippingEnabled = true; r.clearDepth(); r.render(this.fp.scene, this.fp.camera); r.autoClear = true; r.localClippingEnabled = false;
    }
    this.framesRendered++;
    this.hud.update(w, me, this.camera, w.time, this.settings.video.perfStats !== 'off' ? this.fpsAvg : 0, this.input.held('score'), this.spectateLabel());
    if (this.settings.video.perfStats === 'advanced') {
      const ri = this.renderer.info, pr = this.renderer.getPixelRatio();
      this.hud.perf([`${this.fpsAvg.toFixed(0)} FPS  ${(1000 / Math.max(1, this.fpsAvg)).toFixed(1)} ms`, `render ${Math.round(innerWidth * pr)}x${Math.round(innerHeight * pr)} (${Math.round(pr / Math.min(devicePixelRatio, 2) * 100)}%)`,
        `draws ${ri.render.calls}  tris ${(ri.render.triangles / 1000).toFixed(0)}k`, `audio ${sfx.voices} voices  load ${(sfx.load.avg * 100).toFixed(0)}% (peak ${(sfx.load.peak * 100).toFixed(0)}%)`, `sim ${IS_DESKTOP ? 120 : 60} Hz  heroes ${w.actors.length}`]);
    } else this.hud.perf(null);
    if (this.lab && w.mode === 'aitest') {
      this.lab.frame(w, this.views, this.fx, dt * this.timeScale, this.renderer);
      if (Math.round(w.time * 60) % 30 === 0) this.lab.render();
    }
    // ---- campaign cues (boss intros)
    const dir = this.director;
    if (dir && !this.clientSync) for (const ev of dir.events.splice(0)) {
      if (ev.t === 'bossintro') { this.bossIntro(ev.id); this.hostSync?.events.push({ t: 'bossintro', id: ev.id }); }
    }
    // ---- match end
    if (w.winner && !(w as any).__ended) {
      (w as any).__ended = true;
      if (w.mode === 'campaign') setTimeout(() => { this.input.unlock(); this.onCampaignEnd?.(w.winner === 'zenith'); }, 2500);
      else if (w.mode === 'aitest') {
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
    const w = this.match!.world;
    const ev = w.events; w.events = [];
    this.hostSync?.capture(ev);
    for (const e of ev) this.handleEvent(e);
  }

  handleEvent(e: GameEvent | { t: 'bossintro'; id: string }) {
    const m = this.match; if (!m || !this.fx) return;
    const w = m.world, me = m.player;
    if (e.t === 'bossintro') { this.bossIntro(e.id); return; }
    this.lab?.onEvent(e);
    if (FULL) this.sound.event(e);
    if (e.t === 'fx') this.fx.onEvent(e, w.time, this.camPos);
    else if (e.t === 'sfx') {
      // own weapon sounds play un-positioned (in your head), everything else in 3D
      const own = me && e.actor === me;
      if (!FULL) sfx.play(e.id, own ? undefined : e.pos, own ? 0.8 : 1);
    } else {
      this.hud.event(e, me, w.time);
      if (e.t === 'counter') sfx.play('counter');
      if (e.t === 'kill' && me && e.src === me) sfx.play('kill');
    }
  }

  private bossIntro(id: string) {
    bossCard(id);
    const b = this.match?.world.actors.find(x => x.def.id === id && x.alive);
    if (b) this.bossCam = { actor: b, t0: performance.now(), until: performance.now() + 3200 };
  }

  /** third person: find what the crosshair covers and aim the hero's eye at it (so shots land on the reticle) */
  private solveAim(me: Actor) {
    // first person - and first-person heroes pulled out by an ability: the shield / charge faces where the camera faces
    if (this.view === 'first') return { yaw: this.camYaw, pitch: this.camPitch };
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
    // offsets grow with the actor so Tenkai-Oh's 7m giant form stays framed over the shoulder instead of filling the screen
    const back = (mech ? 6.8 : 3.3) * a.scale * zoom, right = (mech ? 1.5 : 0.7) * a.scale * zoom, up = (mech ? 0.6 : 0.3) * a.scale;
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
    const shake = (this.fx?.shake ?? 0) * this.settings.access.cameraShake;
    const zoomFov = me?.sv.zoom ? 38 : this.settings.fov * 0.75;
    cam.fov += (zoomFov - cam.fov) * Math.min(1, dt * 12); cam.updateProjectionMatrix();
    if (me) {
      if (this.view === 'first') {
        const e = me.eye; cam.position.set(e.x, e.y, e.z);
        // an ability that plays in third person eases the camera out over the shoulder and back
        if (this.abilityCam > 0.001) { const k = this.abilityCam * this.abilityCam * (3 - 2 * this.abilityCam); cam.position.lerp(this.cameraPose(me, this.camYaw, this.camPitch), k); }
      } else cam.position.copy(this.cameraPose(me, this.camYaw, this.camPitch));
      if (!me.alive) {
        // death cam: rise and look at the body
        const k = Math.min(1, (this.match!.world.time - me.deathAt) / 1.2);
        cam.position.y += k * 3;
      }
      const f = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
      cam.lookAt(cam.position.clone().add(f));
    } else if (this.match?.world.mode === 'gallery') {
      // animation bench: slow orbit, close enough to read the rig
      const a = this.match.world.actors[0], t = this.match.world.time * 0.35 + (this.galleryAngle ?? 0);
      const r = Math.max(3.2, a.height * 2.3);
      cam.position.set(a.pos.x + Math.sin(t) * r, a.pos.y + a.height * 0.75, a.pos.z + Math.cos(t) * r);
      cam.lookAt(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z);
    } else this.spectatorCamera(dt);
    // boss intro fly-by overrides the gameplay camera for a few seconds (the sim keeps running)
    if (this.bossCam) {
      const bc = this.bossCam, now = performance.now();
      if (now > bc.until || !bc.actor.alive) this.bossCam = null;
      else {
        const a = bc.actor, k = (now - bc.t0) / (bc.until - bc.t0), ang = a.yaw + 0.6 - k * 1.4, r = a.height * 1.3;
        cam.position.set(a.pos.x + Math.sin(ang) * r, a.pos.y + a.height * (0.25 + 0.3 * k), a.pos.z + Math.cos(ang) * r);
        cam.lookAt(a.pos.x, a.pos.y + a.height * 0.65, a.pos.z);
      }
    }
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
    if (this.match?.world.mode === 'gallery') { const a = this.match.world.actors[0]; return `${a.def.name.toUpperCase()} · ${(a.controller as any)?.step?.toUpperCase() ?? ''} · Esc back`; }
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
