// Capture the current game models as pose references for the 2D anime film (transparent PNGs).
//   node tests/e2e/pose_capture.mjs [ids] [out]
// Per character: idle (3/4 + front), a walk and a run cycle, attack / cast / hit keys, jump, fly.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [idsArg = 'haruto,mirei,kaien,raijin,yuzu,vorn,nocturne,hex,kagemaru,enra,qelvaris,tenkai,gorgoth', out = 'cinematic/work/poses'] = process.argv.slice(2);
const FLY = new Set(['mirei', 'nocturne', 'tenkai']);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 600000,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1024,1024'], defaultViewport: { width: 1024, height: 1024, deviceScaleFactor: 2 } });
const p = await b.newPage();
await p.goto('http://localhost:5190/play.html', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => window.__zu.menu.viewer());
await p.addStyleTag({ content: `body, .viewer, .vstage { background: transparent !important; } .vlist, .vside, .vname, .vanims, .vhint { display: none !important; }
  .vstage { position: fixed !important; inset: 0 !important; width: 1024px !important; height: 1024px !important; }` });
await new Promise(r => setTimeout(r, 400));
await p.evaluate(() => { const V = window.__zu.viewer; V.scene.getObjectByName('ring').visible = false; V.scene.traverse(o => { if (o.isMesh && o.material?.isShadowMaterial) o.visible = false; }); });
fs.mkdirSync(out, { recursive: true });
const shot = async name => {
  // render once more and read the WebGL buffer in the same task (keeps the alpha channel: a clean transparent cut-out)
  const url = await p.evaluate(() => { const V = window.__zu.viewer; V.renderer.render(V.scene, V.camera); return V.renderer.domElement.toDataURL('image/png'); });
  fs.writeFileSync(`${out}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
};
const mode = m => p.evaluate(m => { const V = window.__zu.viewer; V.__freeze = undefined; document.querySelector(`[data-a="${m}"]`).click(); }, m);
const freezeAt = (kind, age, cast) => p.evaluate((kind, age, cast) => {
  const V = window.__zu.viewer, a = V.actor;
  if (!V.__orig) { V.__orig = V.frame.bind(V); V.frame = () => { V.__orig(); if (V.__freeze !== undefined) V.t = V.__freeze; }; }
  V.__freeze = V.t;
  if (cast) { a.anim.castAt = V.t - age; a.anim.castId = cast; } else { a.anim.attackKind = kind; a.anim.attackAt = V.t - age; }
}, kind, age, cast);
const wait = ms => new Promise(r => setTimeout(r, ms));
for (const id of idsArg.split(',')) {
  await p.evaluate(id => { const V = window.__zu.viewer; V.select(id); V.auto = false; V.tilt = 0.06; V.zoom = 1; }, id);
  for (let i = 0; i < 60 && !(await p.evaluate(() => window.__zu.viewer.view.real)); i++) await wait(250);
  await wait(1200);
  const yaw = y => p.evaluate(y => { window.__zu.viewer.yaw = y; }, y);
  // idle: 3/4 facing screen-right, and front
  await mode('idle'); await yaw(-0.75); await wait(900); await shot(`${id}_idle`);
  await yaw(0); await wait(700); await shot(`${id}_front`);
  await yaw(-0.75);
  // walk + run cycles (the treadmill keeps the figure centred); frames ~1/12 s apart = anime on 2s
  // cycles: shoot at six evenly spaced gait phases (key drawings of a walk / run cycle)
  for (const m of ['walk', 'run']) {
    await mode(m); await wait(1500);
    for (let k = 0; k < 6; k++) {
      for (let n = 0; n < 400; n++) { const ph = await p.evaluate(() => window.__zu.viewer.view.anim.phase % 1); if (Math.abs(ph - k / 6) < 0.035) break; await wait(4); }
      await shot(`${id}_${m}${k}`);
    }
  }
  // attack: wind-up -> strike -> follow-through
  await mode('idle'); await wait(600);
  for (const [k, age] of [[0, 0.02], [1, 0.12], [2, 0.26], [3, 0.42]]) { await freezeAt('primary', age); await wait(500); await shot(`${id}_attack${k}`); }
  for (const [k, age] of [[0, 0.1], [1, 0.3]]) { await freezeAt(null, age, 'cast'); await wait(500); await shot(`${id}_cast${k}`); }
  await p.evaluate(() => { const V = window.__zu.viewer; V.__freeze = undefined; V.actor.anim.hitAt = V.t; }); await wait(90); await shot(`${id}_hit`);
  await mode('jump'); await wait(450); await shot(`${id}_jump`);
  if (FLY.has(id)) { await mode('fly'); await wait(1400); await shot(`${id}_fly0`); await wait(300); await shot(`${id}_fly1`); }
  await mode('idle');
  console.log(id, 'done');
}
await b.close();
