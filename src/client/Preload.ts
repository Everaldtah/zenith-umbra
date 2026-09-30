// Match preloader: everything a match will draw is loaded, uploaded to the GPU and compiled BEFORE the loading screen
// closes, so nothing pops in, flickers or hitches during play. Measured before this existed (RTX 3050, desktop build):
// single frames of 2.2 s, 2.6 s and 0.3 s in the first half minute of a match - shader programs compiling and 4K
// textures uploading the first time each hero, prop and effect was drawn - while the simulation (3-6 ms) and all the
// character views (3-5 ms) were cheap.
//
// The phases (driven by Game.warmUp):
//   1. assets    every GLB / texture the match requests (tracked through three's loading manager) plus the ones it
//                will need later (the pilots mechs eject, the campaign level's enemies and boss, the spirit dragons)
//   2. sounds    the recorded sound effects and this match's voice lines decoded (desktop)
//   3. gpu       every texture in the scene uploaded (renderer.initTexture)
//   4. shaders   every material compiled against the match's own lights (renderer.compileAsync: parallel on drivers
//                with KHR_parallel_shader_compile), plus one of every combat effect spawned out of sight
//   5. warm-up   full frames through the real pipeline (shadows, post, first-person pass) turning a full circle
// Mid-match arrivals (a hero swap, a pilot ejecting, a new wave) get the same treatment for their own model before
// it shows (CharacterView.warm).
import * as THREE from 'three';

// ---------------------------------------------------------------- 1. load tracking (every loader using the default manager)
let pending = 0;
let idleWaiters: (() => void)[] = [];
{
  const M = THREE.DefaultLoadingManager;
  const start = M.itemStart.bind(M), end = M.itemEnd.bind(M);
  M.itemStart = (url: string) => { pending++; start(url); };
  M.itemEnd = (url: string) => {
    pending = Math.max(0, pending - 1); end(url);
    if (!pending) { const w = idleWaiters; idleWaiters = []; for (const f of w) f(); }
  };
}
/** in-flight file loads (GLBs, their embedded textures, map textures) */
export const loadsPending = () => pending;
/** resolves once no file load has been in flight for `settle` ms (a load that finishes often starts the next one) */
export async function loadsIdle(timeoutMs = 30000, settle = 250): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    if (!pending) {
      await sleep(settle);
      if (!pending) return true;
    } else await Promise.race([new Promise<void>(r => idleWaiters.push(r)), sleep(500)]);
  }
  return false;
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()));

// ---------------------------------------------------------------- 3. textures
const TEX_KEYS = ['map', 'normalMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'lightMap', 'bumpMap',
  'displacementMap', 'envMap', 'specularMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap',
  'sheenRoughnessMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap', 'anisotropyMap', 'gradientMap', 'matcap'];

/** every texture an object tree's materials use (including ShaderMaterial uniforms) */
export function texturesOf(root: THREE.Object3D, into = new Set<THREE.Texture>()): Set<THREE.Texture> {
  const add = (t: unknown) => { if (t && (t as THREE.Texture).isTexture) into.add(t as THREE.Texture); };
  root.traverse(o => {
    const mats = (o as THREE.Mesh).material;
    if (!mats) return;
    for (const m of Array.isArray(mats) ? mats : [mats]) {
      const r = m as unknown as Record<string, unknown>;
      for (const k of TEX_KEYS) add(r[k]);
      const u = (m as THREE.ShaderMaterial).uniforms;
      if (u) for (const v of Object.values(u)) add(v?.value);
    }
  });
  return into;
}

/** upload textures to the GPU now (not on the frame they first draw); yields every few so the loading screen animates */
export async function uploadTextures(renderer: THREE.WebGLRenderer, tex: Iterable<THREE.Texture>, onStep?: (k: number) => void) {
  const list = [...tex].filter(t => t.image || (t as THREE.CubeTexture).images?.length || (t as THREE.DataTexture).isDataTexture);
  let t0 = performance.now();
  for (let i = 0; i < list.length; i++) {
    try { renderer.initTexture(list[i]); } catch { /* a texture that can't upload yet just uploads when drawn */ }
    if (performance.now() - t0 > 40) { onStep?.((i + 1) / list.length); await nextFrame(); t0 = performance.now(); }
  }
  onStep?.(1);
  return list.length;
}

