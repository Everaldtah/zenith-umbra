// GPU benchmark: node tests/e2e/bench.mjs <url> <preset> [secs]  (vsync + frame cap off so we see real headroom)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [url, preset = 'ultra', secs = '20'] = process.argv.slice(2);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 300000,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--window-size=1920,1080'], defaultViewport: { width: 1920, height: 1080 } });
const p = await b.newPage();
await p.evaluateOnNewDocument(pr => { localStorage.setItem('zu-settings-v1', JSON.stringify({ preset: pr, showFps: true })); }, preset);
await p.goto(url, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 6000));
const samples = [];
for (let i = 0; i < +secs; i++) { const f0 = await p.evaluate(() => window.__zu.game.framesRendered); await new Promise(r => setTimeout(r, 1000)); samples.push(await p.evaluate(f0 => { const g = window.__zu.game; g.renderer.info.autoReset = true; return [g.framesRendered - f0, g.renderer.info.render.calls, g.renderer.info.render.triangles]; }, f0)); }
const f = samples.map(s => s[0]).sort((a, c) => a - c);
console.log(preset, 'fps avg', Math.round(f.reduce((s, x) => s + x, 0) / f.length), 'min', f[0], 'draw calls', samples.at(-1)[1], 'tris', samples.at(-1)[2]);
await b.close();
