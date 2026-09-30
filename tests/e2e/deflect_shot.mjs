// Hayate's Mirror Water (a Genji-style deflect) in a real match, slow motion: the guard, and a flick of the blade for
// every shot turned on it - third person from the side, then first person.
//   node tests/e2e/deflect_shot.mjs [port]     ->  tests/e2e/shots/deflect_3p.png, tests/e2e/shots/deflect_fp.png
// Two archers stand 9 m in front of him and shoot on a timer; the deflect status is set as the ability does.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [port = '5199'] = process.argv.slice(2);
const SLOW = Number(process.env.SLOW ?? 4);
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
const errors = [];
p.on('pageerror', e => errors.push(String(e)));
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 60 && !(await p.evaluate(() => !!window.__zu?.game)); i++) await wait(500);
await p.evaluate(() => window.__zu.game.start({ mode: 'training', map: 'training', hero: 'hayate' }));
for (let i = 0; i < 120 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
await p.evaluate(() => {
  const g = window.__zu.game, w = g.match.world, me = g.match.player;
  window.__zu.menu?.close?.(); me.hp = 1e5;
  Object.defineProperty(g.input, 'locked', { get: () => true, configurable: true }); g.setPaused(false);
  for (const a of w.actors) if (a.isRobot) { a.pos = { x: 0, y: -200, z: 0 }; a.alive = false; a.respawnAt = 1e9; }
  me.pos = { x: -10, y: w.level.groundAt(-10, -12, 30), z: -12 }; me.vel = { x: 0, y: 0, z: 0 };
  me.yaw = me.input.yaw = 0; g.input.yaw = 0; g.camYaw = 0; g.input.pitch = 0; g.camPitch = 0;
  window.__v = ['yuzu', 'seiran'].map((id, k) => {
    const a = w.addHero(id, 'umbra');
    const x = -10 + (k ? 2.2 : -2.2), z = -3;
    a.pos = { x, y: w.level.groundAt(x, z, 30), z }; a.vel = { x: 0, y: 0, z: 0 }; a.yaw = a.input.yaw = Math.PI; a.clear('spawnprot'); a.controller = null; a.hp = 1e5;
    a.input.pitch = 0; a.pitch = 0;
    return a;
  });
  const orig = g.updateCamera.bind(g);
  window.__side = false;
  g.updateCamera = (dt, m) => { orig(dt, m); if (m && window.__side) { const c = g.camera; c.position.set(m.pos.x + 3.6, m.pos.y + 1.6, m.pos.z + 0.4); c.lookAt(m.pos.x, m.pos.y + 1.2, m.pos.z + 1.2); } };
  // the archers fire on a timer: an arrow every 0.45 s, alternating
  window.__shoot = k => { const a = window.__v[k]; const dx = me.pos.x - a.pos.x, dz = me.pos.z - a.pos.z; a.yaw = a.input.yaw = Math.atan2(dx, dz); a.pitch = a.input.pitch = 0.02; a.input.fire = true; setTimeout(() => { a.input.fire = false; }, 60); };
});
const gt = () => p.evaluate(() => window.__zu.game.match.world.time);
const strip = async (name, shots, labels) => {
  const png = await p.evaluate(async (list, labels) => {
    const ims = await Promise.all(list.map(s => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.src = 'data:image/png;base64,' + s; })));
    const cw = 640, ch = Math.round(cw * ims[0].height / ims[0].width), cols = 3;
    const c = document.createElement('canvas'); c.width = cw * cols; c.height = ch * Math.ceil(ims.length / cols);
    const g = c.getContext('2d'); g.font = 'bold 18px sans-serif'; g.fillStyle = '#ff0';
    ims.forEach((im, k) => { g.drawImage(im, (k % cols) * cw, Math.floor(k / cols) * ch, cw, ch); g.fillText(labels[k], (k % cols) * cw + 8, Math.floor(k / cols) * ch + 22); });
    return c.toDataURL('image/png').split(',')[1];
  }, shots, labels);
  fs.writeFileSync(`tests/e2e/shots/${name}.png`, Buffer.from(png, 'base64'));
  console.log(`tests/e2e/shots/${name}.png`);
};
for (const view of ['third', 'first']) {
  await p.evaluate(v => { const g = window.__zu.game; g.settings.view = v; window.__side = v === 'third'; g.timeScale = 1; }, view);
  for (let i = 0; i < 5; i++) { await p.evaluate(() => { const z = window.__zu; if (z.game.paused) z.game.setPaused(false); }); await wait(500); }
  await p.evaluate(k => { window.__zu.game.timeScale = 1 / k; }, SLOW);
  const shots = [], labels = [];
  const shot = async l => { shots.push(await p.screenshot({ encoding: 'base64' })); labels.push(l); };
  await shot('before');
  // E: the guard comes up (the real ability)
  await p.evaluate(() => { const me = window.__zu.game.match.player; me.cd.mirrorwater = 0; me.clear('deflect'); });   // off cooldown for the second view
  await p.keyboard.down('KeyE'); await wait(90); await p.keyboard.up('KeyE');
  const t0 = await gt();
  const info = await p.evaluate(() => { const me = window.__zu.game.match.player, t = window.__zu.game.match.world.time; return { deflect: me.has('deflect', t), cd: me.cd?.a2 }; });
  console.log(view, 'after E', JSON.stringify(info));
  while ((await gt()) - t0 < 0.3) await wait(10);
  await shot('guard');
  // arrows in: shoot, then catch the frame after each contact
  for (let k = 0; k < 3; k++) {
    await p.evaluate(kk => window.__shoot(kk % 2), k);
    const tA = await gt();
    let hit = false;
    while ((await gt()) - tA < 0.6) { if (await p.evaluate(() => window.__zu.game.match.world.time - window.__zu.game.match.player.anim.deflectAt < 0.06)) { hit = true; break; } await wait(8); }
    if (hit) { await wait(6 * SLOW); await shot(`turned #${k + 1}`); } else await shot(`arrow ${k + 1} (no deflect seen)`);
  }
  const n = await p.evaluate(() => ({ deflects: window.__zu.game.match.player.stats.deflects ?? 0, n: window.__zu.game.match.player.anim.deflectN }));
  console.log(view, 'deflects', JSON.stringify(n));
  while ((await gt()) - t0 < 2.4) await wait(20);
  await shot('after');
  await strip(view === 'third' ? 'deflect_3p' : 'deflect_fp', shots, labels);
}
console.log('errors', errors.filter(e => !/Pointer Lock/.test(e)).slice(0, 3));
await b.close();
