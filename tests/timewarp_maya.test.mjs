// The time warp .py run against a stand-in for Maya: keys land where the video's timing says they should.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { timeWarpPy } from '../js/handback.js';

const run = (fps, unit) => {
  const py = timeWarpPy({ name: 'g', fps, frameCount: 41, retimed: true,
    warp: { keys: [{ x: 0, y: 0, t: 'linear' }, { x: 20, y: 10, t: 'linear' }, { x: 40, y: 40, t: 'linear' }] } });
  const f = join(mkdtempSync(join(tmpdir(), 'tw-')), 'tw.py'); writeFileSync(f, py);
  return JSON.parse(execFileSync('python3', [new URL('./fixtures/fake_maya.py', import.meta.url).pathname, f, unit]).toString().trim().split('\n').pop());
};

test('same rate: keys go on frame for frame from the curve\'s first key', () => {
  assert.deepEqual(run(24, 'film').keys, [[1, 1], [21, 11], [41, 41]]);
});
test('a 24 fps video on a 30 fps scene: keys are scaled to the scene\'s frames, so the timing matches the video', () => {
  const r = run(24, 'ntsc');
  assert.deepEqual(r.keys, [[1, 1], [26, 13.5], [51, 51]]);
});
