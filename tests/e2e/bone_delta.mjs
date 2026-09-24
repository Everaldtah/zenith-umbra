// angle (deg) between each bone's current model-space rotation and its bind rotation, idle in the viewer
import puppeteer from 'puppeteer-core';
const id = process.argv[2] || 'mirei';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11'] });
const p = await b.newPage();
await p.goto('http://localhost:5190/play.html', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => window.__zu.menu.viewer());
await p.evaluate(id => { const V = window.__zu.viewer; V.select(id); V.auto = false; }, id);
for (let i = 0; i < 40 && !(await p.evaluate(() => window.__zu.viewer.view.real)); i++) await new Promise(r => setTimeout(r, 250));
await new Promise(r => setTimeout(r, 2000));
console.log(await p.evaluate(() => {
  const an = window.__zu.viewer.view.anim, out = {};
  const Q = an.model.quaternion.constructor, M = an.model.matrixWorld.constructor, V = an.model.position.constructor;
  const inv = new M().copy(an.model.matrixWorld).invert();
  for (const [n, bn] of Object.entries(an.bones)) {
    if (!bn || !an.rest[n]) continue;
    const q = new Q(), pp = new V(), sc = new V();
    new M().multiplyMatrices(inv, bn.matrixWorld).decompose(pp, q, sc);
    out[n] = +(q.angleTo(an.rest[n].q) * 180 / Math.PI).toFixed(1);
  }
  return JSON.stringify(out);
}));
await b.close();
