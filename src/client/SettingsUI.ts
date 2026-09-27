// The Options screen, laid out after Overwatch 2's: VIDEO / SOUND / CONTROLS / GAMEPLAY / ACCESSIBILITY tabs, every
// change applied live and saved at once, a per-tab RESTORE DEFAULTS. CONTROLS rebinds any action to any key, mouse
// button or wheel notch (two bindings per action, like Overwatch), globally or per hero (a hero's own overrides and aim
// sensitivity), and has the reticle designer with a live preview.
import {
  ACTIONS, DEFAULT_BINDS, HERO_DEFAULT_BINDS, QUALITY_TABLE, applyPreset, bindsFor, defaultSettings, keyName, saveSettings,
  type Action, type Preset, type Settings,
} from './Settings';
import { HEROES, rosterFor } from '../data/heroes';
import { FULL } from '../edition';

type Tab = 'video' | 'sound' | 'controls' | 'gameplay' | 'access';
const TABS: [Tab, string][] = [['video', 'VIDEO'], ['sound', 'SOUND'], ['controls', 'CONTROLS'], ['gameplay', 'GAMEPLAY'], ['access', 'ACCESSIBILITY']];

export interface SettingsHost {
  settings: Settings;
  applySettings(s: Settings): void;
  /** the Input's capture hook: the next key / button / wheel notch goes to it */
  captureInput(fn: ((code: string) => void) | null): void;
}

type Opt<T> = [T, string];
const onOff: Opt<boolean>[] = [[true, 'ON'], [false, 'OFF']];

export class SettingsScreen {
  private tab: Tab = 'video';
  private hero = '';                    // controls scope: '' = all heroes
  private listening: { action: Action; slot: number } | null = null;
  private el!: HTMLElement;

  constructor(private root: HTMLElement, private host: SettingsHost, private back: () => void) {}

  get s() { return this.host.settings; }

  open(tab: Tab = this.tab) {
    this.tab = tab;
    this.el = document.createElement('div');
    this.el.className = 'opts';
    this.root.innerHTML = '';
    this.root.append(this.el);
    this.render();
  }

  private commit(rerender = false) {
    saveSettings(this.s);
    this.host.applySettings(this.s);
    if (rerender) this.render();
  }

  // ------------------------------------------------------------------ rows
  private rows: string[] = [];
  private handlers: ((root: HTMLElement) => void)[] = [];
  private uid = 0;
  private head(t: string) { this.rows.push(`<h4>${t}</h4>`); }
  private note(t: string) { this.rows.push(`<p class="note">${t}</p>`); }

  private select<T extends string | number | boolean>(label: string, get: () => T, set: (v: T) => void, opts: Opt<T>[], desc = '', rerender = false) {
    const id = `o${this.uid++}`, cur = get();
    this.rows.push(`<div class="orow" title="${desc.replace(/"/g, '&quot;')}"><span>${label}</span><div class="sel" id="${id}">
      <button class="l">◀</button><b>${opts.find(o => o[0] === cur)?.[1] ?? String(cur)}</b><button class="r">▶</button></div></div>`);
    this.handlers.push(root => {
      const box = root.querySelector('#' + id)!, b = box.querySelector('b')!;
      const step = (d: number) => {
        const i = Math.max(0, opts.findIndex(o => o[0] === get()));
        const n = opts[(i + d + opts.length) % opts.length];
        set(n[0]); b.textContent = n[1]; this.commit(rerender);
      };
      (box.querySelector('.l') as HTMLElement).onclick = () => step(-1);
      (box.querySelector('.r') as HTMLElement).onclick = () => step(1);
    });
  }

  private slider(label: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number, fmt: (v: number) => string = v => String(v), desc = '') {
    const id = `o${this.uid++}`;
    this.rows.push(`<div class="orow" title="${desc.replace(/"/g, '&quot;')}"><span>${label}</span><div class="sld" id="${id}">
      <input type="range" min="${min}" max="${max}" step="${step}" value="${get()}"><b>${fmt(get())}</b></div></div>`);
    this.handlers.push(root => {
      const box = root.querySelector('#' + id)!, inp = box.querySelector('input') as HTMLInputElement, b = box.querySelector('b')!;
      inp.oninput = () => { set(+inp.value); b.textContent = fmt(+inp.value); this.commit(); this.preview(); };
    });
  }

