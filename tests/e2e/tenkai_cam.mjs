// node tests/e2e/tenkai_cam.mjs [port] - Tenkai-Oh in a first-person match: the Solar Bulwark pulls the camera out to third
// person (Reinhardt's Barrier Field), primary fire held pans it freely while the shield keeps facing, letting go snaps it
// back, dropping the shield returns to first person; plus the hammer swing strip in third person.
import puppeteer from 'puppeteer-core';
const port = process.argv[2] ?? '5199';
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(2); }, 240000);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.stack || e.message));
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = n => p.screenshot({ path: `tests/e2e/shots/tenkai_${n}.png` });
await p.goto(`http://localhost:${port}/play.html`, { waitUntil: 'domcontentloaded', timeout: 180000 }); await wait(1500);
p.evaluate(() => { const M = window.__zu.menu; M.queue = 'practice'; M.mode = 'practice'; M.map = 'hanabi'; M.hero = 'tenkai'; M.launch(); });
for (let i = 0; i < 80 && !(await p.evaluate(() => window.__zu.game?.match?.world?.map.id === 'hanabi' && window.__zu.game.running)); i++) await wait(500);
await wait(2500);
const st = () => p.evaluate(() => { const g = window.__zu.game, me = g.match.player; return { cam: +g.abilityCam.toFixed(2), barrier: me.barrier.up, yaw: +me.yaw.toFixed(2), camYaw: +g.camYaw.toFixed(2), view: g.view, bodyVisible: g.views.get(me.id)?.group.visible, fp: !!g.fp }; });
await shot('1_first_person'); console.log('fp   ', JSON.stringify(await st()));
await p.evaluate(() => { window.__zu.game.input.mouse.r = true; }); await wait(700);
await shot('2_shield_third_person'); console.log('shield', JSON.stringify(await st()));
// free look: hold primary fire, pan the camera 1 rad
await p.evaluate(() => { const g = window.__zu.game; g.input.mouse.l = true; }); await wait(150);
await p.evaluate(() => { const g = window.__zu.game; g.input.yaw += 1.0; }); await wait(500);
await shot('3_free_look'); console.log('free  ', JSON.stringify(await st()));
await p.evaluate(() => { window.__zu.game.input.mouse.l = false; }); await wait(300);
console.log('snap  ', JSON.stringify(await st()));
await p.evaluate(() => { window.__zu.game.input.mouse.r = false; }); await wait(800);
await shot('4_back_first_person'); console.log('drop  ', JSON.stringify(await st()));
console.log('errors', errs.length, errs.slice(0, 2).join('\n'));
await b.close(); process.exit(0);
