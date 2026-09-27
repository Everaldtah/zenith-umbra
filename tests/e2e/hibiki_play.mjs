// node tests/e2e/hibiki_play.mjs [port] - Hibiki in a live AI Quick Match: his tracks (SHIFT) and Max Volume, a Mag-Grind
// along a building, Scratch Wave, Bass Drop; screenshots of each; voice lines and sounds heard; no page errors.
import puppeteer from 'puppeteer-core';
const port = process.argv[2] ?? '5199';
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 300000);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.stack || e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text().slice(0, 300)); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = n => p.screenshot({ path: `tests/e2e/shots/hibiki_${n}.png` });
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 }); await wait(1500);
await p.evaluate(() => window.__zu.game.start({ mode: 'training', map: 'training', hero: 'hibiki' }));
for (let i = 0; i < 60 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
for (let i = 0; i < 40 && !(await p.evaluate(() => window.__zu.sfx.bank.ready)); i++) await wait(500);
await p.evaluate(() => { const g = window.__zu.game; window.__zu.menu.close(); g.settings.view = 'third'; g.match.player.hp = 1e5; window.__zu.sfx.played = {}; });
const press = async (code, ms = 80) => { await p.evaluate(c => window.__zu.game.input.keys.add(c), code); await wait(ms); await p.evaluate(c => window.__zu.game.input.keys.delete(c), code); };
await wait(1500); await shot('1_heal');
await press('ShiftLeft'); await wait(700); await shot('2_tempo');
await press('KeyE'); await wait(500); await shot('3_amp');
// Mag-Grind along the north border wall
await p.evaluate(() => {
  const g = window.__zu.game, me = g.match.player, w = g.match.world;
  const hit = w.level.ray({ x: -30, y: 2, z: 20 }, { x: 0, y: 0, z: 1 }, 20);
  const face = 20 + hit.t;
  me.pos = { x: -34, y: 2.4, z: face - me.radius - 0.35 }; me.vel = { x: 7, y: 0, z: 0 }; me.grounded = false; me.lastGroundedAt = -9;
  g.camYaw = Math.PI / 2 - 0.5; g.camPitch = -0.1;
});
await p.evaluate(() => { const i = window.__zu.game.input; i.keys.add('Space'); i.keys.add('KeyW'); });
await wait(1200); await shot('4_grind');
const grind = await p.evaluate(() => { const me = window.__zu.game.match.player, t = window.__zu.game.match.world.time; return { grinding: me.has('grinding', t), y: +me.pos.y.toFixed(2), vx: +me.vel.x.toFixed(2) }; });
await p.evaluate(() => { const i = window.__zu.game.input; i.keys.delete('Space'); i.keys.delete('KeyW'); });
await wait(1500);
// Scratch Wave at the training dummies, then the Bass Drop
await p.evaluate(() => { const g = window.__zu.game, me = g.match.player; me.pos = { x: 18, y: 0, z: -12 }; me.vel = { x: 0, y: 0, z: 0 }; g.camYaw = Math.PI / 2; g.camPitch = 0; });
await wait(800);
await p.evaluate(() => { window.__zu.game.input.mouse.r = true; }); await wait(120); await p.evaluate(() => { window.__zu.game.input.mouse.r = false; });
await wait(150); await shot('5_scratch');
await p.evaluate(() => { const me = window.__zu.game.match.player; me.ult = me.def.ult.charge; });
await press('KeyQ'); await wait(900); await shot('6_bassdrop');
await p.evaluate(() => { window.__zu.game.input.mouse.l = true; }); await wait(700); await shot('7_fire'); await p.evaluate(() => { window.__zu.game.input.mouse.l = false; });
const res = await p.evaluate(() => { const s = window.__zu.sfx; return { played: Object.keys(s.played).filter(k => s.bank.has(k)).sort(), shield: window.__zu.game.match.player.shields.map(x => x.kind + ':' + Math.round(x.amt)) }; });
console.log(JSON.stringify({ grind, ...res }, null, 1));
console.log('errors', errs.length, errs.slice(0, 3).join('\n---\n'));
await b.close(); process.exit(0);
