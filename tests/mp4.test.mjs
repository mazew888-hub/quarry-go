import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { muxMp4 } from '../js/mp4.js';

// Real H.264 from ffmpeg (Annex B), cut into frames and turned into what VideoEncoder hands out:
// length-prefixed frames, keyframe flags and the avcC record.
function encode(dir, frames, fps, gop) {
  const raw = join(dir, 'a.h264');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=320x180:rate=${fps}`, '-frames:v', String(frames),
    '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-g', String(gop), '-bf', '0', '-x264-params', 'slices=1:aud=0', '-f', 'h264', raw]);
  const b = readFileSync(raw), nals = [];
  let i = 0, start = -1;
  while (i + 3 < b.length) {
    const sc = b[i] === 0 && b[i + 1] === 0 && (b[i + 2] === 1 ? 3 : b[i + 2] === 0 && b[i + 3] === 1 ? 4 : 0);
    if (sc) { if (start >= 0) nals.push(b.subarray(start, i)); start = i + sc; i += sc; } else i++;
  }
  nals.push(b.subarray(start));
  let sps, pps; const samples = []; let cur = [];
  for (const n of nals) {
    const t = n[0] & 31;
    if (t === 7) sps = n; else if (t === 8) pps = n;
    else if (t === 1 || t === 5) { cur.push(n); samples.push({ nals: cur, key: t === 5 }); cur = []; }
    else cur.push(n); // SEI goes with the next frame
  }
  const lp = ns => { const out = Buffer.alloc(ns.reduce((s, n) => s + 4 + n.length, 0)); let o = 0; for (const n of ns) { out.writeUInt32BE(n.length, o); n.copy(out, o + 4); o += 4 + n.length; } return new Uint8Array(out); };
  const avcC = new Uint8Array(Buffer.concat([Buffer.from([1, sps[1], sps[2], sps[3], 0xFF, 0xE1, sps.length >> 8, sps.length & 255]), sps,
    Buffer.from([1, pps.length >> 8, pps.length & 255]), pps]));
  return { avcC, samples: samples.map(s => ({ data: lp(s.nals), key: s.key })) };
}

function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries',
    'stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,duration:format=duration', '-of', 'json', file]).toString());
  return { ...j.streams[0], fmt: j.format };
}

for (const [fps, frames] of [[24, 72], [30, 45], [23.976, 48]]) {
  test(`an mp4 whose length is exactly its frames at ${fps} fps`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'qgmp4-')), { avcC, samples } = encode(dir, frames, fps, 12);
    assert.equal(samples.length, frames);
    const parts = muxMp4({ width: 320, height: 180, fps, avcC, samples });
    const file = join(dir, 'out.mp4'); writeFileSync(file, Buffer.concat(parts.map(p => Buffer.from(p))));
    const s = probe(file);
    assert.equal(s.codec_name, 'h264'); assert.equal(s.width, 320); assert.equal(s.height, 180);
    assert.equal(Number(s.nb_read_frames), frames);
    assert.ok(Math.abs(Number(s.duration) - frames / fps) < 0.002, `duration ${s.duration}`);
    const [n, d] = s.avg_frame_rate.split('/').map(Number);
    assert.ok(Math.abs(n / d - fps) < 0.01, `rate ${s.avg_frame_rate}`);
    // decodes cleanly from start to end
    const err = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    assert.equal(err, '');
  });
}

test('seeks land on keyframes: the sync sample table lists them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qgmp4-')), { avcC, samples } = encode(dir, 30, 24, 10);
  const parts = muxMp4({ width: 320, height: 180, fps: 24, avcC, samples });
  const file = join(dir, 'k.mp4'); writeFileSync(file, Buffer.concat(parts.map(p => Buffer.from(p))));
  const keys = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=flags', '-of', 'csv=p=0', file])
    .toString().trim().split('\n').map((f, i) => f.startsWith('K') ? i : -1).filter(i => i >= 0);
  assert.deepEqual(keys, [0, 10, 20]);
});
