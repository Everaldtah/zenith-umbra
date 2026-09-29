// Ragdoll deaths in a real match (desktop edition, real GPU):
//   node tests/e2e/ragdoll_shot.mjs [victims] [dmg] [times]
//   node tests/e2e/ragdoll_shot.mjs kaien,gantetsu,tomoe 2000 0.05,0.35,0.8,1.6
// Three heroes stand 7m in front of the player (third-person camera); the player kills each with one hit of `dmg`, and
// the fall is shot at each time after the kill. Writes tests/e2e/shots/ragdoll_<t>.png and prints where each body lies.
import puppeteer from 'puppeteer-core';
const [victims = 'kaien,gantetsu,tomoe', dmg = '2000', times = '0.05,0.35,0.8,1.6'] = process.argv.slice(2);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errors = [];
p.on('pageerror', e => errors.push(String(e)));
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text().slice(0, 300)); });
await p.goto('http://localhost:5199/play.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 60 && !(await p.evaluate(() => !!window.__zu?.game)); i++) await wait(500);
await p.evaluate(() => window.__zu.game.start({ mode: 'training', map: 'training', hero: 'raijin' }));
for (let i = 0; i < 80 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
await p.evaluate(ids => {
  const g = window.__zu.game, w = g.match.world, me = g.match.player;
  window.__zu.menu.close?.(); g.settings.view = 'third'; me.hp = 1e5;
  // clear the range: the training bots out of the way
  for (const a of w.actors) if (a.isRobot) { a.pos = { x: 0, y: -200, z: 0 }; a.alive = false; a.respawnAt = 1e9; }
  me.pos = { x: -10, y: w.level.groundAt(-10, -12, 30), z: -12 }; me.vel = { x: 0, y: 0, z: 0 };
  me.yaw = me.input.yaw = 0; me.pitch = me.input.pitch = -0.12;
  g.input.yaw = 0; g.input.pitch = -0.12; g.camYaw = 0; g.camPitch = -0.12;       // the mouse-look state drives the player's aim
  window.__rag = ids.split(',').map((id, k) => {
    const a = w.addHero(id, 'umbra');
    const x = -15.8 + k * 2.5, z = -4.5;             // on the camera's line (it rides over his right shoulder, -x)
    a.pos = { x, y: w.level.groundAt(x, z, 30), z }; a.vel = { x: 0, y: 0, z: 0 }; a.yaw = a.input.yaw = Math.PI; a.clear('spawnprot');
    a.controller = null; a.respawnAt = 1e9;
    return a;
  });
}, victims);
const live = () => p.evaluate(() => { const z = window.__zu; z.menu?.close?.(); if (z.game.paused) z.game.setPaused(false); z.menu?.close?.(); });
for (let i = 0; i < 7; i++) { await live(); await wait(500); }     // models stream in (headless Chrome refuses pointer lock, which pauses the game)
console.log('before', await p.evaluate(() => { const g = window.__zu.game; return window.__rag.map(a => { const v = g.views.get(a.id); return `${a.def.id} pos=${a.pos.x.toFixed(1)},${a.pos.z.toFixed(1)} grp=${v?.group.position.x.toFixed(1)},${v?.group.position.z.toFixed(1)} inScene=${!!v?.group.parent} vis=${v?.group.visible}`; }).join(' | ') + ' cam=' + g.camera.position.toArray().map(x => x.toFixed(1)) + ' time=' + g.match.world.time.toFixed(1) + ' paused=' + g.paused; }));
console.log('los', await p.evaluate(() => { const g = window.__zu.game, w = g.match.world, c = g.camera.position; return window.__rag.map(a => { const d = { x: a.pos.x - c.x, y: a.pos.y + 1 - c.y, z: a.pos.z - c.z }, L = Math.hypot(d.x, d.y, d.z); const h = w.level.ray({ x: c.x, y: c.y, z: c.z }, { x: d.x / L, y: d.y / L, z: d.z / L }, L); const v = g.views.get(a.id); const P = v.group.getWorldPosition(new v.group.position.constructor()); P.y += 1; const n = P.clone().project(g.camera); let meshes = 0, vis = 0; v.group.traverse(o => { if (o.isMesh) { meshes++; let q = o, ok = true; while (q) { if (!q.visible) ok = false; q = q.parent; } if (ok) vis++; } }); return `${a.def.id} ndc=${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(3)} meshes=${meshes} visMeshes=${vis} layers=${v.group.layers.mask} dist=${L.toFixed(1)} hit=${h ? h.t.toFixed(1) : '-'} inWall=${w.level.collide({ ...a.pos }, 0.3, 1.5)}`; }).join(' | '); }));
await p.screenshot({ path: 'tests/e2e/shots/ragdoll_before.png' });
const T = times.split(',').map(Number);
await live();
const SLOW = Number(process.env.SLOW ?? 4);      // shoot the fall in slow motion: game time = wall time / SLOW
await p.evaluate(k => { window.__zu.game.timeScale = 1 / k; }, SLOW);
await p.evaluate(d => { const g = window.__zu.game, w = g.match.world, me = g.match.player; for (const a of window.__rag) { a.hp = 30; a.armor = 0; w.damage(me, a, d); a.respawnAt = w.time + 60; } }, Number(dmg));
const t0 = Date.now();
for (const t of T) {
  const at = t * 1000 * SLOW - (Date.now() - t0);
  if (at > 0) await wait(at);
  await live();
  await p.screenshot({ path: `tests/e2e/shots/ragdoll_${t}.png` });
}
console.log(await p.evaluate(() => window.__rag.map(a => `${a.def.id} alive=${a.alive} dmg=${(a.sv.lastHitDmg ?? 0).toFixed(0)}`).join(' | ')));
console.log('errors', errors.slice(0, 5));
await b.close();
