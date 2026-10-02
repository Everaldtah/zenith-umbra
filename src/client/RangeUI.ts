// Training Grounds UI (desktop edition): the console (G, or the consoles by the Hero Range and the Spar Arena) with its
// two stations, the Hero Range damage meter, and the spar scoreboard / countdown.
import './range.css';
import { HERO, rosterFor } from '../data/heroes';
import { FULL } from '../edition';
import { BASE } from '../render/Assets';
import { LANE, SKILLS, type HeroRange, type RangeOpts, type Tally } from '../game/herorange';
import { ARENA, SPAR_CONSOLE, SPAR_SKILL, type Spar, type SparDiff, type SparOpts } from '../game/spar';
import type { Actor } from '../game/Actor';

const el = (cls: string, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; return d; };
const n0 = (x: number) => Math.round(x).toLocaleString('en-US');
const secs = (x: number | null | undefined) => x === null || x === undefined ? '—' : `${x.toFixed(2)} s`;
const DIFF_NAME: Record<SparDiff, string> = { easy: 'EASY', medium: 'MEDIUM', hard: 'HARD' };
export type ConsoleTab = 'range' | 'spar';
/** how close you must stand to a console for the prompt */
const NEAR = 3.2;

export class RangeUI {
  meter = el('rg-meter');
  sparHud = el('rg-spar');
  count = el('rg-count');
  prompt = el('rg-prompt');
  panel: HTMLElement | null = null;
  tab: ConsoleTab = 'range';
  private at = 0;
  private draft: { range: RangeOpts; spar: SparOpts };
  private onKey = (e: KeyboardEvent) => { if (this.panel && (e.code === 'Escape' || e.code === 'KeyG')) { e.preventDefault(); e.stopPropagation(); this.close(); } };

  constructor(public host: HTMLElement, public range: HeroRange, public spar: Spar | undefined, private resume: () => void) {
    this.draft = { range: { ...range.opts }, spar: { ...(spar?.opts ?? { hero: 'kagemaru', diff: 'medium', firstTo: 2 }) } };
    host.append(this.meter, this.sparHud, this.count, this.prompt);
    addEventListener('keydown', this.onKey, true);
  }

  get open() { return !!this.panel; }

  dispose() {
    removeEventListener('keydown', this.onKey, true);
    this.panel?.remove(); this.panel = null;
    for (const e of [this.meter, this.sparHud, this.count, this.prompt]) e.remove();
  }

  /** which station you're standing at (the console opens on that tab) */
  nearest(me: Actor | null): ConsoleTab | null {
    if (!me) return null;
    if (Math.hypot(me.pos.x - LANE.console.x, me.pos.z - LANE.console.z) < NEAR) return 'range';
    if (Math.hypot(me.pos.x - SPAR_CONSOLE.x, me.pos.z - SPAR_CONSOLE.z) < NEAR) return 'spar';
    return null;
  }

