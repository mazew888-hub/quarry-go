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
  const c = ctx(); r.compose(c, 15, true);
  assert.ok(c.said.join(' ').includes('arms read awkward'));
  assert.ok(!c.said.join(' ').includes('head turns early'));
});
test('a note stays up until the next one (the video never pauses, so the time warp still reads)', () => {
  const marks = [{ type: 'note', f: 10, text: 'head turns early' }, { type: 'note', f: 60, text: 'arms read awkward' }];
  const r = renderer({ frames: [], W: 960, H: 540, state: () => ({ marks, holds: [], retimed: false }) });
  const at = f => { const c = ctx(); r.compose(c, f, true); return c.said.join(' '); };
  assert.equal(at(5), '');
  assert.ok(at(45).includes('head turns early'));
  assert.ok(at(61).includes('arms read awkward') && !at(61).includes('head turns'));
});
