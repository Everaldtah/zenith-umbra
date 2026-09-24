// In-match HUD (DOM overlay): health, abilities, ult, ammo, objective, kill feed, counter callouts, damage numbers,
// enemy health bars, scoreboard.
import * as THREE from 'three';
import { isAbility, type AbilityDef } from '../data/heroes';
import type { Actor } from '../game/Actor';
import type { GameEvent, World } from '../game/World';
import { QUICK_MELEE } from '../game/weapons';
import { BASE } from '../render/Assets';

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
  private numPool: { e: HTMLElement; born: number; pos: THREE.Vector3; vy: number }[] = [];
  private barEls = new Map<number, HTMLElement>();
  private abilEls: Record<string, HTMLElement> = {};
  private lastHero = '';
  private ultWasReady = false;
  onUltReady: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root.append(this.bars, this.nums, this.cross, this.hitmark, this.hp, this.portrait, this.abil, this.ultEl, this.ammo, this.flight, this.obj, this.feed, this.callout, this.banner, this.status, this.board, this.fps);
    parent.append(this.root);
  }
  show(v: boolean) { this.root.style.display = v ? '' : 'none'; }

  private buildAbilities(a: Actor) {
    this.abil.innerHTML = ''; this.abilEls = {};
    const S = a.def.secondary;
    const list: [string, AbilityDef | null, string][] = [
      ['RMB', isAbility(S) ? S : null, isAbility(S) ? S.name : (S.heal ? 'Heal' : 'Alt fire')],
      ['SHIFT', a.def.ability1, a.def.ability1.name], ['E', a.def.ability2, a.def.ability2.name], ['C', null, 'Melee'],
    ];
    for (const [key, def, name] of list) {
      const b = el('div', 'ab' + (def?.counter ? ' counter' : ''), `<div class="cd"></div><div class="k">${key}</div><div class="n">${name}</div>`);
      if (def?.counter) b.title = def.counter;
      this.abil.append(b); this.abilEls[key] = b;
    }
    this.portrait.innerHTML = `<img src="${BASE}img/portrait_${a.def.id}.webp" onerror="this.style.display='none'"><div><b>${a.def.name}</b><span>${a.def.title}${a.def.pilot ? ` · pilot ${a.def.pilot.name}` : ''}</span></div>`;
    this.portrait.style.setProperty('--c', a.def.color);
    this.cross.className = 'cross ' + a.def.primary.kind;
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
        (e.querySelector('.k') as HTMLElement).textContent = left > 0 ? left.toFixed(left < 3 ? 1 : 0) : k;
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
        : `<div class="ring" style="--p:${(u * 100).toFixed(1)}"></div><div class="v">${ready ? 'Q' : Math.floor(u * 100) + '%'}</div><div class="n">${me.def.ult.name}</div>`;
      this.ultEl.classList.toggle('active', titan > 0);
      this.ultEl.classList.toggle('ready', ready);
      if (ready && !this.ultWasReady) this.onUltReady?.();
      this.ultWasReady = ready;
      const P = me.def.primary;
      this.ammo.innerHTML = P.kind === 'charge' ? `<b>${me.charging ? Math.round(me.charge * 100) + '%' : 'DRAW'}</b>` : P.ammo ? (me.reloadUntil ? '<b>RELOADING</b>' : `<b>${me.ammo}</b><small>/${P.ammo}</small>`) : '<b>∞</b>';
      this.flight.style.display = me.def.frame === 'flyer' ? '' : 'none';
      if (me.def.frame === 'flyer') this.flight.innerHTML = `<div class="fb"><i style="height:${me.flight}%"></i></div><span>${me.has('grounded', t) ? 'GROUNDED' : 'FLIGHT'}</span>`;
      const st: string[] = [];
      const S2: [string, string, string][] = [['stun', 'STUNNED', '#ffee58'], ['root', 'ROOTED', '#c77dff'], ['silence', 'SILENCED', '#ff4d6d'], ['grounded', 'GROUNDED', '#ff4d6d'], ['antiheal', 'GRIEVOUS HEX', '#b56dff'], ['brand', 'ECLIPSE BRAND', '#ff6a2a'], ['tethered', 'STRUNG', '#c77dff'], ['linked', 'LINKED', '#bfe8ff'], ['ccimmune', 'PURIFIED', '#ffd76a'], ['stealth', 'VEILED', '#9d7bff'], ['revealed', 'REVEALED', '#ffd27a'], ['sealed', 'SEALED', '#ffe28a'], ['undying', 'SANCTUARY', '#ffe28a'], ['dmgamp', 'NOVA +30%', '#bfe8ff'], ['vuln', 'PUPPETED +30%', '#c77dff'], ['judgment', "RAIJIN'S JUDGMENT", '#8ad8ff'], ['asura', 'ASURA', '#ff6a2a'], ['lifesteal', 'BLOOD PACT', '#ff2d55']];
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
      if (!a.alive || a === me) continue;
      if (me && a.team !== me.team && a.has('stealth', t) && !a.has('revealed', t)) continue;
      v.set(a.pos.x, a.pos.y + a.height + 0.35, a.pos.z).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
      const d = cam.position.distanceTo(new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z));
      if (d > 60) continue;
      seen.add(a.id);
      let b = this.barEls.get(a.id);
      if (!b) { b = el('div', 'ob'); this.bars.append(b); this.barEls.set(a.id, b); }
      const enemy = !me || a.team !== me.team;
      b.className = 'ob ' + (a.team === (me?.team ?? 'zenith') ? 'ally' : 'enemy');
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
    if (showBoard || w.winner) {
      const row = (a: Actor) => `<tr class="${a === me ? 'me' : ''}"><td><img src="${BASE}img/portrait_${a.def.id}.webp" onerror="this.remove()">${a.def.name}</td><td>${a.kills}</td><td>${a.assists}</td><td>${a.deaths}</td><td>${Math.round(a.dmgDone)}</td><td>${Math.round(a.healDone)}</td></tr>`;
      const team = (tm: string, title: string) => `<h3 class="${tm}">${title}</h3><table><tr><th>Hero</th><th>K</th><th>A</th><th>D</th><th>Damage</th><th>Healing</th></tr>${w.actors.filter(a => a.team === tm && !a.isRobot).map(row).join('')}</table>`;
      this.board.innerHTML = (w.winner ? `<h2 class="${w.winner}">${w.winner === 'zenith' ? 'ZENITH VANGUARD' : 'UMBRA SYNDICATE'} VICTORY</h2>` : '') + team('zenith', 'Zenith Vanguard') + team('umbra', 'Umbra Syndicate');
    }
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
    } else if (e.t === 'kill') {
      const k = el('div', 'kf', `<b class="${e.src?.team ?? ''}">${e.src ? e.src.def.name : 'The Void'}</b><i>${e.src ? '⟶' : '↓'}</i><b class="${e.tgt.team}">${e.tgt.def.name}</b>`);
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
