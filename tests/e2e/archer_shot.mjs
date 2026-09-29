// An archer in a real match, third person (the player's own camera, then a side view): hold the primary (draw),
// release, the nock from the quiver, then the secondary volley.  node tests/e2e/archer_shot.mjs [hero] [port]
// Writes tests/e2e/shots/archer_<hero>_<i>.png
import puppeteer from 'puppeteer-core';
const [hero = 'seiran', port = '5199'] = process.argv.slice(2);
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errors = [];
p.on('pageerror', e => errors.push(String(e)));
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 60 && !(await p.evaluate(() => !!window.__zu?.game)); i++) await wait(500);
await p.evaluate(h => window.__zu.game.start({ mode: 'training', map: 'training', hero: h }), hero);
for (let i = 0; i < 120 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
// headless Chrome refuses pointer lock: fake it (else fire is ignored and the game pauses itself)
await p.evaluate(() => { Object.defineProperty(window.__zu.game.input, 'locked', { get: () => true, configurable: true }); });
const live = () => p.evaluate(() => { const z = window.__zu; z.menu?.close?.(); if (z.game.paused) z.game.setPaused(false); });
await live();
// side view: a fixed spectator-style camera beside the player (the game's camera update is paused for the shot)
const setup = side => p.evaluate(sd => {
  const g = window.__zu.game, me = g.match.player, w = g.match.world;
  g.settings.view = 'third'; me.hp = 1e5;
  me.pos = { x: -10, y: w.level.groundAt(-10, -12, 30), z: -12 }; me.vel = { x: 0, y: 0, z: 0 };
  me.yaw = me.input.yaw = 0; g.input.yaw = 0; g.camYaw = 0; g.input.pitch = 0; g.camPitch = 0;
  window.__side = sd;
  if (!window.__camHook) {
    window.__camHook = true;
    const orig = g.updateCamera.bind(g);
    g.updateCamera = (dt, me2) => { orig(dt, me2); if (window.__side && me2) { const c = g.camera; c.position.set(me2.pos.x + 3.2, me2.pos.y + 1.5, me2.pos.z + 1.2); c.lookAt(me2.pos.x, me2.pos.y + 1.2, me2.pos.z + 0.6); } };
  }
}, side);
let k = 0;
const shot = async () => { await p.screenshot({ path: `tests/e2e/shots/archer_${hero}_${k++}.png` }); };
for (const side of [false, true]) {
  await setup(side); await live(); await wait(1500);
  // hold the draw
  await p.evaluate(() => { window.__zu.game.input.mouse.l = true; });
  await wait(250); await shot(); await wait(450); await shot();
  await p.evaluate(() => { window.__zu.game.timeScale = 0.25; });
  await p.evaluate(() => { window.__zu.game.input.mouse.l = false; });
  await wait(150); await shot(); await wait(500); await shot(); await wait(600); await shot(); await wait(800); await shot();
  await p.evaluate(() => { window.__zu.game.timeScale = 1; });
  // secondary volley
  await wait(900);
  await p.evaluate(() => { window.__zu.game.input.mouse.r = true; });
  await wait(120); await shot();
  await p.evaluate(() => { window.__zu.game.input.mouse.r = false; });
  await wait(250); await shot();
}
console.log('shots', k, 'errors', errors.slice(0, 3));
await b.close();
