const $ = (s) => document.querySelector(s);
const api = async (path, opts = {}) => {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const fmt = { int: (v) => (v == null ? '—' : Math.round(v).toLocaleString()), one: (v) => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1)),
  date: (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
  signed: (v, f) => (v == null ? '' : (v > 0 ? '+' : v < 0 ? '−' : '±') + f(Math.abs(v)) + ' vs 7 days before') };

async function boot() {
  const me = await api('/api/me');
  $('#signed-out').hidden = !!me.user; $('#signed-in').hidden = !me.user;
  if (!me.user) {
    $('#google-login').hidden = !me.googleLogin; $('#dev-login').hidden = !me.devLogin; $('#no-login').hidden = me.googleLogin || me.devLogin; $('#dev-note').hidden = !me.devLogin;
    $('#dev-login').onsubmit = async (e) => { e.preventDefault(); await api('/auth/dev', { method: 'POST', body: { name: e.target.name.value } }); location.reload(); };
    
    return;
  }
  $('#nav').textContent = me.user.name || me.user.email;
  if (!me.user.consented) {
    document.querySelectorAll('#signed-in > section').forEach((sec) => { sec.hidden = sec.id !== 'consent'; });
    $('#agree').onchange = (e) => { $('#consent-go').disabled = !e.target.checked; };
    $('#consent-go').onclick = async () => { await api('/api/consent', { method: 'POST', body: { agree: true } }); location.reload(); };
    $('#consent-no').onclick = async () => { await api('/auth/logout', { method: 'POST' }); location.reload(); };
    return;
  }
  const pf = $('#profile-form'); for (const k of ['age', 'weight_kg', 'max_hr', 'timezone']) if (me.user[k] != null) pf[k].value = me.user[k];
  if (!me.user.timezone) pf.timezone.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
  pf.onsubmit = async (e) => { e.preventDefault(); const b = Object.fromEntries(new FormData(pf)); $('#profile-out').textContent = 'Saving…';
    try { await api('/api/profile', { method: 'POST', body: b }); $('#profile-out').textContent = 'Saved. Estimates recalculated.'; await loadData(); } catch (err) { $('#profile-out').textContent = err.message; } };
  $('#share').checked = me.user.share_activity;
  $('#share').onchange = async (e) => { await api('/api/profile', { method: 'POST', body: { share_activity: e.target.checked } }); await loadFriends(); };
  $('#friend-form').onsubmit = async (e) => { e.preventDefault(); try { await api('/api/friends', { method: 'POST', body: { email: e.target.email.value } }); e.target.reset(); await loadFriends(); } catch (err) { $('#friend-status').textContent = err.message; } };
  $('#gh-card').hidden = !me.available.googlehealth;
  if (!me.available.strava) $('[data-src=strava] .act').innerHTML = '<span class="muted">Not set up yet: add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to <code>.env</code> (README step 9), restart, and this becomes a Connect button.</span>';
  for (const c of me.connections) {
    const card = document.querySelector(`[data-src=${c.source === 'applehealth' ? 'healthconnect' : c.source}]`); if (!card) continue;
    const st = card.querySelector('.status'); st.className = 'status ' + (c.status === 'ok' ? 'ok' : 'err');
    st.textContent = c.status === 'ok' ? `Connected${c.last_sync ? ' · synced ' + new Date(c.last_sync.replace(' ', 'T') + 'Z').toLocaleString() : ' · waiting for first sync'}` : `Problem: ${c.error}`;
    const d = document.createElement('button'); d.className = 'btn small ghost'; d.textContent = 'Disconnect';
    d.onclick = async () => { await api('/api/connect/' + c.source, { method: 'DELETE' }); location.reload(); };
    card.querySelector('.act').append(d);
  }
  $('#hevy-form').apiKey.oninput = (e) => { $('#hevy-go').disabled = e.target.value.trim().length < 10; };
  $('#demo-load').onclick = async () => { $('#demo-out').textContent = 'Loading six weeks of sample data…'; await api('/api/demo', { method: 'POST' }); location.reload(); };
  $('#demo-clear').onclick = async () => { await api('/api/demo', { method: 'DELETE' }); location.reload(); };
  if (me.demo) { $('#demo-load').hidden = true; $('#demo-clear').hidden = false; $('#demo-out').textContent = 'Showing sample data (sources marked Hevy/Strava are demo rows). Remove it before connecting real accounts.'; }
  $('#hevy-form').onsubmit = async (e) => { e.preventDefault(); const st = $('[data-src=hevy] .status'); const key = e.target.apiKey.value.trim();
    if (!key) { st.className = 'status err'; st.textContent = 'Paste your Hevy API key first (Hevy app → Settings → Developer; needs Hevy Pro).'; return; }
    st.className = 'status info'; st.textContent = 'Checking key with Hevy…';
    try { await api('/api/connect/hevy', { method: 'POST', body: { apiKey: key } }); st.textContent = 'Connected. Importing workouts…'; setTimeout(() => location.reload(), 1500); } catch (err) { st.className = 'status err'; st.textContent = err.message; } };
  const pair = (platform) => async () => { const out = $('#pair-out'); out.hidden = false; out.textContent = 'Creating a pairing token…';
    try { const r = await api('/api/connect/phone', { method: 'POST', body: { platform } });
      out.innerHTML = `Paired. The companion app (not built yet; see companion/README.md) will send data to:<code>${r.ingestUrl}</code>with this token (shown once):<code>${r.token}</code>You can test the pipeline now with the curl command in the README.`; }
    catch (err) { out.textContent = err.message; } };
  $('#pair-android').onclick = pair('healthconnect'); $('#pair-ios').onclick = pair('applehealth');
  $('#sync').onclick = async () => { $('#sync-out').textContent = 'Syncing…'; const r = await api('/api/sync', { method: 'POST' }); $('#sync-out').textContent = r.message || Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' · '); await loadData(); };
  $('#logout').onclick = async () => { await api('/auth/logout', { method: 'POST' }); location.reload(); };
  $('#delete').onclick = async () => { if (confirm('Delete your account and every synced record? This cannot be undone.')) { await api('/api/me', { method: 'DELETE' }); location.reload(); } };
  await loadData();
}

