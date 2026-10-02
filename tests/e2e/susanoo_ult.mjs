// [ELECTRON_UA=1] node tests/e2e/susanoo_ult.mjs [port] - Raijin's Storm Sovereign in a real match (desktop edition): the giant must
// raise both arms to the sky through the thunder half, then turn on the foes in its perimeter and cut them down.
// Samples the giant every 250 ms: its phase, hands above the head (the skyward pose), its yaw, attacks swung, and the
// foes' hp. Fails (exit 1) when the pose never shows in the thunder half or the giant never swings in the blade half.
// [VIEW=first] -> tests/e2e/shots/susanoo_<n>.png
import puppeteer from 'puppeteer-core';
const [port = '5199'] = process.argv.slice(2);
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 240000);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
// ELECTRON_UA=1: an installed build's extracted bundle served statically runs as the desktop edition
if (process.env.ELECTRON_UA) await p.setUserAgent((await b.userAgent()) + ' Electron/33.0.0');
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' || /model load failed/i.test(m.text())) errs.push(m.text()); });
const wait = ms => new Promise(r => setTimeout(r, ms));
await p.goto(`http://localhost:${port}/play.html${process.env.ELECTRON_UA ? '?platform=desktop' : ''}`, { waitUntil: 'domcontentloaded', timeout: 180000 }); await wait(1500);
await p.evaluate(v => { window.__view = v; }, process.env.VIEW || 'third');   // VIEW=first: the camera Quick Play / Competitive use
await p.evaluate(() => window.__zu.game.start({ mode: 'training', map: 'training', hero: 'raijin' }));
for (let i = 0; i < 60 && !(await p.evaluate(() => window.__zu.game.running && window.__zu.game.match?.player)); i++) await wait(500);
await p.evaluate(() => {
  const g = window.__zu.game, w = g.match.world, me = g.match.player; g.settings.view = window.__view; window.__zu.menu?.close?.();
  me.hp = me.maxHp = 1e6; me.pos = { x: -31, y: 0, z: 13 }; g.input.yaw = 0; me.yaw = 0; g.input.pitch = 0.15;
  // three foes inside the 12 m perimeter, out of blade reach at first (the giant has to turn and walk to them)
  w.actors.filter(a => a.team !== me.team && !a.isSummon).slice(0, 3).forEach((f, i) => { f.pos = { x: -31 + (i - 1) * 6, y: 0, z: 13 + 7 + i }; f.hp = f.maxHp = 1e5; });
});
await wait(2500);
await p.evaluate(() => { const g = window.__zu.game, me = g.match.player; me.ult = me.def.ult.charge; g.input.keys.add('KeyQ'); });
await wait(120);
await p.evaluate(() => { window.__zu.game.input.keys.delete('KeyQ'); });
const rows = []; let shot = 0;
for (let k = 0; k < 44; k++) {
  await wait(250);
  rows.push(await p.evaluate(() => {
    const g = window.__zu.game, w = g.match.world, me = g.match.player;
    const s = w.actors.find(x => x.isSummon && x.def.id === 'susanoo' && x.alive);
    if (!s) return { t: +w.time.toFixed(2), gone: true };
    const v = g.views.get(s.id), B = v?.anim?.bones ?? {};
    const y = n => { const o = B[n]; if (!o) return null; const q = new o.position.constructor(); o.getWorldPosition(q); return q.y; };
    const head = y('head'), hl = y('hand_L'), hr = y('hand_R');
    const foes = w.actors.filter(a => a.team !== me.team && !a.isSummon);
    return {
      t: +(w.time - s.sv.risenAt).toFixed(2), phase: s.sv.phase, real: !!v?.real, ok: !!v?.anim?.ok, clips: !!v?.anim?.layer,
      upL: head != null && hl != null ? +(hl - head).toFixed(2) : null, upR: head != null && hr != null ? +(hr - head).toFixed(2) : null,
      yaw: +s.yaw.toFixed(2), atk: +(w.time - s.anim.attackAt).toFixed(2), x: +s.pos.x.toFixed(1), z: +s.pos.z.toFixed(1),
      hp: foes.slice(0, 3).map(f => Math.round(f.maxHp - f.hp)),
    };
  }));
  if ([4, 12, 24, 32].includes(k)) await p.screenshot({ path: `tests/e2e/shots/susanoo_${++shot}.png` });
}
for (const r of rows) console.log(JSON.stringify(r));
const thunder = rows.filter(r => !r.gone && r.t > 0.8 && r.t < 4.8), blade = rows.filter(r => !r.gone && r.t > 5.4 && r.t < 9.8);
const posed = thunder.filter(r => r.upL != null && r.upL > 0).length, swings = new Set(blade.filter(r => r.atk < 0.26).map(r => Math.round(r.t - r.atk))).size;
const raised = thunder.filter(r => r.upR > 0).length, hurled = thunder.filter(r => r.upR != null && r.upR < -0.5).length;
const pass = thunder.length > 0 && posed >= thunder.length * 0.8 && raised >= 2 && hurled >= 2 && swings >= 3;
console.log(`thunder: free hand up ${posed}/${thunder.length}, sword raised ${raised} / hurled ${hurled}; blade swings ${swings}`, pass ? 'PASS' : 'FAIL', 'errors', errs.slice(0, 4));
await b.close(); process.exit(pass ? 0 : 1);
