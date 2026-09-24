// Drive Tenkai-Oh's kit in a real skirmish and screenshot each piece: thrusters, charge, shatter, demech -> pilot, call mech.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--window-size=1600,900', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:5190/play.html?mode=training&map=training&hero=tenkai', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 6000));
const key = (code, down) => p.evaluate((code, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code })), code, down);
const tap = async (code, ms = 120) => { await key(code, true); await new Promise(r => setTimeout(r, ms)); await key(code, false); };
const state = () => p.evaluate(() => { const w = window.__zu.game.match.world, me = w.actors.find(a => a.isPlayer); return { id: me.def.id, y: +me.pos.y.toFixed(2), flying: me.flying, flight: Math.round(me.flight), forced: me.forced?.kind ?? '', hp: Math.round(me.health), ult: Math.round(me.ult), scale: me.scale }; });
const shot = async n => { await p.screenshot({ path: `tests/e2e/shots/kit_${n}.png` }); console.log(n, JSON.stringify(await state())); };
fs.mkdirSync('tests/e2e/shots', { recursive: true });
await shot('0_start');
// thrusters: jump, then hold SPACE
await key('Space', true); await new Promise(r => setTimeout(r, 1800)); await shot('1_jets'); await key('Space', false);
await new Promise(r => setTimeout(r, 2500));
// charge
await tap('ShiftLeft'); await new Promise(r => setTimeout(r, 450)); await shot('2_charge');
await new Promise(r => setTimeout(r, 2500));
// shatter
await tap('KeyE'); await new Promise(r => setTimeout(r, 620)); await shot('3_shatter');
await new Promise(r => setTimeout(r, 1500));
// destroy the frame -> pilot on foot
await p.evaluate(() => { const w = window.__zu.game.match.world, me = w.actors.find(a => a.isPlayer); w.damage(null, me, 99999, { kind: 'ability' }); });
await new Promise(r => setTimeout(r, 2500)); await shot('4_pilot');
// fire the blaster a moment, then call the mech back
await p.evaluate(() => { const w = window.__zu.game.match.world, me = w.actors.find(a => a.isPlayer); me.ult = me.def.ult.charge; });
await tap('KeyQ'); await new Promise(r => setTimeout(r, 1500)); await shot('5_callmech');
console.log('errors', errs.slice(0, 5));
await b.close();
