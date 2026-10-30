// Screenshots of the running app (default http://localhost:3000) for a quick visual check.
//   npm run screenshots            → e2e/screenshots/dev-*.png
// Signs in with the test login as NAME (default "Krishna"), accepts consent, loads demo data if needed.
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:3000', NAME = process.env.NAME || 'Krishna', OUT = 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

// 1. sign-in page, wide desktop, with the cursor trail live
let ctx = await browser.newContext({ viewport: { width: 2560, height: 1400 } }), page = await ctx.newPage();
await page.goto(BASE); await page.waitForSelector('#dev-login input[name=name]');
const hero = await page.locator('#hero').boundingBox();
for (let i = 0; i <= 14; i++) await page.mouse.move(hero.x + 60 + (hero.width - 120) * i / 14, hero.y + 30 + (hero.height - 60) * (0.5 + 0.5 * Math.sin(i / 2)), { steps: 4 });
await page.fill('#dev-login input[name=name]', NAME);
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/dev-signin-2560x1400.png` });
console.log('saved', `${OUT}/dev-signin-2560x1400.png`);
await ctx.close();

// 2. sign-in page, phone
ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: 390, height: 844 } }); page = await ctx.newPage();
await page.goto(BASE); await page.waitForSelector('#dev-login input[name=name]');
await page.waitForTimeout(2200);
await page.screenshot({ path: `${OUT}/dev-signin-390x844.png` });
console.log('saved', `${OUT}/dev-signin-390x844.png`);
await ctx.close();

// 3. sign in → consent → demo → dashboard
ctx = await browser.newContext({ viewport: { width: 2560, height: 1400 } }); page = await ctx.newPage();
await page.goto(BASE);
await page.fill('#dev-login input[name=name]', NAME); await page.click('#dev-login button');
await page.waitForSelector('#signed-in:not([hidden])');
if (await page.locator('#consent').isVisible()) { await page.check('#agree'); await page.click('#consent-go'); await page.waitForSelector('#today:not([hidden])'); }
if (await page.locator('#demo-load').isVisible()) { await page.click('#demo-load'); await page.waitForSelector('#demo-clear:not([hidden])'); }
await page.waitForFunction(() => document.querySelector('#ls-title')?.textContent !== '—');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/dev-dashboard-2560.png`, fullPage: true });
console.log('saved', `${OUT}/dev-dashboard-2560.png`);
await browser.close();
