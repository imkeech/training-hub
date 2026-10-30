import test from 'node:test';
import assert from 'node:assert/strict';
import { joinSession } from '../src/insights/join.js';
import { sessionLoad, loadSeries, rampWarning } from '../src/insights/load.js';
import { personalRecords } from '../src/insights/records.js';
import { exerciseHrCost, hrCostSummary } from '../src/insights/hrcost.js';
import { exerciseWindows, exerciseAt, setAt } from '../src/insights/exercises.js';
import { findDuplicates } from '../src/insights/dedup.js';
import { dailyNote } from '../src/insights/note.js';
import { dayIn, shiftDay } from '../src/insights/time.js';

const iso = (base, min) => new Date(Date.parse(base) + min * 60_000).toISOString();
const START = '2026-10-28T07:00:00Z';
const pull = { id: 'hevy:1', source: 'Hevy', type: 'Strength', title: 'Pull day', start_at: START, end_at: iso(START, 56), duration_min: 56, volume_kg: 6361,
  exercises: [{ name: 'Deadlift', sets: [{ weight_kg: 110, reps: 5 }, { weight_kg: 110, reps: 5 }] }, { name: 'Barbell Row', sets: [{ weight_kg: 60, reps: 8 }] }] };
// HR: high during deadlift (0–28 min), lower during rows, dipping at the end of each window
const samples = Array.from({ length: 112 }, (_, i) => { const m = i / 2; const dl = m < 28; const tail = dl ? m > 22 : m > 50;
  return { source: 'healthconnect', at: iso(START, m), bpm: tail ? (dl ? 112 : 104) : dl ? 150 : 128 }; });

test('time helpers respect timezone', () => {
  assert.equal(dayIn('Asia/Kolkata')('2026-10-28T20:30:00Z'), '2026-10-29'); // 02:00 IST next day
  assert.equal(dayIn('UTC')('2026-10-28T20:30:00Z'), '2026-10-28');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
});

test('join: avg, max, hard minutes, calories, source', () => {
  const r = joinSession(pull, samples, { age: 30, weightKg: 70 });
  assert.equal(r.hr_source, 'healthconnect');
  assert.equal(r.max_hr, 150);
  assert.ok(r.avg_hr > 120 && r.avg_hr < 140, `avg ${r.avg_hr}`);
  assert.ok(r.hard_min >= 20 && r.hard_min <= 24, `hard ${r.hard_min}`); // 150 bpm ≥ 0.7×187 for ~22 min
  assert.ok(r.calories_est > 200 && r.calories_est < 700);
  assert.equal(joinSession(pull, samples.slice(0, 3)), null, 'too few samples → null');
  assert.ok(joinSession(pull, samples, { age: 30, weightKg: 70, maxHr: 230 }).hard_min < r.hard_min, 'higher max HR → fewer hard minutes');
});

test('join prefers the denser source', () => {
  const sparse = samples.filter((_, i) => i % 10 === 0).map((s) => ({ ...s, source: 'strava', bpm: 99 }));
  assert.equal(joinSession(pull, [...samples, ...sparse]).hr_source, 'healthconnect');
});

test('load: HR-based beats type default; series and ramp warning', () => {
  assert.ok(sessionLoad({ ...pull, avg_hr: 150 }, 190) > sessionLoad({ ...pull, avg_hr: 110 }, 190));
  assert.equal(sessionLoad({ type: 'Run', duration_min: 30 }), 42);
  const today = '2026-10-28';
  const easyMonth = Array.from({ length: 20 }, (_, i) => ({ type: 'Strength', duration_min: 40, start_at: shiftDay(today, -(i + 8)) + 'T07:00:00Z' }));
  const hardWeek = Array.from({ length: 7 }, (_, i) => ({ type: 'Run', duration_min: 90, avg_hr: 160, start_at: shiftDay(today, -i) + 'T07:00:00Z' }));
  const quiet = loadSeries(easyMonth, [], { today });
  assert.equal(quiet.length, 42);
  assert.equal(rampWarning(quiet).level, 'low');
  const spike = loadSeries([...easyMonth, ...hardWeek], [{ date: today, sleep_hours: 6, hrv_ms: 40 }], { today });
  assert.equal(spike[spike.length - 1].sleep_hours, 6);
  assert.equal(rampWarning(spike).level, 'high');
  assert.equal(rampWarning(loadSeries([], [], { today })).level, 'none');
});