async function loadData() {
  const [sum, sessions] = await Promise.all([api('/api/summary'), api('/api/sessions')]);
  const w = sum.week;
  $('#w-sessions').textContent = fmt.int(w.sessions); $('#d-sessions').textContent = fmt.signed(w.sessions_delta, fmt.int);
  $('#w-volume').innerHTML = fmt.int(w.volume) + '<i>kg</i>'; $('#d-volume').textContent = fmt.signed(w.volume_delta, fmt.int);
  $('#w-km').innerHTML = fmt.one(w.run_km) + '<i>km</i>'; $('#d-km').textContent = fmt.signed(w.run_km_delta, fmt.one);
  $('#w-sleep').innerHTML = fmt.one(w.sleep) + '<i>h</i>'; $('#d-sleep').textContent = fmt.signed(w.sleep_delta, fmt.one);
  $('#w-rhr').innerHTML = fmt.int(w.rhr) + '<i>bpm</i>'; $('#d-rhr').textContent = fmt.signed(w.rhr_delta, fmt.int);

  const tb = $('#rows'); tb.replaceChildren(); $('#feed-empty').hidden = sessions.length > 0;
  for (const s of sessions) {
    const tr = document.createElement('tr');
    [fmt.date(s.start_at), s.source, s.title, fmt.int(s.duration_min), s.volume_kg ? fmt.int(s.volume_kg) : '', s.distance_km ? fmt.one(s.distance_km) : '', fmt.int(s.avg_hr), fmt.int(s.max_hr), fmt.int(s.calories)]
      .forEach((v, i) => { const td = document.createElement('td'); td.textContent = v; if (i >= 3) td.className = 'num'; tr.append(td); });
    tb.append(tr);
  }
  $('#note').textContent = sum.note || '—';
  const wn = sum.warning; const warn = $('#warn'); warn.hidden = !wn || wn.level === 'none' || wn.level === 'ok';
  if (!warn.hidden) { warn.className = 'warn ' + wn.level; warn.textContent = wn.level === 'high' ? `Ramping too fast: this week's load is ${wn.acwr}× your monthly norm. Ease off for a few days.` : wn.level === 'rising' ? `Load is climbing (${wn.acwr}× your norm). Keep hard days spaced out.` : `Load is well below your norm (${wn.acwr}×). Fitness fades slowly; a normal week is fine.`; }
  $('#profile-nudge').hidden = sum.profile_complete;
  drawLoad(sum.load);
  const rl = $('#reclist'); rl.replaceChildren(); $('#rec-empty').hidden = sum.records.length > 0;
  for (const r of sum.records) { const d = document.createElement('div'); d.className = 'rec'; d.innerHTML = `<small>${r.kind} · ${r.what}</small><b>${r.detail}</b><small>${fmt.date(r.date)}</small>${r.fresh ? ' <span class="fresh">new this week</span>' : ''}`; rl.append(d); }
  if (sum.last_session) await showSession(sum.last_session, sum.last_session_cost, sum.last_session_cost_summary);
  fillCompare(sessions);
  await loadFriends();
}

