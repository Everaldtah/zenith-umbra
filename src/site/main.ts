// Marketing site: film teaser + heroes + rivalries + maps + campaign + download.
import './site.css';
import { HEROES, HERO, type HeroDef } from '../data/heroes';
import { PLAY_MAPS } from '../data/maps';
import { FILM_CHAPTERS } from './film';
import { sfx } from '../audio/Sfx';

const B = import.meta.env.BASE_URL;
const REPO = 'https://github.com/Everaldtah/zenith-umbra';
const INSTALLER = `${REPO}/releases/latest/download/ZenithUmbra-Setup.exe`;
const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && !matchMedia('(pointer:fine)').matches);

const zen = HEROES.filter(h => h.team === 'zenith'), umb = HEROES.filter(h => h.team === 'umbra');

function heroCard(h: HeroDef) {
  return `<button class="hcard ${h.team}" data-h="${h.id}" style="--c:${h.color}"><img loading="lazy" src="${B}img/key_${h.id}.webp" alt="${h.name}"><span><b>${h.name}</b><small>${h.title} · ${h.role}</small></span></button>`;
}

document.getElementById('site')!.innerHTML = `
<header class="nav"><a class="brand" href="#top"><b>ZENITH</b><i>//</i><em>UMBRA</em></a>
  <nav><a href="#film">Watch</a><a href="#heroes">Heroes</a><a href="#rivals">Rivals</a><a href="#maps">Maps</a><a href="#campaign">Campaign</a><a href="#download" class="cta">Download</a></nav></header>
<section id="top" class="teaser">
  <video class="tv" autoplay muted loop playsinline preload="auto" poster="${B}film/eclipse_poster.webp"><source src="${B}film/eclipse_teaser.mp4" type="video/mp4"></video>
  <div class="tcap"><small>A ZENITH//UMBRA ANIME FILM</small><h2>THE SUN THAT REFUSED TO SET</h2><p>Ten heroes and villains. One black sun. A robot the size of a city.</p><a class="btn primary" href="#film">&#9654; WATCH THE FILM</a></div>
</section>
<section class="pitch">
  <h1><b>ZENITH</b><i>//</i><em>UMBRA</em></h1>
  <p>An original anime hero shooter. Five heroes of the Zenith Vanguard against five villains of the Umbra Syndicate - every one of them with a rival on the other side and an ability built to counter them.</p>
  <div class="btnrow">${mobile ? '<p class="warn">ZENITH//UMBRA is a PC game - visit on a computer with a keyboard and mouse to play.</p>' : `<a class="btn primary" href="#download">DOWNLOAD FOR WINDOWS</a><a class="btn" href="${B}play.html">PLAY IN BROWSER (PC)</a>`}</div>
  <ul class="feat"><li><b>10</b>original heroes</li><li><b>5</b>story maps + training grounds</li><li><b>1</b>giant mecha tank per side, piloted</li><li><b>2</b>flying healers</li><li><b>5v5</b>vs AI, AI test lab, spectator</li><li><b>Co-op</b>online third-person campaign (up to 4)</li><li><b>50</b>skins in the 3D Hero Viewer</li><li><b>120 Hz</b>physics in the Windows app</li></ul>
</section>
<section id="film" class="film"><h2>THE SUN THAT REFUSED TO SET</h2>
  <p class="lead">A ten-minute anime film in the spirit of late-90s mecha cinema and hot-blooded super-robot shows: the Eclipse that broke the world, how every hero and villain got their scars, and the dawn that Tenkai-Oh drags back into the sky. Painted keyframes brought to life with Grok Imagine, Kling 3 and Gemini Omni, voiced and scored for the film.</p>
  <div class="player"><video controls preload="metadata" playsinline poster="${B}film/eclipse_poster.webp">
    <source src="${B}film/eclipse.mp4" type="video/mp4">
    <track kind="subtitles" srclang="en" label="English" src="${B}film/eclipse.vtt" default></video></div>
  <div class="chapters">${FILM_CHAPTERS.map(([t, n]) => `<button data-t="${t}"><b>${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}</b>${n}</button>`).join('')}</div>
</section>
<section id="heroes"><h2>THE ROSTER</h2>
  <h3 class="zenith">ZENITH VANGUARD <small>heroes</small></h3><div class="hgrid">${zen.map(heroCard).join('')}</div>
  <h3 class="umbra">UMBRA SYNDICATE <small>villains</small></h3><div class="hgrid">${umb.map(heroCard).join('')}</div>
  <div class="hmodal" hidden></div>
</section>
<section id="rivals"><h2>RIVALS &amp; COUNTERS</h2><p class="lead">Each hero has a rival on the other team. Both of them carry the tool to beat the other.</p>
  <div class="rgrid">${zen.map(h => { const r = HERO[h.rival]; const hc = [h.ability1, h.ability2, h.secondary].find((x: any) => x?.counter) as any; const rc = [r.ability1, r.ability2, r.secondary].find((x: any) => x?.counter) as any;
    return `<div class="rival"><div class="side z" style="--c:${h.color}"><img loading="lazy" src="${B}img/portrait_${h.id}.webp"><b>${h.name}</b><p><em>${hc?.name ?? h.passive.name}</em> ${hc?.counter ?? h.passive.desc}</p></div><div class="vs">VS</div><div class="side u" style="--c:${r.color}"><img loading="lazy" src="${B}img/portrait_${r.id}.webp"><b>${r.name}</b><p><em>${rc?.name ?? r.passive.name}</em> ${rc?.counter ?? r.passive.desc}</p></div></div>`; }).join('')}</div>
</section>
<section id="maps"><h2>THE BATTLEGROUNDS</h2><div class="mgrid">${PLAY_MAPS.map(m => `<figure><img loading="lazy" src="${B}img/map_${m.id}.webp" alt="${m.name}"><figcaption><b>${m.name}</b><span>${m.story}</span></figcaption></figure>`).join('')}
  <figure><img loading="lazy" src="${B}img/map_training.webp" alt="Training"><figcaption><b>Zenith Academy Proving Grounds</b><span>Training dummies, live-fire sentry walkers and aerial drones. Swap heroes any time.</span></figcaption></figure></div></section>
<section id="campaign" class="campaign"><div class="cbg" style="background-image:url(${B}img/cine_02.webp)"></div><div class="cin">
  <h2>CAMPAIGN · OPERATION STARFALL</h2>
  <p>The Umbra Syndicate's alien scientist, <b>Archon Qel'Varis, the Star-Forger</b>, is building colossal space robots in orbit. Take the Vanguard off-world in a third-person campaign - five levels, five giant bosses, and the Star-Forger himself waiting at the end. Solo or online co-op.</p>
  <div class="bosses">${['ironmaw', 'reaper', 'leviathan', 'phoenix', 'genesis'].map(b => `<img loading="lazy" src="${B}img/key_boss_${b}.webp" onerror="this.remove()">`).join('')}</div></div></section>
<section id="download" class="download"><h2>PLAY ON PC</h2>
  <div class="dl"><div><h3>Windows desktop app</h3><p>GPU-accelerated build with Ultra graphics, higher-resolution textures and uncapped frame rate. Windows 10/11, 64-bit, any DirectX 11 GPU (tested on an RTX 3050).</p>
    ${mobile ? '<p class="warn">Downloads are for PC only.</p>' : `<a class="btn primary" href="${INSTALLER}">⬇ DOWNLOAD ZenithUmbra-Setup.exe</a>`}<small>Unsigned indie build: if Windows SmartScreen appears, choose "More info → Run anyway".</small></div>
  <div><h3>Online co-op</h3><p>Host a squad from the campaign menu and friends running the Windows app (or the web version) see it in the lobby and join. The game's own online node on Vercel finds players and connects everyone peer-to-peer, relaying through the node when a direct link isn't possible.</p></div>
  <div><h3>Play in the browser</h3><p>The web build auto-tunes graphics for your GPU. Chrome or Edge on a PC with a keyboard and mouse.</p>${mobile ? '' : `<a class="btn" href="${B}play.html">LAUNCH WEB VERSION</a>`}</div></div>
  <p class="src">Source code: <a href="${REPO}">${REPO.replace('https://', '')}</a></p></section>
<footer>ZENITH//UMBRA · an original game · characters, art and audio generated for this project</footer>`;

