// Stadium Armory (between rounds): spend round cash on items (weapon / ability / survival, three tiers, 6 slots) and,
// on rounds 1, 3, 5 and 7, pick one of your hero's powers. READY ends the wait early once everyone is set.
import type { Actor } from '../game/Actor';
import type { World } from '../game/World';
import { ITEMS, ITEM, MAX_ITEMS, powersFor, type Cat, type Stadium } from '../game/stadium';
import { sfx } from '../audio/Sfx';

const CAT: Record<Cat, string> = { weapon: 'WEAPON', ability: 'ABILITY', survival: 'SURVIVAL' };
const fmt = (n: number) => n.toLocaleString('en-US');

export class Armory {
  root = document.createElement('div');
  private tab: Cat = 'weapon';
  private sig = '';
  open = false;
  onClose: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root.className = 'armory';
    this.root.style.display = 'none';
    parent.append(this.root);
    this.root.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b || !this.w?.stadium || !this.me) return;
      const S = this.w.stadium, me = this.me, [act, id] = b.dataset.act!.split(':');
      if (act === 'tab') { this.tab = id as Cat; sfx.play('ui_click'); }
      else if (act === 'buy') { if (S.buy(me, id)) sfx.play('capture'); else sfx.play('whiff'); }
      else if (act === 'sell') { S.sell(me, id); sfx.play('ui_click'); }
      else if (act === 'power') { if (S.pickPower(me, id)) sfx.play('ult_ready'); }
      else if (act === 'ready') { S.setReady(me); sfx.play('announce'); this.hide(); this.onClose?.(); return; }
      this.sig = this.sigOf(); this.render();
    });
  }

  private w: World | null = null;
  private me: Actor | null = null;

  show(w: World, me: Actor) { this.w = w; this.me = me; this.open = true; this.root.style.display = ''; this.sig = this.sigOf(); this.render(); }
  hide() { this.open = false; this.root.style.display = 'none'; }

  /** called every frame while open: re-render only when something changed (cash, owned, timer second) */
  update() {
    if (!this.open || !this.w?.stadium || !this.me) return;
    const S = this.w.stadium;
    if (S.phase !== 'armory') { this.hide(); this.onClose?.(); return; }
    // rebuild only when something structural changes; the countdown ticks in place (a rebuild under the cursor
    // would swallow a click and reset hover states)
    const sig = this.sigOf();
    if (sig !== this.sig) { this.sig = sig; this.render(); }
    const tEl = this.root.querySelector('.ar-time');
    const txt = `${Math.max(0, Math.ceil(S.phaseEnd - this.w.time))}s`;
    if (tEl && tEl.textContent !== txt) tEl.textContent = txt;
  }

  private sigOf() { const S = this.w!.stadium!, me = this.me!; return [me.cash, me.items.join(), me.powers.join(), this.tab, S.round, S.powerPending(me)].join('|'); }

  private render() {
    const w = this.w!, S: Stadium = w.stadium!, me = this.me!;
    const left = Math.max(0, Math.ceil(S.phaseEnd - w.time));
    const powers = powersFor(me.baseDef);
    const pending = S.powerPending(me);
    const my = me.team, them = my === 'zenith' ? 'umbra' : 'zenith';
    const card = (i: typeof ITEMS[number]) => {
      const owned = me.items.includes(i.id), full = me.items.length >= MAX_ITEMS, poor = me.cash < i.cost;
      return `<button class="it ${i.tier} ${owned ? 'owned' : ''}" data-act="${owned ? 'sell' : 'buy'}:${i.id}" ${!owned && (full || poor) ? 'disabled' : ''}>
        <b>${i.name}</b><small>${i.tier.toUpperCase()}</small><p>${i.desc}</p><em>${owned ? 'SELL · refund' : `$${fmt(i.cost)}`}</em></button>`;
    };
    this.root.innerHTML = `<div class="ar-top">
        <div class="ar-title"><b>ARMORY</b><span>ROUND ${S.round} · ${S.wins[my]} - ${S.wins[them]} · first to 4</span></div>
        <div class="ar-cash">$${fmt(me.cash)}</div>
        <div class="ar-time">${left}s</div>
      </div>
      ${pending ? `<div class="ar-powers"><h3>CHOOSE A POWER <small>round ${S.round} power pick - it upgrades ${me.baseDef.name}'s kit for the rest of the match</small></h3>
        <div class="pw">${powers.map(p => `<button class="power" data-act="power:${p.id}" ${me.powers.includes(p.id) ? 'disabled' : ''}><b>${p.name}</b><p>${p.desc}</p></button>`).join('')}</div></div>` : ''}
      <div class="ar-main">
        <div class="ar-tabs">${(Object.keys(CAT) as Cat[]).map(c => `<button data-act="tab:${c}" class="${c === this.tab ? 'on' : ''}">${CAT[c]}</button>`).join('')}</div>
        <div class="ar-items">${ITEMS.filter(i => i.cat === this.tab).map(card).join('')}</div>
      </div>
      <div class="ar-bottom">
        <div class="ar-owned"><span>ITEMS ${me.items.length}/${MAX_ITEMS}</span>${me.items.map(id => `<i class="${ITEM[id].tier}" title="${ITEM[id].desc}">${ITEM[id].name}</i>`).join('')}
          ${me.powers.length ? `<span>POWERS</span>${me.powers.map(id => `<i class="pow">${powers.find(p => p.id === id)?.name ?? id}</i>`).join('')}` : ''}</div>
        <button class="primary ready" data-act="ready" ${pending ? 'disabled title="pick a power first"' : ''}>READY</button>
      </div>`;
  }
}
