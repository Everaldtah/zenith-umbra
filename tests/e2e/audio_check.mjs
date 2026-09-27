// node tests/e2e/audio_check.mjs [port] [hero] [map]
// The desktop edition's sound in a live match: the recorded bank loads, gunfire / footsteps / impacts play from it (not
// the synth fallback), loops run, heroes speak (voice lines by stimulus), the announcer calls the objective, occlusion and
// the threat mix are live - plus screenshots of the weapon VFX (tracers, flashes, sparks, scorch) in first and third person.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [port = '5199', hero = 'gantetsu', map = 'hanabi'] = process.argv.slice(2);
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 300000);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: ['--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.stack || e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text().slice(0, 300)); });
const wait = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('tests/e2e/shots', { recursive: true });
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 }); await wait(1500);
await p.evaluate(() => window.__zu.game && 0);
p.evaluate((map, hero) => { const M = window.__zu.menu; M.queue = 'practice'; M.mode = 'practice'; M.map = map; M.hero = hero; M.launch(); }, map, hero);
for (let i = 0; i < 80 && !(await p.evaluate(m => window.__zu.game?.match?.world?.map.id === m && window.__zu.game.running, map)); i++) await wait(500);
// the bank decodes in the background after the audio context unlocks
for (let i = 0; i < 60 && !(await p.evaluate(() => window.__zu.sfx.bank.ready)); i++) await wait(500);
const bank = await p.evaluate(() => { const s = window.__zu.sfx; return { ready: s.bank.ready, ctx: s.ctx?.state, sfx: Object.keys(s.bank.info?.sfx ?? {}).length, voices: Object.keys(s.bank.info?.vo ?? {}).length }; });
console.log('bank', JSON.stringify(bank));
// let the fight start: skip to the point opening, then play 20s in real time with the player firing at the nearest enemy
await p.evaluate(() => { const w = window.__zu.game.match.world; for (let i = 0; i < 60 * 13; i++) w.step(1 / 60); window.__zu.sfx.played = {}; });
await p.evaluate(() => { const g = window.__zu.game; g.settings.view = 'first'; });
const t0 = Date.now();
let shotN = 0;
while (Date.now() - t0 < 20000) {
  await p.evaluate(() => {
    const g = window.__zu.game, me = g.match.player, w = g.match.world;
    const foe = w.actors.filter(x => x.alive && x.team !== me.team).sort((a, b) => Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z) - Math.hypot(b.pos.x - me.pos.x, b.pos.z - me.pos.z))[0];
    if (foe) { const e = me.eye, c = foe.center; g.camYaw = Math.atan2(c.x - e.x, c.z - e.z); g.camPitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z)); }
    g.input.mouse.l = true; g.input.mouse.r = me.def.dualGuns;
  });
  await wait(400);
  if (Date.now() - t0 > 6000 && shotN < 2) { await p.screenshot({ path: `tests/e2e/shots/audio_vfx_${shotN === 0 ? 'fp' : 'tp'}.png` }); shotN++; if (shotN === 1) await p.evaluate(() => { window.__zu.game.settings.view = 'third'; }); }
}
await p.evaluate(() => { const g = window.__zu.game; g.input.mouse.l = false; g.input.mouse.r = false; });
const res = await p.evaluate(() => {
  const s = window.__zu.sfx, played = s.played, bank = s.bank;
  const sampled = Object.keys(played).filter(k => bank.has(k)), synth = Object.keys(played).filter(k => !bank.has(k));
  return { played: Object.fromEntries(Object.entries(played).sort((a, b) => b[1] - a[1]).slice(0, 25)), sampled: sampled.length, synth, threat: s.threat.size, voicesLive: s.voices };
});
console.log(JSON.stringify(res, null, 1));
console.log('errors', errs.length, errs.slice(0, 3).join('\n---\n'));
await b.close(); process.exit(0);
