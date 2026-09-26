// Pose-deviation / activity profiles of library clips (for choosing trim windows): node tests/e2e/anim_profile.mjs [names...]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const names = process.argv.slice(2);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11'] });
const p = await b.newPage();
await p.goto('http://localhost:5199/play.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !!window.__zu?.game, { timeout: 60000 });
await p.evaluate(() => window.__zu.game.start({ mode: 'training', map: 'training', hero: 'kaien' }));
await p.waitForFunction(() => !!window.__zu?.anim, { timeout: 90000 });
const out = await p.evaluate(names => {
  const l = window.__zu.anim, THREE = window.__zu.THREE;
  const res = [];
  for (const n of names) {
    const c = l.clips.find(x => x.name === n); if (!c) { res.push(n + ': missing'); continue; }
    const NB = c.q.length / 4 / c.frames, dev = [], act = [0];
    const qa = [0, 0, 0, 0], ang = (o1, o2) => { let d = 0; for (let k = 0; k < 4; k++) d += c.q[o1 + k] * c.q[o2 + k]; return 2 * Math.acos(Math.min(1, Math.abs(d))); };
    for (let f = 0; f < c.frames; f++) { let s = 0, a = 0; for (let i = 0; i < NB; i++) { if (!c.mask[i]) continue; s += ang(f * NB * 4 + i * 4, i * 4); if (f) a += ang(f * NB * 4 + i * 4, (f - 1) * NB * 4 + i * 4); } dev.push(s); if (f) act.push(a); }
    const md = Math.max(...dev), ma = Math.max(...act), step = Math.max(1, Math.round(c.fps / 10));
    const bar = arr => arr.filter((_, i) => i % step === 0).map(v => ' .:-=+*#%@'[Math.min(9, Math.floor(v * 9.99))]).join('');
    res.push(`${n} ${c.duration.toFixed(2)}s  apex@${(dev.indexOf(md) / c.fps).toFixed(2)}s\n  dev |${bar(dev.map(v => v / md))}|\n  act |${bar(act.map(v => v / ma))}|`);
  }
  return res.join('\n');
}, names);
console.log(out);
await b.close();
