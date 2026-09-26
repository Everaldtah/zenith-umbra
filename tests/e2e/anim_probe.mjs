// Real clip library probe (real GPU): node tests/e2e/anim_probe.mjs [url]
// Prints the loaded library (gaits measured from the feet, slots), then per clip: duration, loop, speed, travel dir.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const url = process.argv[2] ?? 'http://localhost:5199/play.html';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = [], logs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning') errs.push(t.slice(0, 240)); if (t.startsWith('[anim]')) logs.push(t); });
await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !!window.__zu?.game, { timeout: 60000 });
await p.evaluate(() => window.__zu.game.start({ mode: 'training', map: 'training', hero: 'kaien' }));
await p.waitForFunction(() => !!window.__zu?.anim, { timeout: 90000 });
const lib = await p.evaluate(() => {
  const l = window.__zu.anim;
  const deg = c => Math.round(Math.atan2(c.travel[0], c.travel[1]) * 180 / Math.PI);
  return {
    gaits: l.gaits.map(g => ({ name: g.name, speed: +g.speed.toFixed(2), clips: g.clips.map(c => `${c.name}@${deg(c)}deg ${c.speed.toFixed(2)}`) })),
    slots: Object.fromEntries([...l.slots].map(([k, v]) => [k, v.map(c => `${c.name} ${c.duration.toFixed(2)}s${c.loop ? ' loop' : ''}`)])),
    casts: Object.fromEntries([...l.casts].map(([k, v]) => [k, `${v.clip.name} ${v.clip.duration.toFixed(2)}s -> ${v.target ?? '-'}s`])),
    heroes: Object.fromEntries([...l.heroSlots].map(([h, m]) => [h, Object.fromEntries([...m].map(([k, v]) => [k, v.map(c => `${c.name} ${c.duration.toFixed(2)}s`)]))])),
    all: l.clips.map(c => `${c.name}: ${c.duration.toFixed(2)}s loop=${c.loop} speed=${c.speed.toFixed(2)} dir=${deg(c)}`),
  };
});
console.log(logs.join('\n'));
console.log(JSON.stringify({ gaits: lib.gaits.map(g => `${g.name} ${g.speed}: ${g.clips.join(', ')}`), slots: Object.fromEntries(Object.entries(lib.slots).map(([k, v]) => [k, v.join(', ')])), casts: lib.casts, heroes: lib.heroes }, null, 1));
if (process.argv.includes('--all')) console.log(lib.all.join('\n'));
console.log('errors', errs.slice(0, 8));
await b.close();
