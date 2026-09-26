// node tests/e2e/lite_check.mjs [port] [query] - the web edition: original arenas + legacy rules, procedural animation only
// (no clip-library / first-person GLB downloads), no desktop-only heroes or maps, no page errors
import puppeteer from 'puppeteer-core';
const port = process.argv[2] ?? '5199';
// dev server: ?edition=lite. Production preview (npm run build && npx vite preview --port 4173): try ?platform=desktop -
// the website must stay lite whatever the URL says
const query = process.argv[3] ?? '?edition=lite';
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 240000);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = [], glbs = [];
p.on('pageerror', e => errs.push(e.stack || e.message));
p.on('request', r => { const u = r.url(); if (/\.glb/.test(u)) glbs.push(u.replace(/^.*\/(public\/)?/, '')); });
const wait = ms => new Promise(r => setTimeout(r, ms));
await p.goto(`http://localhost:${port}/play.html${query}`, { waitUntil: 'domcontentloaded' }); await wait(2000);
const menu = await p.evaluate(() => [...document.querySelectorAll('.title button, .title a')].map(e => e.textContent.trim().replace(/\s+/g, ' ')));
p.evaluate(() => { const M = window.__zu.menu; M.queue = null; M.mode = 'skirmish'; M.map = 'amatsu'; M.hero = 'mirei'; M.launch(); });
for (let i = 0; i < 60 && !(await p.evaluate(() => window.__zu.game?.match?.world?.map.id === 'amatsu' && window.__zu.game.running)); i++) await wait(500);
await p.evaluate(() => { const w = window.__zu.game.match.world; for (let i = 0; i < 60 * 20; i++) w.step(1 / 60); });
await wait(2500);
await p.screenshot({ path: 'tests/e2e/shots/lite_play.png' });
const info = await p.evaluate(() => { const w = window.__zu.game.match.world; return { rules: w.rules, packs: w.packs.length, heroes: w.actors.filter(a => !a.isRobot).map(a => a.def.id), boxes: w.map.boxes.length }; });
console.log(JSON.stringify({ menu, info, glbs: [...new Set(glbs)], errors: errs.slice(0, 3) }, null, 1));
await b.close(); process.exit(0);
