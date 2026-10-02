// CAREER PROFILE (desktop edition), laid out after Overwatch 2's: OVERVIEW (time played, time per mode and role, Top
// Heroes with the Hero Comparison dropdown), STATISTICS (Total / Avg per 10 min / Best tables for a mode and a hero),
// HERO RATINGS (Season 18's Hero Skill Rating per hero, per ranked queue), PROGRESSION (hero levels) and HISTORY.
import './career.css';
import { HERO, rosterFor } from '../data/heroes';
import { FULL } from '../edition';
import { BASE } from '../render/Assets';
import { mapFor } from '../data/maps';
import { loadCareer, rankOf, type RankRole } from '../game/ranks';
import * as C from '../game/career';

export interface CareerOpts { back: () => void; emblem: (rating: number, games: number, size?: number) => string; name: string }
type Tab = 'overview' | 'stats' | 'ratings' | 'progress' | 'history';
const ui: { tab: Tab; mode: C.CareerMode | 'all'; hero: string; compare: C.CompareKey; queue: C.RankedMode } = { tab: 'overview', mode: 'all', hero: 'all', compare: 'time', queue: 'online-comp' };
const TABS: [Tab, string][] = [['overview', 'OVERVIEW'], ['stats', 'STATISTICS'], ['ratings', 'HERO RATINGS'], ['progress', 'PROGRESSION'], ['history', 'HISTORY']];
const ROLE_LABEL: Record<string, string> = { tank: 'Tank', dps: 'Damage', support: 'Support' };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const nm = (id: string) => esc(HERO[id]?.name ?? id);
const col = (id: string) => HERO[id]?.color ?? '#cfd6f5';
const img = (id: string, size: number, cls = '') => `<img class="${cls}" src="${BASE}img/portrait_${id}.webp" style="width:${size}px;height:${size}px" onerror="this.style.visibility='hidden'">`;
const int = (v: number) => Math.round(v).toLocaleString('en-US');
const pct = (v: number) => `${v.toFixed(1)}%`;
const avg = (l: C.HeroLine, v: number) => { const x = C.per10(l, v); return l.time ? (x < 10 ? x.toFixed(1) : int(x)) : '-'; };
const label = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());

