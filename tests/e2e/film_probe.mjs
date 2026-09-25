import puppeteer from 'puppeteer-core';
const t = +(process.argv[2] || 176);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 600000, args: ['--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
await p.goto('http://localhost:5190/film.html', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 240; i++) { if (await p.evaluate(() => !document.querySelector('.go')?.disabled)) break; await new Promise(r => setTimeout(r, 500)); }
await p.click('.go');
await p.evaluate(t => window.__film.seek(t), t);
for (const w of [300, 1500]) {
  await new Promise(r => setTimeout(r, w));
  console.log(await p.evaluate(() => { const st = window.__film.stage, u = st.anime.uniforms; return JSON.stringify({ flash: u.flash.value, invert: u.invert.value, exposure: u.exposure.value, set: st.set.id, bloom: st.bloom.strength, fog: st.set.scene.fog && [st.set.scene.fog.near, st.set.scene.fog.far, st.set.scene.fog.color.getHexString()], cam: st.camera.position.toArray().map(x => +x.toFixed(1)) }); }));
}
await b.close();
