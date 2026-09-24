// Two-browser co-op test through the deployed Vercel node: host a squad, join it, launch the campaign,
// and verify the client mirrors the host's world and its own hero is driven by its input.
// node tests/e2e/coop.mjs [baseUrl]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const base = process.argv[2] || 'https://zenith-umbra.vercel.app/';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
async function open(name) {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
  const p = await b.newPage();
  p.on('pageerror', e => { if (!/Pointer Lock/.test(e.message)) console.log(name, 'pageerror', e.message); });
  p.on('dialog', d => { console.log(name, 'dialog', d.message()); d.dismiss(); });
  await p.goto(`${base}play.html?story=0`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  await p.evaluate(() => window.__zu.menu.campaign());
  await p.type('.coop .nm', name);
  await p.click('.coop .con');
  return { b, p };
}
const H = await open('HostPlayer');
const C = await open('JoinPlayer');
await sleep(4000);
check(await H.p.evaluate(() => window.__zu.menu.coop?.lobby.brokers > 0 && window.__zu.menu.coop.transport === 'vercel'), 'host connected to the Vercel node');
check(await C.p.evaluate(() => window.__zu.menu.coop?.lobby.brokers > 0 && window.__zu.menu.coop.transport === 'vercel'), 'joiner connected to the Vercel node');
await H.p.click('.coop .hostb');
// joiner waits for the squad to appear in its list, then joins
let joined = false;
for (let i = 0; i < 30 && !joined; i++) {
  await sleep(1000);
  joined = await C.p.evaluate(() => { const b = document.querySelector('.coop [data-j]'); if (b) { b.click(); return true; } return false; });
}
check(joined, 'squad listed and joined');
let linked = '';
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  linked = await H.p.evaluate(() => { const c = window.__zu.menu.coop; const l = [...c.links.values()][0]; return c.squad.length + ':' + (l?.state ?? 'none'); });
  if (/^2:(p2p|relay)/.test(linked)) break;
}
check(/^2:(p2p|relay)/.test(linked), `host sees 2 squad members and a link (${linked})`);
await H.p.evaluate(() => document.querySelector('.bar .go').click());
await sleep(14000);
const host = await H.p.evaluate(() => { const g = window.__zu.game; const w = g.match.world; return { actors: w.actors.length, remote: w.actors.filter(a => a.netId).map(a => a.def.id + '@' + a.pos.x.toFixed(2) + '@' + a.pos.z.toFixed(2)), t: w.time.toFixed(1) }; });
const client = await C.p.evaluate(() => { const g = window.__zu.game; const w = g.match.world; return { actors: w.actors.length, me: g.match.player?.def.id, t: w.time.toFixed(1), synced: !!g.clientSync }; });
console.log('host', JSON.stringify(host), '\nclient', JSON.stringify(client));
check(host.remote.length === 1, 'host world has the joiner\'s hero');
check(client.synced && client.actors >= 3 && !!client.me, 'client mirrors the host world and knows its own hero');
// drive the joiner forward and confirm the host sees it move
const [, x0s, z0s] = (host.remote[0] ?? 'x@0@0').split('@'); const x0 = +x0s, z0 = +z0s;
await C.p.evaluate(() => { const g = window.__zu.game; g.input.keys.add('KeyW'); g.input.locked = true; });
await sleep(4000);
const [x1, z1] = await H.p.evaluate(() => { const a = window.__zu.game.match.world.actors.find(a => a.netId); return a ? [a.pos.x, a.pos.z] : [0, 0]; });
const moved = Math.hypot(x1 - x0, z1 - z0);
check(moved > 3, `joiner input moves its hero on the host (${moved.toFixed(1)} m)`);
await H.p.screenshot({ path: 'tests/e2e/shots/coop_host.png' });
await C.p.screenshot({ path: 'tests/e2e/shots/coop_client.png' });
await H.b.close(); await C.b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
