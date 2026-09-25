// "The Oath at Dawn - Engine Cut": a real-time anime short rendered by the game engine.
// Clock + audio (recorded lines, score with ducking, the game's synth foley), shot switching, anime overlays, controls.
import './film.css';
import * as THREE from 'three';
import TL from './timeline.json';
import { Stage } from './stage';
import { SHOTS, clearProps, type C, type Ui } from './shots';
import { loadManifest, BASE } from '../render/Assets';
import { sfx } from '../audio/Sfx';

type Line = { file: string; at: number; secs: number; who: string; text: string };
const LINES: Line[] = TL.beats.flatMap(b => b.lines as Line[]);
const TOTAL = TL.total;
const WHO: Record<string, string> = { n: '', haruto: 'HARUTO', vorn: 'VORN', yuzu: 'YUZU', nocturne: 'NOCTURNE', kagemaru: 'KAGEMARU', enra: 'ENRA',
  hex: 'HEX', mirei: 'MIREI', kaien: 'KAIEN', raijin: 'RAIJIN', qelvaris: "QEL'VARIS" };
const CHAPTERS: [number, string][] = [[0, 'The world that sang'], [79.4, 'The Eclipse'], [95.1, 'Nocturne'], [106.2, 'Kagemaru'], [118.2, 'Enra'],
  [141.8, 'Vorn'], [154.4, 'Hex'], [168.9, 'Five who stood up'], [214.3, 'The Night of the Academy'], [238.5, 'Tenkai-Oh vs Gorgoth'],
  [248.5, 'Mirei vs Nocturne'], [255.5, 'Kaien vs Kagemaru'], [262.5, 'Raijin vs Enra'], [269.5, 'Yuzu vs Hex'], [288.5, 'The Oath at Dawn'], [309.6, 'The Star-Forger']];

// ---------------------------------------------------------------- DOM
const root = document.getElementById('film')!;
root.innerHTML = `
  <div class="stagebox"></div>
  <canvas class="speed"></canvas>
  <div class="cockpit"><i></i><i></i><i></i><b>SUN REACTOR <em>SYNC 100%</em></b></div>
  <div class="bars"></div>
  <div class="card"><b></b><span></span></div>
  <div class="titlecard"><h1>ZENITH<i>//</i>UMBRA</h1><p>THE OATH AT DAWN</p><small>a Zenith Vanguard origin · engine cut</small></div>
  <div class="sub"></div>
  <div class="loading"><h2>THE OATH AT DAWN</h2><p>ENGINE CUT</p><div class="lbar"><i></i></div><span>Loading the cast…</span><button class="go" disabled>▶ PLAY</button></div>
  <div class="ctrl"><button class="pp">❚❚</button><div class="seek"><i></i></div><span class="tc">0:00 / 5:26</span><select class="chap">${CHAPTERS.map(([t, n]) => `<option value="${t}">${n}</option>`).join('')}</select><button class="fs">⛶</button></div>`;
const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
const stage = new Stage($('.stagebox'));

// ---------------------------------------------------------------- overlays
const speed = $<HTMLCanvasElement>('.speed'), sctx = speed.getContext('2d')!;
let speedOn = false, speedCol = '#ffffff', flash = 0, invert = 0, cardUntil = 0;
const ui: Ui = {
  card(name, title, color) {
    const c = $('.card'); (c.querySelector('b') as HTMLElement).textContent = name; (c.querySelector('span') as HTMLElement).textContent = title;
    c.style.setProperty('--c', color); c.classList.remove('on'); void c.offsetWidth; c.classList.add('on'); cardUntil = clock() + 3.2;
  },
  impact(kind = 'white') { if (kind === 'invert') invert = 1; else flash = 0.9; },
  speedLines(on, color = '#ffffff') { speedOn = on; speedCol = color; },
  cockpit(on) { $('.cockpit').classList.toggle('on', on); },
  title(on) { $('.titlecard').classList.toggle('on', on); },
};
function drawSpeed(t: number) {
  const w = speed.width = innerWidth, h = speed.height = innerHeight;
  sctx.clearRect(0, 0, w, h);
  if (!speedOn) return;
  sctx.strokeStyle = speedCol; sctx.globalAlpha = 0.55;
  const cx = w / 2, cy = h / 2, R = Math.hypot(w, h) / 2;
  let seed = Math.floor(t * 30);
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 110; i++) {
    const a = rnd() * Math.PI * 2, r0 = R * (0.35 + rnd() * 0.3);
    sctx.lineWidth = 1 + rnd() * 3;
    sctx.beginPath(); sctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); sctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); sctx.stroke();
  }
}

