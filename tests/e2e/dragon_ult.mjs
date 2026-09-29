// node tests/e2e/dragon_ult.mjs [port] [hero] - the Koryu spirit dragons in a real match (desktop edition):
//   seiran: Twin Koi Torrent cast at a training-ground wall - the sigil, the twin dragons pouring out in a double helix
//           and swimming straight through the wall (camera swung to the side after the cast to see the spiral)
//   hayate: Dragon Gate Blade (a 15 s Dragonblade state) with targets in slash range - the violet dragon coiling up
//           around him on the draw, then the dragon streaking through each slash
// -> tests/e2e/shots/dragon_<hero>_<n>.png
import puppeteer from 'puppeteer-core';
const [port = '5199', hero = 'seiran'] = process.argv.slice(2);
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 240000);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (/dragon|model load failed/i.test(m.text())) errs.push(m.text()); });
const wait = ms => new Promise(r => setTimeout(r, ms));
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 }); await wait(1500);
await p.evaluate(h => window.__zu.game.start({ mode: 'training', map: 'training', hero: h }), hero);
for (let i = 0; i < 60 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
const setup = await p.evaluate(h => {
  const g = window.__zu.game, w = g.match.world, me = g.match.player; g.settings.view = 'third'; window.__zu.menu?.close?.();
  me.hp = me.maxHp = 1e6;
  me.pos = { x: -31, y: 0, z: 13 };
  // cast along the clearest of eight headings (the torrent's 45 m is easiest to judge in the open)
  let best = 0, bestD = -1;
  for (let k = 0; k < 8; k++) {
    const y = k * Math.PI / 4, f = { x: Math.sin(y), z: Math.cos(y) }; let d = 0;
    while (d < 45 && w.level.lineOfSight({ x: me.pos.x, y: 1.4, z: me.pos.z }, { x: me.pos.x + f.x * (d + 3), y: 1.4, z: me.pos.z + f.z * (d + 3) })) d += 3;
    if (d > bestD) { bestD = d; best = y; }
  }
  const aim = h === 'hayate' ? 0 : best;
  g.input.yaw = aim; g.input.pitch = 0.05; me.yaw = aim; window.__aim = aim;
  const foes = w.actors.filter(a => a.team !== me.team);
  if (h === 'hayate') foes.slice(0, 3).forEach((f, i) => { f.pos = { x: -32 + i * 1.5, y: 0, z: 16 + i }; f.hp = f.maxHp = 1e5; });   // in slash range
  return { foes: foes.length, loaded: !!g.fx?.dragons, aim: +aim.toFixed(2), clear: bestD };
}, hero);
await wait(2500);   // let the dragon GLB finish loading
await p.evaluate(() => { const g = window.__zu.game, me = g.match.player; me.ult = me.def.ult.charge; g.input.keys.add('KeyQ'); });
await wait(120);
await p.evaluate(() => { window.__zu.game.input.keys.delete('KeyQ'); });
const times = hero === 'hayate' ? [250, 450, 250, 300] : [350, 250, 300, 400];
// Hayate: Dragon Gate Blade is a 15 s Genji-style blade state - the dragon coils up on the draw, then every slash streaks it
if (hero === 'hayate') setTimeout(() => p.evaluate(() => { window.__zu.game.input.mouse.l = true; }).catch(() => {}), 700);
let n = 0;
for (const ms of times) {
  await wait(ms);
  // step 12 m to the side of the torrent and face it: the dragons keep their cast line, the camera sees the helix side-on
  if (hero === 'seiran' && n === 0) await p.evaluate(() => {
    const g = window.__zu.game, me = g.match.player, y = window.__aim, f = { x: Math.sin(y), z: Math.cos(y) }, sd = { x: Math.cos(y), z: -Math.sin(y) };
    me.pos = { x: -31 + f.x * 15 + sd.x * 16, y: 0, z: 13 + f.z * 15 + sd.z * 16 }; g.input.yaw = Math.atan2(-sd.x, -sd.z); g.input.pitch = 0.1;
  });
  await p.screenshot({ path: `tests/e2e/shots/dragon_${hero}_${++n}.png` });
}
console.log('setup', JSON.stringify(setup), 'errors', errs.slice(0, 4));
await b.close(); process.exit(0);
