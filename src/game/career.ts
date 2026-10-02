// Career Profile (desktop edition), after Overwatch 2's Career Profile:
//  - every match's numbers are kept per game mode and per hero (Overview: time played, games won, time per mode and
//    per role, Top Heroes; Statistics: Total / Best (one game) / Average per 10 minutes, filtered by mode and hero)
//  - Hero Skill Rating (Overwatch 2 Season 18): a 0-5000 rating per hero for each ranked queue (5000 = the top of
//    Champion 1). A hero places after 5 matches in which it was played at least 3 minutes and was one of your 3
//    most-played heroes; every hero played in a match is updated by its share of the time. It never feeds matchmaking.
//  - Hero levels (Overwatch 2 Hero Progression): 150 XP per minute played in a qualifying mode; the first 20 levels
//    cost more and more (up to 10,000 XP), every level after that is 10,000 XP (~67 minutes). Badge tiers at levels
//    1/25/50/75/100, ascended portrait tiers at 20/40/60/80.
// Pure functions + a localStorage store; CareerTracker turns a running match into a MatchSummary.
import type { Actor } from './Actor';
import type { World } from './World';
import { HERO } from '../data/heroes';
import { expected } from './ranks';

export type CareerMode = 'quickplay' | 'competitive' | 'practice' | 'skirmish' | 'stadium' | 'campaign' | 'training' | 'online-qp' | 'online-comp' | 'custom';
export const CAREER_MODES: CareerMode[] = ['online-qp', 'online-comp', 'quickplay', 'competitive', 'practice', 'skirmish', 'stadium', 'campaign', 'custom', 'training'];
export const MODE_LABEL: Record<CareerMode, string> = {
  'online-qp': 'Online Quick Play', 'online-comp': 'Online Competitive', quickplay: 'Quick Play', competitive: 'Competitive',
  practice: 'AI Quick Match', skirmish: 'Play vs AI', stadium: 'Stadium', campaign: 'Campaign', custom: 'Custom Games', training: 'Training Grounds',
};
export type RankedMode = 'competitive' | 'online-comp';
export const RANKED_MODES: RankedMode[] = ['online-comp', 'competitive'];
/** modes whose play time levels your heroes (as in Overwatch: not the practice range or custom games) */
export const XP_MODES: CareerMode[] = ['online-qp', 'online-comp', 'quickplay', 'competitive', 'practice', 'skirmish', 'stadium', 'campaign'];

/** one hero's (or a whole mode's) lifetime numbers */
export interface HeroLine {
  time: number; games: number; wins: number; losses: number; draws: number;
  elims: number; finalBlows: number; assists: number; deaths: number;
  damage: number; healing: number; mitigated: number;
  shots: number; hits: number; crits: number;
  objTime: number; objKills: number; ults: number;
  /** best in one game */
  bElims: number; bFinal: number; bDamage: number; bHealing: number; bMitigated: number; bObjTime: number; bStreak: number; bMulti: number; bAcc: number;
  /** hero-specific counters (Actor.stats: heal assists, packs, ...) */
  hero: Record<string, number>;
}
export const emptyLine = (): HeroLine => ({
  time: 0, games: 0, wins: 0, losses: 0, draws: 0, elims: 0, finalBlows: 0, assists: 0, deaths: 0, damage: 0, healing: 0, mitigated: 0,
  shots: 0, hits: 0, crits: 0, objTime: 0, objKills: 0, ults: 0,
  bElims: 0, bFinal: 0, bDamage: 0, bHealing: 0, bMitigated: 0, bObjTime: 0, bStreak: 0, bMulti: 0, bAcc: 0, hero: {},
});
const TOTALS = ['time', 'games', 'wins', 'losses', 'draws', 'elims', 'finalBlows', 'assists', 'deaths', 'damage', 'healing', 'mitigated', 'shots', 'hits', 'crits', 'objTime', 'objKills', 'ults'] as const;
const BESTS = ['bElims', 'bFinal', 'bDamage', 'bHealing', 'bMitigated', 'bObjTime', 'bStreak', 'bMulti', 'bAcc'] as const;

