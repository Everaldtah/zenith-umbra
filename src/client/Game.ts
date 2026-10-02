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
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PLAY_MAPS } from '../data/maps';
import { HEROES, HERO, PILOTS } from '../data/heroes';
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
import { PuppetSwarm } from '../render/PuppetSwarm';
import { thrownPropReady } from '../render/HeldProps';
import { FirstPersonArms, FP_STYLE } from '../render/FirstPerson';
/** the model each summoning ultimate raises (preloaded with the match) */
const SUMMON_MODEL: Record<string, string> = { effigy: 'enra_susanoo', susanoo: 'raijin_susanoo' };
import { Armory } from './Armory';
import { equippedSkin } from '../data/skins';
import { Fx } from '../render/Fx';
import { loadManifest, heroModel, riggedModel, hasModel, hasProp, propModel } from '../render/Assets';
import { DRAGON_MODEL } from '../render/SpiritDragon';
import { FX_KINDS, compileFor, loadsIdle, nextFrame, showProgress, sleep, texturesOf, uploadTextures, warmObject } from './Preload';
import { animLibrary } from '../render/ClipLibrary';
import { sfx } from '../audio/Sfx';
import { EngineCore } from '../engine/EngineCore';
import { Input, KEYS } from './Input';
import { Hud } from './Hud';
import { AiLab } from './AiLab';
import { PRESETS, IS_DESKTOP, quality, type Settings } from './Settings';
import { UI_COLORS, GIANT_SWORD } from '../render/CharacterView';
import { SUSANOO_SHOWCASE } from '../game/susanoo';
import { loadSurfaces, CLASSIC } from '../render/Surfaces';
import { mapEnvironment } from '../render/EnvLight';
import { gradeFor, gradePass, setGrade } from '../render/PostFx';

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

export interface StartOpts { mode: Mode; map: string; hero: string | null; squad?: { hero: string; netId: string }[]; net?: { coop: Coop; role: 'host' | 'client' }; skill?: number;
  /** extra actors / controllers before the preload (the Hero Viewer's Ult Viewer: its dummies and routine) */
  setup?: (m: Match) => void; }

/** modes whose camera is fixed (Overwatch 2 style): Normal matches in first person, Stadium in third person */
const FIXED_VIEW: Partial<Record<string, 'first' | 'third'>> = { skirmish: 'first', stadium: 'third', quickplay: 'first', competitive: 'first', practice: 'first' };

