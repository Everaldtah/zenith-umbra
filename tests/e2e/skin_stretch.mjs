// Which bones' weights tear a skinned hero mesh in a pose: node tests/e2e/skin_stretch.mjs hero mode [query]
// Skins every vertex on the CPU (three's applyBoneTransform), measures edge stretch (posed / rest length) and reports
// the share of stretched edges (> 2x) plus the bone weights on their vertices.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [id = 'kaien', mode = 'walk', query = ''] = process.argv.slice(2);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto(`http://localhost:5199/play.html${query}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !!window.__zu?.menu, { timeout: 60000 });
await p.evaluate(() => window.__zu.menu.viewer());
await p.waitForFunction(() => !!window.__zu?.viewer, { timeout: 30000 });
await p.evaluate(id => window.__zu.viewer.select(id), id);
if (!query.includes('procedural')) await p.waitForFunction(() => !!window.__zu?.anim, { timeout: 90000 });
await p.evaluate(mode => { const v = window.__zu.viewer; v.auto = false; v.setMode(mode); }, mode);
await new Promise(r => setTimeout(r, 2500));
const samples = [];
for (let k = 0; k < 6; k++) {
  samples.push(await p.evaluate(() => {
    const v = window.__zu.viewer.view;
    const meshes = []; v.model.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
    const T = meshes[0].position.constructor;
    const V = new T(), W = new T();
    let edges = 0, bad = 0; const boneHits = {};
    for (const m of meshes) {
      const g = m.geometry, pos = g.attributes.position, idx = g.index, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      const n = pos.count, P = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { V.fromBufferAttribute(pos, i); m.applyBoneTransform(i, V); P[i * 3] = V.x; P[i * 3 + 1] = V.y; P[i * 3 + 2] = V.z; }
      const tri = idx ? idx.array : null, nt = tri ? tri.length / 3 : n / 3;
      const scale = m.matrixWorld.getMaxScaleOnAxis();
      for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
        const a = tri ? tri[t * 3 + e] : t * 3 + e, c = tri ? tri[t * 3 + (e + 1) % 3] : t * 3 + (e + 1) % 3;
        V.fromBufferAttribute(pos, a); W.fromBufferAttribute(pos, c);
        const r = V.distanceTo(W);
        if (r < 1e-5) continue;
        const q = Math.hypot(P[a * 3] - P[c * 3], P[a * 3 + 1] - P[c * 3 + 1], P[a * 3 + 2] - P[c * 3 + 2]);
        edges++;
        if (q / r > 2 && q > 0.02 / scale) {
          bad++;
          for (const vi of [a, c]) for (let j = 0; j < 4; j++) { const w = sw.getComponent(vi, j); if (w > 0.05) { const bn = m.skeleton.bones[si.getComponent(vi, j)].name; boneHits[bn] = (boneHits[bn] ?? 0) + w; } }
        }
      }
    }
    const top = Object.entries(boneHits).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([k2, w]) => `${k2}:${Math.round(w)}`);
    return { edges, bad, pct: +(100 * bad / edges).toFixed(3), top };
  }));
  await new Promise(r => setTimeout(r, 170));
}
const avg = samples.reduce((s, x) => s + x.pct, 0) / samples.length;
console.log(`${id} ${mode}${query} stretched-edge % avg ${avg.toFixed(3)} max ${Math.max(...samples.map(s => s.pct)).toFixed(3)} | bones: ${samples.sort((a2, b2) => b2.pct - a2.pct)[0].top.join(' ')}`);
await b.close();
