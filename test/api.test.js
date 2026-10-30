// End-to-end over HTTP against the real server.js (Express swapped for a tiny shim; see test/shim).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'hub-api-')), 't.db');
process.env.ALLOW_DEV_LOGIN = 'true'; process.env.BASE_URL = 'http://localhost:3999'; process.env.PORT = '3999'; process.env.SESSION_SECRET = 's';
delete process.env.GOOGLE_CLIENT_ID; delete process.env.STRAVA_CLIENT_ID;
const { server } = await import('../src/server.js');
after(() => server.close());
await new Promise((r) => setTimeout(r, 150));
const B = 'http://localhost:3999';
let cookie = '';
const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const r = await fetch(B + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', cookie, ...headers }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc && !headers.authorization) cookie = sc.split(';')[0];
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, location: r.headers.get('location') };
};
const START = new Date(Date.now() - 3 * 3600_000).toISOString(), iso = (m) => new Date(Date.parse(START) + m * 60_000).toISOString();

test('anonymous: me, static page, data routes locked', async () => {
  const me = await call('/api/me'); assert.equal(me.json.user, null); assert.equal(me.json.devLogin, true);
  assert.equal((await call('/')).status, 200);
  assert.equal((await call('/api/summary')).status, 401);
  assert.equal((await call('/auth/google')).status, 503);
});

test('dev login, then consent is required before any data', async () => {
  assert.equal((await call('/auth/dev', { method: 'POST', body: { name: 'Tester' } })).status, 200);
  const me = await call('/api/me'); assert.equal(me.json.user.name, 'Tester'); assert.equal(me.json.user.consented, false);
  const s = await call('/api/summary'); assert.equal(s.status, 403); assert.equal(s.json.error, 'consent_required');
  assert.equal((await call('/api/consent', { method: 'POST', body: { agree: false } })).status, 400);
  assert.equal((await call('/api/consent', { method: 'POST', body: { agree: true } })).status, 200);
  assert.equal((await call('/api/summary')).status, 200);
});

test('profile validation and timezone', async () => {
  assert.equal((await call('/api/profile', { method: 'POST', body: { age: 5 } })).status, 400);
  assert.equal((await call('/api/profile', { method: 'POST', body: { timezone: 'Mars/Olympus' } })).status, 400);
  assert.equal((await call('/api/profile', { method: 'POST', body: { age: 31, weight_kg: 72, timezone: 'Asia/Kolkata', share_activity: true } })).status, 200);
  const me = await call('/api/me'); assert.equal(me.json.user.age, 31); assert.equal(me.json.user.share_activity, true);
  assert.equal((await call('/api/summary')).json.timezone, 'Asia/Kolkata');
});

