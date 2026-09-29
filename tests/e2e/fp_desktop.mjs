// First-person viewmodel check on the INSTALLED desktop app (or a dev server): one hero at a time on the training
// grounds, first person, idle then holding fire - screenshots plus a dump of what the viewmodel actually holds (which
// model loaded, how many arm triangles survived armsOnly, the guns / held props and whether they sit in the camera's view).
//   DESKTOP=1 node tests/e2e/fp_desktop.mjs gantetsu,raijin        (installed app, %LOCALAPPDATA%/Programs/ZenithUmbra)
//   node tests/e2e/fp_desktop.mjs gantetsu 5210                    (dev server)
//   ELECTRON_UA=1 node tests/e2e/fp_desktop.mjs gantetsu 5220      (a static serve of the installed app's extracted asar)
// -> tests/e2e/shots/fp/desk_<hero>_{idle,fire}.png
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
const [heroes = 'gantetsu', port = '5199'] = process.argv.slice(2);
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 420000);
fs.mkdirSync('tests/e2e/shots/fp', { recursive: true });
let b, p, proc;
if (process.env.DESKTOP) {
  const exe = path.join(process.env.LOCALAPPDATA, 'Programs', 'ZenithUmbra', 'ZenithUmbra.exe');
  proc = spawn(exe, ['--remote-debugging-port=9336'], { detached: false, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await (await fetch('http://127.0.0.1:9336/json/version')).json(); break; } catch { await wait(1000); } }
  await wait(3000);
  b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9336', defaultViewport: null });
  [p] = (await b.pages()).filter(x => x.url().includes('play.html'));
} else {
  b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
  p = await b.newPage();
  // a static copy of the installed build (asar-extracted): pose as the Electron shell so the desktop edition turns on
  if (process.env.ELECTRON_UA) await p.setUserAgent((await b.userAgent()) + ' Electron/33.0.0');
  await p.goto(`http://localhost:${port}/play.html${process.env.ELECTRON_UA ? '?platform=desktop' : ''}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
}
for (let i = 0; i < 80 && !(await p.evaluate(() => !!window.__zu?.game)); i++) await wait(500);
const errors = [];
p.on('pageerror', e => errors.push(String(e).slice(0, 200)));
for (const hero of heroes.split(',')) {
  // SCEN: start (training as the hero) | swap (training as raijin, then H-swap to the hero) | menu (a practice match
  // launched through the menu, preloader and all - how a player gets there) ; RESPAWN=1 then dies and respawns
  const scen = process.env.SCEN ?? 'start';
  if (scen === 'menu') await p.evaluate(h => { const z = window.__zu.menu; z.queue = 'practice'; z.mode = 'practice'; z.map = 'kagura'; z.hero = h; void z.launch(); }, hero);
  else await p.evaluate(h => window.__zu.game.start({ mode: 'training', map: 'training', hero: h }), scen === 'swap' ? 'raijin' : hero);
  for (let i = 0; i < 160 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
  if (scen === 'swap') { await p.evaluate(() => { const g = window.__zu.game; g.settings.view = 'first'; }); await wait(3000); await p.evaluate(h => window.__zu.game.swapHero(h), hero); await wait(1500); }
  if (process.env.RESPAWN) { await p.evaluate(() => { const g = window.__zu.game; g.settings.view = 'first'; const me = g.match.player; me.hp = 1; g.match.world.damage(me, me, 99999, { kind: 'ability' }); }); for (let i = 0; i < 40 && !(await p.evaluate(() => window.__zu.game.match.player.alive)); i++) await wait(500); await wait(1500); }
  await p.evaluate(() => {
    const g = window.__zu.game, me = g.match.player; window.__zu.menu?.close?.(); if (g.paused) g.setPaused(false);
    g.settings.view = 'first'; me.hp = me.maxHp = 1e6; if (g.match.world.mode === 'training') { me.pos = { x: -31, y: 0, z: 13 }; g.input.yaw = 0; } g.input.pitch = 0;
  });
  for (let i = 0; i < 40 && !(await p.evaluate(() => !!window.__zu.game.fp?.view?.real)); i++) await wait(500);
  await wait(2500);
  const dump = () => p.evaluate(() => {
    const g = window.__zu.game, fp = g.fp; if (!fp) return { fp: null };
    const v = fp.view, cam = fp.camera; cam.updateMatrixWorld(); fp.scene.updateMatrixWorld(true);
    const frustum = new (cam.projectionMatrix.constructor)(); const THREEBox = v.group.children[0]?.constructor;
    let tris = 0, meshes = 0, hidden = 0; v.model.traverse(o => { if (o.isMesh) { meshes++; if (!o.visible) hidden++; const idx = o.geometry.index; tris += (idx ? idx.count : o.geometry.attributes.position.count) / 3; } });
    const inView = (o) => { const e = o.matrixWorld.elements; const x = e[12], y = e[13], z = e[14]; const pc = { x, y, z }; const q = cam.matrixWorldInverse.elements; const cx = q[0] * x + q[4] * y + q[8] * z + q[12], cy = q[1] * x + q[5] * y + q[9] * z + q[13], cz = q[2] * x + q[6] * y + q[10] * z + q[14]; return { cam: [cx, cy, cz].map(n => +n.toFixed(2)), front: cz < 0 }; };
    const guns = (v.guns ?? []).map(gn => ({ visible: gn.group.visible, parentVisible: !!gn.group.parent?.visible, scale: +gn.group.scale.x.toFixed(2), children: gn.group.children.length, ...inView(gn.group) }));
    return { defId: fp.defId, fireState: { beam: !!g.match.player.beamOn, flame: !!g.match.player.flameOn, charging: !!g.match.player.charging, ammo: g.match.player.ammo }, real: v.real, src: v.model.userData?.src ?? v.model.name, meshes, hidden, tris: Math.round(tris), guns, style: fp.style, groupVisible: v.group.visible, inScene: !!v.group.parent, clip: fp.playing?.name ?? null };
  });
  const idle = await dump();
  await p.screenshot({ path: `tests/e2e/shots/fp/desk_${hero}_${process.env.SCEN ?? 'start'}${process.env.RESPAWN ? '_rs' : ''}_idle.png` });
  // hold fire: fake the pointer lock (headless / automation cannot take one) and the fire binding
  await p.evaluate(() => { const g = window.__zu.game; Object.defineProperty(g.input, 'locked', { get: () => true, configurable: true }); const h = g.input.held.bind(g.input); g.input.held = x => x === 'fire' || h(x); });
  await wait(700);
  await p.screenshot({ path: `tests/e2e/shots/fp/desk_${hero}_${process.env.SCEN ?? 'start'}${process.env.RESPAWN ? '_rs' : ''}_fire.png` });
  const firing = await dump();
  await p.evaluate(() => { const g = window.__zu.game; delete g.input.held; delete g.input.locked; });
  console.log(hero, JSON.stringify({ idle, firing }));
}
console.log('errors', JSON.stringify(errors.slice(0, 5)));
if (process.env.DESKTOP) { await b.disconnect(); proc.kill(); } else await b.close();
process.exit(0);
