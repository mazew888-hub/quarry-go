// Loads every frame of a clip into memory, so scrubbing and any play rate are exact.
// Returns as soon as the size and frame rate are known; frames fill in while the player is in use.
import { decodeGif, scanGif, gifTimeline } from './gif.js';
import { demux } from './demux.js';

import { frameSize, MAX_W, BUDGET } from './framesize.js';
export const CANT_OPEN = "This clip can't be opened here";
const tooLong = n => `This clip is too long to hold on the phone (${n} frames)`;
const wait = ms => new Promise(r => setTimeout(r, ms));

// The returned media has cancel(): it stops loading and frees every frame. Call it when the clip is left.
// fps: the clip's rate if already known (measured when it was added), which saves measuring it again.
export async function loadFrames(blob, { maxBytes = BUDGET, log = () => {}, fps = 0 } = {}) {
  const head = new Uint8Array(await blob.slice(0, 6).arrayBuffer());
  const isGif = blob.type === 'image/gif' || String.fromCharCode(...head).startsWith('GIF8');
  if (isGif) return loadGif(blob, maxBytes, log);
  const fast = await loadDecoded(blob, maxBytes, log).catch(e => { if (e.message.startsWith('This clip is too long')) throw e; log('decoder: ' + e.message); return null; });
  return fast || loadVideo(blob, maxBytes, log, fps);
}

// The fast way, where the phone has a video decoder (WebCodecs): read the file's pictures straight out
// of the MP4/MOV and decode them all at once, rather than playing or seeking a <video> to each frame.
// Returns null when it can't (no decoder, a format or codec it doesn't take), before anything is shown.
async function loadDecoded(blob, maxBytes, log) {
  if (!('VideoDecoder' in window) || !('EncodedVideoChunk' in window)) return null;
  const buf = await blob.arrayBuffer();
  const v = demux(buf); if (!v || !v.samples.length) return null;
  const config = { codec: v.codec, codedWidth: v.width, codedHeight: v.height, description: v.description };
  try { if (!(await VideoDecoder.isConfigSupported(config)).supported) return null; } catch { return null; }
  const count = v.samples.length, size = frameSize(count, v.width, v.height, maxBytes);
  if (!size) throw new Error(tooLong(count));
  const { W, H } = size;
  if (W < Math.min(MAX_W, v.width)) log(`long clip: held at ${W}x${H} to fit in memory`);
  const us = x => Math.round(x * 1e6 / v.timescale);
  const order = new Map([...v.samples].map(x => us(x.pts)).sort((a, b) => a - b).map((t, i) => [t, i]));
  const m = media(v.fps, count, W, H);
  const t0 = performance.now(), pending = [];
  let failed = null, got = 0, first;
  const firstOut = new Promise(r => { first = r; });
  const dec = new VideoDecoder({
    output: f => {
      const i = order.get(f.timestamp);
      if (m.cancelled || i == null) { f.close(); return; }
      pending.push(createImageBitmap(f, { resizeWidth: W, resizeHeight: H, resizeQuality: 'medium' })
        .then(b => { if (m.cancelled || m.frames[i]) { b.close && b.close(); return; } m.frames[i] = b; got++; first(true); m.onFrame && m.onFrame(); })
        .catch(e => { failed = failed || e; })
        .finally(() => f.close()));
    },
    error: e => { failed = e; first(false); },
  });
  dec.configure(config);
  m.cleanup = () => { try { if (dec.state !== 'closed') dec.close(); } catch {} };
  const feed = (async () => {
    for (const x of v.samples) {
      if (m.cancelled || failed) return;
      dec.decode(new EncodedVideoChunk({ type: x.key ? 'key' : 'delta', timestamp: us(x.pts), data: new Uint8Array(buf, x.offset, x.size) }));
      while (dec.decodeQueueSize > 6 && !m.cancelled && !failed) await wait(2);
    }
    if (!m.cancelled && !failed) await dec.flush();
  })();
  // only show the player once a picture has really come out; otherwise go the slow way
  const ok = await Promise.race([firstOut, feed.then(() => got > 0), wait(4000).then(() => false)]);
  if (!ok || failed) { m.cancel(); log('decoder: no pictures, using the video player instead'); return null; }
  m.done = (async () => {
    try { await feed; } catch (e) { failed = failed || e; }
    await Promise.all(pending);
    m.cleanup(); m.cleanup = () => {};
    if (m.cancelled) return;
    // a picture the decoder didn't give back shows the one before it
    for (let i = 0; i < count; i++) if (!m.frames[i]) m.frames[i] = m.frames[i - 1] || m.frames.find(Boolean) || null;
    m.loading = false; m.onFrame && m.onFrame();
    log(`${v.width}x${v.height}, ${v.fps} fps, ${count} frames (${v.codec})${W < Math.min(MAX_W, v.width) ? `, long clip: held at ${W}x${H}` : ''}, loaded in ${((performance.now() - t0) / 1000).toFixed(1)}s${failed ? ' — decoder: ' + failed.message : ''}`);
  })();
  return m;
}

