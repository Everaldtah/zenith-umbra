// node tests/e2e/vfx_wall.mjs [port] [hero] - third-person close-up of a hero firing into a wall on the training grounds:
// tracers, muzzle flashes, sparks, smoke and scorch marks (desktop edition WeaponFx) -> tests/e2e/shots/vfx_<hero>_*.png
import puppeteer from 'puppeteer-core';
const [port = '5199', hero = 'gantetsu'] = process.argv.slice(2);
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 240000);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const wait = ms => new Promise(r => setTimeout(r, ms));
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 }); await wait(1500);
await p.evaluate(h => window.__zu.game.start({ mode: 'training', map: 'training', hero: h }), hero);
for (let i = 0; i < 60 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
await p.evaluate(() => {
  const g = window.__zu.game, me = g.match.player; g.settings.view = 'third'; window.__zu.menu?.close?.();
  me.hp = me.maxHp = 1e6;
  // stand 9m from the north wall, facing it, slightly off-axis so the camera sees the streaks
  me.pos = { x: -31, y: 0, z: 13 }; g.camYaw = 0.3; g.camPitch = 0.06;
});
await wait(2500);
await p.evaluate(() => { const g = window.__zu.game; g.input.mouse.l = true; g.input.mouse.r = !!g.match.player.def.dualGuns; });
for (const [ms, n] of [[900, 1], [700, 2]]) { await wait(ms); await p.screenshot({ path: `tests/e2e/shots/vfx_${hero}_${n}.png` }); }
await p.evaluate(() => { const g = window.__zu.game; g.input.mouse.l = false; g.input.mouse.r = false; });
await wait(600); await p.screenshot({ path: `tests/e2e/shots/vfx_${hero}_3.png` });
console.log('errors', errs.slice(0, 3));
await b.close(); process.exit(0);