// ---------------------------------------------------------------- audio: WebAudio for lines + score, the game synth for foley
const AC = new AudioContext();
const master = AC.createGain(); master.connect(AC.destination);
const musicBus = AC.createGain(); musicBus.gain.value = 0.5; musicBus.connect(master);
const voBus = AC.createGain(); voBus.gain.value = 1.4; voBus.connect(master);
const buffers = new Map<string, AudioBuffer>();
let sources: AudioBufferSourceNode[] = [];
async function load(path: string) {
  const r = await fetch(BASE + path); buffers.set(path, await AC.decodeAudioData(await r.arrayBuffer()));
}
function startAudio(from: number) {
  stopAudio();
  const t0 = AC.currentTime + 0.05;
  const play = (path: string, at: number, bus: AudioNode, fadeIn = 0) => {
    const b = buffers.get(path); if (!b) return;
    const off = from - at; if (off >= b.duration) return;
    const s = AC.createBufferSource(); s.buffer = b;
    let node: AudioNode = s;
    if (fadeIn) { const g = AC.createGain(); g.gain.setValueAtTime(0, t0 + Math.max(0, at - from)); g.gain.linearRampToValueAtTime(1, t0 + Math.max(0, at - from) + fadeIn); s.connect(g); node = g; }
    node.connect(bus);
    s.start(t0 + Math.max(0, at - from), Math.max(0, off)); sources.push(s);
  };
  for (const c of TL.cues) play(`film/music/${c.cue}.mp3`, c.start, musicBus, 1.2);
  for (const l of LINES) play(l.file, l.at, voBus);
  // duck the score under every line
  const g = musicBus.gain; g.cancelScheduledValues(0); g.setValueAtTime(0.5, t0);
  for (const l of LINES) {
    if (l.at + l.secs < from) continue;
    const a = t0 + Math.max(0, l.at - from), b = t0 + Math.max(0, l.at + l.secs - from);
    g.setTargetAtTime(0.2, Math.max(t0, a - 0.15), 0.08); g.setTargetAtTime(0.5, b + 0.1, 0.35);
  }
  clockBase = { ac: t0, film: from };
}
function stopAudio() { for (const s of sources) { try { s.stop(); } catch { /* ended */ } } sources = []; }

// ---------------------------------------------------------------- clock
let playing = false, clockBase = { ac: 0, film: 0 }, paused = 0;
const clock = () => playing ? clockBase.film + (AC.currentTime - clockBase.ac) : paused;
function play(from = clock()) { playing = true; startAudio(from); $('.pp').textContent = '❚❚'; sfx.unlock(); }
function pause() { paused = clock(); playing = false; stopAudio(); $('.pp').textContent = '▶'; }
function seek(t: number) { const was = playing; if (was) { playing = false; stopAudio(); } paused = Math.max(0, Math.min(TOTAL - 0.1, t)); curShot = -1; if (was) play(paused); }

// ---------------------------------------------------------------- shots
let curShot = -1, lastLocal = 0;
const ctx: C = { st: stage, ui, t: 0, dt: 0, T: 1, k: 0, now: 0 };
function shotAt(t: number) { let i = TL.shots.findIndex(s => t >= s.at && t < s.at + s.secs); return i < 0 ? TL.shots.length - 1 : i; }
function enter(i: number, t: number) {
  const meta = TL.shots[i], s = SHOTS[meta.id];
  clearProps(stage);
  stage.use(s.set[0], s.set[1]);
  stage.stageCast(s.cast ?? []);
  stage.weather.set(s.weather ?? 'none');
  stage.grade(s.grade ?? {});
  speedOn = false; ui.cockpit(false); ui.title(meta.id === 's68');
  $('.card').classList.remove('on'); cardUntil = 0;
  Object.assign(ctx, { t: t - meta.at, T: meta.secs, k: (t - meta.at) / meta.secs, now: t, dt: 0 });
  s.setup?.(ctx);
  curShot = i; lastLocal = t - meta.at;
}

