// Hayate's shuriken live: first person (the throw thrust, the fan sweep, the big star leaving the hand with its water)
// and third person from the side (the arm's thrust, the stars in flight, a ricochet off the training-ground wall).
//   node tests/e2e/shuriken_shot.mjs [port=5199]
// Writes tests/e2e/shots/shuriken_<i>.png and reports the projectiles' bounce / seek state and page errors.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const port = process.argv[2] ?? '5199';
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 240000);
fs.mkdirSync('tests/e2e/shots', { recursive: true });
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const wait = ms => new Promise(r => setTimeout(r, ms));
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 }); await wait(1500);
await p.evaluate(() => window.__zu.game.start({ mode: 'training', map: 'training', hero: 'hayate' }));
for (let i = 0; i < 60 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
await p.evaluate(() => { const g = window.__zu.game; window.__zu.menu.close(); g.settings.view = 'first'; g.match.player.hp = 1e5; g.camYaw = g.input.yaw = Math.PI / 2; g.camPitch = g.input.pitch = 0; g.input.locked = true; g.setPaused?.(false); });   // (no pointer lock headless: the fire input needs the flag)
await wait(3500);
const shot = async (n) => p.screenshot({ path: `tests/e2e/shots/shuriken_${n}.png` });
await shot('fp_rest');
// primary: the thrust, caught twice in the first 0.1 s and once in the recovery; the stars in the air
await p.evaluate(() => { window.__zu.game.input.mouse.l = true; }); await wait(40); await shot('fp_throw_a');
await wait(50); await shot('fp_throw_b');
await p.evaluate(() => { window.__zu.game.input.mouse.l = false; }); await wait(140); await shot('fp_throw_c');
await wait(500);
// the fan: loaded across the body, then the sweep
await p.evaluate(() => { window.__zu.game.input.mouse.r = true; }); await wait(70); await shot('fp_fan_load');
await p.evaluate(() => { window.__zu.game.input.mouse.r = false; }); await wait(110); await shot('fp_fan_sweep');
await wait(800);
// third person, from the side: a volley at the dummies 8 m out (the lane's targets), then one at the floor to skip
const info = await p.evaluate(async () => {
  const g = window.__zu.game, w = g.match.world, me = g.match.player;
  g.settings.view = 'third';
  const seen = [];
  g.input.mouse.l = true; await new Promise(r => setTimeout(r, 60)); g.input.mouse.l = false;
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 25)); for (const q of w.projs) if (q.owner === me) seen.push({ id: q.id, bounce: q.bounce, bounced: q.bounced ?? 0, seek: q.seek, tgt: q.seekTgt ?? 0, mesh: q.mesh }); }
  const by = {}; for (const s of seen) by[s.id] = s;
  return { stars: Object.values(by), fxChildren: g.fx.group.children.length };
});
await wait(200); await shot('tp_after');
// the throws seen from behind: the thrust caught 60 ms in, the stars in flight 150 ms in; then the fan loaded and swept
await p.evaluate(() => { window.__zu.game.input.mouse.l = true; }); await wait(60); await shot('tp_throw');
await p.evaluate(() => { window.__zu.game.input.mouse.l = false; }); await wait(90); await shot('tp_flight');
await wait(700);
await p.evaluate(() => { window.__zu.game.input.mouse.r = true; }); await wait(70); await shot('tp_fan_load');
await p.evaluate(() => { window.__zu.game.input.mouse.r = false; }); await wait(120); await shot('tp_fan_sweep');
await wait(600);
// a throw at the floor two metres ahead, from the side camera, caught mid-flight
const skip = await p.evaluate(async () => {
  const g = window.__zu.game, w = g.match.world, me = g.match.player;
  g.camPitch = g.input.pitch = -0.6;
  g.input.mouse.l = true; await new Promise(r => setTimeout(r, 40)); g.input.mouse.l = false;
  const out = [];
  for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 30)); for (const q of w.projs) if (q.owner === me && q.bounced) out.push({ id: q.id, bounced: q.bounced, y: +q.pos.y.toFixed(2), vy: +q.vel.y.toFixed(1) }); }
  return out.slice(0, 6);
});
await shot('tp_skip');
console.log(JSON.stringify({ info, skip, errors: errs }, null, 1));
await b.close(); process.exit(0);
