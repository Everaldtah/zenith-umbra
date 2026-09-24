// Capture every hero in the viewer from several angles + animation states: node tests/e2e/viewer.mjs <url> [ids]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [url = 'http://localhost:5190/play.html', idsArg = ''] = process.argv.slice(2);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await p.goto(url, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => window.__zu.menu.viewer());
const ids = idsArg ? idsArg.split(',') : ['tenkai', 'mirei', 'kaien', 'raijin', 'yuzu', 'gorgoth', 'nocturne', 'hex', 'kagemaru', 'enra'];
fs.mkdirSync('tests/e2e/shots/viewer', { recursive: true });
for (const id of ids) {
  await p.evaluate(id => { const v = window.__zu.viewer; v.select(id); v.auto = false; }, id);
  await new Promise(r => setTimeout(r, 2500));
  const shots = [['front', 0, 'idle', 0.1, 1], ['side', Math.PI / 2, 'run', 0.1, 1], ['back', Math.PI, 'run', 0.15, 1], ['face', 0.3, 'idle', 0.05, 0.38], ['cast', 0.6, 'cast', 0.1, 1]];
  for (const [n, yaw, mode, tilt, zoom] of shots) {
    await p.evaluate((yaw, mode, tilt, zoom) => { const v = window.__zu.viewer; v.yaw = yaw; v.tilt = tilt; v.zoom = zoom; v.setMode(mode); }, yaw, mode, tilt, zoom);
    await new Promise(r => setTimeout(r, n === 'cast' ? 700 : 1100));
    const el = await p.$('.vstage');
    await el.screenshot({ path: `tests/e2e/shots/viewer/${id}_${n}.png` });
  }
}
console.log('errors', errs.slice(0, 6));
await b.close();
