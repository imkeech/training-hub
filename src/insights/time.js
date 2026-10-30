// Day boundaries in the person's timezone, never UTC.
export const dayIn = (tz) => (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
export const shiftDay = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const avg = (rows, f) => { const v = rows.map((r) => (typeof f === 'function' ? f(r) : r[f])).filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
export const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
