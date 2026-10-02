// Engine smoothness + cost benchmark of a live AI match (FULL edition, desktop 120 Hz sim):
//   node tests/e2e/engine_bench.mjs [port] [map] [secs] [cap] [vsync]
//     cap   = the game's fps cap setting (0 = none)          vsync = 1 keeps Chrome's vsync (60 Hz headless), 0 = uncapped
//   ENGINE=0 in the env adds ?engine=0 (the engine core off, for A/B).  OUT=<file> also writes the JSON.
// Reports frame pacing (mean / p99 / 1% low / stutters), sim steps per frame, per-phase CPU ms, GPU ms when the
// timer-query extension exists, and MOTION JITTER: how evenly moving heroes advance on screen frame to frame
// (rendered speed / sim speed; 0 = perfectly even, the judder of uneven sim steps shows up here).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [port = '5263', map = 'mile', secs = '12', cap = '0', vsync = '1'] = process.argv.slice(2);
const wait = ms => new Promise(r => setTimeout(r, ms));
const args = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1920,1080'];
if (vsync === '0') args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 300000, args, defaultViewport: { width: 1920, height: 1080 } });
const p = await b.newPage();
p.on('pageerror', e => console.error('pageerror', e.message));
await p.evaluateOnNewDocument(() => { localStorage.setItem('zu-settings-v1', JSON.stringify({ preset: 'ultra', showFps: true })); });
const extra = process.env.ENGINE === '0' ? '&engine=0' : '';
await p.goto(`http://localhost:${port}/play.html?mode=aitest&map=${map}&platform=desktop${extra}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 360 && !(await p.evaluate(() => !!(window.__zu?.game?.running && window.__zu.game.match))); i++) await wait(500);
await p.evaluate(c => { const g = window.__zu.game; g.settings.video.fpsCap = c; g.applySettings(g.settings); }, Number(cap));
await wait(5000);
const out = await p.evaluate(async s => {
  const g = window.__zu.game, w = g.match.world;
  const frames = [];                       // per game frame: { t, cpu, steps, sim, views, fx, ren }
  let cur = null;
  const wrap = (obj, key, field) => { const f = obj[key]; obj[key] = function (...a) { const t0 = performance.now(); try { return f.apply(this, a); } finally { if (cur) cur[field] += performance.now() - t0; } }; return () => { obj[key] = f; }; };
  const undo = [];
  undo.push(wrap(w, 'step', 'sim'));
  const origStep = w.step; w.step = function (...a) { if (cur) cur.steps++; return origStep.apply(this, a); }; undo.push(() => { w.step = origStep; });
  undo.push(wrap(g.fx, 'update', 'fx'));
  if (g.composer) undo.push(wrap(g.composer, 'render', 'ren')); else undo.push(wrap(g.renderer, 'render', 'ren'));
  const viewProto = Object.getPrototypeOf(g.views.values().next().value);
  undo.push(wrap(viewProto, 'update', 'views'));
  // motion: rendered displacement of each moving hero's view vs its sim speed
  const lastPos = new Map(); const ratios = [];
  const loop0 = g.loop;
  let lastT = 0;
  g.loop = function (t) {
    cur = { t, cpu: 0, steps: 0, sim: 0, views: 0, fx: 0, ren: 0 };
    const t0 = performance.now();
    const before = g.framesRendered;
    loop0.call(this, t);
    cur.cpu = performance.now() - t0;
    if (g.framesRendered !== before) {
      frames.push(cur);
      const dt = (t - lastT) / 1000; lastT = t;
      for (const v of g.views.values()) {
        // only heroes moving steadily (velocity within 3% of the last frame's), so bots' strafing isn't counted as judder
        const a = v.actor, gp = v.group.position, lp = lastPos.get(v);
        const sp = Math.hypot(a.vel.x, a.vel.z);
        const steady = lp && Math.hypot(a.vel.x - lp.vx, a.vel.z - lp.vz) < sp * 0.03;
        if (steady && a.alive && sp > 3 && dt > 0 && dt < 0.05) ratios.push(Math.hypot(gp.x - lp.x, gp.z - lp.z) / dt / sp);
        lastPos.set(v, { x: gp.x, z: gp.z, vx: a.vel.x, vz: a.vel.z });
      }
    }
    cur = null;
  };
  // GPU time via the timer-query extension (if the browser exposes it)
  const gl = g.renderer.getContext(); const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  await new Promise(r => setTimeout(r, s * 1000));
  g.loop = loop0; for (const u of undo) u();
  const ft = frames.slice(1).map((f, i) => f.t - frames[i].t).filter(x => x > 0);
  const sorted = [...ft].sort((a, c) => a - c), med = sorted[Math.floor(sorted.length / 2)];
  const mean = ft.reduce((a, x) => a + x, 0) / ft.length;
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const low1 = sorted.slice(Math.floor(sorted.length * 0.99)); const low1fps = 1000 / (low1.reduce((a, x) => a + x, 0) / low1.length);
  const stutters = ft.filter(x => x > med * 1.8).length;
  const steps = {}; for (const f of frames) steps[f.steps] = (steps[f.steps] ?? 0) + 1;
  const avg = k => +(frames.reduce((a, f) => a + f[k], 0) / frames.length).toFixed(2);
  const rm = ratios.reduce((a, x) => a + x, 0) / Math.max(1, ratios.length);
  const rsd = Math.sqrt(ratios.reduce((a, x) => a + (x - rm) ** 2, 0) / Math.max(1, ratios.length));
  const ri = g.renderer.info;
  return { frames: frames.length, fps: +(1000 / mean).toFixed(1), medMs: +med.toFixed(2), p99Ms: +p99.toFixed(2), low1fps: +low1fps.toFixed(1), stutters,
    stepsPerFrame: steps, cpuMs: { frame: avg('cpu'), sim: avg('sim'), views: avg('views'), fx: avg('fx'), render: avg('ren') },
    motionJitter: +(rsd / Math.max(1e-6, rm)).toFixed(3), motionSamples: ratios.length, heroes: w.actors.length, draws: ri.render.calls, tris: ri.render.triangles,
    pixelRatio: g.renderer.getPixelRatio(), timerQuery: !!tq, engine: !!g.engine, engineStats: g.engine?.stats?.() ?? null };
}, Number(secs));
const res = { map, cap: Number(cap), vsync: vsync !== '0', engineOff: process.env.ENGINE === '0', ...out };
console.log(JSON.stringify(res, null, 1));
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(res, null, 1));
await b.close();
