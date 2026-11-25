// Moving reviews between this phone and an iPad (or another phone) with no server: one zip, sent by AirDrop.
// The zip holds a list of the reviews (notes, drawings, retimes, loops), their previews and their videos.
// Receiving merges by review: a video the device doesn't have is added; one it has is replaced only if
// the incoming copy was edited more recently. Nothing here touches the network.
import { zipParts } from './zip.js';

export const HANDOFF_JSON = 'quarry-go-handoff.json';
const NOT_HANDOFF = "That file isn't a Quarry Go handoff. On the other device, open a review and tap Send.";
const EXT = { 'video/quicktime': 'mov', 'video/mp4': 'mp4', 'image/gif': 'gif', 'video/webm': 'webm' };
const bytes = async b => new Uint8Array(b instanceof ArrayBuffer ? b : await b.arrayBuffer());

// reviews: Review objects; getClip(id) gives the video Blob (or null). Returns a File ready to share.
export async function packHandoff(reviews, getClip, when = new Date(), onStep = () => {}) {
  const entries = [], list = [];
  for (const [i, r] of reviews.entries()) {
    onStep(r, i);
    const { thumb, ...rest } = r, item = { ...rest, thumb: null, clip: null };
    if (thumb && (thumb.byteLength || thumb.size)) {
      item.thumb = `thumbs/${r.id}.jpg`;
      entries.push({ name: item.thumb, data: await bytes(thumb) });
    }
    const clip = await getClip(r.id);
    if (clip) {
      item.clip = `clips/${r.id}.${EXT[clip.type] || EXT[r.clipType] || 'bin'}`;
      item.clipType = clip.type || r.clipType || '';
      entries.push({ name: item.clip, data: clip });   // the saved video itself: nothing is copied
    }
    list.push(item);
  }
  const head = { kind: 'quarry-go-handoff', v: 1, made: when.getTime(), reviews: list };
  entries.unshift({ name: HANDOFF_JSON, data: new TextEncoder().encode(JSON.stringify(head)) });
  const days = [...new Set(reviews.map(r => r.day).filter(Boolean))].sort();
  const label = days.length === 1 ? days[0] : days.length ? `${days[0]} to ${days.at(-1)}` : 'reviews';
  return new File(zipParts(entries, when), `Quarry Go handoff ${label}.zip`, { type: 'application/zip' });
}

// Reads the zip's directory from its end, then slices each stored file straight out of the Blob
// (no copying, so big videos stay cheap).
async function entriesOf(blob) {
  const tailLen = Math.min(blob.size, 65557);
  if (tailLen < 22) throw new Error(NOT_HANDOFF);
  const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
  let e = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error(NOT_HANDOFF);
  const count = tail.getUint16(e + 10, true), size = tail.getUint32(e + 12, true), at = tail.getUint32(e + 16, true);
  if (at + size > blob.size) throw new Error(NOT_HANDOFF);
  const cd = new DataView(await blob.slice(at, at + size).arrayBuffer()), dec = new TextDecoder(), out = new Map();
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error(NOT_HANDOFF);
    const method = cd.getUint16(p + 10, true), len = cd.getUint32(p + 20, true);
    const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true), off = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl));
    out.set(name, { method, len, off });
    p += 46 + nl + xl + cl;
  }
  const open = async (name, type = '') => {
    const f = out.get(name); if (!f || f.method !== 0) return null;
    const h = new DataView(await blob.slice(f.off, f.off + 30).arrayBuffer());
    const start = f.off + 30 + h.getUint16(26, true) + h.getUint16(28, true);
    return blob.slice(start, start + f.len, type);
  };
  return open;
}

// Returns { reviews (with thumb as bytes), clip(id) → Blob or null }.
export async function readHandoff(blob) {
  const open = await entriesOf(blob);
  const head = await open(HANDOFF_JSON);
  if (!head) throw new Error(NOT_HANDOFF);
  let data; try { data = JSON.parse(await head.text()); } catch { throw new Error(NOT_HANDOFF); }
  if (data.kind !== 'quarry-go-handoff' || !Array.isArray(data.reviews)) throw new Error(NOT_HANDOFF);
  const byId = new Map(data.reviews.map(r => [r.id, r]));
  const reviews = [];
  for (const r of data.reviews) {
    const { clip, thumb, ...rest } = r, t = thumb ? await open(thumb) : null;
    reviews.push({ ...rest, thumb: t ? await t.arrayBuffer() : null });
  }
  // The video is copied out into its own Blob: on iPad/iPhone (WebKit), saving a slice of the picked
  // file kept a link to the whole zip, so the saved "video" couldn't be opened.
  const clip = async id => {
    const r = byId.get(id), part = r && r.clip ? await open(r.clip, r.clipType || '') : null;
    return part ? new Blob([await part.arrayBuffer()], { type: r.clipType || '' }) : null;
  };
  return { reviews, clip };
}

// Which incoming reviews to add, which replace this device's copy (edited more recently), which to leave.
export function mergePlan(local, incoming) {
  const mine = new Map(local.map(r => [r.id, r])), plan = { add: [], update: [], skip: [] };
  for (const r of incoming) {
    const m = mine.get(r.id);
    if (!m) plan.add.push(r);
    else if ((r.updated || 0) > (m.updated || 0)) plan.update.push(r);
    else plan.skip.push(r);
  }
  return plan;
}
