// Screenshot a viewer model animated vs frozen in bind pose (tells rig/animation defects from mesh defects)
import puppeteer from 'puppeteer-core';
const ids = (process.argv[2] || 'tenkai').split(',');
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
await p.goto('http://localhost:5190/play.html', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => window.__zu.menu.viewer());
for (const id of ids) {
  await p.evaluate(id => { const V = window.__zu.viewer; V.select(id); V.auto = false; V.yaw = 0.35; V.tilt = 0.15; V.zoom = 1.25; }, id);
  await new Promise(r => setTimeout(r, 3000));
  await (await p.$('.vstage')).screenshot({ path: `tests/e2e/shots/${id}_anim.png` });
  await p.evaluate(() => { const v = window.__zu.viewer.view; v.anim.ok = false; v.model.traverse(o => { if (o.isSkinnedMesh) o.skeleton.pose(); }); });
  await new Promise(r => setTimeout(r, 600));
  await (await p.$('.vstage')).screenshot({ path: `tests/e2e/shots/${id}_bind.png` });
}
await b.close();
