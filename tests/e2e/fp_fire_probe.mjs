// node tests/e2e/fp_fire_probe.mjs <hero> - first person on the training grounds, fire once, screenshots after the shot
// (+20 / +80 / +200 / +600 ms) to catch anything drawn in front of the camera by the weapon's effects.
import puppeteer from 'puppeteer-core';
const hero = process.argv[2] ?? 'tomoe';
const pre = (process.argv[3] ?? '').split(',').filter(Boolean);     // keys pressed first (e.g. KeyQ,ShiftLeft), 1.5s apart
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 200000);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const wait = ms => new Promise(r => setTimeout(r, ms));
await p.goto('http://localhost:5199/play.html', { waitUntil: 'domcontentloaded', timeout: 180000 }); await wait(1500);
await p.evaluate(h => window.__zu.game.start({ mode: 'training', map: 'training', hero: h }), hero);
for (let i = 0; i < 60 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
await p.evaluate(() => { const g = window.__zu.game; window.__zu.menu.close(); g.settings.view = 'first'; g.match.player.hp = 1e5; g.camYaw = g.input.yaw = Math.PI / 2; g.camPitch = g.input.pitch = 0; });
await wait(3000);
for (const k of pre) {
  await p.evaluate(c => { const g = window.__zu.game, me = g.match.player; me.ult = me.def.ult.charge; g.input.keys.add(c); }, k); await wait(90);
  await p.evaluate(c => window.__zu.game.input.keys.delete(c), k); await wait(1500);
}
await p.screenshot({ path: `tests/e2e/shots/fpfire_${hero}_0.png` });
await p.evaluate(() => { window.__zu.game.input.mouse.l = true; }); await wait(20);
await p.screenshot({ path: `tests/e2e/shots/fpfire_${hero}_1.png` });
await p.evaluate(() => { window.__zu.game.input.mouse.l = false; }); await wait(60);
await p.screenshot({ path: `tests/e2e/shots/fpfire_${hero}_2.png` }); await wait(120);
await p.screenshot({ path: `tests/e2e/shots/fpfire_${hero}_3.png` }); await wait(400);
await p.screenshot({ path: `tests/e2e/shots/fpfire_${hero}_4.png` });
const info = await p.evaluate(() => { const g = window.__zu.game; return { fx: g.fx.group.children.length, timed: g.fx.timed.map(t => t.kind), shots: g.match.player.shots }; });
console.log(hero, JSON.stringify(info), 'errors', errs);
await b.close(); process.exit(0);
