// Launch the installed Windows app with a debug port and inspect it: node tests/e2e/desktop_check.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
const exe = path.join(process.env.LOCALAPPDATA, 'Programs', 'ZenithUmbra', 'ZenithUmbra.exe');
const proc = spawn(exe, ['--remote-debugging-port=9333'], { detached: false, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 7000));
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null });
const [p] = (await b.pages()).filter(x => x.url().includes('play.html'));
await p.evaluate(() => { const m = window.__zu.menu; m.mode = 'spectate'; m.map = 'amatsu'; m.launch(); });
await new Promise(r => setTimeout(r, 20000));
const f0 = await p.evaluate(() => window.__zu.game.framesRendered);
await new Promise(r => setTimeout(r, 5000));
const info = await p.evaluate(f0 => { const g = window.__zu.game; const c = g.renderer.getContext(); const e = c.getExtension('WEBGL_debug_renderer_info');
  return { fps: (g.framesRendered - f0) / 5, preset: g.settings.preset, pixelRatio: g.renderer.getPixelRatio(), size: [innerWidth, innerHeight], gpu: e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?', shadows: g.renderer.shadowMap.enabled, url: location.href }; }, f0);
console.log(JSON.stringify(info, null, 1));
await p.screenshot({ path: 'tests/e2e/shots/desktop_app.png' });
b.disconnect(); proc.kill();
