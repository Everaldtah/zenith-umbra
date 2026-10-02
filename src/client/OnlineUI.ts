// PLAY ONLINE (desktop edition): the online lobby, matchmaking, the one-minute assemble screen (hero select while the
// match stays open for anyone else who queues), custom games, and the end-of-match screen for online matches.
import './online.css';
import { HERO, type HeroDef } from '../data/heroes';
import { mapsFor, mapFor } from '../data/maps';
import { FULL } from '../edition';
import { BASE } from '../render/Assets';
import { sfx } from '../audio/Sfx';
import { OnlineSession, heroPool, type OnlineStart, type Seat, type SeatRole } from '../net/Online';
import { TIER } from '../net/quality';
import { loadCareer, saveCareer, rankOf, applyCompetitive, applyQuickPlay, skillFor, TIER_COLOR, PLACEMENTS, type RankRole } from '../game/ranks';
import { loadProfile, saveProfile, recordMatch, profileCard, playerLevel, heroLevel, HSR_PLACEMENTS, hsrToRating, MODE_LABEL, type CareerMode, type RecordResult } from '../game/career';
import type { Game } from './Game';

const MAPS = mapsFor(FULL);
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const ROLE_NAME: Record<string, string> = { tank: 'TANK', damage: 'DAMAGE', support: 'SUPPORT', flex: 'FLEX' };
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

export interface OnlineHost {
  root: HTMLElement; game: Game;
  show(html: string): void; close(): void; title(): void;
  emblem(rating: number, games: number, size?: number): string;
  name(): string;
}

export class OnlineUI {
  session: OnlineSession | null = null;
  /** the online match being played (for the results screen) */
  ctx: { st: OnlineStart; career: CareerMode; role: SeatRole; opp: number; myTeam: string } | null = null;
  private timer = 0;
  private notice = '';
  private lastQ: { q: 'qp' | 'comp'; role: SeatRole } = { q: 'qp', role: 'flex' };
  private testing = '';
  constructor(public h: OnlineHost) {}

  private sess(): OnlineSession {
    if (this.session) return this.session;
    const s = this.session = new OnlineSession(this.h.name() || 'Vanguard', MAPS.map(m => m.id), () => {
      const c = loadCareer(), p = loadProfile();
      const best = (['tank', 'damage', 'support'] as RankRole[]).map(r => c.online[r]).filter(r => r.games >= PLACEMENTS).sort((a, b) => b.rating - a.rating)[0];
      return { card: profileCard(p, Object.fromEntries((['tank', 'damage', 'support'] as RankRole[]).map(r => [r, rankOf(c.online[r].rating, c.online[r].games).label]))), lvl: playerLevel(p), rank: best ? rankOf(best.rating).label : '' };
    });
    s.onChange = () => this.refresh();
    s.onNotice = t => { this.notice = t; sfx.play('announce'); this.refresh(); };
    s.onStart = st => this.launch(st);
    if (!s.speed) this.test();
    return s;
  }
  private refresh() {
    const s = this.session; if (!s || this.h.game.running) return;
    if (s.phase === 'queue') this.queueScreen();
    else if (s.phase === 'assemble') this.assemble();
    else if (s.phase === 'idle' && this.h.root.querySelector('.online')) this.lobby();
  }
  private async test() {
    const s = this.sess();
    this.testing = 'ping';
    this.refresh();
    try { await s.test(step => { this.testing = step; this.refresh(); }); } finally { this.testing = ''; this.refresh(); }
  }

