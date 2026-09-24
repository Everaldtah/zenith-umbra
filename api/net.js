// ZENITH//UMBRA online lobby + signalling node (Vercel Node function).
// Players (web or the Windows app) POST here to announce presence, list squads, and pass WebRTC signalling /
// low-rate relay messages to each other. Gameplay itself goes peer-to-peer once WebRTC connects.
//
// State: Upstash Redis (REST) when KV_REST_API_URL / UPSTASH_REDIS_REST_URL is configured; otherwise the
// function instance's memory (Fluid compute keeps one warm instance serving all requests at this scale).
const TTL = 30;                    // presence lifetime (s)
const INBOX_MAX = 400;

const REST = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const mem = globalThis.__zuNet || (globalThis.__zuNet = { players: new Map(), inbox: new Map() });

async function redis(cmds) {
  const r = await fetch(`${REST}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map(x => x.result);
}

const store = REST && TOKEN ? {
  async hello(p) {
    await redis([['SET', `zu:p:${p.id}`, JSON.stringify(p), 'EX', TTL], ['SADD', 'zu:players', p.id]]);
  },
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
  async bye(id) { await redis([['DEL', `zu:p:${id}`], ['SREM', 'zu:players', id]]); },
} : {
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
  async bye(id) { mem.players.delete(id); mem.inbox.delete(id); },
};

const clean = s => String(s ?? '').replace(/[^\w .\-']/g, '').slice(0, 24);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return res.status(200).json({ ok: true, store: REST ? 'redis' : 'memory', players: (await store.players()).length });
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const id = clean(b.id);
    if (!id || id.length < 6) return res.status(400).json({ error: 'id' });
    const out = { t: Date.now() };
    if (b.me) await store.hello({ id, name: clean(b.me.name) || 'Hero', status: clean(b.me.status) || 'lobby', mission: clean(b.me.mission), platform: b.me.platform === 'desktop' ? 'desktop' : 'web', v: +b.me.v || 1 });
    // outgoing messages (signalling / relay), max 64 per request
    for (const m of (Array.isArray(b.out) ? b.out : []).slice(0, 64)) {
      const to = clean(m.to);
      if (to && m.msg && JSON.stringify(m.msg).length < 60000) await store.send(to, { ...m.msg, from: id });
    }
    if (b.bye) await store.bye(id);
    if (b.list) out.players = (await store.players()).filter(p => p.id !== id);
    out.inbox = await store.drain(id);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