  // ------------------------------------------------------------------ per frame
  update(me: Actor | null, time: number) {
    // the countdown is big and centred - every frame; the panels ~8 times a second
    const s = this.spar, foe = s?.foe?.baseDef.name.toUpperCase() ?? '';
    const big = (html: string, cls = '') => { if (this.count.innerHTML !== html) this.count.innerHTML = html; this.count.className = 'rg-count on ' + cls; };
    if (s && s.phase === 'countdown') big(String(Math.ceil(s.left)));
    else if (s && s.phase === 'fight' && time - s.phaseAt < 0.8) big('FIGHT!', 'fight');
    else if (s && s.phase === 'roundover' && time - s.phaseAt < 2.2) big(s.roundWinner === 'draw' ? `ROUND ${s.round}<small>DRAW</small>` : s.roundWinner === 'you' ? `ROUND ${s.round}<small>YOU WIN</small>` : `ROUND ${s.round}<small>${foe} WINS</small>`, 'msg ' + (s.roundWinner === 'you' ? 'win' : s.roundWinner === 'draw' ? '' : 'lose'));
    else if (s && s.phase === 'done') { const won = s.wins.you > s.wins.them; big(`${won ? 'VICTORY' : 'DEFEAT'}<small>${won ? 'YOU WIN' : foe + ' WINS'} THE SPAR ${Math.max(s.wins.you, s.wins.them)} - ${Math.min(s.wins.you, s.wins.them)}</small>`, 'msg ' + (won ? 'win' : 'lose')); }
    else this.count.className = 'rg-count';
    if (performance.now() - this.at < 120) return;
    this.at = performance.now();
    this.drawMeter(me, time);
    this.drawSpar(me);
    const near = this.nearest(me);
    const sp = s && s.phase === 'waiting' && s.foe && me && Math.abs(me.pos.z - (ARENA.z - ARENA.hz)) < 6 && Math.abs(me.pos.x - ARENA.x) < ARENA.hx + 2 && !s.inside(me.pos);
    const txt = this.panel ? '' : near === 'range' ? '<kbd>G</kbd> HERO RANGE CONSOLE' : near === 'spar' ? '<kbd>G</kbd> SPAR CONSOLE'
      : sp ? `SPAR ARMED · ${s!.foe!.baseDef.name.toUpperCase()} (${DIFF_NAME[s!.opts.diff]}) · walk in to start - the box seals until someone wins`
      : s && s.phase === 'waiting' && s.needExit && me && s.inside(me.pos) ? 'step out and back in for a rematch' : '';
    this.prompt.innerHTML = txt; this.prompt.className = 'rg-prompt' + (txt ? ' on' : '');
  }

  private bar(a: Actor) {
    const max = a.maxHp + Math.max(0, a.shieldAmt), w = (x: number) => `${Math.max(0, x) / max * 100}%`;
    return `<div class="hpb"><i class="h" style="width:${w(a.hp)}"></i><i class="a" style="width:${w(a.armor)}"></i><i class="s" style="width:${w(a.shieldAmt)}"></i></div>
      <div class="hpn">${a.alive ? `${n0(a.health + a.shieldAmt)} <small>/ ${n0(a.maxHp)}${a.def.armor ? ` · ${n0(a.armor)} armor` : ''}${a.shieldAmt > 0.5 ? ` · ${n0(a.shieldAmt)} shield` : ''}${a.barrier.up ? ` · barrier ${n0(a.barrier.hp)}` : ''}</small>` : '<b class="down">DOWN</b> <small>back in a moment</small>'}</div>`;
  }

  private tallyRows(t: Tally, live: boolean) {
    const dps = t.dps();
    return `<tr><th>DAMAGE</th><td>${n0(t.total)}</td><th>DPS</th><td class="${live ? 'live' : ''}">${dps === null ? '—' : n0(dps)}</td></tr>
      <tr><th>HITS</th><td>${t.hits}</td><th>CRITS</th><td>${t.crits}${t.hits ? ` <small>${Math.round(t.crits / t.hits * 100)}%</small>` : ''}</td></tr>
      <tr><th>LAST HIT</th><td class="${t.lastCrit ? 'crit' : ''}">${t.hits ? n0(t.last) + (t.lastCrit ? ' ✦' : '') : '—'}</td><th>BIGGEST</th><td>${t.hits ? n0(t.max) : '—'}</td></tr>`;
  }

