// Side-by-side: clip-driven vs procedural, one hero + mode, large frames: node tests/e2e/anim_cmp.mjs hero mode [yaw] [t]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [id = 'kaien', mode = 'idle', yaw = '0', tsec = '1.2'] = process.argv.slice(2);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
fs.mkdirSync('tests/e2e/shots/strip', { recursive: true });
let i = 0;
for (const q of ['', '?anim=procedural']) {
  const p = await b.newPage();
  await p.goto(`http://localhost:5199/play.html${q}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await p.waitForFunction(() => !!window.__zu?.menu, { timeout: 60000 });
  await p.evaluate(() => window.__zu.menu.viewer());
  await p.waitForFunction(() => !!window.__zu?.viewer, { timeout: 30000 });
  await p.evaluate(id => window.__zu.viewer.select(id), id);
  if (!q) await p.waitForFunction(() => !!window.__zu?.anim, { timeout: 90000 });
  await p.evaluate((mode, yaw) => { const v = window.__zu.viewer; v.auto = false; v.yaw = +yaw; v.tilt = 0.05; v.zoom = 1; v.setMode(mode); }, mode, yaw);
  await new Promise(r => setTimeout(r, +tsec * 1000 + 1500));
  await (await p.$('.vstage')).screenshot({ path: `tests/e2e/shots/strip/${i++}.png` });
  await p.close();
}
execFileSync('python', ['tests/e2e/tile.py', `tests/e2e/shots/anim/cmp_${id}_${mode}.png`, '2', '700']);
console.log(`tests/e2e/shots/anim/cmp_${id}_${mode}.png`);
await b.close();
