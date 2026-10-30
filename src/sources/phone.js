// Phone health stores. Noise, Samsung, boAt, Fitbit Air, Amazfit, Apple Watch… all end up in
// Health Connect (Android) or Apple Health (iOS). Those stores have NO web API, so a tiny
// companion app on the phone reads them and POSTs here. See /companion/README.md.
import { randomBytes } from 'node:crypto';
import { saveConnection, connectionByDeviceToken, insertHrSamples, upsertDaily, upsertSession, markSync } from '../db.js';

// Step 1 (web): the user taps "Pair phone" → we mint a token they paste/scan into the companion app.
export function pair(userId, platform /* 'healthconnect' | 'applehealth' */) {
  const token = randomBytes(24).toString('base64url');
  saveConnection(userId, platform, { device_token: token });
  return token;
}

// Step 2 (phone, repeatedly): POST /api/ingest  Authorization: Bearer <device_token>
// Body shape the companion app sends; everything optional:
// {
//   hr:    [{at: ISO, bpm: 72}, ...],                      // raw heart-rate samples
//   daily: [{date: 'YYYY-MM-DD', steps, resting_hr, hrv_ms, spo2_pct, sleep_hours, ...}],
//   workouts: [{id, type: 'Run'|'Strength'|..., title, start_at, end_at, distance_km, calories}]
// }
export function ingest(token, body) {
  const c = connectionByDeviceToken(token);
  if (!c) return null;
  const out = { hr: 0, daily: 0, workouts: 0 };
  if (Array.isArray(body.hr)) out.hr = insertHrSamples(c.user_id, c.source, body.hr.filter((s) => s?.at && Number.isFinite(+s.bpm)));
  if (Array.isArray(body.daily)) { upsertDaily(c.user_id, c.source, body.daily.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d?.date || ''))); out.daily = body.daily.length; }
  if (Array.isArray(body.workouts)) {
    for (const w of body.workouts) {
      if (!w?.start_at || !w?.end_at) continue;
      const min = (new Date(w.end_at) - new Date(w.start_at)) / 60_000;
      upsertSession({ id: `${c.source}:${w.id || w.start_at}`, user_id: c.user_id, source: c.source === 'applehealth' ? 'Apple Health' : 'Health Connect',
        type: w.type || 'Other', title: w.title || w.type || 'Workout', start_at: w.start_at, end_at: w.end_at, duration_min: Math.round(min),
        distance_km: w.distance_km ?? null, pace_min_km: w.distance_km ? Math.round((min / w.distance_km) * 100) / 100 : null, calories: w.calories ?? null });
      out.workouts++;
    }
  }
  markSync(c.user_id, c.source);
  return { userId: c.user_id, ...out };
}
