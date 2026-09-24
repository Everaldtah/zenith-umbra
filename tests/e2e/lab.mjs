// Runs the AI Test Lab headless (GPU) for N seconds per map and prints the JSON report.
// node tests/e2e/lab.mjs <baseUrl> <secondsPerMap> [maps=hangar,amatsu,...] [timeScale]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [base = 'http://localhost:5190/', secs = '60', mapsArg = '', ts = '2'] = process.argv.slice(2);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(p => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 900000,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => { if (!/Pointer Lock/.test(e.message)) errs.push(e.message); });
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
const maps = mapsArg ? mapsArg.split(',') : ['hangar', 'amatsu', 'kurogane', 'cathedral', 'rift'];
await page.goto(`${base}play.html?mode=aitest&map=${maps[0]}`, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 4000));
for (let i = 0; i < maps.length; i++) {
  await page.evaluate((m, t) => { const g = window.__zu.game; g.timeScale = +t; if (g.match.world.map.id !== m) { g.labMapIdx = ['hangar', 'amatsu', 'kurogane', 'cathedral', 'rift'].indexOf(m) - 1; g.nextLabMap(); } }, maps[i], ts);
  await new Promise(r => setTimeout(r, +secs * 1000));
  await page.screenshot({ path: `tests/e2e/shots/lab_${maps[i]}.png` });
  await page.evaluate(() => { const g = window.__zu.game; const w = g.match.world; if (!w.winner) { g.lab.endMap(w, g.match.bots); } });
}
const rep = await page.evaluate(() => window.__zu.lab());
fs.writeFileSync('tests/lab-report.json', JSON.stringify(rep, null, 1));
console.log(JSON.stringify({ pass: rep.pass, fails: rep.fails, abilities: rep.abilities, counters: { seen: rep.counters.seen, of: rep.counters.of }, perf: rep.perf, sounds: { ids: rep.sounds.ids, unknown: rep.sounds.unknown }, fxKinds: rep.effects.kinds, maps: rep.maps }, null, 1));
for (const [id, h] of Object.entries(rep.heroes)) console.log(id.padEnd(9), h.rig.padEnd(9), 'slide', h.footSlide, 'max', h.footSlideMax, 'pen', h.penetrationFrames, 'sink', h.sinkFrames, 'over', h.overspeed, 'missing', h.missing.join(','));
console.log('errors:', errs.slice(0, 8));
await browser.close();
