// Competitive ranks and matchmaking ratings (desktop edition), in the spirit of Overwatch 2's ranked system:
//  - a rank per role (tank / damage / support): 8 tiers x 5 divisions (5 lowest -> 1), 100 rating points per division
//  - a hidden matchmaking rating (MMR, Elo) per role and one for Quick Play; bots are matched to it (their skill)
//  - 5 placement matches per role before the rank shows (they move the rating the most)
//  - every match moves your progress in the division by a %, and the result screen says why (rank modifiers):
//    Win Streak / Loss Streak, Uphill Battle (lost to a stronger lobby: smaller loss), Expected (beat a weaker lobby:
//    smaller gain), Reversal (a win that snaps a losing run), Consolation (a loss that snaps a winning run),
//    Calibration (the first matches after placements move further), Demotion Protection (three matches at 0% of a
//    division before you drop out of it)
// Pure functions + a tiny localStorage store (tests use the functions directly).

export type RankRole = 'tank' | 'damage' | 'support';
export const ROLE_OF: Record<'tank' | 'dps' | 'support', RankRole> = { tank: 'tank', dps: 'damage', support: 'support' };
export const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster', 'Champion'] as const;
export const TIER_COLOR = ['#b07a4a', '#c3ccd8', '#f2c14e', '#6fd6d0', '#7aa7ff', '#f0a35e', '#c77dff', '#ff5d7a'];
export const PLACEMENTS = 5;
const DIV = 100, TIER_SPAN = DIV * 5, TOP = TIERS.length * TIER_SPAN - 1;   // 0 .. 3999

export interface MatchLog { at: number; mode: 'competitive' | 'quickplay'; role?: RankRole; map: string; hero: string; won: boolean; delta?: number; mods?: string[]; score: string; }
export interface RoleRank { mmr: number; rating: number; games: number; wins: number; losses: number; streak: number; shield: number; }
export interface Career { season: number; roles: Record<RankRole, RoleRank>; qp: { mmr: number; games: number; wins: number }; history: MatchLog[]; best: Partial<Record<RankRole, number>>; }

const fresh = (): RoleRank => ({ mmr: 1800, rating: 1800, games: 0, wins: 0, losses: 0, streak: 0, shield: 0 });
export const newCareer = (): Career => ({ season: 1, roles: { tank: fresh(), damage: fresh(), support: fresh() }, qp: { mmr: 1800, games: 0, wins: 0 }, history: [], best: {} });

export interface RankView { tier: number; name: string; division: number; pct: number; color: string; placed: boolean; label: string; }
/** the visible rank for a rating: tier, division (5..1), % through the division */
export function rankOf(rating: number, games = PLACEMENTS): RankView {
  const r = Math.max(0, Math.min(TOP, rating)), tier = Math.floor(r / TIER_SPAN), within = r - tier * TIER_SPAN;
  const division = 5 - Math.floor(within / DIV), pct = within % DIV;
  const placed = games >= PLACEMENTS;
  return { tier, name: TIERS[tier], division, pct, color: TIER_COLOR[tier], placed, label: placed ? `${TIERS[tier]} ${division}` : `Placements ${games}/${PLACEMENTS}` };
}

/** Elo expectation of beating a lobby rated `opp` */
export const expected = (mmr: number, opp: number) => 1 / (1 + Math.pow(10, (opp - mmr) / 400));
/** bot skill (0..1, the AI's aim and decision speed) that plays at a matchmaking rating */
export const skillFor = (mmr: number) => Math.max(0.3, Math.min(0.97, 0.3 + (mmr - 800) / 3200 * 0.67));

export interface RankChange { before: RoleRank; after: RoleRank; delta: number; mods: string[]; promoted: boolean; demoted: boolean; placedNow: boolean; }

/**
 * One competitive match for a role: `opp` = the enemy lobby's rating, `close` = it went the distance (all rounds /
 * overtime). Returns the new record and the explanation for the result screen.
 */
