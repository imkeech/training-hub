// Click-through tests in a real browser: the sign-in page at two sizes, then sign in → consent → demo data → dashboard.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

// Collect anything that would mean "something is broken": JS exceptions, console errors, failed or 4xx/5xx local requests.
const watchErrors = (page) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
  page.on('requestfailed', (r) => { if (r.url().includes('localhost')) errs.push(`request failed: ${r.url()} ${r.failure()?.errorText}`); });
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('localhost')) errs.push(`${r.status()} ${r.url()}`); });
  return errs;
};
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const noErrorBanners = async (page) => {
  await expect(page.locator('body > p.wrap'), 'boot error line').toHaveCount(0);
  await expect(page.locator('.status.err:visible'), 'red status line').toHaveCount(0);
  await expect(page.locator('#no-login'), 'sign-in-not-set-up notice').toBeHidden();
};

test('sign-in page: fills the screen, headline and name box usable, no errors', async ({ page }, info) => {
  const errs = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('#signed-out')).toBeVisible();
  const h1 = page.locator('.hero h1'), name = page.locator('#dev-login input[name=name]');
  await expect(h1).toBeVisible();
  await expect(name).toBeVisible();
  await expect(page.locator('#dev-login button')).toBeVisible();

  // No sideways scrolling and nothing dark at the edges: whatever is painted at the far left/right is the page background.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'horizontal overflow').toBeLessThanOrEqual(0);
  const edges = await page.evaluate(() => {
    const paint = (x, y) => { let el = document.elementFromPoint(x, y); while (el && getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)') el = el.parentElement; return el ? getComputedStyle(el).backgroundColor : null; };
    const ys = [0.3, 0.5, 0.7].map((f) => Math.round(innerHeight * f));
    return { body: getComputedStyle(document.body).backgroundColor, left: ys.map((y) => paint(2, y)), right: ys.map((y) => paint(innerWidth - 3, y)) };
  });
  expect(edges.body).not.toBe('rgb(0, 0, 0)');
  for (const c of [...edges.left, ...edges.right]) expect(c, 'side strip colour').toBe(edges.body);

  // The hero must sit inside the viewport, with nothing covering the headline or the name box.
  const vp = page.viewportSize();
  const hero = await page.locator('#hero').boundingBox();
  expect(hero.x).toBeGreaterThanOrEqual(0); expect(hero.x + hero.width).toBeLessThanOrEqual(vp.width + 1);
  const onTop = async (sel) => { const b = await page.locator(sel).boundingBox(); return page.evaluate(([x, y, s]) => !!document.elementFromPoint(x, y)?.closest(s), [b.x + b.width / 2, b.y + b.height / 2, sel]); };

  // Frames fade out after about a second, so record where every frame is *while* we move, not just at the end.
  const seen = [];
  const collect = async () => { seen.push(...await page.locator('.frame').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))); };
  if (info.project.name === 'phone') {
    for (let i = 0; i < 10; i++) { await page.waitForTimeout(300); await collect(); } // frames drift in on their own on touch screens
  } else {
    // Sweep the mouse over the whole hero, including right along the edges of the text, so frames spawn everywhere they can.
    const pts = [];
    for (let r = 0; r <= 6; r++) for (let c = 0; c <= 8; c++) pts.push([hero.x + 20 + (hero.width - 40) * c / 8, hero.y + 10 + (hero.height - 20) * r / 6]);
    const hb = await h1.boundingBox(), nb = await name.boundingBox();
    for (const b of [hb, nb]) for (let i = 0; i <= 6; i++) pts.push([b.x + b.width * i / 6, b.y - 6], [b.x + b.width * i / 6, b.y + b.height + 6], [b.x + b.width + 6, b.y + b.height * i / 6]);
    for (const [x, y] of pts) { await page.mouse.move(x, y, { steps: 2 }); await collect(); }
    expect(seen.length, 'the cursor trail should produce frames').toBeGreaterThan(0);
  }
  info.annotations.push({ type: 'trail frames observed', description: String(seen.length) });
  for (const sel of ['.hero h1', '#dev-login input[name=name]']) {
    const box = await page.locator(sel).boundingBox();
    for (const f of seen) expect(overlaps(f, box), `a trail frame at ${Math.round(f.x)},${Math.round(f.y)} covers ${sel}`).toBe(false);
    expect(await onTop(sel), `${sel} is covered by something`).toBe(true);
  }

  // Typing works.
  await name.click();
  await name.fill('Test Person');
  await expect(name).toHaveValue('Test Person');

  await noErrorBanners(page);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-signin.png` });
  expect(errs).toEqual([]);
});

test('sign in, accept consent, load demo data, dashboard fills, remove, sign out', async ({ page }, info) => {
  const errs = watchErrors(page);
  const who = `E2E ${info.project.name}`;
  await page.goto('/');
  await page.fill('#dev-login input[name=name]', who);
  await page.click('#dev-login button');

  await expect(page.locator('#consent')).toBeVisible();
  await expect(page.locator('#today')).toBeHidden();
  await expect(page.locator('#consent-go')).toBeDisabled();
  await page.check('#agree');
  await expect(page.locator('#consent-go')).toBeEnabled();
  await page.click('#consent-go');

  await expect(page.locator('#today')).toBeVisible();
  await expect(page.locator('#nav')).toHaveText(who);
  await expect(page.locator('#feed-empty')).toBeVisible();
  await expect(page.locator('#demo-load')).toBeVisible();

  await page.click('#demo-load');
  await expect(page.locator('#demo-clear')).toBeVisible();
  await expect(page.locator('#demo-load')).toBeHidden();
  for (const id of ['#w-sessions', '#w-volume', '#w-km', '#w-sleep', '#w-rhr', '#ls-title', '#note']) await expect(page.locator(id), id).not.toHaveText(/^—?$/);
  expect(await page.locator('#rows tr').count(), 'session rows').toBeGreaterThan(20);
  expect(await page.locator('#reclist .rec').count(), 'records').toBeGreaterThan(0);
  await expect(page.locator('#loadchart svg')).toBeVisible();
  await expect(page.locator('#line')).toHaveAttribute('d', /M/);
  await expect(page.locator('#feed-empty')).toBeHidden();

  const ids = await page.locator('#cmp-a option').evaluateAll((o) => o.map((x) => x.value).filter(Boolean));
  expect(ids.length).toBeGreaterThan(1);
  await page.selectOption('#cmp-a', ids[0]); await page.selectOption('#cmp-b', ids[1]);
  await expect(page.locator('#cmp-out')).toBeVisible();
  expect(await page.locator('#cmp-rows tr').count()).toBeGreaterThan(0);

  await noErrorBanners(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'horizontal overflow').toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-dashboard.png`, fullPage: true });

  await page.click('#demo-clear');
  await expect(page.locator('#demo-load')).toBeVisible();
  await expect(page.locator('#feed-empty')).toBeVisible();
  await page.click('#logout');
  await expect(page.locator('#signed-out')).toBeVisible();
  expect(errs).toEqual([]);
});

test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' });
  test('sign-in page switches to the dark palette', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero h1')).toBeVisible();
    const { bg, ink } = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.querySelector('.hero h1')).color }));
    const lum = (c) => c.match(/\d+/g).slice(0, 3).map(Number).reduce((a, b) => a + b, 0) / 3;
    expect(lum(bg)).toBeLessThan(60);
    expect(lum(ink)).toBeGreaterThan(180);
  });
});