  private drawMeter(me: Actor | null, time: number) {
    const r = this.range, a = r.bot;
    if (!a || this.spar?.sealed) { this.meter.className = 'rg-meter'; return; }
    const s = r.stats, o = r.opts, d = s.dealt;
    const acc = me && me.shots - s.shots0 > 0 ? Math.round((me.hits - s.hits0) / (me.shots - s.shots0) * 100) : null;
    this.meter.className = 'rg-meter on';
    this.meter.style.setProperty('--c', a.baseDef.color);
    this.meter.innerHTML = `<h4><img src="${BASE}img/portrait_${a.baseDef.id}.webp" onerror="this.remove()"><span><b>${a.baseDef.name}</b>
      <small class="${o.mode}">${o.mode.toUpperCase()}</small> <small>${o.dist} m · ABILITIES ${o.abilities ? 'ON' : 'OFF'}${o.mode === 'defense' ? ` · ${o.move.toUpperCase()}` : ` · ${SKILLS.find(k => k[1] === o.skill)?.[0] ?? ''}`}</small></span></h4>
      ${this.bar(a)}
      <h5>YOUR DAMAGE <small>as ${me?.def.name ?? '-'}${s.lastDist ? ` · from ${s.lastDist.toFixed(1)} m` : ''}</small></h5>
      <table>${this.tallyRows(d, d.active(time))}
      <tr><th>WEAPON</th><td>${n0(d.by.weapon)}</td><th>ABILITIES</th><td>${n0(d.by.ability + d.by.dot)}</td></tr>
      <tr><th>TIME TO KILL</th><td>${secs(s.lastTtk)}</td><th>BEST</th><td>${secs(s.bestTtk)}</td></tr>
      <tr><th>KILLS</th><td>${s.kills}</td><th>ACCURACY</th><td>${acc === null ? '—' : acc + '%'}</td></tr></table>
      ${o.mode === 'attack' ? `<h5>${a.baseDef.name.toUpperCase()}'S DAMAGE TO YOU</h5><table>${this.tallyRows(s.taken, s.taken.active(time))}<tr><th>YOUR DEATHS</th><td>${s.deaths}</td><th></th><td></td></tr></table>` : ''}
      <p class="keys"><kbd>G</kbd> console</p>`;
  }

  private drawSpar(me: Actor | null) {
    const s = this.spar;
    if (!s || !s.foe || !s.sealed) { this.sparHud.className = 'rg-spar'; return; }
    const f = s.foe;
    this.sparHud.className = 'rg-spar on';
    const pips = (n: number, cls: string) => Array.from({ length: s.opts.firstTo }, (_, i) => `<i class="${i < n ? cls : ''}"></i>`).join('');
    const st = s.phase === 'countdown' ? `ROUND ${s.round} · GET READY` : s.phase === 'fight' ? `ROUND ${s.round}` : s.phase === 'roundover'
      ? (s.roundWinner === 'draw' ? `ROUND ${s.round} · DRAW` : `ROUND ${s.round} · ${s.roundWinner === 'you' ? 'YOU WIN' : f.baseDef.name.toUpperCase() + ' WINS'}`)
      : s.wins.you > s.wins.them ? 'YOU WIN THE SPAR' : `${f.baseDef.name.toUpperCase()} WINS THE SPAR`;
    this.sparHud.innerHTML = `<div class="side you"><b>${me?.def.name ?? 'YOU'}</b><span class="pips">${pips(s.wins.you, 'w')}</span><em>${s.wins.you}</em></div>
      <div class="mid ${s.phase}"><small>SPAR · FIRST TO ${s.opts.firstTo} · ${DIFF_NAME[s.opts.diff]}</small>${st}</div>
      <div class="side them" style="--c:${f.baseDef.color}"><em>${s.wins.them}</em><span class="pips">${pips(s.wins.them, 'l')}</span><b>${f.baseDef.name}</b></div>`;
  }

  // ------------------------------------------------------------------ the console
  show(tab: ConsoleTab = this.tab) {
    this.tab = tab;
    this.panel?.remove();
    const p = this.panel = el('rg-console');
    const heroes = rosterFor(FULL);
    const pick = (cur: string) => (['zenith', 'umbra'] as const).map(t => `<div class="rg-row">${heroes.filter(h => h.team === t).map(h =>
      `<div class="rg-card ${h.team} ${h.id === cur ? 'sel' : ''}" data-h="${h.id}" style="--c:${h.color}"><img src="${BASE}img/portrait_${h.id}.webp" onerror="this.style.visibility='hidden'"><b>${h.name}</b><small>${h.role.toUpperCase()}</small></div>`).join('')}</div>`).join('');
    const chips = (key: string, list: [string, string | number][], cur: string | number, dis = false) =>
      `<div class="rg-chips ${dis ? 'dis' : ''}">${list.map(([label, v]) => `<button data-k="${key}" data-v="${v}" class="${v === cur ? 'on' : ''}">${label}</button>`).join('')}</div>`;
    const R = this.draft.range, S = this.draft.spar, s = this.spar;
    let body: string;
    if (tab === 'range') {
      const log = this.range.stats.log;
      body = `<div class="rg-grid">${pick(R.hero)}</div>
        <div class="rg-opts">
          <label>MODE</label>${chips('mode', [['ATTACK', 'attack'], ['DEFENSE', 'defense']], R.mode)}
          <p class="rg-desc">${R.mode === 'attack' ? 'It fights back with its whole kit, leashed to its lane - measure what you deal under fire and what that hero deals to you.'
            : 'It holds its post facing you and never fires; its passives still apply (armor, damage reduction). Back to full health 3 s after your last hit - every burst gives a clean time-to-kill.'}</p>
          <label>ABILITIES</label>${chips('abilities', [['ON', 'on'], ['OFF', 'off']], R.abilities ? 'on' : 'off')}
          <p class="rg-desc">${R.mode === 'attack' ? 'Off: weapon only - no abilities, no ultimate.' : 'On: it guards itself the way a player would - barrier, temporary health, deflect or parry, a dodge when low. Off: a pure target, like Overwatch\'s Hero Bot.'}</p>
          <label>MOVEMENT</label>${chips('move', [['HOLD', 'hold'], ['STRAFE', 'strafe']], R.move, R.mode === 'attack')}
          <label>DISTANCE</label>${chips('dist', LANE.dists.map(d => [`${d} M`, d] as [string, number]), R.dist)}
          <label>AI AIM</label>${chips('skill', SKILLS, R.skill, R.mode === 'defense')}
          <div class="rg-go"><button class="primary rg-deploy">DEPLOY ${HERO[R.hero].name.toUpperCase()}</button>${this.range.bot ? '<button class="rg-remove">REMOVE TARGET</button><button class="rg-reset">RESET STATS</button>' : ''}</div>
        </div>
        <div class="rg-log"><h5>RESULTS <small>each target you drop</small></h5>${log.length ? `<table><tr><th>YOU</th><th>TARGET</th><th>MODE</th><th>DIST</th><th>TIME TO KILL</th><th>DAMAGE</th><th>HITS</th><th>CRITS</th><th>DPS</th></tr>
          ${log.map(x => `<tr><td>${x.you}</td><td>${x.target}</td><td>${x.mode}${x.abilities ? '+ab' : ''}</td><td>${x.dist} m</td><td>${secs(x.ttk)}${x.frameDown !== undefined ? ` <small>(frame ${x.frameDown.toFixed(2)})</small>` : ''}</td><td>${n0(x.dmg)}</td><td>${x.hits}</td><td>${x.crits}</td><td>${x.dps === null ? '—' : n0(x.dps)}</td></tr>`).join('')}</table>` : '<p class="rg-empty">Deploy a hero and drop it: every kill is logged here with your hero, the time to kill and the damage.</p>'}</div>`;
    } else {
      const sealed = !!s?.sealed;
      body = `<div class="rg-grid">${pick(S.hero)}</div>
        <div class="rg-opts">
          <label>DIFFICULTY</label>${chips('diff', [['EASY', 'easy'], ['MEDIUM', 'medium'], ['HARD', 'hard']], S.diff)}
          <p class="rg-desc">${S.diff === 'easy' ? 'Slow aim and slow reactions.' : S.diff === 'medium' ? 'A fair fight.' : 'Sharp aim, quick abilities and ultimates - it punishes mistakes.'} The opponent plays its full kit at every level (AI skill ${SPAR_SKILL[S.diff]}).</p>
          <label>ROUNDS</label>${chips('firstTo', [['FIRST TO 1', 1], ['FIRST TO 2', 2], ['FIRST TO 3', 3]], S.firstTo)}
          <p class="rg-desc">Walk into the arena north of the spawn: a holographic box seals around the two of you and stays shut until someone has won the spar. Every round starts from full health at opposite ends after a 3 s countdown and ends on a kill.</p>
          <div class="rg-go">${sealed ? '<button class="rg-end">FORFEIT SPAR</button>' : `<button class="primary rg-arm">${s?.foe ? 'RE-ARM' : 'ARM'} SPAR · ${HERO[S.hero].name.toUpperCase()}</button>${s?.foe ? '<button class="rg-end">REMOVE OPPONENT</button>' : ''}`}</div>
        </div>
        <div class="rg-log"><h5>SPAR HISTORY</h5>${s?.history.length ? `<table><tr><th>YOU</th><th>OPPONENT</th><th>DIFFICULTY</th><th>SCORE</th><th>RESULT</th></tr>
          ${s.history.map(x => `<tr><td>${x.you}</td><td>${x.foe}</td><td>${DIFF_NAME[x.diff]}</td><td>${x.score[0]} - ${x.score[1]}</td><td class="${x.won ? 'won' : 'lost'}">${x.won ? 'WIN' : 'LOSS'}</td></tr>`).join('')}</table>` : '<p class="rg-empty">No spars yet.</p>'}</div>`;
    }
    p.innerHTML = `<div class="rg-box"><div class="rg-tabs"><button data-tab="range" class="${tab === 'range' ? 'on' : ''}">HERO RANGE</button><button data-tab="spar" class="${tab === 'spar' ? 'on' : ''}">SPAR ARENA</button>
      <span class="rg-hint">Esc / G close</span><button class="rg-x">✕</button></div><div class="rg-body ${tab}">${body}</div></div>`;
    this.host.append(p);
    p.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => b.onclick = () => this.show(b.dataset.tab as ConsoleTab));
    p.querySelectorAll<HTMLElement>('.rg-card').forEach(c => c.onclick = () => { (tab === 'range' ? R : S).hero = c.dataset.h!; this.show(); });
    p.querySelectorAll<HTMLElement>('.rg-chips:not(.dis) button').forEach(b => b.onclick = () => {
      const k = b.dataset.k!, v = b.dataset.v!;
      if (tab === 'range') {
        if (k === 'mode') R.mode = v as RangeOpts['mode']; else if (k === 'abilities') R.abilities = v === 'on'; else if (k === 'move') R.move = v as RangeOpts['move'];
        else if (k === 'dist') R.dist = +v; else if (k === 'skill') R.skill = +v;
      } else if (k === 'diff') S.diff = v as SparDiff; else if (k === 'firstTo') S.firstTo = +v;
      this.show();
    });
    const on = (sel: string, fn: () => void) => { const b = p.querySelector<HTMLElement>(sel); if (b) b.onclick = fn; };
    on('.rg-x', () => this.close());
    on('.rg-deploy', () => { this.range.deploy({ ...R }); this.close(); });
    on('.rg-remove', () => { this.range.clear(); this.show(); });
    on('.rg-reset', () => { this.range.resetStats(); this.show(); });
    on('.rg-arm', () => { this.spar?.arm({ ...S }); this.close(); });
    on('.rg-end', () => { this.spar?.cancel(); this.show(); });
  }

  close() {
    if (!this.panel) return;
    this.panel.remove(); this.panel = null;
    this.resume();
  }
}
