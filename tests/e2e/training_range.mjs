// Training Grounds in the real client: V toggles first / third person, the ultimate charge packs, the Hero Range
// (console -> deploy a hero in defense / attack, shoot it with real input, the meter) and the Spar Arena (arm, walk in,
// the box seals, countdown, a round, the box opens). Screenshots: tests/e2e/shots/training/*.png
//   node tests/e2e/training_range.mjs [port=5199] [hero=gantetsu]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [port = '5199', hero = 'gantetsu'] = process.argv.slice(2);
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 600000);
const OUT = 'tests/e2e/shots/training'; fs.mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => { if (!/Pointer ?Lock/i.test(String(e))) errs.push(String(e).slice(0, 300)); });
p.on('console', m => { if (m.type() === 'error' && !/Pointer ?Lock|404|Failed to load resource/i.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
await p.evaluateOnNewDocument(() => { localStorage.setItem('zu-settings-v1', JSON.stringify({ preset: 'low', view: 'first' })); });
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 120 && !(await p.evaluate(() => !!window.__zu?.game)); i++) await wait(500);
let fails = 0;
const check = (ok, what, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${extra ? ' ' + extra : ''}`); if (!ok) fails++; };
const shot = async name => { await p.screenshot({ path: `${OUT}/${name}.png` }); };
const g = fn => p.evaluate(fn);

await p.evaluate(h => window.__zu.game.start({ mode: 'training', map: 'training', hero: h }), hero);
for (let i = 0; i < 240 && !(await g(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
await g(() => {
  const G = window.__zu.game; window.__zu.menu?.close?.(); if (G.paused) G.setPaused(false);
  Object.defineProperty(G.input, 'locked', { get: () => true, configurable: true });
  G.match.player.hp = 1e5;
});
await wait(1500);
check(await g(() => !!window.__zu.game.training && !!window.__zu.game.rangeUI), 'training scene + console built');

// ---- V: first <-> third person
const v0 = await g(() => window.__zu.game.view);
await p.keyboard.press('KeyV'); await wait(400);
const v1 = await g(() => window.__zu.game.view);
await shot('01_view_' + v1);
await p.keyboard.press('KeyV'); await wait(400);
const v2 = await g(() => window.__zu.game.view);
check(v0 !== v1 && v2 === v0, 'V toggles the view', `${v0} -> ${v1} -> ${v2}`);
await g(() => { window.__zu.game.settings.view = 'third'; });

// ---- ultimate charge pack
const up = await g(() => {
  const G = window.__zu.game, w = G.match.world, me = G.match.player, pk = w.ultPacks[0];
  me.ult = 0; me.pos = { x: pk.x - 2.5, y: pk.y, z: pk.z }; me.vel = { x: 0, y: 0, z: 0 };
  G.input.yaw = G.camYaw = Math.PI / 2; G.input.pitch = G.camPitch = -0.25;
  return { n: w.ultPacks.length, charge: me.def.ult.charge };
});
await wait(600); await shot('02_ultpack_before');
await g(() => { const G = window.__zu.game, w = G.match.world, me = G.match.player, pk = w.ultPacks[0]; me.pos = { x: pk.x, y: pk.y, z: pk.z }; });
await wait(500);
const ult = await g(() => { const G = window.__zu.game, me = G.match.player; return { ult: me.ult, ready: G.match.world.ultPacks[0].readyAt > G.match.world.time }; });
await shot('03_ultpack_taken');
check(up.n === 3 && ult.ult >= up.charge && ult.ready, 'ult pack fills the ultimate', JSON.stringify({ ...up, ...ult }));

// ---- Hero Range: G at the console opens it on the range tab; deploy Gorgoth in defense
await g(() => { const G = window.__zu.game, me = G.match.player; me.ult = 0; me.pos = { x: -16.5, y: 0, z: -15.6 }; });
await wait(300);
await p.keyboard.press('KeyG'); await wait(500);
const open = await g(() => ({ open: window.__zu.game.rangeUI.open, paused: window.__zu.game.paused, tab: window.__zu.game.rangeUI.tab }));
await shot('04_console_range');
check(open.open && open.paused && open.tab === 'range', 'G opens the console (range tab), the game pauses', JSON.stringify(open));
await p.click('.rg-console .rg-card[data-h="gorgoth"]'); await wait(150);
await p.click('.rg-console [data-k="mode"][data-v="defense"]'); await wait(150);
await p.click('.rg-console [data-k="dist"][data-v="10"]'); await wait(150);
await p.click('.rg-console .rg-deploy'); await wait(500);
const dep = await g(() => { const G = window.__zu.game, r = G.match.range; return { bot: r.bot?.baseDef.id, mode: r.opts.mode, open: G.rangeUI.open, paused: G.paused, view: G.views.has(r.bot?.id) }; });
check(dep.bot === 'gorgoth' && dep.mode === 'defense' && !dep.open && !dep.paused && dep.view, 'deploy: Gorgoth on the range, console closed, game resumed', JSON.stringify(dep));
// shoot it with the real fire button from the firing line
await g(() => {
  const G = window.__zu.game, me = G.match.player, r = G.match.range, a = r.bot;
  me.pos = { x: -14, y: 0, z: -21 }; me.vel = { x: 0, y: 0, z: 0 };
  G.settings.view = 'first';
  window.__aim = setInterval(() => { const e = me.eye, c = r.bot?.center ?? a.center; G.input.yaw = G.camYaw = Math.atan2(c.x - e.x, c.z - e.z); G.input.pitch = G.camPitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z)); }, 16);
});
await wait(1200);
await g(() => { window.__zu.game.input.mouse.l = true; });
await wait(2500);
await shot('05_range_firing_fp');
await g(() => { window.__zu.game.input.mouse.l = false; });
await wait(300);
const st = await g(() => { const s = window.__zu.game.match.range.stats; return { dealt: Math.round(s.dealt.total), hits: s.dealt.hits, dps: s.dealt.dps(), kills: s.kills, meter: document.querySelector('.rg-meter')?.className, txt: document.querySelector('.rg-meter')?.textContent?.slice(0, 120) }; });
check(st.dealt > 50 && st.hits > 5 && st.meter === 'rg-meter on', 'real shots counted by the meter', JSON.stringify(st));
// keep shooting until it drops: the time to kill is logged and it is back at its post
await g(() => { window.__zu.game.input.mouse.l = true; });
for (let i = 0; i < 40 && !(await g(() => window.__zu.game.match.range.stats.kills > 0)); i++) await wait(250);
await g(() => { window.__zu.game.input.mouse.l = false; });
await wait(2600);
const k = await g(() => { const r = window.__zu.game.match.range; return { kills: r.stats.kills, ttk: r.stats.lastTtk, log: r.stats.log[0], alive: r.bot.alive, at: Math.hypot(r.bot.pos.x - r.post.x, r.bot.pos.z - r.post.z) }; });
check(k.kills >= 1 && k.ttk > 0 && k.alive && k.at < 1, 'kill logged with TTK, target back at its post', JSON.stringify(k));
await g(() => { window.__zu.game.settings.view = 'third'; });
await wait(500); await shot('06_range_meter_3p');
// attack mode: it fights back
await g(() => window.__zu.game.match.range.deploy({ hero: 'kagemaru', mode: 'attack', abilities: true, skill: 0.8, dist: 15 }));
await wait(6000);
const atk = await g(() => { const r = window.__zu.game.match.range; return { taken: Math.round(r.stats.taken.total), bot: r.bot.baseDef.id, views: window.__zu.game.views.size, actors: window.__zu.game.match.world.actors.length }; });
await shot('07_range_attack');
check(atk.taken > 0 && atk.views <= atk.actors, 'attack mode: Kagemaru deals damage; the replaced target\'s body is gone', JSON.stringify(atk));
await g(() => { clearInterval(window.__aim); window.__zu.game.match.range.deploy({ mode: 'defense', abilities: false }); });

// ---- Spar Arena: console spar tab, arm, walk in, the box seals
await g(() => { const G = window.__zu.game, me = G.match.player; me.pos = { x: -34, y: 0, z: 6.6 }; me.hp = me.def.hp; });
await wait(300);
await p.keyboard.press('KeyG'); await wait(500);
const tab = await g(() => window.__zu.game.rangeUI.tab);
await p.click('.rg-console .rg-card[data-h="hayate"]'); await wait(150);
await p.click('.rg-console [data-k="diff"][data-v="hard"]'); await wait(150);
await p.click('.rg-console [data-k="firstTo"][data-v="2"]'); await wait(150);
await shot('08_console_spar');
await p.click('.rg-console .rg-arm'); await wait(500);
const armed = await g(() => { const s = window.__zu.game.match.spar; return { phase: s.phase, foe: s.foe?.baseDef.id, diff: s.opts.diff, firstTo: s.opts.firstTo }; });
check(tab === 'spar' && armed.phase === 'waiting' && armed.foe === 'hayate' && armed.diff === 'hard', 'spar armed from the console (spar tab by its console)', JSON.stringify({ tab, ...armed }));
await g(() => { const G = window.__zu.game; G.input.yaw = G.camYaw = 0; G.input.pitch = G.camPitch = -0.1; });
await wait(800); await shot('09_spar_open');
await g(() => { const me = window.__zu.game.match.player; me.pos = { x: -29, y: 0, z: 11.5 }; });
await wait(900);
const sealed = await g(() => { const s = window.__zu.game.match.spar; return { phase: s.phase, sealed: s.sealed, count: document.querySelector('.rg-count')?.textContent, hud: document.querySelector('.rg-spar')?.className }; });
await shot('10_spar_sealed_countdown');
check(sealed.sealed && sealed.phase === 'countdown' && sealed.hud === 'rg-spar on', 'walking in seals the box, countdown on', JSON.stringify(sealed));
await wait(3000);
await shot('11_spar_fight');
// try to walk out through the wall
await g(() => { const me = window.__zu.game.match.player; me.pos = { x: -29, y: 0, z: 5 }; });
await wait(200);
const kept = await g(() => { const G = window.__zu.game, s = G.match.spar, me = G.match.player; return { inside: s.inside(me.pos), phase: s.phase }; });
check(kept.inside && kept.phase !== 'waiting', 'the sealed box keeps you in', JSON.stringify(kept));
// win two rounds
for (let r = 0; r < 2; r++) {
  for (let i = 0; i < 30 && (await g(() => window.__zu.game.match.spar.phase)) !== 'fight'; i++) await wait(250);
  await g(() => { const G = window.__zu.game, s = G.match.spar; G.match.world.damage(G.match.player, s.foe, 9999, { kind: 'hitscan' }); });
  await wait(700);
  if (r === 0) await shot('12_spar_round_won');
}
await wait(3400);
const done = await g(() => { const s = window.__zu.game.match.spar; return { phase: s.phase, wins: s.wins, hist: s.history[0] }; });
await shot('13_spar_done');
await wait(3600);
const opened = await g(() => { const s = window.__zu.game.match.spar; return { phase: s.phase, sealed: s.sealed }; });
await shot('14_spar_reopened');
check(done.phase === 'done' && done.wins.you === 2 && done.hist?.won && opened.phase === 'waiting' && !opened.sealed, 'first to 2: spar won, the box opens', JSON.stringify({ done, opened }));

check(errs.length === 0, 'no page errors', errs.slice(0, 5).join(' | '));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
await b.close();
process.exit(fails ? 1 : 0);
