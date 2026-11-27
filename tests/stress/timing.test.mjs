// Stress: the frame rate and frame count Quarry Go reads from each file match what ffprobe counts, for
// every rate and format a playblast or phone produces. Run tests/stress/make_clips.sh first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { videoTiming, demux } from '../../js/demux.js';

const D = new URL('../fixtures/stress/', import.meta.url);
const probe = f => { const [rate, n] = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=r_frame_rate,nb_read_frames', '-of', 'csv=p=0', f]).toString().trim().split(',');
  const [a, b] = rate.split('/').map(Number); return { fps: a / b, count: +n }; };
for (const name of readdirSync(D)) test(name, () => {
  const p = new URL(name, D).pathname, b = readFileSync(p), buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
  const want = probe(p), t = videoTiming(buf);
  assert.ok(t, 'no timing read');
  assert.equal(t.count, want.count, 'frame count');
  if (name !== 'vfr.mp4') assert.ok(Math.abs(t.fps - want.fps) < 0.01, `fps ${t.fps} vs ${want.fps}`);
  else assert.equal(t.fps, 30);
  const d = demux(buf);   // where the fast decoder path applies, it agrees with the timing read
  if (d) { assert.equal(d.samples.length, want.count); if (name !== 'vfr.mp4') assert.ok(Math.abs(d.fps - want.fps) < 0.01); }
});
