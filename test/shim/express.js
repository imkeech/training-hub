// Minimal Express look-alike for tests only (production uses the real express). Supports what server.js uses.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const match = (pattern, path) => { const keys = []; const re = new RegExp('^' + pattern.replace(/:([^/]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'); const m = path.match(re); return m && Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])); };
function app() {
  const stack = [];
  const a = { settings: {}, set(k, v) { a.settings[k] = v; }, use(fn) { stack.push({ use: fn }); }, listen: (p, cb) => { const s = http.createServer(handler); s.listen(p, cb); return s; } };
  for (const m of ['get', 'post', 'delete']) a[m] = (path, ...fns) => stack.push({ method: m.toUpperCase(), path, fns });
  async function handler(req, res) {
    const url = new URL(req.url, 'http://x'); req.path = url.pathname; req.query = Object.fromEntries(url.searchParams); req.headers = req.headers || {};
    let raw = ''; for await (const c of req) raw += c; req.body = {}; if (raw && /json/.test(req.headers['content-type'] || '')) { try { req.body = JSON.parse(raw); } catch { res.statusCode = 400; return res.end('bad json'); } }
    res.status = (c) => { res.statusCode = c; return res; }; res.json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); }; res.send = (s) => res.end(String(s)); res.redirect = (l) => { res.statusCode = 302; res.setHeader('location', l); res.end(); };
    let i = 0; const next = async () => { const layer = stack[i++]; if (!layer) { res.statusCode = 404; return res.end('not found'); }
      if (layer.use) return layer.use(req, res, next);
      if (layer.method !== req.method) return next(); const params = match(layer.path, req.path); if (!params) return next(); req.params = params;
      let j = 0; const run = async () => { const fn = layer.fns[j++]; if (!fn) return; await fn(req, res, run); }; await run(); };
    try { await next(); } catch (e) { res.statusCode = 500; res.end(e.message); }
  }
  return a;
}
app.json = () => (req, res, next) => next(); app.urlencoded = () => (req, res, next) => next();
app.static = (dir) => async (req, res, next) => { if (req.method !== 'GET') return next(); try { res.end(await readFile(join(dir, req.path === '/' ? 'index.html' : req.path))); } catch { next(); } };
export default app;
