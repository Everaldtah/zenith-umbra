// Front-end screens: title, mode select, hero select (with rival/counter info), map select, settings, pause, results.
import { HEROES, HERO, TEAM_NAME, isAbility, type HeroDef } from '../data/heroes';
import { PLAY_MAPS, MAP } from '../data/maps';
import { BASE } from '../render/Assets';
import { sfx } from '../audio/Sfx';
import type { Game } from './Game';
import { saveSettings, IS_DESKTOP, type Preset } from './Settings';
import type { Mode } from '../game/World';
import { LEVELS, LEVEL, BOSSES, CAMPAIGN_HEROES } from '../campaign/data';
import { playStory } from '../campaign/Cinematic';
import { Coop } from '../net/Coop';
import { HeroViewer } from './HeroViewer';

const h = (html: string) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild as HTMLElement; };

export class Menu {
  root = h('<div class="menu"></div>');
  mode: Mode = 'skirmish';
  hero = 'raijin';
  map = PLAY_MAPS[0].id;

  constructor(public host: HTMLElement, public game: Game) {
    host.append(this.root);
    game.onPause = p => p ? this.pause() : this.close();
    game.onEnd = () => this.results();
    game.onExit = () => { game.stop(); this.title(); };
    (window as any).__zu = { ...(window as any).__zu, openSwap: () => this.heroSelect(true), menu: this };
    this.root.addEventListener('mouseover', e => { if ((e.target as HTMLElement).closest('button,.hc')) sfx.play('ui_hover'); });
    this.root.addEventListener('click', e => { sfx.unlock(); if ((e.target as HTMLElement).closest('button,.hc')) sfx.play('ui_click'); });
    this.title();
  }

  private show(html: string) { this.root.style.display = ''; this.root.innerHTML = html; }
  close() { this.root.style.display = 'none'; this.root.innerHTML = ''; }

