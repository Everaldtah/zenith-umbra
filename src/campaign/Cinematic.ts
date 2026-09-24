// Story cinematics (Ken-Burns storyboard panels + typewriter captions + score) and boss title cards.
import { BASE } from '../render/Assets';
import { sfx } from '../audio/Sfx';
import { BOSSES } from './data';

let el: HTMLElement | null = null;
function root() {
  if (!el) {
    el = document.createElement('div'); el.className = 'cine'; document.body.append(el);
    const st = document.createElement('style');
    st.textContent = `
.cine { position: fixed; inset: 0; z-index: 40; pointer-events: none; }
.cine .panel { position: absolute; inset: 0; background: #000; pointer-events: auto; overflow: hidden; }
.cine .panel .img { position: absolute; inset: -5%; background-size: cover; background-position: center; animation: cinekb 9s ease-out forwards; }
@keyframes cinekb { from { transform: scale(1.02) translateX(-1.5%); } to { transform: scale(1.14) translateX(1.5%); } }
.cine .panel::before, .cine .panel::after { content: ''; position: absolute; left: 0; right: 0; height: 9%; background: #000; z-index: 2; } .cine .panel::before { top: 0; } .cine .panel::after { bottom: 0; }
.cine .cap { position: absolute; left: 8%; right: 8%; bottom: 13%; z-index: 3; font: 700 clamp(18px, 2.2vw, 30px) Rajdhani, sans-serif; color: #fff; text-shadow: 0 3px 14px #000, 0 0 2px #000; line-height: 1.35; }
.cine .skip { position: absolute; right: 3%; bottom: 3%; z-index: 3; font: 600 14px Rajdhani; color: #fff8; letter-spacing: .15em; }
.cine .fade { position: absolute; inset: 0; background: #000; opacity: 0; transition: opacity .6s; z-index: 4; pointer-events: none; } .cine .fade.on { opacity: 1; }
.cine .boss { position: absolute; left: 0; right: 0; top: 22%; text-align: center; animation: bossin 3.6s ease forwards; }
.cine .boss small { display: block; font: 700 16px Rajdhani; letter-spacing: .6em; color: #fff; } .cine .boss b { display: block; font: 800 clamp(40px, 7vw, 96px) Orbitron, sans-serif; color: var(--c); text-shadow: 0 0 30px var(--c); }
.cine .boss span { font: 600 20px Rajdhani; color: #eee; letter-spacing: .25em; } .cine .boss i { display: block; margin-top: 8px; font: 600 16px Rajdhani; color: #ffd76a; font-style: normal; }
@keyframes bossin { 0% { opacity: 0; transform: scale(1.3); } 12% { opacity: 1; transform: none; } 85% { opacity: 1; } 100% { opacity: 0; } }`;
    document.head.append(st);
  }
  return el;
}

/** Play storyboard panels; resolves when finished or skipped. */
export function playStory(panels: { img: string; text: string }[], opts: { music?: 'menu' | 'zenith' | 'umbra' | 'battle' } = {}): Promise<void> {
  const r = root();
  sfx.unlock();
  if (opts.music) sfx.music(opts.music);
  return new Promise(resolve => {
    let i = 0, timer = 0, typer = 0, done = false;
    const panel = document.createElement('div'); panel.className = 'panel';
    panel.innerHTML = '<div class="img"></div><div class="cap"></div><div class="skip">CLICK / SPACE: NEXT · ESC: SKIP</div><div class="fade"></div>';
    r.append(panel);
    const img = panel.querySelector('.img') as HTMLElement, cap = panel.querySelector('.cap') as HTMLElement, fade = panel.querySelector('.fade') as HTMLElement;
    const finish = () => {
      if (done) return; done = true;
      clearTimeout(timer); clearInterval(typer);
      removeEventListener('keydown', key);
      fade.classList.add('on');
      setTimeout(() => { panel.remove(); resolve(); }, 600);
    };
    const show = () => {
      if (i >= panels.length) return finish();
      const p = panels[i++];
      fade.classList.add('on');
      setTimeout(() => {
        img.style.backgroundImage = `url(${BASE}${p.img})`;
        img.style.animation = 'none'; void img.offsetWidth; img.style.animation = '';
        fade.classList.remove('on');
        cap.textContent = '';
        let n = 0;
        clearInterval(typer);
        typer = window.setInterval(() => { cap.textContent = p.text.slice(0, ++n); if (n % 3 === 0) sfx.play('ui_hover', undefined, 0.3); if (n >= p.text.length) clearInterval(typer); }, 28);
        timer = window.setTimeout(show, Math.max(4500, p.text.length * 55 + 1800));
      }, i === 1 ? 50 : 600);
    };
    const key = (e: KeyboardEvent) => { if (e.code === 'Escape') finish(); else if (e.code === 'Space' || e.code === 'Enter') { clearTimeout(timer); show(); } };
    panel.addEventListener('click', () => { clearTimeout(timer); show(); });
    addEventListener('keydown', key);
    show();
  });
}

/** Non-blocking boss title card. */
export function bossCard(id: string) {
  const b = BOSSES[id]; if (!b) return;
  const r = root();
  const d = document.createElement('div'); d.className = 'boss';
  d.style.setProperty('--c', b.glow);
  d.innerHTML = `<small>WARNING · COLOSSUS DETECTED</small><b>${b.name}</b><span>${b.title}</span><i>Weak point: ${b.weak}</i>`;
  r.append(d);
  sfx.play('ultcall'); sfx.play('thunderclap');
  setTimeout(() => d.remove(), 3700);
}
