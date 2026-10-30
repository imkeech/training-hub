// Demo data: six weeks of a Push/Pull/Legs plan with two runs a week, plus band data, so a new account
// can see every screen working before connecting anything. Everything is tagged so it can be removed cleanly.
import * as db from './db.js';
import { joinHeartRate } from './join.js';

const rnd = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const PLAN = { 1: 'Push', 2: 'Run', 3: 'Pull', 4: 'Rest', 5: 'Legs', 6: 'Run', 0: 'Rest' }; // JS getDay: 0 = Sunday
const EX = {
  Push: [['Bench Press', 4, 8, 60], ['Overhead Press', 3, 8, 40], ['Incline Dumbbell Press', 3, 10, 24], ['Tricep Pushdown', 3, 12, 25]],
  Pull: [['Deadlift', 3, 5, 110], ['Barbell Row', 4, 8, 60], ['Lat Pulldown', 3, 10, 55], ['Bicep Curl', 3, 12, 14]],
  Legs: [['Back Squat', 4, 6, 90], ['Romanian Deadlift', 3, 8, 80], ['Leg Press', 3, 10, 140], ['Walking Lunge', 3, 12, 20]],
};

export function seedDemo(userId, { days = 42, now = new Date() } = {}) {
  clearDemo(userId);
  const r = rnd(7), u = (a, b) => a + r() * (b - a);
  const dailyRows = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i); d.setHours(7, 0, 0, 0);
    const date = d.toISOString().slice(0, 10), wk = Math.floor((days - 1 - i) / 7);
    const sleep = Math.round(u(5.6, 7.9) * 10) / 10, rhr = Math.round(58 + (wk >= 4 ? 2 : 0) + u(-2, 2) + (sleep < 6 ? 3 : 0));
    dailyRows.push({ date, sleep_hours: sleep, sleep_score: Math.round(Math.min(95, Math.max(50, sleep * 11 + u(-6, 6)))), resting_hr: rhr,
      hrv_ms: Math.round(44 - (7.5 - sleep) * 4 + u(-5, 5)), steps: Math.round(u(5200, 11800)), spo2_pct: Math.round(u(94.5, 98.2) * 10) / 10,
      breathing_rate: Math.round(u(13.2, 16.4) * 10) / 10, skin_temp_var_c: Math.round(u(-0.6, 0.7) * 10) / 10,
      sleep_deep_min: Math.round(sleep * 60 * u(0.14, 0.22)), sleep_rem_min: Math.round(sleep * 60 * u(0.18, 0.25)), sleep_awake_min: Math.round(u(12, 40)),
      readiness: Math.round(Math.max(25, Math.min(97, 58 + (sleep - 6.5) * 10 - (rhr - 58) * 1.2))) });
    const kind = PLAN[d.getDay()];
    if (kind === 'Rest' || d > now) continue;
    const start = d, hr = [];
    if (kind === 'Run') {
      const km = Math.round(([5, 6, 8, 10][Math.floor(r() * 4)] + u(-0.3, 0.4)) * 10) / 10, pace = Math.round((u(5.4, 6.2) - wk * 0.04) * 100) / 100, mins = Math.round(km * pace);
      const end = new Date(start.getTime() + mins * 60_000);
      db.upsertSession({ id: `demo:run:${date}`, user_id: userId, source: 'Strava', type: 'Run', title: km < 7 ? 'Easy run' : 'Long run', start_at: start.toISOString(), end_at: end.toISOString(), duration_min: mins, distance_km: km, pace_min_km: pace });
      for (let m = 0; m <= mins; m += 0.5) hr.push({ at: new Date(start.getTime() + m * 60_000).toISOString(), bpm: Math.round(m < 3 ? 110 + m * 12 : 148 + Math.sin(m / 4) * 6 + u(-3, 3)) });
    } else {
      const exercises = []; let sets = 0, reps = 0, vol = 0, t = 3;
      for (const [name, s, rp, w] of EX[kind]) { const kg = w + wk * 2.5; const list = []; for (let k = 0; k < s; k++) { list.push({ weight_kg: kg, reps: rp, t: new Date(start.getTime() + t * 60_000).toISOString() }); t += 3; } t += 2; exercises.push({ name, sets: list }); sets += s; reps += s * rp; vol += s * rp * kg; }
      const mins = t + 2, end = new Date(start.getTime() + mins * 60_000);
      db.upsertSession({ id: `demo:lift:${date}`, user_id: userId, source: 'Hevy', type: 'Strength', title: `${kind} day`, start_at: start.toISOString(), end_at: end.toISOString(), duration_min: mins, sets, reps, volume_kg: Math.round(vol), exercises });
      for (let m = 0; m <= mins; m += 0.5) { const inSet = (m % 3) < 1.2; hr.push({ at: new Date(start.getTime() + m * 60_000).toISOString(), bpm: Math.round((inSet ? 142 : 112) + (kind === 'Pull' && m < 12 ? 10 : 0) + u(-4, 4)) }); }
    }
    db.insertHrSamples(userId, 'demo', hr);
  }
  db.upsertDaily(userId, 'demo', dailyRows);
  return joinHeartRate(userId);
}

export function clearDemo(userId) {
  db.db.prepare("DELETE FROM sessions WHERE user_id = ? AND id LIKE 'demo:%'").run(userId);
  db.db.prepare("DELETE FROM hr_samples WHERE user_id = ? AND source = 'demo'").run(userId);
  db.db.prepare("DELETE FROM daily WHERE user_id = ? AND source = 'demo'").run(userId);
}
export const hasDemo = (userId) => !!db.db.prepare("SELECT 1 FROM sessions WHERE user_id = ? AND id LIKE 'demo:%' LIMIT 1").get(userId);
