// Personal records that notice themselves: best weight per exercise, fastest 5 km, longest deep sleep.
import { shiftDay } from './time.js';

export function personalRecords(sessions, daily, { today, freshDays = 7 } = {}) {
  const fresh = today ? shiftDay(today, -freshDays) : null, out = [], best = {};
  const keep = (key, r) => { if (!best[key] || r.value > best[key].value) best[key] = r; };
  for (const s of [...sessions].sort((a, b) => (a.start_at < b.start_at ? -1 : 1))) {
    const date = s.start_at.slice(0, 10);
    for (const e of s.exercises || []) for (const st of e.sets || []) if (st.weight_kg > 0 && st.reps > 0)
      keep(`weight:${e.name}`, { kind: 'Heaviest set', what: e.name, value: st.weight_kg, unit: 'kg', detail: `${st.weight_kg} kg × ${st.reps}`, date, session_id: s.id });
    if (s.type === 'Strength' && s.volume_kg) keep('volume', { kind: 'Biggest session', what: s.title, value: s.volume_kg, unit: 'kg', detail: `${Math.round(s.volume_kg).toLocaleString()} kg`, date, session_id: s.id });
    if (s.type === 'Run' && s.distance_km >= 5 && s.pace_min_km) { const t = s.pace_min_km * 5; // minutes for 5 km at that pace
      keep('5k', { kind: 'Fastest 5 km', what: s.title, value: -t, unit: 'min', detail: `${Math.floor(t)}:${String(Math.round((t % 1) * 60)).padStart(2, '0')} (${s.pace_min_km.toFixed(2)} /km)`, date, session_id: s.id }); }
    if (s.type === 'Run' && s.distance_km) keep('longest', { kind: 'Longest run', what: s.title, value: s.distance_km, unit: 'km', detail: `${s.distance_km.toFixed(1)} km`, date, session_id: s.id });
  }
  for (const d of daily) {
    if (d.sleep_deep_min) keep('deep', { kind: 'Most deep sleep', what: 'Night', value: d.sleep_deep_min, unit: 'min', detail: `${d.sleep_deep_min} min deep`, date: d.date });
    if (d.hrv_ms) keep('hrv', { kind: 'Highest HRV', what: 'Night', value: d.hrv_ms, unit: 'ms', detail: `${d.hrv_ms} ms`, date: d.date });
  }
  for (const r of Object.values(best)) out.push({ ...r, fresh: !!fresh && r.date > fresh });
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}
