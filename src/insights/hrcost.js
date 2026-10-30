// Per-exercise heart-rate cost: average and peak HR inside each exercise's window, and how far HR
// came back down before the next exercise started (recovery). Needs the session's HR samples.
import { exerciseWindows } from './exercises.js';

export function exerciseHrCost(session, samples) {
  const wins = exerciseWindows(session);
  if (!wins.length || samples.length < 5) return [];
  const t0 = Date.parse(session.start_at), span = Date.parse(session.end_at) - t0;
  const at = (s) => (Date.parse(s.at) - t0) / span;
  return wins.map((w, i) => {
    const inside = samples.filter((s) => { const t = at(s); return t >= w.from && t <= w.to; });
    if (!inside.length) return { name: w.name, sets: w.sets, avg_hr: null, peak_hr: null, recovery_bpm: null, timed: w.timed };
    const avg = Math.round(inside.reduce((a, s) => a + s.bpm, 0) / inside.length);
    const peak = Math.max(...inside.map((s) => s.bpm));
    // Recovery: peak minus the lowest HR in the last 20% of the window (rest before moving on).
    const tail = inside.filter((s) => at(s) >= w.from + (w.to - w.from) * 0.8);
    const low = tail.length ? Math.min(...tail.map((s) => s.bpm)) : null;
    return { name: w.name, sets: w.sets, avg_hr: avg, peak_hr: peak, recovery_bpm: low == null ? null : peak - low, timed: w.timed, order: i };
  });
}
// Which exercise costs the most, and which one you leave still elevated.
export function hrCostSummary(costs) {
  const withData = costs.filter((c) => c.peak_hr != null);
  if (!withData.length) return null;
  const spike = [...withData].sort((a, b) => b.peak_hr - a.peak_hr)[0];
  const worstRecovery = [...withData].filter((c) => c.recovery_bpm != null).sort((a, b) => a.recovery_bpm - b.recovery_bpm)[0];
  return { spike: spike.name, spike_peak: spike.peak_hr, least_recovered: worstRecovery?.name ?? null, least_recovered_drop: worstRecovery?.recovery_bpm ?? null };
}