/** one hero's part of one match */
export interface HeroSlice {
  hero: string; time: number;
  finalBlows: number; assists: number; deaths: number; damage: number; healing: number; mitigated: number;
  shots: number; hits: number; crits: number; objTime: number; objKills: number; ults: number; streak: number; multi: number;
  stats: Record<string, number>;
}
export type Result = 'win' | 'loss' | 'draw' | 'none';
export interface MatchSummary {
  mode: CareerMode; map: string; at: number; secs: number; result: Result; heroes: HeroSlice[];
  /** the enemy lobby's matchmaking rating on the 0..3999 rank scale (ranked queues) */
  opp?: number;
  score?: string;
}

export interface HeroSR { sr: number; games: number; wins: number; losses: number; placed: number; peak: number; last: number }
export interface MatchRecord {
  at: number; mode: CareerMode; map: string; result: Result; secs: number; hero: string; heroes: string[];
  elims: number; deaths: number; damage: number; healing: number; acc: number; score?: string;
  /** Hero Skill Rating change of the most-played hero (ranked) */
  sr?: number; srDelta?: number;
}
export interface Profile {
  v: 1; created: number;
  modes: Partial<Record<CareerMode, Record<string, HeroLine>>>;
  hsr: Record<RankedMode, Record<string, HeroSR>>;
  xp: Record<string, number>;
  matches: MatchRecord[];
}
export const newProfile = (): Profile => ({ v: 1, created: Date.now(), modes: {}, hsr: { competitive: {}, 'online-comp': {} }, xp: {}, matches: [] });

// ---------------------------------------------------------------- reading
/** totals for a mode ('all' = every mode) and a hero ('all' = every hero) */
export function line(p: Profile, mode: CareerMode | 'all', hero: string | 'all'): HeroLine {
  const out = emptyLine();
  for (const m of mode === 'all' ? CAREER_MODES : [mode]) {
    const t = p.modes[m]; if (!t) continue;
    for (const [h, l] of Object.entries(t)) if (hero === 'all' || h === hero) addLine(out, l);
  }
  return out;
}
function addLine(into: HeroLine, l: HeroLine) {
  for (const k of TOTALS) into[k] += l[k];
  for (const k of BESTS) into[k] = Math.max(into[k], l[k]);
  for (const [k, v] of Object.entries(l.hero)) into.hero[k] = (into.hero[k] ?? 0) + v;
}
/** heroes with any time in that mode */
export function heroesPlayed(p: Profile, mode: CareerMode | 'all'): string[] {
  const s = new Set<string>();
  for (const m of mode === 'all' ? CAREER_MODES : [mode]) for (const [h, l] of Object.entries(p.modes[m] ?? {})) if (l.time > 0 || l.games > 0) s.add(h);
  return [...s];
}
export const per10 = (l: HeroLine, v: number) => (l.time > 0 ? v / (l.time / 600) : 0);
export const winPct = (l: HeroLine) => (l.wins + l.losses + l.draws > 0 ? (l.wins / (l.wins + l.losses + l.draws)) * 100 : 0);
export const accuracy = (l: HeroLine) => (l.shots > 0 ? (l.hits / l.shots) * 100 : 0);
export const critAccuracy = (l: HeroLine) => (l.hits > 0 ? (l.crits / l.hits) * 100 : 0);
export const elimsPerLife = (l: HeroLine) => l.elims / Math.max(1, l.deaths);