export function applyCompetitive(prev: RoleRank, won: boolean, opp: number, close = false): RankChange {
  const r = { ...prev };
  const placing = r.games < PLACEMENTS, calib = !placing && r.games < PLACEMENTS + 5;
  const e = expected(r.mmr, opp);
  // hidden rating: Elo, larger steps while it is still uncertain
  r.mmr = Math.max(0, Math.min(TOP, r.mmr + (placing ? 64 : calib ? 40 : 28) * ((won ? 1 : 0) - e)));
  const mods: string[] = [];
  let delta: number;
  if (placing) {
    // placements move the visible rating straight toward the hidden one
    delta = Math.round((r.mmr - r.rating) * 0.6 + (won ? 30 : -30));
    mods.push('Placement');
  } else {
    delta = won ? 24 : -22;
    const pull = (r.mmr - r.rating) * 0.12;               // the visible rank converges on the matchmaking rating
    delta += Math.round(pull);
    if (won && r.streak >= 2) { delta += 6 + 2 * Math.min(3, r.streak - 2); mods.push('Win Streak'); }
    if (!won && r.streak <= -2) { delta -= 4 + 2 * Math.min(3, -r.streak - 2); mods.push('Loss Streak'); }
    if (won && r.streak <= -2) { delta += 5; mods.push('Reversal'); }
    if (!won && r.streak >= 2) { delta += 5; mods.push('Consolation'); }
    if (!won && e < 0.4) { delta = Math.round(delta * 0.6); mods.push('Uphill Battle'); }
    if (won && e > 0.65) { delta = Math.round(delta * 0.7); mods.push('Expected'); }
    if (close) { delta += won ? 3 : 2; mods.push(won ? 'Hard-Fought Win' : 'Hard-Fought Loss'); }
    if (calib) { delta = Math.round(delta * 1.5); mods.push('Calibration'); }
  }
  const before = rankOf(r.rating, r.games);
  let next = Math.max(0, Math.min(TOP, r.rating + delta));
  // demotion protection: at the bottom of a division you stay put for up to three losses before dropping
  const floor = Math.floor(r.rating / DIV) * DIV;
  if (!placing && !won && next < floor) {
    if (r.shield < 3) { r.shield++; next = floor; mods.push(`Demotion Protection ${r.shield}/3`); }
    else r.shield = 0;                                   // protection used up: this loss drops you
  }
  if (won) r.shield = 0;
  const realDelta = next - r.rating;
  r.rating = next;
  r.games++; if (won) r.wins++; else r.losses++;
  r.streak = won ? Math.max(1, r.streak + 1) : Math.min(-1, r.streak - 1);
  const after = rankOf(r.rating, r.games);
  return {
    before: prev, after: r, delta: realDelta, mods,
    promoted: after.placed && before.placed && (after.tier * 5 + (5 - after.division)) > (before.tier * 5 + (5 - before.division)),
    demoted: after.placed && before.placed && (after.tier * 5 + (5 - after.division)) < (before.tier * 5 + (5 - before.division)),
    placedNow: !before.placed && after.placed,
  };
}

/** Quick Play: only a hidden matchmaking rating moves */
export function applyQuickPlay(c: Career, won: boolean, opp: number) {
  c.qp.mmr = Math.max(0, Math.min(TOP, c.qp.mmr + 24 * ((won ? 1 : 0) - expected(c.qp.mmr, opp))));
  c.qp.games++; if (won) c.qp.wins++;
}

// ---------------------------------------------------------------- the store (desktop profile, localStorage)
const KEY = 'zu-career-v1';
export function loadCareer(): Career {
  try { const c = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (c?.roles) return { ...newCareer(), ...c }; } catch { /* no storage */ }
  return newCareer();
}
export function saveCareer(c: Career) {
  c.history = c.history.slice(-30);
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode */ }
}
/** the lobby's rating for a queue: your rating with a little spread (matchmaking tolerance) */
export function lobbyRating(mmr: number, rnd = Math.random) { return mmr + (rnd() - 0.5) * 160; }