function drawLoad(series) {
  const box = $('#loadchart'); const W = box.clientWidth || 600, H = box.clientHeight || 220, m = { t: 8, r: 8, b: 22, l: 34 };
  const maxL = Math.max(10, ...series.map((d) => d.load), ...series.map((d) => d.acute || 0)); const x = (i) => m.l + (i / series.length) * (W - m.l - m.r), bw = (W - m.l - m.r) / series.length;
  const y = (v) => H - m.b - (v / maxL) * (H - m.t - m.b);
  const bars = series.map((d, i) => `<rect x="${x(i) + 1}" y="${y(d.load)}" width="${Math.max(1, bw - 2)}" height="${H - m.b - y(d.load)}" rx="2" fill="var(--line)"><title>${d.date}: load ${d.load}${d.sleep_hours != null ? `, slept ${d.sleep_hours} h` : ''}${d.hrv_ms != null ? `, HRV ${d.hrv_ms}` : ''}</title></rect>`).join('');
  const line = (k, color) => `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" points="${series.map((d, i) => `${x(i) + bw / 2},${y(d[k] || 0)}`).join(' ')}"/>`;
  const ticks = [0, 0.5, 1].map((f) => `<text x="${m.l - 6}" y="${y(maxL * f) + 4}" text-anchor="end" font-size="11" fill="var(--ink2)">${Math.round(maxL * f)}</text>`).join('');
  const dates = [0, Math.floor(series.length / 2), series.length - 1].map((i) => `<text x="${x(i) + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--ink2)">${fmt.date(series[i].date)}</text>`).join('');
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}${line('chronic', 'var(--ink2)')}${line('acute', 'var(--pulse)')}${ticks}${dates}</svg>`;
  $('#loadlegend').innerHTML = `<span><i style="background:var(--line)"></i>Daily load</span><span><i style="background:var(--pulse)"></i>7-day average</span><span><i style="background:var(--ink2)"></i>28-day average</span>`;
}

function fillCompare(sessions) {
  const opts = sessions.map((s) => `<option value="${s.id}">${fmt.date(s.start_at)} · ${s.title}</option>`).join('');
  $('#cmp-a').innerHTML = '<option value="">Pick a session</option>' + opts; $('#cmp-b').innerHTML = '<option value="">Pick a session</option>' + opts;
  const run = async () => { const a = $('#cmp-a').value, b = $('#cmp-b').value; $('#cmp-out').hidden = !(a && b); if (!a || !b) return;
    const c = await api(`/api/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
    $('#cmp-ha').textContent = fmt.date(c.a.start_at); $('#cmp-hb').textContent = fmt.date(c.b.start_at);
    const rows = [['Duration (min)', c.totals.duration_min, fmt.int], ['Volume (kg)', c.totals.volume_kg, fmt.int], ['Distance (km)', c.totals.distance_km, fmt.one], ['Pace (min/km)', c.totals.pace_min_km, fmt.one, true],
      ['Avg HR', c.totals.avg_hr, fmt.int], ['Peak HR', c.totals.max_hr, fmt.int], ['Hard minutes', c.totals.hard_min, fmt.int], ['Load', c.totals.load, fmt.int]].filter(([, m]) => m.a != null || m.b != null);
    const tb = $('#cmp-rows'); tb.innerHTML = rows.map(([n, m, f, lowerBetter]) => `<tr><td>${n}</td><td class="num">${f(m.a)}</td><td class="num">${f(m.b)}</td><td class="num ${m.delta == null ? '' : (lowerBetter ? m.delta < 0 : m.delta > 0) ? 'good' : m.delta ? 'badv' : ''}">${m.delta == null ? '' : (m.delta > 0 ? '+' : '') + f(m.delta)}</td></tr>`).join('')
      + c.exercises.map((e) => `<tr><td>${e.name}</td><td class="num">${e.a ? `${fmt.one(e.a.top)} kg top · ${fmt.int(e.a.volume)} kg${e.a.avg_hr ? ` · ${e.a.avg_hr} bpm` : ''}` : '—'}</td><td class="num">${e.b ? `${fmt.one(e.b.top)} kg top · ${fmt.int(e.b.volume)} kg${e.b.avg_hr ? ` · ${e.b.avg_hr} bpm` : ''}` : '—'}</td><td class="num ${e.a && e.b ? (e.b.volume > e.a.volume ? 'good' : e.b.volume < e.a.volume ? 'badv' : '') : ''}">${e.a && e.b ? (e.b.volume - e.a.volume > 0 ? '+' : '') + fmt.int(e.b.volume - e.a.volume) + ' kg' : ''}</td></tr>`).join(''); };
  $('#cmp-a').onchange = run; $('#cmp-b').onchange = run;
}

