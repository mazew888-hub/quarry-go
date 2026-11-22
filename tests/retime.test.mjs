import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeq, applySection, isCut, posAtOrAfter, posAtOrBefore } from '../js/retime.js';

test('identity when not retimed', () => {
  assert.deepEqual(buildSeq(5, [], false).seq, [0, 1, 2, 3, 4]);
});
test('half speed doubles', () => {
  assert.deepEqual(buildSeq(10, [{ a: 2, b: 3, type: 'speed', r: 0.5 }], true).seq, [0, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8, 9]);
});
test('double speed skips', () => {
  assert.deepEqual(buildSeq(4, [{ a: 0, b: 3, type: 'speed', r: 2 }], true).seq, [0, 2]);
});
test('hold repeats a', () => {
  assert.deepEqual(buildSeq(5, [{ a: 1, b: 3, type: 'hold' }], true).seq, [0, 1, 1, 1, 4]);
});
test('cut removes and marks', () => {
  const r = buildSeq(4, [{ a: 1, b: 2, type: 'cut' }], true);
  assert.deepEqual(r.seq, [0, 3]);
  assert.deepEqual(r.cuts, [1]);
});
test('everything cut', () => {
  assert.deepEqual(buildSeq(4, [{ a: 0, b: 3, type: 'cut' }], true).seq, [0]);
});
test('applySection trims overlaps', () => {
  const { secs, mine } = applySection([{ a: 5, b: 15, type: 'speed', r: 2 }], 10, 20, 'hold');
  assert.deepEqual(secs, [{ a: 5, b: 9, type: 'speed', r: 2 }, { a: 10, b: 20, type: 'hold', r: undefined }]);
  assert.equal(mine, secs[1]);
  assert.deepEqual(applySection(secs, 0, 100, null).secs, []);
});
test('applySection splits a section around a smaller one', () => {
  const { secs } = applySection([{ a: 0, b: 9, type: 'hold' }], 3, 4, 'cut');
  assert.deepEqual(secs.map(s => [s.a, s.b, s.type]), [[0, 2, 'hold'], [3, 4, 'cut'], [5, 9, 'hold']]);
});
test('original view tags sections', () => {
  assert.equal(buildSeq(4, [{ a: 1, b: 2, type: 'cut' }], false).at[1].type, 'cut');
});
test('isCut and position lookups', () => {
  const secs = [{ a: 1, b: 2, type: 'cut' }];
  assert.equal(isCut(secs, 2), true);
  assert.equal(isCut(secs, 3), false);
  const seq = [0, 3, 3, 5];
  assert.equal(posAtOrAfter(seq, 1), 1);
  assert.equal(posAtOrBefore(seq, 4), 2);
  assert.equal(posAtOrAfter(seq, 9), 3);
  assert.equal(posAtOrBefore(seq, -1), 0);
});
