# Training Hub

One place for every workout, from every app, with your heart data next to it.
Hevy knows the lifts, Strava knows the runs, your watch knows your heart; they share a clock, so the Hub
joins them on time. Built for one person first, in a shape that opens to friends and then everyone.

## What is in here

```
src/server.js          web app + API (Express, Node 22, SQLite built in — no native deps)
src/db.js              schema: users, connections, sessions, hr_samples, daily
src/join.js            runs the join, scores load, marks duplicates; re-joins when late band data arrives
src/summary.js         everything the dashboard shows: tiles, daily note, load series, records, compare, friends
src/insights/          pure, tested engines: join, load + ramp warning, records, per-exercise HR cost, dedup, note
src/crypto.js          OAuth tokens and API keys encrypted at rest (AES-256-GCM, TOKEN_KEY)
scripts/backup.js      nightly SQLite snapshot, keeps 14
test/                  24 tests: engines, database, full HTTP flow (consent, ingest, friends), UI wiring
src/sources/strava.js  OAuth + activities (+ HR streams if the watch recorded into Strava)
src/sources/hevy.js    API key + workouts (sets, reps, volume, exercises)
src/sources/phone.js   ingest endpoint for the companion app (Health Connect / Apple Health)
src/sources/googlehealth.js  Fitbit Air cloud route; scaffolded, gated on Google verification
src/sync.js            cron job: resync everyone
public/                the website (sign in, connections, dashboard, scrub-able HR trace)
companion/README.md    the phone app that makes Noise / Samsung / Fitbit Air work
```

## Run it locally (10 minutes)

```bash
npm install                     # two packages: express, cookie-session
cp .env.example .env            # fill SESSION_SECRET and TOKEN_KEY; leave the OAuth keys empty for now
npm test                        # 24 tests, no network needed
npm run dev                     # http://localhost:3000
```
With `ALLOW_DEV_LOGIN=true` and no Google sign-in configured, the site shows a name-only test login so you can try it
alone. **There is no Google button until you set `GOOGLE_CLIENT_ID` in `.env`**; that is step 2 of hosting below, not needed
for local use.

With nothing connected yet, every button tells you what it needs (a Hevy key, Strava keys in `.env`, the companion app),
and *Sync now* says so rather than doing nothing. The sign-in page is the same cursor-trail hero as the concept site. It refuses to work over https, so it cannot leak into a hosted deployment by accident.

First visit: a one-page consent screen (what is collected, who sees it, how to delete), then your profile (age, weight,
timezone) so calories, effort and day boundaries are right for you. Press **Load demo data** on the Today panel to fill
every screen with six weeks of sample training; remove it again before connecting real accounts.

## Google sign-in (needed for friends; optional on your own laptop)

1. console.cloud.google.com → create a project (any name) → *APIs & Services* → *OAuth consent screen* → External →
   fill app name and your email → add yourself under *Test users*.
2. *Credentials* → *Create credentials* → *OAuth client ID* → type **Web application** → Authorised redirect URI:
   `http://localhost:3000/auth/google/callback` (add your real domain later).
3. Copy the Client ID and Client Secret into `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), set `ALLOW_DEV_LOGIN=false`,
   restart. The landing page now shows *Sign in with Google* and the test login disappears.

**Hevy** works immediately: paste your API key (needs Hevy Pro).
**Strava**: create an app at strava.com/settings/api with callback domain `localhost`, put the id/secret in
`.env`, restart, press *Connect Strava*.
**Your watch**: press *Pair Android phone*, then build the companion app from `companion/README.md`. Until
that app exists you can test the pipeline with curl:

```bash
curl -X POST http://localhost:3000/api/ingest -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"hr":[{"at":"2026-10-28T07:00:00Z","bpm":120},{"at":"2026-10-28T07:00:30Z","bpm":131}]}'
```

## Put it online for friends

1. Any small VPS or a Node host (Render, Railway, Fly). Set `BASE_URL=https://your-domain`.
2. Create the Google OAuth client for sign-in (`/auth/google/callback`) and set `GOOGLE_CLIENT_ID/SECRET`.
   This disables the test-mode login automatically.
