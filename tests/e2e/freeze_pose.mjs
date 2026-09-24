// Freeze a hero-viewer attack at exact ages (the viewer clock is pinned so springs settle on that pose):
//   node tests/e2e/freeze_pose.mjs <id> <kind> <ages,..> <yaw> <tilt> [side] [castId]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [id = 'tenkai', kind = 'primary', agesArg = '0.2,0.34,0.5', yaw = '0.3', tilt = '0.12', side = '1', castId = ''] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
await p.goto('http://localhost:5190/play.html', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => window.__zu.menu.viewer());
await p.evaluate((id, yaw, tilt) => { const V = window.__zu.viewer; V.select(id); V.auto = false; V.yaw = +yaw; V.tilt = +tilt; }, id, yaw, tilt);
for (let i = 0; i < 40 && !(await p.evaluate(() => window.__zu.viewer.view.real)); i++) await new Promise(r => setTimeout(r, 250));
await new Promise(r => setTimeout(r, 1500));
fs.rmSync('tests/e2e/shots/strip', { recursive: true, force: true }); fs.mkdirSync('tests/e2e/shots/strip', { recursive: true });
let i = 0;
for (const age of agesArg.split(',').map(Number)) {
  await p.evaluate((age, kind, side, castId) => {
    const V = window.__zu.viewer, a = V.actor;
    if (!V.__orig) { V.__orig = V.frame.bind(V); V.frame = () => { V.__orig(); if (V.__freeze !== undefined) V.t = V.__freeze; }; }
    V.__freeze = V.t;
    if (castId) { a.anim.castAt = V.t - age; a.anim.castId = castId; }
    else { a.anim.attackKind = kind; a.anim.attackSide = +side; a.anim.attackAt = V.t - age; }
  }, age, kind, side, castId);
  await new Promise(r => setTimeout(r, 700));
  await (await p.$('.vstage')).screenshot({ path: `tests/e2e/shots/strip/${i++}.png` });
}
await b.close();
console.log('ok');
