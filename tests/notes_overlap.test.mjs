import test from 'node:test';
import assert from 'node:assert/strict';
import { renderer } from '../js/render.js';

// a fake 2D context that records the note text it draws
function ctx() {
  const said = [];
  const c = new Proxy({ said, measureText: t => ({ width: t.length * 8 }), fillText: t => said.push(t) }, { get: (o, k) => k in o ? o[k] : () => {}, set: (o, k, v) => { o[k] = v; return true; } });
  return c;
}
test('two notes close together: the newer one replaces the older, never two boxes on top of each other', () => {
  const marks = [{ type: 'note', f: 10, text: 'head turns early' }, { type: 'note', f: 14, text: 'arms read awkward' }];
  const r = renderer({ frames: [], W: 960, H: 540, state: () => ({ marks, holds: [], retimed: false }) });
  const c = ctx(); r.compose(c, 14, true);
  assert.ok(c.said.join(' ').includes('arms read awkward'));
  assert.ok(!c.said.join(' ').includes('head turns early'));
});
test('a note shows on its own frame only (it is about that moment); frame 1 lists the frames with notes', () => {
  const marks = [{ type: 'note', f: 10, text: 'head turns early' }, { type: 'note', f: 60, text: 'arms read awkward' }];
  const r = renderer({ frames: [], W: 960, H: 540, state: () => ({ marks, holds: [], retimed: false }) });
  const at = f => { const c = ctx(); r.compose(c, f, true); return c.said.join(' '); };
  assert.ok(at(10).includes('head turns early'));
  assert.equal(at(11), '');
  const seq = Array.from({ length: 100 }, (_, j) => j);
  assert.deepEqual(r.noteFrames(seq), [11, 61]);
  const c = ctx(); r.noteBanner(c, seq); assert.match(c.said.join(' '), /Notes on frames 11, 61/);
  // retimed: numbers are the exported frames (video frame 60 first appears as frame 90 here)
  const slow = Array.from({ length: 150 }, (_, j) => Math.floor(j / 1.5));
  assert.deepEqual(r.noteFrames(slow), [16, 91]);
});
