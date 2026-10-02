# Online play + Career Profile (evera-2f, 2026-10-02)

User ask: an online mode to play with other people who have the game installed, with Vercel as the online node; a
"fast link" connection system that adapts to each player's internet so matches run smoothly; a career profile like
Overwatch's (hours, accuracy, rank/MMR per hero, every game mode). Follow-up: with a small player base, two people
online must be enough - everyone else in the match is AI, and every extra human who shows up during the minute the
match takes to load replaces a bot.

## What Overwatch 2 shows (research)

Sources: the Overwatch wiki (Player Progression, July 14 2020 patch "Career Profile Improvements", August 26 2025
patch "Hero Skill Rating"), Blizzard's matchmaker deep-dive dev blog (part 1), dotesports / esports.gg career guides.

- **Career Profile pages**: Overview, Statistics, Progression (hero levels), plus history/replays. A mode filter
  (All Modes, Quick Play / Unranked, Competitive, Arcade, Play vs AI...) and a hero filter (All Heroes or one).
- **Overview**: total time played, time per game mode, time per role and games won per role, competitive rank per role,
  and **Top Heroes** sorted by the *Hero Comparison* dropdown: Time Played, Games Won, Win Percentage, Weapon
  Accuracy, Eliminations per Life, Critical Hit Accuracy, Multikill - Best, Objective Kills (and, since Season 18,
  Hero Skill Rating).
- **Statistics**: tables split into **Total / Best (single game) / Average per 10 min** (2020 redesign) across
  Combat (eliminations, final blows, deaths, damage, objective kills/time, multikills...), Assists (healing,
  offensive/defensive assists), Best, Game (time played, games played/won/lost/tied, win %), Match Awards and
  Hero Specific stats.
- **Hero Skill Rating** (Season 18, Aug 2025): SR returns *per hero* - a number 0-5000 (5000 = the top of Champion 1),
  only in your own career profile, never used for matchmaking. A hero places after **5 placement matches**; a match
  counts for a hero played **at least 3 minutes** and among your **3 most-played heroes** in it; every hero you played
  is updated behind the scenes by **its share of the match time**; separate for Role Queue and Open Queue; shown on
  the hero's Statistics page and under Hero Comparison.
- **Hero Progression** (Season 6, reworked Season 18): **150 XP per minute played** in qualifying modes; the first 20
  levels cost more and more up to 10,000 XP, every level after is 10,000 (~67 min); badge tiers at 1/25/50/75/100,
  ascended portraits at 20/40/60/80.
- **MMR** (dev blog): a hidden matchmaking rating separate from the visible rank; initial matches move it faster.

## What we built (desktop edition)

### Career Profile - `src/game/career.ts`, `src/client/CareerUI.ts`
- Every match in every mode is filed per mode and per hero (`CareerTracker` follows the local player: time on each
  hero, the Actor counters, multikills, objective kills); the old ranks/history store (`ranks.ts`) stays.
- Tabs: OVERVIEW (stat strip, time by mode, roles, Top Heroes + Hero Comparison), STATISTICS (Total / Avg per 10 /
  Best, Game, Accuracy, Hero Specific; mode + hero filters; hero header with level and both SRs), HERO RATINGS (SR per
  hero for Online Competitive and Competitive vs AI, placement pips), PROGRESSION (hero levels, badges, ascended
  rings), HISTORY (last 40 matches with SR change).
