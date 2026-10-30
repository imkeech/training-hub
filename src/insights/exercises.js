// Where each exercise sits inside a session, as fractions 0..1 of the session.
// Uses real per-set timestamps (`t` on a set) when the source gave them; otherwise spreads exercises evenly.
export function exerciseWindows(session) {
  const exs = session.exercises || [];
  if (!exs.length) return [];
  const t0 = Date.parse(session.start_at), span = Date.parse(session.end_at) - t0;
  const timed = exs.every((e) => e.sets?.length && e.sets.every((s) => s.t));
  if (timed && span > 0) {
    return exs.map((e, i) => {
      const from = (Date.parse(e.sets[0].t) - t0) / span;
      const next = exs[i + 1] ? (Date.parse(exs[i + 1].sets[0].t) - t0) / span : 1;
      return { name: e.name, from: Math.max(0, Math.min(1, from)), to: Math.max(0, Math.min(1, next)), sets: e.sets.length, timed: true,
        setTimes: e.sets.map((s) => (Date.parse(s.t) - t0) / span) };
    });
  }
  return exs.map((e, i) => ({ name: e.name, from: i / exs.length, to: (i + 1) / exs.length, sets: e.sets?.length || 0, timed: false }));
}
export function exerciseAt(windows, t) { return windows.find((w) => t >= w.from && t <= w.to) || null; }
export function setAt(w, t) {
  if (!w) return null;
  if (w.setTimes) { let n = 0; for (const st of w.setTimes) if (t >= st) n++; return Math.max(1, Math.min(w.sets, n)); }
  return Math.min(w.sets, Math.floor(((t - w.from) / (w.to - w.from || 1)) * w.sets) + 1);
}
