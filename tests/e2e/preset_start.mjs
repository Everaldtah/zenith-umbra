// Start a match on every graphics preset, desktop (full) and web (lite) edition, from a fresh save: each must reach
// play with no page error and draw a non-black frame. Low and Medium build the post chain with AO off (Medium has
// FXAA; the desktop edition always grades) - main b1f40af threw there before the first frame.
//   node tests/e2e/preset_start.mjs [presets] [map] [port]      (dev server)
import puppeteer from 'puppeteer-core';
const [presets = 'low,medium,high,ultra', map = 'kagura', port = '5199'] = process.argv.slice(2);
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
let fails = 0;
try {
  for (const edition of ['full', 'lite']) for (const preset of presets.split(',')) {
    const p = await b.newPage(), errors = [];
    p.on('pageerror', e => errors.push(String(e).split('\n')[0]));
    await p.evaluateOnNewDocument(pr => localStorage.setItem('zu-settings-v1', JSON.stringify({ preset: pr })), preset);
    await p.goto(`http://localhost:${port}/play.html${edition === 'lite' ? '?edition=lite' : ''}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    for (let i = 0; i < 60 && !(await p.evaluate(() => !!window.__zu?.menu)) && !errors.length; i++) await wait(500);
    if (!errors.length) await p.evaluate(m => { const z = window.__zu.menu; z.queue = 'practice'; z.mode = 'practice'; z.map = m; z.hero = 'kaien'; void z.launch(); }, map);
    let running = false;
    for (let i = 0; i < 240 && !errors.length && !(running = await p.evaluate(() => !!window.__zu?.game?.running)); i++) await wait(500);
    let info = {};
    if (running) {
      await wait(2500);
      info = await p.evaluate(() => { const g = window.__zu.game, v = g.settings.video; return { ao: v.ao, aa: v.aa, composer: !!g.composer, calls: g.renderer.info.render.calls }; });
      // mean brightness of a screenshot: a crash inside the frame loop leaves the canvas black
      const shot = await p.screenshot({ encoding: 'base64', type: 'jpeg', quality: 60 });
      info.luma = await p.evaluate(async src => {
        const im = new Image(); im.src = 'data:image/jpeg;base64,' + src; await im.decode();
        const c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d');
        x.drawImage(im, 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data; let s = 0;
        for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        return Math.round(s / (d.length / 4));
      }, shot);
    }
    const ok = running && !errors.length && info.luma > 8;
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${edition.padEnd(4)} ${preset.padEnd(6)} running=${running} ${JSON.stringify(info)}${errors.length ? ' errors: ' + errors.slice(0, 3).join(' | ') : ''}`);
    await p.close();
  }
} finally { await b.close(); }
process.exit(fails ? 1 : 0);
