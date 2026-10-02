// FSR image check: one frozen frame drawn at native resolution, at a reduced scene scale upscaled by FSR (EASU+RCAS),
// and at the same scale upscaled bilinearly; each compared with native (PSNR, higher = closer) and saved:
//   node tests/e2e/engine_shot.mjs [port] [map] [scale%]   -> tests/e2e/shots/engine/*.png
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [port = '5263', map = 'mile', pct = '67'] = process.argv.slice(2);
const wait = ms => new Promise(r => setTimeout(r, ms));
const dir = 'tests/e2e/shots/engine'; fs.mkdirSync(dir, { recursive: true });
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 300000,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
p.on('pageerror', e => console.error('pageerror', e.message));
await p.evaluateOnNewDocument(() => { localStorage.setItem('zu-settings-v1', JSON.stringify({ preset: 'high', showFps: true })); });
await p.goto(`http://localhost:${port}/play.html?mode=aitest&map=${map}&platform=desktop`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 360 && !(await p.evaluate(() => !!(window.__zu?.game?.running && window.__zu.game.match))); i++) await wait(500);
await wait(6000);
// freeze: the game loop stops; each grab re-renders the very same scene state synchronously and reads it back
await p.evaluate(() => { const g = window.__zu.game; g.loop = () => {}; });
await wait(300);
const grab = async (name, scale, linear) => {
  const px = await p.evaluate((s, lin) => { const g = window.__zu.game, c = g.renderer.domElement;
    g.settings.video.renderScale = s; g.engine.fsr.forceLinear = lin; g.applySettings(g.settings);
    g.engine.render(g.scene, () => { if (g.composer) g.composer.render(); else g.renderer.render(g.scene, g.camera); });
    const cv = document.createElement('canvas'); cv.width = c.width; cv.height = c.height; const x = cv.getContext('2d'); x.drawImage(c, 0, 0);
    return { url: cv.toDataURL('image/png'), data: Array.from(x.getImageData(0, 0, cv.width, cv.height).data.filter((_, i) => i % 4 !== 3)), w: cv.width, h: cv.height, mode: g.engine.fsr.enabled ? g.engine.fsr.mode : 'off' }; }, scale, linear);
  fs.writeFileSync(`${dir}/${name}.png`, Buffer.from(px.url.split(',')[1], 'base64'));
  return px;
};
const native = await grab('native', 100, false);
const fsr = await grab(`fsr_${pct}`, Number(pct), false);
const lin = await grab(`bilinear_${pct}`, Number(pct), true);
const psnr = (a, c) => { let se = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - c[i]; se += d * d; } const mse = se / a.length; return +(10 * Math.log10(255 * 255 / mse)).toFixed(2); };
// sharpness: mean gradient magnitude (edges kept vs smeared)
const grad = (o) => { const { data: d, w, h } = o; let s = 0, n = 0; for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) { const i = (y * w + x) * 3; s += Math.abs(d[i + 1] - d[i + 4]) + Math.abs(d[i + 1] - d[i + 1 + w * 3]); n++; } return +(s / n).toFixed(2); };
console.log(JSON.stringify({ size: `${native.w}x${native.h}`, modes: [native.mode, fsr.mode, lin.mode], psnrVsNative: { fsr: psnr(native.data, fsr.data), bilinear: psnr(native.data, lin.data) },
  sharpness: { native: grad(native), fsr: grad(fsr), bilinear: grad(lin) } }, null, 1));
await b.close();
