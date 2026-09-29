// An archer's shot cycle in first person, in a real match, in slow motion (game time / SLOW): drawing, at full draw,
// then fixed moments after the loose (snap, reach to the quiver, the nock, ready).
//   node tests/e2e/archer_fp.mjs [hero] [slow] [port]   ->  tests/e2e/shots/archerfp_<hero>.png (one strip)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [hero = 'seiran', slow = '4', port = '5199'] = process.argv.slice(2);
const SLOW = Number(slow);
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
const errors = [];
p.on('pageerror', e => errors.push(String(e)));
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 60 && !(await p.evaluate(() => !!window.__zu?.game)); i++) await wait(500);
await p.evaluate(h => window.__zu.game.start({ mode: 'training', map: 'training', hero: h }), hero);
for (let i = 0; i < 120 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
// keep the game running headless (no pointer lock: fake it, or fire is ignored and the game pauses)
await p.evaluate(() => { const g = window.__zu.game; window.__zu.menu?.close?.(); g.settings.view = 'first'; Object.defineProperty(g.input, 'locked', { get: () => true, configurable: true }); g.setPaused(false); g.match.player.hp = 1e5; });
await wait(2500);
await p.evaluate(k => { window.__zu.game.timeScale = 1 / k; }, SLOW);
const shots = [], labels = [];
const shot = async l => { shots.push(await p.screenshot({ encoding: 'base64' })); labels.push(l); };
const gt = () => p.evaluate(() => window.__zu.game.match.world.time);
await p.evaluate(() => { window.__zu.game.input.mouse.l = true; });
await wait(250 * SLOW); await shot('drawing');
await wait(700 * SLOW); await shot('full draw');
await p.evaluate(() => { window.__zu.game.input.mouse.l = false; });
const t0 = await gt();
for (const at of [0.05, 0.15, 0.28, 0.4, 0.52, 0.65, 0.8]) {
  while ((await gt()) - t0 < at) await wait(15);
  await shot(`+${at}s`);
}
const png = await p.evaluate(async (list, labels) => {
  const ims = await Promise.all(list.map(s => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = 'data:image/png;base64,' + s; })));
  const cw = 400, ch = Math.round(cw * ims[0].height / ims[0].width), cols = 3;
  const c = document.createElement('canvas'); c.width = cw * cols; c.height = ch * Math.ceil(ims.length / cols);
  const g = c.getContext('2d'); g.font = 'bold 18px sans-serif'; g.fillStyle = '#ff0';
  ims.forEach((im, k) => { g.drawImage(im, (k % cols) * cw, Math.floor(k / cols) * ch, cw, ch); g.fillText(labels[k], (k % cols) * cw + 8, Math.floor(k / cols) * ch + 22); });
  return c.toDataURL('image/png').split(',')[1];
}, shots, labels);
fs.writeFileSync(`tests/e2e/shots/archerfp_${hero}.png`, Buffer.from(png, 'base64'));
console.log(`tests/e2e/shots/archerfp_${hero}.png`, 'errors', errors.slice(0, 3));
await b.close();