/** Overwatch's Hero Comparison dropdown */
export type CompareKey = 'time' | 'wins' | 'winPct' | 'acc' | 'epl' | 'crit' | 'multi' | 'objKills' | 'sr';
export const COMPARE_LABEL: Record<CompareKey, string> = {
  time: 'Time Played', wins: 'Games Won', winPct: 'Win Percentage', acc: 'Weapon Accuracy', epl: 'Eliminations per Life',
  crit: 'Critical Hit Accuracy', multi: 'Multikill - Best', objKills: 'Objective Kills', sr: 'Hero Skill Rating',
};
export function compareValue(p: Profile, mode: CareerMode | 'all', hero: string, key: CompareKey): number {
  if (key === 'sr') {
    const q: RankedMode = mode === 'competitive' ? 'competitive' : 'online-comp';
    const r = p.hsr[q][hero]; return r && r.placed >= HSR_PLACEMENTS ? r.sr : 0;
  }
  const l = line(p, mode, hero);
  switch (key) {
    case 'time': return l.time;
    case 'wins': return l.wins;
    case 'winPct': return winPct(l);
    case 'acc': return accuracy(l);
    case 'epl': return elimsPerLife(l);
    case 'crit': return critAccuracy(l);
    case 'multi': return l.bMulti;
    case 'objKills': return l.objKills;
  }
}
/** heroes ranked by a comparison key (the Overview's Top Heroes) */
export function topHeroes(p: Profile, mode: CareerMode | 'all', key: CompareKey = 'time'): { hero: string; value: number }[] {
  const ids = key === 'sr' ? Object.keys(p.hsr[mode === 'competitive' ? 'competitive' : 'online-comp']) : heroesPlayed(p, mode);
  return ids.map(hero => ({ hero, value: compareValue(p, mode, hero, key) })).filter(x => x.value > 0).sort((a, b) => b.value - a.value);
}
/** time played per mode (the Overview's mode bars) */
export function timeByMode(p: Profile): { mode: CareerMode; time: number }[] {
  return CAREER_MODES.map(mode => ({ mode, time: line(p, mode, 'all').time })).filter(x => x.time > 0).sort((a, b) => b.time - a.time);
}
/** time played, games won per role */
export function byRole(p: Profile, mode: CareerMode | 'all') {
  const out = { tank: emptyLine(), damage: emptyLine(), support: emptyLine() };
  for (const h of heroesPlayed(p, mode)) {
    const r = HERO[h]?.role; if (!r) continue;
    addLine(out[r === 'dps' ? 'damage' : r], line(p, mode, h));
  }
  return out;
}
/** 1:23:45 / 12:05 / 0:42 */
export function fmtTime(s: number) {
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}
/** "12.4 hours" / "35 minutes" / "40 seconds" (Overwatch's Top Heroes wording) */
export function fmtHours(s: number) {
  if (s >= 3600) return `${(s / 3600).toFixed(s >= 36000 ? 0 : 1)} hours`;
  return s >= 60 ? plural(Math.round(s / 60), 'minute') : plural(Math.round(s), 'second');
}
export const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- hero levels
export const XP_PER_MIN = 150;
export const BADGE_LEVELS = [1, 25, 50, 75, 100];
export const BADGE_COLOR = ['#9aa3b5', '#5fd38d', '#5aa9ff', '#b07cff', '#ffc94a'];
export const ASCEND_LEVELS = [20, 40, 60, 80];
export const ASCEND_COLOR = ['#5aa9ff', '#b07cff', '#ffc94a', '#ff5d5d'];
/** XP from level L to L+1: 500, 1000, ... 9500, then 10,000 every level */
export const xpToNext = (level: number) => (level < 20 ? 500 * level : 10000);
export interface LevelView { level: number; into: number; need: number; pct: number; badge: number; ascended: number; }
export function heroLevel(xp: number): LevelView {
  let level = 1, left = Math.max(0, xp);
  // closed form past 20 (95,000 XP to get there)
  if (left >= 95000) { level = 20 + Math.floor((left - 95000) / 10000); left = (left - 95000) % 10000; }
  else while (left >= xpToNext(level)) { left -= xpToNext(level); level++; }
  const need = xpToNext(level);
  const badge = BADGE_LEVELS.reduce((b, l, i) => (level >= l ? i : b), 0);
  const ascended = ASCEND_LEVELS.reduce((b, l, i) => (level >= l ? i + 1 : b), 0);
  return { level, into: left, need, pct: (left / need) * 100, badge, ascended };
}
/** the profile's level: every hero's level added up (Overwatch's progression medallion) */
export function playerLevel(p: Profile) { return Object.values(p.xp).reduce((s, x) => s + heroLevel(x).level, 0); }

