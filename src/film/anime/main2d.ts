// "The Oath at Dawn - 2D Anime Cut": every frame is drawn - painted plates, hand-drawn key drawings on 2s, physics particles, anime FX.
// Clock + audio (recorded lines, score with ducking, the game's synth foley), shot switching, subtitles, name cards, controls.
import '../film.css';
import TL from '../timeline.json';
import { Stage2D, preload as preloadTex, W, H } from './stage2d';
import { Particles } from './particles';
import { SHOTS, ART, BGP, resetFrame, postState, impactTick, flashTick, type C, type Ui } from './shots2d';
import { evaCard } from './fx2d';
import { sfx } from '../../audio/Sfx';

const BASE: string = (import.meta as any).env?.BASE_URL ?? '/';
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
  <div class="bars"></div>
  <div class="card"><b></b><span></span></div>
  <div class="sub"></div>
  <div class="loading"><h2>THE OATH AT DAWN</h2><p>2D ANIME CUT</p><div class="lbar"><i></i></div><span>Inking the cels…</span><button class="go" disabled>▶ PLAY</button></div>
  <div class="ctrl"><button class="pp">❚❚</button><div class="seek"><i></i></div><span class="tc">0:00 / 5:26</span><select class="chap">${CHAPTERS.map(([t, n]) => `<option value="${t}">${n}</option>`).join('')}</select><button class="fs">⛶</button></div>`;
const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
const stage = new Stage2D($('.stagebox'));
const P = new Particles();

let cardUntil = 0;
const ui: Ui = {
  card(name, title, color) {
    const c = $('.card'); (c.querySelector('b') as HTMLElement).textContent = name; (c.querySelector('span') as HTMLElement).textContent = title;
    c.style.setProperty('--c', color); c.classList.remove('on'); void c.offsetWidth; c.classList.add('on'); cardUntil = clock() + 3.2;
  },
};

// ---------------------------------------------------------------- audio: WebAudio for lines + score, the game synth for foley
const AC = new AudioContext();
const master = AC.createGain(); master.connect(AC.destination);
const musicBus = AC.createGain(); musicBus.gain.value = 0.5; musicBus.connect(master);
const voBus = AC.createGain(); voBus.gain.value = 1.4; voBus.connect(master);
const buffers = new Map<string, AudioBuffer>();
let sources: AudioBufferSourceNode[] = [];
async function load(path: string) {
  try { const r = await fetch(BASE + path); buffers.set(path, await AC.decodeAudioData(await r.arrayBuffer())); } catch { /* missing line: silent */ }
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
  const g = musicBus.gain; g.cancelScheduledValues(0); g.setValueAtTime(0.5, t0);
  for (const l of LINES) {   // duck the score under every line
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
const ctx: C = { st: stage, P, ui, base: BASE, t: 0, dt: 0, T: 1, k: 0, now: 0, talk: '' };
function shotAt(t: number) { const i = TL.shots.findIndex(s => t >= s.at && t < s.at + s.secs); return i < 0 ? TL.shots.length - 1 : i; }
function enter(i: number, t: number) {
  const meta = TL.shots[i], s = SHOTS[meta.id];
  P.clear(); P.wind = 0; P.gust = 0; P.ground = 1000;
  stage.bg.fillStyle = '#05030a'; stage.bg.fillRect(0, 0, W, H);
  $('.card').classList.remove('on'); cardUntil = 0;
  Object.assign(ctx, { t: t - meta.at, T: meta.secs, k: (t - meta.at) / meta.secs, now: t, dt: 0 });
  // pre-roll the weather so a cut never opens on an empty sky
  if (s) { for (let n = 0; n < 40; n++) { ctx.dt = 1 / 20; stage.begin(); resetFrame(); s.update(ctx); P.update(1 / 20, t - 2 + n / 20); } ctx.dt = 0; s.enter?.(ctx); }
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
  const line = LINES.find(l => t >= l.at && t <= l.at + l.secs + 0.25);
  Object.assign(ctx, { t: local, dt: playing ? dt : 0, T: meta.secs, k: Math.min(1, local / meta.secs), now: t, talk: line && t <= line.at + line.secs ? line.who : '' });
  stage.begin(); resetFrame();
  if (s) {
    if (playing) for (const [te, fn] of s.at ?? []) if (lastLocal < te && local >= te) fn(ctx);
    s.update(ctx);
  }
  lastLocal = local;
  P.update(ctx.dt, t); P.draw(stage.fx);
  if (s?.card) evaCard(stage.fx, s.card, Math.min(1, local / 2.6));   // Evangelion-style episode card over the opening beat
  impactTick(ctx.dt); flashTick(ctx.dt);
  const ps = postState(), u = stage.post.uniforms;
  u.impact.value = ps.impact; u.flash.value = Math.min(1, ps.flash); (u.tint.value as { set(c: string): void }).set(ps.tint); u.sat.value = ps.sat; u.fade.value = ps.fade;
  stage.render(t);
  // subtitles + card timeout + controls
  const sub = $('.sub'); const txt = line ? `${WHO[line.who] ? `<b>${WHO[line.who]}</b> ` : ''}${line.text}` : '';
  if (sub.dataset.v !== txt) { sub.innerHTML = txt; sub.dataset.v = txt; sub.classList.toggle('on', !!txt); }
  if (t > cardUntil) $('.card').classList.remove('on');
  ($('.seek i') as HTMLElement).style.width = `${t / TOTAL * 100}%`;
  const f = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  $('.tc').textContent = `${f(t)} / ${f(TOTAL)}`;
}

// ---------------------------------------------------------------- preload: every drawing, every plate layer, every sound
async function preload() {
  const bar = $('.lbar i'), label = $('.loading span');
  const man = await fetch(`${BASE}film2d/manifest.json`, { cache: 'no-cache' }).then(r => r.json()).catch(() => ({ art: [], bg: [] })) as { art: string[]; bg: string[] };
  const imgs = [...man.art.map(n => `${BASE}${ART}${n}.webp`), ...man.bg.map(n => `${BASE}${BGP}${n}.webp`)];
  const audio = [...TL.cues.map(c => `film/music/${c.cue}.mp3`), ...LINES.map(l => l.file)];
  let done = 0; const total = imgs.length + audio.length;
  const tick = (what: string) => { done++; bar.style.width = `${done / total * 100}%`; label.textContent = what; };
  await Promise.all([preloadTex(imgs, () => tick('Inking the cels…')), ...audio.map(p => load(p).then(() => tick('Scoring…')))]);
  bar.style.width = '100%'; label.textContent = 'Ready - headphones recommended';
  const go = $<HTMLButtonElement>('.go'); go.disabled = false;
  go.onclick = async () => { await AC.resume(); $('.loading').classList.add('off'); curShot = -1; play(0); };
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
