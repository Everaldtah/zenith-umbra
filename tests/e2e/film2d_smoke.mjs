// Smoke test for the 2D anime cut: load film.html, step through every shot, collect page errors, grab a few frames.
//   node tests/e2e/film2d_smoke.mjs [base=http://localhost:5190] [out=tests/e2e/shots/film2d]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import TL from '../../src/film/timeline.json' with { type: 'json' };
const [base = 'http://localhost:5190', out = 'tests/e2e/shots/film2d'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 600000,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(`${base}/film.html`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !document.querySelector('.go')?.disabled, { timeout: 300000 });
await p.click('.go');
fs.mkdirSync(out, { recursive: true });
const want = new Set((process.env.SHOTS ?? 's09,s24,s43,s50,s60,s65').split(','));
for (const s of TL.shots) {
  await p.evaluate(t => window.__film.seek(t), s.at + s.secs * 0.55);
  await new Promise(r => setTimeout(r, want.has(s.id) ? 900 : 150));
  if (want.has(s.id)) await p.screenshot({ path: `${out}/${s.id}.png` });
}
await p.evaluate(() => window.__film.pause());
console.log(errs.length ? `ERRORS (${errs.length}):\n` + [...new Set(errs)].slice(0, 20).join('\n') : 'no page errors');
await b.close();
