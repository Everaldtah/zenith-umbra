// Online play end to end, three browsers against a local online node:
//   ZU_GATHER_MS=15000 node scripts/net-local.mjs 8788
//   VITE_NET_URL=http://localhost:8788/api/net npx vite --port 5241        (hmr off for captures)
//   node tests/e2e/online.mjs [baseUrl]
// A and B queue for Online Quick Play -> a match forms at once (B joined second) -> C queues a few seconds later and is
// slotted into the forming match -> everyone picks a hero -> the host starts when the gather window ends: 3 humans +
// 7 AI. Then: the client mirrors the host's world, its input moves its hero on the host over a direct WebRTC link,
// the network readout shows the link, the match end is filed in every player's Career Profile.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const base = process.argv[2] || 'http://localhost:5241/';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
fs.mkdirSync('tests/e2e/shots/online', { recursive: true });
async function open(name) {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
  const p = await b.newPage();
  p.on('pageerror', e => { if (!/Pointer Lock|pointer lock/.test(e.message)) console.log(name, 'pageerror', e.stack ?? e.message); });
  // three copies of the game share one PC here: low graphics keep every simulation at full speed
  await p.evaluateOnNewDocument(() => { localStorage.setItem('zu-settings-v1', JSON.stringify({ preset: 'low', showFps: true })); });
  p.on('dialog', d => { console.log(name, 'dialog', d.message()); d.dismiss(); });
  await p.goto(`${base}play.html?story=0`, { waitUntil: 'domcontentloaded' });
  await p.evaluate(n => { localStorage.setItem('zu-name', n); localStorage.removeItem('zu-profile-v1'); }, name);
  await sleep(2500);
  await p.evaluate(() => window.__zu.menu.online.open());
  return { b, p, name };
}
const sess = P => P.p.evaluate(() => { const s = window.__zu.menu.online.session; return s ? { phase: s.phase, role: s.role, me: s.me, host: s.hostId, seats: s.seats.length, online: s.online, speed: !!s.speed } : null; });
async function until(P, fn, secs, what) {
  for (let i = 0; i < secs * 4; i++) { const v = await P.p.evaluate(fn); if (v) return v; await sleep(250); }
  check(false, `${P.name}: ${what} (timed out)`); return null;
}

