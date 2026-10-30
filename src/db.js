// SQLite via Node's built-in driver (no native build step). Default file: data/hub.db (override with DB_PATH).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { seal, open } from './crypto.js';

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
export const DB_PATH = process.env.DB_PATH || fileURLToPath(new URL('../data/hub.db', import.meta.url));
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS connections (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  access_token TEXT, refresh_token TEXT, expires_at INTEGER, external_id TEXT,
  device_token TEXT, last_sync TEXT, status TEXT DEFAULT 'ok', error TEXT,
  PRIMARY KEY (user_id, source)
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL, type TEXT NOT NULL,
  title TEXT, start_at TEXT NOT NULL, end_at TEXT NOT NULL, duration_min REAL,
  distance_km REAL, pace_min_km REAL, sets INTEGER, reps INTEGER, volume_kg REAL,
  exercises TEXT,
  avg_hr INTEGER, max_hr INTEGER, calories INTEGER, hard_min INTEGER, hr_source TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sessions_user_time ON sessions(user_id, start_at);
CREATE TABLE IF NOT EXISTS hr_samples (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL, at TEXT NOT NULL, bpm INTEGER NOT NULL,
  PRIMARY KEY (user_id, source, at)
);
CREATE TABLE IF NOT EXISTS daily (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL, source TEXT NOT NULL,
  steps INTEGER, distance_km REAL, calories_total INTEGER, active_zone_min INTEGER,
  resting_hr INTEGER, hrv_ms INTEGER, spo2_pct REAL, breathing_rate REAL, skin_temp_var_c REAL,
  sleep_hours REAL, sleep_score INTEGER, sleep_deep_min INTEGER, sleep_rem_min INTEGER,
  sleep_light_min INTEGER, sleep_awake_min INTEGER, readiness INTEGER,
  PRIMARY KEY (user_id, date, source)
);
CREATE TABLE IF NOT EXISTS friends (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_email TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, friend_email)
);
`);

// ---- migrations: add columns to databases created by earlier versions ----
const addCol = (table, col, def) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
addCol('users', 'age', 'INTEGER'); addCol('users', 'weight_kg', 'REAL'); addCol('users', 'max_hr', 'INTEGER');
addCol('users', 'timezone', 'TEXT'); addCol('users', 'consented_at', 'TEXT'); addCol('users', 'share_activity', 'INTEGER DEFAULT 0');
addCol('sessions', 'calories_est', 'INTEGER');   // our estimate; `calories` is what a device reported
addCol('sessions', 'duplicate_of', 'TEXT');      // set when the same workout arrived from two sources
addCol('sessions', 'load', 'REAL');              // training load, see insights/load.js

export const newId = () => randomBytes(12).toString('hex');
const tx = (fn) => (...args) => { db.exec('BEGIN'); try { const r = fn(...args); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

// ---- users -------------------------------------------------------------
export function upsertUser({ email, name }) {
  const row = email && db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (row) return row;
  const id = newId();
  db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').run(id, email || null, name || null);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
export const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
export const userByEmail = (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email);
export function updateProfile(id, { age, weight_kg, max_hr, timezone, share_activity }) {
  db.prepare('UPDATE users SET age = COALESCE(?, age), weight_kg = COALESCE(?, weight_kg), max_hr = COALESCE(?, max_hr), timezone = COALESCE(?, timezone), share_activity = COALESCE(?, share_activity) WHERE id = ?')
    .run(age ?? null, weight_kg ?? null, max_hr ?? null, timezone ?? null, share_activity == null ? null : share_activity ? 1 : 0, id);
  return getUser(id);
}
export const consent = (id) => db.prepare("UPDATE users SET consented_at = datetime('now') WHERE id = ?").run(id);
// Physiology used by the estimates; sensible defaults until the person fills in their profile.
export function physiology(user) {
  const age = user?.age || 30, weightKg = user?.weight_kg || 70;
  return { age, weightKg, maxHr: user?.max_hr || Math.round(208 - 0.7 * age) };
}

// ---- connections -------------------------------------------------------
const SECRET_COLS = new Set(['access_token', 'refresh_token']);
export function saveConnection(userId, source, fields) {
  const cols = Object.keys(fields);
  db.prepare(`INSERT INTO connections (user_id, source, ${cols.join(',')}) VALUES (?, ?, ${cols.map(() => '?').join(',')})
    ON CONFLICT(user_id, source) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}, status = 'ok', error = NULL`)
    .run(userId, source, ...cols.map((c) => (SECRET_COLS.has(c) ? seal(fields[c]) : fields[c])));
}
const unseal = (c) => (c ? { ...c, access_token: open(c.access_token), refresh_token: open(c.refresh_token) } : c);
export const getConnection = (userId, source) => unseal(db.prepare('SELECT * FROM connections WHERE user_id = ? AND source = ?').get(userId, source));
export const rawConnection = (userId, source) => db.prepare('SELECT * FROM connections WHERE user_id = ? AND source = ?').get(userId, source); // for tests
export const listConnections = (userId) => db.prepare('SELECT source, last_sync, status, error, external_id FROM connections WHERE user_id = ?').all(userId);
export const allConnections = () => db.prepare('SELECT user_id, source FROM connections').all();
export const deleteConnection = (userId, source) => db.prepare('DELETE FROM connections WHERE user_id = ? AND source = ?').run(userId, source);
export const markSync = (userId, source, error = null) =>
  db.prepare("UPDATE connections SET last_sync = datetime('now'), status = ?, error = ? WHERE user_id = ? AND source = ?").run(error ? 'error' : 'ok', error, userId, source);
export const connectionByDeviceToken = (token) => db.prepare('SELECT * FROM connections WHERE device_token = ?').get(token);

// ---- sessions ----------------------------------------------------------
const sessionCols = ['id', 'user_id', 'source', 'type', 'title', 'start_at', 'end_at', 'duration_min', 'distance_km', 'pace_min_km', 'sets', 'reps', 'volume_kg', 'exercises', 'calories'];
const upsertSessionStmt = db.prepare(`INSERT INTO sessions (${sessionCols.join(',')}) VALUES (${sessionCols.map((c) => '@' + c).join(',')})
  ON CONFLICT(id) DO UPDATE SET ${sessionCols.filter((c) => !['id', 'user_id'].includes(c)).map((c) => `${c} = COALESCE(excluded.${c}, ${c})`).join(', ')}, updated_at = datetime('now')`);
export function upsertSession(s) {
  const row = {}; for (const c of sessionCols) row[c] = s[c] ?? null;
  if (row.exercises && typeof row.exercises !== 'string') row.exercises = JSON.stringify(row.exercises);
  upsertSessionStmt.run(row);
}
const parse = (s) => (s ? { ...s, exercises: s.exercises ? JSON.parse(s.exercises) : null } : s);
export const listSessions = (userId, limit = 500, { includeDuplicates = false } = {}) =>
  db.prepare(`SELECT * FROM sessions WHERE user_id = ? ${includeDuplicates ? '' : 'AND duplicate_of IS NULL'} ORDER BY start_at DESC LIMIT ?`).all(userId, limit).map(parse);
export const getSession = (userId, id) => parse(db.prepare('SELECT * FROM sessions WHERE user_id = ? AND id = ?').get(userId, id));
export const sessionsNeedingHr = (userId) => db.prepare('SELECT * FROM sessions WHERE user_id = ? AND avg_hr IS NULL').all(userId).map(parse);
export const setSessionHr = (id, { avg_hr, max_hr, calories_est, hard_min, hr_source, load }) =>
  db.prepare('UPDATE sessions SET avg_hr = ?, max_hr = ?, calories_est = ?, hard_min = ?, hr_source = ?, load = ? WHERE id = ?').run(avg_hr, max_hr, calories_est, hard_min, hr_source, load, id);
export const setSessionLoad = (id, load) => db.prepare('UPDATE sessions SET load = ? WHERE id = ?').run(load, id);
// Late band data: forget the HR of sessions overlapping [from, to] so the next join recomputes them.
export const resetHrInWindow = (userId, from, to) =>
  db.prepare('UPDATE sessions SET avg_hr = NULL, max_hr = NULL, hard_min = NULL, hr_source = NULL WHERE user_id = ? AND end_at >= ? AND start_at <= ?').run(userId, from, to).changes;
export const setDuplicate = (id, of) => db.prepare('UPDATE sessions SET duplicate_of = ? WHERE id = ?').run(of, id);

// ---- heart-rate samples -----------------------------------------------
const insertHr = db.prepare('INSERT OR IGNORE INTO hr_samples (user_id, source, at, bpm) VALUES (?, ?, ?, ?)');
export const insertHrSamples = tx((userId, source, samples) => { let n = 0; for (const s of samples) n += insertHr.run(userId, source, s.at, Math.round(s.bpm)).changes; return n; });
export const hrBetween = (userId, from, to) => db.prepare('SELECT source, at, bpm FROM hr_samples WHERE user_id = ? AND at >= ? AND at <= ? ORDER BY at').all(userId, from, to);

// ---- daily --------------------------------------------------------------
const dailyCols = ['steps', 'distance_km', 'calories_total', 'active_zone_min', 'resting_hr', 'hrv_ms', 'spo2_pct', 'breathing_rate', 'skin_temp_var_c',
  'sleep_hours', 'sleep_score', 'sleep_deep_min', 'sleep_rem_min', 'sleep_light_min', 'sleep_awake_min', 'readiness'];
const upsertDailyStmt = db.prepare(`INSERT INTO daily (user_id, date, source, ${dailyCols.join(',')}) VALUES (@user_id, @date, @source, ${dailyCols.map((c) => '@' + c).join(',')})
  ON CONFLICT(user_id, date, source) DO UPDATE SET ${dailyCols.map((c) => `${c} = COALESCE(excluded.${c}, ${c})`).join(', ')}`);
export const upsertDaily = tx((userId, source, rows) => { for (const r of rows) { const row = { user_id: userId, source, date: r.date }; for (const c of dailyCols) row[c] = r[c] ?? null; upsertDailyStmt.run(row); } });
// One row per date, merging sources (a Strava day has no sleep; the band's row fills it).
export const listDaily = (userId, days = 90) => {
  const rows = db.prepare(`SELECT * FROM daily WHERE user_id = ? AND date >= date('now', ?) ORDER BY date, source`).all(userId, `-${days} days`);
  const byDate = new Map();
  for (const r of rows) { const m = byDate.get(r.date) || { date: r.date }; for (const c of dailyCols) if (r[c] != null) m[c] = r[c]; byDate.set(r.date, m); }
  return [...byDate.values()];
};

// ---- friends ------------------------------------------------------------
export const addFriend = (userId, email) => db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_email) VALUES (?, ?)').run(userId, email.toLowerCase().trim());
export const removeFriend = (userId, email) => db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_email = ?').run(userId, email.toLowerCase().trim());
export const myFriendEmails = (userId) => db.prepare('SELECT friend_email FROM friends WHERE user_id = ?').all(userId).map((r) => r.friend_email);
// Mutual + both opted in: I added them, they added me, and they chose to share.
export const mutualFriends = (userId) => db.prepare(`
  SELECT u.id, u.name, u.email FROM friends f
  JOIN users u ON lower(u.email) = f.friend_email
  JOIN friends g ON g.user_id = u.id AND g.friend_email = (SELECT lower(email) FROM users WHERE id = f.user_id)
  WHERE f.user_id = ? AND u.share_activity = 1`).all(userId);

// ---- danger zone ------------------------------------------------------
export const deleteUserData = (userId) => db.prepare('DELETE FROM users WHERE id = ?').run(userId);
export const allUsers = () => db.prepare('SELECT * FROM users').all();
