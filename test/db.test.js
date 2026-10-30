import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'hub-')), 'test.db');
process.env.TOKEN_KEY = 'test-key';
const db = await import('../src/db.js');
const { joinHeartRate, rejoinWindow } = await import('../src/join.js');
const { summary, compare, friendsBoard } = await import('../src/summary.js');
const { backup } = await import('../scripts/backup.js');
const { seal, open } = await import('../src/crypto.js');

const iso = (base, min) => new Date(Date.parse(base) + min * 60_000).toISOString();
const todayStart = new Date(); todayStart.setUTCHours(7, 0, 0, 0); const START = todayStart.toISOString();
const samples = (from, n, bpm) => Array.from({ length: n }, (_, i) => ({ at: iso(from, i), bpm: bpm + (i % 3) }));

test('tokens are encrypted at rest and readable through the API', () => {
  assert.notEqual(seal('abc'), 'abc'); assert.equal(open(seal('abc')), 'abc'); assert.equal(open('legacy-plain'), 'legacy-plain');
  const u = db.upsertUser({ email: 'a@x.test', name: 'A' });
  db.saveConnection(u.id, 'strava', { access_token: 'tok123', refresh_token: 'ref456', expires_at: 1 });
  assert.ok(db.rawConnection(u.id, 'strava').access_token.startsWith('enc:'));
  assert.equal(db.getConnection(u.id, 'strava').access_token, 'tok123');
  assert.equal(db.getConnection(u.id, 'strava').refresh_token, 'ref456');
});

test('join, late data rejoin, device calories win over estimate, duplicates hidden', () => {
  const u = db.upsertUser({ email: 'b@x.test', name: 'B' });
  db.updateProfile(u.id, { age: 28, weight_kg: 74, max_hr: 195, timezone: 'UTC' });
  db.upsertSession({ id: 'hevy:1', user_id: u.id, source: 'Hevy', type: 'Strength', title: 'Pull day', start_at: START, end_at: iso(START, 50), duration_min: 50, volume_kg: 6000,
    exercises: [{ name: 'Deadlift', sets: [{ weight_kg: 120, reps: 3 }] }, { name: 'Row', sets: [{ weight_kg: 60, reps: 8 }] }] });
  assert.equal(joinHeartRate(u.id), 0, 'no samples yet');
  assert.ok(db.getSession(u.id, 'hevy:1').load > 0, 'load scored even without HR');
  // phone uploads hours later
  db.insertHrSamples(u.id, 'healthconnect', samples(START, 50, 130));
  assert.equal(rejoinWindow(u.id, samples(START, 50, 130)), 1);
  let s = db.getSession(u.id, 'hevy:1');
  assert.equal(s.hr_source, 'healthconnect'); assert.ok(s.avg_hr >= 130 && s.avg_hr <= 132); assert.ok(s.calories_est > 0); assert.equal(s.calories, null);
  // a denser second upload (every 20s) replaces the first join
  const dense = Array.from({ length: 150 }, (_, i) => ({ at: new Date(Date.parse(START) + i * 20_000).toISOString(), bpm: 140 }));
  db.insertHrSamples(u.id, 'healthconnect', dense); rejoinWindow(u.id, dense);
  s = db.getSession(u.id, 'hevy:1'); assert.ok(s.avg_hr >= 137, `rejoined avg ${s.avg_hr}`);
  // same run from Strava and the phone, the phone one carries device calories
  db.upsertSession({ id: 'strava:7', user_id: u.id, source: 'Strava', type: 'Run', title: 'Run', start_at: iso(START, 120), end_at: iso(START, 156), duration_min: 36, distance_km: 6.2, pace_min_km: 5.8 });
  db.upsertSession({ id: 'healthconnect:9', user_id: u.id, source: 'Health Connect', type: 'Run', title: 'Running', start_at: iso(START, 121), end_at: iso(START, 156), duration_min: 35, distance_km: 6.3, calories: 410 });
  joinHeartRate(u.id);
  const visible = db.listSessions(u.id);
  assert.deepEqual(visible.map((x) => x.id).sort(), ['hevy:1', 'strava:7']);
  assert.equal(db.getSession(u.id, 'healthconnect:9').duplicate_of, 'strava:7');
  assert.equal(db.listSessions(u.id, 500, { includeDuplicates: true }).length, 3);
  // upsert never wipes a value with null (re-sync without calories keeps calories)
  db.upsertSession({ id: 'healthconnect:9', user_id: u.id, source: 'Health Connect', type: 'Run', start_at: iso(START, 121), end_at: iso(START, 156) });
  assert.equal(db.getSession(u.id, 'healthconnect:9').calories, 410);
});

