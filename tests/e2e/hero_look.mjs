// Large Hero Viewer shots of one hero at chosen moments of an animation state (real GPU):
//   node tests/e2e/hero_look.mjs tomoe e 0.1,0.3,0.45,0.6 [yawDeg]
// Writes tests/e2e/shots/look/<hero>_<mode>.png (the shots side by side, cropped to the stage).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [hero = 'tomoe', mode = 'idle', at = '0.2,0.5', yaw = '0'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5199/play.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !!window.__zu?.menu, { timeout: 60000 });
await p.evaluate(() => window.__zu.menu.viewer());
await p.waitForFunction(() => !!window.__zu?.viewer, { timeout: 30000 });
await p.evaluate(h => window.__zu.viewer.select(h), hero);
await new Promise(r => setTimeout(r, 6000));                 // model + clip library stream in
await p.evaluate((m, y) => { const v = window.__zu.viewer; v.auto = false; v.yaw = y * Math.PI / 180; document.querySelector(`.vanims button[data-a="${m}"]`)?.click(); }, mode, +yaw);
fs.mkdirSync('tests/e2e/shots/look', { recursive: true });
const times = at.split(',').map(Number);
const shots = [];
// the viewer's own clock: wait for a cycle start (the ability modes loop every 1.6s), then shoot at each offset
const T0 = Date.now();
await new Promise(r => setTimeout(r, 1700));
for (const t of times) {
  const wait = T0 + 1700 + t * 1000 - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  shots.push(await p.screenshot({ clip: { x: 360, y: 0, width: 880, height: 900 } }));
}
const out = `tests/e2e/shots/look/${hero}_${mode}_y${yaw}`;
shots.forEach((s, i) => fs.writeFileSync(`${out}_${i}.png`, s));
console.log(out, shots.length, 'shots', 'errors', errs.slice(0, 3));
await b.close();
