// Training load per session (TRIMP-style), acute vs chronic load, and a ramp warning.
import { dayIn, shiftDay, avg, r1 } from './time.js';

export function sessionLoad(s, maxHr = 190) {
  const dur = s.duration_min || 0;
  let f;
  if (s.avg_hr) { const rel = Math.max(0, Math.min(1, (s.avg_hr - 60) / (maxHr - 60))); f = 0.4 + 2.4 * rel * rel; }
  else f = s.type === 'Run' ? 1.4 : s.type === 'Ride' ? 1.1 : s.type === 'Strength' ? 1.0 : 0.7;
  return Math.round(dur * f);
}

// One row per day for the last `days` days: load, 7-day acute, 28-day chronic, their ratio, and recovery signals.
export function loadSeries(sessions, daily, { days = 42, today, tz = 'UTC', maxHr = 190 } = {}) {
  const day = dayIn(tz), end = today || day(new Date());
  const loadBy = new Map();
  for (const s of sessions) { const d = day(s.start_at); loadBy.set(d, (loadBy.get(d) || 0) + (s.load ?? sessionLoad(s, maxHr))); }
  const dailyBy = new Map(daily.map((d) => [d.date, d]));
  const out = [];
  for (let i = days + 27; i >= 0; i--) {
    const d = shiftDay(end, -i), load = loadBy.get(d) || 0;
    out.push({ date: d, load });
  }
  for (let i = 0; i < out.length; i++) {
    const w7 = out.slice(Math.max(0, i - 6), i + 1), w28 = out.slice(Math.max(0, i - 27), i + 1);
    out[i].acute = r1(w7.reduce((a, x) => a + x.load, 0) / 7);
    out[i].chronic = r1(w28.reduce((a, x) => a + x.load, 0) / 28);
    out[i].acwr = out[i].chronic > 0 ? r1(out[i].acute / out[i].chronic) : null;
    const dd = dailyBy.get(out[i].date) || {};
    out[i].sleep_hours = dd.sleep_hours ?? null; out[i].hrv_ms = dd.hrv_ms ?? null; out[i].resting_hr = dd.resting_hr ?? null;
  }
  return out.slice(-days);
}

// 'high' when the last week is >1.5× the month's norm, 'rising' above 1.3, 'low' under 0.8 after a real base, else 'ok'.
export function rampWarning(series) {
  const last = series[series.length - 1];
  if (!last || last.acwr == null || last.chronic < 5) return { level: 'none', acwr: last?.acwr ?? null };
  const level = last.acwr > 1.5 ? 'high' : last.acwr > 1.3 ? 'rising' : last.acwr < 0.8 ? 'low' : 'ok';
  return { level, acwr: last.acwr, acute: last.acute, chronic: last.chronic };
}
