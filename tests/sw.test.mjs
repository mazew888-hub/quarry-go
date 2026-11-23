import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the offline worker carries the app version itself, so a new version changes sw.js and installs', () => {
  const app = read('js/app.js').match(/export const VERSION = '([^']+)'/)[1];
  const sw = read('sw.js').match(/const VERSION = '([^']+)'/);
  assert.ok(sw, 'sw.js has its own VERSION constant');
  assert.equal(sw[1], app);
  assert.match(read('js/app.js'), /serviceWorker\.register\('sw\.js'\)/);
});
