// Gantetsu's Shiko leap and slam, and its victims knocked flat, in a real match (third person, slow motion):
//   node tests/e2e/slam_shot.mjs [victims] [port]        ->  tests/e2e/shots/slam.png (one strip)
// The player is Gantetsu; the victims stand 4-5 m in front of him. He leaps ('stompair'), lands (the slam), and every
// victim is knocked down for 1 s (the status is set here as well, so the poses can be checked on any build).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [victims = 'kaien,raijin,tomoe', port = '5199'] = process.argv.slice(2);
const SLOW = Number(process.env.SLOW ?? 4);
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
const errors = [];
p.on('pageerror', e => errors.push(String(e)));
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 60 && !(await p.evaluate(() => !!window.__zu?.game)); i++) await wait(500);
await p.evaluate(() => window.__zu.game.start({ mode: 'training', map: 'training', hero: 'gantetsu' }));
for (let i = 0; i < 120 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
await p.evaluate(ids => {
  const g = window.__zu.game, w = g.match.world, me = g.match.player;
  window.__zu.menu?.close?.(); g.settings.view = 'third'; me.hp = 1e5;
  Object.defineProperty(g.input, 'locked', { get: () => true, configurable: true }); g.setPaused(false);
  for (const a of w.actors) if (a.isRobot) { a.pos = { x: 0, y: -200, z: 0 }; a.alive = false; a.respawnAt = 1e9; }
  me.pos = { x: -10, y: w.level.groundAt(-10, -12, 30), z: -12 }; me.vel = { x: 0, y: 0, z: 0 };
  me.yaw = me.input.yaw = 0; g.input.yaw = 0; g.camYaw = 0; g.input.pitch = -0.1; g.camPitch = -0.1;
  window.__v = ids.split(',').map((id, k) => {
    const a = w.addHero(id, 'umbra');
    const x = -12.4 + k * 2.4, z = -7.6 + (k === 1 ? 0.8 : 0);
    a.pos = { x, y: w.level.groundAt(x, z, 30), z }; a.vel = { x: 0, y: 0, z: 0 }; a.yaw = a.input.yaw = Math.PI + (k - 1) * 0.5; a.clear('spawnprot');
    a.controller = null; a.hp = 1e5;
    return a;
  });
  // a camera off to the side and above, looking at the scene
  const orig = g.updateCamera.bind(g);
  // two close cameras: on Gantetsu for the leap, on the victims for the knockdown
  const y0 = me.pos.y;
  window.__cam = 'me';
  g.updateCamera = (dt, m) => {
    orig(dt, m); if (!m) return;
    const c = g.camera;
    if (window.__cam === 'me') { c.position.set(m.pos.x + 4.6, y0 + 2.4, m.pos.z + 3.4); c.lookAt(m.pos.x, (m.pos.y + y0) / 2 + 1.7, m.pos.z); }
    else { c.position.set(-10 + 4.2, y0 + 2.6, -7.2 + 3.2); c.lookAt(-10.2, y0 + 0.5, -7.2); }
  };
}, victims);
for (let i = 0; i < 8; i++) { await p.evaluate(() => { const z = window.__zu; if (z.game.paused) z.game.setPaused(false); }); await wait(500); }
await p.evaluate(k => { window.__zu.game.timeScale = 1 / k; }, SLOW);
const shots = [], labels = [];
const gt = () => p.evaluate(() => window.__zu.game.match.world.time);
const shot = async l => { shots.push(await p.screenshot({ encoding: 'base64' })); labels.push(l); };
await shot('before');
// the leap (as World does it out of the rush)
const t0 = await p.evaluate(() => {
  const g = window.__zu.game, w = g.match.world, me = g.match.player, t = w.time;
  me.vel.y = 9.5; me.grounded = false; me.lastGroundedAt = -9; me.anim.jumpAt = t; me.set('stompair', t, 2.5); me.sv.stompArmed = 1;
  return t;
});
for (const at of [0.25, 0.6]) { while ((await gt()) - t0 < at) await wait(15); await shot(`leap +${at}s`); }
// wait for the landing, then knock the victims down (whatever this build's slam does itself)
for (let i = 0; i < 400 && !(await p.evaluate(() => { const me = window.__zu.game.match.player; return me.grounded && !me.has('stompair', window.__zu.game.match.world.time); })); i++) await wait(15);
await shot('landing');
await p.evaluate(() => { window.__cam = 'victims'; });
const t1 = await p.evaluate(() => {
  const g = window.__zu.game, w = g.match.world, me = g.match.player, t = w.time;
  for (const a of window.__v) { a.lastHitBy = me; a.forced = null; a.vel = { x: 0, y: 0, z: 0 }; a.grounded = true; a.pos.y = w.level.groundAt(a.pos.x, a.pos.z, 30); a.set('knockdown', t, 1.0); a.set('stun', t, 1.0); }
  return t;
});
for (const at of [0.08, 0.25, 0.6, 0.78, 0.9, 1.3]) { while ((await gt()) - t1 < at) await wait(15); await shot(`slam +${at}s`); }
const png = await p.evaluate(async (list, labels) => {
  const ims = await Promise.all(list.map(s => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = 'data:image/png;base64,' + s; })));
  const cw = 640, ch = Math.round(cw * ims[0].height / ims[0].width), cols = 2;
  const c = document.createElement('canvas'); c.width = cw * cols; c.height = ch * Math.ceil(ims.length / cols);
  const g = c.getContext('2d'); g.font = 'bold 18px sans-serif'; g.fillStyle = '#ff0';
  ims.forEach((im, k) => { g.drawImage(im, (k % cols) * cw, Math.floor(k / cols) * ch, cw, ch); g.fillText(labels[k], (k % cols) * cw + 8, Math.floor(k / cols) * ch + 22); });
  return c.toDataURL('image/png').split(',')[1];
}, shots, labels);
fs.writeFileSync('tests/e2e/shots/slam.png', Buffer.from(png, 'base64'));
console.log('tests/e2e/shots/slam.png', 'errors', errors.filter(e => !/Pointer Lock/.test(e)).slice(0, 3));
await b.close();
