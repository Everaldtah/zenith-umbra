// The match preloader (src/client/Preload.ts): launch a match through the menu, report what the preload did (time per
// phase, textures uploaded, shader programs), shoot the loading screen's progress bar, then record the first seconds of
// play: the worst frame each second and whether any new shader program had to be compiled mid-match.
//   node tests/e2e/preload_check.mjs [map] [hero] [secs] [port]      (dev server; desktop app: DESKTOP=1)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
const [map = 'kagura', hero = 'gantetsu', secs = '30', port = '5199'] = process.argv.slice(2);
const wait = ms => new Promise(r => setTimeout(r, ms));
let b, p, proc;
if (process.env.DESKTOP) {
  const exe = path.join(process.env.LOCALAPPDATA, 'Programs', 'ZenithUmbra', 'ZenithUmbra.exe');
  proc = spawn(exe, ['--remote-debugging-port=9335'], { detached: false, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await (await fetch('http://127.0.0.1:9335/json/version')).json(); break; } catch { await wait(1000); } }
  await wait(3000);
  b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9335', defaultViewport: null });
  [p] = (await b.pages()).filter(x => x.url().includes('play.html'));
} else {
  b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
  p = await b.newPage();
  await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  for (let i = 0; i < 60 && !(await p.evaluate(() => !!window.__zu?.menu)); i++) await wait(500);
}
const errors = [];
p.on('pageerror', e => errors.push(String(e)));
p.on('console', m => { if (m.text().startsWith('[preload]')) console.log(m.text()); });
const t0 = Date.now();
await p.evaluate((m, h) => { const z = window.__zu.menu; z.queue = 'practice'; z.mode = 'practice'; z.map = m; z.hero = h; void z.launch(); }, map, hero);
let shot = false;
for (let i = 0; i < 240 && !(await p.evaluate(() => window.__zu.game.running)); i++) {
  await wait(500);
  if (!shot && await p.evaluate(() => !!document.querySelector('.loading .preload'))) {
    const lbl = await p.evaluate(() => document.querySelector('.loading .preload span')?.textContent);
    if (lbl && !/0%$/.test(lbl)) { await p.screenshot({ path: 'tests/e2e/shots/preload_bar.png' }); shot = true; console.log('bar:', lbl); }
  }
}
console.log('loading took', ((Date.now() - t0) / 1000).toFixed(1), 's; stats', JSON.stringify(await p.evaluate(() => window.__zu.game.preloadStats)));
await wait(700);
await p.evaluate(() => { const z = window.__zu; z.menu?.close?.(); if (z.game.paused) z.game.setPaused(false); });
// per second: frames, worst frame, shader programs in the cache
const res = await p.evaluate(async (n, showKeys) => {
  const g = window.__zu.game, out = [];
  let progs = g.renderer.info.programs?.length ?? 0;
  const seen = new Set((g.renderer.info.programs ?? []).map(q => q.cacheKey));
  const keys = [...seen];
  // a new program: which fields of its cache key differ from the closest one compiled during the preload
  const fresh = () => { const n = []; for (const q of g.renderer.info.programs ?? []) if (!seen.has(q.cacheKey)) {
    seen.add(q.cacheKey); const a = q.cacheKey.split(',');
    // who uses it: the scene objects whose material currently runs this program
    const users = []; for (const sc of [g.scene, g.fp?.scene].filter(Boolean)) sc.traverse(o => { const ms = o.material; for (const m of Array.isArray(ms) ? ms : ms ? [ms] : []) { const pr = g.renderer.properties.get(m); if (pr?.currentProgram === q || (pr?.programs && [...pr.programs.values()].includes(q))) { let path = [], x = o; while (x && path.length < 9) { path.push((x.name || x.type) + (x.isInstancedMesh ? '[inst]' : '') + (x.userData?.body ? '[held]' : '')); x = x.parent; } users.push(m.type + ` '${m.name}' map=${!!m.map} vc=${m.vertexColors} verts=${o.geometry?.attributes?.position?.count} @ ` + path.join(' < ')); } } });
    let best = null, bd = 1e9; for (const k of keys) { const b = k.split(','); if (b.length !== a.length) continue; const d = a.filter((x, i) => x !== b[i]).length; if (d < bd) { bd = d; best = b; } }
    n.push('users: ' + (users.slice(0, 3).join(' | ') || 'none in scene') + ' ; ' + q.name + ' diff: ' + (best ? a.map((x, i) => x !== best[i] ? `#${i} ${best[i]}->${x}` : null).filter(Boolean).join(' ') : 'no same-shape key, len ' + a.length) + (showKeys ? ' || NEW ' + q.cacheKey.slice(0, 700) + ' || WARM ' + (best ?? []).join(',').slice(0, 700) : ''));
  } return n; };
  for (let s = 0; s < n; s++) {
    if (g.paused) g.setPaused(false);
    const d = []; let last = performance.now(), t1 = last;
    await new Promise(res => { const f = t => { d.push(t - last); last = t; if (t - t1 < 1000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const now = g.renderer.info.programs?.length ?? 0;
    // where a frame's time goes right now
    const w = g.match.world, T = f => { const a = performance.now(); f(); return (performance.now() - a).toFixed(1); };
    const sim = T(() => w.step(1 / 120)), views = T(() => { for (const v of g.views.values()) v.update(1 / 60, w.time, { team: 'zenith', sees: () => true }); });
    const fx = T(() => g.fx.update(1 / 60, w, w.time)), ren = T(() => { if (g.composer) g.composer.render(); else g.renderer.render(g.scene, g.camera); });
    const dead = w.actors.filter(a => !a.alive).length, objs = (() => { let n = 0; g.scene.traverse(() => n++); return n; })(), lights = (() => { let n = 0; g.scene.traverse(o => { if (o.isLight) n++; }); return n; })();
    const census = () => { const c = {}; g.scene.traverseVisible(o => { if (o.isLight) { const k = o.type + (o.castShadow ? '*' : ''); c[k] = (c[k] ?? 0) + 1; } }); return JSON.stringify(c); };
    const nf = fresh(); if (nf.length) out.push({ s: s + 1, fresh: [...nf, 'lights ' + census()] });
    out.push({ s: s + 1, frames: d.length, worst: Math.round(Math.max(...d)), newPrograms: now - progs, sim, views, fx, ren, dead, objs, lights, calls: g.renderer.info.render.calls, tex: g.renderer.info.memory.textures, geo: g.renderer.info.memory.geometries });
    progs = now;
  }
  return out;
}, Number(secs), !!process.env.KEYS);
for (const r of res.filter(r => r.fresh)) console.log('NEW PROGRAMS at', r.s + 's', JSON.stringify(r.fresh));
for (const r of res.filter(r => !r.fresh)) console.log(`${r.s}s frames=${r.frames} worst=${r.worst}ms newPrograms=${r.newPrograms} | sim ${r.sim} views ${r.views} fx ${r.fx} render ${r.ren} dead ${r.dead} objs ${r.objs} lights ${r.lights} calls ${r.calls} tex ${r.tex} geo ${r.geo}`);
const R = res.filter(r => !r.fresh);
const worst = R.reduce((a, r) => Math.max(a, r.worst), 0), hitches = R.filter(r => r.worst > 50).length, np = R.reduce((a, r) => a + r.newPrograms, 0);
console.log(`SUMMARY worst frame ${worst} ms, seconds with a >50 ms hitch ${hitches}/${R.length}, shaders compiled mid-match ${np}, errors ${errors.length}`, errors.slice(0, 3));
if (process.env.DESKTOP) { await b.disconnect(); proc.kill(); } else await b.close();
