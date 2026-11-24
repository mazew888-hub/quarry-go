import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('every app script is in the offline list', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const f of readdirSync(new URL('../js/', import.meta.url))) assert.ok(sw.includes(`'js/${f}'`), `sw.js is missing js/${f}`);
});
test('Quarry\'s Maya loader is in the offline list (exports work without a connection)', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'maya/maya_drop.py'"));
});
