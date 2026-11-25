// Reads the video track of an MP4 or QuickTime (.mov) file: its codec, size and every sample (one coded
// picture), so the phone's own video decoder can turn the whole clip into frames in one go.
// Returns null for anything it doesn't handle (no video track, fragmented files, a rotated picture),
// and the caller falls back to reading frames through a <video>.

const u32 = (d, o) => d.getUint32(o);
const type = (d, o) => String.fromCharCode(d.getUint8(o), d.getUint8(o + 1), d.getUint8(o + 2), d.getUint8(o + 3));

// The boxes inside [start, end): [{type, start (contents), end}]
function boxes(d, start, end) {
  const out = [];
  for (let o = start; o + 8 <= end;) {
    let size = u32(d, o), head = 8;
    const t = type(d, o + 4);
    if (size === 1) { size = Number(d.getBigUint64(o + 8)); head = 16; }
    else if (size === 0) size = end - o;
    if (size < head || o + size > end) break;
    out.push({ type: t, start: o + head, end: o + size });
    o += size;
  }
  return out;
}
const find = (d, box, ...path) => {
  let cur = box;
  for (const t of path) { cur = boxes(d, cur.start, cur.end).find(b => b.type === t); if (!cur) return null; }
  return cur;
};
const full = b => ({ version: 0, start: b.start + 4, end: b.end });   // skip version + flags

// codec strings, as WebCodecs wants them
const hex2 = n => n.toString(16).padStart(2, '0');
function avcCodec(c) { return `avc1.${hex2(c[1])}${hex2(c[2])}${hex2(c[3])}`; }
function hevcCodec(tag, c) {
  const space = ['', 'A', 'B', 'C'][c[1] >> 6], tier = (c[1] >> 5) & 1, profile = c[1] & 31;
  let compat = ((c[2] << 24) | (c[3] << 16) | (c[4] << 8) | c[5]) >>> 0, rev = 0;
  for (let i = 0; i < 32; i++) { rev = (rev << 1) | (compat & 1); compat >>>= 1; }
  const level = c[12], cons = [6, 7, 8, 9, 10, 11].map(i => c[i]);
  while (cons.length && cons[cons.length - 1] === 0) cons.pop();
  return [`${tag}.${space}${profile}`, (rev >>> 0).toString(16), `${tier ? 'H' : 'L'}${level}`, ...cons.map(x => x.toString(16).toUpperCase())].join('.');
}

