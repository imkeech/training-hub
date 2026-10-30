// Nightly backup of the database, keeping the last 14. Add to cron on the server:
//   15 2 * * * cd /path/to/hub && node --experimental-sqlite scripts/backup.js >> data/backup.log 2>&1
// Then copy data/backups/ off the machine (rclone, scp, an object store); a backup on the same disk is not a backup.
import '../src/env.js';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../src/db.js';

export function backup(dir = process.env.BACKUP_DIR || new URL('../data/backups/', import.meta.url).pathname, keep = 14) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `hub-${new Date().toISOString().replace(/[:T.]/g, '-').slice(0, 23)}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); // consistent snapshot even while the app is running (WAL)
  const old = readdirSync(dir).filter((f) => f.startsWith('hub-') && f.endsWith('.db')).sort().slice(0, -keep);
  for (const f of old) unlinkSync(join(dir, f));
  return file;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) console.log(new Date().toISOString(), 'backup written', backup());
