import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeGif, gifTimeline } from '../js/gif.js';

const load = n => { const b = readFileSync(new URL(`./fixtures/${n}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const px = (fr, w, x, y) => [...fr.rgba.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];

test('solid3 decodes three full frames', () => {
  const g = decodeGif(load('solid3.gif'));
  assert.equal(g.width, 8); assert.equal(g.height, 6); assert.equal(g.frames.length, 3);
  assert.equal(g.frames[1].rgba.length, 8 * 6 * 4);
  assert.deepEqual(px(g.frames[0], 8, 3, 3), [255, 0, 0, 255]);
  assert.deepEqual(px(g.frames[1], 8, 0, 0), [0, 255, 0, 255]);
  assert.deepEqual(px(g.frames[2], 8, 7, 5), [0, 0, 255, 255]);
});

test('mixed delays and timeline', () => {
  const g = decodeGif(load('mixed.gif'));
  assert.deepEqual(g.frames.map(f => f.delayMs), [40, 120, 100]);
  assert.deepEqual(gifTimeline([40, 120, 100]), { fps: 25, slots: [1, 3, 3] });
});

test('timeline caps fps at 60 and floors slots at 1', () => {
  assert.deepEqual(gifTimeline([20, 20]), { fps: 50, slots: [1, 1] });
  assert.deepEqual(gifTimeline([10]).fps <= 60, true);
});

test('disposal to background clears the patch', () => {
  const g = decodeGif(load('dispose.gif'));
  assert.deepEqual(px(g.frames[1], 8, 0, 0), [255, 0, 0, 255]);   // patch drawn over blue
  assert.deepEqual(px(g.frames[1], 8, 5, 5), [0, 0, 255, 255]);   // blue kept around it
  assert.equal(px(g.frames[2], 8, 0, 0)[3], 0);                    // patch area cleared
  assert.deepEqual(px(g.frames[2], 8, 5, 5), [0, 0, 255, 255]);   // rest still blue
});

test('truncated buffer throws a GIF error', () => {
  const b = load('solid3.gif').slice(0, 40);
  assert.throws(() => decodeGif(b), e => e instanceof Error && e.message.startsWith('This GIF'));
});

test('not a gif throws a GIF error', () => {
  assert.throws(() => decodeGif(new TextEncoder().encode('hello there').buffer), /^Error: This GIF/);
});

test('larger noisy picture matches a reference decoder', () => {
  const ref = new Uint8Array(load('big_ref.bin'));
  for (const name of ['big.gif', 'big_interlaced.gif']) {
    const g = decodeGif(load(name));
    assert.equal(g.width, 64);
    assert.deepEqual(Buffer.from(g.frames[0].rgba).equals(Buffer.from(ref)), true, name);
  }
});

test('scanGif reads size, count and delays without decoding pictures', async () => {
  const { scanGif } = await import('../js/gif.js');
  assert.deepEqual(scanGif(load('mixed.gif')), { width: 8, height: 6, count: 3, delays: [40, 120, 100] });
});

test('decodeGif with a callback hands frames over one at a time and keeps none', () => {
  const got = [];
  const g = decodeGif(load('solid3.gif'), (f, i) => got.push([i, [...f.rgba.slice(0, 4)]]));
  assert.equal(g.frames.length, 0);
  assert.deepEqual(got, [[0, [255, 0, 0, 255]], [1, [0, 255, 0, 255]], [2, [0, 0, 255, 255]]]);
});
