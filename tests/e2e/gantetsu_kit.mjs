// node tests/e2e/gantetsu_kit.mjs [port] - Gantetsu's Mauga-style kit in a real match (training grounds, desktop edition):
//   dohyo  Grand Dohyo stamped with three enemies inside: the holographic chain round the ring and a chain from the
//          stake to each of them (third person, then from above); what the sim says about each (chained, grounded)
//   slam   Tachiai Rush into the leap and the Shiko Stomp: who is knocked down, for how long, how far they were thrown
//   guns   the chainguns in first person, idle and firing (barrels spun up)
// -> tests/e2e/shots/gantetsu_<shot>.png
import puppeteer from 'puppeteer-core';
const [port = '5199'] = process.argv.slice(2);
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 280000);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = n => p.screenshot({ path: `tests/e2e/shots/gantetsu_${n}.png` });
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 80 && !(await p.evaluate(() => !!window.__zu?.game)); i++) await wait(500);
await p.evaluate(() => window.__zu.game.start({ mode: 'training', map: 'training', hero: 'gantetsu' }));
for (let i = 0; i < 160 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
const place = () => p.evaluate(() => {
  const g = window.__zu.game, w = g.match.world, me = g.match.player; window.__zu.menu?.close?.(); if (g.paused) g.setPaused(false);
  me.hp = me.maxHp = 1e6; me.pos = { x: -10, y: 0, z: 0 }; me.vel = { x: 0, y: 0, z: 0 }; g.input.yaw = 0; g.input.pitch = 0;
  const foes = w.actors.filter(a => a.team !== me.team && a.alive).slice(0, 3);
  foes.forEach((f, i) => { f.pos = { x: -10 + [-3.5, 0.5, 4][i], y: 0, z: [4, 6.5, 3][i] }; f.vel = { x: 0, y: 0, z: 0 }; f.hp = f.maxHp = 1e5; });
  return foes.map(f => f.def.id);
});
const state = () => p.evaluate(() => {
  const g = window.__zu.game, w = g.match.world, me = g.match.player, t = w.time;
  return {
    me: { rush: me.has('tachiai', t), air: me.has('stompair', t), y: +me.pos.y.toFixed(2), spin: [+(me.sv.spin1 ?? 0).toFixed(2), +(me.sv.spin2 ?? 0).toFixed(2)] },
    zone: w.zones.filter(z => z.kind === 'dohyo').map(z => ({ left: +(z.until - t).toFixed(1), trapped: z.data.trapped.length })),
    chainUnits: g.fx?.chains?.mesh.count ?? null, chainTris: g.fx?.chains ? Math.round((g.fx.chains.mesh.geometry.index?.count ?? g.fx.chains.mesh.geometry.attributes.position.count) / 3) : null,
    foes: w.actors.filter(a => a.team !== me.team && a.alive).slice(0, 3).map(a => ({ id: a.def.id, d: +Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z).toFixed(1), chained: a.has('chained', t), grounded: a.has('grounded', t), down: +Math.max(0, (a.st.knockdown ?? 0) - t).toFixed(2), stun: a.has('stun', t) })),
  };
});
const key = async (code, ms = 100) => { await p.evaluate(c => window.__zu.game.input.keys.add(c), code); await wait(ms); await p.evaluate(c => window.__zu.game.input.keys.delete(c), code); };
// ---- guns (first person)
await p.evaluate(() => { window.__zu.game.settings.view = 'first'; });
console.log('foes', JSON.stringify(await place()));
for (let i = 0; i < 40 && !(await p.evaluate(() => !!window.__zu.game.fp?.view?.real)); i++) await wait(500);
await wait(2500);
await shot('fp_idle');
await p.evaluate(() => { const g = window.__zu.game; Object.defineProperty(g.input, 'locked', { get: () => true, configurable: true }); const h = g.input.held.bind(g.input); g.input.held = x => x === 'fire' || x === 'alt' || h(x); });
await wait(900);
await shot('fp_fire');
console.log('firing', JSON.stringify((await state()).me));
await p.evaluate(() => { const g = window.__zu.game; delete g.input.held; });
// ---- Grand Dohyo (third person)
await p.evaluate(() => { window.__zu.game.settings.view = 'third'; });
await place(); await wait(600);
await p.evaluate(() => { const me = window.__zu.game.match.player; me.ult = me.def.ult.charge; });
await key('KeyQ', 120);
await wait(250); await shot('dohyo_1');
await wait(900); await shot('dohyo_2');
console.log('dohyo', JSON.stringify(await state()));
await p.evaluate(() => { const g = window.__zu.game; g.input.yaw = 0.9; g.input.pitch = -0.35; });
await wait(700); await shot('dohyo_3');
// the ring gone: nobody bound any more
await p.evaluate(() => { const w = window.__zu.game.match.world; for (const z of w.zones) if (z.kind === 'dohyo') z.until = w.time + 0.05; });
await wait(700);
console.log('after', JSON.stringify(await state()));
// ---- Tachiai Rush -> leap -> Shiko Stomp
await p.evaluate(() => { const g = window.__zu.game; g.input.yaw = 0; g.input.pitch = -0.1; });
await place(); await wait(400);
await p.evaluate(() => { window.__zu.game.match.player.cd.tachiai = 0; });
await key('ShiftLeft', 120);
await wait(250);
// slow motion from here (screenshots take longer than the leap lasts)
await p.evaluate(() => { window.__zu.game.timeScale = 0.12; });
await shot('rush');
await key('Space', 250);
for (let i = 0; i < 40 && !(await p.evaluate(() => window.__zu.game.match.player.pos.y > 1.2)); i++) await wait(50);
await shot('leap');
console.log('leap', JSON.stringify((await state()).me));
for (let i = 0; i < 200 && (await p.evaluate(() => !!window.__zu.game.match.player.sv.stompArmed)); i++) await wait(30);
await wait(300); await shot('slam_1');
console.log('slam', JSON.stringify(await state()));
await wait(2500); await shot('slam_2');
console.log('down', JSON.stringify((await state()).foes));
await p.evaluate(() => { window.__zu.game.timeScale = 1; });
await wait(1500);
console.log('later', JSON.stringify((await state()).foes));
// ---- the guns from the side (third person, camera swung round to his right)
await place();
await p.evaluate(() => { const g = window.__zu.game; g.input.yaw = Math.PI / 2; g.input.pitch = 0; });
await wait(300);
await p.evaluate(() => { const g = window.__zu.game; g.match.player.yaw = 0; });
await shot('guns_side');
console.log('errors', JSON.stringify(errs.slice(0, 5)));
await b.close(); process.exit(0);
