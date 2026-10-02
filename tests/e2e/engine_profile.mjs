// CPU profile of a live AI match, aggregated by function (self + total ms) and by draw-call category:
//   node tests/e2e/engine_profile.mjs [port] [map] [secs]      (ENGINE=0 -> ?engine=0)
import puppeteer from 'puppeteer-core';
const [port = '5263', map = 'mile', secs = '6'] = process.argv.slice(2);
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 300000,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1920,1080'], defaultViewport: { width: 1920, height: 1080 } });
const p = await b.newPage();
await p.evaluateOnNewDocument(() => { localStorage.setItem('zu-settings-v1', JSON.stringify({ preset: 'ultra', showFps: true })); });
const extra = process.env.ENGINE === '0' ? '&engine=0' : '';
await p.goto(`http://localhost:${port}/play.html?mode=aitest&map=${map}&platform=desktop${extra}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 360 && !(await p.evaluate(() => !!(window.__zu?.game?.running && window.__zu.game.match))); i++) await wait(500);
await wait(5000);
// draw calls by what they draw (one frame, all passes)
const draws = await p.evaluate(() => {
  const g = window.__zu.game, r = g.renderer, cats = {};
  const orig = r.renderBufferDirect.bind(r);
  let shadow = false;
  const sm = r.shadowMap, smr = sm.render.bind(sm);
  sm.render = (...a) => { shadow = true; try { return smr(...a); } finally { shadow = false; } };
  r.renderBufferDirect = (cam, scene, geo, mat, obj, grp) => {
    let o = obj, tag = 'other';
    while (o) { if (o.isSkinnedMesh || o.userData?.zuView) { tag = 'character'; break; } if (o === g.mapScene?.group) { tag = 'map'; break; } if (o.isScene) break; o = o.parent; }
    if (obj.isSkinnedMesh) tag = 'character';
    if (tag === 'other' && (obj.isPoints || obj.isInstancedMesh || mat.blending !== 1)) tag = 'fx';
    const k = (shadow ? 'shadow:' : '') + tag + (obj.isInstancedMesh ? '(inst)' : '');
    cats[k] = (cats[k] ?? 0) + 1;
    return orig(cam, scene, geo, mat, obj, grp);
  };
  return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => { r.renderBufferDirect = orig; sm.render = smr;
    let objs = 0, meshes = 0, autoUpd = 0; g.scene.traverse(o => { objs++; if (o.isMesh) meshes++; if (o.matrixAutoUpdate) autoUpd++; });
    res({ cats, sceneObjects: objs, meshes, matrixAutoUpdate: autoUpd, lights: (() => { let n = 0, sh = 0; g.scene.traverse(o => { if (o.isLight) { n++; if (o.castShadow) sh++; } }); return { n, shadow: sh }; })() }); })));
});
console.log(JSON.stringify(draws, null, 1));
const cdp = await p.createCDPSession();
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
await wait(Number(secs) * 1000);
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map(n => [n.id, n]));
const dts = profile.timeDeltas; const self = new Map();
for (let i = 0; i < profile.samples.length; i++) { const id = profile.samples[i]; self.set(id, (self.get(id) ?? 0) + (dts[i] ?? 0)); }
const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const fnSelf = new Map(), fnTotal = new Map();
const key = n => `${n.callFrame.functionName || '(anon)'} ${(n.callFrame.url.split('/').pop() || '').split('?')[0]}:${n.callFrame.lineNumber + 1}`;
for (const [id, us] of self) {
  const n = byId.get(id); const k = key(n); fnSelf.set(k, (fnSelf.get(k) ?? 0) + us);
  const seen = new Set(); let cur = id;
  while (cur !== undefined) { const kk = key(byId.get(cur)); if (!seen.has(kk)) { seen.add(kk); fnTotal.set(kk, (fnTotal.get(kk) ?? 0) + us); } cur = parent.get(cur); }
}
const total = [...self.values()].reduce((a, x) => a + x, 0);
const fmt = m => [...m].sort((a, c) => c[1] - a[1]).slice(0, 40).map(([k, us]) => `${(us / 1000 / Number(secs)).toFixed(2).padStart(7)} ms/s  ${(us / total * 100).toFixed(1).padStart(5)}%  ${k}`).join('\n');
console.log('== SELF (ms per second of play) ==\n' + fmt(fnSelf));
console.log('== TOTAL ==\n' + fmt(fnTotal));
await b.close();
