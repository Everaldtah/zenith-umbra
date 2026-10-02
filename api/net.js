// ZENITH//UMBRA online node (Vercel Node function, /api/net).
// Every copy of the game (the Windows app, the dev build, the web site) talks to this one endpoint:
//   - presence (who is online, in a squad, a custom game, a queue or a match) and direct messages between players
//     (WebRTC signalling, plus a low-rate relay when two players can't connect directly)
//   - matchmaking for Online Quick Play / Online Competitive: role queue (1 tank, 2 damage, 2 support a side), teams
//     balanced by rating, the match's HOST chosen by connection quality (the "fast link": the best uplink runs the
//     simulation, everyone else streams to it peer-to-peer)
//   - connection tests (ping / download / upload) and the ICE server list (STUN, and TURN when configured)
//   - public profile cards (level, hours, top heroes) so players can look each other up
// Gameplay itself runs peer-to-peer over WebRTC data channels once two players are linked.
//
// State: Upstash Redis (REST) when KV_REST_API_URL / UPSTASH_REDIS_REST_URL is configured; otherwise the function
// instance's memory (Fluid compute keeps one warm instance serving every request at this scale).
// TURN (optional, for players behind strict NATs): TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL, or a Cloudflare
// Realtime TURN key: CF_TURN_KEY_ID + CF_TURN_KEY_TOKEN.
import { randomBytes } from 'node:crypto';

const TTL = 30;                    // presence lifetime (s)
const INBOX_MAX = 400;
const Q_STALE = 9000;              // a queued player who hasn't polled in this long has left the queue (ms)
const GATHER = +(process.env.ZU_GATHER_MS ?? 0) || 60_000;   // a match forms as soon as 2 players are queued and stays open
                                   // this long (hero select + loading): anyone who queues meanwhile joins it; AI bots fill
                                   // every slot still empty (ZU_GATHER_MS shortens it for the e2e test)
const LATE_CUT = Math.min(12_000, GATHER / 4);   // ...but nobody is added in the last 12 s (time to link up and pick a hero)
const FULL_START = 12_000;         // a full lobby (10 players) starts this soon instead
const SLOTS = { tank: 1, damage: 2, support: 2 };
const QUEUES = ['qp', 'comp'];

const REST = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const mem = globalThis.__zuNet || (globalThis.__zuNet = { players: new Map(), inbox: new Map(), queue: new Map(), forming: new Map(), prof: new Map(), ice: null });