  title() {
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && !matchMedia('(pointer:fine)').matches);
    this.show(`<div class="title">
      <div class="bg" style="background-image:url(${BASE}img/map_amatsu.webp)"></div>
      <div class="logo"><span class="z">ZENITH</span><i>//</i><span class="u">UMBRA</span></div>
      <p class="tag">Ten heroes. Two oaths. One eclipse.</p>
      ${mobile ? '<p class="warn">ZENITH//UMBRA needs a PC with a keyboard and mouse.</p>' : ''}
      <div class="btns">
        <button data-m="campaign" class="primary">CAMPAIGN · STARFALL</button>
        <button data-m="skirmish">PLAY VS AI</button>
        <button data-m="training">TRAINING GROUNDS</button>
        <button data-m="spectate">WATCH AI VS AI</button>
        <button data-m="aitest">AI TEST LAB</button>
        <button data-m="heroes">HERO VIEWER &amp; SKINS</button>
        <button data-m="settings">SETTINGS</button>
        ${IS_DESKTOP ? '<button data-m="quit">QUIT</button>' : `<a class="btnlink" href="${BASE}index.html">ABOUT THE GAME</a>`}
      </div>
      <div class="ver">${IS_DESKTOP ? 'Desktop build · GPU accelerated' : 'Web build'} · quality ${this.game.settings.preset.toUpperCase()}</div>
    </div>`);
    this.root.querySelectorAll<HTMLButtonElement>('[data-m]').forEach(b => b.onclick = () => {
      const m = b.dataset.m!;
      if (m === 'settings') return this.settings(() => this.title());
      if (m === 'heroes') return this.viewer();
      if (m === 'quit') return window.close();
      if (m === 'campaign') return this.campaign();
      this.mode = m as Mode;
      if (m === 'spectate' || m === 'aitest') return this.mapSelect();
      this.heroSelect(false);
    });
  }

  heroCard(d: HeroDef) {
    return `<div class="hc ${d.team} ${d.id === this.hero ? 'sel' : ''}" data-h="${d.id}" style="--c:${d.color}">
      <img src="${BASE}img/portrait_${d.id}.webp" onerror="this.style.visibility='hidden'"><b>${d.name}</b><small>${d.role.toUpperCase()}</small></div>`;
  }

  heroDetail(d: HeroDef) {
    const S = d.secondary;
    const ab = (k: string, n: string, desc: string, counter?: string) => `<div class="ab"><kbd>${k}</kbd><div><b>${n}</b><p>${desc}</p>${counter ? `<p class="ctr">⚔ COUNTER: ${counter}</p>` : ''}</div></div>`;
    const rival = HERO[d.rival];
    const pr = d.primary;
    return `<div class="hd" style="--c:${d.color}">
      <div class="art" style="background-image:url(${BASE}img/key_${d.id}.webp)"></div>
      <div class="info">
        <h2>${d.name}<small>${d.title}</small></h2>
        <div class="meta"><span class="${d.team}">${TEAM_NAME[d.team]}</span><span>${d.role.toUpperCase()}</span><span>${d.hp + d.armor} HP${d.armor ? ` (${d.armor} armor)` : ''}</span>${d.frame === 'flyer' ? '<span>FLYER</span>' : ''}${d.frame === 'mech' ? '<span>MECHA</span>' : ''}</div>
        ${d.pilot ? `<p class="pilot"><img src="${BASE}img/portrait_${d.pilot.id}.webp" onerror="this.remove()"><span><b>Pilot: ${d.pilot.name}</b> ${d.pilot.bio}</span></p>` : ''}
        <p class="lore">${d.lore}</p>
        ${ab('LMB', pr.kind === 'charge' ? 'Charged shot' : pr.kind === 'melee' ? 'Melee strikes' : pr.kind === 'beam' ? 'Close-range stream' : 'Primary fire', `${pr.damage}${pr.pellets ? `×${pr.pellets}` : ''} dmg${pr.kind === 'beam' ? '/s' : ''}${pr.splash ? `, ${pr.splash}m splash` : ''}${pr.ammo ? `, ${pr.ammo} rounds` : ''}`)}
        ${isAbility(S) ? ab('RMB', S.name, S.desc, S.counter) : ab('RMB', S.heal ? 'Healing' : 'Alt fire', S.heal ? `Heals allies ${S.damage}${S.kind === 'beam' ? '/s' : ''}` : `${S.damage} dmg`)}
        ${ab('SHIFT', d.ability1.name, d.ability1.desc, d.ability1.counter)}
        ${ab('E', d.ability2.name, d.ability2.desc, d.ability2.counter)}
        ${ab('Q', d.ult.name + ' (ULT)', d.ult.desc)}
        ${ab('—', d.passive.name + ' (passive)', d.passive.desc)}
        <p class="rival">RIVAL: <b style="color:${rival.color}">${rival.name}</b>, ${rival.title}. <em>${d.inspiration}</em></p>
      </div></div>`;
  }

  heroSelect(swap = false, browse = false) {
    const team = (t: string) => HEROES.filter(x => x.team === t).map(x => this.heroCard(x)).join('');
    this.show(`<div class="select">
      <div class="grid"><h3 class="zenith">ZENITH VANGUARD <small>heroes</small></h3><div class="row">${team('zenith')}</div>
      <h3 class="umbra">UMBRA SYNDICATE <small>villains</small></h3><div class="row">${team('umbra')}</div></div>
      <div class="detail"></div>
      <div class="bar">
        ${!swap && !browse && this.mode !== 'training' ? `<label>MAP <select class="mapsel">${PLAY_MAPS.map(m => `<option value="${m.id}" ${m.id === this.map ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label>
        <label>AI <select class="diff"><option value="0.35">Cadet</option><option value="0.65">Vanguard</option><option value="0.9">Eclipse</option></select></label>` : ''}
        <button class="back">BACK</button>${browse ? '' : `<button class="primary go">${swap ? 'SWITCH' : this.mode === 'training' ? 'ENTER TRAINING' : 'START MATCH'}</button>`}
      </div></div>`);
    const detail = this.root.querySelector('.detail')!;
    const pick = (id: string) => {
      this.hero = id;
      this.root.querySelectorAll('.hc').forEach(c => c.classList.toggle('sel', (c as HTMLElement).dataset.h === id));
      detail.innerHTML = this.heroDetail(HERO[id]);
    };
    pick(this.hero);
    this.root.querySelectorAll<HTMLElement>('.hc').forEach(c => c.onclick = () => pick(c.dataset.h!));
    const diff = this.root.querySelector<HTMLSelectElement>('.diff');
    if (diff) diff.value = String([0.35, 0.65, 0.9].reduce((b, v) => Math.abs(v - this.game.settings.difficulty) < Math.abs(b - this.game.settings.difficulty) ? v : b, 0.65));
    (this.root.querySelector('.back') as HTMLElement).onclick = () => { if (swap) { this.close(); this.game.setPaused(false); } else this.title(); };
    const go = this.root.querySelector<HTMLElement>('.go');
    if (go) go.onclick = () => {
      if (swap) { this.game.swapHero(this.hero); this.close(); this.game.setPaused(false); return; }
      const ms = this.root.querySelector<HTMLSelectElement>('.mapsel');
      if (ms) this.map = ms.value;
      if (diff) { this.game.settings.difficulty = +diff.value; saveSettings(this.game.settings); }
      this.launch();
    };
  }

  mapSelect() {
    this.show(`<div class="maps">
      <h2>${this.mode === 'aitest' ? 'AI TEST LAB <small>bots play every map in turn while the lab checks animation, movement, physics, effects and sound</small>' : 'WATCH AI VS AI'}</h2>
      <div class="mgrid">${PLAY_MAPS.map(m => `<div class="mc ${m.id === this.map ? 'sel' : ''}" data-id="${m.id}"><img src="${BASE}img/map_${m.id}.webp" onerror="this.style.visibility='hidden'"><b>${m.name}</b><p>${m.story}</p></div>`).join('')}</div>
      <div class="bar"><button class="back">BACK</button><button class="primary go">${this.mode === 'aitest' ? 'RUN ALL MAPS' : 'WATCH'}</button></div></div>`);
    this.root.querySelectorAll<HTMLElement>('.mc').forEach(c => c.onclick = () => { this.map = c.dataset.id!; this.root.querySelectorAll('.mc').forEach(x => x.classList.toggle('sel', x === c)); });
    (this.root.querySelector('.back') as HTMLElement).onclick = () => this.title();
    (this.root.querySelector('.go') as HTMLElement).onclick = () => { if (this.mode === 'aitest') { this.game.labMapIdx = PLAY_MAPS.findIndex(m => m.id === this.map); } this.launch(); };
  }

  async launch() {
    if (this.mode === 'campaign') return this.playLevel(LEVEL[this.map] ? this.map : LEVELS[0].id, [{ hero: this.hero, netId: 'local' }]);
    const map = this.mode === 'training' ? 'training' : this.map;
    const m = MAP[map];
    this.show(`<div class="loading"><div class="bg" style="background-image:url(${BASE}img/map_${map}.webp)"></div><h2>${m.name}</h2><p>${m.story}</p><div class="spin"></div>
      <p class="tips">WASD move · SPACE jump / fly · LMB fire · RMB secondary · SHIFT / E abilities · Q ultimate · R reload · V first/third person · TAB scoreboard</p></div>`);
    await this.game.start({ mode: this.mode, map, hero: this.mode === 'spectate' || this.mode === 'aitest' ? null : this.hero });
    setTimeout(() => this.close(), 600);
  }

  viewer(id?: string) {
    this.close();
    this.root.style.display = '';
    const v = new HeroViewer(this.root, () => this.title());
    if (id) v.select(id);
    (window as any).__zu.viewer = v;
  }

  // ================================================================ campaign
  private cLevel = LEVELS[0].id;
  private cHero = 'raijin';
  private coop: Coop | null = null;
  private progress() { try { return +(localStorage.getItem('zu-starfall') ?? 0); } catch { return 0; } }
  private unlock(i: number) { try { localStorage.setItem('zu-starfall', String(Math.max(this.progress(), i))); } catch { /* private mode */ } }

  campaign() {
    const prog = this.progress();
    const c = this.coop;
    const inSquad = c?.role;
    const lvlCard = (l: typeof LEVELS[number], i: number) => `<div class="lv ${l.id === this.cLevel ? 'sel' : ''} ${i > prog ? 'locked' : ''}" data-l="${l.id}">
      <img src="${BASE}img/map_${l.id}.webp" onerror="this.style.visibility='hidden'"><img class="bimg" src="${BASE}img/key_${l.boss === 'boss_genesis' ? 'boss_genesis' : l.boss.replace('boss_', 'boss_')}.webp" onerror="this.remove()">
      <b>${i + 1}. ${l.name}</b><small>Boss: ${BOSSES[l.boss].name}${i > prog ? ' · locked' : ''}</small></div>`;
    this.show(`<div class="campaign-menu">
      <h2>OPERATION STARFALL<small>Third-person campaign · 5 levels · hunt the Star-Forger's colossi · solo with AI wingmates or online co-op (up to 4)</small></h2>
      <div class="lvls">${LEVELS.map(lvlCard).join('')}</div>
      <div class="squad">
        <div><h3 class="zenith">YOUR HERO</h3><div class="heroes">${CAMPAIGN_HEROES.map(id => this.heroCard(HERO[id]).replace('class="hc', `class="hc cpick ${id === this.cHero ? 'sel' : ''}`)).join('')}</div></div>
        <div class="coop"><h4>ONLINE CO-OP <span class="st"></span></h4>
          ${!c ? `<div class="row2"><input class="nm" maxlength="20" placeholder="Your name" value="${this.name()}"><button class="con">GO ONLINE</button></div>` : `
          <div class="row2">${inSquad ? `<b>${inSquad === 'host' ? 'Your squad' : 'Joined squad'}</b>` : `<button class="hostb">HOST A SQUAD</button>`}${inSquad ? '<button class="lv2">LEAVE</button>' : ''}</div>
          <ul class="members"></ul>${inSquad ? '' : '<h4>OPEN SQUADS</h4><ul class="list"></ul>'}`}
        </div>
      </div>
      <div class="bar"><button class="back">BACK</button>${inSquad === 'client' ? '<span>Waiting for the host to launch...</span>' : `<button class="primary go">${inSquad === 'host' ? 'LAUNCH SQUAD' : 'START SOLO'}</button>`}</div></div>`);
    this.root.querySelectorAll<HTMLElement>('.lv').forEach(e => e.onclick = () => { this.cLevel = e.dataset.l!; this.coop?.setLevel(this.cLevel); this.campaign(); });
    this.root.querySelectorAll<HTMLElement>('.cpick').forEach(e => e.onclick = () => { this.cHero = e.dataset.h!; this.coop?.setHero(this.cHero); this.campaign(); });
    (this.root.querySelector('.back') as HTMLElement).onclick = () => { this.coop?.leave(); this.title(); };
    const go = this.root.querySelector<HTMLElement>('.go');
    if (go) go.onclick = () => { if (this.coop?.role === 'host') this.coop.start(); else this.playLevel(this.cLevel, [{ hero: this.cHero, netId: 'local' }]); };
    const con = this.root.querySelector<HTMLElement>('.con');
    if (con) con.onclick = () => {
      const nm = (this.root.querySelector('.nm') as HTMLInputElement).value.trim() || 'Vanguard';
      try { localStorage.setItem('zu-name', nm); } catch { /* ignore */ }
      this.coop = new Coop(nm, IS_DESKTOP ? 'desktop' : 'web');
      this.coop.onPlayers = () => this.refreshCoop();
      this.coop.onSquad = () => this.refreshCoop();
      this.coop.onStatus = () => this.refreshCoop();
      this.coop.onLeft = r => { alert(r); this.campaign(); };
      this.coop.onStart = (level, squad) => {
        const me = this.coop!.me;
        const sq = squad.map(s => ({ hero: s.hero, netId: s.id === me ? 'local' : s.id }));
        this.playLevel(level, sq, { coop: this.coop!, role: this.coop!.role as 'host' | 'client' });
      };
      this.campaign();
    };
    const hb = this.root.querySelector<HTMLElement>('.hostb');
    if (hb) hb.onclick = () => { this.coop!.host(this.cHero, this.cLevel); this.campaign(); };
    const lv2 = this.root.querySelector<HTMLElement>('.lv2');
    if (lv2) lv2.onclick = () => { this.coop!.leave(); this.campaign(); };
    this.refreshCoop();
  }
  private name() { try { return localStorage.getItem('zu-name') ?? ''; } catch { return ''; } }
  private refreshCoop() {
    const c = this.coop; if (!c) return;
    const st = this.root.querySelector('.coop .st'); if (st) st.innerHTML = c.lobby.brokers ? `<span class="ok">● online</span>` : `<span class="bad">● connecting</span>`;
    const mem = this.root.querySelector('.members');
    if (mem) mem.innerHTML = c.squad.map(s => `<li><span>${s.name}${s.id === c.me ? ' (you)' : ''} · ${HERO[s.hero]?.name ?? s.hero}</span><span class="st">${s.id === c.hostId ? 'host' : s.link ?? ''}</span></li>`).join('');
    const list = this.root.querySelector('.list');
    if (list) {
      const sq = c.squads();
      list.innerHTML = sq.length ? sq.map(p => `<li><span>${p.name} · ${LEVEL[p.mission ?? '']?.name ?? ''}</span><button data-j="${p.id}">JOIN</button></li>`).join('') : '<li class="st">No open squads yet - host one and share the game with a friend.</li>';
      list.querySelectorAll<HTMLElement>('[data-j]').forEach(b => b.onclick = () => { c.join(b.dataset.j!, this.cHero); this.campaign(); });
    }
    if (c.role === 'client' && c.level && c.level !== this.cLevel) { this.cLevel = c.level; }
  }

  async playLevel(levelId: string, squad: { hero: string; netId: string }[], net?: { coop: Coop; role: 'host' | 'client' }) {
    const idx = LEVELS.findIndex(l => l.id === levelId), L = LEVELS[idx];
    this.close();
    const prologue = idx === 0 ? [{ img: 'img/cine_02.webp', text: 'The night the Colossus fell on Neo-Kurogane, nobody had ever seen a machine that large.' }, { img: 'img/cine_04.webp', text: 'The Vanguard launched before sunrise.' }] : [];
    if (new URLSearchParams(location.search).get('story') !== '0') await playStory([...L.intro, ...prologue], { music: 'umbra' });
    this.game.onCampaignEnd = async won => {
      this.game.stop();
      if (won) {
        this.unlock(idx + 1);
        await playStory(L.outro, { music: 'zenith' });
        if (idx + 1 < LEVELS.length) this.cLevel = LEVELS[idx + 1].id;
        else await playStory([{ img: 'img/key_qelvaris.webp', text: '"You have not ended the Eclipse," whispers a voice from the static. "You have only made it curious." - To be continued.' }], { music: 'menu' });
      }
      if (net?.role === 'host') net.coop.lobby.setStatus('squad', this.cLevel);
      this.campaign();
    };
    this.show(`<div class="loading"><div class="bg" style="background-image:url(${BASE}img/map_${levelId}.webp)"></div><h2>${L.name}</h2><p>Boss: ${BOSSES[L.boss].name} - ${BOSSES[L.boss].title}</p><div class="spin"></div>
      <p class="tips">Clear the robot waves on each platform, use the jump pads to advance, then bring down the Colossus. Red circles and lines are incoming attacks - move or jump.</p></div>`);
    await this.game.start({ mode: 'campaign', map: levelId, hero: squad.find(s => s.netId === 'local')?.hero ?? this.cHero, squad, net });
    setTimeout(() => this.close(), 600);
  }

  pause() {
    this.show(`<div class="pause"><h2>PAUSED</h2><div class="btns">
      <button class="primary res">RESUME</button>
      ${this.game.match?.world.mode === 'training' ? '<button class="swap">SWITCH HERO</button>' : ''}
      <button class="set">SETTINGS</button><button class="quit">QUIT TO MENU</button></div>
      <p class="tips">Click the game to capture the mouse · Esc pauses</p></div>`);
    (this.root.querySelector('.res') as HTMLElement).onclick = () => { this.close(); this.game.setPaused(false); };
    const sw = this.root.querySelector<HTMLElement>('.swap'); if (sw) sw.onclick = () => this.heroSelect(true);
    (this.root.querySelector('.set') as HTMLElement).onclick = () => this.settings(() => this.pause());
    (this.root.querySelector('.quit') as HTMLElement).onclick = () => { this.game.stop(); this.title(); };
  }

  results() {
    const w = this.game.match?.world;
    this.show(`<div class="pause results"><h2 class="${w?.winner}">${w?.winner === 'zenith' ? 'ZENITH VANGUARD' : 'UMBRA SYNDICATE'} WINS</h2>
      <div class="btns"><button class="primary again">PLAY AGAIN</button><button class="hero">CHANGE HERO</button><button class="quit">MAIN MENU</button></div></div>`);
    (this.root.querySelector('.again') as HTMLElement).onclick = () => this.launch();
    (this.root.querySelector('.hero') as HTMLElement).onclick = () => { this.game.stop(); this.heroSelect(); };
    (this.root.querySelector('.quit') as HTMLElement).onclick = () => { this.game.stop(); this.title(); };
  }

  settings(back: () => void) {
    const s = this.game.settings;
    this.show(`<div class="pause settings"><h2>SETTINGS</h2>
      <label>Graphics <select class="q">${(['low', 'medium', 'high', 'ultra'] as Preset[]).map(p => `<option ${p === s.preset ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
      <label>Mouse sensitivity <input class="sens" type="range" min="0.2" max="3" step="0.05" value="${s.sens}"></label>
      <label>Field of view <input class="fov" type="range" min="70" max="110" step="1" value="${s.fov}"></label>
      <label>Volume <input class="vol" type="range" min="0" max="1" step="0.05" value="${s.volume}"></label>
      <label>Camera <select class="view"><option value="third" ${s.view === 'third' ? 'selected' : ''}>Third person</option><option value="first" ${s.view === 'first' ? 'selected' : ''}>First person</option></select></label>
      <label>Show FPS <input class="fps" type="checkbox" ${s.showFps ? 'checked' : ''}></label>
      <div class="btns"><button class="primary ok">DONE</button></div></div>`);
    (this.root.querySelector('.ok') as HTMLElement).onclick = () => {
      const q = (c: string) => this.root.querySelector(c) as HTMLInputElement;
      s.preset = q('.q').value as Preset; s.sens = +q('.sens').value; s.fov = +q('.fov').value; s.volume = +q('.vol').value;
      s.view = q('.view').value as 'third' | 'first'; s.showFps = q('.fps').checked;
      saveSettings(s); this.game.applySettings(s); back();
    };
  }
}
