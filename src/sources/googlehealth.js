// Google Health API: the cloud route for Fitbit Air / Pixel Watch data (successor of the Fitbit Web API).
// Status (Oct 2026): all scopes are "restricted" → Google must verify the app (privacy policy, security
// assessment) before non-test users can connect, and new-project onboarding is limited. The OAuth flow below
// works for accounts added as test users in the Cloud Console. Until verification, Fitbit Air users should
// pair the phone instead (Health Connect), which needs no approval.
// Docs: developers.google.com/health
import { getConnection, saveConnection, markSync } from '../db.js';

const SCOPES = [
  'https://www.googleapis.com/auth/health.activity.read',
  'https://www.googleapis.com/auth/health.heart_rate.read',
  'https://www.googleapis.com/auth/health.sleep.read',
  'https://www.googleapis.com/auth/health.oxygen_saturation.read',
];

export const enabled = () => !!process.env.GOOGLEHEALTH_CLIENT_ID;

export const authorizeUrl = (state) => {
  const p = new URLSearchParams({ client_id: process.env.GOOGLEHEALTH_CLIENT_ID, redirect_uri: `${process.env.BASE_URL}/auth/googlehealth/callback`,
    response_type: 'code', access_type: 'offline', prompt: 'consent', scope: SCOPES.join(' '), state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
};

export async function handleCallback(userId, code) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLEHEALTH_CLIENT_ID, client_secret: process.env.GOOGLEHEALTH_CLIENT_SECRET,
      redirect_uri: `${process.env.BASE_URL}/auth/googlehealth/callback`, grant_type: 'authorization_code' }) });
  if (!r.ok) throw new Error(`Google Health token ${r.status}: ${await r.text()}`);
  const t = await r.json();
  saveConnection(userId, 'googlehealth', { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Math.floor(Date.now() / 1000) + t.expires_in });
}

export async function sync(userId) {
  const c = getConnection(userId, 'googlehealth');
  if (!c) throw new Error('Google Health not connected');
  // TODO once the app is verified: call the Google Health API resources for heart rate (→ insertHrSamples),
  // sleep/SpO2/HRV/breathing (→ upsertDaily) and sessions (→ upsertSession). The endpoint names and
  // JSON shapes are in the official reference; verify them there rather than guessing here.
  markSync(userId, 'googlehealth', 'Sync not implemented until Google verifies the app. Pair your phone instead.');
  return 0;
}
