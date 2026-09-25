// Animation library in the real game (browser): node tests/e2e/anim.mjs [base url]   (npx vite --port 5199 first)
//  1. no library: the game stays procedural, no errors
//  2. synthetic UAL + Mixamo GLB packs (tests/tools/animpack.test.ts) + a Blender-exported first-person clip set
//     (assetgen/blender/fp_arms.py on Raijin's rig): AI Lab match -> clip share, foot sliding, NaNs, deaths / combos
//  3. first-person arms: Raijin (Blender clips) and Enra / Yuzu / Haruto (procedural personalities), screenshots per action
// Writes tests/e2e/shots/anim/*.png and tests/e2e/anim-report.json; exits 1 on a failed check.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const base = (process.argv[2] ?? 'http://localhost:5199/').replace(/\/?$/, '/');
const CHROME = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/opt/pw-browsers/chromium', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
const OUT = 'tests/e2e/shots/anim';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=960,540'], defaultViewport: { width: 960, height: 540 } });
const report = { checks: [], lab: null, fp: {} };
const check = (name, ok, info = '') => { report.checks.push({ name, ok: !!ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` - ${info}` : ''}`); };

const live = pg => pg.evaluate(() => { const z = window.__zu; z.menu?.close?.(); if (z.game.paused) z.game.setPaused(false); z.menu?.close?.(); });

async function page(query) {
  const p = await b.newPage();
  const errs = [], logs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/favicon|404|WebGL|GPU stall/.test(t)) errs.push(t.slice(0, 240)); if (t.startsWith('[anim]')) logs.push(t); });
  await p.goto(`${base}play.html${query}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => !!window.__zu?.game, { timeout: 60000 });
  return { p, errs, logs };
}

