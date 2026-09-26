// Filmstrips of Hero Viewer animation states (real GPU): node tests/e2e/anim_strip.mjs heroes modes [frames] [every_ms] [query]
//   node tests/e2e/anim_strip.mjs kaien,enra run,strafe,back,e,ult 8 90
// Writes tests/e2e/shots/anim/<hero>_<mode>.png (frames left to right) and prints the clip readout per state.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [heroes = 'kaien', modes = 'run', N = '8', every = '90', query = ''] = process.argv.slice(2);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await p.goto(`http://localhost:5199/play.html${query}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !!window.__zu?.menu, { timeout: 60000 });
await p.evaluate(() => window.__zu.menu.viewer());
await p.waitForFunction(() => !!window.__zu?.viewer, { timeout: 30000 });
// the clip library loads with the first character view
await p.evaluate(() => { window.__zu.viewer.select('kaien'); });
await p.waitForFunction(() => !!window.__zu?.anim || location.search.includes('procedural'), { timeout: 90000 }).catch(() => {});
fs.mkdirSync('tests/e2e/shots/anim', { recursive: true });
const tmp = 'tests/e2e/shots/strip';
for (const id of heroes.split(',')) {
  for (const mode of modes.split(',')) {
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    await p.evaluate((id, mode) => { const v = window.__zu.viewer; if (v.id !== id) v.select(id); v.auto = false; v.yaw = mode === 'strafe' ? 0.35 : mode === 'back' ? 0.9 : 0.75; v.tilt = 0.08; v.zoom = 1; v.setMode(mode); }, id, mode);
    await new Promise(r => setTimeout(r, mode === 'idle' ? 1500 : 1300));
    const el = await p.$('.vstage');
    const clips = new Set();
    for (let i = 0; i < +N; i++) {
      await el.screenshot({ path: `${tmp}/${i}.png` });
      clips.add(await p.evaluate(() => document.querySelector('.vclip')?.textContent ?? ''));
      await new Promise(r => setTimeout(r, +every));
    }
    const out = `tests/e2e/shots/anim/${id}_${mode}${query.includes('procedural') ? '_proc' : ''}.png`;
    execFileSync('python', ['tests/e2e/tile.py', out, N, '300']);
    console.log(out, [...clips].join(' | '));
  }
}
console.log('errors', errs.slice(0, 6));
await b.close();
