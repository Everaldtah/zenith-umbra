// node tests/e2e/render_ab.mjs [maps] [port] -> tests/e2e/shots/ab_<map>_<pose>_<classic|new>.png + mean luminance
// Same camera, two renderings: ?classic (painted albedo, studio-room lighting, no grade) vs the desktop surfaces
// (CC0 PBR, map HDRI, grade). Poses: from each team's spawn toward the objective, eye height + 0.6 m.
// tests/e2e/tile_ab.py makes the side-by-side sheet and prints each frame's mean luminance.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [ids = 'hanabi', port = '5199'] = process.argv.slice(2);
const out = 'tests/e2e/shots'; fs.mkdirSync(out, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const errs = [];
for (const mode of ['classic', 'new']) {
  const p = await b.newPage();
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`http://localhost:${port}/play.html${mode === 'classic' ? '?classic' : ''}`, { waitUntil: 'domcontentloaded' }); await wait(2500);
  for (const id of ids.split(',')) {
    await p.evaluate(id => { const M = window.__zu.menu; M.queue = null; M.mode = 'spectate'; M.map = id; return M.launch(); }, id);
    for (let i = 0; i < 60 && !(await p.evaluate(id => window.__zu.game?.match?.world?.map.id === id && window.__zu.game.running, id)); i++) await wait(500);
    await wait(5000);
    for (const pose of [0, 1]) {
      await p.evaluate(async pose => {
        const g = window.__zu.game, m = g.match.world.map, lv = g.match.world.level;
        const [sx, sz] = pose ? m.spawns.umbra : m.spawns.zenith, [tx, , tz] = m.point;
        const fx = sx + (tx - sx) * 0.18, fz = sz + (tz - sz) * 0.18;
        const y = Math.max(0, lv.groundAt(fx, fz, 30)) + 2.3;
        g.freeCam = true; g.input.locked = true;
        g.camera.position.set(fx, y, fz);
        g.input.yaw = Math.atan2(tx - fx, tz - fz); g.input.pitch = -0.12;
        await new Promise(r => setTimeout(r, 900));
      }, pose);
      await p.screenshot({ path: `${out}/ab_${id}_${pose}_${mode}.png` });
      console.log('shot', id, pose, mode);
    }
    await p.evaluate(() => window.__zu.game.stop());
  }
  await p.close();
}
console.log('errors', errs.length, errs.slice(0, 3).join('\n'));
await b.close();
