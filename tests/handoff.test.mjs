import test from 'node:test';
import assert from 'node:assert/strict';
import { packHandoff, readHandoff, mergePlan, HANDOFF_JSON } from '../js/handoff.js';
import { zipParts } from '../js/zip.js';

const rv = (id, updated, extra = {}) => ({ id, name: 'shot_' + id, day: '2026-11-24', created: 1, updated, fps: 24, frameCount: 10,
  marks: [{ type: 'note', f: 2, text: 'hi' }], secs: [], retimed: false, thumb: new Uint8Array([9, 8, 7]).buffer, clipType: 'video/mp4', ...extra });

test('a handoff carries reviews, previews and videos, and reads back the same', async () => {
  const clips = { a: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'video/mp4' }), b: new Blob([new Uint8Array([5, 6])], { type: 'video/quicktime' }) };
  const file = await packHandoff([rv('a', 10), rv('b', 20, { clipType: 'video/quicktime', thumb: null })], async id => clips[id], new Date(2026, 10, 24));
  assert.match(file.name, /\.zip$/);
  const got = await readHandoff(file);
  assert.equal(got.reviews.length, 2);
  const a = got.reviews.find(r => r.id === 'a'), b = got.reviews.find(r => r.id === 'b');
  assert.deepEqual(a.marks, [{ type: 'note', f: 2, text: 'hi' }]);
  assert.equal(a.updated, 10);
  assert.deepEqual([...new Uint8Array(a.thumb)], [9, 8, 7]);
  assert.equal(b.thumb, null);
  assert.deepEqual([...new Uint8Array(await (await got.clip('a')).arrayBuffer())], [1, 2, 3, 4]);
  assert.equal((await got.clip('b')).type, 'video/quicktime');
});

test('a review whose video is missing still travels, without a video', async () => {
  const got = await readHandoff(await packHandoff([rv('a', 1)], async () => null));
  assert.equal(got.reviews.length, 1);
  assert.equal(await got.clip('a'), null);
});

test('a zip that is not a handoff is refused in plain words', async () => {
  const other = new Blob(zipParts([{ name: 'notes.json', data: new Uint8Array([1]) }]));
  await assert.rejects(readHandoff(other), /isn't a Quarry Go handoff/);
  await assert.rejects(readHandoff(new Blob([new Uint8Array(40)])), /isn't a Quarry Go handoff/);
});

test('merging: new videos are added, newer edits replace, older or same are left', () => {
  const local = [rv('a', 50), rv('b', 50), rv('c', 50)];
  const incoming = [rv('a', 60), rv('b', 50), rv('c', 40), rv('d', 1)];
  const plan = mergePlan(local, incoming);
  assert.deepEqual(plan.add.map(r => r.id), ['d']);
  assert.deepEqual(plan.update.map(r => r.id), ['a']);
  assert.deepEqual(plan.skip.map(r => r.id), ['b', 'c']);
});

test('the handoff file name says which day it is', async () => {
  const f = await packHandoff([rv('a', 1)], async () => null);
  assert.equal(f.name, 'Quarry Go handoff 2026-11-24.zip');
  assert.ok(HANDOFF_JSON);
});

test('packing never reads the videos, so Send is instant', async () => {
  class Untouched extends Blob { arrayBuffer() { throw new Error('read the video'); } }
  const f = await packHandoff([rv('a', 1)], async () => new Untouched([new Uint8Array([7, 7, 7])], { type: 'video/mp4' }));
  const got = await readHandoff(f);
  assert.deepEqual([...new Uint8Array(await (await got.clip('a')).arrayBuffer())], [7, 7, 7]);
});
