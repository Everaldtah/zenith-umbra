// node tests/e2e/modes_shot.mjs <id> <modes,...> [yaw]  -> tests/e2e/shots/modes_<id>.png (tiled)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [id = 'mirei', modesArg = 'idle,walk,fly', yaw = '0.5'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5190/play.html', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => window.__zu.menu.viewer());
await p.evaluate((id, yaw) => { const V = window.__zu.viewer; V.select(id); V.auto = false; V.yaw = +yaw; V.tilt = 0.12; }, id, yaw);
await new Promise(r => setTimeout(r, 3500));
fs.rmSync('tests/e2e/shots/strip', { recursive: true, force: true }); fs.mkdirSync('tests/e2e/shots/strip', { recursive: true });
let i = 0;
for (const m of modesArg.split(',')) {
  await p.evaluate(m => document.querySelector(`[data-a="${m}"]`).click(), m);
  await new Promise(r => setTimeout(r, 1600));
  await (await p.$('.vstage')).screenshot({ path: `tests/e2e/shots/strip/${i++}.png` });
}
console.log('errors', errs.slice(0, 3));
await b.close();
