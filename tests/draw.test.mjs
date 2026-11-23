import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eraseStroke, drawingStarts, drawingAt, holdOf, legacyHolds, hitsShape } from '../js/draw.js';

test('erasing the middle of a line splits it in two', () => {
  const pts = [[0, 0], [10, 0], [20, 0], [30, 0], [40, 0], [50, 0], [60, 0]];
  const parts = eraseStroke(pts, [[30, -10], [30, 10]], 6);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].at(-1)[0] >= 18 && parts[0].at(-1)[0] <= 24);
  assert.ok(parts[1][0][0] >= 36 && parts[1][0][0] <= 42);
});

test('erasing away from a line leaves it whole', () => {
  const pts = [[0, 0], [10, 0], [20, 0]];
  assert.deepEqual(eraseStroke(pts, [[0, 50], [20, 50]], 6), [pts]);
});

test('erasing a line completely leaves nothing', () => {
  assert.deepEqual(eraseStroke([[0, 0], [2, 0]], [[1, 0]], 6), []);
});

test('long segments are erased where the eraser crosses them, not only at points', () => {
  const parts = eraseStroke([[0, 0], [100, 0]], [[50, -5], [50, 5]], 4);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].at(-1)[0] <= 46 && parts[1][0][0] >= 54);
});

test('drawing starts and which drawing a frame shows', () => {
  const marks = [{ f: 2, type: 'draw' }, { f: 2, type: 'box' }, { f: 9, type: 'draw' }, { f: 4, type: 'note' }];
  assert.deepEqual(drawingStarts(marks), [2, 9]);
  const holds = { 2: 5 };
  assert.equal(holdOf(holds, 2), 5);
  assert.equal(holdOf(holds, 9), 1);
  assert.equal(drawingAt(marks, holds, 6), 2);
  assert.equal(drawingAt(marks, holds, 7), null);
  assert.equal(drawingAt(marks, holds, 9), 9);
  assert.equal(drawingAt(marks, holds, 10), null);
});

test('a later drawing wins where two overlap', () => {
  const marks = [{ f: 0, type: 'draw' }, { f: 3, type: 'draw' }];
  assert.equal(drawingAt(marks, { 0: 10 }, 3), 3);
  assert.equal(drawingAt(marks, { 0: 10 }, 5), 0);
});

test('old reviews keep their 12-frame holds', () => {
  const marks = [{ f: 2, type: 'arrow' }, { f: 8, type: 'draw' }, { f: 1, type: 'note' }];
  assert.deepEqual(legacyHolds(marks), { 2: 12, 8: 12 });
});

test('eraser touches shapes by their outline', () => {
  assert.equal(hitsShape({ type: 'box', x1: 0, y1: 0, x2: 100, y2: 50 }, [50, 2], 5), true);
  assert.equal(hitsShape({ type: 'box', x1: 0, y1: 0, x2: 100, y2: 50 }, [50, 25], 5), false);
  assert.equal(hitsShape({ type: 'circle', x1: 0, y1: 0, x2: 30, y2: 40 }, [50, 0], 3), true);
  assert.equal(hitsShape({ type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0 }, [60, 3], 5), true);
});
