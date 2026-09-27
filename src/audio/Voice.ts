// Hero voice lines (desktop edition), after Overwatch's dialog system (GDC 2016, "Play by Sound"): every line is the answer
// to a STIMULUS - a jump, a hit, a death, an ultimate - and the stimulus decides its CATEGORY (priority) and who HEARS it:
//
//   category   priority  examples                                  broadcast
//   critical   5         ultimate, "COME HERE!"                    enemies + self hear the ult line, allies their own line
//   death      4         death cry                                 everyone nearby
//   pain       3         hit grunts, burning                       the hero and whoever hurt them (the "involved")
//   chatter    2         kills, callouts, thanks, low health       the hero's team (kills: the killer)
//   exert      1         jump / landing efforts                    the player only
//
// One line per hero at a time (a higher category cuts a lower one off), at most three heroes talking at once, per-line
// cooldowns so nobody repeats themselves, and every line lands in 3D from the hero's head. Mech pilots speak over the
// cockpit radio. The announcer sits above it all.
import type { Actor } from '../game/Actor';
import { sfx } from './Sfx';

type Cat = 'critical' | 'death' | 'pain' | 'chatter' | 'exert';
const PRI: Record<Cat, number> = { critical: 5, death: 4, pain: 3, chatter: 2, exert: 1 };
/** minimum seconds between two lines of the same key from the same hero */
const CD: Record<string, number> = {
  pain: 1.1, pain_big: 2.5, jump: 2.2, land: 2.5, burn: 6, kill: 4, low_hp: 12, thanks: 14, reload: 12, a1: 5, a2: 5, alt: 5,
  heal_track: 3, speed_track: 3, swoop: 5, grind: 14, contest: 20, attack_point: 30, defend_point: 30, push: 30, ult_ready: 40,
};

interface Talk { stop: () => void; pri: number; until: number }

export class VoiceDirector {
  private talking = new Map<number, Talk>();
  private last = new Map<string, number>();
  private now = () => performance.now() / 1000;
  private announcer: Talk | null = null;
  me: Actor | null = null;

  reset() { for (const t of this.talking.values()) t.stop(); this.talking.clear(); this.last.clear(); this.announcer?.stop(); this.announcer = null; }

  /** the hero whose bank speaks for this actor (Tenkai-Oh -> Haruto, Gorgoth -> Vorn) */
  private bankOf(a: Actor) { return sfx.bank.voiceOf(a.def.id); }

  /**
   * a hero says `key` if the listener is in the audience for `cat`; `hearers` narrows pain to the involved.
   * Returns true if a line started.
   */
  say(a: Actor, key: string, cat: Cat, o: { involved?: Actor | null; allyKey?: string } = {}): boolean {
    const me = this.me;
    if (!sfx.bank.ready || !sfx.ctx) return false;
    const self = !!me && a === me, ally = !!me && a.team === me.team && !self, enemy = !!me && a.team !== me.team;
    // who hears it
    if (cat === 'exert' && !self) return false;
    if (cat === 'pain' && !self && o.involved !== me) return false;
    if (cat === 'chatter' && enemy && key !== 'kill') return false;
    if (cat === 'chatter' && key === 'kill' && !self && !(o.involved === me)) return false;
    // allies hear an ult in their own words
    if (cat === 'critical' && ally && o.allyKey) key = o.allyKey;
    const bank = this.bankOf(a);
    if (!sfx.bank.hasLine(bank, key)) return false;
    const t = this.now(), lk = `${a.id}:${key}`;
    if (t - (this.last.get(lk) ?? -99) < (CD[key] ?? 2)) return false;
    // one line per hero; a higher category cuts a lower one off
    const cur = this.talking.get(a.id);
    if (cur && cur.until > t) { if (cur.pri >= PRI[cat] && cat !== 'death') return false; cur.stop(); }
    // three heroes at once at most (critical and death always get through)
    const live = [...this.talking.values()].filter(x => x.until > t);
    if (live.length >= 3 && PRI[cat] < 4) return false;
    const buf = sfx.bank.line(bank, key); if (!buf) return false;
    const pos = { x: a.pos.x, y: a.pos.y + a.height * 0.9, z: a.pos.z };
    const radio = a.def.frame === 'mech' && !!a.def.pilot;
    const played = sfx.playLine(buf, self ? null : pos, cat === 'critical' ? 1.15 : cat === 'exert' ? 0.7 : 1,
      { rel: self ? 'self' : ally ? 'ally' : 'enemy', radio, ult: cat === 'critical' && enemy });
    if (!played) return false;
    this.last.set(lk, t);
    this.talking.set(a.id, { stop: played.stop, pri: PRI[cat], until: t + played.dur });
    if (cat === 'critical' || cat === 'death' || self) sfx.duck(cat === 'critical' ? 0.45 : 0.25, played.dur);
    return true;
  }

  /** the arena announcer (2D, over everything) */
  announce(key: string) {
    if (!sfx.bank.ready || !sfx.bank.hasLine('announcer', key)) return;
    const t = this.now(), lk = `ann:${key}`;
    if (t - (this.last.get(lk) ?? -99) < 4) return;
    this.last.set(lk, t);
    const buf = sfx.bank.line('announcer', key); if (!buf) return;
    this.announcer?.stop();
    const p = sfx.playLine(buf, null, 1.05, { rel: 'self' });
    if (p) { this.announcer = { stop: p.stop, pri: 9, until: t + p.dur }; sfx.duck(0.35, p.dur); }
  }
}

export const voice = new VoiceDirector();
