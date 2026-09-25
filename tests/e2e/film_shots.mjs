// Seek the engine cut to given times and screenshot: node tests/e2e/film_shots.mjs t1,t2,... [out prefix]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [times = '5,40,85,120,240,250,262,275,290,322', pre = 'film'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 600000,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('' + (process.env.FILM_URL || 'http://localhost:5190/film.html') + '', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 240; i++) { if (await p.evaluate(() => !document.querySelector('.go')?.disabled)) break; await new Promise(r => setTimeout(r, 500)); }
console.log('loaded', await p.evaluate(() => document.querySelector('.loading span').textContent));
await p.click('.go');
fs.mkdirSync('tests/e2e/shots/film', { recursive: true });
for (const t of times.split(',').map(Number)) {
  await p.evaluate(t => window.__film.seek(t), t);
  await new Promise(r => setTimeout(r, 2200));
  await p.screenshot({ path: `tests/e2e/shots/film/${pre}_${String(t).padStart(3, '0')}.png` });
}
const fps = await p.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
console.log('fps', fps, 'errors', errs.slice(0, 8));
await b.close();
