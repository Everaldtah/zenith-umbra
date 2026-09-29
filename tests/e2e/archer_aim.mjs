// An archer aiming down the arrow in first person (Yuzu's Hawk Eye, after Freja's Take Aim): not aiming, aiming, and
// aiming at full draw.   node tests/e2e/archer_aim.mjs [hero] [port]  ->  tests/e2e/shots/fp/aim_<hero>.png
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [hero = 'yuzu', port = '5199'] = process.argv.slice(2);
const wait = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('tests/e2e/shots/fp', { recursive: true });
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
const errors = [];
p.on('pageerror', e => errors.push(String(e)));
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 60 && !(await p.evaluate(() => !!window.__zu?.game)); i++) await wait(500);
await p.evaluate(h => window.__zu.game.start({ mode: 'training', map: 'training', hero: h }), hero);
for (let i = 0; i < 120 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
await p.evaluate(() => {
  const g = window.__zu.game; window.__zu.menu?.close?.(); g.settings.view = 'first';
  Object.defineProperty(g.input, 'locked', { get: () => true, configurable: true }); g.setPaused(false); g.match.player.hp = 1e5;
});
await wait(2500);
const shots = [];
shots.push(await p.screenshot({ encoding: 'base64' }));
await p.evaluate(() => { window.__zu.game.input.mouse.r = true; });
await wait(600); shots.push(await p.screenshot({ encoding: 'base64' }));
await p.evaluate(() => { window.__zu.game.input.mouse.l = true; });
await wait(1200); shots.push(await p.screenshot({ encoding: 'base64' }));
await p.evaluate(() => { const i = window.__zu.game.input; i.mouse.l = false; i.mouse.r = false; });
const png = await p.evaluate(async list => {
  const ims = await Promise.all(list.map(s => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = 'data:image/png;base64,' + s; })));
  const cw = 640, ch = Math.round(cw * ims[0].height / ims[0].width);
  const c = document.createElement('canvas'); c.width = cw * ims.length; c.height = ch;
  const g = c.getContext('2d'); g.font = 'bold 18px sans-serif'; g.fillStyle = '#ff0';
  ims.forEach((im, k) => { g.drawImage(im, k * cw, 0, cw, ch); g.fillText(['hip', 'aiming', 'aiming + full draw'][k], k * cw + 8, 22); });
  return c.toDataURL('image/png').split(',')[1];
}, shots);
fs.writeFileSync(`tests/e2e/shots/fp/aim_${hero}.png`, Buffer.from(png, 'base64'));
console.log(`tests/e2e/shots/fp/aim_${hero}.png`, 'errors', errors.filter(e => !/Pointer Lock/.test(e)).slice(0, 3));
await b.close();
