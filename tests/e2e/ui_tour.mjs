// node tests/e2e/ui_tour.mjs [port]  -> tests/e2e/shots/tour_*.png
// The desktop edition's menus (title, queues, career), a live AI Quick Match (Control HUD, Tab screen), Mikoshi Rush,
// the competitive results screen - and the web edition's title (?edition=lite).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const port = process.argv[2] ?? '5199';
const URL = `http://localhost:${port}/play.html`;
const out = 'tests/e2e/shots'; fs.mkdirSync(out, { recursive: true });
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--window-size=1600,900', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; let lastShot = 'start'; p.on('pageerror', e => errs.push(`[after ${lastShot}] ` + (e.stack || e.message))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = async name => { await p.screenshot({ path: `${out}/tour_${name}.png` }); console.log('shot', name); lastShot = name; };
const zu = (fn, ...a) => p.evaluate(fn, ...a);

await p.goto(URL, { waitUntil: 'domcontentloaded' }); await wait(2000);
await shot('01_title');
await zu(() => window.__zu.menu.queueSelect('competitive')); await wait(500); await shot('02_competitive');
await zu(() => window.__zu.menu.queueSelect('practice')); await wait(800); await shot('03_ai_quick_match');
await zu(() => window.__zu.menu.career()); await wait(400); await shot('04_career');

// AI Quick Match on a map with buildings: Gantetsu, third person
const play = async (map, hero, queue) => {
  await zu((map, hero, queue) => { const M = window.__zu.menu; M.queue = queue; M.mode = queue; M.map = map; M.hero = hero; M.role = 'tank'; M.opp = 1900; M.diff = 0.62; return M.launch(); }, map, hero, queue);
  for (let i = 0; i < 60 && !(await zu(map => window.__zu.game?.match?.world?.map.id === map && window.__zu.game.running, map)); i++) await wait(500);
  await wait(1500);
};
await play('hanabi', 'gantetsu', 'practice');
await zu(() => { window.__zu.game.settings.view = 'third'; });
await wait(3000); await shot('05_hanabi_spawn');
// let the match run until the point opens and the fight starts
await zu(() => { const w = window.__zu.game.match.world; for (let i = 0; i < 60 * 16; i++) w.step(1 / 60); });
await wait(2500); await shot('06_hanabi_fight');
await zu(() => { window.__zu.game.settings.view = 'first'; }); await wait(1500); await shot('06b_hanabi_fp');
await zu(() => window.__zu.game.input.keys.add('Tab')); await wait(600); await shot('07_tab_screen');
await zu(() => window.__zu.game.input.keys.delete('Tab'));
const stats = await zu(() => { const me = window.__zu.game.match.player, w = window.__zu.game.match.world; return { rules: w.rules, packs: w.packs.length, shots: me.shots, hits: me.hits, round: w.control.round }; });
console.log('match', JSON.stringify(stats));

// Mikoshi Rush
await zu(() => window.__zu.game.stop());
await play('kagura', 'mirei', 'practice');
await zu(() => { const w = window.__zu.game.match.world; for (let i = 0; i < 60 * 30; i++) w.step(1 / 60); });
await wait(2500); await shot('08_kagura_push');

// Competitive result screen
await zu(() => { const M = window.__zu.menu; M.queue = 'competitive'; M.role = 'tank'; window.__zu.game.match.world.end(window.__zu.game.match.player.team); });
await wait(5000); await shot('09_results');

// flyover of every play map (spectate camera, no HUD) - buildings, packs, water
await zu(() => window.__zu.game.stop());
for (const id of ['amatsu', 'kurogane', 'hangar', 'cathedral', 'rift', 'hanabi', 'cloudstep', 'kagura']) {
  await zu(id => { const M = window.__zu.menu; M.queue = null; M.mode = 'spectate'; M.map = id; return M.launch(); }, id);
  for (let i = 0; i < 60 && !(await zu(id => window.__zu.game?.match?.world?.map.id === id && window.__zu.game.running, id)); i++) await wait(500);
  await zu(() => { const w = window.__zu.game.match.world; for (let i = 0; i < 60 * 14; i++) w.step(1 / 60); });
  await wait(3500); await shot(`map_${id}`);
  await zu(() => window.__zu.game.stop());
}

// the web edition
await p.goto(URL + '?edition=lite', { waitUntil: 'domcontentloaded' }); await wait(2000); await shot('10_lite_title');
console.log('errors', errs.length, errs.slice(0, 2).join('\n-----\n'));
await b.close();