// ---------------------------------------------------------------- Hero Skill Rating
export const HSR_MAX = 5000;
export const HSR_PLACEMENTS = 5;
/** the 0..3999 rank scale (8 tiers x 5 divisions x 100) -> 0..5000 (5000 = the top of Champion 1) */
export const toHsr = (rating: number) => Math.round(Math.max(0, Math.min(3999, rating)) * (HSR_MAX / 4000));
export const hsrToRating = (sr: number) => Math.max(0, Math.min(3999, Math.round(sr * (4000 / HSR_MAX))));
/** how a hero performed against its role's typical numbers (per 10 minutes): -1 .. 1 */
export function performance(s: HeroSlice): number {
  const d = HERO[s.hero], mins = Math.max(1, s.time / 60) / 10;
  if (!d || s.time < 60) return 0;
  const role = d.role, el = (s.finalBlows + s.assists) / mins, de = s.deaths / mins, dmg = s.damage / mins, heal = s.healing / mins;
  const base = role === 'support' ? { el: 9, de: 5.5, dmg: 3500, heal: 7000 } : role === 'tank' ? { el: 12, de: 5, dmg: 7000, heal: 0 } : { el: 13, de: 6.5, dmg: 7500, heal: 0 };
  let z = (el - base.el) / base.el * 0.35 + (base.de - de) / base.de * 0.25 + (dmg - base.dmg) / base.dmg * 0.25;
  if (base.heal) z += (heal - base.heal) / base.heal * 0.25;
  return Math.max(-1, Math.min(1, z));
}
export interface HsrChange { hero: string; before: HeroSR | null; after: HeroSR; delta: number; placedNow: boolean; qualified: boolean; }
/**
 * One ranked match for the heroes you played. `seed` = where an unplaced hero starts (your role rank, 0..3999 scale),
 * `opp` = the enemy lobby (0..3999 scale). Every hero played is moved by its share of the match time; only heroes
 * that qualify (>= 3 minutes - or half the match if it was shorter - and among the 3 most played) count a placement.
 */
export function applyHsr(table: Record<string, HeroSR>, slices: HeroSlice[], won: boolean, opp: number, seed: (hero: string) => number): HsrChange[] {
  const total = slices.reduce((s, x) => s + x.time, 0);
  if (total <= 0) return [];
  const minT = Math.min(180, total * 0.5);
  const top3 = [...slices].sort((a, b) => b.time - a.time).slice(0, 3).map(s => s.hero);
  const out: HsrChange[] = [];
  for (const s of slices) {
    if (s.time < 20) continue;
    const prev = table[s.hero] ?? null;
    const r: HeroSR = prev ? { ...prev } : { sr: toHsr(seed(s.hero)), games: 0, wins: 0, losses: 0, placed: 0, peak: 0, last: 0 };
    const share = s.time / total, qualified = s.time >= minT && top3.includes(s.hero);
    const placing = r.placed < HSR_PLACEMENTS;
    const e = expected(r.sr * 0.8, opp);                 // (Elo on the 0..3999 scale)
    const k = placing ? 160 : r.games < 20 ? 70 : 45;
    const delta = Math.round(k * share * ((won ? 1 : 0) - e) + 30 * share * performance(s));
    r.sr = Math.max(0, Math.min(HSR_MAX, r.sr + delta));
    if (qualified) { r.games++; if (won) r.wins++; else r.losses++; if (placing) r.placed++; }
    r.last = Date.now();
    const placedNow = placing && r.placed >= HSR_PLACEMENTS;
    if (r.placed >= HSR_PLACEMENTS) r.peak = Math.max(r.peak, r.sr);
    table[s.hero] = r;
    out.push({ hero: s.hero, before: prev, after: r, delta, placedNow, qualified });
  }
  return out;
}

