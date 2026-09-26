// First-person viewmodel filmstrips (real GPU): node tests/e2e/fp_strip.mjs heroes actions [frames] [every_ms] [query]
//   node tests/e2e/fp_strip.mjs raijin,kaien idle,fire,alt,melee,reload,ability,ult 6 70
// Keeps the crosshair, hides the rest of the HUD (the ability bar covers the bottom centre, where hands often are).
// Writes tests/e2e/shots/fp/<hero>_<action>.png and prints the viewmodel source (clip:fp_* or proc:*) per action.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [heroes = 'raijin', actions = 'idle,fire,reload', N = '6', every = '70', query = ''] = process.argv.slice(2);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text().slice(0, 200)); });
await p.goto(`http://localhost:5199/play.html${query}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !!window.__zu?.game, { timeout: 60000 });
fs.mkdirSync('tests/e2e/shots/fp', { recursive: true });
const tmp = 'tests/e2e/shots/strip';
const live = () => p.evaluate(() => { const z = window.__zu; z.menu?.close?.(); if (z.game.paused) z.game.setPaused(false); z.menu?.close?.(); });
for (const hero of heroes.split(',')) {
  await p.evaluate(h => window.__zu.game.start({ mode: 'training', map: 'training', hero: h }), hero);
  await p.waitForFunction(() => window.__zu.game.running && window.__zu.game.match?.player, { timeout: 60000 });
  await p.evaluate(() => {
    const g = window.__zu.game; g.timeScale = 1; g.settings.view = 'first';
    const me = g.match.player; me.hp = me.maxHp = 1e6;                 // training bots must not interrupt
    const s = document.createElement('style'); s.textContent = '.hud > *:not(.cross){visibility:hidden !important}'; document.head.append(s);
  });
  await live();
  await new Promise(r => setTimeout(r, 4000));
  for (const act of actions.split(',')) {
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    await live();
    // stand still, look level, then trigger the action
    await p.evaluate(act => {
      const g = window.__zu.game, me = g.match.player, w = g.match.world, t = w.time;
      me.vel.x = me.vel.z = 0; me.pitch = 0;
      if (act === 'fire') { me.anim.attackAt = t; me.anim.attackKind = 'primary'; }
      if (act === 'alt') { me.anim.attackAt = t; me.anim.attackKind = 'secondary'; }
      if (act === 'melee') { me.anim.attackAt = t; me.anim.attackKind = 'punch'; }
      if (act === 'ability') { me.anim.castAt = t; me.anim.castId = me.def.ability1.id; }
      if (act === 'ability2') { me.anim.castAt = t; me.anim.castId = me.def.ability2.id; }
      if (act === 'ult') { me.anim.castAt = t; me.anim.castId = me.def.ult.id; }
      if (act === 'reload') me.reloadUntil = t + ('reload' in me.def.primary && me.def.primary.reload ? me.def.primary.reload : 1.4);
      if (act === 'hit') me.anim.hitAt = t;
      if (act === 'inspect') { const fp = g.fp; if (fp) fp.idleSince = -1e9; }
    }, act);
    const srcs = new Set();
    for (let i = 0; i < +N; i++) {
      await p.screenshot({ path: `${tmp}/${i}.png` });
      srcs.add(await p.evaluate(() => window.__zu.game.fp?.source ?? 'no fp'));
      await new Promise(r => setTimeout(r, +every));
    }
    const out = `tests/e2e/shots/fp/${hero}_${act}${query.includes('procedural') ? '_proc' : ''}.png`;
    execFileSync('python', ['tests/e2e/tile.py', out, N, '420']);
    console.log(out, [...srcs].join(' | '));
    await new Promise(r => setTimeout(r, 600));
  }
}
console.log('errors', errs.slice(0, 6));
await b.close();
