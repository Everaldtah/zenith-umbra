// Hero viewer shots of specific heroes in specific animation modes:
//   node tests/e2e/viewer_modes.mjs <url> "mirei:swoop:side,mirei:descend:front,gantetsu:attack:34"
// angles: front | side | back | 34 (three-quarter) | face (head close-up). Out: tests/e2e/shots/modes/<hero>_<mode>_<angle>.png
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [url = 'http://localhost:5199/play.html', list = 'mirei:idle:front'] = process.argv.slice(2);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await p.goto(url, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => window.__zu.menu.viewer());
fs.mkdirSync('tests/e2e/shots/modes', { recursive: true });
const ANG = { front: [0, 0.1, 1], side: [Math.PI / 2, 0.1, 1], back: [Math.PI, 0.15, 1], 34: [0.7, 0.12, 1], face: [0.3, 0.05, 0.38] };
let cur = '';
for (const item of list.split(',')) {
  const [id, mode, angle = 'front', wait = '1.2'] = item.split(':');
  if (id !== cur) { await p.evaluate(id => { const v = window.__zu.viewer; v.select(id); v.auto = false; }, id); await new Promise(r => setTimeout(r, 3500)); cur = id; }
  const [yaw, tilt, zoom] = ANG[angle];
  await p.evaluate((yaw, mode, tilt, zoom) => { const v = window.__zu.viewer; v.yaw = yaw; v.tilt = tilt; v.zoom = zoom; v.setMode(mode); }, yaw, mode, tilt, zoom);
  await new Promise(r => setTimeout(r, +wait * 1000));
  const el = await p.$('.vstage');
  await el.screenshot({ path: `tests/e2e/shots/modes/${id}_${mode}_${angle}.png` });
}
console.log('errors', errs.slice(0, 6));
await b.close();