// ---------------------------------------------------------------- recording
export interface RecordResult { hsr: HsrChange[]; levels: { hero: string; from: number; to: number; xp: number }[]; }
/** add one finished match to the profile (call saveProfile after) */
export function recordMatch(p: Profile, m: MatchSummary, seed: (hero: string) => number = () => 1800): RecordResult {
  const table = (p.modes[m.mode] ??= {});
  const total = m.heroes.reduce((s, x) => s + x.time, 0);
  const main = [...m.heroes].sort((a, b) => b.time - a.time)[0];
  const res: RecordResult = { hsr: [], levels: [] };
  for (const s of m.heroes) {
    const l = (table[s.hero] ??= emptyLine());
    // a game counts for a hero played a real part of it (or the only / most-played one)
    const counts = s === main || s.time >= Math.min(60, total * 0.25);
    l.time += s.time;
    if (counts && m.result !== 'none') {
      l.games++;
      if (m.result === 'win') l.wins++; else if (m.result === 'loss') l.losses++; else l.draws++;
    } else if (counts) l.games++;
    const elims = s.finalBlows + s.assists;
    l.elims += elims; l.finalBlows += s.finalBlows; l.assists += s.assists; l.deaths += s.deaths;
    l.damage += s.damage; l.healing += s.healing; l.mitigated += s.mitigated;
    l.shots += s.shots; l.hits += s.hits; l.crits += s.crits; l.objTime += s.objTime; l.objKills += s.objKills; l.ults += s.ults;
    l.bElims = Math.max(l.bElims, elims); l.bFinal = Math.max(l.bFinal, s.finalBlows); l.bDamage = Math.max(l.bDamage, s.damage);
    l.bHealing = Math.max(l.bHealing, s.healing); l.bMitigated = Math.max(l.bMitigated, s.mitigated); l.bObjTime = Math.max(l.bObjTime, s.objTime);
    l.bStreak = Math.max(l.bStreak, s.streak); l.bMulti = Math.max(l.bMulti, s.multi >= 2 ? s.multi : 0);
    if (s.shots >= 30) l.bAcc = Math.max(l.bAcc, Math.round(s.hits / s.shots * 100));
    for (const [k, v] of Object.entries(s.stats)) if (Number.isFinite(v)) l.hero[k] = (l.hero[k] ?? 0) + v;
    if (XP_MODES.includes(m.mode)) {
      const from = heroLevel(p.xp[s.hero] ?? 0).level;
      const gain = Math.round(XP_PER_MIN * s.time / 60);
      p.xp[s.hero] = (p.xp[s.hero] ?? 0) + gain;
      res.levels.push({ hero: s.hero, from, to: heroLevel(p.xp[s.hero]).level, xp: gain });
    }
  }
  const rk = m.mode === 'competitive' || m.mode === 'online-comp' ? (m.mode as RankedMode) : null;
  if (rk && (m.result === 'win' || m.result === 'loss')) res.hsr = applyHsr(p.hsr[rk], m.heroes, m.result === 'win', m.opp ?? 1800, seed);
  if (main) {
    const ch = res.hsr.find(h => h.hero === main.hero);
    p.matches.push({
      at: m.at, mode: m.mode, map: m.map, result: m.result, secs: m.secs, hero: main.hero, heroes: m.heroes.map(h => h.hero),
      elims: m.heroes.reduce((s, h) => s + h.finalBlows + h.assists, 0), deaths: m.heroes.reduce((s, h) => s + h.deaths, 0),
      damage: Math.round(m.heroes.reduce((s, h) => s + h.damage, 0)), healing: Math.round(m.heroes.reduce((s, h) => s + h.healing, 0)),
      acc: (() => { const sh = m.heroes.reduce((s, h) => s + h.shots, 0); return sh ? Math.round(m.heroes.reduce((s, h) => s + h.hits, 0) / sh * 100) : 0; })(),
      score: m.score, ...(ch ? { sr: ch.after.sr, srDelta: ch.delta } : {}),
    });
    if (p.matches.length > 80) p.matches.splice(0, p.matches.length - 80);
  }
  return res;
}

// ---------------------------------------------------------------- store
const KEY = 'zu-profile-v1';
export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (p?.v === 1) { const b = newProfile(); return { ...b, ...p, hsr: { ...b.hsr, ...p.hsr } }; }
  } catch { /* no storage */ }
  return newProfile();
}
export function saveProfile(p: Profile) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode / full */ } }

/** a small public card of the profile (shown to other players online) */
export interface ProfileCard { level: number; hours: number; top: { hero: string; time: number; sr?: number }[]; ranks?: Record<string, string>; }
export function profileCard(p: Profile, ranks?: Record<string, string>): ProfileCard {
  const all = line(p, 'all', 'all');
  return {
    level: playerLevel(p), hours: Math.round(all.time / 360) / 10,
    top: topHeroes(p, 'all', 'time').slice(0, 3).map(t => { const sr = p.hsr['online-comp'][t.hero]; return { hero: t.hero, time: Math.round(t.value), ...(sr && sr.placed >= HSR_PLACEMENTS ? { sr: sr.sr } : {}) }; }),
    ...(ranks ? { ranks } : {}),
  };
}

// ---------------------------------------------------------------- the match tracker
const MULTI_GAP = 3;   // seconds between eliminations that keep a multikill going
/**
 * Follows the local player through a match: time on each hero (a hero swap starts a new slice), the counters the
 * World keeps on the Actor, multikills and objective kills. `frame` every rendered frame with the SIM time that
 * passed (pauses don't count), `finish` once at the end.
 */
