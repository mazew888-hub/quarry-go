import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  identity, sampler, slopes, frameMap, isIdentity, fromSections, setKey, deleteKey, nudgeAfter, nudgeKey,
  setTangent, moveKey, holdRange, cutRange, speedRange, keyAt, rateAt, frameView,
} from '../js/warp.js';
import { buildSeq } from '../js/retime.js';

const ids = n => Array.from({ length: n }, (_, i) => i);

test('identity plays every frame once', () => {
  const k = identity(10);
  assert.deepEqual(frameMap(k, 10), ids(10));
  assert.equal(isIdentity(k, 10), true);
  assert.deepEqual(frameMap(identity(1), 1), [0]);
});

test('old Hold / Cut / Speed sections become the same curve', () => {
  for (const secs of [[{ a: 5, b: 9, type: 'hold' }], [{ a: 5, b: 9, type: 'cut' }], [{ a: 0, b: 3, type: 'cut' }],
    [{ a: 2, b: 5, type: 'hold' }, { a: 8, b: 12, type: 'cut' }]]) {
    assert.deepEqual(frameMap(fromSections(20, secs), 20), buildSeq(20, secs, true).seq, JSON.stringify(secs));
  }
  const sp = frameMap(fromSections(20, [{ a: 4, b: 11, type: 'speed', r: 0.5 }]), 20), want = buildSeq(20, [{ a: 4, b: 11, type: 'speed', r: 0.5 }], true).seq;
  assert.equal(sp.length, want.length);
  sp.forEach((v, i) => assert.ok(Math.abs(v - want[i]) <= 1));
});

test('setting a key leaves the timing as it was', () => {
  const k = fromSections(20, [{ a: 4, b: 11, type: 'speed', r: 0.5 }]), before = frameMap(k, 20);
  const k2 = setKey(k, 9);
  assert.equal(k2.length, k.length + 1);
  assert.ok(keyAt(k2, 9) >= 0);
  assert.deepEqual(frameMap(k2, 20), before);
  assert.equal(setKey(k2, 9), k2, 'a key already there: nothing changes');
});

test('nudge after the playhead: every key after it moves a frame later (or sooner), so that stretch gets longer (or shorter)', () => {
  const k = setKey(identity(10), 4);
  const later = nudgeAfter(k, 4, 1);
  assert.equal(frameMap(later, 10).length, 11);
  assert.deepEqual(frameMap(later, 10).slice(0, 5), [0, 1, 2, 3, 4]);
  assert.equal(frameMap(later, 10).at(-1), 9);
  const sooner = nudgeAfter(k, 4, -1);
  assert.equal(frameMap(sooner, 10).length, 9);
  assert.deepEqual(frameMap(sooner, 10).slice(0, 5), [0, 1, 2, 3, 4]);
  assert.equal(frameMap(sooner, 10).at(-1), 9);
  // keys can't pass the playhead's key: refused
  const tight = nudgeAfter(setKey(setKey(identity(10), 4), 5), 4, -1);
  assert.equal(tight, null);
});

test('nudge a key up or down moves only that key\'s frame', () => {
  const k = setKey(setKey(setKey(identity(20), 5), 10), 15), i = keyAt(k, 10);
  const up = nudgeKey(k, i, 1, 20), m = frameMap(up, 20);
  assert.equal(m[10], 11);
  assert.deepEqual(m.slice(0, 6), ids(6)); assert.deepEqual(m.slice(15), ids(20).slice(15));
  assert.equal(frameMap(nudgeKey(k, i, -1, 20), 20)[10], 9);
  assert.equal(frameMap(nudgeKey(identity(20), 1, 5, 20), 20).at(-1), 19, 'kept inside the clip');
});

