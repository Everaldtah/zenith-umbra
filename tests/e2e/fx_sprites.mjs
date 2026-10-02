// node tests/e2e/fx_sprites.mjs [map] [port] -> tests/e2e/shots/fxs_<map>_<n>.png
// Gunfire effects (WeaponFx) driven directly, no aiming needed: a burst of rounds into the ground and into a wall-like
// plane 6 m ahead of a fixed camera - flashes, sparks, smoke, scorch marks, dust kicks - shot mid-burst and after.
import puppeteer from 'puppeteer-core';
const [map = 'gulch', port = '5199'] = process.argv.slice(2);
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); else if (m.text().startsWith('proj')) console.log(m.text()); });
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded' }); await wait(2500);
await p.evaluate(id => { const M = window.__zu.menu; M.queue = null; M.mode = 'spectate'; M.map = id; return M.launch(); }, map);
for (let i = 0; i < 60 && !(await p.evaluate(id => window.__zu.game?.match?.world?.map.id === id && window.__zu.game.running, map)); i++) await wait(500);
await wait(4000);
await p.evaluate(() => {
  const g = window.__zu.game, m = g.match.world.map, lv = g.match.world.level;
  const [sx, sz] = m.spawns.zenith, [tx, , tz] = m.point, fx = sx + (tx - sx) * 0.18, fz = sz + (tz - sz) * 0.18;
  const gy = Math.max(0, lv.groundAt(fx, fz, 30));
  g.freeCam = true; g.input.locked = true; g.camera.position.set(fx, gy + 1.7, fz);
  g.input.yaw = Math.atan2(tx - fx, tz - fz); g.input.pitch = -0.18;
  window.__burst = (k) => {
    const w = g.fx.wfx, now = g.match.world.time, c = g.camera.position, yaw = g.input.yaw;
    const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) }, rt = { x: -Math.cos(yaw), z: Math.sin(yaw) };
    for (let i = 0; i < 6; i++) {
      const s = (Math.random() - 0.5) * 2.4, d = 3.2 + Math.random() * 1.6;
      const gp = { x: c.x + fwd.x * d + rt.x * s, y: gy + 0.01, z: c.z + fwd.z * d + rt.z * s };
      w.tracer({ x: c.x + rt.x * 0.4, y: c.y - 0.3, z: c.z + rt.z * 0.4 }, gp, '#ffb347', now, {});
      w.impact(gp, { x: 0, y: 1, z: 0 }, '#ffb347', now, k % 3 === 0);
      const wp = { x: c.x + fwd.x * 6 + rt.x * (s + 1.8), y: gy + 0.8 + Math.random() * 1.4, z: c.z + fwd.z * 6 + rt.z * (s + 1.8) };
      w.impact(wp, { x: -fwd.x, y: 0, z: -fwd.z }, '#7fd3ff', now, false);
      if (k === 0 && i === 0) { const v = new g.camera.position.constructor(gp.x, gp.y, gp.z).project(g.camera); console.log('proj', v.x.toFixed(2), v.y.toFixed(2), v.z.toFixed(3)); }
      w.muzzle({ x: c.x + fwd.x * 1.4 + rt.x * 0.35, y: c.y - 0.25, z: c.z + fwd.z * 1.4 + rt.z * 0.35 }, '#ffcf6b', now, 0.45, true);
    }
  };
});
for (let k = 0; k < 8; k++) { await p.evaluate(k => window.__burst(k), k); await wait(70); }
await p.screenshot({ path: `tests/e2e/shots/fxs_${map}_1.png` });
await wait(250); await p.screenshot({ path: `tests/e2e/shots/fxs_${map}_2.png` });
await wait(1500); await p.screenshot({ path: `tests/e2e/shots/fxs_${map}_3.png` });
console.log('errors', errs.length, errs.slice(0, 3).join('\n'));
await b.close();
