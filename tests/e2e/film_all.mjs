// midpoint of every shot of the engine cut -> tests/e2e/shots/film/all_<id>.png
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const TL = JSON.parse(fs.readFileSync('src/film/timeline.json', 'utf8'));
const only = (process.argv[2] || '').split(',').filter(Boolean);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 900000,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5190/film.html', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 240; i++) { if (await p.evaluate(() => !document.querySelector('.go')?.disabled)) break; await new Promise(r => setTimeout(r, 500)); }
await p.click('.go');
fs.mkdirSync('tests/e2e/shots/film', { recursive: true });
for (const s of TL.shots) {
  if (only.length && !only.includes(s.id)) continue;
  await p.evaluate(t => window.__film.seek(t), s.at + Math.max(0, s.secs * 0.55 - 1.2));
  await new Promise(r => setTimeout(r, 1300));
  await p.screenshot({ path: `tests/e2e/shots/film/all_${s.id}.png` });
}
console.log('errors', errs.slice(0, 5));
await b.close();
