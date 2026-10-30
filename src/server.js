import './env.js';
import express from 'express';
import cookieSession from 'cookie-session';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as db from './db.js';
import * as strava from './sources/strava.js';
import * as hevy from './sources/hevy.js';
import * as phone from './sources/phone.js';
import * as gh from './sources/googlehealth.js';
import { joinHeartRate, rejoinWindow } from './join.js';
import { summary, compare, friendsBoard } from './summary.js';
import { seedDemo, clearDemo, hasDemo } from './demo.js';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieSession({ name: 'hub', secret: process.env.SESSION_SECRET || 'dev-only', maxAge: 30 * 86_400_000,
  httpOnly: true, sameSite: 'lax', secure: process.env.BASE_URL?.startsWith('https') }));
app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));

const me = (req) => (req.session.uid ? db.getUser(req.session.uid) : null);
const requireLogin = (req, res, next) => (me(req) ? next() : res.status(401).json({ error: 'Sign in first' }));
const requireUser = (req, res, next) => { const u = me(req); if (!u) return res.status(401).json({ error: 'Sign in first' }); if (!u.consented_at) return res.status(403).json({ error: 'consent_required' }); next(); };
const devLoginAllowed = () => !process.env.GOOGLE_CLIENT_ID && process.env.ALLOW_DEV_LOGIN === 'true' && !(process.env.BASE_URL || '').startsWith('https');
const state = (req) => { req.session.oauthState = randomBytes(8).toString('hex'); return req.session.oauthState; };
const checkState = (req) => req.query.state && req.query.state === req.session.oauthState;