// ---------------- hero modal
const modal = document.querySelector('.hmodal') as HTMLElement;
document.querySelectorAll<HTMLElement>('.hcard').forEach(c => c.onclick = () => {
  const h = HERO[c.dataset.h!];
  const S: any = h.secondary;
  modal.innerHTML = `<div class="mc" style="--c:${h.color}"><button class="x">✕</button><img src="${B}img/key_${h.id}.webp"><div><h3>${h.name}<small>${h.title}</small></h3>
    ${h.pilot ? `<p class="pilot">Piloted by <b>${h.pilot.name}</b> - ${h.pilot.bio}</p>` : ''}<p>${h.lore}</p>
    <ul>${[['RMB', S.name ?? (S.heal ? 'Healing' : 'Alt fire'), S.desc ?? ''], ['SHIFT', h.ability1.name, h.ability1.desc], ['E', h.ability2.name, h.ability2.desc], ['Q', h.ult.name, h.ult.desc], ['—', h.passive.name, h.passive.desc]].map(([k, n, d]) => `<li><kbd>${k}</kbd><b>${n}</b> ${d}</li>`).join('')}</ul>
    <p class="insp">Inspired by: ${h.inspiration}</p></div></div>`;
  modal.hidden = false;
  (modal.querySelector('.x') as HTMLElement).onclick = () => { modal.hidden = true; };
});
modal.onclick = e => { if (e.target === modal) modal.hidden = true; };

// ---- the film: chapter buttons seek; playing it silences the site's music
const film = document.querySelector('#film video') as HTMLVideoElement;
document.querySelectorAll<HTMLButtonElement>('#film .chapters button').forEach(b => b.onclick = () => { film.currentTime = +b.dataset.t!; film.play(); });
film.addEventListener('play', () => { sfx.music(null); });
film.addEventListener('timeupdate', () => {
  let cur = 0;
  FILM_CHAPTERS.forEach(([t], i) => { if (film.currentTime >= t) cur = i; });
  document.querySelectorAll('#film .chapters button').forEach((b, i) => b.classList.toggle('on', i === cur && !film.paused));
});

// the film premieres once its render is uploaded; until then the player shows a notice
fetch(`${B}film/eclipse.mp4`, { method: 'HEAD' }).then(r => { if (!r.ok || !(r.headers.get('content-type') ?? '').includes('video')) throw 0; }).catch(() => {
  const pl = document.querySelector('#film .player') as HTMLElement, ch = document.querySelector('#film .chapters') as HTMLElement;
  pl.innerHTML = `<img src="${B}film/eclipse_poster.webp" alt=""><div class="soon"><b>THE SUN THAT REFUSED TO SET</b><span>Rendering now - premieres here shortly.</span></div>`;
  ch.style.display = 'none';
});
