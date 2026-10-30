// Database side of the join: runs the pure joinSession over every session that still lacks HR,
// scores training load, and marks duplicates. Called after every sync and every phone upload.
import * as db from './db.js';
import { joinSession } from './insights/join.js';
import { sessionLoad } from './insights/load.js';
import { findDuplicates } from './insights/dedup.js';

export function joinHeartRate(userId) {
  const phys = db.physiology(db.getUser(userId));
  let joined = 0;
  for (const s of db.sessionsNeedingHr(userId)) {
    const from = new Date(Date.parse(s.start_at) - 60_000).toISOString(), to = new Date(Date.parse(s.end_at) + 60_000).toISOString();
    const r = joinSession(s, db.hrBetween(userId, from, to), phys);
    if (r) { db.setSessionHr(s.id, { ...r, load: sessionLoad({ ...s, avg_hr: r.avg_hr }, phys.maxHr) }); joined++; }
    else if (s.load == null) db.setSessionLoad(s.id, sessionLoad(s, phys.maxHr));
  }
  for (const p of findDuplicates(db.listSessions(userId, 2000))) db.setDuplicate(p.drop, p.keep);
  return joined;
}

// Late band data: when samples arrive for a window, forget the HR of sessions in it and join again.
export function rejoinWindow(userId, samples) {
  if (!samples.length) return 0;
  const ats = samples.map((s) => s.at).sort();
  db.resetHrInWindow(userId, ats[0], ats[ats.length - 1]);
  return joinHeartRate(userId);
}
