// Every skin of the given heroes in the Hero Viewer: node tests/e2e/skins_sheet.mjs raijin,yuzu
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const ids = (process.argv[2] ?? 'raijin').split(',');
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await p.goto('http://localhost:5199/play.html?anim=procedural', { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !!window.__zu?.menu, { timeout: 60000 });
await p.evaluate(() => window.__zu.menu.viewer());
await p.waitForFunction(() => !!window.__zu?.viewer, { timeout: 30000 });
await p.addStyleTag({ content: '.vanims,.vhint,.vname{display:none !important}' });
const tmp = 'tests/e2e/shots/strip'; fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
let i = 0;
for (const id of ids) {
  await p.evaluate(id => { const v = window.__zu.viewer; v.select(id); v.auto = false; v.yaw = 0.5; v.tilt = 0.06; v.zoom = 1; v.setMode('idle'); }, id);
  await new Promise(r => setTimeout(r, 4000));
  const skins = await p.evaluate(() => [...document.querySelectorAll('.skin')].map(e => e.dataset.s));
  for (const s of skins) {
    await p.evaluate(s => window.__zu.viewer.view.setSkin(s), s);
    await new Promise(r => setTimeout(r, 600));
    await (await p.$('.vstage')).screenshot({ path: `${tmp}/${i++}.png` });
  }
  console.log(id, skins.join(','), await p.evaluate(() => { const u = window.__zu.viewer.view.look; return `src1 ${u.zuSrc1.value.x.toFixed(2)}/${u.zuSrc1.value.y.toFixed(2)} src2 ${u.zuSrc2.value.x.toFixed(2)}/${u.zuSrc2.value.y.toFixed(2)}`; }));
}
fs.mkdirSync('tests/e2e/shots/look', { recursive: true });
execFileSync('python', ['tests/e2e/tile.py', `tests/e2e/shots/look/skins_${ids.join('_')}.png`, '5', '420']);
console.log('errors', errs.slice(0, 5));
await b.close();
