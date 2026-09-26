// Normal vs Stadium through the real menus (real GPU): node tests/e2e/modes.mjs [url]
//   NORMAL: first person, V does nothing.  STADIUM: third person, the Armory opens, an item + a power can be bought,
//   READY starts the round.  Screenshots: tests/e2e/shots/modes/*.png
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const url = process.argv[2] ?? 'http://localhost:5199/play.html';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const OUT = 'tests/e2e/shots/modes'; fs.mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|404|pointer ?lock/i.test(m.text())) errs.push(m.text().slice(0, 200)); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${info ? ' - ' + info : ''}`); };
const click = async sel => { await p.waitForSelector(sel, { timeout: 30000 }); await p.click(sel); };
await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !!window.__zu?.menu, { timeout: 60000 });

// ---- NORMAL
await click('[data-m="play"]');
await p.screenshot({ path: `${OUT}/modeselect.png` });
check('mode select shows NORMAL and STADIUM', await p.evaluate(() => document.querySelectorAll('.mode').length === 2));
await click('.mode[data-mode="skirmish"]');
await click('.go');
await p.waitForFunction(() => window.__zu.game.running && window.__zu.game.match?.player, { timeout: 90000 });
await sleep(5000);
await p.evaluate(() => { const z = window.__zu; z.menu.close(); if (z.game.paused) z.game.setPaused(false); });
await sleep(1500);
let st = await p.evaluate(() => { const g = window.__zu.game; return { mode: g.match.world.mode, view: g.view, fp: !!g.fp }; });
check('NORMAL is first person with viewmodel arms', st.mode === 'skirmish' && st.view === 'first' && st.fp, JSON.stringify(st));
await p.keyboard.press('KeyV'); await sleep(400);
check('NORMAL: V does not leave first person', await p.evaluate(() => window.__zu.game.view === 'first'));
await p.screenshot({ path: `${OUT}/normal.png` });
await p.evaluate(() => { window.__zu.game.onExit?.(); });
await sleep(1000);

// ---- STADIUM
await p.evaluate(() => window.__zu.menu.title());
await click('[data-m="play"]');
await click('.mode[data-mode="stadium"]');
await click('.go');
await p.waitForFunction(() => window.__zu.game.running && window.__zu.game.match?.world.stadium, { timeout: 90000 });
await sleep(4000);
await p.evaluate(() => { const z = window.__zu; z.menu.close(); if (z.game.paused) z.game.setPaused(false); });
await p.waitForSelector('.armory', { visible: true, timeout: 20000 }).catch(() => {});
await sleep(800);
await p.screenshot({ path: `${OUT}/armory.png` });
st = await p.evaluate(() => { const g = window.__zu.game, S = g.match.world.stadium, me = g.match.player; return { view: g.view, phase: S.phase, open: !!g.armory?.open, cash: me.cash, fp: !!g.fp }; });
check('STADIUM is third person, no viewmodel', st.view === 'third' && !st.fp, JSON.stringify(st));
check('the Armory is open before round 1', st.phase === 'armory' && st.open, JSON.stringify(st));
// buy the first affordable item on the weapon tab and pick the first power
await click('.it[data-act^="buy"]:not([disabled])');
await click('.power:not([disabled])');
await sleep(300);
const bought = await p.evaluate(() => { const me = window.__zu.game.match.player; return { items: me.items, powers: me.powers, cash: me.cash, mods: me.mods }; });
check('buying spends cash and changes stats', bought.items.length === 1 && bought.cash < st.cash && (bought.mods.weapon > 0 || bought.mods.atkspd > 0 || bought.mods.ammo > 0), JSON.stringify(bought).slice(0, 200));
check('a power was picked', bought.powers.length === 1);
await p.screenshot({ path: `${OUT}/armory_bought.png` });
await click('.armory .ready');
await p.waitForFunction(() => window.__zu.game.match.world.stadium.phase === 'fight', { timeout: 15000 }).catch(() => {});
await sleep(3000);
st = await p.evaluate(() => { const g = window.__zu.game, S = g.match.world.stadium; return { phase: S.phase, round: S.round, open: !!g.armory?.open, view: g.view }; });
check('READY starts round 1 in third person', st.phase === 'fight' && st.round === 1 && !st.open && st.view === 'third', JSON.stringify(st));
await p.screenshot({ path: `${OUT}/stadium_round.png` });
// fast-forward a round: the Armory comes back with more cash
await p.evaluate(() => { const g = window.__zu.game; g.timeScale = 8; });
await p.waitForFunction(() => { const S = window.__zu.game.match.world.stadium; return S.round >= 2 || window.__zu.game.match.world.winner; }, { timeout: 240000 }).catch(() => {});
await p.evaluate(() => { window.__zu.game.timeScale = 1; });
await sleep(1500);
st = await p.evaluate(() => { const g = window.__zu.game, S = g.match.world.stadium, me = g.match.player; return { round: S.round, wins: S.wins, phase: S.phase, open: !!g.armory?.open, cash: me.cash }; });
check('after round 1 the Armory reopens with round cash', st.round === 2 && st.phase === 'armory' && st.open && st.cash > 2000, JSON.stringify(st));
await p.screenshot({ path: `${OUT}/armory_round2.png` });
check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close();
process.exit(fails ? 1 : 0);