test('summary, compare and the daily note come out of real rows', () => {
  const u = db.userByEmail('b@x.test');
  db.upsertDaily(u.id, 'healthconnect', [{ date: new Date().toISOString().slice(0, 10), sleep_hours: 5.5, resting_hr: 64, hrv_ms: 30 }]);
  db.upsertDaily(u.id, 'strava', [{ date: new Date().toISOString().slice(0, 10), steps: 9000 }]); // merges with the band row
  const s = summary(u.id);
  assert.equal(s.week.sessions, 2); assert.equal(s.week.volume, 6000); assert.equal(s.week.run_km, 6.2);
  assert.equal(s.latest_day.steps, 9000); assert.equal(s.latest_day.sleep_hours, 5.5);
  assert.ok(typeof s.note === 'string' && s.note.length > 20, s.note);
  assert.equal(s.load.length, 42); assert.equal(s.warning.level, 'none', 'no chronic base yet');
  assert.ok(s.records.some((r) => r.kind === 'Heaviest set' && r.what === 'Deadlift' && r.fresh));
  assert.equal(s.last_session_cost.length, 0, 'last session is the run: no exercises');
  db.upsertSession({ id: 'hevy:2', user_id: u.id, source: 'Hevy', type: 'Strength', title: 'Pull day', start_at: iso(START, -20160), end_at: iso(START, -20110), duration_min: 50, volume_kg: 5200,
    exercises: [{ name: 'Deadlift', sets: [{ weight_kg: 110, reps: 3 }] }, { name: 'Row', sets: [{ weight_kg: 55, reps: 8 }] }] });
  const c = compare(u.id, 'hevy:2', 'hevy:1');
  assert.equal(c.totals.volume_kg.delta, 800);
  assert.equal(c.exercises.find((e) => e.name === 'Deadlift').b.top, 120);
  assert.equal(c.exercises.find((e) => e.name === 'Deadlift').b.avg_hr, db.getSession(u.id, 'hevy:1').avg_hr);
  assert.equal(compare(u.id, 'hevy:1', 'nope'), null);
});

test('friends: mutual and opted-in only', () => {
  const a = db.userByEmail('a@x.test'), b = db.userByEmail('b@x.test');
  assert.equal(friendsBoard(a.id).optedIn, false);
  db.updateProfile(a.id, { share_activity: true }); db.addFriend(a.id, 'B@x.test');
  assert.equal(friendsBoard(a.id).friends, 0, 'one-way add is not a friendship');
  db.addFriend(b.id, 'a@x.test');
  assert.equal(friendsBoard(a.id).friends, 0, 'B has not opted in');
  db.updateProfile(b.id, { share_activity: true });
  const board = friendsBoard(a.id);
  assert.equal(board.friends, 1); assert.equal(board.trainedToday, 1); assert.equal(board.leaderboard[0].name, 'B');
  db.removeFriend(a.id, 'b@x.test'); assert.equal(friendsBoard(a.id).friends, 0);
});

test('consent, profile defaults and account deletion cascade', () => {
  const u = db.upsertUser({ email: 'c@x.test', name: 'C' });
  assert.equal(u.consented_at, null); db.consent(u.id); assert.ok(db.getUser(u.id).consented_at);
  assert.deepEqual(db.physiology(u), { age: 30, weightKg: 70, maxHr: 187 });
  db.saveConnection(u.id, 'hevy', { access_token: 'k' }); db.insertHrSamples(u.id, 'healthconnect', samples(START, 5, 100));
  db.deleteUserData(u.id);
  assert.equal(db.getUser(u.id), undefined); assert.equal(db.getConnection(u.id, 'hevy'), undefined); assert.equal(db.hrBetween(u.id, '2000', '2100').length, 0);
});

test('backup writes a snapshot and prunes old ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-bak-'));
  const f = backup(dir, 2); assert.ok(existsSync(f));
  backup(dir, 2); backup(dir, 2);
  assert.equal(readdirSync(dir).length, 2);
});
