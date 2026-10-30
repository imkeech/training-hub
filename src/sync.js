// Re-sync every connected source for every user, then re-join and de-duplicate. From cron, every 30 min:
//   */30 * * * * cd /path/to/hub && npm run sync >> data/sync.log 2>&1
import './env.js';
import * as db from './db.js';
import * as strava from './sources/strava.js';
import * as hevy from './sources/hevy.js';
import * as gh from './sources/googlehealth.js';
import { joinHeartRate } from './join.js';

const mods = { strava, hevy, googlehealth: gh };
for (const c of db.allConnections()) {
  if (!mods[c.source]) continue;
  try { const n = await mods[c.source].sync(c.user_id, { sinceDays: 14 }); console.log(new Date().toISOString(), c.user_id, c.source, n); }
  catch (e) { console.error(new Date().toISOString(), c.user_id, c.source, e.message); }
}
for (const u of db.allUsers()) joinHeartRate(u.id);
