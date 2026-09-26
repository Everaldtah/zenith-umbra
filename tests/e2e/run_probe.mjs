// Probe the run pose in the hero viewer: which clips blend, how low the hips ride, how far the spine pitches.
//   node tests/e2e/run_probe.mjs <url> raijin,mirei,gantetsu
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [url = 'http://localhost:5199/play.html', ids = 'raijin'] = process.argv.slice(2);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
await p.goto(url, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => window.__zu.menu.viewer());
for (const id of ids.split(',')) {
  await p.evaluate(id => { const v = window.__zu.viewer; v.select(id); v.auto = false; }, id);
  await new Promise(r => setTimeout(r, 3500));
  for (const mode of ['idle', 'walk', 'run']) {
    await p.evaluate(m => window.__zu.viewer.setMode(m), mode);
    await new Promise(r => setTimeout(r, 1500));
    const r = await p.evaluate(() => {
      const v = window.__zu.viewer, an = v.view.anim, L = an.layer;
      const hips = an.bones.hips, spine = an.bones.chest;
      const hw = hips.getWorldPosition(new hips.position.constructor()), cw = spine.getWorldPosition(new hips.position.constructor());
      const d = cw.clone().sub(hw).normalize();
      const blend = L ? L.lib.blend(Math.atan2(0, 1), (v.actor.def.speed) / (an.legLen * v.view.scaleFit)).map(e => `${e.clip.name}:${e.w.toFixed(2)}@${e.clip.speed.toFixed(2)}`) : [];
      return { hipsY: +(hw.y / v.actor.height).toFixed(3), torsoPitchDeg: +(Math.asin(Math.max(-1, Math.min(1, d.z))) * 57.3).toFixed(1), legLenM: +(an.legLen * v.view.scaleFit).toFixed(3), speedLL: +(v.actor.def.speed / (an.legLen * v.view.scaleFit)).toFixed(2), clip: an.clip?.clipName, gaits: L ? L.lib.gaits.map(g => `${g.name}@${g.speed.toFixed(2)}`) : [], blend };
    });
    console.log(id, mode, JSON.stringify(r));
  }
}
await b.close();
