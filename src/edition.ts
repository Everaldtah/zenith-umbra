// One codebase, two editions.
//  - FULL (the Windows app): every hero (Gantetsu included), the rebuilt arenas with interiors and health packs plus the
//    new maps, Quick Play / Competitive / AI Quick Match with ranks, Mikoshi Rush, the Overwatch-style Tab screen, the
//    animation performance layer (personas, squash & stretch, springs, Mirei's guardian-angel flight and swoop).
//  - LITE (the browser build): a small demo - practice vs AI on the original five arenas with the original ten heroes,
//    procedural animation (no clip-library download) - that points players at the download for the full game.
// Tests and headless tools run FULL; the Vite dev server runs FULL unless the URL says ?edition=lite.
const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
const DEV = !!(import.meta as any).env?.DEV;
// the Windows app is Electron; `?platform=desktop` only counts on the dev server (the website can't be switched to the
// full edition by URL - its desktop-only assets aren't deployed: scripts/lite-strip.mjs)
export const IS_DESKTOP = (typeof navigator !== 'undefined' && /Electron/.test(navigator.userAgent)) || (DEV && q?.get('platform') === 'desktop');
export const FULL: boolean = typeof window === 'undefined' || IS_DESKTOP || (DEV && q?.get('edition') !== 'lite');
export const DOWNLOAD_URL = 'https://github.com/Everaldtah/zenith-umbra/releases/latest/download/ZenithUmbra-Setup.exe';
