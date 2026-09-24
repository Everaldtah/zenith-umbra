// Screenshot every model in the Hero Viewer (front idle + side idle) and tile them: node tests/e2e/viewer_all.mjs [url] [ids]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [url = 'http://localhost:5190/play.html', idsArg = ''] = process.argv.slice(2);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(url, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => window.__zu.menu.viewer());
const ids = idsArg ? idsArg.split(',') : await p.evaluate(() => [...document.querySelectorAll('.vchip')].map(e => e.dataset.h));
fs.mkdirSync('tests/e2e/shots/all', { recursive: true });
const info = {};
for (const id of ids) {
  await p.evaluate(id => { const v = window.__zu.viewer; v.select(id); v.auto = false; v.zoom = 1; v.tilt = 0.08; }, id);
  await new Promise(r => setTimeout(r, 3000));
  for (const [n, yaw] of [['front', 0], ['side', Math.PI / 2]]) {
    await p.evaluate(yaw => { window.__zu.viewer.yaw = yaw; }, yaw);
    await new Promise(r => setTimeout(r, 500));
    await (await p.$('.vstage')).screenshot({ path: `tests/e2e/shots/all/${id}_${n}.png` });
  }
  info[id] = await p.evaluate(() => {
    const v = window.__zu.viewer.view; const THREE_ = null;
    let meshes = 0, skinned = 0, tris = 0; const names = [];
    v.model.traverse(o => { if (o.isMesh) { meshes++; if (o.isSkinnedMesh) skinned++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; names.push(o.name); } });
    return { real: v.real, rig: v.anim.ok, meshes, skinned, tris: Math.round(tris), names: names.slice(0, 6) };
  });
}
fs.writeFileSync('tests/e2e/shots/all/info.json', JSON.stringify(info, null, 1));
console.log(JSON.stringify(info));
console.log('errors', errs.slice(0, 5));
await b.close();
