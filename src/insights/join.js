// The core of the Hub: a lifting app knows WHAT and WHEN, a band knows the HEART at each moment.
// They share a clock, so join on time. Pure function; src/join.js wires it to the database.
export const HARD_ZONE = 0.7;

export function joinSession(session, samples, { age = 30, weightKg = 70, maxHr } = {}) {
  if (samples.length < 5) return null;
  const maxEst = maxHr || 208 - 0.7 * age;
  const bySource = Object.groupBy(samples, (x) => x.source);
  const source = Object.keys(bySource).sort((a, b) => bySource[b].length - bySource[a].length)[0];
  const hr = bySource[source];
  const avg = Math.round(hr.reduce((a, x) => a + x.bpm, 0) / hr.length);
  const max = Math.max(...hr.map((x) => x.bpm));
  let hardSec = 0;
  for (let i = 0; i < hr.length - 1; i++) {
    const gap = Math.min(60, (Date.parse(hr[i + 1].at) - Date.parse(hr[i].at)) / 1000);
    if (hr[i].bpm >= HARD_ZONE * maxEst) hardSec += gap;
  }
  // Keytel et al. (2005), male form; an estimate for comparing days, not a lab number.
  const kcalPerMin = (-55.0969 + 0.6309 * avg + 0.1988 * weightKg + 0.2017 * age) / 4.184;
  const calories_est = Math.round(Math.max(0, kcalPerMin) * (session.duration_min || 0));
  return { avg_hr: avg, max_hr: max, hard_min: Math.round(hardSec / 60), calories_est, hr_source: source };
}
