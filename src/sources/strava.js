// Strava: runs, rides, walks. OAuth 2 with refresh tokens.
// Docs: developers.strava.com/docs/reference
import { getConnection, saveConnection, upsertSession, insertHrSamples, markSync } from '../db.js';

const API = 'https://www.strava.com/api/v3';
const TYPES = { Run: 'Run', TrailRun: 'Run', VirtualRun: 'Run', Ride: 'Ride', VirtualRide: 'Ride', Walk: 'Walk', Hike: 'Walk', WeightTraining: 'Strength' };

export const authorizeUrl = (state) => {
  const p = new URLSearchParams({ client_id: process.env.STRAVA_CLIENT_ID, redirect_uri: `${process.env.BASE_URL}/auth/strava/callback`,
    response_type: 'code', approval_prompt: 'auto', scope: 'read,activity:read_all', state });
  return `https://www.strava.com/oauth/authorize?${p}`;
};

async function token(body) {
  const r = await fetch('https://www.strava.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, ...body }) });
  if (!r.ok) throw new Error(`Strava token ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function handleCallback(userId, code) {
  const t = await token({ code, grant_type: 'authorization_code' });
  saveConnection(userId, 'strava', { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at, external_id: String(t.athlete?.id ?? '') });
}

async function accessToken(userId) {
  const c = getConnection(userId, 'strava');
  if (!c) throw new Error('Strava not connected');
  if (c.expires_at * 1000 > Date.now() + 60_000) return c.access_token;
  const t = await token({ grant_type: 'refresh_token', refresh_token: c.refresh_token });
  saveConnection(userId, 'strava', { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at });
  return t.access_token;
}

async function get(tok, path, params = {}) {
  const r = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${tok}` } });
  if (r.status === 429) throw new Error('Strava rate limit hit; try again in 15 minutes');
  if (!r.ok) throw new Error(`Strava ${path} ${r.status}`);
  return r.json();
}

export async function sync(userId, { sinceDays = 90 } = {}) {
  try {
    const tok = await accessToken(userId);
    const after = Math.floor((Date.now() - sinceDays * 86_400_000) / 1000);
    let page = 1, count = 0, streamBudget = 60; // Strava allows 100 requests / 15 min; keep headroom
    for (;;) {
      const acts = await get(tok, '/athlete/activities', { after, per_page: 50, page });
      if (!acts.length) break;
      for (const a of acts) {
        const start = new Date(a.start_date), end = new Date(start.getTime() + a.elapsed_time * 1000);
        const km = (a.distance || 0) / 1000, min = (a.moving_time || a.elapsed_time) / 60;
        upsertSession({ id: `strava:${a.id}`, user_id: userId, source: 'Strava', type: TYPES[a.sport_type || a.type] || 'Other',
          title: a.name, start_at: start.toISOString(), end_at: end.toISOString(), duration_min: Math.round(min),
          distance_km: km ? Math.round(km * 100) / 100 : null, pace_min_km: km ? Math.round((min / km) * 100) / 100 : null });
        // If a watch recorded HR into Strava, keep the stream as samples: it makes the join work even without a band.
        if (a.has_heartrate && streamBudget-- > 0) {
          try {
            const st = await get(tok, `/activities/${a.id}/streams`, { keys: 'time,heartrate', key_by_type: true });
            if (st.heartrate && st.time) {
              const samples = st.time.data.map((t, i) => ({ at: new Date(start.getTime() + t * 1000).toISOString(), bpm: st.heartrate.data[i] }));
              insertHrSamples(userId, 'strava', samples.filter((_, i) => i % 5 === 0)); // every 5th sample is plenty
            }
          } catch (e) { /* streams are optional */ }
        }
        count++;
      }
      if (acts.length < 50) break;
      page++;
    }
    markSync(userId, 'strava');
    return count;
  } catch (e) { markSync(userId, 'strava', e.message); throw e; }
}
