import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { demux } from '../js/demux.js';

const load = f => { const b = readFileSync(new URL(`./fixtures/${f}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

for (const f of ['ramp.mp4', 'ramp.mov']) test(`${f}: every picture, its size, rate and codec`, () => {
  const v = demux(load(f));
  assert.equal(v.samples.length, 30);
  assert.equal(v.width, 320); assert.equal(v.height, 180); assert.equal(v.fps, 30);
  assert.match(v.codec, /^avc1\.[0-9a-f]{6}$/);
  assert.ok(v.samples[0].key && !v.samples[1].key && v.samples.filter(s => s.key).length < 10);
  // B-frames: decode order differs from display order, and every display time is used once
  const pts = v.samples.map(s => s.pts);
  assert.notDeepEqual(pts, [...pts].sort((a, b) => a - b));
  assert.equal(new Set(pts).size, 30);
  const buf = new Uint8Array(load(f));
  assert.equal(v.samples.reduce((n, s) => n + s.size, 0) <= buf.length, true);
});

test('a rotated clip is left to the video element, which turns it upright', () => {
  assert.equal(demux(load('rotated.mp4')), null);
});
test('a webm or gif is not ours', () => {
  assert.equal(demux(load('clip.webm')), null);
  assert.equal(demux(load('mixed.gif')), null);
});

test('an HEVC clip (what iPhones record) gets its codec string', () => {
  const v = demux(load('ramp_hevc.mp4'));
  assert.equal(v.codec, 'hvc1.1.6.L60.90');
  assert.equal(v.samples.length, 30);
});

// A clip in a codec the phone's decoder doesn't take (MPEG-4 Part 2, as some Maya playblasts are) still
// has its frame rate and frame count read from the file, so it isn't guessed as 24 fps.
test('videoTiming reads rate and frame count from any MP4/MOV video track', async () => {
  const { videoTiming } = await import('../js/demux.js');
  const b = readFileSync(new URL('./fixtures/mp4v30.mov', import.meta.url));
  const t = videoTiming(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  assert.deepEqual(t, { fps: 30, count: 60 });
});