  // ---------------------------------------------------------------- the online lobby
  open() { this.sess(); this.notice = ''; this.lobby(); }
  lobby() {
    const s = this.sess(), c = loadCareer(), sp = s.speed;
    clearInterval(this.timer);
    const roleCard = (r: RankRole) => { const rr = c.online[r]; return `<div class="orole" data-r="${r}"><i class="ri ${r}"></i><b>${ROLE_NAME[r]}</b>${this.h.emblem(rr.rating, rr.games, 46)}<small>${rankOf(rr.rating, rr.games).label}</small></div>`; };
    const conn = sp ? `<div class="conn"><b style="color:${TIER[sp.tier].color}">${TIER[sp.tier].label}</b><span>${sp.rtt} ms ping · ${sp.jitter} ms jitter</span>
      <span>${(sp.downKbps / 1000).toFixed(1)} Mbps down · ${(sp.upKbps / 1000).toFixed(1)} Mbps up</span><span>up to ${TIER[sp.tier].snapHz} updates/s · host score ${sp.score}</span></div>` : '<div class="conn"><span>Connection not tested yet</span></div>';
    const others = s.players.filter(p => p.platform === 'desktop' || p.status !== 'squad');
    this.h.show(`<div class="modes online">
      <h2>PLAY ONLINE <small>Real players who have ZENITH//UMBRA installed, linked peer-to-peer through the online node. Two players are enough for a match - AI fills every empty seat, and every extra player replaces a bot.</small></h2>
      <div class="ostat"><span class="${s.online ? 'ok' : 'bad'}">● ${s.online ? 'ONLINE' : 'CONNECTING...'}</span><span>${others.length + 1} player${others.length ? 's' : ''} online</span>
        <label>NAME <input class="nm" maxlength="20" value="${esc(s.name)}"></label>
        ${conn}<button class="test">${this.testing ? `TESTING ${this.testing.toUpperCase()}...` : 'TEST CONNECTION'}</button></div>
      ${this.notice ? `<p class="onotice">${esc(this.notice)}</p>` : ''}
      <div class="ogrid">
        <div class="ocard"><h3>ONLINE QUICK PLAY</h3><p>Unranked, role queue. Pick a role or flex.</p>
          <div class="oroles">${(['tank', 'damage', 'support', 'flex'] as SeatRole[]).map(r => `<button data-qp="${r}"><i class="ri ${r}"></i>${ROLE_NAME[r]}</button>`).join('')}</div>
          <small>Quick Play record ${c.oqp.wins}W - ${c.oqp.games - c.oqp.wins}L</small></div>
        <div class="ocard"><h3>ONLINE COMPETITIVE</h3><p>Ranked, one rank per role (${PLACEMENTS} placement matches) and a Hero Skill Rating for every hero.</p>
          <div class="oroles">${(['tank', 'damage', 'support'] as RankRole[]).map(roleCard).join('')}</div></div>
        <div class="ocard"><h3>CUSTOM GAME</h3><p>Host a lobby on any map, or join one.</p>
          <div class="row2"><select class="cmap">${MAPS.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select><button class="hostc">HOST</button></div>
          <ul class="clist">${s.customGames().map(p => `<li><span>${esc(p.info ?? p.name)}</span><button data-j="${esc(p.id)}">JOIN</button></li>`).join('') || '<li class="dim">No open custom games.</li>'}</ul></div>
      </div>
      <h3>PLAYERS ONLINE</h3>
      <ul class="plist"><li class="me"><b>${esc(s.name)}</b><span>you</span></li>${others.slice(0, 40).map(p => `<li><b>${esc(p.name)}</b><span>${p.lvl ? `Lv ${p.lvl}` : ''}${p.rank ? ` · ${esc(p.rank)}` : ''}</span><span class="st">${{ lobby: 'in menus', squad: 'campaign squad', playing: 'in a match', queue: 'searching', custom: 'hosting a game', online: 'in a match' }[p.status] ?? ''}${p.ping ? ` · ${p.ping} ms` : ''}</span></li>`).join('')}</ul>
      <div class="bar"><button class="back">BACK</button></div></div>`);
    const nm = this.h.root.querySelector<HTMLInputElement>('.nm')!;
    nm.onchange = () => { const v = nm.value.trim().slice(0, 20) || 'Vanguard'; s.name = v; s.lobby.setName(v); try { localStorage.setItem('zu-name', v); } catch { /* ignore */ } };
    this.h.root.querySelector<HTMLElement>('.test')!.onclick = () => { if (!this.testing) this.test(); };
    this.h.root.querySelectorAll<HTMLElement>('[data-qp]').forEach(b => b.onclick = () => this.queue('qp', b.dataset.qp as SeatRole));
    this.h.root.querySelectorAll<HTMLElement>('.orole').forEach(b => b.onclick = () => this.queue('comp', b.dataset.r as SeatRole));
    this.h.root.querySelector<HTMLElement>('.hostc')!.onclick = () => s.hostCustom(this.h.root.querySelector<HTMLSelectElement>('.cmap')!.value);
    this.h.root.querySelectorAll<HTMLElement>('[data-j]').forEach(b => b.onclick = () => s.joinCustom(b.dataset.j!));
    this.h.root.querySelector<HTMLElement>('.back')!.onclick = () => { s.leave(true); this.h.title(); };
    // the player list and custom games refresh on their own (presence comes in every few polls)
  }

