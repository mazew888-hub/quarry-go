import test from 'node:test';
import assert from 'node:assert/strict';
import { steady, centreline, pieces, area } from '../js/stroke.js';

test('steady: no smoothing follows the pen exactly; 60% trails behind it, like Quarry', () => {
  assert.deepEqual(steady([0, 0], [10, 0], 0), [10, 0]);
  const [x] = steady([0, 0], [10, 0], 0.6);
  assert.ok(Math.abs(x - 4) < 1e-9);
  const [y] = steady([0, 0], [10, 0], 1);         // never stuck: the most smoothing still moves
  assert.ok(y > 0.5);
});

test('centreline: a smooth curve through the midpoints, with the width carried along', () => {
  const c = centreline([[0, 0, 1], [10, 0, 1], [10, 10, 0.5]], 2);
  assert.deepEqual(c[0], [0, 0, 1]);
  assert.deepEqual(c.at(-1), [10, 10, 0.5]);
  assert.ok(c.length > 6);                         // filled in between, not three corners
  for (let i = 1; i < c.length; i++) assert.ok(Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]) <= 3);
});

test('pieces all wind the same way, so one fill never doubles up where they overlap', () => {
  const ps = pieces(centreline([[0, 0, 1], [20, 5, 0.6], [30, 30, 1], [5, 40, 0.3]], 1.5), 6);
  assert.ok(ps.length > 10);
  for (const p of ps) assert.ok(p.r != null ? true : area(p.pts) > 0, 'a piece wound the other way');
});
