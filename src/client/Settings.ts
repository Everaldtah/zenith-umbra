// Player settings, laid out like Overwatch 2's options (VIDEO / SOUND / CONTROLS / GAMEPLAY / ACCESSIBILITY): graphics
// quality presets that fill in every detail setting (and "custom" once you change one), rebindable controls with two
// bindings per action and per-hero overrides, reticle design, sound mix, HUD and accessibility options. Stored in
// localStorage; older saves are upgraded in place.
import type { Quality } from '../render/MapScene';
import { IS_DESKTOP } from '../edition';
export { IS_DESKTOP };

export type Preset = 'low' | 'medium' | 'high' | 'ultra';
export const PRESETS: Record<Preset, Quality & { antialias: boolean; fxCap: number; maxFps: number }> = {
  low: { shadows: 0, pixelRatio: 0.75, particles: 0.3, bloom: false, tex: 'lo', antialias: false, fxCap: 1500, maxFps: 60 },
  medium: { shadows: 1024, pixelRatio: 1, particles: 0.6, bloom: false, tex: 'lo', antialias: true, fxCap: 3000, maxFps: 60 },
  high: { shadows: 2048, pixelRatio: 1, particles: 1, bloom: true, tex: 'hi', antialias: true, fxCap: 5000, maxFps: 144 },
  ultra: { shadows: 4096, pixelRatio: 1.25, particles: 1.3, bloom: true, tex: 'hi', antialias: true, fxCap: 8000, maxFps: 240 },
};

// ------------------------------------------------------------------ controls
export type Action = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch' | 'fire' | 'alt' | 'a1' | 'a2' | 'ult' | 'reload' | 'melee'
  | 'swoop' | 'grind' | 'view' | 'score' | 'swap' | 'perf';
export const ACTIONS: { id: Action; label: string; group: 'MOVEMENT' | 'WEAPONS & ABILITIES' | 'HERO' | 'INTERFACE'; hero?: string }[] = [
  { id: 'forward', label: 'Move Forward', group: 'MOVEMENT' }, { id: 'back', label: 'Move Backward', group: 'MOVEMENT' },
  { id: 'left', label: 'Move Left', group: 'MOVEMENT' }, { id: 'right', label: 'Move Right', group: 'MOVEMENT' },
  { id: 'jump', label: 'Jump / Fly', group: 'MOVEMENT' }, { id: 'crouch', label: 'Crouch / Descend', group: 'MOVEMENT' },
  { id: 'fire', label: 'Primary Fire', group: 'WEAPONS & ABILITIES' }, { id: 'alt', label: 'Secondary Fire', group: 'WEAPONS & ABILITIES' },
  { id: 'a1', label: 'Ability 1', group: 'WEAPONS & ABILITIES' }, { id: 'a2', label: 'Ability 2', group: 'WEAPONS & ABILITIES' },
  { id: 'ult', label: 'Ultimate Ability', group: 'WEAPONS & ABILITIES' }, { id: 'reload', label: 'Reload', group: 'WEAPONS & ABILITIES' },
  { id: 'melee', label: 'Quick Melee', group: 'WEAPONS & ABILITIES' },
  { id: 'swoop', label: 'Starwing Swoop (Mirei)', group: 'HERO', hero: 'mirei' },
  { id: 'grind', label: 'Mag-Grind: hold to wall-ride & climb (Hibiki)', group: 'HERO', hero: 'hibiki' },
  { id: 'view', label: 'Toggle First / Third Person', group: 'INTERFACE' }, { id: 'score', label: 'Scoreboard / Stats', group: 'INTERFACE' },
  { id: 'swap', label: 'Change Hero (Training)', group: 'INTERFACE' }, { id: 'perf', label: 'Cycle Performance Stats', group: 'INTERFACE' },
];
export type Binds = Record<Action, string[]>;
export const DEFAULT_BINDS: Binds = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'], crouch: ['ControlLeft'], fire: ['Mouse0'], alt: ['Mouse2'], a1: ['ShiftLeft', 'ShiftRight'], a2: ['KeyE'],
  ult: ['KeyQ'], reload: ['KeyR'], melee: ['KeyC'], swoop: ['KeyF'], grind: ['Space'], view: ['KeyV'], score: ['Tab'], swap: ['KeyH'], perf: ['F8'],
};
/** per-hero defaults (Overwatch keeps hero-specific control sets): Hibiki rides walls on the left mouse button */
export const HERO_DEFAULT_BINDS: Record<string, Partial<Binds>> = { hibiki: { grind: ['Mouse0'] } };