  private queue(q: 'qp' | 'comp', role: SeatRole) {
    const s = this.sess(), c = loadCareer();
    this.lastQ = { q, role };
    const mmr = q === 'comp' ? c.online[role as RankRole].mmr : c.oqp.mmr;
    this.notice = '';
    s.queue(q, role, mmr);
  }

  private queueScreen() {
    const s = this.session!;
    const draw = () => {
      const t = (Date.now() - s.queueSince) / 1000;
      const el = this.h.root.querySelector('.oq .tm'); if (el) { el.textContent = mmss(t); (this.h.root.querySelector('.oq .qn') as HTMLElement).textContent = String(Math.max(1, s.queued)); return; }
      this.h.show(`<div class="loading find oq"><h2>${s.q === 'comp' ? 'ONLINE COMPETITIVE' : 'ONLINE QUICK PLAY'} · ${ROLE_NAME[s.queueRole]}</h2>
        <p class="st">SEARCHING FOR PLAYERS <b class="tm">${mmss(t)}</b></p><p class="tips"><b class="qn">${Math.max(1, s.queued)}</b> in this queue · a match starts the moment one more player queues; for the next minute anyone else who queues joins it, and AI heroes fill every empty seat.</p>
        ${this.notice ? `<p class="onotice">${esc(this.notice)}</p>` : ''}
        <div class="bar"><button class="back">CANCEL</button></div></div>`);
      this.h.root.querySelector<HTMLElement>('.back')!.onclick = () => { s.cancelQueue(); this.lobby(); };
    };
    clearInterval(this.timer);
    draw();
    this.timer = window.setInterval(() => { if (s.phase !== 'queue' || this.h.game.running) { clearInterval(this.timer); return; } draw(); }, 250);
  }

