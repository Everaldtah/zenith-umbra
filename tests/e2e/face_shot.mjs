// face close-up + full front of one viewer model after it has fully loaded: node tests/e2e/face_shot.mjs <id>
import puppeteer from 'puppeteer-core';
const id = process.argv[2] || 'mirei';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
await p.goto('http://localhost:5190/play.html', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => window.__zu.menu.viewer());
await p.evaluate(id => { const V = window.__zu.viewer; V.select(id); V.auto = false; V.yaw = 0.25; V.tilt = 0.1; }, id);
for (let i = 0; i < 40 && !(await p.evaluate(() => window.__zu.viewer.view.real)); i++) await new Promise(r => setTimeout(r, 250));
await new Promise(r => setTimeout(r, 1500));
await (await p.$('.vstage')).screenshot({ path: `tests/e2e/shots/${id}_front2.png` });
await p.evaluate(() => { window.__zu.viewer.zoom = 0.32; });
await new Promise(r => setTimeout(r, 1200));
await (await p.$('.vstage')).screenshot({ path: `tests/e2e/shots/${id}_face2.png` });
await b.close();
