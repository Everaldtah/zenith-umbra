// ZENITH Engine Core - the frame-level layer between the game and three.js. The Game owns one; it decides when a frame
// runs, what moment of the simulation it shows, how it is submitted to the GPU and at what resolution. Each part is a
// small module of its own:
//   FramePacer         display refresh detection, vsync-quantized deltas, deadline frame cap
//   Interpolator       draws every actor/projectile between the last two fixed sim steps (no step judder)
//   render()           one shadow-map update and one scene-graph update per frame (three did both on every
//                      renderer.render call - the post chain makes several), GPU-timed; renderer.info counts the
//                      whole frame (draws / triangles of every pass, not just the last one)
//   GpuTimer           GPU ms per frame via timer queries, never stalling
//   DynamicResolution  scene resolution follows GPU load only (never blurs a CPU-bound frame)
//   FsrPass            AMD FSR1 EASU + RCAS from the scene resolution to the screen's
//   AnimBudget         skeleton update rate by screen size (Unreal's URO / Animation Budget Allocator)
//   Broadphase         uniform grid under the Level's collision queries (used by Physics.ts directly)
// Off with ?engine=0 (or localStorage zu-engine=0) - the Game then runs its previous loop unchanged, for A/B checks.
import * as THREE from 'three';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FramePacer } from './FramePacer';
import { Interpolator } from './Interpolator';
import { GpuTimer } from './GpuTimer';
import { DynamicResolution } from './DynamicResolution';
import { FsrPass } from './FsrPass';
import { AnimBudget } from './AnimBudget';
import { FrameGraph } from './FrameGraph';
import type { Actor } from '../game/Actor';

function engineWanted(): boolean {
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('engine') === '0') return false;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('zu-engine') === '0') return false;
  } catch { /* storage blocked: default on */ }
  return true;
}

interface SimWorld { actors: Actor[]; projs: { pos: { x: number; y: number; z: number } }[]; }

export class EngineCore {
  readonly on = engineWanted();
  readonly pacer = new FramePacer();
  readonly interp = new Interpolator();
  readonly gpu: GpuTimer;
  readonly dynres = new DynamicResolution();
  readonly fsr = new FsrPass();
  readonly anim = new AnimBudget();
  readonly graph = new FrameGraph();
  /** runtime switch for the once-per-frame shadow / scene-graph update (A/B in one session: tests/e2e/engine_ab.mjs) */
  optRender = true;
  /** CPU ms of the last frame's own work (loop body), and of its render submission */
  cpuMs = 0;
  renderMs = 0;
  private frameStart = 0;
  private lastFrameMs = 16.7;
  private warmed = new WeakSet<THREE.WebGLRenderer>();

  constructor(private renderer: THREE.WebGLRenderer) {
    this.gpu = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
    this.interp.enabled = this.on;
    this.anim.enabled = this.on;
  }

  /** start of a rAF tick: the delta (s) for a frame to run now, or -1 to skip it (frame cap) */
  frame(tms: number, capFps: number): number {
    this.interp.restore();                       // safety: a frame that threw mid-render left interpolated poses in
    const dt = this.pacer.tick(tms, capFps);
    if (dt >= 0) { this.frameStart = performance.now(); if (dt > 0) this.lastFrameMs = dt * 1000; }
    return dt;
  }

  /** right before each fixed World.step */
  beforeStep(w: SimWorld) { if (this.on) this.interp.snapshot(w.actors, w.projs); }

  /** before the views/camera/FX/HUD read the world: swap in the poses at the shown instant */
  beginView(w: SimWorld, alpha: number, own: Actor | null) { if (this.on) this.interp.apply(w.actors, w.projs, Math.max(0, Math.min(1, alpha)), own); }

  /** after everything that draws has read the world */
  endView() {
    this.interp.restore();
    if (this.frameStart) this.cpuMs = performance.now() - this.frameStart;
  }

  /**
   * Submit the frame: the scene graph is brought up to date once and the shadow map rendered once, however many
   * renderer.render calls the post chain makes over this scene (RenderPass, then GTAO's G-buffer pass...).
   */
  render(scene: THREE.Scene, draw: () => void) {
    const t0 = performance.now();
    this.gpu.begin();
    if (!this.on || !this.optRender) { draw(); this.renderMs = performance.now() - t0; return; }
    const sm = this.renderer.shadowMap, info = this.renderer.info;
    // stats for the whole frame, every pass (restored in endRender: code outside the loop sees three's default)
    info.autoReset = false;
    info.reset();
    scene.updateMatrixWorld();
    const mw = scene.matrixWorldAutoUpdate, au = sm.autoUpdate;
    scene.matrixWorldAutoUpdate = false;
    sm.autoUpdate = false;
    sm.needsUpdate = sm.enabled;
    try { draw(); } finally {
      scene.matrixWorldAutoUpdate = mw;
      sm.autoUpdate = au;
      this.renderMs = performance.now() - t0;
    }
  }

  /** after the last draw of the frame (the first-person viewmodel pass included) */
  endRender() {
    this.renderer.info.autoReset = true;
    this.gpu.end();
    this.graph.push(this.lastFrameMs, this.gpu.last, this.pacer.refreshMs);
  }

  /** the post chain is (re)built: FSR goes last; it upscales whatever resolution the composer runs at */
  finishComposer(c: EffectComposer) {
    if (!this.on) return;
    c.addPass(this.fsr);
    this.warm();
  }

  /** compile the FSR programs now, not on the first frame that needs them (a mid-match hitch) */
  private warm() {
    const r = this.renderer;
    if (this.warmed.has(r)) return;
    this.warmed.add(r);
    this.fsr.warm(r);
  }

  /** composer scale vs canvas: FSR does the resampling, so it only runs when they differ */
  setScale(scale: number) { this.fsr.enabled = this.on && Math.abs(scale - 1) > 0.01; }

  /** dynamic resolution tick; true when the scale changed (the caller re-applies the composer's pixel ratio) */
  updateDynRes(now: number, capFps: number): boolean {
    const target = capFps > 0 ? Math.min(capFps, this.pacer.refreshHz) : this.pacer.refreshHz;
    return this.dynres.update(now, this.gpu.ms, this.cpuMs, this.lastFrameMs, 1000 / target);
  }

  stats() {
    return { on: this.on, refreshHz: +this.pacer.refreshHz.toFixed(1), vsynced: this.pacer.vsynced, alpha: +this.interp.alpha.toFixed(2),
      gpuMs: +this.gpu.ms.toFixed(2), cpuMs: +this.cpuMs.toFixed(2), renderMs: +this.renderMs.toFixed(2), dynScale: this.dynres.scale,
      fsr: this.fsr.enabled ? this.fsr.mode : 'off', timerQuery: this.gpu.supported, animUpdated: this.anim.updated, animHeld: this.anim.held };
  }
}