function fmtCompare(k: C.CompareKey, v: number) {
  if (k === 'time') return C.fmtHours(v);
  if (k === 'winPct' || k === 'acc' || k === 'crit') return pct(v);
  if (k === 'epl') return v.toFixed(2);
  return int(v);
}
function modeSelect() {
  return `<select class="cmode"><option value="all">All Modes</option>${C.CAREER_MODES.map(m => `<option value="${m}" ${ui.mode === m ? 'selected' : ''}>${C.MODE_LABEL[m]}</option>`).join('')}</select>`;
}
function table(head: string[], rows: (string | number)[][]) {
  return `<table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
}

export function showCareer(root: HTMLElement, o: CareerOpts): void {
  const render = () => {
    const p = C.loadProfile(), c = loadCareer(), all = C.line(p, 'all', 'all');
    const chips = (['tank', 'damage', 'support'] as RankRole[]).map(r => { const rr = c.online[r]; return `<span class="chip" title="Online Competitive">${o.emblem(rr.rating, rr.games, 34)}<small>${r.toUpperCase()}<br>${rankOf(rr.rating, rr.games).label}</small></span>`; }).join('');
    let body = '';
    if (ui.tab === 'overview') body = overview(p, o);
    else if (ui.tab === 'stats') body = stats(p, o);
    else if (ui.tab === 'ratings') body = ratings(p, o);
    else if (ui.tab === 'progress') body = progression(p);
    else body = history(p);
    root.innerHTML = `<div class="cp">
      <div class="head"><div class="medal"><b>${C.playerLevel(p)}</b><small>LEVEL</small></div>
        <div class="who"><h2>${esc(o.name || 'Vanguard')}</h2><span>${C.fmtHours(all.time)} played · ${C.plural(all.wins, 'game')} won · ${C.plural(C.heroesPlayed(p, 'all').length, 'hero', 'heroes')}</span></div>
        <div class="chips">${chips}</div></div>
      <div class="tabs">${TABS.map(([t, n]) => `<button class="tab ${ui.tab === t ? 'on' : ''}" data-tab="${t}">${n}</button>`).join('')}</div>
      <div class="body">${body}</div>
      <div class="bar"><button class="back">BACK</button></div></div>`;
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => b.onclick = () => { ui.tab = b.dataset.tab as Tab; render(); });
    const ms = root.querySelector<HTMLSelectElement>('select.cmode'); if (ms) ms.onchange = () => { ui.mode = ms.value as C.CareerMode | 'all'; render(); };
    const hs = root.querySelector<HTMLSelectElement>('select.chero'); if (hs) hs.onchange = () => { ui.hero = hs.value; render(); };
    const cs = root.querySelector<HTMLSelectElement>('select.cmp'); if (cs) cs.onchange = () => { ui.compare = cs.value as C.CompareKey; render(); };
    root.querySelectorAll<HTMLElement>('[data-q]').forEach(b => b.onclick = () => { ui.queue = b.dataset.q as C.RankedMode; render(); });
    root.querySelectorAll<HTMLElement>('[data-hero]').forEach(b => b.onclick = () => { ui.hero = b.dataset.hero!; ui.tab = 'stats'; render(); });
    root.querySelector<HTMLElement>('.back')!.onclick = () => o.back();
  };
  render();
}

function overview(p: C.Profile, o: CareerOpts) {
  const l = C.line(p, ui.mode, 'all');
  if (!l.time && !l.games) return `<div class="filters">${modeSelect()}</div><p class="empty">No matches recorded yet - play any mode and your career fills in.</p>`;
  const modes = C.timeByMode(p), maxM = modes[0]?.time || 1;
  const roles = C.byRole(p, ui.mode);
  const top = C.topHeroes(p, ui.mode, ui.compare), max = top[0]?.value || 1;
  return `<div class="filters">${modeSelect()}</div>
    <div class="strip">${[['TIME PLAYED', C.fmtTime(l.time)], ['GAMES WON', int(l.wins)], ['WIN %', pct(C.winPct(l))], ['ELIMINATIONS', int(l.elims)], ['DEATHS', int(l.deaths)], ['WEAPON ACCURACY', pct(C.accuracy(l))]].map(([k, v]) => `<div><b>${v}</b><small>${k}</small></div>`).join('')}</div>
    <div class="cols">
      <div><h3>TIME PLAYED BY MODE</h3>${modes.map(m => `<div class="mbar"><span>${C.MODE_LABEL[m.mode]}</span><i><u style="width:${(m.time / maxM * 100).toFixed(1)}%"></u></i><em>${C.fmtTime(m.time)}</em></div>`).join('')}
        <h3>ROLES</h3><div class="rolecards">${(['tank', 'damage', 'support'] as const).map(r => { const x = roles[r]; return `<div class="rc"><i class="ri ${r}"></i><b>${r.toUpperCase()}</b><span>${C.fmtHours(x.time)}</span><span>${int(x.wins)} won · ${pct(C.winPct(x))}</span></div>`; }).join('')}</div></div>
      <div><h3>TOP HEROES <select class="cmp">${(Object.keys(C.COMPARE_LABEL) as C.CompareKey[]).map(k => `<option value="${k}" ${ui.compare === k ? 'selected' : ''}>${C.COMPARE_LABEL[k]}</option>`).join('')}</select></h3>
        ${top.length ? top.map(t => `<div class="top" data-hero="${t.hero}">${img(t.hero, 44)}<div><b style="color:${col(t.hero)}">${nm(t.hero)}</b><i><u style="width:${(t.value / max * 100).toFixed(1)}%;background:${col(t.hero)}"></u></i></div><em>${fmtCompare(ui.compare, t.value)}</em></div>`).join('') : `<p class="empty">Nothing to compare yet${ui.compare === 'sr' ? ' - heroes place after 5 ranked matches' : ''}.</p>`}</div>
    </div>`;
}

function stats(p: C.Profile, o: CareerOpts) {
  const heroes = C.heroesPlayed(p, ui.mode);
  if (ui.hero !== 'all' && !heroes.includes(ui.hero)) heroes.push(ui.hero);
  const l = C.line(p, ui.mode, ui.hero);
  const heroSel = `<select class="chero"><option value="all">All Heroes</option>${heroes.map(h => `<option value="${h}" ${ui.hero === h ? 'selected' : ''}>${nm(h)}</option>`).join('')}</select>`;
  let head = '';
  if (ui.hero !== 'all') {
    const lv = C.heroLevel(p.xp[ui.hero] ?? 0);
    const sr = (q: C.RankedMode) => { const r = p.hsr[q][ui.hero]; return r && r.placed >= C.HSR_PLACEMENTS ? `<span class="sr">${o.emblem(C.hsrToRating(r.sr), 99, 30)}SR ${int(r.sr)}</span>` : `<span class="sr dim">Placements ${r?.placed ?? 0}/${C.HSR_PLACEMENTS}</span>`; };
    head = `<div class="herohead">${img(ui.hero, 80, 'big')}<div><h3 style="color:${col(ui.hero)}">${nm(ui.hero)}</h3>
      <span class="lvl" style="--b:${C.BADGE_COLOR[lv.badge]}">LEVEL ${lv.level}</span><span class="dim">${int(lv.into)} / ${int(lv.need)} XP</span></div>
      <div class="srs"><small>ONLINE COMPETITIVE</small>${sr('online-comp')}<small>COMPETITIVE VS AI</small>${sr('competitive')}</div></div>`;
  }
  const assists = Object.entries(l.hero).filter(([k]) => /assist/i.test(k));
  const cards: [string, string][] = [
    ['COMBAT', table(['', 'TOTAL', 'AVG / 10 MIN'], [
      ['Eliminations', int(l.elims), avg(l, l.elims)], ['Final Blows', int(l.finalBlows), avg(l, l.finalBlows)], ['Assists', int(l.assists), avg(l, l.assists)],
      ['Deaths', int(l.deaths), avg(l, l.deaths)], ['All Damage Done', int(l.damage), avg(l, l.damage)], ['Damage Mitigated', int(l.mitigated), avg(l, l.mitigated)],
      ['Objective Kills', int(l.objKills), avg(l, l.objKills)], ['Objective Time', C.fmtTime(l.objTime), l.time ? C.fmtTime(C.per10(l, l.objTime)) : '-'], ['Ultimates Used', int(l.ults), avg(l, l.ults)]])],
    ['ASSISTS', table(['', 'TOTAL', 'AVG / 10 MIN'], [['Healing Done', int(l.healing), avg(l, l.healing)], ...assists.map(([k, v]) => [label(k), int(v), avg(l, v)])])],
    ['BEST', table(['', 'BEST IN GAME'], [
      ['Eliminations - Most in Game', int(l.bElims)], ['Final Blows - Most in Game', int(l.bFinal)], ['All Damage Done - Most in Game', int(l.bDamage)],
      ['Healing Done - Most in Game', int(l.bHealing)], ['Damage Mitigated - Most in Game', int(l.bMitigated)], ['Objective Time - Most in Game', C.fmtTime(l.bObjTime)],
      ['Kill Streak - Best', int(l.bStreak)], ['Multikill - Best', int(l.bMulti)], ['Weapon Accuracy - Best in Game', `${l.bAcc}%`]])],
    ['GAME', table(['', 'TOTAL'], [['Time Played', C.fmtTime(l.time)], ['Games Played', int(l.games)], ['Games Won', int(l.wins)], ['Games Lost', int(l.losses)], ['Games Tied', int(l.draws)], ['Win Percentage', pct(C.winPct(l))]])],
    ['ACCURACY', table(['', 'TOTAL'], [['Weapon Accuracy', pct(C.accuracy(l))], ['Critical Hits', int(l.crits)], ['Critical Hit Accuracy', pct(C.critAccuracy(l))], ['Eliminations per Life', C.elimsPerLife(l).toFixed(2)]])],
  ];
  const own = Object.entries(l.hero).filter(([k]) => !/assist/i.test(k));
  if (ui.hero !== 'all' && own.length) cards.push(['HERO SPECIFIC', table(['', 'TOTAL', 'AVG / 10 MIN'], own.map(([k, v]) => [label(k), int(v), avg(l, v)]))]);
  return `<div class="filters">${modeSelect()}${heroSel}</div>${head}
    ${l.time || l.games ? `<div class="cards">${cards.map(([t, tb]) => `<div class="scard"><h4>${t}</h4>${tb}</div>`).join('')}</div>` : '<p class="empty">No numbers for this mode and hero yet.</p>'}`;
}

function ratings(p: C.Profile, o: CareerOpts) {
  const t = p.hsr[ui.queue];
  const roster = rosterFor(FULL);
  const group = (role: string) => roster.filter(h => h.role === role).map(h => {
    const r = t[h.id];
    if (r && r.placed >= C.HSR_PLACEMENTS) return `<div class="rcard" data-hero="${h.id}">${img(h.id, 64)}<b style="color:${h.color}">${esc(h.name)}</b><em class="srv">${int(r.sr)}</em>${o.emblem(C.hsrToRating(r.sr), 99, 40)}<small>${rankOf(C.hsrToRating(r.sr), 99).label}</small><small>${r.wins}W - ${r.losses}L · Peak ${int(r.peak)}</small></div>`;
    if (r) return `<div class="rcard" data-hero="${h.id}">${img(h.id, 64)}<b style="color:${h.color}">${esc(h.name)}</b><small>PLACEMENTS ${r.placed}/${C.HSR_PLACEMENTS}</small><span class="pips">${Array.from({ length: C.HSR_PLACEMENTS }, (_, i) => `<i class="${i < r.placed ? 'on' : ''}"></i>`).join('')}</span></div>`;
    return `<div class="rcard dim">${img(h.id, 64)}<b>${esc(h.name)}</b><small>Unplaced</small></div>`;
  }).join('');
  return `<div class="filters"><button class="${ui.queue === 'online-comp' ? 'on' : ''}" data-q="online-comp">ONLINE COMPETITIVE</button><button class="${ui.queue === 'competitive' ? 'on' : ''}" data-q="competitive">COMPETITIVE VS AI</button></div>
    <p class="note">Hero Skill Rating (0-5000) is your best-guess skill on each hero. A hero places after 5 ranked matches with at least 3 minutes on it among your 3 most-played heroes. It is never used for matchmaking.</p>
    ${['tank', 'dps', 'support'].map(r => `<h3>${ROLE_LABEL[r].toUpperCase()}</h3><div class="rgrid">${group(r)}</div>`).join('')}`;
}

function progression(p: C.Profile) {
  const roster = rosterFor(FULL);
  const top = Object.entries(p.xp).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const big = top.map(([id, xp]) => { const v = C.heroLevel(xp); const ring = v.ascended ? C.ASCEND_COLOR[v.ascended - 1] : '#445';
    return `<div class="pcard" data-hero="${id}"><div class="ring" style="--r:${ring}">${img(id, 96)}</div><b style="color:${col(id)}">${nm(id)}</b><em>LEVEL ${v.level}</em><i><u style="width:${v.pct.toFixed(1)}%"></u></i><small>${int(v.into)} / ${int(v.need)} XP</small></div>`; }).join('');
  const grid = roster.map(h => { const v = C.heroLevel(p.xp[h.id] ?? 0);
    return `<div class="pmini" data-hero="${h.id}">${img(h.id, 48)}<div><b>${esc(h.name)}</b><span><i class="dot" style="background:${C.BADGE_COLOR[v.badge]}"></i>Level ${v.level}</span><i class="xp"><u style="width:${v.pct.toFixed(1)}%"></u></i></div></div>`; }).join('');
  return `<p class="note">150 XP per minute played. Badge tiers at levels 1 / 25 / 50 / 75 / 100, ascended portraits at 20 / 40 / 60 / 80.</p>
    <h3>TOP HEROES BY LEVEL</h3>${big ? `<div class="pbig">${big}</div>` : '<p class="empty">Play any mode to level your heroes.</p>'}
    <h3>ALL HEROES</h3><div class="pgrid">${grid}</div>`;
}

function history(p: C.Profile) {
  const rows = [...p.matches].reverse().slice(0, 40);
  const res = (r: C.Result) => r === 'win' ? '<b class="w">VICTORY</b>' : r === 'loss' ? '<b class="l">DEFEAT</b>' : r === 'draw' ? '<b>DRAW</b>' : '<span class="dim">-</span>';
  return `<table class="hist2"><tr><th>Date</th><th>Mode</th><th>Map</th><th>Hero</th><th>Result</th><th>Length</th><th>E / D</th><th>Damage</th><th>Healing</th><th>Acc</th><th>Hero SR</th></tr>
    ${rows.map(m => { const d = new Date(m.at);
      return `<tr><td>${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td>${C.MODE_LABEL[m.mode] ?? m.mode}</td><td>${esc(mapFor(m.map, FULL)?.name ?? m.map)}</td>
        <td class="h">${img(m.hero, 28)}${nm(m.hero)}</td><td>${res(m.result)}</td><td>${C.fmtTime(m.secs)}</td><td>${m.elims} / ${m.deaths}</td><td>${int(m.damage)}</td><td>${int(m.healing)}</td><td>${m.acc}%</td>
        <td>${m.sr !== undefined ? `${int(m.sr)} <em class="${(m.srDelta ?? 0) >= 0 ? 'gain' : 'loss'}">${(m.srDelta ?? 0) >= 0 ? '+' : ''}${m.srDelta ?? 0}</em>` : '-'}</td></tr>`; }).join('') || '<tr><td colspan="11" class="empty">No matches yet - queue up.</td></tr>'}</table>`;
}