/** the readable name of an input code */
export function keyName(code: string): string {
  if (!code) return '—';
  const M: Record<string, string> = { Mouse0: 'LEFT MOUSE', Mouse1: 'MIDDLE MOUSE', Mouse2: 'RIGHT MOUSE', Mouse3: 'MOUSE 4', Mouse4: 'MOUSE 5', WheelUp: 'WHEEL UP', WheelDown: 'WHEEL DOWN',
    Space: 'SPACE', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', AltLeft: 'L-ALT', AltRight: 'R-ALT',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Tab: 'TAB', Enter: 'ENTER', Backspace: 'BACKSPACE', CapsLock: 'CAPS LOCK', Backquote: '`' };
  if (M[code]) return M[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6);
  return code.toUpperCase();
}
/** the short label on the ability bar */
export function keyShort(code: string | undefined): string {
  if (!code) return '—';
  const S: Record<string, string> = { Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'M4', Mouse4: 'M5', ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT', ControlLeft: 'CTRL', Space: 'SPACE', WheelUp: 'WHL▲', WheelDown: 'WHL▼' };
  return S[code] ?? keyName(code);
}

// ------------------------------------------------------------------ the settings
export type Level = 'off' | 'low' | 'medium' | 'high' | 'ultra';
export interface VideoSettings {
  displayMode: 'windowed' | 'borderless' | 'fullscreen';
  renderScale: number;            // % of native
  dynamicRes: boolean;            // scale the render resolution to hold the frame-rate target
  fpsCap: number;                 // 0 = display refresh
  quality: Preset | 'custom';
  textures: 'low' | 'medium' | 'high';
  texFilter: 1 | 2 | 4 | 8 | 16;
  fog: 'low' | 'medium' | 'high';
  reflections: Level;             // dynamic reflections (environment lighting on materials)
  shadows: Level;
  model: 'low' | 'medium' | 'high' | 'ultra';
  effects: 'low' | 'medium' | 'high' | 'ultra';
  lighting: 'low' | 'medium' | 'high' | 'ultra';
  aa: 'off' | 'fxaa' | 'msaa' | 'msaa+fxaa';
  refraction: 'low' | 'medium' | 'high';
  ao: 'off' | 'low' | 'medium' | 'high';
  localReflections: boolean;
  bloom: boolean;
  damageFx: 'low' | 'default' | 'high';
  sharpen: number;                // 0..100
  gamma: number; contrast: number; brightness: number;
  perfStats: 'off' | 'simple' | 'advanced';
}
export interface SoundSettings {
  master: number; sfx: number; music: number; voice: number; announcer: number; ambience: number; ui: number; hitmarker: number;
  mix: 'default' | 'headphones' | 'speakers' | 'night';
  menuMusic: boolean;
  background: boolean;            // keep playing when the window loses focus
  latency: 'interactive' | 'balanced' | 'playback';
}
export interface Reticle {
  type: 'default' | 'circle' | 'crosshairs' | 'circle+crosshairs' | 'dot';
  color: string; thickness: number; length: number; gap: number; opacity: number; outline: number; dot: number; dotOpacity: number; accuracy: boolean;
}
export interface ControlSettings {
  binds: Binds;
  heroBinds: Record<string, Partial<Binds>>;
  heroSens: Record<string, number>;
  invertY: boolean;
  zoomSens: number;               // relative aim sensitivity while zoomed (Yuzu's Hawk Eye)
  /** Tenkai-Oh (after Reinhardt): hold primary fire with the Solar Bulwark up to pan the third-person camera freely */
  barrierFreeLook: boolean;
  /** ...and whether movement follows the free-look camera (off: it follows the shield's facing) */
  freeLookRelative: boolean;
  reticle: Reticle;
}
export interface GameplaySettings {
  damageNumbers: boolean; killFeed: boolean; hints: boolean; enemyBars: boolean; allyBars: boolean; nameTags: boolean;
  hitmarkers: boolean; waypointOpacity: number; hudScale: number; hudOpacity: number; counterCallouts: boolean;
}
export interface AccessSettings {
  subtitles: 'none' | 'critical' | 'conversations' | 'all';
  subSize: number; subBg: number;
  colorblind: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia'; cbStrength: number;
  enemyColor: string; allyColor: string;
  cameraShake: number; hudShake: number; flashReduction: boolean;
}
export interface Settings {
  preset: Preset; sens: number; volume: number; fov: number; view: 'third' | 'first'; difficulty: number; showFps: boolean;
  video: VideoSettings; sound: SoundSettings; controls: ControlSettings; gameplay: GameplaySettings; access: AccessSettings;
}

/** what each graphics preset sets every detail option to */
export const QUALITY_TABLE: Record<Preset, Pick<VideoSettings, 'textures' | 'texFilter' | 'fog' | 'reflections' | 'shadows' | 'model' | 'effects' | 'lighting' | 'aa' | 'refraction' | 'ao' | 'localReflections' | 'bloom' | 'renderScale'>> = {
  low: { textures: 'low', texFilter: 1, fog: 'low', reflections: 'off', shadows: 'off', model: 'low', effects: 'low', lighting: 'low', aa: 'off', refraction: 'low', ao: 'off', localReflections: false, bloom: false, renderScale: 75 },
  medium: { textures: 'medium', texFilter: 4, fog: 'medium', reflections: 'low', shadows: 'low', model: 'medium', effects: 'medium', lighting: 'medium', aa: 'fxaa', refraction: 'medium', ao: 'off', localReflections: false, bloom: false, renderScale: 100 },
  high: { textures: 'high', texFilter: 8, fog: 'high', reflections: 'medium', shadows: 'medium', model: 'high', effects: 'high', lighting: 'high', aa: 'msaa', refraction: 'high', ao: 'low', localReflections: true, bloom: true, renderScale: 100 },
  ultra: { textures: 'high', texFilter: 16, fog: 'high', reflections: 'ultra', shadows: 'ultra', model: 'ultra', effects: 'ultra', lighting: 'ultra', aa: 'msaa+fxaa', refraction: 'high', ao: 'medium', localReflections: true, bloom: true, renderScale: 125 },
};

function detect(): Preset {
  if (IS_DESKTOP) return 'ultra';
  try {
    const c = document.createElement('canvas').getContext('webgl2');
    const ext = c?.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? String(c!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/RTX|RX 6|RX 7|RX 9|Arc A|Radeon Pro|Apple M[2-9]/i.test(r)) return 'high';
    if (/Intel|UHD|Iris|Mali|Adreno|SwiftShader|llvmpipe/i.test(r)) return 'low';
  } catch { /* fall through */ }
  return 'medium';
}

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
export function defaultSettings(preset: Preset = typeof document === 'undefined' ? 'high' : detect()): Settings {
  return {
    preset, sens: 1, volume: 0.7, fov: 90, view: 'third', difficulty: 0.65, showFps: true,
    video: { displayMode: IS_DESKTOP ? 'borderless' : 'windowed', dynamicRes: false, fpsCap: 0, quality: preset, ...QUALITY_TABLE[preset],
      damageFx: 'default', sharpen: 0, gamma: 1, contrast: 1, brightness: 1, perfStats: 'simple' },
    sound: { master: 0.7, sfx: 1, music: 0.6, voice: 1, announcer: 1, ambience: 0.8, ui: 0.8, hitmarker: 1, mix: 'default', menuMusic: true, background: false, latency: 'interactive' },
    controls: { binds: clone(DEFAULT_BINDS), heroBinds: clone(HERO_DEFAULT_BINDS), heroSens: {}, invertY: false, zoomSens: 1, barrierFreeLook: true, freeLookRelative: false,
      reticle: { type: 'default', color: '#ffffff', thickness: 2, length: 7, gap: 5, opacity: 1, outline: 0.6, dot: 3, dotOpacity: 1, accuracy: false } },
    gameplay: { damageNumbers: true, killFeed: true, hints: true, enemyBars: true, allyBars: true, nameTags: true, hitmarkers: true, waypointOpacity: 1, hudScale: 1, hudOpacity: 1, counterCallouts: true },
    access: { subtitles: 'critical', subSize: 1, subBg: 0.5, colorblind: 'none', cbStrength: 1, enemyColor: '#ff3b5c', allyColor: '#5cc8ff', cameraShake: 1, hudShake: 1, flashReduction: false },
  };
}

/** apply a graphics preset to every detail option */
export function applyPreset(s: Settings, p: Preset) { s.preset = p; s.video.quality = p; Object.assign(s.video, QUALITY_TABLE[p]); }

/** the renderer-facing quality with the detail options resolved */
export function quality(s: Settings) {
  const v = s.video, base = PRESETS[s.preset];
  const fx = { low: 0.35, medium: 0.65, high: 1, ultra: 1.3 }[v.effects];
  return {
    ...base, shadows: { off: 0, low: 1024, medium: 2048, high: 2048, ultra: 4096 }[v.shadows], pixelRatio: v.renderScale / 100, particles: fx,
    bloom: v.bloom, tex: (v.textures === 'low' ? 'lo' : 'hi') as 'lo' | 'hi',
    antialias: v.aa === 'msaa' || v.aa === 'msaa+fxaa', fxaa: v.aa === 'fxaa' || v.aa === 'msaa+fxaa', fxCap: Math.round(8000 * fx / 1.3),
    maxFps: v.fpsCap || 1000, anisotropy: v.texFilter, softShadows: v.lighting === 'high' || v.lighting === 'ultra',
    envIntensity: { off: 0.25, low: 0.4, medium: 0.55, high: 0.65, ultra: 0.75 }[v.reflections],
  };
}

/** the binding a hero actually uses for an action (their override, else the global one) */
export function bindsFor(s: Settings, hero: string | null | undefined, a: Action): string[] {
  const h = hero ? s.controls.heroBinds[hero]?.[a] : undefined;
  return h ?? s.controls.binds[a] ?? [];
}

// deep-merge a saved object over the defaults (new options appear with their defaults)
function merge<T>(def: T, saved: any): T {
  if (saved === undefined || saved === null) return def;
  if (typeof def !== 'object' || def === null || Array.isArray(def)) return (Array.isArray(def) ? Array.isArray(saved) : typeof saved === typeof def) ? saved : def;
  const out: any = { ...def };
  for (const k of Object.keys(saved)) out[k] = k in (def as any) ? merge((def as any)[k], saved[k]) : saved[k];
  return out;
}

const KEY = 'zu-settings-v1';
export function loadSettings(): Settings {
  let s: any = {};
  try { s = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { /* private mode */ }
  const out = merge(defaultSettings(s.preset ?? detect()), s);
  // saves from before the options overhaul: carry the old master volume over
  if (s.volume !== undefined && !s.sound) out.sound.master = s.volume;
  // a new hero's own defaults join older saves without touching what the player set
  for (const [h, b] of Object.entries(HERO_DEFAULT_BINDS)) out.controls.heroBinds[h] = { ...b, ...(out.controls.heroBinds[h] ?? {}) };
  return out;
}
export function saveSettings(s: Settings) { s.volume = s.sound.master; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }
