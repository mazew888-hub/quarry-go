// Stress: random time warps of every shape. The played frames always stay inside the clip, and a review
// moved to another frame rate (rescaleReview) still plays the same video at the same moments.
import test from 'node:test';
import assert from 'node:assert/strict';
import { frameMap } from '../../js/warp.js';
import { rescaleReview } from '../../js/rescale.js';

let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const T = ['linear', 'smooth', 'flat', 'step'];
function randomWarp(n) {
  const k = 2 + Math.floor(rnd() * 30), keys = []; let x = 0;
  for (let i = 0; i < k; i++) { keys.push({ x, y: Math.round(rnd() * (n - 1) * 100) / 100, t: T[Math.floor(rnd() * 4)] }); x += 1 + Math.floor(rnd() * 20); }
  keys[0].y = 0; return keys;
}
test('500 random warps: every played frame is a real frame of the clip', () => {
  for (let i = 0; i < 500; i++) {
    const n = 2 + Math.floor(rnd() * 400), keys = randomWarp(n), m = frameMap(keys, n);
    assert.equal(m.length, Math.round(keys.at(-1).x) + 1);
    assert.ok(m.every(v => Number.isInteger(v) && v >= 0 && v < n), JSON.stringify(keys));
  }
});
test('a one-frame clip and a two-key warp', () => {
  assert.deepEqual(frameMap([{ x: 0, y: 0, t: 'linear' }, { x: 4, y: 0, t: 'linear' }], 1), [0, 0, 0, 0, 0]);
  assert.deepEqual(frameMap([{ x: 0, y: 0, t: 'linear' }, { x: 3, y: 9, t: 'linear' }], 10), [0, 3, 6, 9]);
});
test('rescaled to another frame rate, a linear warp shows the same moment of video at the same time', () => {
  for (const [a, b] of [[24, 30], [30, 24], [25, 30], [24, 60], [29.97, 30]]) {
    const n = 120, keys = [{ x: 0, y: 0, t: 'linear' }, { x: 40, y: 20, t: 'linear' }, { x: 50, y: 20, t: 'linear' }, { x: 100, y: 119, t: 'linear' }];
    const nb = Math.round(n * b / a), p = rescaleReview({ fps: a, frameCount: n, warp: { keys } }, b, nb);
    if (!p) { assert.ok(Math.abs(b / a - 1) < 0.01); continue; }   // 29.97 vs 30: close enough to leave alone
    const ma = frameMap(keys, n), mb = frameMap(p.warp.keys, nb);
    for (let j = 0; j < mb.length; j++) {
      // whole-frame rounding on both sides, on a slope of about 2: within about two frames
      const t = j / b, ja = Math.min(ma.length - 1, Math.round(t * a));
      assert.ok(Math.abs(mb[j] / b - ma[ja] / a) <= 2.5 / Math.min(a, b), `${a}->${b} at ${j}: ${mb[j]} vs ${ma[ja]}`);
    }
  }
});