async function redis(cmds) {
  const r = await fetch(`${REST}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map(x => x.result);
}

const store = REST && TOKEN ? {
  kind: 'redis',
  async hello(p) { await redis([['SET', `zu:p:${p.id}`, JSON.stringify(p), 'EX', TTL], ['SADD', 'zu:players', p.id]]); },
  async players() {
    const [ids] = await redis([['SMEMBERS', 'zu:players']]);
    if (!ids?.length) return [];
    const vals = await redis(ids.map(id => ['GET', `zu:p:${id}`]));
    const dead = ids.filter((_, i) => !vals[i]);
    if (dead.length) await redis([['SREM', 'zu:players', ...dead]]);
    return vals.filter(Boolean).map(v => JSON.parse(v));
  },
  async send(to, msg) { await redis([['RPUSH', `zu:i:${to}`, JSON.stringify(msg)], ['LTRIM', `zu:i:${to}`, -INBOX_MAX, -1], ['EXPIRE', `zu:i:${to}`, 60]]); },
  async drain(id) {
    const [msgs] = await redis([['LRANGE', `zu:i:${id}`, 0, -1], ['DEL', `zu:i:${id}`]]);
    return (msgs || []).map(m => JSON.parse(m));
  },
  async bye(id) { await redis([['DEL', `zu:p:${id}`], ['SREM', 'zu:players', id], ...QUEUES.map(q => ['HDEL', `zu:q:${q}`, id])]); },
  async enqueue(e) { await redis([...QUEUES.map(q => ['HDEL', `zu:q:${q}`, e.id]), ['HSET', `zu:q:${e.q}`, e.id, JSON.stringify(e)]]); },
  async dequeue(id) { await redis(QUEUES.map(q => ['HDEL', `zu:q:${q}`, id])); },
  async queue(q) { const [flat] = await redis([['HGETALL', `zu:q:${q}`]]); const out = []; for (let i = 0; i + 1 < (flat || []).length; i += 2) out.push(JSON.parse(flat[i + 1])); return out; },
  async forming() { const [flat] = await redis([['HGETALL', 'zu:forming']]); const out = []; for (let i = 0; i + 1 < (flat || []).length; i += 2) out.push(JSON.parse(flat[i + 1])); return out; },
  async putForming(m) { await redis([['HSET', 'zu:forming', m.match, JSON.stringify(m)]]); },
  async dropForming(id) { await redis([['HDEL', 'zu:forming', id]]); },
  async lock() { const [ok] = await redis([['SET', 'zu:mmlock', '1', 'NX', 'PX', 2000]]); return ok === 'OK'; },
  async unlock() { await redis([['DEL', 'zu:mmlock']]); },
  async setProf(id, card) { await redis([['SET', `zu:prof:${id}`, JSON.stringify(card), 'EX', 900]]); },
  async getProf(id) { const [v] = await redis([['GET', `zu:prof:${id}`]]); return v ? JSON.parse(v) : null; },
} : {
  kind: 'memory',
  async hello(p) { mem.players.set(p.id, { ...p, at: Date.now() }); },
  async players() {
    const now = Date.now();
    for (const [id, p] of mem.players) if (now - p.at > TTL * 1000) mem.players.delete(id);
    return [...mem.players.values()].map(({ at, ...p }) => p);
  },
  async send(to, msg) {
    const q = mem.inbox.get(to) || [];
    q.push(msg); if (q.length > INBOX_MAX) q.splice(0, q.length - INBOX_MAX);
    mem.inbox.set(to, q);
  },
  async drain(id) { const q = mem.inbox.get(id) || []; mem.inbox.delete(id); return q; },
  async bye(id) { mem.players.delete(id); mem.inbox.delete(id); mem.queue.delete(id); },
  async enqueue(e) { mem.queue.set(e.id, e); },
  async dequeue(id) { mem.queue.delete(id); },
  async queue(q) { return [...mem.queue.values()].filter(e => e.q === q); },
  async forming() { return [...mem.forming.values()]; },
  async putForming(m) { mem.forming.set(m.match, m); },
  async dropForming(id) { mem.forming.delete(id); },
  async lock() { return true; },
  async unlock() {},
  async setProf(id, card) { mem.prof.set(id, { card, at: Date.now() }); if (mem.prof.size > 2000) mem.prof.delete(mem.prof.keys().next().value); },
  async getProf(id) { const p = mem.prof.get(id); return p && Date.now() - p.at < 900_000 ? p.card : null; },
};

const clean = s => String(s ?? '').replace(/[^\w .\-']/g, '').slice(0, 24);
/** free text shown in lobby lists (no markup characters) */
const text = (s, n = 60) => String(s ?? '').replace(/[<>&"`\\]/g, '').slice(0, n);
const num = (v, lo, hi, d = 0) => { const n = +v; return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const STATUS = ['lobby', 'squad', 'playing', 'queue', 'custom', 'online'];

// ---------------------------------------------------------------- matchmaking
// The player base is small, so a match never waits for ten: as soon as two players are in a queue a match FORMS
// (sides, roles, host), and for the next minute - hero select and loading - everyone else who queues is slotted into
// it. At the start the host fills every empty slot on both sides with AI. More people online = fewer bots.
const ROLES = ['tank', 'damage', 'support'];
const roleFree = (players, team, role) => SLOTS[role] - players.filter(p => p.team === team && p.role === role).length;
/**
 * Slot one queued player into a forming match (pure, exported for the tests): the role they queued for (flex: the
 * role with the most room on either side), on the side with fewer humans (then the lower total rating). Returns the
 * player as placed, or null when there is no room.
 */
export function placeInto(match, e) {
  const room = role => roleFree(match.players, 'zenith', role) + roleFree(match.players, 'umbra', role);
  const roles = e.role === 'flex' ? [...ROLES].sort((a, b) => room(b) - room(a)) : [e.role];
  const side = t => match.players.filter(p => p.team === t);
  const cnt = t => side(t).length, sum = t => side(t).reduce((s, p) => s + p.mmr, 0);
  for (const role of roles) {
    const teams = ['zenith', 'umbra'].filter(t => roleFree(match.players, t, role) > 0).sort((a, b) => cnt(a) - cnt(b) || sum(a) - sum(b));
    if (teams.length) return { id: e.id, name: e.name, team: teams[0], role, mmr: e.mmr, score: e.score, platform: e.platform };
  }
  return null;
}
/**
 * Pair up queued players into new forming matches (pure, exported for the tests): the longest-waiting player and
 * whoever else is in the queue (a rating window that widens fast - a small player base must still find a game), up to
 * ten, sides balanced. Returns [{ q, host, players }]; a lone player keeps waiting.
 */
export function formMatches(entries, now = Date.now()) {
  const out = [];
  const left = [...entries].sort((a, b) => a.at - b.at);
  while (left.length >= 2) {
    const anchor = left[0], wait = (now - anchor.at) / 1000;
    const win = (anchor.q === 'comp' ? 500 : 800) + wait * 150;
    const m = { players: [] };
    for (const e of left) {
      if (m.players.length >= 10) break;
      if (e !== anchor && Math.abs(e.mmr - anchor.mmr) > win) continue;
      const p = placeInto(m, e); if (p) m.players.push(p);
    }
    if (m.players.length < 2) { left.shift(); continue; }
    out.push({ q: anchor.q, host: electHost(m.players), players: m.players });
    for (const p of m.players) left.splice(left.findIndex(e => e.id === p.id), 1);
  }
  return out;
}
/** the host: the best connection (speed-test score), the desktop app breaking ties */
export const electHost = players => [...players].sort((a, b) => b.score - a.score || (b.platform === 'desktop' ? 1 : 0) - (a.platform === 'desktop' ? 1 : 0))[0].id;
const pub = p => ({ id: p.id, name: p.name, team: p.team, role: p.role, mmr: p.mmr, score: p.score, platform: p.platform });

async function matchmake(now) {
  if (!(await store.lock())) return;
  try {
    const all = await store.forming();
    const forming = all.filter(m => now < m.startAt + 30_000);
    for (const m of all) if (!forming.includes(m)) await store.dropForming(m.match);
    for (const q of QUEUES) {
      const live = [];
      for (const e of await store.queue(q)) { if (now - e.seen > Q_STALE) await store.dequeue(e.id); else live.push(e); }
      live.sort((a, b) => a.at - b.at);
      // 1) late joiners: into a forming match of this queue that still has room and time
      for (const m of forming.filter(x => x.q === q && now < x.startAt - LATE_CUT)) {
        let changed = false;
        for (const e of [...live]) {
          if (m.players.length >= 10) break;
          const p = placeInto(m, e); if (!p) continue;
          m.players.push(p); live.splice(live.indexOf(e), 1); changed = true;
          await store.dequeue(e.id);
          if (m.players.length >= 10) m.startAt = Math.min(m.startAt, now + FULL_START);
          await store.send(e.id, { t: 'mm_match', from: 'node', mid: `${m.match}${e.id}`, match: m.match, q, host: m.host, players: m.players.map(pub), seed: m.seed, startAt: m.startAt, late: true });
          await store.send(m.host, { t: 'mm_add', from: 'node', mid: `${m.match}+${e.id}`, match: m.match, player: pub(p), startAt: m.startAt });
        }
        if (changed) await store.putForming(m);
      }
      // 2) new matches from whoever is left (two players are enough)
      for (const f of formMatches(live, now)) {
        const match = `m${now.toString(36)}${randomBytes(3).toString('hex')}`;
        const m = { match, q, host: f.host, players: f.players, seed: randomBytes(4).readUInt32LE(0), at: now, startAt: now + (f.players.length >= 10 ? FULL_START : GATHER) };
        await store.putForming(m);
        for (const p of m.players) {
          await store.dequeue(p.id);
          await store.send(p.id, { t: 'mm_match', from: 'node', mid: `${match}${p.id}`, match, q, host: m.host, players: m.players.map(pub), seed: m.seed, startAt: m.startAt });
        }
      }
    }
  } finally { await store.unlock(); }
}
/** a player left a forming match (a host leaving ends it: everyone goes back to the queue) */
async function leaveForming(id, matchId) {
  const m = (await store.forming()).find(x => x.match === matchId); if (!m) return;
  if (m.host === id) { await store.dropForming(matchId); return; }
  m.players = m.players.filter(p => p.id !== id);
  await store.putForming(m);
}

// ---------------------------------------------------------------- ICE servers
async function iceServers() {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];
  const { TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL, CF_TURN_KEY_ID, CF_TURN_KEY_TOKEN } = process.env;
  if (TURN_URLS && TURN_USERNAME && TURN_CREDENTIAL) list.push({ urls: TURN_URLS.split(',').map(s => s.trim()), username: TURN_USERNAME, credential: TURN_CREDENTIAL });
  if (CF_TURN_KEY_ID && CF_TURN_KEY_TOKEN) {
    if (!mem.ice || Date.now() > mem.ice.until) {
      try {
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${CF_TURN_KEY_ID}/credentials/generate-ice-servers`, {
          method: 'POST', headers: { Authorization: `Bearer ${CF_TURN_KEY_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }),
        });
        const j = await r.json();
        const s = Array.isArray(j.iceServers) ? j.iceServers : j.iceServers ? [j.iceServers] : [];
        mem.ice = { servers: s.filter(x => x.username), until: Date.now() + 43_200_000 };
      } catch { mem.ice = { servers: [], until: Date.now() + 60_000 }; }
    }
    list.push(...mem.ice.servers);
  }
  return list;
}

