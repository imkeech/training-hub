// Static UI check: every #id the client script touches exists in index.html, and the HTML is well-formed enough.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
test('every element id used by app.js exists in index.html', () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([...js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]));
  const missing = [...used].filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
});
test('ids are unique and forms have the fields the script reads', () => {
  const all = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(all).size, all.length, 'duplicate ids');
  for (const f of ['age', 'weight_kg', 'max_hr', 'timezone']) assert.match(html, new RegExp(`name="${f}"`));
  assert.match(html, /name="apiKey"/); assert.match(html, /name="email"/);
});
test('page declares viewport, dark mode tokens and a fallback font', () => {
  assert.match(html, /viewport-fit=cover/);
  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-color-scheme:dark/); assert.match(css, /data-theme="dark"/); assert.match(css, /system-ui/);
});
