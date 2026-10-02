// Online matchmaking when the host never shows up: one browser queues, a fake player with a better connection
// (so it becomes the host) queues through the node's API and then goes silent. The browser must leave the dead match
// on its own and be back in the queue - not stuck on the hero-select screen - and must not be slotted back into it.
//   ZU_GATHER_MS=60000 node scripts/net-local.mjs 8788 ; VITE_NET_URL=http://localhost:8788/api/net npx vite --port 5241
//   node tests/e2e/online_watchdog.mjs [baseUrl] [nodeUrl]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const base = process.argv[2] || 'http://localhost:5241/', node = process.argv[3] || 'http://localhost:8788/api/net';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('pageerror', e.stack ?? e.message));
await p.evaluateOnNewDocument(() => { localStorage.setItem('zu-settings-v1', JSON.stringify({ preset: 'low' })); localStorage.setItem('zu-name', 'Solo'); });
await p.goto(`${base}play.html?story=0`, { waitUntil: 'domcontentloaded' });
await sleep(2500);
await p.evaluate(() => window.__zu.menu.online.open());
for (let i = 0; i < 120 && !(await p.evaluate(() => window.__zu.menu.online.session?.online && !!window.__zu.menu.online.session?.speed)); i++) await sleep(250);
await p.click('[data-qp="flex"]');
await sleep(1500);
// the ghost host: best score, queues, then never polls or links again
const ghost = 'ghosthost1';
await fetch(node, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ghost, me: { name: 'Ghost', status: 'queue', platform: 'desktop' }, mm: { op: 'join', q: 'qp', role: 'flex', mmr: 1800, score: 1000 } }) });
let st = null;
for (let i = 0; i < 40 && st?.phase !== 'assemble'; i++) { await sleep(250); st = await p.evaluate(() => { const s = window.__zu.menu.online.session; return { phase: s.phase, role: s.role, host: s.hostId }; }); }
check(st?.phase === 'assemble' && st.role === 'client' && st.host === ghost, `matched with the ghost as host (${JSON.stringify(st)})`);
// the watchdog gives up on a host that never links after 20 s
let back = false;
for (let i = 0; i < 40 && !back; i++) { await sleep(1000); back = await p.evaluate(() => window.__zu.menu.online.session.phase === 'queue'); }
check(back, 'back in the queue after the host never linked');
const notice = await p.evaluate(() => document.querySelector('.onotice')?.textContent ?? '');
check(/host stopped responding/i.test(notice), `told why: "${notice}"`);
await sleep(4000);
const again = await p.evaluate(() => window.__zu.menu.online.session.phase);
check(again === 'queue', `not slotted back into the dead match (phase ${again})`);
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
