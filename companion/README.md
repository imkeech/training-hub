# Companion app (phone → Hub)

Noise, Samsung, boAt, Fire-Boltt, Amazfit, Fitbit Air, Apple Watch and most other bands have no public
cloud API, or one that needs months of approval. But every one of them writes to the phone's health store:
**Health Connect** on Android, **Apple Health** on iOS. Those stores can only be read by an app on that
phone. So the companion app has exactly one job: read the store, POST to the Hub. No UI beyond pairing.

## Contract with the server

1. On the website, the user presses *Pair Android phone* / *Pair iPhone*. The site shows an ingest URL and a
   one-time device token.
2. The app stores both. From then on, every ~30 minutes (and on launch) it sends:

```
POST {ingestUrl}
Authorization: Bearer {token}
Content-Type: application/json

{
  "hr":       [{"at": "2026-10-28T06:12:00Z", "bpm": 61}, ...],
  "daily":    [{"date": "2026-10-28", "steps": 7375, "resting_hr": 62, "hrv_ms": 32, "spo2_pct": 96.9,
                "breathing_rate": 15.5, "skin_temp_var_c": -0.3, "sleep_hours": 5.7, "sleep_score": 57,
                "sleep_deep_min": 50, "sleep_rem_min": 82, "sleep_light_min": 210, "sleep_awake_min": 37,
                "active_zone_min": 20, "distance_km": 5.5, "calories_total": 2314}],
  "workouts": [{"id": "hc-abc", "type": "Run", "title": "Morning run", "start_at": "...", "end_at": "...",
                "distance_km": 6.2, "calories": 390}]
}
```
Send only what changed since the last successful upload (keep a cursor per record type). Every field is
optional; the server merges.

## Android (first, since Noise/Samsung users are mostly here)

- Kotlin, `androidx.health.connect:connect-client`.
- Request read permissions for: `HeartRateRecord`, `RestingHeartRateRecord`, `HeartRateVariabilityRmssdRecord`,
  `OxygenSaturationRecord`, `RespiratoryRateRecord`, `SkinTemperatureRecord`, `StepsRecord`, `DistanceRecord`,
  `TotalCaloriesBurnedRecord`, `SleepSessionRecord` (stages are inside it), `ExerciseSessionRecord`.
- Use the **changes API** (`getChangesToken` / `getChanges`) so you upload deltas, not history.
- Schedule with `WorkManager` periodic work (15–30 min) plus a manual "Sync now" button.
- Play Store: Health Connect permissions need a declared privacy policy and a short review form. Allow a week.
- Which watch apps write to Health Connect: Google Health (Fitbit Air, Pixel Watch), Samsung Health, NoiseFit,
  Zepp (Amazfit), boAt Crest, Garmin Connect, Oura, Whoop, Polar Flow, Coros. If a friend's watch app isn't
  syncing, the fix is usually one toggle inside that app's settings ("Connect to Health Connect").

## iOS

- Swift, HealthKit. Same record set (`HKQuantityType` heartRate, restingHeartRate, heartRateVariabilitySDNN,
  oxygenSaturation, respiratoryRate, appleSleepingWristTemperature, stepCount, distanceWalkingRunning,
  activeEnergyBurned; `HKCategoryType` sleepAnalysis; `HKWorkoutType`).
- Use `HKAnchoredObjectQuery` for deltas and `HKObserverQuery` + background delivery to wake up for uploads.
- App Store review needs the same privacy wording. Fitbit Air on iPhone writes to Apple Health through the
  Google Health app, so iPhone users of the Air are covered this way too.

## Later: one app, both stores

When this is stable, fold the web dashboard into the same app as a web view so "the app" and "the website"
are the same product, which is what the brief asked for.

## One product: the dashboard inside the app

Once pairing works, the companion app stops being a background utility and becomes "the app":

- Android: a single `WebView` activity pointing at `BASE_URL`, with the sign-in cookie shared via
  `CookieManager`, plus the background Health Connect worker. Add a JavaScript interface
  (`window.Hub.pair(token)`) so the "Pair Android phone" button on the website can hand the token to the app
  directly instead of asking the person to copy it.
- iOS: `WKWebView` the same way, with the HealthKit uploader in a background task.
- Keep every screen on the web side. The app only contributes what a browser cannot: reading the health store
  and uploading in the background. That keeps one codebase for phone and website, which is what the brief asked for.
