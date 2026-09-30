// The climbers' maps through the real input path (keys and mouse buttons into Input, not the actor's input record):
//   node tests/e2e/map_climb.mjs [port=5199] [maps=mile,gulch] [heroes=hayate,hibiki]
// Each route: the hero is put at the foot of the face looking at it, W held, then
//   hayate  Space held + a fresh tap every 0.2 s (the Koryu wall run)
//   hibiki  his grind binding held (left mouse by default) while skating at the face and looking up it (Mag-Grind climb)
// until he stands on the top (then every key is released) or the time is up. A route fails if he never stands on the
// top or gets past the arena's edge on the way; where he is at the end is reported. Screenshot from each perch: tests/e2e/shots/climb/<map>_<route>_<hero>.png
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [port = '5199', mapsArg = 'mile,gulch', heroesArg = 'hayate,hibiki'] = process.argv.slice(2);
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 1500000);
const OUT = 'tests/e2e/shots/climb'; fs.mkdirSync(OUT, { recursive: true });
// map, route, x, z, yaw (0 = +z), standing height, top      (the faces of tests/unit/maps_climb.test.ts + the east rock mass)
const ROUTES = [
  ['mile', 'butte_ledge', -28, 19.3, 0, 0, 5],
  ['mile', 'butte_summit', -28, 23.3, 0, 5, 12],
  ['mile', 'south_shelf', -18, -22.3, Math.PI, 0, 8],
  ['mile', 'sign_tower', 0, 9.3, 0, 0, 6],
  ['gulch', 'boxcar', -40, 10.2, 0, 0, 4.2],
  ['gulch', 'south_ledge', -14, -20.3, Math.PI, 0, 6],
  ['gulch', 'crag', -11, -26.3, Math.PI, 6, 12],
  ['gulch', 'west_rock', -40, 21.8, 0, 5, 8],
  ['gulch', 'east_rock', -20, 21.8, 0, 0, 8],
  // the Proving Grounds' own 10 m wall: Hayate climbs it Genji-style (one 7.8 m climb a time, never onto the top)
  ['training', 'arena_wall', -30, 22, 0, 0, 6, 'noTop'],
].filter(r => mapsArg.split(',').includes(r[0]));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => { if (!/Pointer ?Lock/i.test(String(e))) errs.push(String(e).slice(0, 200)); });
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 80 && !(await p.evaluate(() => !!window.__zu?.game)); i++) await wait(500);
let fails = 0, cur = '';
for (const hero of heroesArg.split(',')) for (const [map, route, x, z, yaw, y0, top, noTop] of ROUTES) {
  if (cur !== map + hero) {
    await p.evaluate((m, h) => window.__zu.game.start({ mode: m === 'training' ? 'training' : 'practice', map: m, hero: h }), map, hero);
    for (let i = 0; i < 240 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
    await p.evaluate(() => {
      const g = window.__zu.game; window.__zu.menu?.close?.(); if (g.paused) g.setPaused(false);
      // headless has no pointer lock: say it is held, so the real key / button state is read
      Object.defineProperty(g.input, 'locked', { get: () => true, configurable: true });
      g.settings.view = 'third';
      // nobody else on the field: the bots would shoot him off the wall
      for (const a of g.match.world.actors) if (a !== g.match.player) { a.pos = { x: 60, y: 0, z: (a.team === g.match.player.team ? 1 : -1) * 3 }; a.input = a.input ?? {}; a.ai = false; a.bot = null; a.hp = a.maxHp; }
    });
    await wait(2500); cur = map + hero;
  }
  // at the foot of the face, looking at it (hibiki: looking up it)
  const pitch = hero === 'hibiki' ? 0.9 : 0;
  await p.evaluate((x, z, yaw, y0, pitch, top) => {
    const g = window.__zu.game, me = g.match.player, w = g.match.world;
    me.hp = 1e6; me.clear?.('spawnprot');
    me.pos = { x, y: Math.max(0, w.level.groundAt(x, z, y0 + 1)), z }; me.vel = { x: 0, y: 0, z: 0 };
    g.input.yaw = g.camYaw = yaw; g.input.pitch = g.camPitch = pitch; me.yaw = yaw;
    // watch every frame: the peak, the states he went through, the first moment he stands on the top, and whether he
    // ever got past the arena's edge (the top of a boundary wall is outside it)
    const [BX, BZ] = w.level.size;
    const C = window.__climb = { on: true, maxY: me.pos.y, states: {}, stood: null, t0: w.time, outside: null, m0: me.stats?.mantles ?? 0 };
    const tick = () => {
      if (!C.on) return;
      const t = w.time; C.maxY = Math.max(C.maxY, me.pos.y);
      for (const n of ['wallclimb', 'grinding']) if (me.has(n, t)) C.states[n] = (C.states[n] ?? 0) + 1;
      // (a mantle lands him on the top inside the sim, grounded that same frame; with the keys still held a fast hero can
      // be off a small roof again before this frame samples him, so the mantle count stands in for the sample)
      if (!C.stood && ((me.grounded && me.pos.y > top - 0.3) || ((me.stats?.mantles ?? 0) > C.m0 && me.pos.y > top - 0.3))) C.stood = { t: +(t - C.t0).toFixed(2), x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2) };
      if (!C.outside && (Math.abs(me.pos.x) > BX || Math.abs(me.pos.z) > BZ)) C.outside = { t: +(t - C.t0).toFixed(2), x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2) };
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, x, z, yaw, y0, pitch, top);
  await wait(400);
  const start = await p.evaluate(() => +window.__zu.game.match.player.pos.y.toFixed(2));
  // real key and button events from here on (keydown / keyup / mousedown on the page)
  await p.mouse.move(800, 450);
  await p.keyboard.down('KeyW');
  let up = false, secs = 0;
  // hibiki: skate at the wall looking up it with the grind held - no jump taps (they would feed his Groove and the
  // speed would carry him along the wall instead of up it)
  if (hero === 'hibiki') await p.mouse.down(); else await p.keyboard.down('Space');
  const T0 = Date.now();
  for (let k = 0; k < 140 && !up; k++) {
    await wait(60);
    // hayate: a fresh tap every 0.2 s (release and press again)
    if (hero === 'hayate' && k % 3 === 2) { await p.keyboard.up('Space'); await wait(30); await p.keyboard.down('Space'); }
    up = await p.evaluate((yaw, pitch) => { const g = window.__zu.game, i = g.input; i.yaw = g.camYaw = yaw; i.pitch = g.camPitch = pitch; return !!window.__climb.stood; }, yaw, pitch);
    secs = (Date.now() - T0) / 1000;
  }
  // on the top (or out of time): let go of everything, the way a player does once he's up
  await p.keyboard.up('KeyW'); if (hero === 'hibiki') await p.mouse.up(); else await p.keyboard.up('Space');
  await wait(900);
  // from the perch: turn round and look out over the map
  await p.evaluate(yaw => { const g = window.__zu.game; g.input.yaw = g.camYaw = yaw + Math.PI; g.input.pitch = g.camPitch = -0.25; }, yaw);
  await wait(500);
  const end = await p.evaluate(() => { const g = window.__zu.game, me = g.match.player, C = window.__climb; C.on = false; return { x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2), grounded: me.grounded, maxY: +C.maxY.toFixed(2), states: C.states, stood: C.stood, outside: C.outside, mantles: (me.stats?.mantles ?? 0) - C.m0 }; });
  await p.screenshot({ path: `${OUT}/${map}_${route}_${hero}.png` });
  // he got up there (where he went next is reported, not judged); a 'noTop' route is a wall with no top to reach (the arena's
  // own): it passes when he climbed at least `top` metres and never stood above the ground
  const ok = noTop ? end.maxY > top && !end.stood && !end.outside : !!end.stood && !end.outside;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${map} ${route} ${hero}: from ${start} to ${end.y} (top ${top}, peak ${end.maxY}) in ${secs.toFixed(1)}s${end.outside ? ' - LEFT THE ARENA' : ''}`, JSON.stringify(end));
}
console.log('errors', JSON.stringify(errs.slice(0, 5)));
console.log(fails ? `${fails} route(s) not climbed` : 'every route climbed');
await b.close();
process.exit(fails ? 1 : 0);