- Hero Skill Rating exactly per the S18 rules above; Elo-style on the hero, scaled by time share, with a small
  performance term (elims/deaths/damage/healing per 10 vs the role's typical numbers). Seeds from your role rank.
- End-of-match screens show hero level-ups and Hero SR changes.

### Online node - `api/net.js` (Vercel)
- Presence + inbox + WebRTC signalling + relay (as before), plus: matchmaking, connection tests (`?ping`, `?bw`),
  the ICE list (`?ice` - STUN, and TURN when `TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL` or Cloudflare
  `CF_TURN_KEY_ID/CF_TURN_KEY_TOKEN` are set), public profile cards (`?prof=`).
- **Matchmaking for a small player base**: two queued players form a match at once (role queue: 1 tank, 2 damage,
  2 support a side; a wide rating window that widens fast). The match stays open for **60 s** (hero select + linking +
  loading): anyone who queues meanwhile is slotted in (`mm_add` to the host); nobody is added in the last 12 s. At the
  start the host fills every empty seat on both sides with AI (`createOnlineMatch`). Ten humans start after 12 s.
- **Host election**: the best connection score (uplink most, then latency, downlink, desktop, cores) from the
  in-game connection test. The host runs the simulation; everyone streams to it peer-to-peer.
- State lives in memory on one warm Fluid instance unless Upstash Redis env vars are set (then Redis) - with more
  players, add Upstash so separate instances share the queue.

### Fast Link - `src/net/{quality,codec,link,FastSync}.ts`
- **Per-link measurement**: binary pings 4 Hz (RTT, jitter, loss), WebRTC `getStats` (bandwidth estimate, path:
  LAN / direct / TURN), send-queue backlog (congestion), node relay detection.
- **Tiers** per link: ULTRA 60 Hz snapshots / 60 Hz input, HIGH 40/60, MEDIUM 30/40, LOW 20/30, RELAY 8/15. Drop
  at once on loss/latency/backlog, climb one step after 4 s clean; capped by the host's uplink shared between peers.
- **Binary snapshots**: hot rows for every hero (36 bytes) and projectile (22 bytes) every snapshot; cold state
  (hero, statuses, anim cues, scores, zones, objective, your own cooldowns/ammo/ult) as JSON only until the client
  acknowledges its version (acks ride on input packets) - delta compression without a baseline protocol.
- **Client**: snapshot buffer + interpolation at host time minus an adaptive delay (1.5 intervals + 2x jitter),
  brief extrapolation on loss, clock offset from the least-delayed snapshots; own hero predicted and reconciled
  (host position for the last applied input vs the prediction for that input, error eased out; snaps on dashes,
  respawns); inputs with press counters so a tap survives a lost packet.
- **Host**: lag compensation - while a remote player's weapons/abilities run, everyone else is rewound to where that
  player saw them (RTT/2 + their interpolation delay, max 250 ms) via `World.rewind`; a player who drops mid-match
  is handed to the AI.
- In-match readout (top left): ping, update rate, tier, loss, P2P/LAN/TURN/RELAY; the host sees each player's link.

## Tests
- `tests/unit/online.test.ts`: matchmaker (2 players, 10-cap, role slots, late joiners, host election), wire format,
  tiers + hysteresis, AI fill, in-memory host <-> client replication (mirror, input, prediction, lag-comp undo), the
  lost-packet press latch. `tests/unit/career.test.ts`: hero levels, HSR placements + 3-minute/top-3 rule, totals,
  the tracker.
- `tests/e2e/online.mjs`: three browsers on a local node (`ZU_GATHER_MS=15000 node scripts/net-local.mjs 8788`, dev
  server with `VITE_NET_URL=http://localhost:8788/api/net`): A+B form a match, C joins it late, P2P links, 3 humans +
  7 AI, client mirror + snapshot rate, client input moves its hero on the host, prediction agrees, readout, careers
  filed, career screenshots.

## Not done / next
- Host migration (the host leaving ends the match for everyone; matchmade players return to the queue only before
  the start).
- Relay through the node is HTTP polling (~8 Hz) - fine as a fallback, but players behind strict NATs want TURN:
  set the Cloudflare TURN env vars on Vercel (1,000 GB/month free) and every client picks them up.
- Upstash Redis for the node once more than a handful of people play at once.
- Player names over heroes / on the Tab screen in online matches; voice/text chat; hero swaps mid-match.
