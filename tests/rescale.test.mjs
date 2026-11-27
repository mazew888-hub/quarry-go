import test from 'node:test';
import assert from 'node:assert/strict';
import { rescaleReview } from '../js/rescale.js';

// A review made when a 30 fps clip was read as 24 fps (199 frames instead of 249): its frames, warp and
// holds move to the clip's real frames, so notes and timing land where they were made.
test('everything frame-based is scaled to the real frames', () => {
  const r = { fps: 24, frameCount: 199, pos: 40, inF: 8, outF: 160,
    marks: [{ f: 45, type: 'note', text: 'a' }, { f: 100, type: 'draw' }],
    holds: { 100: 12 }, warp: { keys: [{ x: 0, y: 0, t: 'linear' }, { x: 212, y: 198, t: 'smooth' }] } };
  const p = rescaleReview(r, 30, 249);
  assert.deepEqual(p.marks.map(m => m.f), [56, 125]);
  assert.deepEqual(p.holds, { 125: 15 });
  assert.deepEqual(p.warp.keys, [{ x: 0, y: 0, t: 'linear' }, { x: 265, y: 247.5, t: 'smooth' }]);
  assert.equal(p.pos, 50); assert.equal(p.inF, 10); assert.equal(p.outF, 200);
  assert.equal(p.fps, 30); assert.equal(p.frameCount, 249);
});
test('the same rate: nothing to change', () => {
  assert.equal(rescaleReview({ fps: 30, frameCount: 249, marks: [] }, 30, 249), null);
  assert.equal(rescaleReview({ marks: [] }, 30, 249), null);   // no rate saved: leave it
});
test('warp values stay inside the clip', () => {
  const p = rescaleReview({ fps: 24, frameCount: 10, warp: { keys: [{ x: 0, y: 0, t: 'linear' }, { x: 9, y: 9, t: 'linear' }] } }, 30, 12);
  assert.ok(p.warp.keys.every(k => k.y <= 11));
});
