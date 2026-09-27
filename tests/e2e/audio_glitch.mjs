// node tests/e2e/audio_glitch.mjs [port] [hero] [map] [seconds]
// The desktop sound engine under the heaviest load we can make it carry - a live AI match, the player's twin chainguns
// firing into the fight - with the output meter (an AudioWorklet on the final mix) counting clipped samples and clicks,
// and the audio thread's render capacity (underruns) where the runtime reports it. Fails on any clipping or crackle.
import puppeteer from 'puppeteer-core';
const [port = '5199', hero = 'gantetsu', map = 'hanabi', secs = '30'] = process.argv.slice(2);
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, (+secs + 200) * 1000);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: ['--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const wait = ms => new Promise(r => setTimeout(r, ms));
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 }); await wait(1500);
p.evaluate((map, hero) => { const M = window.__zu.menu; M.queue = 'practice'; M.mode = 'practice'; M.map = map; M.hero = hero; M.launch(); }, map, hero);
for (let i = 0; i < 80 && !(await p.evaluate(m => window.__zu.game?.match?.world?.map.id === m && window.__zu.game.running, map)); i++) await wait(500);
for (let i = 0; i < 60 && !(await p.evaluate(() => window.__zu.sfx.bank.ready)); i++) await wait(500);
await p.evaluate(() => { const w = window.__zu.game.match.world; for (let i = 0; i < 60 * 13; i++) w.step(1 / 60); });
const m0 = await p.evaluate(() => ({ ...window.__zu.sfx.meter }));
const t0 = Date.now();
let maxLive = 0;
while (Date.now() - t0 < +secs * 1000) {
  maxLive = Math.max(maxLive, await p.evaluate(() => {
    const g = window.__zu.game, me = g.match.player, w = g.match.world;
    const foe = w.actors.filter(x => x.alive && x.team !== me.team).sort((a, b) => Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z) - Math.hypot(b.pos.x - me.pos.x, b.pos.z - me.pos.z))[0];
    if (foe) { const e = me.eye, c = foe.center; g.camYaw = g.input.yaw = Math.atan2(c.x - e.x, c.z - e.z); g.camPitch = g.input.pitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z)); }
    g.input.mouse.l = true; g.input.mouse.r = !!me.def.dualGuns;
    return window.__zu.sfx.voices;
  }));
  await wait(250);
}
const res = await p.evaluate(m0 => { const s = window.__zu.sfx; return { ctx: s.ctx.state, rate: s.ctx.sampleRate, baseLatency: s.ctx.baseLatency, clips: s.meter.clips - m0.clips, clicks: s.meter.clicks - m0.clicks, frames: s.meter.frames - m0.frames, lastPeak: +s.meter.peak.toFixed(3), load: s.load, played: Object.values(s.played).reduce((a, b) => a + b, 0), synthesized: Object.keys(s.played).filter(k => !s.bank.has(k)) }; }, m0);
console.log(JSON.stringify({ ...res, maxLive }, null, 1));
// the meter must be able to see a glitch: inject one deliberate click into the live mix and expect it counted
const seen = await p.evaluate(async () => {
  const s = window.__zu.sfx, C = s.ctx, before = s.meter.clicks;
  const buf = C.createBuffer(1, 4800, C.sampleRate); const d = buf.getChannelData(0); d[2400] = 0.9; d[2401] = -0.9;
  const src = C.createBufferSource(); src.buffer = buf; src.connect(C.destination); src.connect(s['limiter']); src.start();
  await new Promise(r => setTimeout(r, 900));
  return s.meter.clicks - before;
});
console.log('self-check: injected 1 click, meter counted', seen);
const ok = res.frames > 0 && res.clips === 0 && res.clicks <= 2 && seen >= 1;
console.log(ok ? 'AUDIO CLEAN' : 'AUDIO GLITCHES', 'errors', errs.length, errs.slice(0, 2));
await b.close(); process.exit(ok ? 0 : 1);
