// Exports: the video with notes, the retimed video, or the original and retimed side by side.
// Frames and marks are baked into an MP4 (no sound), encoded frame by frame where the phone can.
import { buildSeq } from './retime.js';
import { log, status } from './player.js';
import { roundRect } from './render.js';

export async function exportVideo(kind, ctx) {
  const { frames, fps, W, H, secs, name, compose, closeSheets, stop, loading } = ctx;
  stop(); closeSheets();
  if (loading()) { status('Still loading frames. Try again in a moment.', 0); setTimeout(() => status(''), 2200); return; }
  const both = kind === 'both', ret = kind !== 'notes';
  const rseq = buildSeq(frames.length, secs, ret && secs.length > 0).seq, oseq = buildSeq(frames.length, secs, false).seq;
  const w2 = W - W % 2, gap = 8;
  const tag = (oc, x, t) => {
    const fs = Math.max(13, W / 40); oc.font = `600 ${fs}px Rubik,system-ui,sans-serif`;
    const tw = oc.measureText(t).width; oc.fillStyle = 'rgba(20,22,26,.6)'; roundRect(oc, x + fs * .6, fs * .6, tw + fs, fs * 1.7, fs * .4); oc.fill();
    oc.fillStyle = '#ECEEF1'; oc.textBaseline = 'middle'; oc.fillText(t, x + fs * 1.1, fs * 1.45);
  };
  const total = both ? Math.max(oseq.length, rseq.length) : rseq.length;
  const t0 = performance.now();
  let made;
  try {
    made = await recordVideo({
      W: both ? w2 * 2 + gap : W, H, fps, total, bitrate: both ? 12e6 : 8e6,
      draw: (oc, i) => {
        if (both) {
          oc.fillStyle = '#1D2024'; oc.fillRect(0, 0, oc.canvas.width, oc.canvas.height);
          compose(oc, oseq[Math.min(i, oseq.length - 1)], true, false); tag(oc, 0, 'Original');
          oc.setTransform(1, 0, 0, 1, w2 + gap, 0); compose(oc, rseq[Math.min(i, rseq.length - 1)], true, true);
          oc.setTransform(1, 0, 0, 1, 0, 0); tag(oc, w2 + gap, 'Retimed');
        } else compose(oc, rseq[i], true, ret && secs.length > 0);
      },
      onFrame: (i, t) => status(`Exporting frame ${i} / ${t}`, i / t),
    });
  } catch (e) { status(e.message, 0); setTimeout(() => status(''), 2500); return; }
  const { blob, ext, how } = made;
  const file = new File([blob], `${name} - ${both ? 'before and after' : ret && secs.length ? 'retimed' : 'notes'}.${ext}`, { type: blob.type });
  log(`exported ${file.name}: ${(blob.size / 1e6).toFixed(1)} MB in ${((performance.now() - t0) / 1000).toFixed(1)}s (${how})`);
  status('');
  await deliver(file);
}

export const recType = () => ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
  .find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || null;

