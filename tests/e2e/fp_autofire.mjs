// First person, sustained fire: hold fire for a few seconds per hero and track both hands on screen every frame.
//   node tests/e2e/fp_autofire.mjs [heroes=all] [port=5199] [secs=4]
// Reports, per hero, the range of each hand's NDC y over the hold and the frames where a hand was thrown far below the
// frame (NDC y < LIMIT, default -1.6: the bind-pose flash of a one-shot cross-faded from itself, fixed in cb71df2).
// SCEN=swap: start as raijin and H-swap to the hero first. Shots: tests/e2e/shots/fp/auto_<hero>.png (mid-hold).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const ALL = 'tenkai,mirei,kaien,raijin,yuzu,gorgoth,nocturne,hex,kagemaru,enra,gantetsu,hibiki,tomoe,hayate,seiran,haruto';
const [heroesArg = 'all', port = '5199', secs = '4'] = process.argv.slice(2);
const heroes = (heroesArg === 'all' ? ALL : heroesArg).split(',');
const LIMIT = +(process.env.LIMIT ?? -1.6);
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 900000);
fs.mkdirSync('tests/e2e/shots/fp', { recursive: true });
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errors = [];
p.on('pageerror', e => { if (!/Pointer ?Lock/i.test(String(e))) errors.push(String(e).slice(0, 200)); });
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 80 && !(await p.evaluate(() => !!window.__zu?.game)); i++) await wait(500);
let bad = 0;
for (const hero of heroes) {
  const swap = process.env.SCEN === 'swap';
  await p.evaluate(h => window.__zu.game.start({ mode: 'training', map: 'training', hero: h }), swap ? 'raijin' : hero);
  for (let i = 0; i < 160 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
  if (swap) { await p.evaluate(() => { window.__zu.game.settings.view = 'first'; }); await wait(3000); await p.evaluate(h => window.__zu.game.swapHero(h), hero); await wait(1500); }
  await p.evaluate(() => {
    const g = window.__zu.game, me = g.match.player; window.__zu.menu?.close?.(); if (g.paused) g.setPaused(false);
    g.settings.view = 'first'; me.hp = me.maxHp = 1e6; me.pos = { x: -31, y: 0, z: 13 }; g.input.yaw = 0; g.input.pitch = 0;
  });
  for (let i = 0; i < 40 && !(await p.evaluate(() => !!window.__zu.game.fp?.view?.real)); i++) await wait(500);
  await wait(2000);
  // sample the hands every animation frame: idle for 1 s, then holding fire
  await p.evaluate(() => {
    const g = window.__zu.game;
    const S = window.__fpq = { frames: [], on: true, fire: false };
    const v3 = g.fp.camera.position.clone();
    const tick = () => {
      if (!S.on) return;
      const fp = g.fp, v = fp?.view;
      if (v?.model) {
        const f = { t: performance.now(), fire: S.fire, clip: fp.playing?.name ?? null, vis: !!v.group.visible };
        for (const n of ['hand_R', 'hand_L']) {
          let o = null; v.model.traverse(x => { if (!o && x.name.replace(/\./g, '_') === n) o = x; });
          if (o) { v3.setFromMatrixPosition(o.matrixWorld).project(fp.camera); f[n] = [+v3.x.toFixed(3), +v3.y.toFixed(3), +v3.z.toFixed(3)]; }
        }
        S.frames.push(f);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await wait(1000);
  await p.evaluate(() => { const g = window.__zu.game, S = window.__fpq; Object.defineProperty(g.input, 'locked', { get: () => true, configurable: true }); const h = g.input.held.bind(g.input); g.input.held = x => x === 'fire' || h(x); S.fire = true; });
  await wait(+secs * 500);
  await p.screenshot({ path: `tests/e2e/shots/fp/auto_${hero}.png` });
  await wait(+secs * 500);
  const r = await p.evaluate(LIMIT => {
    const g = window.__zu.game, S = window.__fpq; S.on = false; delete g.input.held; delete g.input.locked;
    const out = { defId: g.fp?.defId, frames: S.frames.length, fireFrames: S.frames.filter(f => f.fire).length, clips: [...new Set(S.frames.filter(f => f.fire).map(f => f.clip))], ammo: g.match.player.ammo };
    for (const n of ['hand_R', 'hand_L']) {
      const idle = S.frames.filter(f => !f.fire && f[n]).map(f => f[n][1]), fire = S.frames.filter(f => f.fire && f[n]);
      if (!fire.length) { out[n] = null; continue; }
      const ys = fire.map(f => f[n][1]);
      const flash = fire.filter(f => f[n][1] < LIMIT);
      // a flash = a jump between consecutive frames far larger than any recoil
      let jump = 0; for (let i = 1; i < fire.length; i++) jump = Math.max(jump, Math.abs(fire[i][n][1] - fire[i - 1][n][1]));
      out[n] = { idleY: idle.length ? +(idle.reduce((a, c) => a + c, 0) / idle.length).toFixed(2) : null, minY: Math.min(...ys), maxY: Math.max(...ys), maxJump: +jump.toFixed(2), below: flash.length, first: flash[0] ? { t: Math.round(flash[0].t - fire[0].t), clip: flash[0].clip, y: flash[0][n][1] } : null };
    }
    out.hiddenFrames = S.frames.filter(f => f.fire && !f.vis).length;
    return out;
  }, LIMIT);
  const flag = ['hand_R', 'hand_L'].some(n => r[n] && r[n].below > 0) || r.hiddenFrames > 0;
  if (flag) bad++;
  console.log(flag ? 'FLAG' : 'ok  ', hero, JSON.stringify(r));
}
console.log('errors', JSON.stringify(errors.slice(0, 5)));
console.log(bad ? `${bad} hero(es) flagged` : 'no hand left the frame');
await b.close();
process.exit(bad ? 1 : 0);