export class Game {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer | null = null;
  bloom: UnrealBloomPass | null = null;
  /** the per-map colour grade (desktop edition) and the sharpening pass (an upscaler may stand in for it) */
  grade: ShaderPass | null = null;
  sharpenPass: ShaderPass | null = null;
  /** the map's image-based lighting strength relative to the studio room it replaces (1 = the room) */
  private envK = 1;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(90, 1, 0.08, 1200);
  input: Input;
  hud: Hud;
  match: Match | null = null;
  mapScene: MapScene | null = null;
  fx: Fx | null = null;
  views = new Map<number, CharacterView>();
  /** Hex's puppet army, drawn as one instanced swarm (built at match start when a Hex is in the match) */
  swarm: PuppetSwarm | null = null;
  /** first-person arms (viewmodel), drawn in their own pass over the world */
  fp: FirstPersonArms | null = null;
  private fpAim = { yaw: 0, pitch: 0 };
  lab: AiLab | null = null;
  opts: StartOpts | null = null;
  running = false;
  paused = false;
  acc = 0;
  last = performance.now();
  /** frame pacing, render interpolation, GPU timing, dynamic resolution + FSR (src/engine) */
  engine: EngineCore;
  fpsAvg = 60;
  camYaw = 0; camPitch = 0;
  /** first person, Overwatch-style: some abilities pull the camera out to third person while they last (Reinhardt's
   *  Barrier Field / Charge -> Tenkai-Oh's Solar Bulwark / Dawn Charge). 0 = eyes, 1 = over the shoulder */
  abilityCam = 0;
  /** barrier free look: the shield's facing, held while the camera pans (hold primary fire with the shield up) */
  private freeLook: { yaw: number; pitch: number } | null = null;
  /** abilities that play in third person (as in Overwatch) */
  static readonly THIRD_PERSON: Record<string, (a: Actor, t: number) => boolean> = {
    tenkai: a => a.barrier.up || a.forced?.kind === 'dawncharge',
    // Gantetsu's Tachiai Rush and the Shiko leap: a chase camera, as Overwatch shows Mauga's Overrun and its stomp
    gantetsu: (a, t) => a.has('tachiai', t) || a.has('stompair', t),
    // Tomoe's Crescent Warpath: the flight and its spin are seen from behind (Overwatch cuts to third person for
    // Junker Queen's Rampage the same way)
    tomoe: a => a.forced?.kind === 'tide',
    // Raijin's Storm Sovereign: the camera pulls out for the giant's rise and its first thunderbolt, then back to his eyes
    raijin: (a, t) => a.has('sovereign', t) && t - (a.sv.susanooCast ?? -9) < SUSANOO_SHOWCASE,
  };
  /** ...and how long the camera stays out after the ability ends (Gantetsu: to see the slam land and its victims fall) */
  static readonly THIRD_HOLD: Record<string, number> = { gantetsu: 0.45, tomoe: 0.3, raijin: 0.2 };
  private abilityCamUntil = 0;
  specIdx = 0; specNextSwitch = 0; freeCam = false;
  camPos = new THREE.Vector3();
  timeScale = 1;
  labMapIdx = 0;
  galleryAngle = 0;
  /** drives the camera on the gallery bench instead of the slow orbit (the Ult Viewer: UltShowcase.camera) */
  showcaseCam: ((cam: THREE.PerspectiveCamera, dt: number) => void) | null = null;
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
    // three r186 removed PCFSoftShadowMap (it silently switches to PCF on the first shadow render - after the preload
    // has compiled every shader for the old type, so they'd all compile again in play)
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.engine = new EngineCore(this.renderer);
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
    this.engine.dynres.reset(this.dynScale);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * (this.engine.on ? 1 : Q.pixelRatio * this.dynScale));
    this.renderer.shadowMap.enabled = Q.shadows > 0;
    const st = THREE.PCFShadowMap;             // (softShadows: PCFSoftShadowMap is gone in r186, see the constructor)
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
    this.applyScale();
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

  /** the post chain the options ask for: ambient occlusion, bloom (glow quality), tone mapping, colour grade, anti-aliasing,
   *  sharpening. The chain draws into a multisampled target when MSAA is on (the canvas' own MSAA never reached the
   *  composer's targets), and GTAO reads that target's depth instead of re-drawing the scene for a normal buffer */
  private buildComposer() {
    const s = this.settings, Q = quality(s), v = s.video;
    const ao = v.ao !== 'off', sharp = v.sharpen > 0, grade = FULL && !CLASSIC;
    if (this.composer) { for (const p of this.composer.passes) (p as { dispose?: () => void }).dispose?.(); this.composer.dispose(); }
    this.composer = null; this.bloom = null; this.grade = null; this.sharpenPass = null;
    if (!Q.bloom && !Q.fxaa && !ao && !sharp && !grade) return;
    const pr = this.renderer.getPixelRatio(), W = Math.max(1, Math.round(innerWidth * pr)), H = Math.max(1, Math.round(innerHeight * pr));
    const rt = new THREE.WebGLRenderTarget(W, H, {
      type: THREE.HalfFloatType, samples: FULL && Q.antialias ? 4 : 0,
      depthTexture: ao ? new THREE.DepthTexture(W, H) : undefined,
    });
    rt.texture.name = 'EffectComposer.rt1';
    const c = new EffectComposer(this.renderer, rt);
    // the scene pass draws into the composer's first read buffer (renderTarget2, rt's clone); only it needs a depth
    // texture - rt1 keeps a plain depth buffer
    if (rt.depthTexture) { rt.depthTexture.dispose(); rt.depthTexture = null; }
    // passes swap read/write a varying number of times a frame: the scene pass must always land in renderTarget2 (its
    // depth texture is what GTAO reads)
    const render = c.render.bind(c);
    c.render = (dt?: number) => { if (c.readBuffer !== c.renderTarget2) c.swapBuffers(); render(dt); };
    c.addPass(new RenderPass(this.scene, this.camera));
    if (ao) {
      const g = new GTAOPass(this.scene, this.camera, innerWidth, innerHeight);
      // (r186: passing the depth to the constructor throws - setGBuffer needs the normal target the default path makes)
      g.setGBuffer(c.renderTarget2.depthTexture!);
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
    if (grade) { this.grade = gradePass(gradeFor(this.match?.world.map.id)); c.addPass(this.grade); }
    // post anti-aliasing: SMAA on the desktop edition (sharper than FXAA, keeps texture detail)
    if (Q.fxaa) c.addPass(FULL ? new SMAAPass() : new FXAAPass());
    if (sharp) { const p = new ShaderPass(SHARPEN); p.uniforms.amount.value = v.sharpen / 100 * 0.6; c.addPass(p); this.sharpenPass = p; }
    c.setSize(innerWidth, innerHeight);
    this.composer = c;
    this.engine.finishComposer(c);
    if (this.bloom && this.match) { const day = FULL && this.match.world.map.sun.intensity >= 2.1; this.bloom.threshold = day ? 0.97 : 0.82; this.bloom.strength = day ? 0.38 : 0.55;
      if (FULL && this.match.world.map.bloom) [this.bloom.threshold, this.bloom.strength] = this.match.world.map.bloom; }
  }

  /** detail options that live in the scene: reflections, fog distance, texture filtering, effects density, waypoint */
  applySceneDetail() {
    const s = this.settings, Q = quality(s), v = s.video, A = s.access;
    this.scene.environmentIntensity = Q.envIntensity * (v.localReflections ? 1 : 0.8) * this.envK;
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

  /** the render scale (setting x dynamic): with the engine, the canvas stays at native size and only the post chain
   *  runs scaled - FSR resamples to the screen, the first-person pass draws at native; without a post chain (or with
   *  the engine off) the canvas itself is scaled, as before */
  private applyScale() {
    const Q = quality(this.settings), native = Math.min(devicePixelRatio, 2), scale = Q.pixelRatio * this.dynScale;
    if (this.engine.on && this.composer) {
      if (this.renderer.getPixelRatio() !== native) this.renderer.setPixelRatio(native);
      this.composer.setPixelRatio(native * scale);
      this.engine.setScale(scale);
    } else this.renderer.setPixelRatio(native * scale);
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer?.setSize(innerWidth, innerHeight);
    if (this.grade) setGrade(this.grade, gradeFor(this.match?.world.map.id));
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  async start(o: StartOpts) {
    this.stop();
    // hero GLB manifest + the animation clip library (public/anim; missing = fully procedural) before any view exists
    await Promise.all([loadManifest(), animLibrary(), FULL ? loadSurfaces() : null]);
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
      w.nav = this.match.nav;
      this.clientSync = new ClientSync(w, o.net.coop, e => this.handleEvent(e), LEVEL[o.map]);
    } else {
      this.match = o.mode === 'campaign'
        ? createCampaign(o.map, o.squad ?? [{ hero: o.hero ?? 'tenkai', netId: 'local' }], this.settings.difficulty)
        : createMatch(o.map, o.mode, o.hero, o.skill ?? this.settings.difficulty);
      if (o.net?.role === 'host') this.hostSync = new HostSync(this.match.world, o.net.coop);
      o.setup?.(this.match);
    }
    this.bossCam = null;
    const w = this.match.world;
    CharacterView.level = w.level;                  // ragdolls land on this map's floors and walls
    sfx.bank.prioritize([...new Set(w.actors.map(a => a.def.id))]);   // this match's voices decode first
    this.mapScene = new MapScene(w.map, w.level, q, this.scene);
    // bright daylight maps (pale plaster, white stone): only real highlights bloom, or sunlit walls glow white
    if (this.bloom) { const day = FULL && w.map.sun.intensity >= 2.1; this.bloom.threshold = day ? 0.97 : 0.82; this.bloom.strength = day ? 0.38 : 0.55;
      if (FULL && w.map.bloom) [this.bloom.threshold, this.bloom.strength] = w.map.bloom; }
    // image-based lighting so metallic / dark generated materials still catch light
    // (desktop edition: the map's own HDRI - its sky and ground in every reflection - turned to its sun; else the room)
    this.envTex ??= new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    const menv = FULL ? await mapEnvironment(this.renderer, w.map.id, w.map.sun.dir) : null;
    this.scene.environment = menv?.texture ?? this.envTex;
    this.scene.environmentRotation.set(0, menv?.rotY ?? 0, 0);
    // a normalised HDRI (mean 1, sun clamped) gives less fill than the studio room's bright panels: scaled up so shade
    // keeps the old level (measured: tests/e2e/render_ab.mjs, same camera, mean frame luminance within a few %)
    this.envK = menv ? 1.6 * menv.mood : 1;
    this.scene.environmentIntensity = 0.55;
    this.fx = new Fx(this.scene, quality(this.settings).fxCap);
    // scene detail options now, and again once the heroes' models have streamed in (texture filtering)
    // (texture filtering is applied again by the preload, once every model is in - no re-uploads mid-match)
    this.buildComposer(); this.applySceneDetail();
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
    if (FULL && w.actors.some(a => a.baseDef.id === 'hex')) this.swarm = new PuppetSwarm(this.scene);
    for (const a of w.actors) this.addView(a, viewerTeam);
    await this.warmUp(w, viewerTeam);
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

  /** what the last match preload did (for the e2e checks) */
  preloadStats: { ms: number; textures: number; programs: number; phases: Record<string, number> } | null = null;

  /**
   * Everything the match will draw loaded, uploaded to the GPU and compiled while the loading screen is still up
   * (Preload.ts): models and their props, the map, what arrives later (pilots, campaign waves, spirit dragons), the
   * sound bank for this match, every texture, every shader against this scene's lights, one of every combat effect,
   * then a full turn of real frames through shadows, post and the first-person pass.
   */
  private async warmUp(w: WorldCls, viewerTeam: string) {
    const r = this.renderer, me = this.match!.player, t0 = performance.now(), phases: Record<string, number> = {};
    let mark = t0;
    const phase = (name: string) => { const n = performance.now(); phases[name] = Math.round(n - mark); mark = n; };
    const P = (label: string, a: number, b: number) => (k: number) => showProgress(label, a + (b - a) * Math.max(0, Math.min(1, k)));
    CharacterView.warm = null;
    const viewer = { team: viewerTeam, sees: () => true };
    // ---- 1. assets
    const assets = P('Loading heroes and map', 0, 0.45);
    assets(0);
    const later = new Set<string>();
    for (const a of w.actors) { const pilot = PILOTS[a.baseDef.id]; if (pilot) later.add(pilot.id); }
    if (w.mode === 'campaign' && this.opts && LEVEL[this.opts.map]) {
      const L = LEVEL[this.opts.map], enc = JSON.stringify(L.encounters);
      for (const id of [...Object.keys(ENEMIES), ...Object.keys(BOSSES)]) if (enc.includes(`"${id}"`)) later.add(id);
      later.add(L.boss);
    }
    // the giant forms the ultimates summon (Enra's Crimson Effigy, Raijin's Susanoo) load before the match starts
    for (const a of w.actors) { const sm = SUMMON_MODEL[a.def.ult.id]; if (sm && hasModel(sm)) later.add(sm); }
    const warmGroup = new THREE.Group(); warmGroup.position.set(0, -400, 0);
    const laterLoads: Promise<void>[] = [...later].filter(id => hasModel(id)).map(id => heroModel(id).then(m => { if (m) warmGroup.add(m); }));
    // ...and the greatsword the effigy swings, and the seals of Kaien's storm (the instanced swarm's own material)
    if (w.actors.some(a => a.def.ult.id === 'effigy') && hasProp(GIANT_SWORD.enra_effigy)) laterLoads.push(propModel(GIANT_SWORD.enra_effigy).then(m => { if (m) warmGroup.add(m); }));
    if (this.fx && w.actors.some(a => a.def.ult.id === 'sealstorm')) laterLoads.push(this.fx.seals.ready);
    if (this.swarm) laterLoads.push(this.swarm.ready);
    // thrown props (Hayate's shuriken): fitted now and drawn parked with the rest, so the first throw compiles nothing
    for (const a of w.actors) for (const wd of [a.def.primary, a.def.secondary]) {
      const mesh = (wd as { mesh?: string }).mesh;
      if (mesh) laterLoads.push(thrownPropReady(mesh, a.def.height * a.scale).then(m => { if (m) warmGroup.add(m); }));   // (null when no prop, nor a stand-in, is published)
    }
    for (const [hero, id] of Object.entries(DRAGON_MODEL)) if (FULL && w.actors.some(a => a.def.id === hero)) laterLoads.push(riggedModel(id).then(m => { if (m) warmGroup.add(m); }));
    const views = () => [...this.views.values()];
    const needs = (v: CharacterView) => hasModel(v.actor.def.id);
    for (const t = performance.now(); performance.now() - t < 45000; await sleep(100)) {
      const vs = views(), done = vs.filter(v => v.real || !needs(v)).length;
      assets(vs.length ? done / vs.length * 0.9 : 0.9);
      if (done === vs.length) break;
    }
    // the props the views attach once their bodies are in, the map's props and textures, the later arrivals
    for (const v of views()) v.update(1 / 60, w.time, viewer);
    await Promise.all([loadsIdle(20000), Promise.race([Promise.all(laterLoads), sleep(30000)])]);
    await loadsIdle(10000);
    assets(1); phase('assets');
    // ---- 2. sounds: every effect and this match's voice lines decoded (the rest of the bank keeps decoding in play)
    if (FULL) {
      const voices = [...new Set(w.actors.map(a => a.def.id)), 'announcer'], snd = P('Loading sounds', 0.45, 0.58);
      const n0 = Math.max(1, sfx.bank.pendingFor(voices));
      for (const t = performance.now(); performance.now() - t < 25000 && sfx.bank.pendingFor(voices) > 0; await sleep(100)) snd(1 - sfx.bank.pendingFor(voices) / n0);
    }
    phase('sounds');
    // ---- settle the scene: every view posed with its props, the camera at the player, the first-person arms built
    this.scene.add(warmGroup);
    for (const v of views()) v.update(1 / 60, w.time, viewer);
    this.mapScene!.update(w.time, w.point, viewerTeam, w.packs, w.rules === 'push' ? w.push : null);
    this.updateCamera(1 / 60, me);
    if (me && this.view === 'first' && me.alive) {
      this.fp ??= new FirstPersonArms(me, equippedSkin(me.def.id));
      for (const t = performance.now(); performance.now() - t < 15000 && !this.fp.view.real; await sleep(100)) { /* its own copy of the hero */ }
      this.fp.scene.environment = this.scene.environment;
      this.fp.scene.environmentRotation.copy(this.scene.environmentRotation);   // (the map HDRI's turn to its sun)
      // (what the viewmodel would fetch on its first frame - Tenkai-Oh's gauntlets - fetched now; the update mounts it)
      await Promise.race([this.fp.preload(), sleep(10000)]);
      this.fp.update({ dt: 1 / 60, time: w.time, yawRate: 0, pitchRate: 0, aspect: this.camera.aspect });
    }
    this.applySceneDetail();            // texture filtering on every texture now in the scene, BEFORE the upload
    // ---- 3. GPU: every texture uploaded
    const tex = texturesOf(this.scene);
    if (this.fp) texturesOf(this.fp.scene, tex);
    if (this.scene.environment) tex.add(this.scene.environment);
    const nTex = await uploadTextures(r, tex, P('Uploading to the GPU', 0.58, 0.72));
    phase('gpu');
    // ---- 4. shaders: one of every combat effect spawned in front of the camera, then everything compiled
    const shaders = P('Compiling shaders', 0.72, 0.9);
    shaders(0);
    const cam = this.camera.position.clone(), fwd = this.camera.getWorldDirection(new THREE.Vector3());
    const at = cam.clone().addScaledVector(fwd, 7), side = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize();
    const pos = { x: at.x, y: at.y, z: at.z }, to = { x: at.x + side.x * 3, y: at.y, z: at.z + side.z * 3 };
    const actor = me ?? w.actors[0], target = w.actors.find(a => a !== actor) ?? actor;
    // zones (a seal, a sanctuary, a singularity, a boss's warning shape) draw with shaders of their own and only exist
    // while someone's ability does: samples shown to the effects for the warm-up only - a copy of the world with them
    // added, the real world never holds them (they'd silence and pull)
    const zoneSamples = actor ? (['seal', 'sanctuary', 'singularity', 'tele', 'tele'] as const).map((kind, k) => ({
      id: -9000 - k, kind, owner: actor, team: actor.team, x: pos.x + (k - 2) * 1.5, y: pos.y - 1, z: pos.z, r: 3, born: w.time - 1, until: w.time + 100, next: 1e9,
      data: kind === 'tele' ? { shape: k === 4 ? 'line' : 'circle', color: '#ff3355', fireAt: w.time + 50, done: false, x: pos.x, z: pos.z, x2: to.x, z2: to.z } : undefined,
    })) : [];
    const wz = Object.create(w) as typeof w;
    Object.defineProperty(wz, 'zones', { value: [...w.zones, ...zoneSamples] });
    if (this.fx && actor) {
      for (const kind of FX_KINDS) {
        try { this.fx.onEvent({ t: 'fx', kind, pos, to, actor, target, color: '#ffffff', r: 3, dur: 0.6 } as unknown as Parameters<Fx['onEvent']>[0], w.time, this.camera.position); } catch { /* an effect that needs more context */ }
      }
      this.fx.update(1 / 60, wz, w.time);
    }
    // compiled into the composer's buffer: the scene is drawn there (linear output), not straight to the screen, and
    // the output colour space is part of every program's key
    const into = this.composer ? (this.composer as unknown as { readBuffer: THREE.WebGLRenderTarget }).readBuffer : null;
    await compileFor(r, this.scene, this.camera, this.scene, into);
    shaders(0.7);
    if (this.fp) await compileFor(r, this.fp.scene, this.fp.camera, this.fp.scene);
    shaders(1); phase('shaders');
    // ---- 5. warm-up: a full turn of real frames (shadow maps, post-processing, the first-person pass)
    const warm = P('Warming up', 0.9, 1), q0 = this.camera.quaternion.clone(), e0 = new THREE.Euler().setFromQuaternion(q0, 'YXZ');
    const N = 12;
    // stealth (Kagemaru's veil and the like) turns a hero's materials transparent, drawn in two passes (back faces, then
    // front): two more programs per material, compiled here by drawing a few of these frames that way. Each material
    // keeps every program it has used, so switching back costs nothing and the variants stay compiled.
    const stealthMats = [...views().flatMap(v => v.mats), ...(this.fp ? this.fp.view.mats : [])];
    const stealth = (on: boolean) => { for (const m of stealthMats) { m.transparent = on; m.depthWrite = !on; m.needsUpdate = true; } };
    // the effects' clock runs through the warm-up, so delayed ones (the spirit dragons swim out 0.25 s after the cast,
    // their rigs cloned asynchronously) appear and draw here too - more frames until they have (up to ~1.5 s)
    const swims = () => (this.fx?.dragons as unknown as { swims?: unknown[] } | null)?.swims?.length ?? 0;
    const wantDragons = FULL && !!this.fx?.dragons && w.actors.some(a => a.def.id in DRAGON_MODEL);
    let seenDragons = false;
    const HOLD = 8;                     // frames facing the sample effects (7 m ahead) before turning the full circle
    // the parts of each hero that only show sometimes (hammer flames, muzzle flashes, shield bubbles, a sheathed or
    // thrown weapon) are shown for the warm-up, so their shaders are built in exactly the state they're drawn in
    const revealed: THREE.Object3D[] = [];
    // (and the map's: the objective's effects that only switch on when the point unlocks or the float moves)
    for (const root of [...views().map(v => v.group), ...(this.fp ? [this.fp.scene] : []), ...(this.mapScene ? [this.mapScene.group] : [])]) root.traverse(o => { if (!o.visible && o !== root) { o.visible = true; revealed.push(o); } });
    for (let i = 0; i < N + HOLD || (wantDragons && !seenDragons && i < N + HOLD + 60); i++) {
      if (i === 2) stealth(true);
      if (i === 4) stealth(false);
      this.fx?.update(1 / 60, wz, w.time + i * 0.1);
      if (swims() > 0) seenDragons = true;
      const turn = i < HOLD || (wantDragons && !seenDragons) ? 0 : ((i - HOLD) % N) / N * Math.PI * 2;
      this.camera.quaternion.setFromEuler(new THREE.Euler(e0.x, e0.y + turn, 0, 'YXZ'));
      this.camera.updateMatrixWorld();
      if (this.composer) this.composer.render(); else r.render(this.scene, this.camera);
      if (this.fp) { r.setRenderTarget(null); r.autoClear = false; r.localClippingEnabled = true; r.clearDepth(); r.render(this.fp.scene, this.fp.camera); r.autoClear = true; r.localClippingEnabled = false; }
      warm(Math.min(1, (i + 1) / (N + HOLD)));
      await nextFrame();
    }
    this.camera.quaternion.copy(q0);
    // hidden parts the warm-up camera never saw (a sheathed blade behind the viewmodel's frame): compiled while still
    // shown, into the same targets they're drawn to (compile ignores the camera's view)
    await compileFor(r, this.scene, this.camera, this.scene, into);
    if (this.fp) await compileFor(r, this.fp.scene, this.fp.camera, this.fp.scene);
    for (const o of revealed) o.visible = false;
    // the sample effects played out and gone, the far-off copies removed
    if (this.fx) for (let k = 1; k <= 8; k++) this.fx.update(0.5, w, w.time + k * 2);
    this.scene.remove(warmGroup);
    phase('warmup');
    // mid-match arrivals get the same treatment before they show (CharacterView.warm)
    const aniso = Math.min(r.capabilities.getMaxAnisotropy(), this.settings.video.texFilter);
    CharacterView.warm = async (o: THREE.Object3D) => {
      o.traverse(ob => { const m = (ob as THREE.Mesh).material; for (const mt of Array.isArray(m) ? m : m ? [m] : []) { const t = (mt as THREE.MeshStandardMaterial).map; if (t && t.anisotropy !== aniso) { t.anisotropy = aniso; t.needsUpdate = true; } } });
      // compiled for where the scene is drawn (the composer's buffer) - bound only for the compile call itself
      const target = this.composer ? (this.composer as unknown as { readBuffer: THREE.WebGLRenderTarget }).readBuffer : null;
      await warmObject(r, o, this.camera, this.scene, target);
    };
    this.preloadStats = { ms: Math.round(performance.now() - t0), textures: nTex, programs: r.info.programs?.length ?? 0, phases };
    console.info('[preload]', JSON.stringify(this.preloadStats));
  }

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
    if (a.isSummon && !a.def.model) return;   // (the swarm draws those; a summon with a model of its own gets a body)
    const v = new CharacterView(a, viewerTeam, a.isPlayer ? equippedSkin(a.def.id) : 'classic');
    v.onStep = (act, _side, heavy) => {
      if (!this.match) return;
      if (FULL) this.sound.step(act, heavy); else sfx.play(heavy ? 'mechstep' : 'step', act.pos, heavy ? 1 : 0.6);
      if (heavy) { this.fx?.onEvent({ t: 'fx', kind: 'step', pos: { ...act.pos } }, this.match.world.time, this.camPos); this.fx!.shake = Math.max(this.fx!.shake, 0.08 / (1 + this.camPos.distanceTo(new THREE.Vector3(act.pos.x, act.pos.y, act.pos.z)) / 8)); }
    };
    v.onBodyFall = (_act, at, speed) => { if (this.match) sfx.play('bodyfall', { x: at.x, y: at.y, z: at.z }, Math.min(1, 0.35 + speed / 10)); };
    // a heavy strike's impact frame: the striker's own camera kicks, anyone near feels the shake
    v.onRebornSolid = act => { this.fx?.onEvent({ t: 'fx', kind: 'rebirthring', pos: { ...act.center }, actor: act } as Parameters<Fx['onEvent']>[0], this.match?.world.time ?? 0, this.camPos); };
    v.onImpact = act => { if (!this.fx) return; const me = this.match?.player; const near = this.camPos.distanceTo(new THREE.Vector3(act.pos.x, act.pos.y, act.pos.z)); this.fx.shake = Math.max(this.fx.shake, act === me ? 0.3 : 0.18 / (1 + near / 6)); if (act === me && this.fp) this.fp.kick(0.9); };
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
    this.swarm?.dispose(this.scene); this.swarm = null;
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
    let dt: number;
    if (this.engine.on) {
      dt = this.engine.frame(tms, v.fpsCap);
      if (dt < 0) return;
    } else {
      dt = Math.min(0.1, (tms - this.last) / 1000);
      if (dt < 1 / Q.maxFps - 0.002) return;
    }
    this.last = tms;
    if (dt > 0) this.fpsAvg += (1 / dt - this.fpsAvg) * 0.05;
    // dynamic render scale: the engine follows the GPU's measured load (src/engine/DynamicResolution.ts)
    if (this.engine.on && v.dynamicRes && this.running) {
      if (this.engine.updateDynRes(tms, v.fpsCap)) { this.dynScale = this.engine.dynres.scale; this.applyScale(); }
    } else if (v.dynamicRes && this.running && tms - this.dynAt > 500) {
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
        const tpOn = this.view === 'first' && me.alive && !!Game.THIRD_PERSON[me.def.id]?.(me, w.time);
        if (tpOn) this.abilityCamUntil = w.time + (Game.THIRD_HOLD[me.def.id] ?? 0);
        else if (this.abilityCamUntil - w.time > 2) this.abilityCamUntil = 0;          // a new match: its clock starts over
        const tp = tpOn || (this.view === 'first' && me.alive && w.time < this.abilityCamUntil);
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
          this.engine.beforeStep(w);
          w.step(DT); this.acc -= DT; steps++;
          this.dispatch();
        }
        if (steps >= 16) this.acc = 0;
        this.hostSync?.flush();
      }
    }
    // ---- views (from here to the HUD everything reads the poses at the shown instant, between the last two steps)
    this.engine.beginView(w, this.clientSync ? 1 : this.acc / DT, me);
    const viewer = { team: me?.team ?? 'zenith', sees: (a: Actor) => !me || w.perceivable(me, a) };
    const vdt = dt * (this.paused ? 0 : this.timeScale), showcase = w.mode === 'gallery';
    this.engine.anim.begin(this.camera, innerHeight);
    for (const a of w.actors) {
      // the World swaps hero defs (Tenkai-Oh's pilot ejecting / calling the mech back): rebuild that actor's view
      const old = this.views.get(a.id);
      if (old && old.defId !== a.def.id) { this.scene.remove(old.group); old.dispose(); this.views.delete(a.id); }
      if (a.isSummon && !a.def.model) { this.swarm ??= new PuppetSwarm(this.scene); continue; }
      if (!this.views.has(a.id)) this.addView(a, viewer.team);
      const v = this.views.get(a.id)!;
      // animation LOD: small / off-screen heroes re-pose at a reduced rate; between updates only the root follows
      const always = a === me || showcase || !a.alive || a.isBoss || !!a.def.holo || !!a.forced || a.def.id === 'susanoo' || a.has('knockdown', w.time) || v.anim.down > 0 || this.bossCam?.actor === a;
      const adt = this.engine.anim.step(v, a, vdt, always);
      if (adt >= 0) v.update(adt, w.time, viewer);
      else { v.group.position.set(a.pos.x, a.pos.y, a.pos.z); v.group.rotation.y = a.yaw; }
      if (a === me && this.view === 'first' && this.abilityCam < 0.08) v.group.visible = false;
    }
    // ---- first-person arms: rebuilt when the hero changes (mech <-> pilot), hidden while scoped, dead or in a boss intro
    // (a scope hides the viewmodel; an archer's Hawk Eye aims down the arrow with the bow still in view - Freja's Take Aim)
    const wantFp = !!me && me.alive && this.view === 'first' && (!me.sv.zoom || FP_STYLE[me.def.id]?.grip === 'bow') && !this.bossCam && this.abilityCam < 0.08;
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
    this.swarm?.update(w, w.time, viewer.team, viewer.sees);
    this.fx.update(dt * (this.paused ? 0 : this.timeScale), w, w.time);
    this.mapScene.update(w.time, w.point, viewer.team, w.packs, w.rules === 'push' ? w.push : null, this.camera.position);   // (the float hides while the camera is inside it)
    this.updateCamera(dt, me);
    sfx.setListener(this.camera.position, this.camera.getWorldDirection(new THREE.Vector3()));
    if (FULL && !this.paused) this.sound.frame(w, me, this.camera, dt);
    // ---- render
    this.engine.render(this.scene, () => { if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera); });
    if (this.fp && wantFp) {
      // viewmodel pass: own depth so the arms never clip into walls; always to the screen, whatever target the passes
      // before it left bound
      const r = this.renderer;
      r.setRenderTarget(null); r.autoClear = false; r.localClippingEnabled = true; r.clearDepth(); r.render(this.fp.scene, this.fp.camera); r.autoClear = true; r.localClippingEnabled = false;
    }
    this.engine.endRender();
    this.framesRendered++;
    this.hud.update(w, me, this.camera, w.time, this.settings.video.perfStats !== 'off' ? this.fpsAvg : 0, this.input.held('score'), this.spectateLabel());
    if (this.settings.video.perfStats === 'advanced') {
      const ri = this.renderer.info, e = this.engine, es = e.on && this.composer;
      const pr = es ? Math.min(devicePixelRatio, 2) * quality(this.settings).pixelRatio * this.dynScale : this.renderer.getPixelRatio();
      this.hud.perf([`${this.fpsAvg.toFixed(0)} FPS  ${(1000 / Math.max(1, this.fpsAvg)).toFixed(1)} ms`, `render ${Math.round(innerWidth * pr)}x${Math.round(innerHeight * pr)} (${Math.round(pr / Math.min(devicePixelRatio, 2) * 100)}%)${es && e.fsr.enabled ? ' ' + e.fsr.mode.toUpperCase() : ''}`,
        `draws ${ri.render.calls}  tris ${(ri.render.triangles / 1000).toFixed(0)}k`, `audio ${sfx.voices} voices  load ${(sfx.load.avg * 100).toFixed(0)}% (peak ${(sfx.load.peak * 100).toFixed(0)}%)`, `sim ${IS_DESKTOP ? 120 : 60} Hz  heroes ${w.actors.length}`,
        ...(e.on ? [`CPU ${e.cpuMs.toFixed(1)} ms (render ${e.renderMs.toFixed(1)})  GPU ${e.gpu.ms >= 0 ? e.gpu.ms.toFixed(1) + ' ms' : 'n/a'}`, `display ${e.pacer.refreshHz.toFixed(0)} Hz${e.pacer.vsynced ? ' vsync' : ''}  interp ${e.interp.alpha.toFixed(2)}`, `anim LOD ${e.anim.updated} full / ${e.anim.held} held`] : [])]);
    } else this.hud.perf(null);
    this.engine.graph.show(this.host, this.engine.on && this.settings.video.perfStats === 'advanced');
    if (this.lab && w.mode === 'aitest') {
      this.lab.frame(w, this.views, this.fx, dt * this.timeScale, this.renderer);
      if (Math.round(w.time * 60) % 30 === 0) this.lab.render();
    }
    this.engine.endView();
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
    } else if (this.match?.world.mode === 'gallery' && this.showcaseCam) this.showcaseCam(cam, dt);
    else if (this.match?.world.mode === 'gallery') {
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