const A = await open('Alpha'), B = await open('Bravo');
await until(A, () => window.__zu.menu.online.session?.online && !!window.__zu.menu.online.session?.speed, 30, 'online + connection tested');
await until(B, () => window.__zu.menu.online.session?.online && !!window.__zu.menu.online.session?.speed, 30, 'online + connection tested');
await A.p.screenshot({ path: 'tests/e2e/shots/online/lobby.png' });
await A.p.click('[data-qp="flex"]');
await sleep(1500);
await B.p.click('[data-qp="damage"]');
const okA = await until(A, () => window.__zu.menu.online.session?.phase === 'assemble', 20, 'A in a forming match');
const okB = await until(B, () => window.__zu.menu.online.session?.phase === 'assemble', 20, 'B in a forming match');
check(okA && okB, 'two players queued -> a match formed at once');
// a third player queues during the gather window and is slotted in
const C = await open('Charlie');
await until(C, () => window.__zu.menu.online.session?.online, 30, 'C online');
await C.p.click('[data-qp="support"]');
const okC = await until(C, () => window.__zu.menu.online.session?.phase === 'assemble', 20, 'C joined the forming match');
const sa = await sess(A), sb = await sess(B), sc = await sess(C);
console.log('sessions', JSON.stringify([sa, sb, sc]));
check(okC && sa.host === sb.host && sb.host === sc.host, 'all three share one host');
const all = [A, B, C], H = all.find(x => [sa, sb, sc][all.indexOf(x)].role === 'host'), clients = all.filter(x => x !== H);
// every link to the host comes up
const linked = await until(H, () => { const s = window.__zu.menu.online.session; return s.links.size === 2 && [...s.links.values()].every(l => l.state === 'p2p') ? [...s.links.values()].map(l => l.state + ':' + Math.round(l.stats.rtt)).join(',') : null; }, 20, 'host linked to both');
check(!!linked, `host links up (${linked})`);
for (const P of all) await P.p.evaluate(() => document.querySelector('.opick .hc:not(.taken)')?.click());
await sleep(1500);
await H.p.screenshot({ path: 'tests/e2e/shots/online/assemble_host.png' });
await clients[0].p.screenshot({ path: 'tests/e2e/shots/online/assemble_client.png' });
// the host starts when the gather window ends
for (const P of all) await until(P, () => window.__zu.game.running && !!window.__zu.game.match, 60, 'match running');
await sleep(6000);
const host = await H.p.evaluate(() => { const g = window.__zu.game, w = g.match.world; return { actors: w.actors.length, remote: w.actors.filter(a => a.netId).length, bots: g.match.bots.length, rules: w.rules }; });
console.log('host', JSON.stringify(host));
check(host.actors === 10 && host.remote === 2 && host.bots === 7, '3 humans + 7 AI in the host world');
const c0 = clients[0];
const cl = await c0.p.evaluate(() => { const g = window.__zu.game, w = g.match.world, c = g.clientSync; return { actors: w.actors.length, me: g.match.player?.def.id, hz: c.snapHz, tier: c.tier, interp: Math.round(c.interpMs), path: c.link?.stats.path, rtt: Math.round(c.link?.stats.rtt ?? -1), rules: w.rules }; });
console.log('client', JSON.stringify(cl));
check(cl.actors === 10 && !!cl.me && cl.rules === host.rules, 'client mirrors the host world (10 heroes, own hero, same rules)');
check(cl.hz > 15, `client receives snapshots at ${cl.hz.toFixed?.(0) ?? cl.hz} Hz (${cl.tier}, interp ${cl.interp} ms, ${cl.path}, ${cl.rtt} ms)`);
// drive the client's hero forward; the host sees it move
const myId = await c0.p.evaluate(() => window.__zu.menu.online.session.me);
const p0 = await H.p.evaluate(id => { const a = window.__zu.game.match.world.actors.find(x => x.netId === id); return [a.pos.x, a.pos.z]; }, myId);
await c0.p.evaluate(() => { const g = window.__zu.game; g.input.keys.add('KeyW'); g.input.locked = true; });
await sleep(4000);
const p1 = await H.p.evaluate(id => { const a = window.__zu.game.match.world.actors.find(x => x.netId === id); return [a.pos.x, a.pos.z]; }, myId);
const cpos = await c0.p.evaluate(() => { const m = window.__zu.game.match.player; return [m.pos.x, m.pos.z]; });
const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), drift = Math.hypot(p1[0] - cpos[0], p1[1] - cpos[1]);
check(moved > 3, `client input moves its hero on the host (${moved.toFixed(1)} m)`);
check(drift < 1.5, `client prediction agrees with the host (${drift.toFixed(2)} m apart)`);
const ro = await c0.p.evaluate(() => document.querySelector('.netro')?.textContent ?? '');
check(/ms/.test(ro), `network readout: ${ro}`);
await c0.p.screenshot({ path: 'tests/e2e/shots/online/match_client.png' });
await H.p.screenshot({ path: 'tests/e2e/shots/online/match_host.png' });
// end the match on the host: every player files it in their Career Profile
await H.p.evaluate(() => window.__zu.game.match.world.end('zenith'));
for (const P of all) await until(P, () => !!document.querySelector('.results'), 20, 'results screen');
await sleep(500);
await c0.p.screenshot({ path: 'tests/e2e/shots/online/results_client.png' });
for (const P of all) {
  const rec = await P.p.evaluate(() => { const p = JSON.parse(localStorage.getItem('zu-profile-v1') || 'null'); return p ? { matches: p.matches.length, mode: p.matches.at(-1)?.mode, heroes: Object.keys(p.modes['online-qp'] || {}) } : null; });
  check(rec?.matches === 1 && rec.mode === 'online-qp' && rec.heroes.length === 1, `${P.name}: match filed in the Career Profile (${JSON.stringify(rec)})`);
}
await c0.p.evaluate(() => { document.querySelector('.results .quit')?.click(); });
await sleep(800);
await c0.p.evaluate(() => window.__zu.menu.career());
await sleep(800);
await c0.p.screenshot({ path: 'tests/e2e/shots/online/career_overview.png' });
await c0.p.evaluate(() => document.querySelector('[data-tab="stats"]')?.click());
await sleep(300);
await c0.p.screenshot({ path: 'tests/e2e/shots/online/career_stats.png' });
for (const t of ['ratings', 'progress', 'history']) { await c0.p.evaluate(x => document.querySelector(`[data-tab="${x}"]`)?.click(), t); await sleep(300); await c0.p.screenshot({ path: `tests/e2e/shots/online/career_${t}.png` }); }
for (const P of all) await P.b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