// ---------- sign-in ----------
app.get('/auth/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).send('Google sign-in is not configured on this server yet.');
  const p = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: `${process.env.BASE_URL}/auth/google/callback`,
    response_type: 'code', scope: 'openid email profile', state: state(req) });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
});
app.get('/auth/google/callback', async (req, res) => {
  if (!checkState(req) || !req.query.code) return res.status(400).send('Sign-in was cancelled or the link expired. Go back and try again.');
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: req.query.code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${process.env.BASE_URL}/auth/google/callback`, grant_type: 'authorization_code' }) });
    const t = await r.json();
    if (!t.id_token) throw new Error(t.error_description || 'Google did not return an identity');
    const claims = JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64url').toString());
    if (!claims.email_verified) throw new Error('Email not verified with Google');
    req.session.uid = db.upsertUser({ email: claims.email, name: claims.name }).id;
    res.redirect('/');
  } catch (e) { res.status(500).send(`Sign-in failed: ${e.message}`); }
});
// Friends-only fallback when Google sign-in isn't configured yet. Remove before opening to strangers.
app.post('/auth/dev', (req, res) => {
  if (!devLoginAllowed()) return res.status(404).end();
  const name = String(req.body.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Name required' });
  req.session.uid = db.upsertUser({ email: `${name.toLowerCase().replace(/\s+/g, '.')}@dev.local`, name }).id;
  res.json({ ok: true });
});
app.post('/auth/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

// ---------- connections ----------
app.get('/auth/strava', requireUser, (req, res) => res.redirect(strava.authorizeUrl(state(req))));
app.get('/auth/strava/callback', requireUser, async (req, res) => {
  if (!checkState(req)) return res.status(400).send('Bad state');
  try { await strava.handleCallback(me(req).id, req.query.code); strava.sync(me(req).id).then(() => joinHeartRate(me(req).id)).catch(() => {}); }
  catch (e) { return res.status(500).send(e.message); }
  res.redirect('/#connections');
});
app.get('/auth/googlehealth', requireUser, (req, res) => gh.enabled() ? res.redirect(gh.authorizeUrl(state(req))) : res.status(404).send('Not configured'));
app.get('/auth/googlehealth/callback', requireUser, async (req, res) => {
  if (!checkState(req)) return res.status(400).send('Bad state');
  try { await gh.handleCallback(me(req).id, req.query.code); } catch (e) { return res.status(500).send(e.message); }
  res.redirect('/#connections');
});
app.post('/api/connect/hevy', requireUser, async (req, res) => {
  try { await hevy.connect(me(req).id, String(req.body.apiKey || '').trim()); hevy.sync(me(req).id).then(() => joinHeartRate(me(req).id)).catch(() => {}); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/connect/phone', requireUser, (req, res) => {
  const platform = req.body.platform === 'applehealth' ? 'applehealth' : 'healthconnect';
  res.json({ token: phone.pair(me(req).id, platform), ingestUrl: `${process.env.BASE_URL}/api/ingest` });
});
app.delete('/api/connect/:source', requireUser, (req, res) => { db.deleteConnection(me(req).id, req.params.source); res.json({ ok: true }); });

// The companion app calls this. Bearer token = device token from "Pair phone".
const ingestHits = new Map(); // token -> [count, windowStart]; 60 uploads/hour per device
app.post('/api/ingest', (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const h = ingestHits.get(token) || [0, Date.now()]; if (Date.now() - h[1] > 3_600_000) { h[0] = 0; h[1] = Date.now(); }
  if (++h[0] > 60) return res.status(429).json({ error: 'Too many uploads; try again later' }); ingestHits.set(token, h);
  const result = token && phone.ingest(token, req.body || {});
  if (!result) return res.status(401).json({ error: 'Unknown device token' });
  if (Array.isArray(req.body?.hr) && req.body.hr.length) rejoinWindow(result.userId, req.body.hr.filter((s) => s?.at)); else joinHeartRate(result.userId);
  res.json(result);
});

// ---------- data ----------
app.post('/api/sync', requireUser, async (req, res) => {
  const uid = me(req).id, out = {};
  if (!db.listConnections(uid).some((c) => ['strava', 'hevy', 'googlehealth'].includes(c.source))) return res.json({ message: 'Nothing to sync yet: connect Strava or Hevy first, or load demo data.' });
  for (const [name, mod] of [['strava', strava], ['hevy', hevy], ['googlehealth', gh]]) {
    if (!db.getConnection(uid, name)) continue;
    try { out[name] = await mod.sync(uid); } catch (e) { out[name] = `error: ${e.message}`; }
  }
  out.joined = joinHeartRate(uid);
  res.json(out);
});
app.get('/api/me', (req, res) => {
  const u = me(req);
  if (!u) return res.json({ user: null, devLogin: devLoginAllowed(), googleLogin: !!process.env.GOOGLE_CLIENT_ID });
  res.json({ user: { id: u.id, name: u.name, email: u.email, age: u.age, weight_kg: u.weight_kg, max_hr: u.max_hr, timezone: u.timezone, share_activity: !!u.share_activity, consented: !!u.consented_at }, connections: db.listConnections(u.id),
    available: { strava: !!process.env.STRAVA_CLIENT_ID, googlehealth: gh.enabled(), hevy: true, phone: true }, demo: hasDemo(u.id) });
});
app.get('/api/sessions', requireUser, (req, res) => res.json(db.listSessions(me(req).id, 500, { includeDuplicates: req.query.all === '1' })));
app.get('/api/daily', requireUser, (req, res) => res.json(db.listDaily(me(req).id)));
app.get('/api/summary', requireUser, (req, res) => res.json(summary(me(req).id)));
app.get('/api/compare', requireUser, (req, res) => { const c = compare(me(req).id, String(req.query.a || ''), String(req.query.b || '')); c ? res.json(c) : res.status(404).json({ error: 'Pick two of your own sessions' }); });
app.post('/api/consent', requireLogin, (req, res) => { if (req.body?.agree !== true) return res.status(400).json({ error: 'Tick the box to continue' }); db.consent(me(req).id); res.json({ ok: true }); });
app.post('/api/profile', requireLogin, (req, res) => {
  const b = req.body || {}, num = (v, lo, hi) => (v === '' || v == null ? null : Number.isFinite(+v) && +v >= lo && +v <= hi ? +v : undefined);
  const age = num(b.age, 10, 100), weight_kg = num(b.weight_kg, 25, 300), max_hr = num(b.max_hr, 100, 230);
  if ([age, weight_kg, max_hr].includes(undefined)) return res.status(400).json({ error: 'Age 10–100, weight 25–300 kg, max HR 100–230' });
  let timezone = b.timezone ? String(b.timezone) : null; try { if (timezone) Intl.DateTimeFormat(undefined, { timeZone: timezone }); } catch { return res.status(400).json({ error: 'Unknown timezone' }); }
  db.updateProfile(me(req).id, { age, weight_kg, max_hr, timezone, share_activity: typeof b.share_activity === 'boolean' ? b.share_activity : null });
  db.resetHrInWindow(me(req).id, '1970', '2100'); joinHeartRate(me(req).id); // estimates depend on the profile: recompute
  res.json({ ok: true });
});
app.post('/api/demo', requireUser, (req, res) => res.json({ joined: seedDemo(me(req).id) }));
app.delete('/api/demo', requireUser, (req, res) => { clearDemo(me(req).id); res.json({ ok: true }); });
app.get('/api/friends', requireUser, (req, res) => res.json(friendsBoard(me(req).id)));
app.post('/api/friends', requireUser, (req, res) => { const email = String(req.body?.email || '').trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter an email address' }); db.addFriend(me(req).id, email); res.json(friendsBoard(me(req).id)); });
app.delete('/api/friends/:email', requireUser, (req, res) => { db.removeFriend(me(req).id, req.params.email); res.json(friendsBoard(me(req).id)); });
app.get('/api/session/:id/hr', requireUser, (req, res) => { // the scrub-able trace for one session
  const s = db.getSession(me(req).id, req.params.id);
  if (!s) return res.status(404).json({ error: 'No such session' });
  res.json(db.hrBetween(me(req).id, s.start_at, s.end_at));
});
app.delete('/api/me', requireUser, (req, res) => { db.deleteUserData(me(req).id); req.session = null; res.json({ ok: true }); }); // delete everything on request

export const server = app.listen(process.env.PORT || 3000, () => console.log(`Training Hub on ${process.env.BASE_URL || 'http://localhost:3000'}`));