// ---------------------------------------------------------------- handler
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const q = req.query || {};
  if (req.method === 'GET') {
    if (q.ping !== undefined) return res.status(200).json({ t: Date.now() });
    if (q.bw !== undefined) {
      const n = num(q.bw, 1024, 1 << 20, 65536);
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.status(200).send(randomBytes(n));
    }
    if (q.ice !== undefined) return res.status(200).json({ iceServers: await iceServers() });
    if (q.prof !== undefined) return res.status(200).json({ prof: await store.getProf(clean(q.prof)) });
    const players = await store.players();
    return res.status(200).json({ ok: true, store: store.kind, players: players.length, queued: QUEUES.reduce((s, x) => s + players.filter(p => p.status === 'queue' && p.mission === x).length, 0) });
  }
  if (req.method !== 'POST') return res.status(405).end();
  if (q.bw !== undefined) {
    // upload test: the body is thrown away, its size returned
    const b = req.body;
    const n = Buffer.isBuffer(b) ? b.length : typeof b === 'string' ? b.length : JSON.stringify(b ?? '').length;
    return res.status(200).json({ n });
  }
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const id = clean(b.id);
    if (!id || id.length < 6) return res.status(400).json({ error: 'id' });
    const now = Date.now(), out = { t: now };
    if (b.me) {
      const m = b.me;
      await store.hello({
        id, name: clean(m.name) || 'Hero', status: STATUS.includes(m.status) ? m.status : 'lobby', mission: clean(m.mission),
        platform: m.platform === 'desktop' ? 'desktop' : 'web', v: +m.v || 1,
        ...(m.info ? { info: text(m.info) } : {}), ...(m.ping ? { ping: Math.round(num(m.ping, 0, 9999)) } : {}),
        ...(m.lvl ? { lvl: Math.round(num(m.lvl, 0, 99999)) } : {}), ...(m.rank ? { rank: text(m.rank, 24) } : {}),
        ...(m.score ? { score: Math.round(num(m.score, 0, 1000)) } : {}),
      });
    }
    // outgoing messages (signalling / relay), max 64 per request
    for (const o of (Array.isArray(b.out) ? b.out : []).slice(0, 64)) {
      const to = clean(o.to);
      if (to && o.msg && JSON.stringify(o.msg).length < 60000) await store.send(to, { ...o.msg, from: id });
    }
    if (b.prof && typeof b.prof === 'object' && JSON.stringify(b.prof).length < 4000) await store.setProf(id, b.prof);
    // matchmaking: join / stay (every poll while searching) / leave
    if (b.mm && typeof b.mm === 'object') {
      const mm = b.mm;
      if (mm.op === 'leave') { await store.dequeue(id); if (mm.match) await leaveForming(id, clean(mm.match)); }
      else if (mm.op === 'join' || mm.op === 'stay') {
        const qn = QUEUES.includes(mm.q) ? mm.q : 'qp';
        const role = ['tank', 'damage', 'support', 'flex'].includes(mm.role) ? mm.role : 'flex';
        const prev = mm.op === 'stay' ? (await store.queue(qn)).find(e => e.id === id) : null;
        if (mm.op === 'join' || prev) {
          await store.enqueue({ id, name: clean(b.me?.name) || 'Hero', q: qn, role: qn === 'comp' && role === 'flex' ? 'damage' : role, mmr: num(mm.mmr, 0, 3999, 1800), score: num(mm.score, 0, 1000, 50),
            platform: b.me?.platform === 'desktop' ? 'desktop' : 'web', at: prev?.at ?? now, seen: now });
        }
        await matchmake(now);
        const qq = await store.queue(qn);
        out.mm = { queued: qq.length, in: qq.some(e => e.id === id) };
      }
    }
    if (b.bye) await store.bye(id);
    if (b.list) out.players = (await store.players()).filter(p => p.id !== id);
    out.inbox = await store.drain(id);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
