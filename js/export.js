// Exports: the video with notes, the retimed video, or the original and retimed side by side.
// Frames and marks are baked into an MP4, recorded in real time (no sound).
import { buildSeq } from './retime.js';
import { log, status } from './player.js';
import { roundRect } from './render.js';

export async function exportVideo(kind, ctx) {
  const { frames, fps, W, H, secs, name, compose, closeSheets, stop, loading } = ctx;
  stop(); closeSheets();
  if (loading()) { status('Still loading frames. Try again in a moment.', 0); setTimeout(() => status(''), 2200); return; }
  const type = recType();
  if (!type) { status("This phone can't record video here.", 0); setTimeout(() => status(''), 2500); return; }
  const both = kind === 'both', ret = kind !== 'notes';
  const rseq = buildSeq(frames.length, secs, ret && secs.length > 0).seq, oseq = buildSeq(frames.length, secs, false).seq;
  const w2 = W - W % 2, h2 = H - H % 2, gap = 8;
  const out = document.createElement('canvas'); out.width = both ? w2 * 2 + gap : w2; out.height = h2; const oc = out.getContext('2d');
  const stream = out.captureStream(0); const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: both ? 12e6 : 8e6 });
  const chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => rec.onstop = r);
  const tag = (x, t) => {
    const fs = Math.max(13, W / 40); oc.font = `600 ${fs}px Rubik,system-ui,sans-serif`;
    const tw = oc.measureText(t).width; oc.fillStyle = 'rgba(20,22,26,.6)'; roundRect(oc, x + fs * .6, fs * .6, tw + fs, fs * 1.7, fs * .4); oc.fill();
    oc.fillStyle = '#ECEEF1'; oc.textBaseline = 'middle'; oc.fillText(t, x + fs * 1.1, fs * 1.45);
  };
  const total = both ? Math.max(oseq.length, rseq.length) : rseq.length;
  rec.start();
  const t0 = performance.now();
  for (let i = 0; i < total; i++) {
    if (both) {
      oc.setTransform(1, 0, 0, 1, 0, 0); oc.fillStyle = '#1D2024'; oc.fillRect(0, 0, out.width, out.height);
      compose(oc, oseq[Math.min(i, oseq.length - 1)], true, false); tag(0, 'Original');
      oc.setTransform(1, 0, 0, 1, w2 + gap, 0); compose(oc, rseq[Math.min(i, rseq.length - 1)], true, true);
      oc.setTransform(1, 0, 0, 1, 0, 0); tag(w2 + gap, 'Retimed');
    } else compose(oc, rseq[i], true, ret && secs.length > 0);
    track.requestFrame && track.requestFrame();
    status(`Exporting frame ${i + 1} / ${total}`, (i + 1) / total);
    const due = t0 + (i + 1) * 1000 / fps; await new Promise(r => setTimeout(r, Math.max(0, due - performance.now())));
  }
  rec.stop(); await done;
  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  const blob = new Blob(chunks, { type: type.split(';')[0] });
  const file = new File([blob], `${name} - ${both ? 'before and after' : ret && secs.length ? 'retimed' : 'notes'}.${ext}`, { type: blob.type });
  log(`exported ${file.name}: ${(blob.size / 1e6).toFixed(1)} MB in ${((performance.now() - t0) / 1000).toFixed(1)}s (${type})`);
  status('');
  await deliver(file);
}

export const recType = () => ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
  .find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || null;

// Records frames in real time into a video: draw(ctx, i) paints output frame i of total. Returns {blob, ext}.
// stopped() is checked every frame (null blob when it says stop).
export async function recordVideo({ W, H, fps, total, draw, onFrame = () => {}, stopped = () => false }) {
  const type = recType(); if (!type) throw new Error("This phone can't record video here.");
  const out = document.createElement('canvas'); out.width = W - W % 2; out.height = H - H % 2; const oc = out.getContext('2d');
  const stream = out.captureStream(0), track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6 });
  const chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => rec.onstop = r);
  rec.start();
  const t0 = performance.now();
  for (let i = 0; i < total; i++) {
    if (stopped()) { rec.stop(); await done; return { blob: null, ext: '' }; }
    oc.setTransform(1, 0, 0, 1, 0, 0); draw(oc, i);
    track.requestFrame && track.requestFrame();
    onFrame(i + 1, total);
    const due = t0 + (i + 1) * 1000 / fps; await new Promise(r => setTimeout(r, Math.max(0, due - performance.now())));
  }
  rec.stop(); await done;
  return { blob: new Blob(chunks, { type: type.split(';')[0] }), ext: type.includes('mp4') ? 'mp4' : 'webm' };
}

// Hands a finished file to the person. Inside Claude (testing): the downloads capability. Installed on a
// phone: the Share sheet, after a fresh tap (iOS only opens it straight after one). Otherwise a download.
export async function deliver(file) {
  const dl = window.claude ? await window.claude.use('downloads').catch(() => null) : null;
  if (dl) { try { await dl.save({ filename: file.name, data: file }); log('saved'); } catch (e) { log('save: ' + (e.code || e.message)); } return; }
  if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    const veil = document.getElementById('shareVeil');
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