  // ---------------------------------------------------------------- assemble (hero select)
  private assemble() {
    const s = this.session!;
    clearInterval(this.timer);
    const me = s.mySeat, m = mapFor(s.map || MAPS[0].id, FULL);
    const seatRow = (x: Seat) => {
      const d = x.hero ? HERO[x.hero] : null;
      return `<li class="${x.id === s.me ? 'me' : ''}" style="--c:${d?.color ?? '#556'}">${d ? `<img src="${BASE}img/portrait_${d.id}.webp" onerror="this.style.visibility='hidden'">` : '<i class="q">?</i>'}
        <div><b>${esc(x.name)}${x.id === s.hostId ? ' <em>HOST</em>' : ''}</b><small><i class="ri ${x.role}"></i>${ROLE_NAME[x.role]} · ${d ? esc(d.name) : 'choosing...'}</small></div>
        <span class="lk ${x.id === s.me || x.id === s.hostId ? '' : x.link ?? 'connecting'}">${x.id === s.hostId ? '' : x.id === s.me ? 'you' : x.link === 'p2p' ? `${x.ping ?? '-'} ms · P2P` : x.link === 'relay' ? `${x.ping ?? '-'} ms · relay` : 'linking...'}</span>
        ${s.role === 'host' && s.q === 'custom' && x.id !== s.me ? `<button class="sw" data-sw="${esc(x.id)}">⇄</button>` : ''}</li>`;
    };
    const team = (t: 'zenith' | 'umbra') => {
      const xs = s.seats.filter(x => x.team === t), ai = Math.max(0, 5 - xs.length);
      return `<div class="oteam ${t}"><h3 class="${t}">${t === 'zenith' ? 'ZENITH VANGUARD' : 'UMBRA SYNDICATE'} <small>${xs.length} player${xs.length === 1 ? '' : 's'} · ${ai} AI</small></h3>
        <ul>${xs.map(seatRow).join('')}${Array.from({ length: ai }, () => '<li class="ai"><i class="q">AI</i><div><b>AI hero</b><small>fills the seat at the start</small></div></li>').join('')}</ul></div>`;
    };
    const pool = me ? heroPool(me.team, me.role) : [];
    const taken = new Set(s.seats.filter(x => me && x.team === me.team && x.id !== s.me).map(x => x.hero));
    const card = (d: HeroDef) => `<div class="hc ${d.team} ${me?.hero === d.id ? 'sel' : ''} ${taken.has(d.id) ? 'taken' : ''}" data-h="${d.id}" style="--c:${d.color}"><img src="${BASE}img/portrait_${d.id}.webp" onerror="this.style.visibility='hidden'"><b>${d.name}</b><small>${d.role.toUpperCase()}</small></div>`;
    const left = s.startAt ? (s.startAt - Date.now()) / 1000 : -1;
    this.h.show(`<div class="modes online asm">
      <div class="asmhead" style="background-image:linear-gradient(90deg,rgba(5,6,10,.95),rgba(5,6,10,.55)),url(${BASE}img/map_${m.id}.webp)">
        <div><h2>${s.q === 'custom' ? 'CUSTOM GAME' : s.q === 'comp' ? 'ONLINE COMPETITIVE' : 'ONLINE QUICK PLAY'} <small>${esc(m.name)} · ${m.objective === 'push' ? 'MIKOSHI RUSH' : 'CONTROL'}</small></h2>
        <p class="tips">${s.q === 'custom' ? (s.role === 'host' ? 'You host: start whenever you like - AI heroes fill the empty seats.' : 'Waiting for the host to start the game.') : 'The match stays open while the clock runs: anyone who queues now joins it. AI heroes take every seat still empty at the start.'}</p></div>
        <div class="clock">${left >= 0 ? `<small>STARTS IN</small><b class="cd">${mmss(left)}</b>` : s.role === 'host' ? '' : '<small>WAITING</small>'}</div></div>
      ${this.notice ? `<p class="onotice">${esc(this.notice)}</p>` : ''}
      <div class="teams">${team('zenith')}${team('umbra')}</div>
      ${me ? `<h3>CHOOSE YOUR HERO <small>${ROLE_NAME[me.role]} · ${me.team === 'zenith' ? 'Zenith Vanguard' : 'Umbra Syndicate'}</small></h3><div class="row opick">${pool.map(card).join('')}</div>` : '<p class="tips">Linking to the host...</p>'}
      <div class="bar">${s.role === 'host' && s.q === 'custom' ? `<label>MAP <select class="cmap">${MAPS.map(x => `<option value="${x.id}" ${x.id === s.map ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label><button class="primary go">START GAME</button>` : ''}<button class="back">LEAVE</button></div></div>`);
    this.h.root.querySelectorAll<HTMLElement>('.opick .hc').forEach(e => e.onclick = () => { if (!e.classList.contains('taken')) { s.pick(e.dataset.h!); this.assemble(); } });
    this.h.root.querySelectorAll<HTMLElement>('[data-sw]').forEach(b => b.onclick = () => s.swapTeam(b.dataset.sw!));
    const cm = this.h.root.querySelector<HTMLSelectElement>('.cmap'); if (cm) cm.onchange = () => s.setMap(cm.value);
    const go = this.h.root.querySelector<HTMLElement>('.go'); if (go) go.onclick = () => s.start();
    this.h.root.querySelector<HTMLElement>('.back')!.onclick = () => { s.leave(); this.notice = ''; this.lobby(); };
    this.timer = window.setInterval(() => {
      if (s.phase !== 'assemble' || this.h.game.running) { clearInterval(this.timer); return; }
      const el = this.h.root.querySelector('.asm .cd'); if (el && s.startAt) el.textContent = mmss((s.startAt - Date.now()) / 1000);
    }, 250);
  }

  // ---------------------------------------------------------------- the match
  private async launch(st: OnlineStart) {
    const s = this.session!, g = this.h.game;
    clearInterval(this.timer);
    const me = st.seats.find(x => x.id === s.me);
    if (!me) { this.notice = 'The match started without you (your link to the host never came up).'; s.leave(); this.lobby(); return; }
    const mode = st.q === 'comp' ? 'competitive' : 'quickplay';
    const career: CareerMode = st.q === 'comp' ? 'online-comp' : st.q === 'qp' ? 'online-qp' : 'custom';
    // the AI heroes play at the humans' average rating
    const avg = st.seats.reduce((a, x) => a + x.mmr, 0) / Math.max(1, st.seats.length);
    const enemy = st.seats.filter(x => x.team !== me.team);
    this.ctx = { st, career, role: me.role, opp: enemy.length ? enemy.reduce((a, x) => a + x.mmr, 0) / enemy.length : avg, myTeam: me.team };
    const m = mapFor(st.map, FULL);
    this.h.show(`<div class="loading"><div class="bg" style="background-image:url(${BASE}img/map_${m.id}.webp)"></div><h2>${esc(m.name)}</h2><p>${esc(m.story)}</p><div class="spin"></div>
      <p class="tips">${st.seats.length} player${st.seats.length === 1 ? '' : 's'} · ${10 - st.seats.length} AI · ${s.role === 'host' ? 'you are hosting the match' : 'linked to the host'}</p></div>`);
    sfx.play('announce');
    // a client that loses its host mid-match is sent back
    s.onNotice = t => {
      this.notice = t;
      // (once the match has a winner the results screen takes it from here, link or no link)
      if (g.running && s.role === null && this.ctx && !g.match?.world.winner) { recordCareerMatch(g, 'none'); g.stop(); this.ctx = null; this.lobby(); } else this.refresh();
    };
    await g.start({
      mode, map: st.map, hero: me.hero, skill: skillFor(avg), career,
      net: { coop: s, role: s.role === 'host' ? 'host' : 'client', slots: st.seats.map(x => ({ hero: x.hero, team: x.team, netId: x.id === s.me ? 'local' : x.id })) },
    });
    setTimeout(() => { if (g.running) this.h.close(); }, 600);
  }

  /** the end of an online match: result, your numbers, the rank / Hero Skill Rating changes */
  results(): boolean {
    const g = this.h.game, ctx = this.ctx, w = g.match?.world, me = g.match?.player;
    if (!ctx || !w) return false;
    this.ctx = null;
    const s = this.session;
    const won = !!me && w.winner === me.team;
    const close = w.rules === 'push' ? Math.abs(w.push.best.zenith - w.push.best.umbra) < 10 : w.control.round >= 3 || w.control.overtime;
    const c = loadCareer();
    let rankHtml = '';
    if (ctx.career === 'online-comp' && ctx.role !== 'flex') {
      const r = ctx.role as RankRole;
      const ch = applyCompetitive(c.online[r], won, ctx.opp, close);
      c.online[r] = ch.after; c.obest[r] = Math.max(c.obest[r] ?? 0, ch.after.rating);
      const a = rankOf(ch.after.rating, ch.after.games);
      rankHtml = `<div class="rankup ${ch.promoted ? 'up' : ch.demoted ? 'down' : ''}"><div class="to">${this.h.emblem(ch.after.rating, ch.after.games, 80)}<span style="color:${a.placed ? TIER_COLOR[a.tier] : '#aab'}">${a.label}</span></div>
        <div class="mid"><b class="dl ${ch.delta >= 0 ? 'gain' : 'loss'}">${ch.placedNow ? 'RANK REVEALED' : a.placed ? `${ch.delta >= 0 ? '+' : ''}${ch.delta}%` : `PLACEMENT ${ch.after.games}/${PLACEMENTS}`}</b><div class="mods">${ch.mods.map(x => `<span>${x}</span>`).join('')}</div></div></div>`;
      c.history.push({ at: Date.now(), mode: 'online-comp', role: r, map: w.map.id, hero: me?.baseDef.id ?? '', won, delta: ch.delta, mods: ch.mods, score: '' });
    } else if (ctx.career === 'online-qp') {
      applyQuickPlay(c, won, ctx.opp, true);
      c.history.push({ at: Date.now(), mode: 'online-qp', map: w.map.id, hero: me?.baseDef.id ?? '', won, score: '' });
      rankHtml = `<p class="qp">Online Quick Play record ${c.oqp.wins}W - ${c.oqp.games - c.oqp.wins}L</p>`;
    }
    if (ctx.career !== 'custom') saveCareer(c);
    const rec = recordCareerMatch(g, won ? 'win' : 'loss', ctx.opp, r => c.online[r].rating);
    const acc = me && me.shots ? Math.round(me.hits / me.shots * 100) : 0;
    this.h.show(`<div class="pause results queue-res"><h2 class="${won ? 'win' : 'loss'}">${won ? 'VICTORY' : 'DEFEAT'}</h2>
      <p class="sres">${MODE_LABEL[ctx.career].toUpperCase()} · ${esc(w.map.name)} · ${ctx.st.seats.length} players + ${10 - ctx.st.seats.length} AI</p>
      ${me ? `<div class="mystats"><div><b>${me.kills + me.assists}</b><small>ELIMINATIONS</small></div><div><b>${me.deaths}</b><small>DEATHS</small></div><div><b>${Math.round(me.dmgDone).toLocaleString('en-US')}</b><small>DAMAGE</small></div>
        <div><b>${Math.round(me.healDone).toLocaleString('en-US')}</b><small>HEALING</small></div><div><b>${Math.round(me.mitigated).toLocaleString('en-US')}</b><small>MITIGATED</small></div><div><b>${acc}%</b><small>ACCURACY</small></div></div>` : ''}
      ${rankHtml}${progressHtml(rec, this.h.emblem)}
      <div class="btns">${ctx.career !== 'custom' ? '<button class="primary again">QUEUE AGAIN</button>' : ''}<button class="lob">ONLINE LOBBY</button><button class="quit">MAIN MENU</button></div></div>`);
    // the host keeps the links up a moment so every client gets the final state before they close
    if (s?.role === 'host') window.setTimeout(() => { if (s.phase === 'playing') s.finish(); }, 4000); else s?.finish();
    const again = this.h.root.querySelector<HTMLElement>('.again');
    if (again) again.onclick = () => { g.stop(); this.queue(this.lastQ.q === 'comp' || ctx.career === 'online-comp' ? 'comp' : 'qp', ctx.role); };
    this.h.root.querySelector<HTMLElement>('.lob')!.onclick = () => { g.stop(); this.notice = ''; this.lobby(); };
    this.h.root.querySelector<HTMLElement>('.quit')!.onclick = () => { g.stop(); s?.leave(true); this.h.title(); };
    return true;
  }
}

/** file the finished match in the Career Profile (once) - every mode goes through here */
export function recordCareerMatch(g: Game, result: 'win' | 'loss' | 'draw' | 'none', opp?: number, roleRating?: (r: RankRole) => number): RecordResult | null {
  const t = g.career, w = g.match?.world; if (!t || !w) return null;
  g.career = null;
  const sum = t.finish(w, g.match?.player ?? null, result, { opp });
  if (!sum.heroes.length) return null;
  const p = loadProfile();
  const res = recordMatch(p, sum, hero => { const r = HERO[hero]?.role; return roleRating && r ? roleRating(r === 'dps' ? 'damage' : r) : 1800; });
  saveProfile(p);
  return res;
}
/** hero level-ups and Hero Skill Rating changes for the results screens */
export function progressHtml(rec: RecordResult | null, emblem: OnlineHost['emblem']): string {
  if (!rec) return '';
  const lv = rec.levels.filter(l => l.xp > 0).map(l => { const d = HERO[l.hero]; const v = heroLevel(loadProfile().xp[l.hero] ?? 0);
    return `<div class="lvup"><img src="${BASE}img/portrait_${l.hero}.webp" onerror="this.style.visibility='hidden'"><b style="color:${d?.color ?? '#fff'}">${esc(d?.name ?? l.hero)}</b><span>${l.to > l.from ? `LEVEL UP ${l.from} → ${l.to}` : `Level ${l.to}`} · +${l.xp} XP</span><i><u style="width:${v.pct.toFixed(0)}%"></u></i></div>`; }).join('');
  const sr = rec.hsr.filter(h => h.qualified || h.after.placed >= HSR_PLACEMENTS).map(h => { const d = HERO[h.hero]; const placed = h.after.placed >= HSR_PLACEMENTS;
    return `<div class="srch">${placed ? emblem(hsrToRating(h.after.sr), 99, 34) : ''}<b style="color:${d?.color ?? '#fff'}">${esc(d?.name ?? h.hero)}</b><span>${placed ? `HERO SR ${h.after.sr.toLocaleString('en-US')} <em class="${h.delta >= 0 ? 'gain' : 'loss'}">${h.delta >= 0 ? '+' : ''}${h.delta}</em>${h.placedNow ? ' · PLACED' : ''}` : `HERO PLACEMENT ${h.after.placed}/${HSR_PLACEMENTS}`}</span></div>`; }).join('');
  return lv || sr ? `<div class="progress">${sr ? `<div class="srs">${sr}</div>` : ''}${lv ? `<div class="lvs">${lv}</div>` : ''}</div>` : '';
}
