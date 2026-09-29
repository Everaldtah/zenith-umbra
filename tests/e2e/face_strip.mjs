// Face close-ups while the hero moves (hair / cloth physics must never drag the face):
//   node tests/e2e/face_strip.mjs <ids> [modes] [frames] [every_ms] [port]
//   node tests/e2e/face_strip.mjs kaien,seiran,nocturne idle,run 4 250
// Writes tests/e2e/shots/face/<id>_<mode>.png: front and three-quarter-side rows, frames left to right.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [ids = 'kaien', modes = 'idle,run', N = '4', every = '250', port = '5199'] = process.argv.slice(2);
const RAW = !!process.env.RAW;          // RAW=1: also save the first full stage frame of each strip (to check the crop)
const wait = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('tests/e2e/shots/face', { recursive: true });
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errors = [];
p.on('pageerror', e => errors.push(String(e)));
await p.goto(`http://localhost:${port}/play.html${process.env.Q ?? ''}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 60 && !(await p.evaluate(() => !!window.__zu?.menu)); i++) await wait(500);
await p.evaluate(() => window.__zu.menu.viewer());
for (const id of ids.split(',')) {
  await p.evaluate(id => { const V = window.__zu.viewer; V.select(id); V.auto = false; }, id);
  for (let i = 0; i < 60 && !(await p.evaluate(() => window.__zu.viewer.view?.real)); i++) await wait(250);
  await wait(1200);
  for (const mode of modes.split(',')) {
    await p.evaluate(m => window.__zu.viewer.setMode(m), mode);
    await wait(900);
    const shots = [];
    for (const yaw of [0.25, -0.9]) {
      await p.evaluate(y => { const V = window.__zu.viewer; V.yaw = y; V.tilt = 0.08; V.zoom = 0.3; }, yaw);
      await wait(700);
      for (let f = 0; f < Number(N); f++) { shots.push(await (await p.$('.vstage')).screenshot({ encoding: 'base64' })); await wait(Number(every)); }
      if (RAW) fs.writeFileSync(`tests/e2e/shots/face/${id}_${mode}_raw${yaw}.png`, Buffer.from(shots[shots.length - 1], 'base64'));
    }
    // tile in the page (no image library in node): rows = views, columns = frames
    const png = await p.evaluate(async (list, n) => {
      const ims = await Promise.all(list.map(s => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = 'data:image/png;base64,' + s; })));
      const w = ims[0].width, h = ims[0].height, cw = 420, ch = Math.round(cw * h / w), crop = [0.28, 0.22, 0.72, 0.8];
      const c = document.createElement('canvas'); c.width = cw * n; c.height = Math.round(ch * (crop[3] - crop[1]) / (crop[2] - crop[0]) * (w / h) * (h / w)) * 2 || ch * 2;
      const rowH = Math.round(cw * (h * (crop[3] - crop[1])) / (w * (crop[2] - crop[0])));
      c.height = rowH * 2;
      const g = c.getContext('2d');
      ims.forEach((im, k) => g.drawImage(im, w * crop[0], h * crop[1], w * (crop[2] - crop[0]), h * (crop[3] - crop[1]), (k % n) * cw, Math.floor(k / n) * rowH, cw, rowH));
      return c.toDataURL('image/png').split(',')[1];
    }, shots, Number(N));
    fs.writeFileSync(`tests/e2e/shots/face/${id}_${mode}.png`, Buffer.from(png, 'base64'));
    console.log(`tests/e2e/shots/face/${id}_${mode}.png`);
  }
}
console.log('errors', errors.slice(0, 3));
await b.close();