test('pair phone, ingest with device token, rejoin, duplicate hidden, compare', async () => {
  const pair = await call('/api/connect/phone', { method: 'POST', body: { platform: 'healthconnect' } });
  assert.match(pair.json.ingestUrl, /\/api\/ingest$/); const token = pair.json.token;
  const bad = await call('/api/ingest', { method: 'POST', headers: { authorization: 'Bearer nope' }, body: { hr: [] } }); assert.equal(bad.status, 401);
  // a lifting session we pretend came from Hevy (write directly: no Hevy server in tests)
  const db = await import('../src/db.js'); const uid = (await call('/api/me')).json.user.id;
  db.upsertSession({ id: 'hevy:1', user_id: uid, source: 'Hevy', type: 'Strength', title: 'Push day', start_at: START, end_at: iso(45), duration_min: 45, volume_kg: 4000,
    exercises: [{ name: 'Bench Press', sets: [{ weight_kg: 60, reps: 8, t: iso(1) }, { weight_kg: 62.5, reps: 6, t: iso(6) }] }, { name: 'Overhead Press', sets: [{ weight_kg: 40, reps: 8, t: iso(25) }] }] });
  const hr = Array.from({ length: 90 }, (_, i) => ({ at: new Date(Date.parse(START) + i * 30_000).toISOString(), bpm: i < 50 ? 140 : 118 }));
  const ing = await call('/api/ingest', { method: 'POST', headers: { authorization: `Bearer ${token}` },
    body: { hr, daily: [{ date: START.slice(0, 10), sleep_hours: 6.1, resting_hr: 60, hrv_ms: 40, steps: 8000 }],
      workouts: [{ id: 'w1', type: 'Strength', title: 'Workout', start_at: iso(1), end_at: iso(45), calories: 300 }] } });
  assert.equal(ing.status, 200); assert.equal(ing.json.hr, 90); assert.equal(ing.json.workouts, 1);
  const sessions = (await call('/api/sessions')).json;
  assert.equal(sessions.length, 1, 'phone workout is a duplicate of the Hevy one'); assert.equal(sessions[0].id, 'hevy:1');
  assert.ok(sessions[0].avg_hr > 125 && sessions[0].hr_source === 'healthconnect');
  assert.equal((await call('/api/sessions?all=1')).json.length, 2);
  const sum = (await call('/api/summary')).json;
  assert.equal(sum.last_session_cost.length, 2); assert.equal(sum.last_session_cost[0].timed, true); assert.equal(sum.last_session_cost_summary.spike, 'Bench Press');
  assert.ok(sum.records.some((r) => r.what === 'Bench Press' && r.value === 62.5));
  assert.ok(sum.note.length > 10);
  const hrRoute = (await call('/api/session/hevy%3A1/hr')).json; assert.equal(hrRoute.length, 90);
  db.upsertSession({ id: 'hevy:0', user_id: uid, source: 'Hevy', type: 'Strength', title: 'Push day', start_at: iso(-10080), end_at: iso(-10035), duration_min: 45, volume_kg: 3600, exercises: [{ name: 'Bench Press', sets: [{ weight_kg: 57.5, reps: 8 }] }] });
  const cmp = (await call('/api/compare?a=hevy:0&b=hevy:1')).json;
  assert.equal(cmp.totals.volume_kg.delta, 400); assert.equal(cmp.exercises[0].b.top, 62.5);
  assert.equal((await call('/api/compare?a=hevy:0&b=zzz')).status, 404);
});

test('demo data fills every screen and can be removed', async () => {
  const d = await call('/api/demo', { method: 'POST' }); assert.equal(d.status, 200); assert.ok(d.json.joined >= 25, `joined ${d.json.joined}`);
  assert.equal((await call('/api/me')).json.demo, true);
  const sum = (await call('/api/summary')).json;
  assert.ok(sum.week.sessions >= 4 && sum.week.volume > 10000, JSON.stringify(sum.week));
  assert.ok(sum.records.length >= 5 && sum.last_session.avg_hr > 100 && sum.load.some((x) => x.load > 0));
  const lifts = (await call('/api/sessions')).json.filter((x) => x.id.startsWith('demo:lift:')); assert.ok(lifts.length >= 10 && lifts.every((x) => x.avg_hr > 100 && x.exercises.length === 4));
  assert.notEqual(sum.warning.level, 'none');
  assert.match(sum.note, /Yesterday/);
  assert.equal((await call('/api/sync', { method: 'POST' })).json.message?.includes('Nothing to sync'), true);
  assert.equal((await call('/api/demo', { method: 'DELETE' })).status, 200);
  const after = (await call('/api/sessions')).json; assert.ok(after.every((x) => !x.id.startsWith('demo:')));
  assert.equal((await call('/api/me')).json.demo, false);
});

test('friends endpoints', async () => {
  assert.equal((await call('/api/friends', { method: 'POST', body: { email: 'not-an-email' } })).status, 400);
  const f = (await call('/api/friends', { method: 'POST', body: { email: 'Pal@example.com' } })).json;
  assert.deepEqual(f.pending, ['pal@example.com']); assert.equal(f.friends, 0);
  assert.equal((await call('/api/friends/pal@example.com', { method: 'DELETE' })).json.pending.length, 0);
});

test('ingest rate limit and account deletion', async () => {
  const token = (await call('/api/connect/phone', { method: 'POST', body: { platform: 'healthconnect' } })).json.token;
  let last; for (let i = 0; i < 61; i++) last = await call('/api/ingest', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: {} });
  assert.equal(last.status, 429);
  assert.equal((await call('/api/me', { method: 'DELETE' })).status, 200);
  assert.equal((await call('/api/me')).json.user, null);
});
