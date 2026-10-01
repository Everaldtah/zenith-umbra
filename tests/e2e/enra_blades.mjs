// Enra's Hellfire Chains check: the Tripo chain blades in both fists with their chains (never the Dawnbreaker hammer) -
// third person in the Hero Viewer (idle 3/4, front, a light swing mid-arc, the throw taut) and first person in training
// (idle, a swing, the throw).   node tests/e2e/enra_blades.mjs [port]  ->  tests/e2e/shots/enra/*.png
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [port = '5199'] = process.argv.slice(2);
const wait = ms => new Promise(r => setTimeout(r, ms));
const out = 'tests/e2e/shots/enra';
fs.mkdirSync(out, { recursive: true });
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 600000,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errors = [];
p.on('pageerror', e => errors.push(String(e)));
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`console.${m.type()}: ${m.text()}`); });

// ---- third person: the Hero Viewer
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !!window.__zu?.menu, { timeout: 60000 });
await p.evaluate(() => window.__zu.menu.viewer());
await p.waitForFunction(() => !!window.__zu?.viewer, { timeout: 30000 });
await p.addStyleTag({ content: '.vanims,.vhint,.vname{display:none !important}' });
await p.evaluate(() => { const V = window.__zu.viewer; V.select('enra'); V.auto = false; V.setMode('idle'); V.tilt = 0.06; V.zoom = 1; });
for (let i = 0; i < 80 && !(await p.evaluate(() => window.__zu.viewer.view.real)); i++) await wait(250);
await wait(3000);
const shot = async name => { await (await p.$('.vstage')).screenshot({ path: `${out}/${name}.png` }); console.log(`${out}/${name}.png`); };
const yaw = y => p.evaluate(y => { window.__zu.viewer.yaw = y; }, y);
// what he actually holds
console.log(await p.evaluate(() => {
  const v = window.__zu.viewer.view, names = [];
  v.group.traverse(o => { if (o.name) names.push(o.name); });
  return { hammer: !!v.hammer, guns: v.guns.length, chains: v.chains?.length ?? "n/a", tripo: names.filter(n => /tripo/.test(n)).length };
}));
await yaw(-0.75); await wait(800); await shot('tp_idle');
await yaw(0); await wait(600); await shot('tp_front');
// start the attack live, let it run for `age` seconds (the chain pays out, the trail is the real path), then hold the clock
const freezeAt = async (kind, age, side) => {
  await p.evaluate((kind, side) => {
    const V = window.__zu.viewer, a = V.actor;
    if (!V.__orig) { V.__orig = V.frame.bind(V); V.frame = () => { V.__orig(); if (V.__freeze !== undefined) V.t = V.__freeze; }; }
    V.__freeze = undefined; a.anim.attackKind = kind; a.anim.attackAt = V.t; a.anim.attackSide = side;
  }, kind, side);
  await wait(age * 1000);
  await p.evaluate(() => { const V = window.__zu.viewer; V.__freeze = V.t; });
};
const unfreeze = () => p.evaluate(() => { window.__zu.viewer.__freeze = undefined; });
await yaw(Math.PI); await wait(700); await shot('tp_back_yoke');
await yaw(-0.6); await p.evaluate(() => { const V = window.__zu.viewer; V.zoom = 3; V.tilt = 0.75; });   // the blade flies 4-5 m out: pull the camera back and up for the swings
await freezeAt('primary', 0.27, 1); await wait(700); await shot('tp_swing_r');
await unfreeze(); await wait(900);
await freezeAt('primary', 0.27, -1); await wait(700); await shot('tp_swing_l');
await unfreeze(); await wait(900);
await freezeAt('secondary', 0.29, 1); await wait(700); await shot('tp_throw');
await unfreeze(); await wait(900);
await freezeAt('secondary', 0.16, 1); await wait(700); await shot('tp_throw_out');
await unfreeze();

// ---- first person: training
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 60 && !(await p.evaluate(() => !!window.__zu?.game)); i++) await wait(500);
await p.evaluate(() => window.__zu.game.start({ mode: 'training', map: 'training', hero: 'enra' }));
for (let i = 0; i < 120 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player?.def.id)); i++) await wait(500);
await p.evaluate(() => {
  const g = window.__zu.game; window.__zu.menu?.close?.(); g.settings.view = 'first';
  try { Object.defineProperty(g.input, 'locked', { get: () => true, configurable: true }); } catch { /* already */ }
  g.setPaused(false); g.match.player.hp = 1e5;
  const s = document.createElement('style'); s.id = 'nohud'; s.textContent = '.hud > *:not(.cross){visibility:hidden !important}'; document.head.append(s);
});
await wait(3000);
await p.screenshot({ path: `${out}/fp_idle.png` }); console.log(`${out}/fp_idle.png`);
await p.evaluate(() => { window.__zu.game.input.mouse.l = true; });
await wait(120); await p.screenshot({ path: `${out}/fp_swing_a.png` });
await wait(200); await p.screenshot({ path: `${out}/fp_swing_b.png` });
await p.evaluate(() => { window.__zu.game.input.mouse.l = false; });
await wait(900);
await p.evaluate(() => { window.__zu.game.input.mouse.r = true; });
await wait(230); await p.screenshot({ path: `${out}/fp_throw.png` });
await p.evaluate(() => { window.__zu.game.input.mouse.r = false; });
console.log('fp shots written');
console.log('errors', errors.filter(e => !/Pointer Lock|favicon/.test(e)).slice(0, 6));
await b.close();
