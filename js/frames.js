// Loads every frame of a clip into memory, so scrubbing and any play rate are exact.
// Returns as soon as the size and frame rate are known; frames fill in while the player is in use.
import { decodeGif, scanGif, gifTimeline } from './gif.js';

export const CANT_OPEN = "This clip can't be opened here";
const tooLong = n => `This clip is too long to hold on the phone (${n} frames)`;
const wait = ms => new Promise(r => setTimeout(r, ms));
const MAX_W = 960;

// The returned media has cancel(): it stops loading and frees every frame. Call it when the clip is left.
export async function loadFrames(blob, { maxBytes = 900e6, log = () => {} } = {}) {
  const head = new Uint8Array(await blob.slice(0, 6).arrayBuffer());
  const isGif = blob.type === 'image/gif' || String.fromCharCode(...head).startsWith('GIF8');
  return isGif ? loadGif(blob, maxBytes, log) : loadVideo(blob, maxBytes, log);
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
  const scale = Math.min(1, MAX_W / info.width);
  const W = Math.round(info.width * scale), H = Math.round(info.height * scale);
  if (info.count * W * H * 4 > maxBytes) throw new Error(tooLong(info.count));
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

async function loadVideo(blob, maxBytes, log) {
  const url = URL.createObjectURL(blob);
  let v;
  try { v = await vid(url); } catch (e) { URL.revokeObjectURL(url); throw e; }
  const quit = () => { URL.revokeObjectURL(url); v.remove(); };
  log(`opened: ${v.videoWidth}x${v.videoHeight}, ${(v.duration || 0).toFixed(2)}s`);
  const fps = await detectFps(v, log);
  const dur = v.duration;
  if (!v.videoWidth || !isFinite(dur)) { quit(); throw new Error(CANT_OPEN); }
  const count = Math.max(1, Math.round(dur * fps));
  const scale = Math.min(1, MAX_W / v.videoWidth);
  const W = Math.round(v.videoWidth * scale), H = Math.round(v.videoHeight * scale);
  if (count * W * H * 4 > maxBytes) { quit(); throw new Error(tooLong(count)); }
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
    log(`${v.videoWidth}x${v.videoHeight}, ${fps} fps, ${count} frames, loaded in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  })();
  return m;
}
