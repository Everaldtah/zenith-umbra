// Tenkai-Oh's first-person hammer, scrubbed: the sim paused, the swing clock pinned to exact times, one frame per time.
//   node tests/e2e/fp_hammer.mjs [port] [what=rl,lr,recover,shatter,jab]   -> tests/e2e/shots/fp/hammer_<what>.jpg
// rl / lr: the right-to-left and left-to-right swings; recover: no follow-up swing (the hammer comes back from the left)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [port = '5199', whatArg = 'rl,lr,recover,shatter,jab'] = process.argv.slice(2);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 240000);
const p = await b.newPage();
const errs = []; p.on('pageerror', e => { if (!/Pointer Lock/.test(e.message)) errs.push(e.message); });
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.waitForFunction(() => !!window.__zu?.game, { timeout: 60000 });
await p.evaluate(() => window.__zu.game.start({ mode: 'training', map: 'training', hero: 'tenkai' }));
await p.waitForFunction(() => window.__zu.game.running && window.__zu.game.match?.player, { timeout: 90000 });
await p.evaluate(() => {
  const z = window.__zu, g = z.game; g.settings.view = 'first'; z.menu?.close?.(); if (g.paused) g.setPaused(false);
  const s = document.createElement('style'); s.textContent = '.hud > *:not(.cross){visibility:hidden !important}'; document.head.append(s);
});
await p.waitForFunction(() => { const g = window.__zu.game; if (g.paused) g.setPaused(false); return !!g.fp; }, { timeout: 60000 });
await new Promise(r => setTimeout(r, 2500));
const TIMES = {
  rl: [0, 0.07, 0.13, 0.17, 0.2, 0.225, 0.245, 0.265, 0.29, 0.33, 0.4, 0.7],
  lr: [0, 0.07, 0.13, 0.17, 0.2, 0.225, 0.245, 0.265, 0.29, 0.33, 0.42, 0.75],
  recover: [0.96, 1.02, 1.08, 1.12, 1.16, 1.2, 1.25, 1.34],
  shatter: [0, 0.15, 0.3, 0.4, 0.45, 0.5, 0.55, 0.65, 0.8, 1.1],
  jab: [0, 0.03, 0.06, 0.1, 0.14, 0.25, 0.35, 0.45],
};
fs.mkdirSync('tests/e2e/shots/strip', { recursive: true });
for (const what of whatArg.split(',')) {
  const shots = [];
  for (const [i, T] of TIMES[what].entries()) {
    await p.evaluate((what, T) => {
      const g = window.__zu.game, w = g.match.world, me = g.match.player, fp = g.fp, t = w.time;
      g.paused = true; me.vel.x = me.vel.z = 0; me.pitch = 0;
      if (what === 'shatter') { me.anim.castAt = t - T; me.anim.castId = 'shatter'; me.anim.attackAt = t - 9; }
      else if (what === 'jab') { me.anim.attackAt = t - T; me.anim.attackKind = 'punch'; }
      else { me.anim.attackAt = t - T; me.anim.attackKind = 'primary'; me.anim.castAt = t - 9; fp.hSwing = { at: t - T, dir: what === 'lr' ? -1 : 1 }; }
    }, what, T);
    await new Promise(r => setTimeout(r, 150));
    const f = `tests/e2e/shots/strip/${what}_${i}.png`;
    await p.screenshot({ path: f }); shots.push(f);
  }
  const out = `tests/e2e/shots/fp/hammer_${what}.jpg`;
  execFileSync('python', ['-c', `
import sys
from PIL import Image, ImageDraw
fs=sys.argv[2:]; ts=sys.argv[1].split(','); w,h=400,225; cols=4
o=Image.new('RGB',(cols*w,((len(fs)+cols-1)//cols)*h))
for k,f in enumerate(fs):
    im=Image.open(f).convert('RGB').resize((w,h)); o.paste(im,((k%cols)*w,(k//cols)*h)); ImageDraw.Draw(o).text(((k%cols)*w+6,(k//cols)*h+6),ts[k]+'s',fill='yellow')
o.save('${out}',quality=85)`, TIMES[what].join(','), ...shots]);
  console.log(out);
}
await p.evaluate(() => { window.__zu.game.paused = false; });
console.log('errors', JSON.stringify(errs.slice(0, 5)));
await Promise.race([b.close(), new Promise(r => setTimeout(r, 4000))]);
process.exit(0);
