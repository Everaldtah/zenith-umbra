// Launch the installed Windows app with a debug port and inspect it: node tests/e2e/desktop_check.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
const exe = path.join(process.env.LOCALAPPDATA, 'Programs', 'ZenithUmbra', 'ZenithUmbra.exe');
const proc = spawn(exe, ['--remote-debugging-port=9333'], { detached: false, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 7000));
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
const [p] = (await b.pages()).filter(x => x.url().includes('play.html'));
const errs = []; p.on('pageerror', e => errs.push(e.message));
// the app must be the full edition: full title menu, the new maps, Gantetsu, the clip library
const edition = await p.evaluate(async () => ({ title: [...document.querySelectorAll('.title button')].map(b => b.firstChild.textContent.trim()).slice(0, 4),
  clips: !!(await window.__zu.anim), ua: /Electron/.test(navigator.userAgent) }));
console.log('edition', JSON.stringify(edition));
await p.evaluate(() => { const m = window.__zu.menu; m.queue = 'practice'; m.mode = 'practice'; m.map = 'kagura'; m.hero = 'gantetsu'; m.launch(); });
await new Promise(r => setTimeout(r, 20000));
const f0 = await p.evaluate(() => window.__zu.game.framesRendered);
await new Promise(r => setTimeout(r, 5000));
const info = await p.evaluate(f0 => { const g = window.__zu.game; const c = g.renderer.getContext(); const e = c.getExtension('WEBGL_debug_renderer_info');
  return { fps: (g.framesRendered - f0) / 5, preset: g.settings.preset, pixelRatio: g.renderer.getPixelRatio(), size: [innerWidth, innerHeight], gpu: e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?', shadows: g.renderer.shadowMap.enabled, url: location.href }; }, f0);
console.log(JSON.stringify(info, null, 1));
console.log('match', JSON.stringify(await p.evaluate(() => { const w = window.__zu.game.match.world; return { map: w.map.id, rules: w.rules, packs: w.packs.length, me: w.actors.find(a => a === window.__zu.game.match.player)?.def.id }; })), 'errors', errs.slice(0, 3));
const ft = await p.evaluate(() => new Promise(res => { const d = []; let last = performance.now(); const f = t => { d.push(t - last); last = t; if (d.length < 300) requestAnimationFrame(f); else res(d); }; requestAnimationFrame(f); }));
ft.sort((a, b) => a - b);
const q = k => ft[Math.floor(ft.length * k)].toFixed(1);
console.log('frame ms p10', q(0.1), 'p50', q(0.5), 'p90', q(0.9), 'p99', q(0.99), 'over20ms', ft.filter(x => x > 20).length, '/', ft.length);
const cpu = await p.evaluate(() => { const g = window.__zu.game; const t0 = performance.now(); for (let i = 0; i < 60; i++) g.match.world.step(1 / 120); const sim = (performance.now() - t0) / 60; const t1 = performance.now(); for (const v of g.views.values()) v.update(1 / 60, g.match.world.time, { team: 'zenith', sees: () => true }); const anim = performance.now() - t1; return { simMsPerStep: sim.toFixed(2), animMsAllViews: anim.toFixed(2) }; });
console.log(JSON.stringify(cpu));
await p.screenshot({ path: 'tests/e2e/shots/desktop_app.png' });
b.disconnect(); proc.kill();