const FPS = [12, 15, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
export const snapFps = raw => FPS.reduce((a, b) => Math.abs(b - raw) < Math.abs(a - raw) ? b : a, 24);

export function demux(buf) {
  const d = new DataView(buf), file = { start: 0, end: buf.byteLength };
  const moov = boxes(d, 0, buf.byteLength).find(b => b.type === 'moov');
  if (!moov || boxes(d, moov.start, moov.end).some(b => b.type === 'mvex')) return null;   // fragmented: not handled
  for (const trak of boxes(d, moov.start, moov.end).filter(b => b.type === 'trak')) {
    const hdlr = find(d, trak, 'mdia', 'hdlr');
    if (!hdlr || type(d, hdlr.start + 8) !== 'vide') continue;
    // the display matrix: anything but upright is left to the <video> path, which turns it for us
    const tkhd = find(d, trak, 'tkhd'); if (!tkhd) return null;
    const mo = tkhd.start + (d.getUint8(tkhd.start) === 1 ? 52 : 40);
    if (u32(d, mo + 4) !== 0 || u32(d, mo + 12) !== 0 || d.getInt32(mo) <= 0 || d.getInt32(mo + 16) <= 0) return null;

    const mdhd = find(d, trak, 'mdia', 'mdhd'); if (!mdhd) return null;
    const timescale = u32(d, mdhd.start + (d.getUint8(mdhd.start) === 1 ? 20 : 12));
    const stbl = find(d, trak, 'mdia', 'minf', 'stbl'); if (!stbl) return null;
    const get = t => boxes(d, stbl.start, stbl.end).find(b => b.type === t);

    // stsd: the sample entry carries the size and the decoder setup (avcC / hvcC)
    const stsd = get('stsd'); if (!stsd) return null;
    const entry = boxes(d, stsd.start + 8, stsd.end)[0]; if (!entry) return null;
    const tag = entry.type, width = d.getUint16(entry.start + 24), height = d.getUint16(entry.start + 26);
    const inner = boxes(d, entry.start + 78, entry.end);
    const cfg = inner.find(b => b.type === 'avcC' || b.type === 'hvcC'); if (!cfg) return null;
    const description = new Uint8Array(buf.slice(cfg.start, cfg.end));
    let codec;
    if (cfg.type === 'avcC') codec = avcCodec(description);
    else codec = hevcCodec(tag === 'hev1' ? 'hev1' : 'hvc1', description);

    // sample sizes
    const stsz = get('stsz'); if (!stsz) return null;
    const fixed = u32(d, stsz.start + 4), n = u32(d, stsz.start + 8);
    const sizes = new Array(n); for (let i = 0; i < n; i++) sizes[i] = fixed || u32(d, stsz.start + 12 + i * 4);
    // chunk offsets, and which samples sit in which chunk
    const stco = get('stco'), co64 = get('co64'), chunks = [];
    if (stco) { const k = u32(d, stco.start + 4); for (let i = 0; i < k; i++) chunks.push(u32(d, stco.start + 8 + i * 4)); }
    else if (co64) { const k = u32(d, co64.start + 4); for (let i = 0; i < k; i++) chunks.push(Number(d.getBigUint64(co64.start + 8 + i * 8))); }
    else return null;
    const stsc = get('stsc'); if (!stsc) return null;
    const runs = []; { const k = u32(d, stsc.start + 4); for (let i = 0; i < k; i++) runs.push([u32(d, stsc.start + 8 + i * 12) - 1, u32(d, stsc.start + 12 + i * 12)]); }
    const offsets = new Array(n); let s = 0;
    for (let r = 0; r < runs.length && s < n; r++) {
      const [first, per] = runs[r], last = r + 1 < runs.length ? runs[r + 1][0] : chunks.length;
      for (let c = first; c < last && s < n; c++) { let o = chunks[c]; for (let j = 0; j < per && s < n; j++) { offsets[s] = o; o += sizes[s++]; } }
    }
    if (s < n) return null;
    // decode times (stts), presentation offsets (ctts), keyframes (stss: none means every one is a key)
    const stts = get('stts'); if (!stts) return null;
    const dts = new Array(n); { let t = 0, i = 0; const k = u32(d, stts.start + 4); for (let e = 0; e < k; e++) { const cnt = u32(d, stts.start + 8 + e * 8), dl = u32(d, stts.start + 12 + e * 8); for (let j = 0; j < cnt && i < n; j++) { dts[i++] = t; t += dl; } } if (i < n) return null; }
    const pts = dts.slice(), ctts = get('ctts');
    if (ctts) { const ver = d.getUint8(ctts.start), k = u32(d, ctts.start + 4); let i = 0; for (let e = 0; e < k; e++) { const cnt = u32(d, ctts.start + 8 + e * 8), off = ver ? d.getInt32(ctts.start + 12 + e * 8) : u32(d, ctts.start + 12 + e * 8); for (let j = 0; j < cnt && i < n; j++) pts[i++] += off; } }
    const stss = get('stss'), key = new Array(n).fill(!stss);
    if (stss) { const k = u32(d, stss.start + 4); for (let i = 0; i < k; i++) key[u32(d, stss.start + 8 + i * 4) - 1] = true; }

    // frame rate from the usual gap between pictures
    const gaps = []; for (let i = 1; i < n; i++) if (dts[i] > dts[i - 1]) gaps.push(dts[i] - dts[i - 1]);
    gaps.sort((a, b) => a - b);
    const fps = gaps.length ? snapFps(timescale / gaps[Math.floor(gaps.length / 2)]) : 24;
    const samples = sizes.map((size, i) => ({ offset: offsets[i], size, key: key[i], dts: dts[i], pts: pts[i] }));
    if (samples.some(x => x.offset + x.size > file.end)) return null;
    return { codec, description, width, height, timescale, fps, samples };
  }
  return null;
}
