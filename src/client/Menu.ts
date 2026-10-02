// Front-end screens: title, mode select, hero select (with rival/counter info), map select, settings, pause, results.
import { HERO, TEAM_NAME, isAbility, rosterFor, type HeroDef } from '../data/heroes';
import { mapsFor, mapFor } from '../data/maps';
import { ROLE_PASSIVE, SUBROLE, REGEN_RATE, REGEN_DELAY } from '../game/roles';
import { FULL, DOWNLOAD_URL } from '../edition';
import { loadCareer, saveCareer, rankOf, applyCompetitive, applyQuickPlay, skillFor, lobbyRating, ROLE_OF, TIER_COLOR, PLACEMENTS, type RankRole, type RankChange } from '../game/ranks';
import { BASE } from '../render/Assets';
import { sfx } from '../audio/Sfx';
import type { Game } from './Game';
import { saveSettings, IS_DESKTOP } from './Settings';
import { SettingsScreen } from './SettingsUI';
import type { Mode } from '../game/World';
import { LEVELS, LEVEL, BOSSES, CAMPAIGN_HEROES } from '../campaign/data';
import { playStory } from '../campaign/Cinematic';
import { Coop } from '../net/Coop';
import { HeroViewer } from './HeroViewer';
import { startUltShowcase } from './UltShowcase';
import { OnlineUI, recordCareerMatch, progressHtml } from './OnlineUI';
import { showCareer } from './CareerUI';

const h = (html: string) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild as HTMLElement; };
const HEROES = rosterFor(FULL);
const PLAY_MAPS = mapsFor(FULL);
const MAP = { get: (id: string) => mapFor(id, FULL) };
type Queue = 'quickplay' | 'competitive' | 'practice';
type RolePick = RankRole | 'flex';
const QUEUE_NAME: Record<Queue, string> = { quickplay: 'QUICK PLAY', competitive: 'COMPETITIVE', practice: 'AI QUICK MATCH' };
const ROLE_NAME: Record<RolePick, string> = { tank: 'TANK', damage: 'DAMAGE', support: 'SUPPORT', flex: 'FLEX' };
const ROLE_HERO: Record<RankRole, string> = { tank: 'tank', damage: 'dps', support: 'support' };
const DIFFS: [string, number, string][] = [['RECRUIT', 0.4, 'Relaxed bots: slower aim, slower reactions.'], ['VETERAN', 0.62, 'A fair fight.'], ['ELITE', 0.8, 'Sharp aim, quick ability use.'], ['LEGEND', 0.95, 'Top-tier bots that punish every mistake.']];
/** a rank emblem: a faceted gem in the tier colour with the division numeral */
export function emblem(rating: number, games: number, size = 64) {
  const r = rankOf(rating, games);
  const col = r.placed ? r.color : '#7a8199';
  return `<div class="emblem" style="--c:${col};--s:${size}px"><i></i><b>${r.placed ? r.division : '?'}</b></div>`;
}

export class Menu {
  root = h('<div class="menu"></div>');
  mode: Mode = FULL ? 'quickplay' : 'skirmish';
  hero = 'raijin';
  map = PLAY_MAPS[0].id;
  queue: Queue | null = null;
  role: RolePick = 'flex';
  diff = 0.62;
  mapChoice = 'random';
  /** the lobby this match was made against (its rating) */
  opp = 1800;
  lastChange: RankChange | null = null;

  /** PLAY ONLINE: the online lobby, matchmaking, hero select and online results */
  online: OnlineUI;

  constructor(public host: HTMLElement, public game: Game) {
    this.online = new OnlineUI({ root: this.root, game, show: html => this.show(html), close: () => this.close(), title: () => this.title(), emblem, name: () => this.name() });
    host.append(this.root);
    game.onPause = p => p ? this.pause() : this.close();
    game.onEnd = () => this.results();
    game.onExit = () => { this.abandon(); game.stop(); this.title(); };
    (window as any).__zu = { ...(window as any).__zu, openSwap: () => this.heroSelect(true), menu: this };
    this.root.addEventListener('mouseover', e => { if ((e.target as HTMLElement).closest('button,.hc')) sfx.play('ui_hover'); });
    this.root.addEventListener('click', e => { sfx.unlock(); if ((e.target as HTMLElement).closest('button,.hc')) sfx.play('ui_click'); });
    this.title();
  }

