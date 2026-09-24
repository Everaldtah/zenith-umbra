// Pose strip: freeze an attack at several ages in the hero viewer and tile the frames.
//   node tests/e2e/pose_strip.mjs <id> <kind: primary|punch> [side] [yaw] [out]
import puppeteer from 'puppeteer-core';
const [id = 'tenkai', kind = 'primary', side = '1', yaw = '0.6', out = `tests/e2e/shots/strip_${id}_${kind}.png`] = process.argv.slice(2);
const ages = kind === 'punch' ? [0, 0.05, 0.1, 0.14, 0.2, 0.28, 0.4] : [0, 0.1, 0.17, 0.24, 0.29, 0.34, 0.42, 0.52, 0.65, 0.85];
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
await p.goto('http://localhost:5190/play.html', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => window.__zu.menu.viewer());
await p.evaluate((id, yaw) => { const V = window.__zu.viewer; V.select(id); V.auto = false; V.yaw = +yaw; V.tilt = 0.15; }, id, yaw);
await new Promise(r => setTimeout(r, 3500));
const shots = [];
for (const age of ages) {
  await p.evaluate((age, kind, side) => { const V = window.__zu.viewer, a = V.actor; a.anim.attackKind = kind; a.anim.attackSide = +side; a.anim.attackAt = V.t - age - 0.03; }, age, kind, side);
  await new Promise(r => setTimeout(r, 30));
  shots.push(await (await p.$('.vstage')).screenshot({ encoding: 'base64' }));
}
await b.close();
const fs = await import('node:fs');
fs.rmSync('tests/e2e/shots/strip', { recursive: true, force: true }); fs.mkdirSync('tests/e2e/shots/strip', { recursive: true });
shots.forEach((s, i) => fs.writeFileSync(`tests/e2e/shots/strip/${i}.png`, Buffer.from(s, 'base64')));
console.log('ok', shots.length);
