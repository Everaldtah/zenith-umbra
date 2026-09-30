// In-match HUD (DOM overlay): health, abilities, ult, ammo, objective, kill feed, counter callouts, damage numbers,
// enemy health bars, scoreboard.
import * as THREE from 'three';
import { bindsFor, keyShort, type Action, type Settings } from './Settings';
import { drawReticle } from './SettingsUI';
import { isAbility, type AbilityDef } from '../data/heroes';
import type { Actor } from '../game/Actor';
import type { GameEvent, World } from '../game/World';
import { QUICK_MELEE } from '../game/weapons';
import { BASE } from '../render/Assets';
import { FULL } from '../edition';
import { ROUNDS_TO_WIN } from '../game/World';

/** hero-specific lines on the Tab screen (Overwatch 2 shows each hero's own numbers) */
const HERO_STAT: Record<string, string> = { swoops: 'Starwing Swoops', ignites: 'Enemies Ignited', volatile: 'Volatile Crits', roar: 'Crowd-Roar Health', packs: 'Health Packs Used', healAssists: 'Healing Assists', bassdrop: 'Allies Bass-Dropped' };
const QNAME: Record<string, string> = { quickplay: 'QUICK PLAY', competitive: 'COMPETITIVE', practice: 'AI QUICK MATCH', skirmish: 'PLAY VS AI', spectate: 'WATCH', aitest: 'AI LAB' };

const el = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