// Makes a video from frames: draw(ctx, i) paints output frame i of total. Returns {blob, ext, how}, or a
// null blob when stopped() says stop. Where the phone can encode H.264 frame by frame (WebCodecs), every
// frame gets its exact time, so the video is exactly total / fps long however long making it takes (a
// locked screen or a slow frame can't get into it). Otherwise it records in real time, pausing while the
// app isn't on screen.
export async function recordVideo(o) {
  const codec = await h264Codec(o.W - o.W % 2, o.H - o.H % 2, o.fps, o.bitrate || 8e6);
  if (codec) {
    try { return await encodeVideo(o, codec); }
    catch (e) { console.warn('encoder failed, recording in real time instead:', e); }
  }
  return recordRealtime(o);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function h264Codec(width, height, fps, bitrate) {
  if (!('VideoEncoder' in window) || !('VideoFrame' in window)) return null;
  // High, Main, Baseline; level 5.1 for big frames, 4.0 up to 1080p
  const lv = width * height > 1920 * 1088 ? '33' : '28';
  for (const p of ['6400', '4d00', '4200']) {
    const config = { codec: `avc1.${p}${lv}`, width, height, bitrate, framerate: fps, avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return config; } catch { /* try the next */ }
  }
  return null;
}

async function encodeVideo({ W, H, fps, total, draw, onFrame = () => {}, stopped = () => false }, config) {
  const { muxMp4 } = await import('./mp4.js');
  const out = document.createElement('canvas'); out.width = config.width; out.height = config.height; const oc = out.getContext('2d');
  const samples = []; let avcC = null, failed = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig?.description && !avcC) avcC = new Uint8Array(meta.decoderConfig.description);
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      samples.push({ data, key: chunk.type === 'key' });
    },
    error: e => { failed = e; },
  });
  enc.configure(config);
  const gop = Math.max(1, Math.round(fps * 2)), us = 1e6 / fps;
  try {
    for (let i = 0; i < total; i++) {
      if (stopped()) return { blob: null, ext: '', how: 'stopped' };
      if (failed) throw failed;
      oc.setTransform(1, 0, 0, 1, 0, 0); draw(oc, i);
      const frame = new VideoFrame(out, { timestamp: Math.round(i * us), duration: Math.round(us) });
      enc.encode(frame, { keyFrame: i % gop === 0 }); frame.close();
      onFrame(i + 1, total);
      while (enc.encodeQueueSize > 3) await sleep(4);
      if (i % 8 === 7) await sleep(0); // let the screen update
    }
    await enc.flush();
    if (failed) throw failed;
  } finally { if (enc.state !== 'closed') enc.close(); }
  if (!avcC || samples.length !== total) throw new Error("The video couldn't be made on this phone.");
  return { blob: new Blob(muxMp4({ width: config.width, height: config.height, fps, avcC, samples }), { type: 'video/mp4' }), ext: 'mp4', how: config.codec };
}

async function recordRealtime({ W, H, fps, total, draw, onFrame = () => {}, stopped = () => false, bitrate = 8e6 }) {
  const type = recType(); if (!type) throw new Error("This phone can't record video here.");
  const out = document.createElement('canvas'); out.width = W - W % 2; out.height = H - H % 2; const oc = out.getContext('2d');
  const stream = out.captureStream(0), track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: bitrate });
  const chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => rec.onstop = r);
  rec.start();
  let t0 = performance.now(), base = 0;
  for (let i = 0; i < total; i++) {
    if (stopped()) { rec.stop(); await done; return { blob: null, ext: '', how: 'stopped' }; }
    if (document.hidden) { // off screen: pause, and carry on from here when it's back
      rec.pause(); while (document.hidden && !stopped()) await sleep(200); rec.resume(); t0 = performance.now(); base = i;
    }
    oc.setTransform(1, 0, 0, 1, 0, 0); draw(oc, i);
    track.requestFrame && track.requestFrame();
    onFrame(i + 1, total);
    const due = t0 + (i + 1 - base) * 1000 / fps; await sleep(Math.max(0, due - performance.now()));
  }
  rec.stop(); await done;
  return { blob: new Blob(chunks, { type: type.split(';')[0] }), ext: type.includes('mp4') ? 'mp4' : 'webm', how: type };
}

// Hands a finished file to the person. Inside Claude (testing): the downloads capability. Installed on a
// phone: the Share sheet, after a fresh tap (iOS only opens it straight after one). Otherwise a download.
export async function deliver(file) {
  const dl = window.claude ? await window.claude.use('downloads').catch(() => null) : null;
  if (dl) { try { await dl.save({ filename: file.name, data: file }); log('saved'); } catch (e) { log('save: ' + (e.code || e.message)); } return; }
  if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    const veil = document.getElementById('shareVeil');
    const zip = /\.zip$/i.test(file.name);
    document.getElementById('shareCap').textContent = zip ? 'Notes ready' : 'Video ready';
    document.getElementById('shareBtn').textContent = zip ? 'Share zip' : 'Share video';
    document.getElementById('shareName').textContent = file.name;
    veil.style.display = 'flex';
    document.getElementById('shareBtn').onclick = async () => {
      veil.style.display = 'none';
      try { await navigator.share({ files: [file] }); } catch (e) { if (e.name !== 'AbortError') log('share: ' + e.message); }
    };
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
