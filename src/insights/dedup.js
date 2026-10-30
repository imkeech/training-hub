// The same run can arrive from Strava and from the phone's health store. Keep the richer one.
const RANK = { Hevy: 3, Strava: 3, 'Google Health': 2, 'Health Connect': 1, 'Apple Health': 1 };
const broad = (t) => (t === 'Strength' ? 'Strength' : t === 'Run' || t === 'Ride' || t === 'Walk' ? 'Cardio' : 'Other');

export function findDuplicates(sessions, { windowMs = 120_000, distanceTolerance = 0.1 } = {}) {
  const pairs = [], sorted = [...sessions].filter((s) => !s.duplicate_of).sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
    const a = sorted[i], b = sorted[j];
    if (Date.parse(b.start_at) - Date.parse(a.start_at) > windowMs) break;
    if (a.source === b.source || broad(a.type) !== broad(b.type)) continue;
    if (a.distance_km && b.distance_km && Math.abs(a.distance_km - b.distance_km) / Math.max(a.distance_km, b.distance_km) > distanceTolerance) continue;
    const [keep, drop] = (RANK[a.source] || 0) >= (RANK[b.source] || 0) ? [a, b] : [b, a];
    pairs.push({ keep: keep.id, drop: drop.id });
  }
  return pairs;
}