export class Hud {
  root = el('div', 'hud');
  private hp = el('div', 'hp');
  private abil = el('div', 'abil');
  private ultEl = el('div', 'ult');
  private ammo = el('div', 'ammo');
  private obj = el('div', 'obj');
  private feed = el('div', 'feed');
  private callout = el('div', 'callout');
  private banner = el('div', 'banner');
  private cross = el('div', 'cross');
  private nums = el('div', 'nums');
  private bars = el('div', 'bars');
  private status = el('div', 'status');
  private board = el('div', 'board');
  private fps = el('div', 'fps');
  private hitmark = el('div', 'hitmark');
  private portrait = el('div', 'portrait');
  private flight = el('div', 'flight');
  private subs = el('div', 'subs');
  private opt: Settings | null = null;
  private numPool: { e: HTMLElement; born: number; pos: THREE.Vector3; vy: number }[] = [];
  private barEls = new Map<number, HTMLElement>();
  private abilEls: Record<string, HTMLElement> = {};
  private lastHero = '';
  private ultWasReady = false;
  onUltReady: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root.append(this.bars, this.nums, this.cross, this.hitmark, this.hp, this.portrait, this.abil, this.ultEl, this.ammo, this.flight, this.obj, this.feed, this.callout, this.banner, this.status, this.board, this.fps, this.subs);
    parent.append(this.root);
  }
  show(v: boolean) { this.root.style.display = v ? '' : 'none'; }

  /** Settings > Gameplay / Accessibility / Controls (reticle) */
  applySettings(s: Settings) {
    this.opt = s;
    this.lastHero = '';                  // rebuild the ability bar: its key labels follow the bindings
    const g = s.gameplay;
    for (const e of [this.hp, this.portrait, this.abil, this.ultEl, this.ammo, this.flight, this.obj, this.feed, this.status, this.callout]) {
      (e.style as any).zoom = String(g.hudScale); e.style.opacity = String(g.hudOpacity);
    }
    this.root.classList.toggle('nofeed', !g.killFeed); this.root.classList.toggle('nonums', !g.damageNumbers);
    this.root.classList.toggle('nohit', !g.hitmarkers); this.root.classList.toggle('nocounter', !g.counterCallouts);
    this.subs.style.setProperty('--ss', String(s.access.subSize)); this.subs.style.setProperty('--sbg', String(s.access.subBg));
    this.root.style.setProperty('--hudshake', String(s.access.hudShake));
    this.drawReticle();
  }

  /** a custom reticle replaces the per-weapon one (Settings > Controls > Reticle) */
  private drawReticle() {
    const R = this.opt?.controls.reticle;
    if (!R || R.type === 'default') { if (this.cross.classList.contains('custom')) { this.cross.innerHTML = ''; this.cross.className = 'cross ' + (this.lastKind || 'hitscan'); } return; }
    this.cross.className = 'cross custom';
    const size = Math.ceil((R.gap + R.length) * 2 + R.thickness * 2 + R.dot + 12), c = document.createElement('canvas');
    c.width = c.height = size;
    drawReticle(c.getContext('2d')!, size / 2, size / 2, R, 1);
    this.cross.innerHTML = ''; this.cross.append(c);
  }
  private lastKind = '';

  /** the ability bar shows the keys the player actually bound (their hero's own set first) */
  private label(k: string, hero: string) {
    const A: Record<string, Action> = { RMB: 'alt', SHIFT: 'a1', E: 'a2', C: 'melee', Q: 'ult' };
    return this.opt && A[k] ? keyShort(bindsFor(this.opt, hero, A[k])[0]) : k;
  }

  /** the advanced performance overlay (null = off / simple) */
  perf(lines: string[] | null) {
    this.fps.classList.toggle('adv', !!lines);
    if (lines) this.fps.textContent = lines.join('\n');
  }

  /** a voice line's subtitle (Accessibility > Subtitles filters by category) */
  subtitle(name: string, color: string, text: string, cat: string, secs: number) {
    const lv = this.opt?.access.subtitles ?? 'critical';
    const show = lv === 'all' || (lv === 'conversations' && cat !== 'exert' && cat !== 'pain') || (lv === 'critical' && (cat === 'critical' || cat === 'announcer'));
    if (!show || !text) return;
    const d = el('div', '', `${name ? `<b style="--c:${color}">${name}:</b>` : ''}${text}`);
    this.subs.append(d);
    while (this.subs.children.length > 3) this.subs.firstChild!.remove();
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 300); }, Math.max(1.6, secs) * 1000);
  }

  private buildAbilities(a: Actor) {
    this.abil.innerHTML = ''; this.abilEls = {};
    const S = a.def.secondary;
    const list: [string, AbilityDef | null, string][] = [
      ['RMB', isAbility(S) ? S : null, isAbility(S) ? S.name : (S.heal ? 'Heal' : 'Alt fire')],
      ['SHIFT', a.def.ability1, a.def.ability1.name], ['E', a.def.ability2, a.def.ability2.name], ['C', null, 'Melee'],
    ];
    for (const [key, def, name] of list) {
      const b = el('div', 'ab' + (def?.counter ? ' counter' : ''), `<div class="cd"></div><div class="k">${this.label(key, a.def.id)}</div><div class="n">${name}</div>`);
      if (def?.counter) b.title = def.counter;
      this.abil.append(b); this.abilEls[key] = b;
    }
    this.portrait.innerHTML = `<img src="${BASE}img/portrait_${a.def.id}.webp" onerror="this.style.display='none'"><div><b>${a.def.name}</b><span>${a.def.title}${a.def.pilot ? ` · pilot ${a.def.pilot.name}` : ''}</span></div>`;
    this.portrait.style.setProperty('--c', a.def.color);
    this.lastKind = a.def.primary.kind;
    if (!this.cross.classList.contains('custom')) this.cross.className = 'cross ' + a.def.primary.kind;
  }

  update(w: World, me: Actor | null, cam: THREE.Camera, now: number, fps: number, showBoard: boolean, spectating: string) {
    const t = w.time;
    this.fps.textContent = fps ? `${fps.toFixed(0)} FPS` : '';
    if (me) {
      if (this.lastHero !== me.def.id) { this.lastHero = me.def.id; this.buildAbilities(me); }
      const max = me.maxHp;
      const pct = (x: number) => `${(x / max * 100).toFixed(1)}%`;
      this.hp.innerHTML = `<div class="bar"><i class="h" style="width:${pct(me.hp)}"></i><i class="a" style="width:${pct(me.armor)}"></i><i class="s" style="width:${pct(Math.min(me.shieldAmt, max))}"></i></div><div class="num">${Math.ceil(me.health)}<small>/${max}</small>${me.shieldAmt > 1 ? ` <em>+${Math.ceil(me.shieldAmt)}</em>` : ''}</div>`;
      const S = me.def.secondary;
      const cds: [string, string][] = [['SHIFT', me.def.ability1.id], ['E', me.def.ability2.id]];
      if (isAbility(S)) cds.push(['RMB', S.id]);
      for (const [k, id] of cds) {
        const left = me.cdLeft(id, t), e = this.abilEls[k];
        if (!e) continue;
        const def = k === 'SHIFT' ? me.def.ability1 : k === 'E' ? me.def.ability2 : (S as AbilityDef);
        (e.querySelector('.cd') as HTMLElement).style.height = `${left > 0 ? left / Math.max(0.1, def.cooldown) * 100 : 0}%`;
        e.classList.toggle('ready', left <= 0);
        e.classList.toggle('silenced', me.has('silence', t));
        (e.querySelector('.k') as HTMLElement).textContent = left > 0 ? left.toFixed(left < 3 ? 1 : 0) : this.label(k, me.def.id);
        // Tomoe: while the Crescent Fang is out, RMB calls it back (no cooldown shown until it's caught)
        if (id === 'crescent' && me.sv.fang) {
          const stuck = me.sv.fang === 2 || me.sv.fang === 3;
          (e.querySelector('.cd') as HTMLElement).style.height = '0%';
          e.classList.toggle('ready', stuck);
          (e.querySelector('.k') as HTMLElement).textContent = stuck ? 'RECALL' : '···';
        }
      }
      {
        // quick melee cooldown
        const e = this.abilEls.C, left = Math.max(0, me.nextMelee - t);
        (e.querySelector('.cd') as HTMLElement).style.height = `${left / QUICK_MELEE.cooldown * 100}%`;
        e.classList.toggle('ready', left <= 0);
      }
      if (me.def.id === 'tenkai') {
        const b = this.abilEls.RMB;
        (b.querySelector('.cd') as HTMLElement).style.height = `${100 - me.barrier.hp / me.barrier.max * 100}%`;
        b.classList.toggle('ready', me.barrier.hp > 100 && t > me.barrier.brokenUntil);
      }
      const u = me.ult / me.def.ult.charge;
      const ready = u >= 1;
      const titan = me.has('titan', t) ? me.st.titan - t : 0;
      this.ultEl.innerHTML = titan > 0
        // giant form running: the ring drains over the 60 seconds
        ? `<div class="ring" style="--p:${(titan / 60 * 100).toFixed(1)}"></div><div class="v">${Math.ceil(titan)}s</div><div class="n">GIANT FORM</div>`
        : `<div class="ring" style="--p:${(u * 100).toFixed(1)}"></div><div class="v">${ready ? this.label('Q', me.def.id) : Math.floor(u * 100) + '%'}</div><div class="n">${me.def.ult.name}</div>`;
      this.ultEl.classList.toggle('active', titan > 0);
      this.ultEl.classList.toggle('ready', ready);
      if (ready && !this.ultWasReady) this.onUltReady?.();
      this.ultWasReady = ready;
      const P = me.def.primary;
      this.ammo.innerHTML = P.kind === 'charge' ? `<b>${me.charging ? Math.round(me.charge * 100) + '%' : 'DRAW'}</b>`
        // twin chainguns: left drum | right drum (endless inside the Grand Dohyo)
        : me.def.dualGuns ? (me.has('dohyo', t) ? '<b>∞</b><small> | </small><b>∞</b>' : me.reloadUntil ? '<b>RELOADING</b>' : `<b>${me.ammo}</b><small> | </small><b>${me.sv.ammo2 ?? 0}</b>`)
        : P.ammo ? (me.reloadUntil ? '<b>RELOADING</b>' : `<b>${me.ammo}</b><small>/${me.maxAmmo}</small>`) : '<b>∞</b>';
      const flies = me.def.frame === 'flyer' || !!me.def.jets;
      const dj = me.def.id === 'hibiki';
      this.flight.style.display = flies || dj ? '' : 'none';
      // Hibiki: the Mag-Grind charge (5s of grinding pumps the next Scratch Wave) and the track he's playing
      if (dj) {
        const pumped = me.has('pumped', t), g = pumped ? 100 : Math.min(100, (me.sv.grind ?? 0) / 5 * 100);
        const tr = me.sv.track ? ['TEMPO RUSH', '#ffd23f'] : ['HEALING GROOVE', '#7dffcf'];
        this.flight.innerHTML = `<div class="fb"><i style="height:${g}%;background:${pumped ? '#ffd23f' : '#9ef6ff'}"></i></div><span>${pumped ? 'PUMPED' : 'MAG-GRIND'}</span>`
          + `<span class="sw on" style="color:${tr[1]};border-color:${tr[1]}">${tr[0]}${me.has('amp', t) ? ' · MAX' : ''}</span>`;
        // the Groove: tap jump in rhythm to build speed (up to GROOVE_MAX x) - the chip heats from teal to gold to magenta
        const gv = me.sv.rhythm ?? 1;
        if (gv > 1.15) {
          const hue = gv < 8 ? 165 - (gv - 1) / 7 * 120 : 45 - Math.min(1, (gv - 8) / 12) * 75;
          this.flight.innerHTML += `<span class="sw on" style="color:hsl(${hue},100%,65%);border-color:hsl(${hue},100%,65%)">GROOVE ×${gv.toFixed(gv < 10 ? 1 : 0)}</span>`;
        }
      }
      // Mirei: the swoop's cooldown sits under the flight gauge (F)
      const swoop = me.def.id === 'mirei' ? (me.has('swoop', t) ? 'SWOOP' : me.cdLeft('swoop', t) > 0 ? `F ${me.cdLeft('swoop', t).toFixed(1)}` : 'F SWOOP') : '';
      if (flies && !dj) this.flight.innerHTML = `<div class="fb"><i style="height:${me.flight}%"></i></div><span>${me.has('grounded', t) ? 'GROUNDED' : me.def.jets ? 'THRUSTERS' : 'FLIGHT'}</span>${swoop ? `<span class="sw${me.ready('swoop', t) ? ' on' : ''}">${swoop}</span>` : ''}`;
      const st: string[] = [];
      const S2: [string, string, string][] = [['stun', 'STUNNED', '#ffee58'], ['root', 'ROOTED', '#c77dff'], ['silence', 'SILENCED', '#ff4d6d'], ['grounded', 'GROUNDED', '#ff4d6d'], ['chained', 'TRAPPED', '#ffd76a'], ['antiheal', 'GRIEVOUS HEX', '#b56dff'], ['brand', 'ECLIPSE BRAND', '#ff6a2a'], ['tethered', 'STRUNG', '#c77dff'], ['linked', 'LINKED', '#bfe8ff'], ['ccimmune', 'PURIFIED', '#ffd76a'], ['stealth', 'VEILED', '#9d7bff'], ['revealed', 'REVEALED', '#ffd27a'], ['sealed', 'SEALED', '#ffe28a'], ['undying', 'SANCTUARY', '#ffe28a'], ['dmgamp', 'NOVA +30%', '#bfe8ff'], ['vuln', 'PUPPETED +30%', '#c77dff'], ['judgment', "RAIJIN'S JUDGMENT", '#8ad8ff'], ['asura', 'ASURA', '#ff6a2a'], ['lifesteal', 'LIFESTEAL', '#ff2d55'], ['burning', 'BURNING', '#ff8a3d'], ['tachiai', 'UNSTOPPABLE', '#34d1bf'], ['taiko', 'TAIKO HEARTBEAT', '#ffb35c'], ['dohyo', 'GRAND DOHYO', '#ffe6a8'], ['tempo', 'TEMPO RUSH', '#ffd23f'], ['groove', 'HEALING GROOVE', '#7dffcf'], ['amp', 'MAX VOLUME', '#39d6ff'], ['pumped', 'PUMPED', '#ffd23f'], ['grinding', 'MAG-GRIND', '#9ef6ff'], ['wound', 'WOUNDED', '#ff2d55'], ['warcall', 'WAR CALL', '#ffd98a'], ['tideult', 'UNSTOPPABLE', '#5ff2e0'], ['tidemark', 'CRESCENT MARK +25%', '#4aa8ff']];
      for (const [k, n, c] of S2) if (me.has(k, t)) st.push(`<span style="--c:${c}">${n}</span>`);
      this.status.innerHTML = st.join('');
      this.root.classList.toggle('dead', !me.alive);
      this.banner.style.display = me.alive ? 'none' : '';
      if (!me.alive) this.banner.innerHTML = `<b>ELIMINATED</b><span>Respawn in ${Math.max(0, me.respawnAt - t).toFixed(1)}s</span>`;
      this.cross.style.display = me.alive ? '' : 'none';
      this.cross.classList.toggle('zoom', !!me.sv.zoom);
      this.root.classList.toggle('spectate', false);
    } else {
      this.root.classList.toggle('spectate', true);
      this.banner.style.display = spectating ? '' : 'none';
      this.banner.innerHTML = spectating ? `<span>${spectating}</span>` : '';
    }
    // objective
    const dir = w.director as any;
    if (w.mode === 'campaign' && dir) {
      const b = dir.boss && dir.boss.alive ? dir.boss : null;
      this.obj.innerHTML = b
        ? `<div class="bossbar" style="--c:${b.def.glow}"><b>${b.def.name}</b><small>${b.def.title}</small><div><i style="width:${(b.health / b.maxHp * 100).toFixed(1)}%"></i></div><em>Weak point: ${dir.boss.def.weak ?? ''}</em></div>`
        : `<div class="mid">${dir.level.name.toUpperCase()}<small>${dir.objective}</small></div>`;
    } else if (w.stadium) {
      // Stadium: round pips (first to 4), the point, the round clock, cash
      const S = w.stadium, P = w.point, my = me?.team ?? 'zenith', them = my === 'zenith' ? 'umbra' : 'zenith';
      const pips = (n: number, cls: string) => Array.from({ length: 4 }, (_, i) => `<i class="${i < n ? cls : ''}"></i>`).join('');
      const unlock = Math.max(0, P.unlockAt - t);
      const capTxt = S.phase === 'armory' ? `ARMORY ${Math.max(0, Math.ceil(S.phaseEnd - t))}s` : P.contested ? 'CONTESTED' : P.capTeam ? `${P.capTeam === my ? 'CAPTURING' : 'LOSING'} ${P.capture.toFixed(0)}%` : P.owner ? (P.owner === my ? 'HOLDING' : 'ENEMY HOLDS') : unlock > 0 ? `POINT OPENS ${unlock.toFixed(0)}` : 'NEUTRAL';
      const mine = P.progress[my], theirs = P.progress[them];
      this.obj.innerHTML = `<div class="pips us">${pips(S.wins[my], 'z')}</div><div class="side us"><i style="width:${mine}%"></i><b>${mine.toFixed(0)}%</b></div>
        <div class="mid ${P.owner ? (P.owner === my ? 'us' : 'them') : ''}">STADIUM · ROUND ${S.round}<small>${capTxt}${S.phase === 'fight' ? ` · ${fmtTime(Math.max(0, 120 - (t - S.roundStart)))}` : ''}${me ? ` · $${me.cash.toLocaleString('en-US')}` : ''}</small></div>
        <div class="side them"><i style="width:${theirs}%"></i><b>${theirs.toFixed(0)}%</b></div><div class="pips them">${pips(S.wins[them], 'u')}</div>`;
    } else if (w.rules === 'control') {
      // Control (best of 3): round pips, the point's state, each team's percentage, overtime
      const P = w.point, C = w.control, my = me?.team ?? 'zenith', them = my === 'zenith' ? 'umbra' : 'zenith';
      const pips = (n: number, cls: string) => Array.from({ length: ROUNDS_TO_WIN }, (_, i) => `<i class="${i < n ? cls : ''}"></i>`).join('');
      const unlock = Math.max(0, P.unlockAt - t);
      const st = C.phase === 'intermission' ? `ROUND ${C.round + 1} IN ${Math.max(0, Math.ceil(C.phaseEnd - t))}` : C.overtime ? 'OVERTIME' : unlock > 0 ? `POINT OPENS ${unlock.toFixed(0)}` : P.contested ? 'CONTESTED' : P.capTeam ? `${P.capTeam === my ? 'CAPTURING' : 'LOSING'} ${P.capture.toFixed(0)}%` : P.owner ? (P.owner === my ? 'HOLDING' : 'ENEMY HOLDS') : 'NEUTRAL';
      const mine = P.progress[my], theirs = P.progress[them];
      this.obj.innerHTML = `<div class="pips us">${pips(C.wins[my], 'z')}</div><div class="side us"><i style="width:${mine}%"></i><b>${mine.toFixed(0)}%</b></div>
        <div class="mid ${C.overtime ? 'ot' : P.owner ? (P.owner === my ? 'us' : 'them') : ''}">ROUND ${C.round}<small>${st}</small></div>
        <div class="side them"><i style="width:${theirs}%"></i><b>${theirs.toFixed(0)}%</b></div><div class="pips them">${pips(C.wins[them], 'u')}</div>`;
    } else if (w.rules === 'push') {
      // Mikoshi Rush: the route with the float on it, each team's furthest push, who is moving it, the clock
      const M = w.push, my = me?.team ?? 'zenith', them = my === 'zenith' ? 'umbra' : 'zenith';
      const toward = (team: string) => team === 'zenith' ? 1 : -1;   // + = toward the Umbra end
      const x = (d: number) => 50 + d / Math.max(1, M.half) * 50 * toward(my);   // our goal on the right
      const unlock = Math.max(0, M.unlockAt - t);
      const st = unlock > 0 ? `THE MIKOSHI RISES IN ${unlock.toFixed(0)}` : M.overtime ? 'OVERTIME' : M.contested ? 'CONTESTED' : M.owner ? (M.owner === my ? 'YOUR TEAM PUSHES' : 'ENEMY PUSHES') : 'STANDING STILL';
      const left = Math.max(0, w.timeLimit - t);
      this.obj.innerHTML = `<div class="push"><div class="trk"><i class="c"></i><i class="bu" style="left:${x(M.best[my] * toward(my))}%"></i><i class="bt" style="left:${x(-M.best[them] * toward(my))}%"></i>
        <b class="fl ${M.contested ? 'con' : M.owner ? (M.owner === my ? 'us' : 'them') : ''}" style="left:${x(M.d)}%"></b></div>
        <div class="mid">MIKOSHI RUSH<small>${st} · ${fmtTime(left)} · YOU ${Math.round(M.best[my])}m / THEM ${Math.round(M.best[them])}m</small></div></div>`;
    } else if (w.mode !== 'training') {
      const P = w.point, my = me?.team ?? 'zenith';
      const unlock = Math.max(0, P.unlockAt - t);
      const capTxt = P.contested ? 'CONTESTED' : P.capTeam ? `${P.capTeam === my ? 'CAPTURING' : 'LOSING'} ${P.capture.toFixed(0)}%` : P.owner ? (P.owner === my ? 'HOLDING' : 'ENEMY HOLDS') : 'NEUTRAL';
      const mine = P.progress[my], theirs = P.progress[my === 'zenith' ? 'umbra' : 'zenith'];
      this.obj.innerHTML = `<div class="side us"><i style="width:${mine}%"></i><b>${mine.toFixed(0)}%</b></div>
        <div class="mid ${P.owner ? (P.owner === my ? 'us' : 'them') : ''}">${unlock > 0 ? `POINT OPENS ${unlock.toFixed(0)}` : capTxt}<small>${fmtTime(Math.max(0, w.timeLimit - t))}</small></div>
        <div class="side them"><i style="width:${theirs}%"></i><b>${theirs.toFixed(0)}%</b></div>`;
    } else this.obj.innerHTML = `<div class="mid">TRAINING GROUNDS <small>H: switch hero · Esc: menu</small></div>`;
    // overhead bars (enemies + allies), projected
    const seen = new Set<number>();
    const v = new THREE.Vector3();
    for (const a of w.actors) {
      if (!a.alive || a === me || a.isSummon) continue;     // (no bar over each of fifty puppets)
      if (me && a.team !== me.team && a.has('stealth', t) && !a.has('revealed', t)) continue;
      v.set(a.pos.x, a.pos.y + a.height + 0.35, a.pos.z).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
      const d = cam.position.distanceTo(new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z));
      if (d > 60) continue;
      seen.add(a.id);
      let b = this.barEls.get(a.id);
      if (!b) { b = el('div', 'ob'); this.bars.append(b); this.barEls.set(a.id, b); }
      const enemy = !me || a.team !== me.team;
      const G = this.opt?.gameplay, showBar = !G || (enemy ? G.enemyBars : G.allyBars), showName = !G || G.nameTags;
      b.className = 'ob ' + (a.team === (me?.team ?? 'zenith') ? 'ally' : 'enemy') + (showBar ? '' : ' nobar') + (showName ? '' : ' noname');
      b.style.display = showBar || showName ? '' : 'none';
      b.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth}px, ${(-v.y * 0.5 + 0.5) * innerHeight}px) scale(${Math.max(0.55, Math.min(1, 14 / d))})`;
      const icons = ['stun', 'root', 'silence', 'antiheal', 'brand', 'tethered', 'linked', 'sealed'].filter(s => a.has(s, t)).map(s => `<em class="s-${s}"></em>`).join('');
      b.innerHTML = `<span>${enemy && !me ? '' : ''}${a.def.name}${icons}</span><div><i style="width:${a.health / a.maxHp * 100}%"></i>${a.shieldAmt > 1 ? `<u style="width:${Math.min(100, a.shieldAmt / a.maxHp * 100)}%"></u>` : ''}</div>`;
    }
    for (const [id, b] of this.barEls) if (!seen.has(id)) { b.remove(); this.barEls.delete(id); }
    // floating numbers
    this.numPool = this.numPool.filter(n => {
      const k = (now - n.born) / 0.9;
      if (k >= 1) { n.e.remove(); return false; }
      v.copy(n.pos); v.y += k * 1.2; v.project(cam);
      if (v.z > 1) { n.e.style.display = 'none'; return true; }
      n.e.style.display = '';
      n.e.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth}px, ${(-v.y * 0.5 + 0.5) * innerHeight}px)`;
      n.e.style.opacity = String(1 - k * k);
      return true;
    });
    // scoreboard
    this.board.style.display = showBoard || w.winner ? '' : 'none';
    this.board.classList.toggle('ow2', FULL);
    if ((showBoard || w.winner) && FULL) this.board.innerHTML = this.tabScreen(w, me);
    else if (showBoard || w.winner) {
      const row = (a: Actor) => `<tr class="${a === me ? 'me' : ''}"><td><img src="${BASE}img/portrait_${a.def.id}.webp" onerror="this.remove()">${a.def.name}</td><td>${a.kills}</td><td>${a.assists}</td><td>${a.deaths}</td><td>${Math.round(a.dmgDone)}</td><td>${Math.round(a.healDone)}</td></tr>`;
      const team = (tm: string, title: string) => `<h3 class="${tm}">${title}</h3><table><tr><th>Hero</th><th>K</th><th>A</th><th>D</th><th>Damage</th><th>Healing</th></tr>${w.actors.filter(a => a.team === tm && !a.isRobot).map(row).join('')}</table>`;
      this.board.innerHTML = (w.winner ? `<h2 class="${w.winner}">${w.winner === 'zenith' ? 'ZENITH VANGUARD' : 'UMBRA SYNDICATE'} VICTORY</h2>` : '') + team('zenith', 'Zenith Vanguard') + team('umbra', 'Umbra Syndicate');
    }
  }

  /** Tab (Overwatch 2 style): both teams' E / A / D / DMG / H / MIT, your hero's numbers (accuracy first) */
  private tabScreen(w: World, me: Actor | null): string {
    const my = me?.team ?? 'zenith', them = my === 'zenith' ? 'umbra' : 'zenith', t = w.time;
    const f = (n: number) => Math.round(n).toLocaleString('en-US');
    const row = (a: Actor) => `<tr class="${a === me ? 'me' : ''} ${a.alive ? '' : 'dead'}"><td class="h"><img src="${BASE}img/portrait_${a.def.id}.webp" onerror="this.remove()"><span>${a.def.name}${a === me ? ' <em>YOU</em>' : ''}</span>${a.ult >= a.def.ult.charge ? '<i class="u">ULT</i>' : `<i class="up">${Math.floor(a.ult / a.def.ult.charge * 100)}%</i>`}</td>
      <td>${a.kills + a.assists}</td><td>${a.stats.healAssists ?? 0}</td><td>${a.deaths}</td><td>${f(a.dmgDone)}</td><td>${f(a.healDone)}</td><td>${f(a.mitigated)}</td></tr>`;
    const table = (team: string, title: string) => `<div class="tm ${team === my ? 'mine' : 'enemy'}"><h3>${title}</h3><table><tr><th></th><th title="Eliminations">E</th><th title="Assists">A</th><th title="Deaths">D</th><th>DMG</th><th>H</th><th>MIT</th></tr>
      ${w.actors.filter(a => a.team === team && !a.isRobot).map(row).join('')}</table></div>`;
    const score = w.rules === 'push' ? `${Math.round(w.push.best[my])}m - ${Math.round(w.push.best[them])}m` : w.rules === 'control' ? `${w.control.wins[my]} - ${w.control.wins[them]}` : `${w.point.progress[my].toFixed(0)}% - ${w.point.progress[them].toFixed(0)}%`;
    const head = `<div class="hdr"><b>${QNAME[w.mode] ?? w.mode.toUpperCase()}</b><span>${w.map.name} · ${w.rules === 'push' ? 'MIKOSHI RUSH' : 'CONTROL'}${w.rules === 'control' ? ` · ROUND ${w.control.round}` : ''} · ${score}</span><span>${fmtTime(t)}</span></div>`;
    let mine = '';
    if (me) {
      const pct = (a: number, b: number) => b ? `${Math.round(a / b * 100)}%` : '-';
      const tiles: [string, string][] = [
        ['Weapon Accuracy', pct(me.hits, me.shots)], ['Critical Hit Accuracy', pct(me.crits, me.hits)], ['Eliminations', String(me.kills + me.assists)], ['Final Blows', String(me.kills)],
        ['Objective Time', fmtTime(me.objTime)], ['Damage Mitigated', f(me.mitigated)], ['Best Kill Streak', String(me.bestStreak)], ['Ultimates Used', String(me.ults)],
        ...Object.entries(me.stats).filter(([k, v]) => HERO_STAT[k] && v > 0).map(([k, v]) => [HERO_STAT[k], f(v)] as [string, string]),
      ];
      mine = `<div class="mine"><div class="who"><img src="${BASE}img/portrait_${me.def.id}.webp" onerror="this.remove()"><b>${me.def.name}</b><small>${me.def.title}</small></div>
        <div class="tiles">${tiles.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('')}</div><p class="shots">${me.hits.toLocaleString('en-US')} of ${me.shots.toLocaleString('en-US')} shots hit</p></div>`;
    }
    const banner = w.winner ? `<h2 class="${w.winner === my ? 'win' : 'loss'}">${w.winner === my ? 'VICTORY' : 'DEFEAT'}</h2>` : '';
    void t;
    return banner + head + `<div class="teams">${table(my, my === 'zenith' ? 'ZENITH VANGUARD' : 'UMBRA SYNDICATE')}${table(them, them === 'zenith' ? 'ZENITH VANGUARD' : 'UMBRA SYNDICATE')}</div>` + mine;
  }

  event(e: GameEvent, me: Actor | null, now: number) {
    if (e.t === 'dmg') {
      const mine = me && (e.src === me);
      const onMe = me && e.tgt === me && !e.heal;
      if (mine || (!me && e.amt > 30)) {
        const n = el('div', 'dn' + (e.heal ? ' heal' : e.crit ? ' crit' : ''), (e.heal ? '+' : '') + Math.round(e.amt));
        this.nums.append(n);
        this.numPool.push({ e: n, born: now, pos: new THREE.Vector3(e.pos.x + (Math.random() - 0.5) * 0.6, e.pos.y + 0.4, e.pos.z), vy: 1 });
        if (this.numPool.length > 40) this.numPool.shift()!.e.remove();
        if (mine && !e.heal) { this.hitmark.className = 'hitmark on' + (e.crit ? ' crit' : ''); setTimeout(() => this.hitmark.className = 'hitmark', 120); }
      }
      if (onMe) { this.root.classList.add('hurt'); setTimeout(() => this.root.classList.remove('hurt'), 150); }
    } else if (e.t === 'kill' || e.t === 'demech') {
      // a destroyed mech shows as the frame's name with a broken-frame marker (the pilot fights on)
      const k = el('div', 'kf', `<b class="${e.src?.team ?? ''}">${e.src ? e.src.def.name : 'The Void'}</b><i>${e.t === 'demech' ? '⟶⚙' : e.src ? '⟶' : '↓'}</i><b class="${e.tgt.team}">${e.t === 'demech' ? e.tgt.baseDef.name : e.tgt.def.name}</b>`);
      if (me && (e.src === me || e.tgt === me)) k.classList.add('me');
      this.feed.prepend(k);
      setTimeout(() => k.remove(), 6000);
      while (this.feed.children.length > 6) this.feed.lastChild!.remove();
    } else if (e.t === 'counter') {
      const c = el('div', 'co', `<small>COUNTER</small><b>${e.text}</b><span>${e.actor.def.name} vs ${e.target.def.name}</span>`);
      c.style.setProperty('--c', e.actor.def.color);
      this.callout.prepend(c);
      setTimeout(() => c.classList.add('out'), 2600);
      setTimeout(() => c.remove(), 3200);
      while (this.callout.children.length > 3) this.callout.lastChild!.remove();
    } else if (e.t === 'msg') {
      const m = el('div', 'msg', e.text);
      if (e.color) m.style.color = e.color;
      this.callout.prepend(m);
      setTimeout(() => m.remove(), 3000);
    }
  }

  reset() {
    this.lastHero = '';
    for (const b of this.barEls.values()) b.remove();
    this.barEls.clear();
    this.feed.innerHTML = ''; this.callout.innerHTML = ''; this.nums.innerHTML = ''; this.numPool = [];
  }
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
