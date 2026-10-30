// The daily plain-language note. Everything here is a sentence built from numbers the person can check.
import { dayIn, shiftDay, avg, r1 } from './time.js';

const fmtInt = (n) => Math.round(n).toLocaleString();
export function dailyNote({ sessions, daily, records = [], warning, tz = 'UTC', today, name }) {
  const day = dayIn(tz), t = today || day(new Date()), y = shiftDay(t, -1);
  const yest = sessions.filter((s) => day(s.start_at) === y);
  const lastNight = daily.find((d) => d.date === t) || daily.find((d) => d.date === y);
  const week = daily.filter((d) => d.date < t && d.date >= shiftDay(t, -7));
  const parts = [];

  if (yest.length) {
    const bits = yest.map((s) => {
      const b = [s.title.toLowerCase()];
      if (s.volume_kg) b.push(`${fmtInt(s.volume_kg)} kg`);
      if (s.distance_km) b.push(`${s.distance_km.toFixed(1)} km${s.pace_min_km ? ` at ${s.pace_min_km.toFixed(2)}/km` : ''}`);
      if (s.avg_hr) b.push(`avg ${s.avg_hr} bpm`);
      return b.join(', ');
    });
    parts.push(`Yesterday: ${bits.join('; ')}.`);
  } else parts.push('Yesterday was a rest day.');

  if (lastNight?.sleep_hours != null) {
    const base = avg(week, 'sleep_hours');
    let s = `You slept ${lastNight.sleep_hours.toFixed(1)} h`;
    if (base != null && Math.abs(lastNight.sleep_hours - base) >= 0.5) s += lastNight.sleep_hours < base ? `, under your ${base.toFixed(1)} h week average` : `, more than your usual ${base.toFixed(1)} h`;
    parts.push(s + '.');
  }
  const signals = [];
  if (lastNight?.resting_hr != null) { const base = avg(week, 'resting_hr'); if (base != null && Math.round(lastNight.resting_hr - base) >= 3) signals.push(`resting HR is up ${Math.round(lastNight.resting_hr - base)}`); }
  if (lastNight?.hrv_ms != null) { const base = avg(week, 'hrv_ms'); if (base != null && lastNight.hrv_ms < base * 0.85) signals.push(`HRV is ${Math.round((1 - lastNight.hrv_ms / base) * 100)}% below your week`); }
  const shortSleep = lastNight?.sleep_hours != null && lastNight.sleep_hours < 6;

  if (warning?.level === 'high') parts.push(`Your training load this week is ${warning.acwr}× your monthly norm, which is where injuries start: make today easy or rest.`);
  else if (signals.length || shortSleep) parts.push(`${signals.length ? signals.join(' and ').replace(/^./, (c) => c.toUpperCase()) + (shortSleep ? ' after a short night' : '') : 'That is a short night'}, so go lighter today.`);
  else if (warning?.level === 'rising') parts.push(`Load is climbing (${warning.acwr}× your norm). Fine for now; keep the next hard day at least two days away.`);
  else if (warning?.level === 'low' && !yest.length) parts.push('Recovery looks good and load is low: a good day to push.');
  else if (lastNight) parts.push('Recovery looks normal. Train as planned.');

  const fresh = records.filter((r) => r.fresh);
  if (fresh.length) parts.push(`New record${fresh.length > 1 ? 's' : ''}: ${fresh.slice(0, 2).map((r) => `${r.kind.toLowerCase()} for ${r.what} (${r.detail})`).join(' and ')}.`);
  return parts.join(' ');
}
