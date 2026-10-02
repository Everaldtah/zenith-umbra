// Filmstrips of single library clips played on a hero in the Hero Viewer (real GPU) - to judge a new pack's clips
// before they're pinned in public/anim/manifest.json:
//   node tests/e2e/clip_strip.mjs <hero> <clip,clip,...> [frames=6] [port=5199] [yaw=0.75]
// Each clip plays through the hero's own clip layer as the slot the library sorted it into (trimmed as in game; deaths
// and full-body moves own the legs). Writes tests/e2e/shots/anim/clip_<hero>_<clip>.png and prints the clip readout.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [hero = 'kaien', names = 'CMU_Backflip', N = '6', port = '5199', yaw = '0.75'] = process.argv.slice(2);
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 300000);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' || /anim:|anim pack/.test(m.text())) errs.push(m.text().slice(0, 200)); });
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !!window.__zu?.menu, { timeout: 60000 });
await p.evaluate(() => window.__zu.menu.viewer());
await p.waitForFunction(() => !!window.__zu?.viewer, { timeout: 30000 });
await p.evaluate(h => { window.__zu.viewer.select(h); }, hero);
await p.waitForFunction(() => !!window.__zu?.anim && !!window.__zu.viewer.view?.anim?.layer, { timeout: 120000 });
await p.evaluate(y => { const v = window.__zu.viewer; v.auto = false; v.yaw = y; v.tilt = 0.08; v.zoom = 1.25; v.setMode('idle'); }, +yaw);
await new Promise(r => setTimeout(r, 1500));
fs.mkdirSync('tests/e2e/shots/anim', { recursive: true });
const tmp = `tests/e2e/shots/clipstrip_${process.pid}`;
for (const name of names.split(',')) {
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  const info = await p.evaluate(n => {
    const lib = window.__zu.anim, layer = window.__zu.viewer.view.anim.layer;
    // the clip as the game plays it: from its slot (trimmed), a hero's own slot, a cast, else raw
    let clip = null, slot = 'cast';
    for (const [s, l] of lib.slots) { const c = l.find(x => x.name === n); if (c) { clip = c; slot = s; break; } }
    if (!clip) for (const [, mm] of lib.heroSlots) for (const [s, l] of mm) { const c = l.find(x => x.name === n); if (c && !clip) { clip = c; slot = s; } }
    if (!clip) for (const [, v] of lib.casts) if (v.clip.name === n) { clip = v.clip; slot = 'cast'; }
    if (!clip) { clip = lib.clips.find(x => x.name === n); slot = /death|flip|vault|roll|slide|cartwheel/i.test(n) ? 'flip' : 'cast'; }
    if (!clip) return null;
    const full = /death/i.test(n) ? 'flip' : slot;            // (a death shown as a full-body one-shot, held at its end)
    layer.start(full, clip, clip.duration, /death/i.test(n));
    window.__clipDur = clip.duration;
    return { slot, dur: +clip.duration.toFixed(2), frames: clip.frames };
  }, name);
  if (!info) { console.log(name, 'NOT FOUND'); continue; }
  const el = await p.$('.vstage');
  const step = Math.max(60, (info.dur * 1000) / (+N - 1));
  for (let i = 0; i < +N; i++) { await el.screenshot({ path: `${tmp}/${i}.png` }); await new Promise(r => setTimeout(r, step)); }
  const out = `tests/e2e/shots/anim/clip_${hero}_${name}.png`;
  execFileSync('python', ['tests/e2e/tile.py', out, N, '300', tmp]);
  console.log(out, JSON.stringify(info));
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('errors', errs.slice(0, 8));
await b.close(); process.exit(0);
