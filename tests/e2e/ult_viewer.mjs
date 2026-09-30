// Ult Viewer check: Hero Viewer > ULT VIEWER for each hero, screenshots through the cast, reports whether the ult fired.
//   node tests/e2e/ult_viewer.mjs [url] [ids]      (shots in tests/e2e/shots/ult/<id>_<n>.png)
//   SPAN=16: eight shots spread over 16 s (long ults: Hex's puppet army)
//   STRIP=1: after the first hero, switch with the Ult Viewer's portrait strip instead of going back to the Hero Viewer
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
let [url = 'http://localhost:5199/play.html', idsArg = ''] = process.argv.slice(2);
// the desktop edition's ults (heroes.ts FULL ? ... : ...) need the dev server told it's the desktop, or the web ult loads
if (!/platform=/.test(url)) url += (url.includes('?') ? '&' : '?') + 'platform=desktop';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1600, height: 900 } });
setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 30 * 60 * 1000);
const p = await b.newPage();
const errs = []; let reloads = 0; p.on('framenavigated', f => { if (f === p.mainFrame()) reloads++; }); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(url, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 1500));
const sleep = ms => new Promise(r => setTimeout(r, ms));
// the playable roster: the viewer's first two rows (Zenith, Umbra) - pilots and campaign models have no ult
const ids = idsArg ? idsArg.split(',') : await p.evaluate(() => { window.__zu.menu.viewer(); return [...document.querySelectorAll('.vrow')].slice(0, 2).flatMap(r => [...r.querySelectorAll('.vchip')].map(e => e.dataset.h)); });
fs.mkdirSync('tests/e2e/shots/ult', { recursive: true });
const out = {};
const STRIP = !!process.env.STRIP;
for (const [k, id] of ids.entries()) {
  const t0 = Date.now();
  if (STRIP && k > 0) {
    // the Ult Viewer's own hero strip
    await p.click(`.ultsc .upick [data-h="${id}"]`);
  } else {
    // open the viewer on the hero and press the button, as a player would
    await p.evaluate(id => window.__zu.menu.viewer(id), id);
    await sleep(600);
    const shown = await p.evaluate(() => { const b = document.querySelector('.vult'); if (!b || b.style.display === 'none') return false; b.click(); return true; });
    if (!shown) { out[id] = { error: 'no ULT VIEWER button' }; continue; }
  }
  await p.waitForFunction(id => { const g = window.__zu.menu.game; return g.running && g.match?.world.actors[0].baseDef.id === id && g.match.world.actors[0].controller?.phase && document.querySelector('.ultsc'); }, { timeout: 180000 }, id);
  const loadMs = Date.now() - t0;
  const st = () => p.evaluate(() => { const g = window.__zu.menu.game; if (!g.match) return { gone: true }; const w = g.match.world, c = w.actors[0].controller, h = w.actors[0];
    return { phase: c.phase, ults: h.ults, t: +w.time.toFixed(2), scale: +h.scale.toFixed(2), foes: c.foes.filter(d => d.alive).length, foeHp: Math.round(c.foes.reduce((s, d) => s + (d.alive ? d.hp : 0), 0)), friendsHp: c.friends.map(d => Math.round(d.hp + d.shieldAmt)), ui: !!document.querySelector('.ultsc'), label: c.step }; });
  // wait for the cast, then shoot the ult as it plays
  await p.waitForFunction(() => window.__zu.menu.game.match.world.actors[0].controller.phase === 'show', { timeout: 20000 }).catch(() => {});
  const seq = [];
  // SPAN=<seconds>: 8 shots spread over a long ult instead of the first 4 s
  const SPAN = +(process.env.SPAN ?? 0);
  for (const [n, ms] of SPAN ? Array.from({ length: 8 }, (_, i) => [i + 1, i ? SPAN * 1000 / 8 : 300]) : [[1, 250], [2, 900], [3, 1300], [4, 1600]]) {
    await sleep(ms);
    seq.push(await st());
    await p.screenshot({ path: `tests/e2e/shots/ult/${id}_${n}.png` });
  }
  // a lost WebGL context draws black (the browser's context cap drops the oldest context - the game's)
  const ctxLost = await p.evaluate(() => window.__zu.menu.game.renderer.getContext().isContextLost());
  out[id] = { loadMs, fired: seq.some(s => s.ults > 0), ctxLost, seq };
  console.log(id, JSON.stringify(out[id]));
  // back to the Hero Viewer (Esc path)
  if (!STRIP) { await p.evaluate(() => window.__zu.menu.game.onExit?.()); await sleep(500); }
}
fs.writeFileSync('tests/e2e/shots/ult/info.json', JSON.stringify(out, null, 1));
console.log('errors', JSON.stringify(errs.slice(0, 8)), 'page loads', reloads);
// (browser.close() can hang on the GPU process after many matches)
await Promise.race([b.close(), sleep(5000)]);
process.exit(0);