/**
 * compile every material in `root` against `scene`'s lights / fog / environment without drawing anything. `target`: the
 * render target the programs are built for (the output colour space is part of every program's key) - bound only for
 * the synchronous compile() call inside, then restored: a target left bound across the awaits leaked into the frames
 * drawn meanwhile, and two overlapping compiles could restore each other's stale target for good (the first-person
 * viewmodel then drew into the composer's buffer - hands and guns gone after a mid-match hero swap)
 */
export async function compileFor(renderer: THREE.WebGLRenderer, root: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene, target?: THREE.WebGLRenderTarget | null) {
  try {
    const r = renderer as THREE.WebGLRenderer & { compileAsync?: (s: THREE.Object3D, c: THREE.Camera, t?: THREE.Scene | null) => Promise<unknown> };
    const prev = renderer.getRenderTarget();
    if (target !== undefined) renderer.setRenderTarget(target);
    let ready: Promise<unknown> | null = null;
    try {
      if (r.compileAsync) ready = r.compileAsync(root, camera, root === scene ? null : scene);
      else renderer.compile(root, camera, root === scene ? null : scene);
    } finally { if (target !== undefined) renderer.setRenderTarget(prev); }
    await ready;
  } catch { /* compiled on first draw instead */ }
}

/** upload + compile one object that arrives mid-match (hidden until done, so it never pops in half-ready) */
export async function warmObject(renderer: THREE.WebGLRenderer, obj: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene, target?: THREE.WebGLRenderTarget | null) {
  await uploadTextures(renderer, texturesOf(obj));
  await compileFor(renderer, obj, camera, scene, target);
}

// ---------------------------------------------------------------- 4. effects
/** one of every combat effect the Fx system draws, for the shader warm-up (spawned out of sight, then expired) */
export const FX_KINDS = ['hit', 'impact', 'healhit', 'burst', 'tracer', 'slash', 'swing', 'hammer', 'shatter', 'lightning', 'parry', 'deflect', 'susanoocast', 'skybolt', 'susanooslash', 'susanoofade', 'effigyfade', 'decoy',
  'undying', 'death', 'dust', 'step', 'doublejump', 'pad', 'spawn', 'barrierhit', 'barrierbreak', 'ultflash', 'sunburst', 'nova', 'slam',
  'implode', 'link', 'strings', 'chainline', 'wish', 'voidshield', 'papers', 'smoke', 'flash', 'chargetrail', 'lance', 'soundcone', 'cut',
  'arrowhit', 'immune', 'zonebreak', 'singularity', 'swoop', 'swoopburst', 'healthpack', 'wound', 'warcall', 'reaping', 'crossmix', 'amp',
  'twinkoi', 'dragoncoil', 'dragoncut'];

// ---------------------------------------------------------------- progress on the loading screen
/** a progress bar under the loading screen's title: phase label + overall fraction */
export function showProgress(label: string, frac: number) {
  const host = document.querySelector('.loading') as HTMLElement | null;
  if (!host) return;
  let bar = host.querySelector('.preload') as HTMLElement | null;
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'preload';
    bar.style.cssText = 'position:relative;z-index:2;width:min(520px,80vw);margin:18px auto 0;font:600 12px/1.4 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#cfe8ff;text-align:center';
    bar.innerHTML = '<div style="height:6px;border-radius:3px;background:rgba(255,255,255,.14);overflow:hidden"><i style="display:block;height:100%;width:0;background:linear-gradient(90deg,#39d6ff,#ffd23f);transition:width .2s"></i></div><span style="display:block;margin-top:8px"></span>';
    const spin = host.querySelector('.spin');
    if (spin?.parentElement === host) spin.after(bar); else host.appendChild(bar);
  }
  (bar.querySelector('i') as HTMLElement).style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  (bar.querySelector('span') as HTMLElement).textContent = `${label} · ${Math.round(frac * 100)}%`;
}