// ---------------------------------------------------------------- 1. no library
{
  const { p, errs } = await page('?animdir=/tests/e2e/fixtures/none/');
  await p.evaluate(() => window.__zu.game.start({ mode: 'training', map: 'training', hero: 'raijin' }));
  await sleep(4000);
  const st = await p.evaluate(() => { const g = window.__zu.game, me = g.match.player; const v = g.views.get(me.id); return { lib: !!window.__zu.anim, layer: !!v.anim.layer, frames: g.framesRendered }; });
  check('no library: procedural animation, game renders', !st.lib && !st.layer && st.frames > 1, JSON.stringify(st));
  // procedural baseline in this same environment (software GL runs at a few fps: the foot-slide limit is relative)
  await p.evaluate(() => window.__zu.game.start({ mode: 'aitest', map: 'kurogane', hero: null }));
  await p.waitForFunction(() => window.__zu.game.running, { timeout: 60000 });
  await p.evaluate(() => { window.__zu.game.timeScale = 2; });
  await sleep(60000);
  report.baseline = await p.evaluate(() => window.__zu.lab());
  console.log('procedural baseline foot slide:', Object.entries(report.baseline.heroes).map(([k, h]) => `${k} ${h.footSlide}`).join(', '));
  check('no library: no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await p.close();
}

// ---------------------------------------------------------------- 2. library in an AI match
const { p, errs, logs } = await page('?animdir=/tests/e2e/fixtures/anim/');
await p.evaluate(() => window.__zu.game.start({ mode: 'training', map: 'training', hero: 'kaien' }));   // loads the library
await p.waitForFunction(() => !!window.__zu?.anim, { timeout: 60000 });
const lib = await p.evaluate(() => { const l = window.__zu.anim; return { gaits: l.gaits.map(g => [g.name, g.clips.length, +g.speed.toFixed(2)]), slots: Object.fromEntries([...l.slots].map(([k, v]) => [k, v.length])), fp: [...l.fp.keys()] }; });
console.log(logs.join('\n'));
check('library loaded from GLB packs', lib.gaits.length === 3 && lib.slots.death >= 3 && lib.slots.melee === 3 && lib.fp.includes('raijin'), JSON.stringify(lib));
report.library = lib;
await p.evaluate(() => { const g = window.__zu.game; g.start({ mode: 'aitest', map: 'kurogane', hero: null }); });
await p.waitForFunction(() => window.__zu.game.running, { timeout: 60000 });
await p.evaluate(() => { window.__zu.game.timeScale = 2; });
for (let i = 0; i < 6; i++) {
  await sleep(10000);
  await live(p);
  await p.screenshot({ path: `${OUT}/lab_${i}.png` });
}
const lab = await p.evaluate(() => window.__zu.lab());
report.lab = lab;
const humans = ['raijin', 'kaien', 'yuzu', 'hex', 'kagemaru', 'enra'];
for (const id of humans) {
  const h = lab.heroes[id];
  if (!h) { check(`${id}: seen in the lab`, false); continue; }
  check(`${id}: clips drive the body`, h.clipShare > 0.4, `clipShare ${h.clipShare}, actions ${h.clipActions.join(',')}`);
  const base = report.baseline?.heroes?.[id]?.footSlide ?? 0.1;
  // software GL renders a few fps: with only a handful of planted-foot samples the number is noise (tests/unit/animsim
  // measures the same thing at 60 fps over thousands of samples)
  const n = h.footSlideSamples ?? 0;
  if (n < 30) console.log(`info ${id}: foot slide ${h.footSlide} from only ${n} samples at this frame rate - not judged`);
  else check(`${id}: planted feet don't slide`, h.footSlide < Math.max(0.25, base * 1.5), `footSlide ${h.footSlide} over ${n} samples (max ${h.footSlideMax}), procedural ${base}`);
  check(`${id}: no NaN bones`, h.nan === 0);
}
const actions = new Set(Object.values(lab.heroes).flatMap(h => h.clipActions));
check('clip one-shots played in the match (deaths / combos / hits / jumps)', ['death', 'hit'].every(a => actions.has(a)) && actions.size >= 4, [...actions].join(','));
check('match: no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

// ---------------------------------------------------------------- 3. first-person arms
async function fp(hero, acts) {
  await p.evaluate(h => window.__zu.game.start({ mode: 'training', map: 'training', hero: h }), hero);
  await p.waitForFunction(() => window.__zu.game.running && window.__zu.game.match?.player, { timeout: 60000 });
  await p.evaluate(() => { const g = window.__zu.game; g.timeScale = 1; g.settings.view = 'first'; });
  await live(p);
  await sleep(3500);   // hero GLB + first-person rig load
  const out = {};
  for (const act of acts) {
    await live(p);
    const src = await p.evaluate(async act => {
      const g = window.__zu.game, me = g.match.player, w = g.match.world, t = () => w.time;
      if (act === 'fire') { me.anim.attackAt = t(); me.anim.attackKind = 'primary'; }
      if (act === 'alt') { me.anim.attackAt = t(); me.anim.attackKind = 'secondary'; }
      if (act === 'melee') { me.anim.attackAt = t(); me.anim.attackKind = 'punch'; }
      if (act === 'ability') { me.anim.castAt = t(); me.anim.castId = me.def.ability1.id; }
      if (act === 'ult') { me.anim.castAt = t(); me.anim.castId = me.def.ult.id; }
      if (act === 'reload') me.reloadUntil = t() + 1.4;
      if (act === 'draw') { me.charging = true; me.charge = 1; }
      if (act === 'draw') {
        // hold the draw: the sim clears it every step, so pin it just before the viewmodel reads it
        const fpv = g.fp, orig = fpv.update.bind(fpv);
        fpv.update = i => { me.charging = true; me.charge = 1; orig(i); };
        fpv.__restore = () => { fpv.update = orig; };
      }
      // sample after the next rendered frames (software GL runs at a few fps: wall-clock waits are unreliable)
      const f0 = g.framesRendered;
      while (g.framesRendered < f0 + (act === 'idle' ? 3 : 2)) await new Promise(r => setTimeout(r, 25));
      const fp = g.fp;
      fp?.__restore?.();
      return fp ? { source: fp.source, real: fp.view.real, visible: !!fp.view.group.visible } : null;
    }, act);
    await p.screenshot({ path: `${OUT}/fp_${hero}_${act}.png` });
    await p.evaluate(() => { const me = window.__zu.game.match.player; me.charging = false; me.charge = 0; });
    out[act] = src;
    await sleep(500);
  }
  report.fp[hero] = out;
  return out;
}
const r = await fp('raijin', ['idle', 'fire', 'alt', 'melee', 'ability', 'ult', 'reload']);
check('first person: Raijin plays his Blender-authored clips', r.idle?.source === 'clip:fp_idle' && r.fire?.source === 'clip:fp_fire' && r.melee?.source === 'clip:fp_melee' && r.ult?.source === 'clip:fp_ult', JSON.stringify(r));
const e = await fp('enra', ['idle', 'fire', 'alt', 'melee', 'ability']);
check('first person: Enra falls back to her procedural personality', e.idle?.source?.startsWith('proc:') && e.alt?.source === 'proc:punch' && e.melee?.source === 'proc:melee', JSON.stringify(e));
const y = await fp('yuzu', ['idle', 'draw', 'fire']);
check('first person: Yuzu draws the bow', y.draw?.source === 'proc:draw', JSON.stringify(y));
const k = await fp('kagemaru', ['idle', 'fire', 'alt']);
check('first person: Kagemaru throws kunai and slashes', k.fire?.source === 'proc:throw' && k.alt?.source === 'proc:slash', JSON.stringify(k));
check('first person: no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

fs.writeFileSync('tests/e2e/anim-report.json', JSON.stringify(report, null, 2));
await b.close();
const failed = report.checks.filter(c => !c.ok);
console.log(`\n${report.checks.length - failed.length}/${report.checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