async function loadFriends() {
  const f = await api('/api/friends');
  $('#board').hidden = !f.optedIn || !f.leaderboard?.length;
  $('#friend-status').textContent = !f.optedIn ? 'Sharing is off. Turn it on to see friends.' : `${f.trainedToday} of your ${f.friends} friend${f.friends === 1 ? '' : 's'} trained today.${f.pending?.length ? ` Waiting for: ${f.pending.join(', ')} (they need to add you back).` : ''}`;
  if (f.optedIn) $('#board-rows').innerHTML = f.leaderboard.map((p) => `<tr${p.me ? ' style="font-weight:700"' : ''}><td>${p.name}</td><td class="num">${p.sessions}</td><td class="num">${fmt.int(p.volume_kg)}</td><td class="num">${fmt.one(p.run_km)}</td><td class="num">${fmt.int(p.load)}</td></tr>`).join('');
}

async function showSession(s, cost = [], costSummary = null) {
  $('#ls-title').textContent = s.title;
  $('#ls-meta').textContent = `${fmt.date(s.start_at)} · ${s.duration_min} min · ${s.source}${s.hr_source ? ' + heart rate from ' + s.hr_source : ''}`;
  const hr = await api(`/api/session/${encodeURIComponent(s.id)}/hr`);
  const scrub = $('#scrub'); scrub.querySelectorAll('.ex').forEach((e) => e.remove());
  $('#scrub-empty').hidden = hr.length > 4; $('#play').hidden = hr.length <= 4;
  if (hr.length <= 4) { $('#line').removeAttribute('d'); $('#area').removeAttribute('d'); return; }
  const t0 = new Date(s.start_at).getTime(), t1 = new Date(s.end_at).getTime(), span = t1 - t0;
  const lo = Math.min(...hr.map((x) => x.bpm)) - 5, hi = Math.max(...hr.map((x) => x.bpm)) + 5;
  const X = (x) => ((new Date(x.at).getTime() - t0) / span) * 1000, Y = (v) => 300 - ((v - lo) / (hi - lo)) * 300;
  const pts = hr.map((x) => `${X(x).toFixed(1)} ${Y(x.bpm).toFixed(1)}`);
  $('#line').setAttribute('d', 'M' + pts.join(' L')); $('#area').setAttribute('d', 'M0 300 L' + pts.join(' L') + ' L1000 300 Z');
  // Exercise windows: real set times when the source gave them (`t` on each set), else spread evenly.
  const timed = (s.exercises || []).length && s.exercises.every((e) => e.sets?.length && e.sets.every((st) => st.t));
  const exs = (s.exercises || []).map((e, i, a) => timed
    ? { name: e.name, sets: e.sets.length, from: Math.max(0, (Date.parse(e.sets[0].t) - t0) / span), to: a[i + 1] ? Math.min(1, (Date.parse(a[i + 1].sets[0].t) - t0) / span) : 1, setTimes: e.sets.map((st) => (Date.parse(st.t) - t0) / span) }
    : { name: e.name, from: i / a.length, to: (i + 1) / a.length, sets: e.sets.length });
  $('#costbox').hidden = !cost.length; $('#cost-note').hidden = !cost.length || cost[0].timed;
  $('#cost-summary').textContent = costSummary ? `${costSummary.spike} pushed you highest (${costSummary.spike_peak} bpm)${costSummary.least_recovered ? `; you moved on from ${costSummary.least_recovered} with your heart rate still ${Math.max(0, 100 - costSummary.least_recovered_drop)}% of the way up` : ''}.` : '';
  $('#cost-rows').innerHTML = cost.map((c) => `<tr><td>${c.name}</td><td class="num">${c.sets}</td><td class="num">${fmt.int(c.avg_hr)}</td><td class="num">${fmt.int(c.peak_hr)}</td><td class="num">${c.recovery_bpm == null ? '—' : '−' + c.recovery_bpm + ' bpm'}</td></tr>`).join('');
  for (const e of exs) { const d = document.createElement('div'); d.className = 'ex'; d.style.left = e.from * 100 + '%'; d.innerHTML = `<em>${e.name}</em>`; scrub.append(d); }
  const at = (t) => { t = Math.max(0, Math.min(1, t)); const ms = t0 + t * span;
    let best = hr[0]; for (const x of hr) if (Math.abs(new Date(x.at) - ms) < Math.abs(new Date(best.at) - ms)) best = x;
    $('#play').style.left = t * 100 + '%'; $('#play').style.setProperty('--py', (Y(best.bpm) / 3) + '%');
    const m = Math.floor((t * span) / 60000), sec = Math.floor(((t * span) % 60000) / 1000);
    $('#r-time').textContent = `${m}:${String(sec).padStart(2, '0')}`; $('#r-hr').textContent = best.bpm + ' bpm';
    const e = exs.find((x) => t >= x.from && t <= x.to); $('#r-ex').textContent = e ? e.name : (s.type === 'Run' ? 'Running' : '—');
    const setNo = !e ? null : e.setTimes ? Math.max(1, Math.min(e.sets, e.setTimes.filter((st) => t >= st).length)) : Math.min(e.sets, Math.floor(((t - e.from) / (e.to - e.from || 1)) * e.sets) + 1);
    $('#r-set').textContent = e ? `${setNo} of ${e.sets}` : '—';
    scrub.querySelectorAll('.ex').forEach((el, i) => el.classList.toggle('on', exs[i] === e)); };
  at(0.4);
  scrub.onpointermove = (ev) => { const b = scrub.getBoundingClientRect(); at((ev.clientX - b.left) / b.width); };
}

boot().catch((e) => { document.body.insertAdjacentHTML('beforeend', `<p class="wrap" style="color:var(--pulse)">${e.message}</p>`); });