// ---------------------------------------------------------------- loop
let last = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const nowMs = performance.now(), dt = Math.min(0.05, (nowMs - last) / 1000); last = nowMs;
  const t = Math.min(clock(), TOTAL - 0.001);
  if (playing && clock() >= TOTAL) { pause(); paused = TOTAL - 0.01; }
  const i = shotAt(t);
  if (i !== curShot) enter(i, t);
  const meta = TL.shots[i], s = SHOTS[meta.id], local = t - meta.at;
  Object.assign(ctx, { t: local, dt: playing ? dt : 0, T: meta.secs, k: Math.min(1, local / meta.secs), now: t });
  if (playing) for (const [te, fn] of s.at ?? []) if (lastLocal < te && local >= te) fn(ctx);
  lastLocal = local;
  s.update(ctx);
  // flashes decay
  flash *= Math.pow(0.001, dt); invert = invert > 0.5 ? invert - dt * 12 : invert * Math.pow(0.0001, dt);
  stage.anime.uniforms.flash.value = flash; stage.anime.uniforms.invert.value = invert > 0.02 ? Math.min(1, invert) : 0;
  sfx.setListener(stage.camera.position, stage.camera.getWorldDirection(new THREE.Vector3()));
  stage.frame(playing ? dt : 0, t);
  drawSpeed(t);
  // subtitles + card timeout + controls
  const line = LINES.find(l => t >= l.at && t <= l.at + l.secs + 0.25);
  const sub = $('.sub'); const txt = line ? `${WHO[line.who] ? `<b>${WHO[line.who]}</b> ` : ''}${line.text}` : '';
  if (sub.dataset.v !== txt) { sub.innerHTML = txt; sub.dataset.v = txt; sub.classList.toggle('on', !!txt); }
  if (t > cardUntil) $('.card').classList.remove('on');
  ($('.seek i') as HTMLElement).style.width = `${t / TOTAL * 100}%`;
  const f = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  $('.tc').textContent = `${f(t)} / ${f(TOTAL)}`;
}

// ---------------------------------------------------------------- preload: every set, every cast member, every sound
const CAST_ALL = [...new Set(Object.values(SHOTS).flatMap(s => s.cast ?? []))];
const SETS_ALL = [...new Map(Object.values(SHOTS).map(s => [s.set[0], s.set[1]])).entries()];
async function preload() {
  await loadManifest();
  const bar = $('.lbar i'), label = $('.loading span');
  const audio = [...TL.cues.map(c => `film/music/${c.cue}.mp3`), ...LINES.map(l => l.file)];
  let done = 0; const total = SETS_ALL.length + CAST_ALL.length + audio.length;
  const tick = (what: string) => { done++; bar.style.width = `${done / total * 100}%`; label.textContent = what; };
  for (const [id, map] of SETS_ALL) { stage.use(id, map); tick(`Building ${id}…`); await new Promise(r => setTimeout(r, 0)); }
  for (const k of CAST_ALL) stage.cast.get(k);
  await Promise.all(audio.map(p => load(p).then(() => tick('Scoring…'))));
  // wait for the rigged models (CharacterView swaps its placeholder for the real GLB when it arrives)
  for (let n = 0; n < 240; n++) {
    const ready = CAST_ALL.filter(k => stage.cast.views.get(k)!.real).length;
    label.textContent = `Casting ${ready}/${CAST_ALL.length}…`;
    if (ready === CAST_ALL.length) break;
    await new Promise(r => setTimeout(r, 250));
  }
  for (let i = 0; i < CAST_ALL.length; i++) tick('Ready');
  bar.style.width = '100%'; label.textContent = 'Ready - headphones recommended';
  const go = $<HTMLButtonElement>('.go'); go.disabled = false;
  go.onclick = async () => { await AC.resume(); $('.loading').classList.add('off'); curShot = -1; play(0); };
  enter(0, 0);
}

// ---------------------------------------------------------------- controls
$('.pp').onclick = async () => { await AC.resume(); playing ? pause() : play(); };
$('.seek').onclick = e => { const r = $('.seek').getBoundingClientRect(); seek((e.clientX - r.left) / r.width * TOTAL); };
$<HTMLSelectElement>('.chap').onchange = e => seek(+(e.target as HTMLSelectElement).value);
$('.fs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen();
addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); $('.pp').click(); }
  if (e.code === 'ArrowRight') seek(clock() + 5);
  if (e.code === 'ArrowLeft') seek(clock() - 5);
  if (e.code === 'KeyF') $('.fs').click();
});
let idle = 0; addEventListener('mousemove', () => { root.classList.remove('idle'); clearTimeout(idle); idle = window.setTimeout(() => root.classList.add('idle'), 2500); });
const q = new URLSearchParams(location.search);
(window as any).__film = { stage, seek, play, pause, clock, ctx };
preload().then(() => { if (q.get('t')) { paused = +q.get('t')!; curShot = -1; } });
frame();
