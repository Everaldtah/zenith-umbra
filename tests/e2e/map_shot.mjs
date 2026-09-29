// node tests/e2e/map_shot.mjs lantern,starfall,foundry [shots] [port] -> tests/e2e/shots/mapshot_<id>_<i>.png
// Spectate flyover of each map (no HUD): a few frames along the spectate camera's path.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [ids = 'lantern', n = '3', port = '5199'] = process.argv.slice(2);
const out = 'tests/e2e/shots'; fs.mkdirSync(out, { recursive: true });
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const zu = (fn, ...a) => p.evaluate(fn, ...a);
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded' }); await wait(2500);
for (const id of ids.split(',')) {
  await zu(id => { const M = window.__zu.menu; M.queue = null; M.mode = 'spectate'; M.map = id; return M.launch(); }, id);
  for (let i = 0; i < 60 && !(await zu(id => window.__zu.game?.match?.world?.map.id === id && window.__zu.game.running, id)); i++) await wait(500);
  await wait(6000);                                        // props stream in
  for (let k = 0; k < +n; k++) { await p.screenshot({ path: `${out}/mapshot_${id}_${k}.png` }); console.log('shot', id, k); await wait(4000); }
  await zu(() => window.__zu.game.stop());
}
console.log('errors', errs.length, errs.slice(0, 3).join('\n'));
await b.close();