function media(fps, count, W, H) {
  // onFrame is set by the player; loading flips to false when every frame is in.
  const m = { fps, count, W, H, frames: new Array(count).fill(null), loading: true, onFrame: null, done: null, cancelled: false, cleanup: () => {} };
  m.cancel = () => {
    if (m.cancelled) return; m.cancelled = true; m.onFrame = null; m.cleanup();
    for (const f of new Set(m.frames)) if (f && f.close) f.close();
    m.frames.fill(null);
  };
  return m;
}

async function loadGif(blob, maxBytes, log) {
  const buf = await blob.arrayBuffer();
  let info;
  try { info = scanGif(buf); } catch (e) { log('gif: ' + e.message); throw new Error(CANT_OPEN); }
  const size = frameSize(info.count, info.width, info.height, maxBytes);
  if (!size) throw new Error(tooLong(info.count));
  const { W, H } = size;
  const { fps, slots } = gifTimeline(info.delays);
  const count = slots.reduce((a, b) => a + b, 0);
  const m = media(fps, count, W, H);
  // One full-size picture at a time: each is drawn down to the cached size straight away.
  const full = document.createElement('canvas'); full.width = info.width; full.height = info.height;
  const fc = full.getContext('2d');
  m.done = (async () => {
    await new Promise(r => setTimeout(r, 0)); // let the player open first
    let i = 0;
    try {
      decodeGif(buf, (f, k) => {
        if (m.cancelled) return;
        fc.putImageData(new ImageData(f.rgba, info.width, info.height), 0, 0);
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d'); x.imageSmoothingQuality = 'medium'; x.drawImage(full, 0, 0, W, H);
        for (let s = 0; s < slots[k]; s++) m.frames[i++] = c;
      });
    } catch (e) { log('gif: ' + e.message); }
    if (!m.cancelled) { m.loading = false; m.onFrame && m.onFrame(); log(`gif: ${info.width}x${info.height}, ${info.count} pictures over ${count} frames at ${fps} fps`); }
  })();
  return m;
}

// iPhone Safari won't load a video's pictures until it's asked to play, and can skip 'seeked' events:
// every wait here has a way out.
function vid(url) {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
    v.preload = 'auto'; v.src = url;
    // Kept in the page (invisible): iOS decodes more reliably for an attached video.
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none';
    document.body.append(v);
    let done = false;
    const fail = () => { if (!done) { done = true; v.remove(); rej(new Error(CANT_OPEN)); } };
    const ok = () => { if (!done) { done = true; res(v); } };
    v.onloadedmetadata = ok; v.onloadeddata = ok; v.oncanplay = ok; v.onerror = fail;
    v.load();
    setTimeout(fail, 20000);
  });
}

let rvfcMisses = 0;
async function seek(v, t) {
  await new Promise(r => {
    let fin = false; const end = () => { if (!fin) { fin = true; v.onseeked = null; r(); } };
    v.onseeked = end; v.currentTime = t; setTimeout(end, 1500);
  });
  // Wait until that frame is painted, where this browser shows it fires for a paused seek.
  if ('requestVideoFrameCallback' in v && rvfcMisses < 3) {
    const hit = await Promise.race([new Promise(r => v.requestVideoFrameCallback(() => r(true))), wait(250).then(() => false)]);
    rvfcMisses = hit ? 0 : rvfcMisses + 1;
  }
}

