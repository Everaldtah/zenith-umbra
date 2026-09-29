// Frame rate of a live AI match (vsync and the frame cap off), measured only once the match is running and the heroes
// are on screen:  node tests/e2e/hero_bench.mjs [map] [secs] [port]   (Q=?hd&... for the desktop hero models)
import puppeteer from 'puppeteer-core';
const [map = 'mile', secs = '10', port = '5199'] = process.argv.slice(2);
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 300000,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--window-size=1920,1080'], defaultViewport: { width: 1920, height: 1080 } });
const p = await b.newPage();
await p.evaluateOnNewDocument(() => { localStorage.setItem('zu-settings-v1', JSON.stringify({ preset: 'ultra', showFps: true })); });
const q = process.env.Q ?? '';
await p.goto(`http://localhost:${port}/play.html?mode=aitest&map=${map}${q ? '&' + q.replace(/^\?/, '') : ''}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 240 && !(await p.evaluate(() => !!(window.__zu?.game?.running && window.__zu.game.match))); i++) await wait(500);
await wait(4000);
const out = await p.evaluate(async s => {
  const g = window.__zu.game, f0 = g.framesRendered, t0 = performance.now();
  await new Promise(r => setTimeout(r, s * 1000));
  let tris = 0, heroes = 0;
  g.scene?.traverse?.(o => { if (o.isSkinnedMesh && o.visible) { heroes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
  return { fps: Math.round((g.framesRendered - f0) / ((performance.now() - t0) / 1000)), skinnedMeshes: heroes, skinnedTris: Math.round(tris) };
}, Number(secs));
console.log(map, q || 'web', JSON.stringify(out));
await b.close();
