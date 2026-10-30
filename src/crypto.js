// OAuth tokens and API keys are sealed before they touch SQLite, so a copied hub.db is useless without TOKEN_KEY.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const key = () => createHash('sha256').update(process.env.TOKEN_KEY || process.env.SESSION_SECRET || 'dev-only').digest();

export function seal(plain) {
  if (plain == null) return null;
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'enc:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function open(sealed) {
  if (sealed == null) return null;
  if (!String(sealed).startsWith('enc:')) return sealed; // rows written before encryption was added
  const b = Buffer.from(String(sealed).slice(4), 'base64');
  const d = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