async function detectFps(v, log) {
  if (!('requestVideoFrameCallback' in v)) return 24;
  const times = [];
  await new Promise(res => {
    const tick = (_, m) => { times.push(m.mediaTime); if (times.length < 14) v.requestVideoFrameCallback(tick); else res(); };
    v.requestVideoFrameCallback(tick); v.play().catch(e => { log('play refused: ' + e.message); res(); }); setTimeout(res, 2500);
  });
  v.pause();
  if (!v.videoWidth) await wait(500);
  const d = []; for (let i = 1; i < times.length; i++) { const x = times[i] - times[i - 1]; if (x > 0.001) d.push(x); }
  if (!d.length) return 24;
  d.sort((a, b) => a - b); const raw = 1 / d[Math.floor(d.length / 2)];
  return [12, 15, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60].reduce((a, b) => Math.abs(b - raw) < Math.abs(a - raw) ? b : a, 24);
}

async function loadVideo(blob, maxBytes, log, knownFps = 0) {
  const url = URL.createObjectURL(blob);
  let v;
  try { v = await vid(url); } catch (e) { URL.revokeObjectURL(url); throw e; }
  const quit = () => { URL.revokeObjectURL(url); v.remove(); };
  log(`opened: ${v.videoWidth}x${v.videoHeight}, ${(v.duration || 0).toFixed(2)}s`);
  const fps = knownFps || await detectFps(v, log);   // measuring plays the clip: skipped when the rate is known
  const dur = v.duration;
  if (!v.videoWidth || !isFinite(dur)) { quit(); throw new Error(CANT_OPEN); }
  const count = Math.max(1, Math.round(dur * fps));
  const size = frameSize(count, v.videoWidth, v.videoHeight, maxBytes);
  if (!size) { quit(); throw new Error(tooLong(count)); }
  const { W, H } = size;
  if (W < Math.min(MAX_W, v.videoWidth)) log(`long clip: held at ${W}x${H} to fit in memory`);
  const m = media(fps, count, W, H);
  m.cleanup = () => { try { v.pause(); } catch {} quit(); };
  const opts = { resizeWidth: W, resizeHeight: H, resizeQuality: 'medium' };
  let got = 0;
  const stopped = () => m.cancelled;
  const grab = i => createImageBitmap(v, opts).then(b => { if (m.cancelled) { b.close && b.close(); return; } if (!m.frames[i]) { m.frames[i] = b; got++; m.onFrame && m.onFrame(); } else b.close && b.close(); });
  m.done = (async () => {
    const t0 = performance.now();
    rvfcMisses = 0;
    // Pass 1: play the clip once and keep every frame shown (much faster than seeking each one).
    if ('requestVideoFrameCallback' in v) {
      await seek(v, 0);
      await new Promise(res => {
        let fin = false; const end = () => { if (!fin) { fin = true; res(); } };
        const tick = (_, md) => {
          if (fin || stopped()) return end();
          const i = Math.min(count - 1, Math.max(0, Math.round(md.mediaTime * fps)));
          if (!m.frames[i]) grab(i);
          v.requestVideoFrameCallback(tick);
        };
        v.requestVideoFrameCallback(tick);
        v.onended = end; v.play().catch(e => { log('play refused: ' + e.message); end(); });
        setTimeout(end, (dur + 4) * 1000);
      });
      v.pause(); await wait(50);
      log(`pass 1: ${got} / ${count} frames in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    }
    // Pass 2: seek to whatever was skipped.
    for (let i = 0; i < count && !stopped(); i++) {
      if (m.frames[i]) continue;
      await seek(v, Math.min(dur - 0.001, (i + 0.5) / fps));
      await grab(i);
    }
    if (m.cancelled) return;
    m.loading = false; quit(); m.cleanup = () => {};
    log(`${v.videoWidth}x${v.videoHeight}, ${fps} fps, ${count} frames${W < Math.min(MAX_W, v.videoWidth) ? `, long clip: held at ${W}x${H}` : ''}, loaded in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  })();
  return m;
}
