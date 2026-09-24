// Quality presets. The web build auto-detects; the desktop build (Electron, ?platform=desktop) defaults to Ultra on the local GPU.
import type { Quality } from '../render/MapScene';

export type Preset = 'low' | 'medium' | 'high' | 'ultra';
export const PRESETS: Record<Preset, Quality & { antialias: boolean; fxCap: number; maxFps: number }> = {
  low: { shadows: 0, pixelRatio: 0.75, particles: 0.3, bloom: false, tex: 'lo', antialias: false, fxCap: 1500, maxFps: 60 },
  medium: { shadows: 1024, pixelRatio: 1, particles: 0.6, bloom: false, tex: 'lo', antialias: true, fxCap: 3000, maxFps: 60 },
  high: { shadows: 2048, pixelRatio: 1, particles: 1, bloom: true, tex: 'hi', antialias: true, fxCap: 5000, maxFps: 144 },
  ultra: { shadows: 4096, pixelRatio: 1.25, particles: 1.3, bloom: true, tex: 'hi', antialias: true, fxCap: 8000, maxFps: 240 },
};

export interface Settings { preset: Preset; sens: number; volume: number; fov: number; view: 'third' | 'first'; difficulty: number; showFps: boolean; }

export const IS_DESKTOP = new URLSearchParams(location.search).get('platform') === 'desktop' || navigator.userAgent.includes('Electron');

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

const KEY = 'zu-settings-v1';
export function loadSettings(): Settings {
  let s: Partial<Settings> = {};
  try { s = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { /* private mode */ }
  return { preset: s.preset ?? detect(), sens: s.sens ?? 1, volume: s.volume ?? 0.7, fov: s.fov ?? 90, view: s.view ?? 'third', difficulty: s.difficulty ?? 0.65, showFps: s.showFps ?? true };
}
export function saveSettings(s: Settings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }
