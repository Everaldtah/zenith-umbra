// node tests/e2e/settings_ui.mjs [port] - the Options screen end to end: every tab renders; a real rebind through input
// capture (Ability 1 -> KeyG, then a mouse button) moves the key off any other action; a per-hero override; sliders and
// selectors apply live (render scale -> pixel ratio, brightness -> canvas filter, master volume -> audio, reticle ->
// HUD canvas); everything survives a reload; RESTORE DEFAULTS puts the tab back. Screenshots of each tab.
import puppeteer from 'puppeteer-core';
const port = process.argv[2] ?? '5199';
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 240000);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.stack || e.message));
const wait = ms => new Promise(r => setTimeout(r, ms));
const fails = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails.push(what); };
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForFunction(() => !!window.__zu?.menu, { timeout: 60000 });
await p.evaluate(() => localStorage.removeItem('zu-settings-v1'));
await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => !!window.__zu?.menu, { timeout: 60000 });
await p.evaluate(() => window.__zu.menu.settings(() => window.__zu.menu.title()));
await wait(400);
const tabs = ['video', 'sound', 'controls', 'gameplay', 'access'];
for (const t of tabs) {
  await p.click(`.opts .tab[data-t="${t}"]`); await wait(250);
  const n = await p.evaluate(() => document.querySelectorAll('.opts .orow').length);
  check(n >= 5, `${t} tab renders ${n} rows`);
  await p.screenshot({ path: `tests/e2e/shots/settings_${t}.png` });
}
// ---- rebinding through the real input capture
await p.click('.opts .tab[data-t="controls"]'); await wait(200);
await p.click('.opts .key[data-a="a1"][data-s="0"]'); await wait(150);
check(await p.evaluate(() => !!document.querySelector('.opts .key.listen')), 'key box listens');
await p.keyboard.press('KeyE');          // E belongs to Ability 2: it must move to Ability 1
await wait(200);
let s = await p.evaluate(() => window.__zu.game.settings.controls.binds);
check(s.a1[0] === 'KeyE' && !s.a2.includes('KeyE'), `E moved to Ability 1 (a1=${s.a1} a2=${s.a2})`);
await p.click('.opts .key[data-a="a2"][data-s="0"]'); await wait(150);
await p.mouse.click(800, 450, { button: 'middle' }); await wait(200);
s = await p.evaluate(() => window.__zu.game.settings.controls.binds);
check(s.a2[0] === 'Mouse1', `middle mouse bound to Ability 2 (a2=${s.a2})`);
// the in-game input reads the new bindings
const held = await p.evaluate(() => { const i = window.__zu.game.input; i.keys.add('KeyE'); const r = i.held('a1') && !i.held('a2'); i.keys.delete('KeyE'); return r; });
check(held, 'Input.held follows the new binding');
// per-hero override: Tomoe's Ability 1 on KeyG, the global stays
await p.select('.opts .hsel', 'tomoe'); await wait(250);
await p.click('.opts .key[data-a="a1"][data-s="0"]'); await wait(150);
await p.keyboard.press('KeyG'); await wait(200);
s = await p.evaluate(() => window.__zu.game.settings.controls);
check(s.heroBinds.tomoe?.a1?.[0] === 'KeyG' && s.binds.a1[0] === 'KeyE', `Tomoe override (tomoe.a1=${s.heroBinds.tomoe?.a1} global=${s.binds.a1})`);
const heroHeld = await p.evaluate(() => { const i = window.__zu.game.input; i.hero = 'tomoe'; i.keys.add('KeyG'); const r = i.held('a1'); i.keys.delete('KeyG'); i.hero = 'raijin'; i.keys.add('KeyG'); const r2 = i.held('a1'); i.keys.delete('KeyG'); return r && !r2; });
check(heroHeld, 'the override only applies to Tomoe');
// reticle designer -> HUD canvas
await p.select('.opts .hsel', ''); await wait(200);
await p.evaluate(() => { const rows = [...document.querySelectorAll('.opts .orow')]; const r = rows.find(x => x.querySelector('span')?.textContent === 'Type'); r.querySelector('.r').click(); });
await wait(200);
check(await p.evaluate(() => window.__zu.game.settings.controls.reticle.type !== 'default' && !!document.querySelector('.hud .cross.custom canvas')), 'custom reticle drawn on the HUD');
// ---- video: render scale and brightness apply live
await p.click('.opts .tab[data-t="video"]'); await wait(200);
const setSlider = (label, v) => p.evaluate((l, v) => { const r = [...document.querySelectorAll('.opts .orow')].find(x => x.querySelector('span')?.textContent === l); const i = r.querySelector('input'); i.value = String(v); i.dispatchEvent(new Event('input')); }, label, v);
const pr0 = await p.evaluate(() => window.__zu.game.renderer.getPixelRatio());
await setSlider('Render Scale', 50); await wait(150);
const pr1 = await p.evaluate(() => window.__zu.game.renderer.getPixelRatio());
check(pr1 < pr0, `render scale 50% lowers the pixel ratio (${pr0} -> ${pr1})`);
await setSlider('Brightness', 1.2); await wait(100);
check((await p.evaluate(() => window.__zu.game.renderer.domElement.style.filter)).includes('brightness(1.2'), 'brightness filter on the canvas');
check(await p.evaluate(() => window.__zu.game.settings.video.quality === 'custom'), 'changing a detail option makes the preset CUSTOM');
// ---- sound
await p.click('.opts .tab[data-t="sound"]'); await wait(200);
await setSlider('Master Volume', 0.25); await wait(100);
check(await p.evaluate(() => Math.abs(window.__zu.sfx.volume - 0.25) < 1e-6), 'master volume -> audio engine');
// ---- accessibility: colour-blind filter
await p.click('.opts .tab[data-t="access"]'); await wait(200);
await p.evaluate(() => { const r = [...document.querySelectorAll('.opts .orow')].find(x => x.querySelector('span')?.textContent === 'Color Blind Options Filter'); r.querySelector('.r').click(); });
await wait(150);
check((await p.evaluate(() => window.__zu.game.renderer.domElement.style.filter)).includes('zu-cb-f'), 'colour-blind filter applied');
// ---- persistence
await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => !!window.__zu?.menu, { timeout: 60000 }); await wait(500);
s = await p.evaluate(() => window.__zu.game.settings);
check(s.controls.binds.a1[0] === 'KeyE' && s.controls.heroBinds.tomoe?.a1?.[0] === 'KeyG' && s.video.renderScale === 50 && Math.abs(s.sound.master - 0.25) < 1e-6 && s.access.colorblind !== 'none', 'settings survive a reload');
// ---- restore defaults (controls tab)
await p.evaluate(() => window.__zu.menu.settings(() => window.__zu.menu.title())); await wait(300);
await p.click('.opts .tab[data-t="controls"]'); await wait(200);
await p.click('.opts .rst'); await wait(200);
s = await p.evaluate(() => window.__zu.game.settings.controls);
check(s.binds.a1[0] === 'ShiftLeft' && s.binds.a2[0] === 'KeyE' && !s.heroBinds.tomoe && s.heroBinds.hibiki?.grind?.[0] === 'Mouse0', 'RESTORE DEFAULTS resets the controls (Hibiki keeps his LMB grind)');
await p.click('.opts .done'); await wait(300);
check(await p.evaluate(() => !document.querySelector('.opts')), 'BACK leaves the options');
await p.evaluate(() => localStorage.removeItem('zu-settings-v1'));
console.log(fails.length ? `FAILED ${fails.length}` : 'SETTINGS OK', 'errors', errs.length, errs.slice(0, 2));
await b.close(); process.exit(fails.length || errs.length ? 1 : 0);