test('tangents: step holds until the next key, flat eases, linear is straight', () => {
  const k = setKey(setKey(identity(20), 5), 15);
  const st = setTangent(k, keyAt(k, 5), 'step'), f = sampler(st);
  assert.equal(f(5), 5); assert.equal(f(10), 5); assert.equal(f(14.9), 5); assert.equal(f(15), 15);
  const lin = sampler(k); assert.equal(lin(10), 10);
  const fl = setTangent(setTangent(k, keyAt(k, 5), 'flat'), keyAt(k, 15), 'flat');
  const s = slopes(fl); assert.equal(s[keyAt(fl, 5)].out, 0); assert.equal(s[keyAt(fl, 15)].in, 0);
  const ff = sampler(fl); assert.ok(ff(6) < 6 && ff(14) > 14, 'eases out of and into the keys');
  assert.equal(ff(10), 10);
});

test('smooth keys pass through their neighbours\' line', () => {
  const k = [{ x: 0, y: 0, t: 'smooth' }, { x: 10, y: 20, t: 'smooth' }, { x: 20, y: 20, t: 'smooth' }];
  const s = slopes(k);
  assert.equal(s[1].in, 1); assert.equal(s[1].out, 1); // (20 - 0) / (20 - 0)
  assert.equal(sampler(k)(10), 20);
});

test('delete a key, never the last two', () => {
  const k = setKey(identity(10), 4);
  assert.equal(deleteKey(k, keyAt(k, 4)).length, 2);
  assert.equal(deleteKey(identity(10), 0), null);
});

test('move a key: stays between its neighbours, on whole frames', () => {
  const k = setKey(setKey(identity(20), 5), 10), i = keyAt(k, 5);
  const m = moveKey(k, i, 12.4, 7.6, 20);
  assert.deepEqual([m[i].x, m[i].y], [9, 8]);
  assert.equal(moveKey(k, 0, 5, 3, 20)[0].x, 0, 'the first key stays at the start');
});

test('Hold, Cut and Speed shape the curve like the old sections (on an unwarped clip)', () => {
  for (const [fn, type, extra] of [[holdRange, 'hold'], [cutRange, 'cut']]) {
    for (const [a, b] of [[5, 9], [0, 3], [16, 19], [1, 1]]) {
      const got = frameMap(fn(identity(20), a, b), 20), want = buildSeq(20, [{ a, b, type }], true).seq;
      assert.deepEqual(got, want, `${type} ${a}-${b}`);
    }
  }
  for (const r of [0.5, 2, 0.25]) {
    const got = frameMap(speedRange(identity(20), 4, 11, r), 20), want = buildSeq(20, [{ a: 4, b: 11, type: 'speed', r }], true).seq;
    assert.equal(got.length, want.length, `speed ${r}`);
    got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) <= 1, `speed ${r} at ${i}: ${v} vs ${want[i]}`));
  }
});

test('Hold on a clip that is already warped holds what is showing', () => {
  const k = cutRange(identity(30), 5, 9), shown = frameMap(k, 30);
  const held = frameMap(holdRange(k, 8, 10), 30);
  assert.equal(held.length, shown.length);
  assert.deepEqual(held.slice(8, 11), [shown[8], shown[8], shown[8]]);
  assert.deepEqual(held.slice(11), shown.slice(11));
});

test('rateAt: how fast the video plays at an output frame', () => {
  const k = speedRange(identity(20), 4, 11, 0.5);
  assert.equal(rateAt(k, 1), 1); assert.equal(rateAt(k, 6), 0.5);
  assert.equal(rateAt(holdRange(identity(20), 5, 9), 7), 0);
});

test('frame keys: the view spans the 3 keys before the playhead and the 3 after, with a little room', () => {
  let k = identity(100); for (const x of [10, 20, 30, 40, 50, 60, 70, 80]) k = setKey(k, x);
  const v = frameView(k, 45);
  assert.deepEqual([v.x0 < 20, v.x0 > 15, v.x1 > 70, v.x1 < 75], [true, true, true, true]); // keys 20,30,40 | 50,60,70
  assert.ok(v.y0 < 20 && v.y1 > 70);
  const s = frameView(k, 2); // near the start: what there is (0, then 10, 20, 30)
  assert.ok(s.x0 < 0 && s.x1 > 30 && s.x1 < 35);
  const flat = frameView(holdRange(identity(40), 0, 39), 5);
  assert.ok(flat.y1 - flat.y0 >= 4, 'a flat stretch still gets some height');
});
