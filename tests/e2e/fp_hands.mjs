// First-person hands up close (finger grips, hand meshes): one idle frame and one frame just after a shot per hero,
// cropped to the lower half of the view and enlarged.
//   node tests/e2e/fp_hands.mjs haruto,raijin,yuzu [port]   ->  tests/e2e/shots/fp/hands_<hero>.png
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [ids = 'haruto', port = '5199'] = process.argv.slice(2);
const wait = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('tests/e2e/shots/fp', { recursive: true });
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errors = [];
p.on('pageerror', e => errors.push(String(e)));
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 60 && !(await p.evaluate(() => !!window.__zu?.game)); i++) await wait(500);
for (const hero of ids.split(',')) {
  await p.evaluate(h => window.__zu.game.start({ mode: 'training', map: 'training', hero: h }), hero);
  for (let i = 0; i < 120 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player?.def.id)); i++) await wait(500);
  await p.evaluate(() => {
    const g = window.__zu.game; window.__zu.menu?.close?.(); g.settings.view = 'first';
    try { Object.defineProperty(g.input, 'locked', { get: () => true, configurable: true }); } catch { /* already */ }
    g.setPaused(false); g.match.player.hp = 1e5;
    if (!document.getElementById('nohud')) { const s = document.createElement('style'); s.id = 'nohud'; s.textContent = '.hud > *:not(.cross){visibility:hidden !important}'; document.head.append(s); }
  });
  await wait(2500);
  const shots = [await p.screenshot({ encoding: 'base64' })];
  await p.evaluate(() => { window.__zu.game.input.mouse.l = true; });
  await wait(90); shots.push(await p.screenshot({ encoding: 'base64' }));
  await wait(400); shots.push(await p.screenshot({ encoding: 'base64' }));
  await p.evaluate(() => { window.__zu.game.input.mouse.l = false; });
  const png = await p.evaluate(async list => {
    const ims = await Promise.all(list.map(s => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = 'data:image/png;base64,' + s; })));
    const w = ims[0].width, h = ims[0].height, sx = w * 0.25, sy = h * 0.4, sw = w * 0.75, sh = h * 0.6, cw = 800, ch = Math.round(cw * sh / sw);
    const c = document.createElement('canvas'); c.width = cw; c.height = ch * ims.length;
    const g = c.getContext('2d');
    ims.forEach((im, k) => g.drawImage(im, sx, sy, sw, sh, 0, k * ch, cw, ch));
    return c.toDataURL('image/png').split(',')[1];
  }, shots);
  fs.writeFileSync(`tests/e2e/shots/fp/hands_${hero}.png`, Buffer.from(png, 'base64'));
  console.log(`tests/e2e/shots/fp/hands_${hero}.png`);
  await p.evaluate(() => window.__zu.game.stop?.());
  await wait(500);
}
console.log('errors', errors.filter(e => !/Pointer Lock/.test(e)).slice(0, 3));
await b.close();
