import test from 'node:test';
import assert from 'node:assert/strict';
import { frameSize } from '../js/framesize.js';

test('short clips keep full size (up to 960 wide)', () => {
  assert.deepEqual(frameSize(100, 1920, 1080, 256e6), { W: 960, H: 540 });
});

test('long clips shrink to fit the memory budget instead of going black', () => {
  const { W, H } = frameSize(240, 1920, 1080, 256e6);
  assert.ok(240 * W * H * 4 <= 256e6, 'over budget');
  assert.ok(W > 600 && Math.abs(W / H - 16 / 9) < 0.02);
});

test('far too long for the budget: null (the clip is refused, not shown tiny)', () => {
  assert.equal(frameSize(5000, 1920, 1080, 256e6), null);
});