  private color(label: string, get: () => string, set: (v: string) => void) {
    const id = `o${this.uid++}`;
    this.rows.push(`<div class="orow"><span>${label}</span><div class="clr" id="${id}"><input type="color" value="${get()}"><b>${get().toUpperCase()}</b></div></div>`);
    this.handlers.push(root => {
      const box = root.querySelector('#' + id)!, inp = box.querySelector('input') as HTMLInputElement, b = box.querySelector('b')!;
      inp.oninput = () => { set(inp.value); b.textContent = inp.value.toUpperCase(); this.commit(); this.preview(); };
    });
  }

  private bindRow(a: typeof ACTIONS[number]) {
    const C = this.s.controls, scoped = !!this.hero;
    const own = scoped ? C.heroBinds[this.hero]?.[a.id] : undefined;
    const b = bindsFor(this.s, this.hero || null, a.id);
    const inherited = scoped && !own;
    const cell = (slot: number) => {
      const on = this.listening?.action === a.id && this.listening.slot === slot;
      return `<button class="key${on ? ' listen' : ''}${inherited ? ' inh' : ''}" data-a="${a.id}" data-s="${slot}">${on ? 'PRESS A KEY…' : keyName(b[slot] ?? '')}</button>`;
    };
    this.rows.push(`<div class="orow bind"><span>${a.label}</span><div class="keys">${cell(0)}${cell(1)}${scoped && own ? `<button class="clr-ov" data-a="${a.id}" title="Use the global binding">↺</button>` : ''}</div></div>`);
  }