  private show(html: string) { this.root.style.display = ''; this.root.innerHTML = html; }
  close() { this.root.style.display = 'none'; this.root.innerHTML = ''; }

  title() {
    if (!FULL) return this.liteTitle();
    // Options > Sound > Play Menu Music: the title theme (starts with the first click if audio is still locked)
    if (!this.game.running) sfx.music(this.game.settings.sound.menuMusic ? 'menu' : null);
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && !matchMedia('(pointer:fine)').matches);
    const c = loadCareer();
    const best = (['tank', 'damage', 'support'] as RankRole[]).map(r => c.roles[r]).sort((a, b) => b.rating * (b.games >= PLACEMENTS ? 1 : 0) - a.rating * (a.games >= PLACEMENTS ? 1 : 0))[0];
    this.show(`<div class="title">
      <div class="bg" style="background-image:url(${BASE}img/map_hanabi.webp)"></div>
      <div class="logo"><span class="z">ZENITH</span><i>//</i><span class="u">UMBRA</span></div>
      <p class="tag">Eleven heroes. Two oaths. One eclipse.</p>
      ${mobile ? '<p class="warn">ZENITH//UMBRA needs a PC with a keyboard and mouse.</p>' : ''}
      <div class="btns two">
        <button data-m="online" class="primary">PLAY ONLINE <small>with other players</small></button>
        <button data-q="quickplay" class="primary">QUICK PLAY</button>
        <button data-q="competitive">COMPETITIVE <small>${rankOf(best.rating, best.games).label}</small></button>
        <button data-q="practice">AI QUICK MATCH</button>
        <button data-m="stadium">STADIUM</button>
        <button data-m="campaign">CAMPAIGN · STARFALL</button>
        <button data-m="training">TRAINING GROUNDS</button>
        <button data-m="career">CAREER PROFILE</button>
        <button data-m="heroes">HERO VIEWER &amp; SKINS</button>
        <button data-m="spectate">WATCH AI VS AI</button>
        <button data-m="aitest">AI TEST LAB</button>
        <button data-m="settings">SETTINGS</button>
        ${IS_DESKTOP ? '<button data-m="quit">QUIT</button>' : `<a class="btnlink" href="${BASE}index.html">ABOUT THE GAME</a>`}
      </div>
      <div class="ver">Full edition${IS_DESKTOP ? ' · Desktop · GPU accelerated' : ' · dev'} · quality ${this.game.settings.preset.toUpperCase()}</div>
    </div>`);
    this.root.querySelectorAll<HTMLButtonElement>('[data-q]').forEach(b => b.onclick = () => this.queueSelect(b.dataset.q as Queue));
    this.root.querySelectorAll<HTMLButtonElement>('[data-m]').forEach(b => b.onclick = () => {
      const m = b.dataset.m!;
      if (m === 'settings') return this.settings(() => this.title());
      if (m === 'heroes') return this.viewer();
      if (m === 'quit') return window.close();
      if (m === 'campaign') return this.campaign();
      if (m === 'career') return this.career();
      if (m === 'online') return this.online.open();
      this.queue = null;
      this.mode = m as Mode;
      if (m === 'spectate' || m === 'aitest') return this.mapSelect();
      this.heroSelect(false);
    });
  }

  /** the web edition: a light demo, and the way to the full game */
  liteTitle() {
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && !matchMedia('(pointer:fine)').matches);
    this.show(`<div class="title">
      <div class="bg" style="background-image:url(${BASE}img/map_amatsu.webp)"></div>
      <div class="logo"><span class="z">ZENITH</span><i>//</i><span class="u">UMBRA</span></div>
      <p class="tag">Ten heroes. Two oaths. One eclipse.</p>
      ${mobile ? '<p class="warn">ZENITH//UMBRA needs a PC with a keyboard and mouse.</p>' : ''}
      <div class="btns">
        <button data-m="skirmish" class="primary">PLAY VS AI <small>web demo</small></button>
        <button data-m="training">TRAINING GROUNDS</button>
        <button data-m="heroes">HERO VIEWER</button>
        <button data-m="settings">SETTINGS</button>
        <a class="btnlink" href="${BASE}index.html">ABOUT THE GAME</a>
      </div>
      <div class="full">
        <h3>THE FULL GAME IS ON WINDOWS</h3>
        <ul><li><b>Quick Play &amp; Competitive</b> with role ranks, placements and rank modifiers</li><li><b>AI Quick Match</b> with your AI squad on best-of-3 Control and <b>Mikoshi Rush</b></li>
          <li><b>New maps</b> - Hanabi Harbor, Cloudstep Terraces, Kagura Avenue - and rebuilt arenas with interiors and health packs</li>
          <li><b>Gantetsu</b>, the Iron Yokozuna - and <b>Mirei's</b> guardian-angel flight and swoop</li><li>The Overwatch-style animation layer, the Tab stats screen, Stadium and the Starfall campaign</li></ul>
        <a class="btnlink dl" href="${DOWNLOAD_URL}">⬇ DOWNLOAD FOR WINDOWS</a>
      </div>
      <div class="ver">Web demo · quality ${this.game.settings.preset.toUpperCase()}</div>
    </div>`);
    this.root.querySelectorAll<HTMLButtonElement>('[data-m]').forEach(b => b.onclick = () => {
      const m = b.dataset.m!;
      if (m === 'settings') return this.settings(() => this.title());
      if (m === 'heroes') return this.viewer();
      this.queue = null;
      this.mode = m as Mode;
      this.heroSelect(false);
    });
  }

  // ================================================================ queues (desktop edition)
  /** Quick Play / Competitive: pick a role (role queue, one tank + two damage + two support per team); AI Quick Match:
   *  difficulty and map */
  queueSelect(q: Queue) {
    this.queue = q; this.mode = q;
    const c = loadCareer();
    if (q === 'practice') {
      this.show(`<div class="modes queue">
        <h2>AI QUICK MATCH <small>You and four AI teammates against an AI team - best-of-3 Control or Mikoshi Rush, no rank on the line</small></h2>
        <h3>DIFFICULTY</h3><div class="diffs">${DIFFS.map(([n, v, d]) => `<div class="card ${Math.abs(v - this.diff) < 0.01 ? 'sel' : ''}" data-d="${v}"><b>${n}</b><p>${d}</p></div>`).join('')}</div>
        <h3>MAP</h3><div class="mgrid mapsq"><div class="mc ${this.mapChoice === 'random' ? 'sel' : ''}" data-id="random"><div class="rnd">?</div><b>Random map</b><p>Any arena, any mode.</p></div>${PLAY_MAPS.map(m => `<div class="mc ${m.id === this.mapChoice ? 'sel' : ''}" data-id="${m.id}"><img src="${BASE}img/map_${m.id}.webp" onerror="this.style.visibility='hidden'"><b>${m.name}</b><p>${m.objective === 'push' ? 'MIKOSHI RUSH' : 'CONTROL'}</p></div>`).join('')}</div>
        <div class="bar"><button class="back">BACK</button><button class="primary go">CHOOSE HERO</button></div></div>`);
      this.root.querySelectorAll<HTMLElement>('[data-d]').forEach(e => e.onclick = () => { this.diff = +e.dataset.d!; this.queueSelect(q); });
      this.root.querySelectorAll<HTMLElement>('.mc').forEach(e => e.onclick = () => { this.mapChoice = e.dataset.id!; this.queueSelect(q); });
      (this.root.querySelector('.back') as HTMLElement).onclick = () => this.title();
      (this.root.querySelector('.go') as HTMLElement).onclick = () => { this.role = 'flex'; this.heroSelect(false); };
      return;
    }
    const roles: RolePick[] = q === 'competitive' ? ['tank', 'damage', 'support'] : ['tank', 'damage', 'support', 'flex'];
    const blurb: Record<RolePick, string> = { tank: 'Hold the space, lead the fight.', damage: 'Find the kills, open the fight.', support: 'Keep the team alive, turn the fight.', flex: 'Any hero, any role.' };
    this.show(`<div class="modes queue">
      <h2>${QUEUE_NAME[q]} <small>${q === 'competitive' ? `Ranked, role queue - one rank per role. ${PLACEMENTS} placement matches reveal it; every match after that moves it.` : 'Unranked, role queue or flex - a lobby matched to your skill, a random map and mode.'}</small></h2>
      <div class="roles">${roles.map(r => {
        const rr = r !== 'flex' ? c.roles[r] : null;
        return `<div class="role card" data-r="${r}"><i class="ri ${r}"></i><b>${ROLE_NAME[r]}</b><p>${blurb[r]}</p>
          ${q === 'competitive' && rr ? `${emblem(rr.rating, rr.games, 72)}<span class="rl">${rankOf(rr.rating, rr.games).label}</span><span class="rec">${rr.wins}W - ${rr.losses}L</span>` : ''}</div>`;
      }).join('')}</div>
      <div class="bar"><button class="back">BACK</button></div></div>`);
    this.root.querySelectorAll<HTMLElement>('[data-r]').forEach(e => e.onclick = () => { this.role = e.dataset.r as RolePick; this.heroSelect(false); });
    (this.root.querySelector('.back') as HTMLElement).onclick = () => this.title();
  }

  /** matchmaking (the lobby is AI, matched to your rating): search, then MATCH FOUND with the map and mode */
  findMatch() {
    const q = this.queue!, c = loadCareer();
    const rr = q === 'competitive' ? c.roles[this.role as RankRole] : null;
    const mmr = rr ? rr.mmr : c.qp.mmr;
    this.opp = lobbyRating(mmr);
    if (q !== 'practice' || this.mapChoice === 'random') this.map = PLAY_MAPS[Math.floor(Math.random() * PLAY_MAPS.length)].id;
    else this.map = this.mapChoice;
    const m = MAP.get(this.map);
    this.show(`<div class="loading find"><div class="bg" style="background-image:url(${BASE}img/map_${this.map}.webp);opacity:.25"></div>
      <h2>${QUEUE_NAME[q]} · ${ROLE_NAME[this.role]}</h2><p class="st">SEARCHING FOR A MATCH <b class="tm">0:00</b></p><p class="tips">Matching lobby near ${rr ? rankOf(mmr, PLACEMENTS).label : 'your skill'}</p>
      <div class="bar"><button class="back">CANCEL</button></div></div>`);
    let t = 0; const need = 1.6 + Math.random() * 2.2;
    const tm = this.root.querySelector('.tm') as HTMLElement;
    let cancelled = false;
    (this.root.querySelector('.back') as HTMLElement).onclick = () => { cancelled = true; this.queueSelect(q); };
    const tick = () => {
      if (cancelled) return;
      t += 0.25; tm.textContent = `0:${String(Math.floor(t)).padStart(2, '0')}`;
      if (t < need) { setTimeout(tick, 250); return; }
      sfx.play('announce');
      this.show(`<div class="loading find found"><div class="bg" style="background-image:url(${BASE}img/map_${this.map}.webp)"></div>
        <p class="mf">MATCH FOUND</p><h2>${m.name}</h2><p class="obj">${m.objective === 'push' ? 'MIKOSHI RUSH · push the festival float through the enemy gate' : 'CONTROL · best of 3 rounds on the capture point'}</p>
        <p>${m.story}</p><p class="tips">Lobby rating ≈ ${rankOf(this.opp, PLACEMENTS).label} · WASD move · SPACE jump · LMB / RMB fire · SHIFT / E abilities · Q ultimate · F swoop (Mirei) · TAB stats</p></div>`);
      setTimeout(() => this.launch(), 2200);
    };
    setTimeout(tick, 250);
  }

  /** the Career Profile (CareerUI.ts): overview, statistics, Hero Skill Ratings, hero levels, match history */
  career() { this.root.style.display = ''; showCareer(this.root, { back: () => this.title(), emblem, name: this.name() }); }

  /** a match left before its end still counts its time on each hero (no result) */
  private abandon() {
    recordCareerMatch(this.game, 'none');
    if (this.online.ctx) { this.online.ctx = null; this.online.session?.leave(true); }
  }

  /** PLAY VS AI: the two ways to play, as in Overwatch 2 - NORMAL (first person) and STADIUM (third person, rounds + Armory) */
  modeSelect() {
    this.show(`<div class="modes">
      <h2>PLAY VS AI <small>5v5 against the Umbra Syndicate (or the Vanguard) on the capture point</small></h2>
      <div class="mgrid2">
        <div class="mode" data-mode="skirmish"><div class="bg" style="background-image:url(${BASE}img/map_kurogane.webp)"></div>
          <b>NORMAL</b><span class="tag">FIRST PERSON</span>
          <p>The classic match: take and hold the point. Your hero's own first-person arms, one life at a time, no shop.</p></div>
        <div class="mode" data-mode="stadium"><div class="bg" style="background-image:url(${BASE}img/map_amatsu.webp)"></div>
          <b>STADIUM</b><span class="tag">THIRD PERSON</span>
          <p>First team to win 4 rounds. Earn cash in every round, then spend it in the Armory on weapon, ability and survival items -
          and pick a hero power on rounds 1, 3, 5 and 7 that upgrades your kit.</p></div>
      </div>
      <div class="bar"><button class="back">BACK</button></div></div>`);
    this.root.querySelectorAll<HTMLElement>('.mode').forEach(c => c.onclick = () => { this.mode = c.dataset.mode as Mode; this.heroSelect(false); });
    (this.root.querySelector('.back') as HTMLElement).onclick = () => this.title();
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
        ${ab('LMB', pr.name ?? (pr.kind === 'charge' ? 'Charged shot' : pr.kind === 'melee' ? 'Melee strikes' : pr.kind === 'beam' ? 'Close-range stream' : 'Primary fire'), `${pr.damage}${pr.pellets ? `×${pr.pellets}` : ''} dmg${pr.kind === 'beam' ? '/s' : ''}${pr.splash ? `, ${pr.splash}m splash` : ''}${pr.ammo ? `, ${pr.ammo} rounds` : ''}${pr.sweep ? `, ${pr.range}m sweeping arc` : ''}${pr.note ? `. ${pr.note}` : ''}`)}
        ${isAbility(S) ? ab('RMB', S.name, S.desc, S.counter) : ab('RMB', S.heal ? 'Healing' : 'Alt fire', S.heal ? `Heals allies ${S.damage}${S.kind === 'beam' ? '/s' : ''}` : `${S.damage} dmg`)}
        ${ab('SHIFT', d.ability1.name, d.ability1.desc, d.ability1.counter)}
        ${ab('E', d.ability2.name, d.ability2.desc, d.ability2.counter)}
        ${ab('Q', d.ult.name + ' (ULT)', d.ult.desc)}
        ${ab('—', d.passive.name + ' (passive)', d.passive.desc)}
        ${ab('◆', `${ROLE_PASSIVE[d.role].name} role${d.subrole ? ' · ' + SUBROLE[d.subrole].name : ''}`, `${ROLE_PASSIVE[d.role].desc}${d.subrole ? ' ' + SUBROLE[d.subrole].desc : ''} Everyone regenerates ${REGEN_RATE} HP/s after ${REGEN_DELAY}s without taking damage.`)}
        ${ab('C', 'Quick melee', 'A fast punch for 40 damage - every hero has one (0.9s cooldown).')}
        <p class="rival">RIVAL: <b style="color:${rival.color}">${rival.name}</b>, ${rival.title}. <em>${d.inspiration}</em></p>
      </div></div>`;
  }

  heroSelect(swap = false, browse = false) {
    const roleOk = (x: HeroDef) => !this.queue || this.role === 'flex' || x.role === ROLE_HERO[this.role as RankRole];
    const team = (t: string) => HEROES.filter(x => x.team === t && roleOk(x)).map(x => this.heroCard(x)).join('');
    if (!roleOk(HERO[this.hero])) this.hero = HEROES.find(roleOk)!.id;
    this.show(`<div class="select">
      <div class="grid"><h3 class="zenith">ZENITH VANGUARD <small>heroes</small></h3><div class="row">${team('zenith')}</div>
      <h3 class="umbra">UMBRA SYNDICATE <small>villains</small></h3><div class="row">${team('umbra')}</div></div>
      <div class="detail"></div>
      <div class="bar">
        ${this.queue ? `<span class="qtag">${QUEUE_NAME[this.queue]} · ${ROLE_NAME[this.role]}${this.queue === 'practice' ? ` · ${DIFFS.find(d => Math.abs(d[1] - this.diff) < 0.01)?.[0] ?? ''}` : ''}</span>` : ''}
        ${!swap && !browse && this.mode !== 'training' && !this.queue ? `<label>MAP <select class="mapsel">${PLAY_MAPS.map(m => `<option value="${m.id}" ${m.id === this.map ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label>
        <label>AI <select class="diff"><option value="0.35">Cadet</option><option value="0.65">Vanguard</option><option value="0.9">Eclipse</option></select></label>` : ''}
        <button class="back">BACK</button>${browse ? '' : `<button class="primary go">${swap ? 'SWITCH' : this.queue && this.queue !== 'practice' ? 'FIND MATCH' : this.mode === 'training' ? 'ENTER TRAINING' : this.mode === 'stadium' ? 'ENTER STADIUM' : 'START MATCH'}</button>`}
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
    (this.root.querySelector('.back') as HTMLElement).onclick = () => { if (swap) { this.close(); this.game.setPaused(false); } else if (this.queue) this.queueSelect(this.queue); else this.title(); };
    const go = this.root.querySelector<HTMLElement>('.go');
    if (go) go.onclick = () => {
      if (swap) { this.game.swapHero(this.hero); this.close(); this.game.setPaused(false); return; }
      if (this.queue) return this.findMatch();
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
    const m = MAP.get(map);
    this.show(`<div class="loading"><div class="bg" style="background-image:url(${BASE}img/map_${map}.webp)"></div><h2>${m.name}</h2><p>${m.story}</p><div class="spin"></div>
      <p class="tips">WASD move · SPACE jump / fly · LMB fire · RMB secondary · C melee · F swoop (Mirei) · SHIFT / E abilities · Q ultimate · R reload · CTRL descend · V first/third person · TAB scoreboard</p></div>`);
    // bots play at the lobby's rating (Quick Play / Competitive) or the chosen difficulty (AI Quick Match)
    const skill = this.queue === 'practice' ? this.diff : this.queue ? skillFor(this.opp) : undefined;
    await this.game.start({ mode: this.mode, map, hero: this.mode === 'spectate' || this.mode === 'aitest' ? null : this.hero, skill });
    setTimeout(() => this.close(), 600);
  }

  viewer(id?: string) {
    this.close();
    this.root.style.display = '';
    // one viewer at a time (they share one WebGL canvas: a stale one would keep drawing into it)
    this.heroViewer?.dispose();
    // the Ult Viewer (full edition): the hero's ultimate played for real on the Proving Grounds
    const v: HeroViewer = this.heroViewer = new HeroViewer(this.root, () => this.title(), FULL ? h => { v.dispose(); this.ultShowcase(h); } : undefined);
    if (id) v.select(id);
    (window as any).__zu.viewer = v;
  }
  private heroViewer: HeroViewer | null = null;

  async ultShowcase(id: string) {
    const h = HERO[id];
    this.show(`<div class="loading"><div class="bg" style="background-image:url(${BASE}img/key_${id}.webp)"></div><h2>${h.ult.name}</h2><p>${h.name} · ULT VIEWER</p><div class="spin"></div>
      <p class="tips">R replay · T slow-mo · drag to orbit · wheel to zoom · Esc back to the Hero Viewer</p></div>`);
    await startUltShowcase(this.game, id, { back: () => this.viewer(id), pick: h2 => this.ultShowcase(h2) });
    setTimeout(() => { if (this.game.running) this.close(); }, 600);
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
  name() { try { return localStorage.getItem('zu-name') ?? ''; } catch { return ''; } }
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
      recordCareerMatch(this.game, won ? 'win' : 'loss');
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
      ${this.game.rangeUI ? '<button class="range">HERO RANGE · SPAR ARENA</button>' : ''}
      <button class="set">SETTINGS</button><button class="quit">QUIT TO MENU</button></div>
      <p class="tips">Click the game to capture the mouse · Esc pauses</p></div>`);
    (this.root.querySelector('.res') as HTMLElement).onclick = () => { this.close(); this.game.setPaused(false); };
    const sw = this.root.querySelector<HTMLElement>('.swap'); if (sw) sw.onclick = () => this.heroSelect(true);
    const rg = this.root.querySelector<HTMLElement>('.range'); if (rg) rg.onclick = () => { this.close(); this.game.openConsole(); };
    (this.root.querySelector('.set') as HTMLElement).onclick = () => this.settings(() => this.pause());
    (this.root.querySelector('.quit') as HTMLElement).onclick = () => { this.abandon(); this.game.stop(); if (this.online.session?.phase === 'idle' && this.online.session.online) this.online.open(); else this.title(); };
  }

  results() {
    if (this.online.results()) return;
    const w = this.game.match?.world, me = this.game.match?.player;
    if (FULL && w && me && this.queue) return this.queueResults();
    const S = w?.stadium;
    const rec = w && me ? recordCareerMatch(this.game, w.winner === me.team ? 'win' : 'loss') : recordCareerMatch(this.game, 'none');
    // Stadium: the round score and what you built
    const stadium = S ? `<p class="sres">STADIUM · ${S.wins.zenith} - ${S.wins.umbra} in rounds${me ? ` · ${me.items.length} items, ${me.powers.length} powers` : ''}</p>` : '';
    this.show(`<div class="pause results"><h2 class="${w?.winner}">${w?.winner === 'zenith' ? 'ZENITH VANGUARD' : 'UMBRA SYNDICATE'} WINS</h2>${stadium}
      ${progressHtml(rec, emblem)}
      <div class="btns"><button class="primary again">PLAY AGAIN</button><button class="hero">CHANGE HERO</button><button class="quit">MAIN MENU</button></div></div>`);
    (this.root.querySelector('.again') as HTMLElement).onclick = () => this.launch();
    (this.root.querySelector('.hero') as HTMLElement).onclick = () => { this.game.stop(); this.heroSelect(); };   // keeps Normal / Stadium
    (this.root.querySelector('.quit') as HTMLElement).onclick = () => { this.game.stop(); this.title(); };
  }

  /** Quick Play / Competitive / AI Quick Match end screen: result, score, your numbers, and (Competitive) the rank change */
  private queueResults() {
    const w = this.game.match!.world, me = this.game.match!.player!, q = this.queue!;
    const us = me.team, them = us === 'zenith' ? 'umbra' : 'zenith', won = w.winner === us;
    const score = w.rules === 'push' ? `${Math.round(w.push.best[us])}m - ${Math.round(w.push.best[them])}m` : `${w.control.wins[us]} - ${w.control.wins[them]}`;
    const close = w.rules === 'push' ? w.time > w.timeLimit || Math.abs(w.push.best.zenith - w.push.best.umbra) < 10 : w.control.round >= 3 || w.control.overtime;
    const c = loadCareer();
    let rankHtml = '';
    if (q === 'competitive' && this.role !== 'flex') {
      const r = this.role as RankRole;
      const ch = applyCompetitive(c.roles[r], won, this.opp, close);
      this.lastChange = ch;
      c.roles[r] = ch.after;
      c.best[r] = Math.max(c.best[r] ?? 0, ch.after.rating);
      const b = rankOf(ch.before.rating, ch.before.games), a = rankOf(ch.after.rating, ch.after.games);
      const pctDelta = ch.delta;
      c.history.push({ at: Date.now(), mode: 'competitive', role: r, map: w.map.id, hero: me.baseDef.id, won, delta: pctDelta, mods: ch.mods, score });
      rankHtml = `<div class="rankup ${ch.promoted ? 'up' : ch.demoted ? 'down' : ''}">
        <div class="from">${emblem(ch.before.rating, ch.before.games, 64)}<span>${b.label}</span></div>
        <div class="mid"><div class="pbar big"><i class="old" style="width:${a.placed ? (ch.promoted ? 0 : Math.min(a.pct, b.pct)) : 0}%"></i><i class="new ${pctDelta >= 0 ? 'gain' : 'loss'}" style="left:${a.placed ? Math.min(a.pct, ch.promoted ? 0 : b.pct) : 0}%;width:${a.placed ? Math.abs(ch.promoted || ch.demoted ? a.pct : a.pct - b.pct) : 0}%"></i></div>
          <b class="dl ${pctDelta >= 0 ? 'gain' : 'loss'}">${ch.placedNow ? 'RANK REVEALED' : a.placed ? `${pctDelta >= 0 ? '+' : ''}${pctDelta}%` : `PLACEMENT ${ch.after.games}/${PLACEMENTS}`}</b>
          <div class="mods">${ch.mods.map(m => `<span>${m}</span>`).join('')}</div>
          ${ch.promoted ? `<p class="bn">PROMOTED TO ${a.label.toUpperCase()}</p>` : ch.demoted ? `<p class="bn">DEMOTED TO ${a.label.toUpperCase()}</p>` : ''}</div>
        <div class="to">${emblem(ch.after.rating, ch.after.games, 80)}<span style="color:${a.placed ? TIER_COLOR[a.tier] : '#aab'}">${a.label}</span></div></div>`;
    } else if (q === 'quickplay') {
      applyQuickPlay(c, won, this.opp);
      c.history.push({ at: Date.now(), mode: 'quickplay', map: w.map.id, hero: me.baseDef.id, won, score });
      rankHtml = `<p class="qp">Quick Play record ${c.qp.wins}W - ${c.qp.games - c.qp.wins}L</p>`;
    }
    if (q !== 'practice') saveCareer(c);
    const rec = recordCareerMatch(this.game, won ? 'win' : 'loss', this.opp, r => c.roles[r].rating);
    const acc = me.shots ? Math.round(me.hits / me.shots * 100) : 0;
    this.show(`<div class="pause results queue-res"><h2 class="${won ? 'win' : 'loss'}">${won ? 'VICTORY' : 'DEFEAT'}</h2>
      <p class="sres">${QUEUE_NAME[q]} · ${w.map.name} · ${w.rules === 'push' ? 'MIKOSHI RUSH' : 'CONTROL'} · ${score}</p>
      <div class="mystats"><div><b>${me.kills + me.assists}</b><small>ELIMINATIONS</small></div><div><b>${me.deaths}</b><small>DEATHS</small></div><div><b>${Math.round(me.dmgDone).toLocaleString('en-US')}</b><small>DAMAGE</small></div>
        <div><b>${Math.round(me.healDone).toLocaleString('en-US')}</b><small>HEALING</small></div><div><b>${Math.round(me.mitigated).toLocaleString('en-US')}</b><small>MITIGATED</small></div><div><b>${acc}%</b><small>ACCURACY</small></div></div>
      ${rankHtml}${progressHtml(rec, emblem)}
      <div class="btns"><button class="primary again">${q === 'practice' ? 'PLAY AGAIN' : 'QUEUE AGAIN'}</button><button class="hero">CHANGE HERO</button><button class="quit">MAIN MENU</button></div></div>`);
    (this.root.querySelector('.again') as HTMLElement).onclick = () => { this.game.stop(); if (q === 'practice') this.launchPractice(); else this.findMatch(); };
    (this.root.querySelector('.hero') as HTMLElement).onclick = () => { this.game.stop(); this.heroSelect(); };
    (this.root.querySelector('.quit') as HTMLElement).onclick = () => { this.game.stop(); this.title(); };
  }
  private launchPractice() {
    if (this.mapChoice === 'random') this.map = PLAY_MAPS[Math.floor(Math.random() * PLAY_MAPS.length)].id;
    this.launch();
  }

  settings(back: () => void) {
    this.root.style.display = '';
    const g = this.game;
    new SettingsScreen(this.root, { settings: g.settings, applySettings: s => g.applySettings(s), captureInput: fn => { g.input.capture = fn; } }, back).open();
  }

}
