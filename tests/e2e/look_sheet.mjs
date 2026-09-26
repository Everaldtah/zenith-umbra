// Art review sheet: every hero front / 3/4 back / face close-up in the Hero Viewer (idle, procedural pose so the rest
// shape reads), tiled into tests/e2e/shots/look/sheet_<tag>.png.  node tests/e2e/look_sheet.mjs [tag] [ids] [query]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [tag = 'now', idsArg = 'tenkai,mirei,kaien,raijin,yuzu,gorgoth,nocturne,hex,kagemaru,enra,haruto', query = '?anim=procedural'] = process.argv.slice(2);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
await p.goto(`http://localhost:5199/play.html${query}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !!window.__zu?.menu, { timeout: 60000 });
await p.evaluate(() => window.__zu.menu.viewer());
await p.waitForFunction(() => !!window.__zu?.viewer, { timeout: 30000 });
await p.addStyleTag({ content: '.vanims,.vhint,.vname{display:none !important}' });
const tmp = 'tests/e2e/shots/strip';
fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
fs.mkdirSync('tests/e2e/shots/look', { recursive: true });
let i = 0;
for (const id of idsArg.split(',')) {
  await p.evaluate(id => { const v = window.__zu.viewer; v.select(id); v.auto = false; v.setMode('idle'); }, id);
  await new Promise(r => setTimeout(r, 3500));
  for (const [yaw, tilt, zoom] of [[0, 0.06, 1], [2.5, 0.12, 1], [0.35, 0.02, 0.32]]) {
    await p.evaluate((y, t, z) => { const v = window.__zu.viewer; v.yaw = y; v.tilt = t; v.zoom = z; }, yaw, tilt, zoom);
    await new Promise(r => setTimeout(r, 700));
    await (await p.$('.vstage')).screenshot({ path: `${tmp}/${i++}.png` });
  }
}
execFileSync('python', ['tests/e2e/tile.py', `tests/e2e/shots/look/sheet_${tag}.png`, '6', '360']);
console.log(`tests/e2e/shots/look/sheet_${tag}.png`);
await b.close();
