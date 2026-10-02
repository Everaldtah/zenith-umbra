// A local copy of the online node (api/net.js) for testing online play without deploying:
//   node scripts/net-local.mjs [port]          (ZU_GATHER_MS=15000 shortens the matchmaking gather minute)
// then run the game with VITE_NET_URL=http://localhost:<port>/api/net (e.g. `VITE_NET_URL=... npx vite`).
import http from 'node:http';
import handler from '../api/net.js';

const port = +(process.argv[2] || 8788);
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (!url.pathname.startsWith('/api/net')) { res.writeHead(404).end(); return; }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const ct = req.headers['content-type'] || '';
  const body = !raw.length ? undefined : ct.includes('json') ? JSON.parse(raw.toString() || '{}') : ct.includes('octet-stream') ? raw : raw.toString();
  // the Vercel Node response helpers the handler uses
  let code = 200;
  const r = {
    setHeader: (k, v) => res.setHeader(k, v),
    status(c) { code = c; return r; },
    json(j) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); },
    send(b) { res.writeHead(code); res.end(b); },
    end() { res.writeHead(code); res.end(); },
  };
  try { await handler({ method: req.method, query: Object.fromEntries(url.searchParams), body, headers: req.headers }, r); }
  catch (e) { res.writeHead(500); res.end(String(e)); }
}).listen(port, () => console.log(`online node on http://localhost:${port}/api/net`));
