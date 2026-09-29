// Frame rate over the first seconds of a match in the installed Windows app (loading hitches: model streaming, shader
// compiles, the sound bank decode):  node tests/e2e/desktop_fps.mjs [map] [hero] [secs]
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
const [map = 'kagura', hero = 'gantetsu', secs = '30'] = process.argv.slice(2);
const exe = path.join(process.env.LOCALAPPDATA, 'Programs', 'ZenithUmbra', 'ZenithUmbra.exe');
const proc = spawn(exe, ['--remote-debugging-port=9334'], { detached: false, stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { await (await fetch('http://127.0.0.1:9334/json/version')).json(); break; } catch { await new Promise(r => setTimeout(r, 1000)); } }
await new Promise(r => setTimeout(r, 3000));
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9334', defaultViewport: null });
const [p] = (await b.pages()).filter(x => x.url().includes('play.html'));
await p.evaluate((m, h) => { const z = window.__zu.menu; z.queue = 'practice'; z.mode = 'practice'; z.map = m; z.hero = h; z.launch(); }, map, hero);
const out = [];
let last = await p.evaluate(() => window.__zu.game.framesRendered ?? 0);
for (let s = 1; s <= Number(secs); s++) {
  await new Promise(r => setTimeout(r, 1000));
  const r = await p.evaluate(() => { const g = window.__zu.game, s = window.__zu.sfx, w = g.match?.world;
    // where the time goes right now: each view's update, one world step, one render
    if (!w || !g.running) return { f: g.framesRendered ?? 0, bank: s.bank.ready, dead: 0, views: '-', worst: '-', sim: '-', ren: '-' };
    let worst = '', wt = 0, all = 0;
    for (const v of g.views.values()) { const t0 = performance.now(); v.update(1 / 60, w.time, { team: 'zenith', sees: () => true }); const dt = performance.now() - t0; all += dt; if (dt > wt) { wt = dt; worst = `${v.actor.def.id}${v.actor.alive ? '' : '(dead)'}`; } }
    const t1 = performance.now(); w.step(1 / 120); const sim = performance.now() - t1;
    const t2 = performance.now(); g.renderer.render(g.scene, g.camera); const ren = performance.now() - t2;
    return { f: g.framesRendered ?? 0, run: !!g.running, bank: s.bank.ready, dead: w.actors.filter(a => !a.alive).length, views: all.toFixed(1), worst: `${worst} ${wt.toFixed(1)}`, sim: sim.toFixed(1), ren: ren.toFixed(1), fx: g.fx?.count?.() ?? '' }; });
  out.push(`${s}s fps=${r.f - last} bank=${r.bank} dead=${r.dead} views=${r.views}ms worst=${r.worst} sim=${r.sim} render=${r.ren}`);
  last = r.f;
}
console.log(out.join('\n'));
await b.disconnect();
proc.kill();