test('records: heaviest set, fastest 5k, deep sleep, freshness', () => {
  const run1 = { id: 'r1', type: 'Run', title: 'Run', start_at: '2026-10-10T06:00:00Z', distance_km: 6, pace_min_km: 6.0 };
  const run2 = { id: 'r2', type: 'Run', title: 'Run', start_at: '2026-10-27T06:00:00Z', distance_km: 5.2, pace_min_km: 5.5 };
  const old = { ...pull, id: 'old', start_at: '2026-10-01T07:00:00Z', exercises: [{ name: 'Deadlift', sets: [{ weight_kg: 120, reps: 3 }] }] };
  const recs = personalRecords([pull, run1, run2, old], [{ date: '2026-10-20', sleep_deep_min: 70 }, { date: '2026-10-27', sleep_deep_min: 95 }], { today: '2026-10-28' });
  const by = Object.fromEntries(recs.map((r) => [r.kind + '|' + r.what, r]));
  assert.equal(by['Heaviest set|Deadlift'].value, 120); assert.equal(by['Heaviest set|Deadlift'].fresh, false);
  assert.equal(by['Fastest 5 km|Run'].date, '2026-10-27'); assert.equal(by['Fastest 5 km|Run'].fresh, true);
  assert.equal(by['Longest run|Run'].value, 6);
  assert.equal(by['Most deep sleep|Night'].value, 95);
  assert.equal(by['Heaviest set|Barbell Row'].fresh, true);
});

test('exercise windows: even spread vs real set timestamps', () => {
  const even = exerciseWindows(pull);
  assert.deepEqual(even.map((w) => [w.from, w.to]), [[0, 0.5], [0.5, 1]]);
  assert.equal(exerciseAt(even, 0.7).name, 'Barbell Row');
  const timed = { ...pull, exercises: [{ name: 'Deadlift', sets: [{ t: iso(START, 2) }, { t: iso(START, 10) }] }, { name: 'Row', sets: [{ t: iso(START, 40) }] }] };
  const w = exerciseWindows(timed);
  assert.ok(w[0].timed && Math.abs(w[0].to - 40 / 56) < 1e-9);
  assert.equal(setAt(w[0], 11 / 56), 2);
  assert.equal(setAt(w[0], 1 / 56), 1);
});

test('hr cost per exercise and summary', () => {
  const c = exerciseHrCost(pull, samples);
  assert.equal(c.length, 2);
  assert.equal(c[0].peak_hr, 150); assert.equal(c[1].peak_hr, 128);
  assert.equal(c[0].recovery_bpm, 38); // 150 → 112 in the tail
  const s = hrCostSummary(c);
  assert.equal(s.spike, 'Deadlift'); assert.equal(s.least_recovered, 'Barbell Row');
  assert.deepEqual(exerciseHrCost(pull, []), []);
});

test('dedup: same run from Strava and the phone', () => {
  const strava = { id: 'strava:1', source: 'Strava', type: 'Run', start_at: START, distance_km: 6.2 };
  const phone = { id: 'healthconnect:1', source: 'Health Connect', type: 'Run', start_at: iso(START, 1), distance_km: 6.3 };
  const farPhone = { id: 'healthconnect:2', source: 'Health Connect', type: 'Run', start_at: iso(START, 5), distance_km: 6.3 };
  const lift = { id: 'hevy:9', source: 'Hevy', type: 'Strength', start_at: iso(START, 1) };
  const pairs = findDuplicates([strava, phone, farPhone, lift]);
  assert.deepEqual(pairs, [{ keep: 'strava:1', drop: 'healthconnect:1' }]);
  assert.deepEqual(findDuplicates([strava, { ...phone, distance_km: 9 }]), [], 'distance mismatch is not a duplicate');
});

test('daily note reads naturally and reacts to recovery', () => {
  const today = '2026-10-29';
  const sess = { ...pull, avg_hr: 125, start_at: '2026-10-28T07:00:00Z' };
  const week = Array.from({ length: 7 }, (_, i) => ({ date: shiftDay(today, -(i + 1)), sleep_hours: 7.2, resting_hr: 58, hrv_ms: 45 }));
  const good = dailyNote({ sessions: [sess], daily: [...week, { date: today, sleep_hours: 7.3, resting_hr: 58, hrv_ms: 46 }], today });
  assert.match(good, /^Yesterday: pull day, 6,361 kg, avg 125 bpm\./);
  assert.match(good, /Train as planned/);
  const bad = dailyNote({ sessions: [sess], daily: [...week, { date: today, sleep_hours: 5.7, resting_hr: 62, hrv_ms: 32 }], today });
  assert.match(bad, /5\.7 h, under your 7\.2 h week average/);
  assert.match(bad, /Resting HR is up 4 and HRV is 29% below your week after a short night, so go lighter today\./);
  const rest = dailyNote({ sessions: [], daily: [], today });
  assert.equal(rest, 'Yesterday was a rest day.');
  const rec = dailyNote({ sessions: [sess], daily: [], today, records: [{ kind: 'Heaviest set', what: 'Deadlift', detail: '120 kg × 3', fresh: true }] });
  assert.match(rec, /New record: heaviest set for Deadlift \(120 kg × 3\)\./);
  const high = dailyNote({ sessions: [sess], daily: [], today, warning: { level: 'high', acwr: 1.8 } });
  assert.match(high, /1\.8× your monthly norm/);
});
