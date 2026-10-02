// Interleaved A/B of engine features inside ONE live match (other processes' load hits both sides alike, unlike two
// separate runs):  node tests/e2e/engine_ab.mjs [port] [map] [rounds] [secsPerSide]
// A = engine features on (once-per-frame render update, animation LOD, interpolation), B = those off.
// Reports per side: frame interval, loop CPU, render submit CPU, views CPU, GPU ms, stutters (> 1.8x median interval).
import puppeteer from 'puppeteer-core';
const [port = '5263', map = 'mile', rounds = '6', secs = '2.5'] = process.argv.slice(2);
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 600000,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1920,1080'], defaultViewport: { width: 1920, height: 1080 } });
const p = await b.newPage();
p.on('pageerror', e => console.error('pageerror', e.message));
await p.evaluateOnNewDocument(() => { localStorage.setItem('zu-settings-v1', JSON.stringify({ preset: 'ultra', showFps: true })); });
await p.goto(`http://localhost:${port}/play.html?mode=aitest&map=${map}&platform=desktop`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 360 && !(await p.evaluate(() => !!(window.__zu?.game?.running && window.__zu.game.match))); i++) await wait(500);
await wait(5000);
const res = await p.evaluate(async (rounds, secs) => {
  const g = window.__zu.game, e = g.engine;
  const side = { A: [], B: [] }; let cur = null, mode = 'A', last = 0;
  const viewProto = Object.getPrototypeOf(g.views.values().next().value);
  const vu = viewProto.update; let views = 0;
  viewProto.update = function (...a) { const t0 = performance.now(); try { return vu.apply(this, a); } finally { views += performance.now() - t0; } };
  const loop0 = g.loop;
  g.loop = function (t) {
    const f0 = g.framesRendered; views = 0; const t0 = performance.now();
    loop0.call(this, t);
    if (g.framesRendered !== f0) { side[mode].push({ dt: last ? t - last : 0, cpu: performance.now() - t0, render: e.renderMs, views, gpu: e.gpu.last }); last = t; }
  };
  const set = m => { mode = m; const on = m === 'A'; e.optRender = on; e.anim.enabled = on; e.interp.enabled = on; last = 0; };
  for (let r = 0; r < rounds; r++) for (const m of ['A', 'B']) { set(m); await new Promise(res => setTimeout(res, 250)); side[m].length = Math.max(0, side[m].length - 0); const n0 = side[m].length; await new Promise(res => setTimeout(res, secs * 1000)); side[m].splice(n0, 1); }
  g.loop = loop0; viewProto.update = vu; set('A');
  const sum = arr => { const dts = arr.map(x => x.dt).filter(x => x > 0).sort((a, b) => a - b); const med = dts[dts.length >> 1];
    const avg = k => +(arr.reduce((a, x) => a + (x[k] > 0 ? x[k] : 0), 0) / arr.filter(x => x[k] > 0).length).toFixed(2);
    return { frames: arr.length, fps: +(1000 / (dts.reduce((a, x) => a + x, 0) / dts.length)).toFixed(1), stutters: dts.filter(x => x > med * 1.8).length, cpuMs: avg('cpu'), renderMs: avg('render'), viewsMs: avg('views'), gpuMs: avg('gpu') }; };
  return { A_engine: sum(side.A), B_off: sum(side.B) };
}, Number(rounds), Number(secs));
console.log(JSON.stringify(res, null, 1));
await b.close();
