// A small GIF89a decoder: every frame comes out as a full-canvas RGBA picture with disposal applied,
// so GIFs scrub frame by frame like videos. No dependencies.

const bad = why => new Error(`This GIF can't be read (${why})`);

// Reads only the size, frame count and timings: no pictures are decoded, so it's quick and small.
export function scanGif(buf) {
  const g = walk(buf, null, true);
  return { width: g.width, height: g.height, count: g.delays.length, delays: g.delays };
}

// With onFrame(frame, index), frames are handed over one at a time and none are kept
// (only one full-size picture is in memory at once); without it they're all returned.
export function decodeGif(buf, onFrame = null) {
  const g = walk(buf, onFrame, false);
  return { width: g.width, height: g.height, frames: g.frames };
}

function walk(buf, onFrame, scanOnly) {
  const d = new Uint8Array(buf);
  let p = 0;
  const need = n => { if (p + n > d.length) throw bad('it ends too early'); };
  const u8 = () => { need(1); return d[p++]; };
  const u16 = () => { need(2); const v = d[p] | (d[p + 1] << 8); p += 2; return v; };
  need(6);
  const sig = String.fromCharCode(...d.slice(0, 6));
  if (sig !== 'GIF89a' && sig !== 'GIF87a') throw bad('not a GIF');
  p = 6;
  const width = u16(), height = u16(), flags = u8(); u8(); u8(); // background index and aspect unused
  if (!width || !height) throw bad('no picture size');
  const readTable = n => { need(n * 3); const t = d.slice(p, p + n * 3); p += n * 3; return t; };
  const gct = flags & 0x80 ? readTable(1 << ((flags & 7) + 1)) : null;

  const canvas = scanOnly ? null : new Uint8ClampedArray(width * height * 4); // starts transparent
  const frames = [], delays = [];
  let gce = { delay: 0, disposal: 0, trans: -1 };

  for (;;) {
    const block = u8();
    if (block === 0x3B) break; // trailer
    if (block === 0x21) {
      const label = u8();
      if (label === 0xF9) {
        const size = u8(); need(size + 1);
        const pf = d[p], delay = d[p + 1] | (d[p + 2] << 8), ti = d[p + 3];
        gce = { delay: delay * 10, disposal: (pf >> 2) & 7, trans: pf & 1 ? ti : -1 };
        p += size; u8(); // block terminator
      } else skipSubBlocks();
      continue;
    }
    if (block !== 0x2C) throw bad('unknown block');
    const fx = u16(), fy = u16(), fw = u16(), fh = u16(), lf = u8();
    const table = lf & 0x80 ? readTable(1 << ((lf & 7) + 1)) : gct;
    if (!table) throw bad('no colour table');
    const interlaced = !!(lf & 0x40);
    const minCode = u8();
    if (scanOnly) {
      skipSubBlocks(); delays.push(gce.delay < 20 ? 100 : gce.delay); gce = { delay: 0, disposal: 0, trans: -1 };
      continue;
    }
    const data = readSubBlocks();
    const idx = lzw(data, minCode, fw * fh);

    // What to restore after this frame, for disposal 3 (previous).
    const before = gce.disposal === 3 ? canvas.slice() : null;
    const rows = interlaced ? interlaceRows(fh) : null;
    for (let i = 0; i < fh; i++) {
      const sy = rows ? rows[i] : i, y = fy + sy;
      if (y >= height) continue;
      for (let x = 0; x < fw; x++) {
        const cx = fx + x; if (cx >= width) continue;
        const c = idx[i * fw + x];
        if (c === gce.trans || c === undefined) continue;
        const o = (y * width + cx) * 4, t = c * 3;
        canvas[o] = table[t]; canvas[o + 1] = table[t + 1]; canvas[o + 2] = table[t + 2]; canvas[o + 3] = 255;
      }
    }
    const frame = { rgba: canvas.slice(), delayMs: gce.delay < 20 ? 100 : gce.delay };
    delays.push(frame.delayMs);
    if (onFrame) onFrame(frame, delays.length - 1); else frames.push(frame);
    if (gce.disposal === 2) {
      for (let y = fy; y < Math.min(height, fy + fh); y++) canvas.fill(0, (y * width + fx) * 4, (y * width + Math.min(width, fx + fw)) * 4);
    } else if (before) canvas.set(before);
    gce = { delay: 0, disposal: 0, trans: -1 };
  }
  if (!delays.length) throw bad('no frames');
  return { width, height, frames, delays };

  function skipSubBlocks() { for (let n = u8(); n; n = u8()) { need(n); p += n; } }
  function readSubBlocks() {
    const parts = []; let total = 0;
    for (let n = u8(); n; n = u8()) { need(n); parts.push(d.subarray(p, p + n)); p += n; total += n; }
    const out = new Uint8Array(total); let o = 0; for (const s of parts) { out.set(s, o); o += s.length; }
    return out;
  }
}

function interlaceRows(h) {
  // Row order of an interlaced image: passes start at 0, 4, 2, 1 with steps 8, 8, 4, 2.
  const rows = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) rows.push(y);
  return rows;
}

function lzw(data, minCode, count) {
  const out = new Uint8Array(count);
  const clear = 1 << minCode, eoi = clear + 1;
  const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  let size = minCode + 1, mask = (1 << size) - 1, next = eoi + 1, old = -1, first = 0;
  let bits = 0, acc = 0, pi = 0, o = 0;
  for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; }
  while (o < count) {
    while (bits < size) { if (pi >= data.length) return out; acc |= data[pi++] << bits; bits += 8; }
    let code = acc & mask; acc >>= size; bits -= size;
    if (code === clear) { size = minCode + 1; mask = (1 << size) - 1; next = eoi + 1; old = -1; continue; }
    if (code === eoi) break;
    if (old === -1) { out[o++] = suffix[code]; old = first = code; continue; }
    const inCode = code; let sp = 0;
    if (code >= next) { stack[sp++] = first; code = old; }
    while (code >= clear) { stack[sp++] = suffix[code]; code = prefix[code]; }
    first = suffix[code]; stack[sp++] = first;
    while (sp && o < count) out[o++] = stack[--sp];
    if (next < 4096) { prefix[next] = old; suffix[next] = first; next++; if ((next & mask) === 0 && next < 4096) { size++; mask = (1 << size) - 1; } }
    old = inCode;
  }
  return out;
}

// Spreads GIF frames over a fixed-rate timeline so each frame keeps its own timing.
export function gifTimeline(delays) {
  const min = Math.max(1, Math.min(...delays));
  const fps = Math.max(1, Math.min(60, Math.round(1000 / min)));
  const slot = 1000 / fps;
  return { fps, slots: delays.map(ms => Math.max(1, Math.round(ms / slot))) };
}
