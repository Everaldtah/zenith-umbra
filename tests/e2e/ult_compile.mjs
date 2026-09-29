// Does using a hero's kit compile a shader program mid-match? (a hitch the first time it is used.) The match is launched
// through the menu, so the preloader has run; then SHIFT (+ SPACE), E, RMB and the ult are used in turn and every
// program that was not in the cache after the preload is reported with the objects that use it and how its cache key
// differs from the closest preloaded one. Found this way: the Grand Dohyo's ring and wall (a zone, not an effect the
// preloader fires) compiled on the first ult of a match.
//   node tests/e2e/ult_compile.mjs [port] [hero] [map]          (ELECTRON_UA=1: a static serve of the installed build)
import puppeteer from 'puppeteer-core';
const [port = '5210', hero = 'seiran', map = 'kagura'] = process.argv.slice(2);
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 280000);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const ua = process.env.ELECTRON_UA ? '?platform=desktop' : '';
if (process.env.ELECTRON_UA) await p.setUserAgent((await b.userAgent()) + ' Electron/33.0.0');
await p.goto(`http://localhost:${port}/play.html${ua}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 60 && !(await p.evaluate(() => !!window.__zu?.menu)); i++) await wait(500);
p.on('console', m => { if (m.text().startsWith('[preload]')) console.log(m.text().slice(0, 200)); });
await p.evaluate((m, h) => { const z = window.__zu.menu; z.queue = 'practice'; z.mode = 'practice'; z.map = m; z.hero = h; void z.launch(); }, map, hero);
// the baseline is taken the moment the preload reports (the loading screen still up)
for (let i = 0; i < 1200 && !(await p.evaluate(() => !!window.__zu.game.preloadStats && (window.__zu.game.renderer.info.programs?.length ?? 0) > 0)); i++) await wait(100);
const base = await p.evaluate(() => { const g = window.__zu.game; window.__keys = new Set(); window.__all = []; for (const q of g.renderer.info.programs ?? []) { window.__keys.add(q.cacheKey); window.__all.push(q.cacheKey); } window.__armed = true; return window.__all.length; });
console.log('programs at the end of the preload', base);
for (let i = 0; i < 240 && !(await p.evaluate(() => window.__zu.game.running)); i++) await wait(500);
await wait(1500);
await p.evaluate(() => { const z = window.__zu; z.menu?.close?.(); if (z.game.paused) z.game.setPaused(false); });
const snap = () => p.evaluate(() => {
  const g = window.__zu.game; window.__keys ??= new Set();
  const out = [];
  for (const q of g.renderer.info.programs ?? []) if (!window.__keys.has(q.cacheKey)) {
    const first = window.__keys.size === 0 || window.__armed;
    window.__all ??= [];
    if (window.__armed) {
      const a = q.cacheKey.split(','); let best = null, bd = 1e9;
      for (const k of window.__all) { const c = k.split(','); if (c.length !== a.length) continue; const d = a.filter((x, i) => x !== c[i]).length; if (d < bd) { bd = d; best = c; } }
      const users = []; g.scene.traverse(o => { const ms = o.material; for (const m of Array.isArray(ms) ? ms : ms ? [ms] : []) { const pr = g.renderer.properties.get(m); if (pr?.currentProgram === q) { let path = o.type, x = o.parent; while (x) { path += '<' + (x.name || x.type); x = x.parent; } users.push(path + ' verts ' + (o.geometry?.attributes?.position?.count ?? '?') + ' frag ' + (m.fragmentShader ?? '').length); } } });
      out.push({ name: q.name, users: users.slice(0, 3), diff: best ? a.map((x, i) => x !== best[i] ? `#${i} ${String(best[i]).slice(0, 40)}->${String(x).slice(0, 40)}` : null).filter(Boolean) : 'no same-shape key' });
    }
    void first;
    window.__keys.add(q.cacheKey); window.__all.push(q.cacheKey);
  }
  return { programs: g.renderer.info.programs?.length ?? 0, fresh: out };
});
let total = 0;
{ const s = await snap(); total += s.fresh.length; console.log('match start', JSON.stringify(s)); }
await wait(3000);
{ const s = await snap(); total += s.fresh.length; console.log('3 s of play', JSON.stringify(s)); }
const use = async (label, code, after = 1500, then) => {
  await p.evaluate(c => { const g = window.__zu.game, me = g.match.player; me.hp = me.maxHp = 1e6; me.ult = me.def.ult.charge; for (const k of Object.keys(me.cd)) me.cd[k] = 0; if (c === 'RMB') g.input.mouse.r = true; else g.input.keys.add(c); }, code);
  await wait(150);
  await p.evaluate(c => { const g = window.__zu.game; if (c === 'RMB') g.input.mouse.r = false; else g.input.keys.delete(c); }, code);
  if (then) { await wait(400); await p.evaluate(c => window.__zu.game.input.keys.add(c), then); await wait(150); await p.evaluate(c => window.__zu.game.input.keys.delete(c), then); }
  await wait(after);
  const s = await snap(); total += s.fresh.length;
  console.log(label, JSON.stringify(s));
};
await use('SHIFT (+SPACE)', 'ShiftLeft', 2000, 'Space');
await use('E', 'KeyE');
await use('RMB', 'RMB');
await use('ult', 'KeyQ', 3000);
console.log(`SUMMARY ${hero}: ${total} shader program(s) compiled mid-match`);
await b.close(); process.exit(0);
