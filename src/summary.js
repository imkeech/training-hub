import * as db from './db.js';
import { dayIn, shiftDay, avg, r1 } from './insights/time.js';
import { loadSeries, rampWarning } from './insights/load.js';
import { personalRecords } from './insights/records.js';
import { dailyNote } from './insights/note.js';
import { exerciseHrCost, hrCostSummary } from './insights/hrcost.js';

export function summary(userId) {
  const user = db.getUser(userId), tz = user.timezone || process.env.TIMEZONE || 'UTC', day = dayIn(tz), today = day(new Date());
  const sessions = db.listSessions(userId, 500), daily = db.listDaily(userId, 90);
  const inWin = (d, back) => d > shiftDay(today, -(back + 7)) && d <= shiftDay(today, -back);
  const win = (back) => {
    const s = sessions.filter((x) => inWin(day(x.start_at), back)), d = daily.filter((x) => inWin(x.date, back));
    return { sessions: s.length, volume: s.reduce((a, x) => a + (x.volume_kg || 0), 0), run_km: s.reduce((a, x) => a + (x.type === 'Run' ? x.distance_km || 0 : 0), 0),
      load: s.reduce((a, x) => a + (x.load || 0), 0), sleep: avg(d, 'sleep_hours'), rhr: avg(d, 'resting_hr'), hrv: avg(d, 'hrv_ms') };
  };
  const a = win(0), b = win(7), delta = (k) => (a[k] == null || b[k] == null ? null : r1(a[k] - b[k]));
  const series = loadSeries(sessions, daily, { days: 42, today, tz, maxHr: db.physiology(user).maxHr });
  const warning = rampWarning(series);
  const records = personalRecords(sessions, daily, { today });
  const last = sessions[0] || null;
  const lastCost = last ? exerciseHrCost(last, db.hrBetween(userId, last.start_at, last.end_at)) : [];
  return {
    today, timezone: tz,
    note: dailyNote({ sessions, daily, records, warning, tz, today, name: user.name }),
    week: { sessions: a.sessions, sessions_delta: a.sessions - b.sessions, volume: Math.round(a.volume), volume_delta: Math.round(a.volume - b.volume),
      run_km: r1(a.run_km), run_km_delta: r1(a.run_km - b.run_km), load: Math.round(a.load), load_delta: Math.round(a.load - b.load),
      sleep: r1(a.sleep), sleep_delta: delta('sleep'), rhr: a.rhr == null ? null : Math.round(a.rhr), rhr_delta: delta('rhr'), hrv: r1(a.hrv) },
    load: series, warning, records: records.slice(0, 12),
    last_session: last, last_session_cost: lastCost, last_session_cost_summary: hrCostSummary(lastCost),
    latest_day: daily[daily.length - 1] || null, sources: [...new Set(sessions.map((s) => s.source))],
    profile_complete: !!(user.age && user.weight_kg),
  };
}

// Two sessions side by side, with per-exercise rows aligned by name.
export function compare(userId, idA, idB) {
  const A = db.getSession(userId, idA), B = db.getSession(userId, idB);
  if (!A || !B) return null;
  const costA = exerciseHrCost(A, db.hrBetween(userId, A.start_at, A.end_at)), costB = exerciseHrCost(B, db.hrBetween(userId, B.start_at, B.end_at));
  const byName = (list) => Object.fromEntries(list.map((c) => [c.name, c]));
  const ca = byName(costA), cb = byName(costB);
  const exVol = (s) => Object.fromEntries((s.exercises || []).map((e) => [e.name, { volume: e.sets.reduce((x, st) => x + (st.weight_kg || 0) * (st.reps || 0), 0), top: Math.max(0, ...e.sets.map((st) => st.weight_kg || 0)), sets: e.sets.length }]));
  const va = exVol(A), vb = exVol(B);
  const names = [...new Set([...Object.keys(va), ...Object.keys(vb)])];
  const metric = (k) => ({ a: A[k] ?? null, b: B[k] ?? null, delta: A[k] != null && B[k] != null ? r1(B[k] - A[k]) : null });
  return { a: A, b: B,
    totals: { duration_min: metric('duration_min'), volume_kg: metric('volume_kg'), distance_km: metric('distance_km'), pace_min_km: metric('pace_min_km'), avg_hr: metric('avg_hr'), max_hr: metric('max_hr'), hard_min: metric('hard_min'), calories: { a: A.calories ?? A.calories_est, b: B.calories ?? B.calories_est }, load: metric('load') },
    exercises: names.map((n) => ({ name: n, a: va[n] ? { ...va[n], avg_hr: ca[n]?.avg_hr ?? null, peak_hr: ca[n]?.peak_hr ?? null } : null, b: vb[n] ? { ...vb[n], avg_hr: cb[n]?.avg_hr ?? null, peak_hr: cb[n]?.peak_hr ?? null } : null })) };
}

// Friends: how many trained today, and a week leaderboard. Only mutual, opted-in friends; only if I opted in too.
export function friendsBoard(userId) {
  const me = db.getUser(userId);
  if (!me.share_activity) return { optedIn: false, friends: [], trainedToday: 0, leaderboard: [] };
  const tz = me.timezone || process.env.TIMEZONE || 'UTC', day = dayIn(tz), today = day(new Date()), weekStart = shiftDay(today, -6);
  const people = [{ id: me.id, name: me.name || 'You', me: true }, ...db.mutualFriends(userId).map((f) => ({ id: f.id, name: f.name || f.email.split('@')[0], me: false }))];
  let trainedToday = 0;
  const leaderboard = people.map((p) => {
    const s = db.listSessions(p.id, 200).filter((x) => day(x.start_at) >= weekStart);
    if (!p.me && s.some((x) => day(x.start_at) === today)) trainedToday++;
    return { name: p.name, me: p.me, sessions: s.length, volume_kg: Math.round(s.reduce((a, x) => a + (x.volume_kg || 0), 0)), run_km: r1(s.reduce((a, x) => a + (x.type === 'Run' ? x.distance_km || 0 : 0), 0)), load: Math.round(s.reduce((a, x) => a + (x.load || 0), 0)) };
  }).sort((a, b) => b.load - a.load);
  return { optedIn: true, friends: people.length - 1, pending: db.myFriendEmails(userId), trainedToday, leaderboard };
}