3. Point the Strava app's callback domain at your domain.
4. Set `ALLOW_DEV_LOGIN=false` and a fresh `TOKEN_KEY`.
5. Add the cron lines from `src/sync.js` (every 30 min) and `scripts/backup.js` (nightly), and copy
   `data/backups/` off the machine; a backup on the same disk is not a backup.
6. It holds health data, so: HTTPS only, disk encryption on, nobody but you has shell access, and the
   "Delete my account" button must keep working (it cascades through every table; backups age out in 14 days).

SQLite is enough for a few hundred people. Move to Postgres only when you outgrow it: the schema in `src/db.js` is
plain SQL and the engines in `src/insights/` never touch the database.

Friends then open the link, sign in with Google, and connect their own apps. Their tokens never leave the
server and are never shown in the browser.

## How "any watch" works

| Watch / app | Route | Needs |
|---|---|---|
| Noise, boAt, Fire-Boltt, Amazfit, Samsung | Health Connect → companion app | Companion app (Android) |
| Fitbit Air, Pixel Watch | Health Connect today; Google Health API later | Companion app now; Google review later |
| Apple Watch | Apple Health → companion app | Companion app (iOS) |
| Garmin, Polar, Coros, Whoop, Oura | Easiest via Health Connect/Apple Health; direct OAuth later | Companion app |
| Strava, Hevy | Direct, already built | Strava app registration; Hevy Pro per user |

When strangers start signing up, an aggregator (Terra, ROOK, Junction, or self-hosted Open Wearables) can
replace the one-by-one cloud integrations. The `sessions` / `daily` / `hr_samples` tables don't change.

## Rollout

- **Week 1 — you.** Run locally. Hevy + Strava connected, companion app on your phone, see your own joined sessions.
- **Week 2–3 — five friends.** Host it, Google sign-in, send the link. Watch the error column on Connections.
  Add per-set timestamps from Hevy when the API exposes them, so the scrub trace names the exact set.
- **Month 2 — everyone.** Privacy policy, DPDP consent screen, Play Store / App Store review for the companion,
  Google Health API verification, pick an aggregator if more brands are asked for.

## What the dashboard does now

- **Today**: a plain-language note built from yesterday's sessions, last night's sleep, resting HR and HRV against
  your week, the ramp warning, and any new records.
- **Training load vs recovery**: daily load with 7-day and 28-day averages; a warning when the week runs above
  1.3× (rising) or 1.5× (high) your monthly norm.
- **Personal records** that notice themselves: heaviest set per exercise, biggest session, fastest 5 km, longest run,
  most deep sleep, highest HRV, flagged when set this week.
- **Last session**: scrub the heart-rate trace; per-exercise HR cost (avg, peak, how far HR came down before you
  moved on) and a one-line summary of which lift spiked you and which you left early.
- **Compare two sessions** side by side, exercise by exercise, with heart rate.
- **Friends**: opt-in, mutual only; "N of your friends trained today" and a weekly table.
- **Data hygiene**: late phone uploads re-join the sessions they cover; the same run from Strava and the phone is
  shown once; device calories beat our estimate; profile changes recompute estimates.

## Known gaps (honest list)

- Per-set timestamps are used when a source provides them (`t` on a set). Hevy's public API did not expose set times
  when this was written; until it does, exercises are spread evenly and the page says so.
- Google Health sync is a stub until Google verifies the app; Fitbit Air data arrives through the phone meanwhile.
- The ramp warning and load scores are TRIMP-style heuristics, not a validated model; treat them as a nudge.
- Friends are matched by sign-in email, so both people need Google sign-in (the test login uses fake addresses).
- The HTTP tests run against a small Express look-alike (`test/shim/`), not Express itself; run `npm run dev` once
  after `npm install` to see the real stack boot.
