// Browser tests. `npm run test:e2e` starts its own copy of the server on port 3100 with a throw-away database,
// so nothing here touches data/hub.db. Two "projects": a wide desktop and a phone.
import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 3100;
const dbPath = join(mkdtempSync(join(tmpdir(), 'hub-e2e-')), 'e2e.db');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000, // the desktop sign-in test sweeps the mouse over a 2560px-wide page; that alone takes ~25 s
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: `"${process.execPath}" --experimental-sqlite src/server.js`,
    url: `http://localhost:${PORT}/api/me`,
    reuseExistingServer: false,
    timeout: 20_000,
    env: { PORT: String(PORT), BASE_URL: `http://localhost:${PORT}`, DB_PATH: dbPath, ALLOW_DEV_LOGIN: 'true', SESSION_SECRET: 'e2e-only',
      GOOGLE_CLIENT_ID: '', STRAVA_CLIENT_ID: '', TIMEZONE: 'Asia/Kolkata' },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 2560, height: 1400 } } },
    { name: 'phone', use: { ...devices['iPhone 14'], browserName: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
});