export class CareerTracker {
  slices = new Map<string, HeroSlice>();
  secs = 0;
  private cur: Actor | null = null;
  private base: Record<string, number> = {};
  private lastKills = 0; private chain = 0; private lastKillAt = -99; private bestMulti = 0;
  constructor(public mode: CareerMode, public map: string) {}

  private counters(a: Actor) {
    return { kills: a.kills, assists: a.assists, deaths: a.deaths, damage: a.dmgDone, healing: a.healDone, mitigated: a.mitigated,
      shots: a.shots, hits: a.hits, crits: a.crits, objTime: a.objTime, ults: a.ults };
  }
  private slice(hero: string): HeroSlice {
    let s = this.slices.get(hero);
    if (!s) this.slices.set(hero, s = { hero, time: 0, finalBlows: 0, assists: 0, deaths: 0, damage: 0, healing: 0, mitigated: 0, shots: 0, hits: 0, crits: 0, objTime: 0, objKills: 0, ults: 0, streak: 0, multi: 0, stats: {} });
    return s;
  }
  /** move what the current actor has done since it was attached into its hero's slice */
  private close() {
    const a = this.cur; if (!a) return;
    const c = this.counters(a), b = this.base, s = this.slice(a.baseDef.id);
    s.finalBlows += c.kills - (b.kills ?? 0); s.assists += c.assists - (b.assists ?? 0); s.deaths += c.deaths - (b.deaths ?? 0);
    s.damage += c.damage - (b.damage ?? 0); s.healing += c.healing - (b.healing ?? 0); s.mitigated += c.mitigated - (b.mitigated ?? 0);
    s.shots += c.shots - (b.shots ?? 0); s.hits += c.hits - (b.hits ?? 0); s.crits += c.crits - (b.crits ?? 0);
    s.objTime += c.objTime - (b.objTime ?? 0); s.ults += c.ults - (b.ults ?? 0);
    s.streak = Math.max(s.streak, a.bestStreak);
    s.multi = Math.max(s.multi, this.bestMulti); this.bestMulti = 0; this.chain = 0;
    for (const [k, v] of Object.entries(a.stats)) if (typeof v === 'number' && Number.isFinite(v)) s.stats[k] = (s.stats[k] ?? 0) + v - (this.base['st:' + k] ?? 0);
    this.cur = null;
  }
  private attach(a: Actor) {
    this.cur = a;
    this.base = this.counters(a) as Record<string, number>;
    for (const [k, v] of Object.entries(a.stats)) this.base['st:' + k] = v;
    this.lastKills = a.kills;
  }
  frame(w: World, me: Actor | null, dt: number) {
    if (!me) return;
    if (me !== this.cur) { this.close(); this.attach(me); }
    if (dt <= 0 || w.winner) return;
    this.secs += dt;
    this.slice(me.baseDef.id).time += dt;
    // eliminations in quick succession (multikill) and on the objective
    if (me.kills > this.lastKills) {
      const n = me.kills - this.lastKills; this.lastKills = me.kills;
      this.chain = w.time - this.lastKillAt <= MULTI_GAP ? this.chain + n : n;
      this.lastKillAt = w.time;
      this.bestMulti = Math.max(this.bestMulti, this.chain);
      if (onObjective(w, me)) this.slice(me.baseDef.id).objKills += n;
    }
  }
  finish(w: World, me: Actor | null, result: Result, o: { opp?: number; score?: string } = {}): MatchSummary {
    if (me && me !== this.cur) { this.close(); this.attach(me); }
    this.close();
    return { mode: this.mode, map: this.map, at: Date.now(), secs: Math.round(this.secs), result, heroes: [...this.slices.values()].filter(s => s.time > 0.5), ...o };
  }
}
/** on or near the objective (the point, or the payload) */
export function onObjective(w: World, a: Actor): boolean {
  if (w.rules === 'push') return Math.hypot(a.pos.x - w.push.pos.x, a.pos.z - w.push.pos.z) < 12;
  const p = w.map.point; if (!p) return false;
  return Math.hypot(a.pos.x - p[0], a.pos.z - p[2]) < w.point.r * 1.8;
}
