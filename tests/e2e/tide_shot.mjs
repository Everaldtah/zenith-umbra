// Tomoe's Crescent Warpath in a real match, slow motion: the spin through the air in third person (a side camera), the
// blue glow on the heroes it cut through ('tidemark'), and the same flight in first person.
//   node tests/e2e/tide_shot.mjs [port]      ->  tests/e2e/shots/tide_3p.png, tests/e2e/shots/tide_fp.png
// The flight is started here the way the ability does (a.forced kind 'tide', sv.tideT0 / tideDur), so the poses can be
// checked on any build.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [port = '5199'] = process.argv.slice(2);
const SLOW = Number(process.env.SLOW ?? 5), DUR = 1.2;
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
const errors = [];
p.on('pageerror', e => errors.push(String(e)));
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 60 && !(await p.evaluate(() => !!window.__zu?.game)); i++) await wait(500);
await p.evaluate(() => window.__zu.game.start({ mode: 'training', map: 'training', hero: 'tomoe' }));
for (let i = 0; i < 120 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
await p.evaluate(() => {
  const g = window.__zu.game, w = g.match.world, me = g.match.player;
  window.__zu.menu?.close?.(); me.hp = 1e5;
  Object.defineProperty(g.input, 'locked', { get: () => true, configurable: true }); g.setPaused(false);
  for (const a of w.actors) if (a.isRobot) { a.pos = { x: 0, y: -200, z: 0 }; a.alive = false; a.respawnAt = 1e9; }
  window.__v = ['kaien', 'raijin'].map((id, k) => {
    const a = w.addHero(id, 'umbra');
    const x = -10.8 + k * 1.6, z = -7 + k * 2.5;
    a.pos = { x, y: w.level.groundAt(x, z, 30), z }; a.vel = { x: 0, y: 0, z: 0 }; a.yaw = a.input.yaw = Math.PI; a.clear('spawnprot'); a.controller = null; a.hp = 1e5;
    return a;
  });
  const orig = g.updateCamera.bind(g);
  window.__side = false;
  g.updateCamera = (dt, m) => { orig(dt, m); if (m && window.__side) { const c = g.camera; c.position.set(m.pos.x + 3.4, m.pos.y + 1.7, m.pos.z + 1.6); c.lookAt(m.pos.x, m.pos.y + 1.1, m.pos.z + 0.2); } };
  window.__fly = () => {
    const t = w.time;
    me.pos = { x: -10, y: w.level.groundAt(-10, -12, 30) + 1.2, z: -12 }; me.vel = { x: 0, y: 0, z: 0 };
    me.yaw = me.input.yaw = 0; g.input.yaw = 0; g.camYaw = 0; g.input.pitch = 0; g.camPitch = 0;
    me.forced = { vx: 0, vy: 0, vz: 7, until: t + 1.2, kind: 'tide' }; me.sv.tideT0 = t; me.sv.tideDur = 1.2; me.set('tideult', t, 1.2);
    return t;
  };
}, null);
const gt = () => p.evaluate(() => window.__zu.game.match.world.time);
const strip = async (name, shots, labels, cols) => {
  const png = await p.evaluate(async (list, labels, cols) => {
    const ims = await Promise.all(list.map(s => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = 'data:image/png;base64,' + s; })));
    const cw = 640, ch = Math.round(cw * ims[0].height / ims[0].width);
    const c = document.createElement('canvas'); c.width = cw * cols; c.height = ch * Math.ceil(ims.length / cols);
    const g = c.getContext('2d'); g.font = 'bold 18px sans-serif'; g.fillStyle = '#ff0';
    ims.forEach((im, k) => { g.drawImage(im, (k % cols) * cw, Math.floor(k / cols) * ch, cw, ch); g.fillText(labels[k], (k % cols) * cw + 8, Math.floor(k / cols) * ch + 22); });
    return c.toDataURL('image/png').split(',')[1];
  }, shots, labels, cols);
  fs.writeFileSync(`tests/e2e/shots/${name}.png`, Buffer.from(png, 'base64'));
  console.log(`tests/e2e/shots/${name}.png`);
};
for (const view of ['third', 'first']) {
  await p.evaluate(v => { const g = window.__zu.game; g.settings.view = v; window.__side = v === 'third'; g.timeScale = 1; }, view);
  for (let i = 0; i < 5; i++) { await p.evaluate(() => { const z = window.__zu; if (z.game.paused) z.game.setPaused(false); }); await wait(500); }
  await p.evaluate(k => { window.__zu.game.timeScale = 1 / k; }, SLOW);
  const shots = [], labels = [];
  const t0 = await p.evaluate(() => window.__fly());
  for (const at of [0.1, 0.3, 0.5, 0.7, 0.9, 1.1]) {
    while ((await gt()) - t0 < at) await wait(15);
    if (at === 0.5) await p.evaluate(() => { const w = window.__zu.game.match.world; for (const a of window.__v) a.set('tidemark', w.time, 10); });
    shots.push(await p.screenshot({ encoding: 'base64' })); labels.push(`+${at}s`);
  }
  while ((await gt()) - t0 < 1.6) await wait(15);
  shots.push(await p.screenshot({ encoding: 'base64' })); labels.push('after (the cut heroes glow blue)');
  await strip(view === 'third' ? 'tide_3p' : 'tide_fp', shots, labels, 3);
}
console.log('errors', errors.filter(e => !/Pointer Lock/.test(e)).slice(0, 3));
await b.close();
