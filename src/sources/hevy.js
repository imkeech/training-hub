// Hevy: strength workouts. No OAuth: each user pastes an API key from Hevy Pro → Settings → Developer.
// Docs: api.hevyapp.com/docs
import { getConnection, saveConnection, upsertSession, markSync } from '../db.js';

const API = 'https://api.hevyapp.com/v1';

async function get(key, path, params = {}) {
  const r = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { headers: { 'api-key': key, accept: 'application/json' } });
  if (r.status === 401) throw new Error('Hevy rejected the key. Keys need an active Hevy Pro subscription.');
  if (!r.ok) throw new Error(`Hevy ${path} ${r.status}`);
  return r.json();
}

export async function connect(userId, apiKey) {
  const me = await get(apiKey, '/user/info'); // throws if the key is bad
  saveConnection(userId, 'hevy', { access_token: apiKey, external_id: me?.username ?? me?.id ?? '' });
}

const typeOf = (name = '') => /squat|lunge|leg|rdl|romanian|calf|hip thrust/i.test(name) ? 'Legs' : /deadlift|row|pulldown|curl|pull|chin|shrug/i.test(name) ? 'Pull' : /bench|press|push|dip|tricep|fly|raise/i.test(name) ? 'Push' : null;

export async function sync(userId, { sinceDays = 90 } = {}) {
  const c = getConnection(userId, 'hevy');
  if (!c) throw new Error('Hevy not connected');
  try {
    const since = Date.now() - sinceDays * 86_400_000;
    let page = 1, count = 0;
    for (;;) {
      const data = await get(c.access_token, '/workouts', { page, pageSize: 10 }); // newest first
      const workouts = data.workouts || [];
      for (const w of workouts) {
        const start = new Date(w.start_time), end = new Date(w.end_time);
        if (start.getTime() < since) { page = Infinity; break; }
        let sets = 0, reps = 0, volume = 0;
        const exercises = (w.exercises || []).map((e) => {
          const es = (e.sets || []).filter((s) => s.type !== 'warmup').map((s) => {
            const r = s.reps || 0, kg = s.weight_kg || 0;
            sets++; reps += r; volume += r * kg;
            // `t` = set start time if the API exposes it (start_time / started_at / created_at); the scrub trace uses it.
            const t = s.start_time || s.started_at || s.created_at || null;
            return { weight_kg: kg, reps: r, rpe: s.rpe ?? null, ...(t ? { t: new Date(t).toISOString() } : {}) };
          });
          return { name: e.title, sets: es };
        });
        const counts = {}; exercises.forEach((e) => { const t = typeOf(e.name); if (t) counts[t] = (counts[t] || 0) + 1; });
        const day = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        upsertSession({ id: `hevy:${w.id}`, user_id: userId, source: 'Hevy', type: 'Strength',
          title: w.title || (day ? `${day} day` : 'Workout'), start_at: start.toISOString(), end_at: end.toISOString(),
          duration_min: Math.round((end - start) / 60_000), sets, reps, volume_kg: Math.round(volume), exercises });
        count++;
      }
      if (page === Infinity || workouts.length < 10 || page >= (data.page_count || 1)) break;
      page++;
    }
    markSync(userId, 'hevy');
    return count;
  } catch (e) { markSync(userId, 'hevy', e.message); throw e; }
}
