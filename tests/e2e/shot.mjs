// Screenshot helper: node tests/e2e/shot.mjs <url> <seconds> <name> [js-to-eval-after-load]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const [url, secs = '5', name = 'shot', js] = process.argv.slice(2);
const CHROME = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(p => fs.existsSync(p));
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1'), 'shots');
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', protocolTimeout: 600000,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1600,900'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded' });
const n = +secs;
const shots = Math.max(1, Math.min(4, Math.ceil(n / 5)));
for (let i = 0; i < shots; i++) {
  await new Promise(r => setTimeout(r, n * 1000 / shots));
  if (js && i === 0) console.log('eval:', JSON.stringify(await page.evaluate(js)).slice(0, 3000));
  await page.screenshot({ path: path.join(OUT, `${name}${shots > 1 ? '_' + i : ''}.png`) });
}
const info = await page.evaluate(() => { const g = window.__zu?.game; return g ? { fps: Math.round(g.fpsAvg), calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, gl: (() => { const c = g.renderer.getContext(); const e = c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })() } : null; });
console.log('info', JSON.stringify(info));
console.log(errs.slice(0, 15).join('\n'));
await browser.close();
