// Clean full-body reference renders of one hero (viewer UI hidden), for film keyframe / video references:
//   node tests/e2e/hero_ref.mjs tenkai 20,-35,180 [out.png]
// Writes the yaw views side by side (default tests/e2e/shots/ref/<hero>.png).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [hero = 'tenkai', yaws = '20,-35', out = `tests/e2e/shots/ref/${hero}.png`] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
await p.goto('http://localhost:5199/play.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !!window.__zu?.menu, { timeout: 60000 });
await p.evaluate(() => window.__zu.menu.viewer());
await p.waitForFunction(() => !!window.__zu?.viewer, { timeout: 30000 });
await p.evaluate(h => window.__zu.viewer.select(h), hero);
await new Promise(r => setTimeout(r, 7000));
await p.addStyleTag({ content: '.vanims, .vhint, .vtitle, .vname, h1, h2, .vside, .vpanel, .vback, button { visibility: hidden !important }' });
const shots = [];
for (const y of yaws.split(',').map(Number)) {
  await p.evaluate(yy => { const v = window.__zu.viewer; v.auto = false; v.yaw = yy * Math.PI / 180; }, y);
  await new Promise(r => setTimeout(r, 900));
  shots.push(await p.screenshot({ clip: { x: 400, y: 20, width: 800, height: 860 } }));
}
fs.mkdirSync(out.replace(/[^/]+$/, ''), { recursive: true });
shots.forEach((s, i) => fs.writeFileSync(out.replace(/\.png$/, `_${i}.png`), s));
console.log(out, shots.length);
await b.close();
