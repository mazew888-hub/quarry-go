// A minimal MP4 writer for H.264 frames from VideoEncoder: one video track, every frame the same length,
// so the file plays exactly frames / fps long however long encoding took.
// samples: [{data: Uint8Array (length-prefixed NAL units), key: bool}]; avcC: the encoder's description.
// Returns Blob parts: ftyp, mdat, moov.

const u8 = (...b) => new Uint8Array(b);
const u16 = v => u8(v >> 8 & 255, v & 255);
const u32 = v => u8(v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255);
const str = s => new TextEncoder().encode(s);
const zeros = n => new Uint8Array(n);
function cat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const box = (type, ...body) => { const b = cat(body); return cat([u32(b.length + 8), str(type), b]); };
const full = (type, version, flags, ...body) => box(type, u8(version, flags >> 16 & 255, flags >> 8 & 255, flags & 255), ...body);
const MATRIX = cat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);

export function muxMp4({ width, height, fps, avcC, samples }) {
  // Timescale with the rate as a whole number of ticks per frame (23.976 → 24000 / 1001).
  const ntsc = Math.abs(fps * 1001 / 1000 - Math.round(fps * 1001 / 1000)) < 0.01 && !Number.isInteger(fps);
  const timescale = ntsc ? Math.round(fps * 1001 / 1000) * 1000 : Math.round(fps * 1000), delta = ntsc ? 1001 : 1000;
  const n = samples.length, mediaDur = n * delta, movieDur = Math.round(mediaDur / timescale * 1000);

  const ftyp = box('ftyp', str('isom'), u32(512), str('isom'), str('iso2'), str('avc1'), str('mp41'));
  const dataSize = samples.reduce((s, x) => s + x.data.length, 0);
  const mdatHead = cat([u32(dataSize + 8), str('mdat')]);
  const chunkOffset = ftyp.length + 8;

  const avc1 = box('avc1', zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1),
    zeros(32), u16(0x0018), u16(0xFFFF), box('avcC', avcC));
  const keys = samples.map((s, i) => s.key ? i + 1 : 0).filter(Boolean);
  const stbl = box('stbl',
    full('stsd', 0, 0, u32(1), avc1),
    full('stts', 0, 0, u32(1), u32(n), u32(delta)),
    full('stss', 0, 0, u32(keys.length), ...keys.map(u32)),
    full('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)),
    full('stsz', 0, 0, u32(0), u32(n), ...samples.map(s => u32(s.data.length))),
    full('stco', 0, 0, u32(1), u32(chunkOffset)));
  const minf = box('minf', full('vmhd', 0, 1, zeros(8)), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), stbl);
  const mdia = box('mdia',
    full('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(mediaDur), u16(0x55C4), u16(0)),
    full('hdlr', 0, 0, u32(0), str('vide'), zeros(12), str('VideoHandler\0')),
    minf);
  const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(movieDur), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX,
    u32(width * 65536), u32(height * 65536));
  const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(movieDur), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2));
  const moov = box('moov', mvhd, box('trak', tkhd, mdia));
  return [ftyp, mdatHead, ...samples.map(s => s.data), moov];
}
