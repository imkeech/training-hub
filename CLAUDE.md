# Training Hub — project brief for Claude Code

Read this first. It replaces the chat conversation where this project was designed.

## Who I am and what I want
I am a beginner, not a developer. Explain things plainly, run commands for me, and after any change run `npm test` and tell me what you changed in one or two sentences. Ask before anything destructive (deleting data, changing `.env`, pushing anywhere).

## The idea
Google's Fitbit app (now "Google Health", for my Fitbit Air band) is hard to read. I also use Hevy for lifting
(sets/reps/weights) and Strava for runs. Nothing shows them together. Training Hub is one website (later also an app) that:
1. pulls workouts from Hevy and Strava,
2. pulls heart rate / sleep / SpO2 / HRV / steps from any watch (Fitbit Air, Noise, Samsung, Apple Watch…) via the phone's health store,
3. joins them on time, so one session shows the lifts AND the heart rate for those exact minutes,
4. explains it in plain language ("Yesterday: pull day, 6,361 kg, avg 125 bpm. You slept 5.7 h, resting HR up 4, go lighter today").
It is for me first, then friends (each connects their own accounts), then everyone. Website first; phone app later as a web view.

## Current state (October 2026)
- Node 22 + Express + built-in SQLite (`node:sqlite`). Two npm packages. 25 tests pass with `npm test`.
- Works locally with a name-only "test mode" login (`ALLOW_DEV_LOGIN=true`, http only). Google sign-in needs
  `GOOGLE_CLIENT_ID/SECRET` in `.env`; Strava needs `STRAVA_CLIENT_ID/SECRET`; Hevy needs each user's API key (Hevy Pro).
- The companion phone app (Android first) does NOT exist yet. Its contract is in `companion/README.md`. Until it exists,
  watch data only enters through `POST /api/ingest` (see README curl example).
- Google Health API (cloud route for Fitbit Air) is a stub: Google must verify the app first.
- The Hevy and Strava API calls were written from documentation, never run against live accounts. Expect field-name
  surprises; verify against real responses when I connect my accounts.
- Nothing is hosted. No Git repo yet (please `git init` and commit as a first step).

## Map of the code
```
src/server.js            routes: auth, consent, profile, connections, ingest, summary, compare, friends
src/db.js                schema + queries; tokens encrypted at rest (src/crypto.js); migrations via addCol()
src/join.js              DB side of the join; re-join on late data; dedup; load scoring
src/summary.js           everything the dashboard shows (daily note, tiles, load series, records, compare, friends)
src/insights/*.js        PURE functions, fully tested: join, load+ramp warning, records, hrcost, dedup, note, exercises, time
src/sources/strava.js    OAuth + activities + HR streams
src/sources/hevy.js      API key + workouts (keeps per-set time `t` if the API ever provides it)
src/sources/phone.js     companion-app ingest (Health Connect / Apple Health)
src/sources/googlehealth.js  stub
public/index.html|app.js|app.css|hero.js   the website (no framework, no build step)
scripts/backup.js        nightly VACUUM INTO snapshot, keeps 14
test/                    node:test; test/shim/ is a tiny Express look-alike used ONLY so HTTP tests run without npm install
```

## Rules I want kept
- Keep `src/insights/` pure (no DB, no fetch) and keep tests green.
- Never show OAuth tokens or API keys in the browser or logs.
- Health data: consent screen stays mandatory; "Delete my account" must keep cascading through every table.
- Design: concrete-grey ground, pulse-red accent (`--pulse`), Archivo typeface, works in light and dark mode, no other
  colours or fonts without asking. The sign-in page's cursor trail is intentional; keep it.
- Timezone-aware day boundaries (user's timezone, default `TIMEZONE` env, never bare UTC).

## What I want next, in order
1. `git init`, first commit, run `npm install` and `npm run dev`, confirm it opens at http://localhost:3000.
2. Help me connect Strava for real (register the app at strava.com/settings/api, fill `.env`), then fix whatever breaks.
3. Same for Hevy once I have Hevy Pro.
4. Build the Android companion app from `companion/README.md` (Kotlin, Health Connect changes API, WorkManager,
   pairing by token). That is what makes my Fitbit Air and my friends' Noise/Samsung watches work.
5. Host it (small VPS or Render/Railway/Fly), Google sign-in, `ALLOW_DEV_LOGIN=false`, cron for sync and backup.
6. Then: playwright tests that click through the UI, and swap `test/shim` for real Express in tests.

## Things I will probably ask and the honest answer
- "Why no Google button?" → `GOOGLE_CLIENT_ID` is empty. Local use doesn't need it.
- "Dashboard is empty" → nothing connected yet; connect Strava or Hevy and press Sync now.
- "Fitbit Air data?" → needs the companion app (item 4). The band writes to Health Connect on the phone; there is no web API I can use yet.