  // ------------------------------------------------------------------ tabs
  private video() {
    const v = this.s.video, s = this.s;
    const custom = () => { v.quality = 'custom'; };
    const lv = <T extends string>(o: T[]): Opt<T>[] => o.map(x => [x, x.toUpperCase()]);
    this.head('DISPLAY');
    this.select('Display Mode', () => v.displayMode, x => { v.displayMode = x; }, [['fullscreen', 'FULLSCREEN'], ['borderless', 'BORDERLESS WINDOWED'], ['windowed', 'WINDOWED']]);
    this.slider('Field of View', () => s.fov, x => { s.fov = x; }, 70, 110, 1, x => `${x}`);
    this.select('Camera', () => s.view, x => { s.view = x; }, [['first', 'FIRST PERSON'], ['third', 'THIRD PERSON']], 'Quick play and competitive are first person (as in Overwatch 2); V toggles where allowed.');
    this.select('Frame Rate Cap', () => v.fpsCap, x => { v.fpsCap = x; }, [[0, 'DISPLAY BASED'], [30, '30'], [60, '60'], [120, '120'], [144, '144'], [165, '165'], [240, '240'], [300, '300']]);
    this.slider('Render Scale', () => v.renderScale, x => { v.renderScale = x; custom(); }, 50, 200, 5, x => `${x}%`);
    this.select('Dynamic Render Scale', () => v.dynamicRes, x => { v.dynamicRes = x; }, onOff, 'Lowers the render scale on busy frames to hold the frame-rate target.');
    this.slider('Brightness', () => v.brightness, x => { v.brightness = x; }, 0.5, 1.5, 0.01, x => x.toFixed(2));
    this.slider('Contrast', () => v.contrast, x => { v.contrast = x; }, 0.5, 1.5, 0.01, x => x.toFixed(2));
    this.slider('Gamma', () => v.gamma, x => { v.gamma = x; }, 0.5, 1.5, 0.01, x => x.toFixed(2));
    this.slider('Image Sharpening', () => v.sharpen, x => { v.sharpen = x; }, 0, 100, 1, x => `${x}`);
    this.head('GRAPHICS QUALITY');
    this.select<Preset | 'custom'>('Graphics Quality', () => v.quality, x => { if (x !== 'custom') applyPreset(s, x); }, [['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['ultra', 'ULTRA'], ['custom', 'CUSTOM']], 'Sets every detail option below; changing any of them makes it CUSTOM.', true);
    this.select('Texture Quality', () => v.textures, x => { v.textures = x; custom(); }, lv(['low', 'medium', 'high']), 'Applies to the next map loaded.');
    this.select('Texture Filtering Quality', () => v.texFilter, x => { v.texFilter = x; custom(); }, [[1, 'LOW - 1X'], [2, 'MEDIUM - 2X'], [4, 'HIGH - 4X'], [8, 'HIGH - 8X'], [16, 'EPIC - 16X']]);
    this.select('Fog Detail', () => v.fog, x => { v.fog = x; custom(); }, lv(['low', 'medium', 'high']));
    this.select('Dynamic Reflections', () => v.reflections, x => { v.reflections = x; custom(); }, lv(['off', 'low', 'medium', 'high', 'ultra']));
    this.select('Shadow Detail', () => v.shadows, x => { v.shadows = x; custom(); }, lv(['off', 'low', 'medium', 'high', 'ultra']));
    this.select('Effects Detail', () => v.effects, x => { v.effects = x; custom(); }, lv(['low', 'medium', 'high', 'ultra']), 'Particle counts for weapons, abilities and impacts.');
    this.select('Lighting Quality', () => v.lighting, x => { v.lighting = x; custom(); }, lv(['low', 'medium', 'high', 'ultra']), 'Soft shadow filtering and light count.');
    this.select('Antialias Quality', () => v.aa, x => { v.aa = x; custom(); }, [['off', 'OFF'], ['fxaa', 'LOW - FXAA'], ['msaa', 'MEDIUM - MSAA'], ['msaa+fxaa', 'HIGH - MSAA + FXAA']], 'MSAA changes take effect after a restart.');
    this.select('Refraction / Glow Quality', () => v.refraction, x => { v.refraction = x; custom(); }, lv(['low', 'medium', 'high']), 'Resolution of glow, energy and shield effects.');
    this.select('Ambient Occlusion', () => v.ao, x => { v.ao = x; custom(); }, lv(['off', 'low', 'medium', 'high']));
    this.select('Local Reflections', () => v.localReflections, x => { v.localReflections = x; custom(); }, onOff);
    this.select('Bloom', () => v.bloom, x => { v.bloom = x; custom(); }, onOff);
    this.select('Damage FX', () => v.damageFx, x => { v.damageFx = x; }, [['low', 'LOW'], ['default', 'DEFAULT'], ['high', 'HIGH']], 'How much impact sparks and damage effects fill the screen.');
    this.head('PERFORMANCE');
    this.select('Performance Stats', () => v.perfStats, x => { v.perfStats = x; }, [['off', 'OFF'], ['simple', 'SIMPLE'], ['advanced', 'ADVANCED']], 'F8 cycles it in game.');
  }

  private sound() {
    const o = this.s.sound;
    const pct = (x: number) => `${Math.round(x * 100)}`;
    this.head('VOLUME');
    this.slider('Master Volume', () => o.master, x => { o.master = x; }, 0, 1, 0.01, pct);
    this.slider('Sound Effects Volume', () => o.sfx, x => { o.sfx = x; }, 0, 1, 0.01, pct);
    this.slider('Music Volume', () => o.music, x => { o.music = x; }, 0, 1, 0.01, pct);
    this.slider('Voice Volume', () => o.voice, x => { o.voice = x; }, 0, 1, 0.01, pct);
    this.slider('Announcer Volume', () => o.announcer, x => { o.announcer = x; }, 0, 1, 0.01, pct);
    this.slider('Ambience Volume', () => o.ambience, x => { o.ambience = x; }, 0, 1, 0.01, pct);
    this.slider('Interface Volume', () => o.ui, x => { o.ui = x; }, 0, 1, 0.01, pct);
    this.slider('Hit Marker Volume', () => o.hitmarker, x => { o.hitmarker = x; }, 0, 1, 0.01, pct);
    this.head('MIX');
    this.select('Mix Preset', () => o.mix, x => { o.mix = x; }, [['default', 'DEFAULT'], ['headphones', 'HEADPHONES (3D)'], ['speakers', 'SPEAKERS'], ['night', 'NIGHT MODE']],
      'Headphones: full HRTF 3D positioning. Speakers: plain panning. Night: a narrow dynamic range for low volume.');
    this.select('Play Menu Music', () => o.menuMusic, x => { o.menuMusic = x; }, onOff);
    this.select('Sound in Background', () => o.background, x => { o.background = x; }, onOff, 'Keep playing sound when the game window is not focused.');
    this.select('Audio Latency', () => o.latency, x => { o.latency = x; }, [['interactive', 'LOWEST'], ['balanced', 'BALANCED'], ['playback', 'SMOOTHEST']], 'Smoother trades delay for fewer crackles on busy systems (applies after a restart).');
  }

  private controls() {
    const C = this.s.controls, hero = this.hero;
    const roster = rosterFor(FULL);
    this.rows.push(`<div class="scope"><span>CONTROLS FOR</span><select class="hsel"><option value="">ALL HEROES</option>${roster.map(h => `<option value="${h.id}" ${h.id === hero ? 'selected' : ''}>${h.name.toUpperCase()}</option>`).join('')}</select></div>`);
    this.handlers.push(root => {
      const sel = root.querySelector('.hsel') as HTMLSelectElement;
      sel.onchange = () => { this.hero = sel.value; this.listening = null; this.render(); };
    });
    if (hero) this.note(`Bindings you set here apply only to ${HEROES.find(h => h.id === hero)?.name}. Dimmed keys follow the ALL HEROES set; ↺ returns an action to it.`);
    this.head('MOUSE');
    this.slider('Sensitivity', () => this.s.sens, x => { this.s.sens = x; }, 0.1, 5, 0.01, x => (x * 15).toFixed(1), 'Overwatch-style scale (15 = default).');
    if (hero) this.slider(`Sensitivity - ${HEROES.find(h => h.id === hero)?.name}`, () => (C.heroSens[hero] ?? 1) * 100, x => { if (x === 100) delete C.heroSens[hero]; else C.heroSens[hero] = x / 100; }, 25, 200, 1, x => `${x}%`, 'Relative to your global sensitivity.');
    this.select('Invert Vertical Look', () => C.invertY, x => { C.invertY = x; }, onOff);
    this.slider('Relative Aim Sensitivity While Zoomed', () => C.zoomSens * 100, x => { C.zoomSens = x / 100; }, 25, 150, 1, x => `${x}%`);
    const groups = ['MOVEMENT', 'WEAPONS & ABILITIES', 'HERO', 'INTERFACE'] as const;
    for (const g of groups) {
      const list = ACTIONS.filter(a => a.group === g && (!a.hero || !hero || a.hero === hero));
      if (!list.length) continue;
      this.head(g);
      for (const a of list) this.bindRow(a);
    }
    if (!hero || hero === 'tenkai') {
      this.head('TENKAI-OH');
      this.select('Barrier Free Look (hold Primary Fire)', () => C.barrierFreeLook, x => { C.barrierFreeLook = x; }, onOff, 'With the Solar Bulwark up, hold primary fire to look around while the shield keeps its facing.');
      this.select('Movement Relative to Camera During Free Look', () => C.freeLookRelative, x => { C.freeLookRelative = x; }, onOff);
    }
    this.head('RETICLE');
    const R = C.reticle;
    this.select('Type', () => R.type, x => { R.type = x; }, [['default', 'DEFAULT (PER HERO)'], ['circle', 'CIRCLE'], ['crosshairs', 'CROSSHAIRS'], ['circle+crosshairs', 'CIRCLE AND CROSSHAIRS'], ['dot', 'DOT']], '', true);
    this.select('Show Accuracy', () => R.accuracy, x => { R.accuracy = x; }, onOff);
    this.color('Color', () => R.color, x => { R.color = x; });
    this.slider('Thickness', () => R.thickness, x => { R.thickness = x; }, 1, 15, 1);
    this.slider('Crosshair Length', () => R.length, x => { R.length = x; }, 1, 100, 1);
    this.slider('Center Gap', () => R.gap, x => { R.gap = x; }, 0, 100, 1);
    this.slider('Opacity', () => R.opacity * 100, x => { R.opacity = x / 100; }, 0, 100, 1, x => `${x}%`);
    this.slider('Outline Opacity', () => R.outline * 100, x => { R.outline = x / 100; }, 0, 100, 1, x => `${x}%`);
    this.slider('Dot Size', () => R.dot, x => { R.dot = x; }, 0, 30, 1);
    this.slider('Dot Opacity', () => R.dotOpacity * 100, x => { R.dotOpacity = x / 100; }, 0, 100, 1, x => `${x}%`);
  }

  private gameplay() {
    const g = this.s.gameplay, s = this.s;
    this.head('GENERAL');
    this.select('AI Difficulty (Practice)', () => s.difficulty, x => { s.difficulty = x; }, [[0.35, 'EASY'], [0.65, 'MEDIUM'], [0.9, 'HARD']]);
    this.select('Show Hints', () => g.hints, x => { g.hints = x; }, onOff);
    this.select('Counter Callouts', () => g.counterCallouts, x => { g.counterCallouts = x; }, onOff, 'The COUNTER banner when a hero counters their rival.');
    this.head('HUD');
    this.slider('HUD Scale', () => g.hudScale * 100, x => { g.hudScale = x / 100; }, 70, 130, 1, x => `${x}%`);
    this.slider('HUD Opacity', () => g.hudOpacity * 100, x => { g.hudOpacity = x / 100; }, 30, 100, 1, x => `${x}%`);
    this.select('Kill Feed', () => g.killFeed, x => { g.killFeed = x; }, onOff);
    this.select('Damage Numbers', () => g.damageNumbers, x => { g.damageNumbers = x; }, onOff);
    this.select('Hit Marker', () => g.hitmarkers, x => { g.hitmarkers = x; }, onOff);
    this.slider('Objective Waypoint Opacity', () => g.waypointOpacity * 100, x => { g.waypointOpacity = x / 100; }, 0, 100, 1, x => `${x}%`);
    this.head('HEALTH BARS');
    this.select('Enemy Health Bars', () => g.enemyBars, x => { g.enemyBars = x; }, onOff);
    this.select('Friendly Health Bars', () => g.allyBars, x => { g.allyBars = x; }, onOff);
    this.select('Name Tags', () => g.nameTags, x => { g.nameTags = x; }, onOff);
  }

  private access() {
    const a = this.s.access;
    this.head('SUBTITLES');
    this.select('Subtitles', () => a.subtitles, x => { a.subtitles = x; }, [['none', 'OFF'], ['critical', 'CRITICAL (ULTIMATES)'], ['conversations', 'CONVERSATIONS'], ['all', 'ALL VOICE LINES']]);
    this.slider('Subtitle Size', () => a.subSize * 100, x => { a.subSize = x / 100; }, 70, 180, 5, x => `${x}%`);
    this.slider('Subtitle Background Opacity', () => a.subBg * 100, x => { a.subBg = x / 100; }, 0, 100, 1, x => `${x}%`);
    this.head('COLOR');
    this.select('Color Blind Options Filter', () => a.colorblind, x => { a.colorblind = x; }, [['none', 'OFF'], ['protanopia', 'PROTANOPIA'], ['deuteranopia', 'DEUTERANOPIA'], ['tritanopia', 'TRITANOPIA']]);
    this.slider('Filter Strength', () => a.cbStrength * 100, x => { a.cbStrength = x / 100; }, 0, 100, 1, x => `${x}%`);
    this.color('Enemy UI Color', () => a.enemyColor, x => { a.enemyColor = x; });
    this.color('Friendly UI Color', () => a.allyColor, x => { a.allyColor = x; });
    this.head('MOTION & FLASH');
    this.slider('Camera Shake', () => a.cameraShake * 100, x => { a.cameraShake = x / 100; }, 0, 100, 1, x => `${x}%`);
    this.slider('Screen Shake (HUD)', () => a.hudShake * 100, x => { a.hudShake = x / 100; }, 0, 100, 1, x => `${x}%`);
    this.select('Reduce Flashing', () => a.flashReduction, x => { a.flashReduction = x; }, onOff, 'Softens muzzle flashes, ultimate flashes and explosion lights.');
  }

  // ------------------------------------------------------------------ frame
  private render() {
    this.rows = []; this.handlers = []; this.uid = 0;
    ({ video: () => this.video(), sound: () => this.sound(), controls: () => this.controls(), gameplay: () => this.gameplay(), access: () => this.access() })[this.tab]();
    this.el.innerHTML = `<header><h2>OPTIONS</h2><nav>${TABS.map(([k, n]) => `<button class="tab${k === this.tab ? ' on' : ''}" data-t="${k}">${n}</button>`).join('')}</nav></header>
      <main><section class="list">${this.rows.join('')}</section>
      <aside>${this.tab === 'controls' ? '<h4>RETICLE PREVIEW</h4><div class="rprev"><canvas width="240" height="240"></canvas></div><p class="note">Click a key box, then press any key, mouse button or wheel notch. ESC cancels, BACKSPACE clears. A key already used by another action moves to this one.</p>' : `<p class="note">${ASIDE[this.tab]}</p>`}</aside></main>
      <footer><button class="rst">RESTORE DEFAULTS</button><button class="primary done">BACK</button></footer>`;
    for (const h of this.handlers) h(this.el);
    this.el.querySelectorAll<HTMLElement>('.tab').forEach(b => b.onclick = () => { this.tab = b.dataset.t as Tab; this.listening = null; this.host.captureInput(null); this.render(); });
    (this.el.querySelector('.done') as HTMLElement).onclick = () => { this.host.captureInput(null); this.commit(); this.back(); };
    (this.el.querySelector('.rst') as HTMLElement).onclick = () => this.restore();
    this.el.querySelectorAll<HTMLElement>('.key').forEach(b => b.onclick = e => { e.stopPropagation(); this.listen(b.dataset.a as Action, +b.dataset.s!); });
    this.el.querySelectorAll<HTMLElement>('.clr-ov').forEach(b => b.onclick = () => {
      const o = this.s.controls.heroBinds[this.hero]; if (o) delete o[b.dataset.a as Action];
      this.commit(true);
    });
    this.preview();
  }

  private listen(action: Action, slot: number) {
    this.listening = { action, slot };
    this.render();
    // the click that started listening must not be taken as the binding itself
    setTimeout(() => this.host.captureInput(code => this.bound(code)), 0);
  }

  private bound(code: string) {
    const L = this.listening; this.listening = null;
    if (!L || code === 'Escape') { this.render(); return; }
    const C = this.s.controls, hero = this.hero;
    const get = (a: Action) => [...bindsFor(this.s, hero || null, a)];
    const put = (a: Action, v: string[]) => { if (hero) (C.heroBinds[hero] ??= {})[a] = v; else C.binds[a] = v; };
    const cur = get(L.action);
    if (code === 'Backspace' || code === 'Delete') cur.splice(L.slot, 1);
    else {
      // a key belongs to one action at a time in a scope (as in Overwatch): take it off any other action
      for (const a of ACTIONS) if (a.id !== L.action && (!a.hero || !hero || a.hero === hero)) {
        const other = get(a.id);
        if (other.includes(code) && !(a.hero && !hero)) put(a.id, other.filter(c => c !== code));
      }
      if (cur.includes(code)) cur.splice(cur.indexOf(code), 1);
      cur[Math.min(L.slot, cur.length)] = code;
    }
    put(L.action, cur.filter(Boolean).slice(0, 2));
    this.commit(true);
  }

  private restore() {
    const d = defaultSettings(this.s.preset), s = this.s;
    if (this.tab === 'video') { s.video = d.video; applyPreset(s, s.preset); s.fov = d.fov; }
    if (this.tab === 'sound') s.sound = d.sound;
    if (this.tab === 'controls') {
      if (this.hero) { delete s.controls.heroBinds[this.hero]; if (HERO_DEFAULT_BINDS[this.hero]) s.controls.heroBinds[this.hero] = JSON.parse(JSON.stringify(HERO_DEFAULT_BINDS[this.hero])); delete s.controls.heroSens[this.hero]; }
      else { s.controls = d.controls; s.sens = d.sens; }
    }
    if (this.tab === 'gameplay') { s.gameplay = d.gameplay; s.difficulty = d.difficulty; }
    if (this.tab === 'access') s.access = d.access;
    void QUALITY_TABLE; void DEFAULT_BINDS;
    this.commit(true);
  }

  /** reticle preview on the controls tab */
  private preview() {
    const c = this.el?.querySelector('.rprev canvas') as HTMLCanvasElement | null;
    if (!c) return;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#39445c'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#5a6a8a'; g.fillRect(0, c.height * 0.62, c.width, c.height * 0.38);
    drawReticle(g, c.width / 2, c.height / 2, this.s.controls.reticle, 2);
  }
}

const ASIDE: Record<string, string> = {
  video: 'Graphics Quality fills in every detail option below it. Render scale and dynamic render scale trade sharpness for frame rate; performance stats (F8) show what the GPU is doing.',
  sound: 'Every volume has its own mix bus. The mix preset changes how sounds are placed around you: HEADPHONES renders true 3D (HRTF), SPEAKERS pans them, NIGHT MODE squeezes the loud and the quiet together.',
  gameplay: 'HUD options apply to every mode. Counter callouts show when a hero lands their rival counter.',
  access: 'Subtitles show hero and announcer voice lines. The color blind filter corrects the whole picture; the UI colors recolor enemy and friendly markers.',
};

/** draw an Overwatch-style custom reticle (canvas 2D); `k` scales the pixel sizes for previews */
export function drawReticle(g: CanvasRenderingContext2D, x: number, y: number, R: Settings['controls']['reticle'], k = 1) {
  const t = R.thickness * k, len = R.length * k, gap = R.gap * k, col = R.color;
  const bar = (x0: number, y0: number, w: number, h: number) => {
    if (R.outline > 0) { g.fillStyle = `rgba(0,0,0,${R.outline * R.opacity})`; g.fillRect(x0 - 1, y0 - 1, w + 2, h + 2); }
    g.globalAlpha = R.opacity; g.fillStyle = col; g.fillRect(x0, y0, w, h); g.globalAlpha = 1;
  };
  if (R.type === 'crosshairs' || R.type === 'circle+crosshairs' || R.type === 'default') {
    bar(x - t / 2, y - gap - len, t, len); bar(x - t / 2, y + gap, t, len);
    bar(x - gap - len, y - t / 2, len, t); bar(x + gap, y - t / 2, len, t);
  }
  if (R.type === 'circle' || R.type === 'circle+crosshairs') {
    const r = Math.max(4 * k, gap + (R.type === 'circle' ? len * 0.6 : 0));
    g.lineWidth = t;
    if (R.outline > 0) { g.strokeStyle = `rgba(0,0,0,${R.outline * R.opacity})`; g.lineWidth = t + 2; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); g.lineWidth = t; }
    g.globalAlpha = R.opacity; g.strokeStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
  }
  if (R.dot > 0) {
    const d = R.dot * k * 0.5;
    if (R.outline > 0) { g.fillStyle = `rgba(0,0,0,${R.outline * R.dotOpacity})`; g.beginPath(); g.arc(x, y, d + 1, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = R.dotOpacity; g.fillStyle = col; g.beginPath(); g.arc(x, y, d, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  }
}
