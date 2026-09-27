// node tests/e2e/tomoe_play.mjs [port] - Tomoe on the training grounds: the Crownfire Scattergun, the Crescent Fang thrown into
// a robot and recalled, Crescent Reaping, Horagai War Call, Crescent Warpath - in third person, then the first-person
// viewmodel (shotgun, throw, cleave); screenshots of each; sounds heard; no page errors.
import puppeteer from 'puppeteer-core';
const port = process.argv[2] ?? '5199';
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 300000);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.stack || e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text().slice(0, 300)); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = n => p.screenshot({ path: `tests/e2e/shots/tomoe_${n}.png` });
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 }); await wait(1500);
await p.evaluate(() => window.__zu.game.start({ mode: 'training', map: 'training', hero: 'tomoe' }));
for (let i = 0; i < 60 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
for (let i = 0; i < 40 && !(await p.evaluate(() => window.__zu.sfx.bank.ready)); i++) await wait(500);
await p.evaluate(() => { const g = window.__zu.game; window.__zu.menu.close(); g.settings.view = 'third'; g.match.player.hp = 1e5; window.__zu.sfx.played = {}; });
const press = async (code, ms = 80) => { await p.evaluate(c => window.__zu.game.input.keys.add(c), code); await wait(ms); await p.evaluate(c => window.__zu.game.input.keys.delete(c), code); };
const click = async (btn, ms = 90) => { await p.evaluate(k => { window.__zu.game.input.mouse[k] = true; }, btn); await wait(ms); await p.evaluate(k => { window.__zu.game.input.mouse[k] = false; }, btn); };
// face the nearest robot from 9m
const face = () => p.evaluate(() => {
  const g = window.__zu.game, me = g.match.player, w = g.match.world;
  const bot = w.actors.filter(x => x.alive && x.team !== me.team).sort((a, b) => Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z) - Math.hypot(b.pos.x - me.pos.x, b.pos.z - me.pos.z))[0];
  if (!bot) return null;
  const d = Math.hypot(bot.pos.x - me.pos.x, bot.pos.z - me.pos.z);
  if (d > 10) { const k = (d - 9) / d; me.pos = { x: me.pos.x + (bot.pos.x - me.pos.x) * k, y: bot.pos.y, z: me.pos.z + (bot.pos.z - me.pos.z) * k }; me.vel = { x: 0, y: 0, z: 0 }; }
  const e = me.eye, c = bot.center;
  g.camYaw = g.input.yaw = Math.atan2(c.x - e.x, c.z - e.z); g.camPitch = g.input.pitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z));
  return bot.def.id;
});
const state = () => p.evaluate(() => { const me = window.__zu.game.match.player, t = window.__zu.game.match.world.time; return { fang: me.sv.fang ?? 0, hp: Math.round(me.hp), shields: me.shields.map(s => s.kind + ':' + Math.round(s.amt)), cdReap: +me.cdLeft('reaping', t).toFixed(1), stats: me.stats }; });
const out = {};
out.target = await face(); await wait(1200); await shot('1_idle');
await click('l'); await wait(120); await shot('2_scattergun');
await wait(900); await face();
await click('r'); await wait(450); out.thrown = await state(); await shot('3_fang_stuck');
await click('r'); await wait(160); await shot('4_recall'); await wait(1200); out.recalled = await state();
await face(); await press('KeyE'); await wait(320); await shot('5_reaping_a'); await wait(200); await shot('6_reaping_b'); await wait(500); out.reaped = await state();
await press('ShiftLeft'); await wait(250); await shot('7_warcall'); out.warcall = await state();
await wait(1500); await face();
await p.evaluate(() => { const me = window.__zu.game.match.player; me.ult = me.def.ult.charge; });
await press('KeyQ'); await wait(450); await shot('8_warpath'); await wait(1200); out.warpath = await state();
// first person: the viewmodel
await p.evaluate(() => { window.__zu.game.settings.view = 'first'; }); await wait(600); await face(); await wait(900);
await shot('9_fp_idle'); await click('l'); await wait(90); await shot('10_fp_fire');
await wait(1000); await click('r'); await wait(120); await shot('11_fp_throw');
await wait(300); await click('r'); await wait(1300);
await press('KeyE'); await wait(300); await shot('12_fp_cleave_a'); await wait(150); await shot('13_fp_cleave_b');
const res = await p.evaluate(() => { const s = window.__zu.sfx; return { played: Object.keys(s.played).sort(), fromBank: Object.keys(s.played).filter(k => s.bank.has(k)).length, unknown: [...(s.unknown ?? [])] }; });
console.log(JSON.stringify({ ...out, ...res }, null, 1));
console.log('errors', errs.length, errs.slice(0, 3).join('\n---\n'));
await b.close(); process.exit(errs.length ? 1 : 0);
