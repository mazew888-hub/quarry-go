// Reviews and their clips, kept in this app's own storage on the phone (IndexedDB "quarry-go").
// reviews: Review objects keyed by id. clips: the clip Blob keyed by the same id.

const DB = 'quarry-go', VERSION = 1;
const FULL = 'Not enough space on this phone for that clip';
let dbp = null;

function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const rq = indexedDB.open(DB, VERSION);
    rq.onupgradeneeded = () => { const d = rq.result; d.createObjectStore('reviews', { keyPath: 'id' }); d.createObjectStore('clips'); };
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
  return dbp;
}
const req = rq => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
const done = tx => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error || new DOMException('aborted', 'AbortError')); });
const isFull = e => e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export async function createReview(meta, clip) {
  const now = Date.now();
  const review = {
    id: newId(), name: 'Clip', created: now, updated: now, fps: 24, frameCount: 0, width: 0, height: 0, thumb: null,
    marks: [], secs: [], retimed: false, inF: null, outF: null, rate: 1, pos: 0, clipType: clip.type || '', ...meta,
  };
  const d = await db();
  const tx = d.transaction(['reviews', 'clips'], 'readwrite');
  const finished = done(tx);
  try {
    tx.objectStore('reviews').put(review);
    tx.objectStore('clips').put(clip, review.id);
    await finished;
  } catch (e) {
    try { tx.abort(); } catch {}
    await finished.catch(() => {});
    throw isFull(e) ? new Error(FULL) : e;
  }
  return review;
}

export async function listReviews() {
  const d = await db();
  const all = await req(d.transaction('reviews').objectStore('reviews').getAll());
  return all.sort((a, b) => b.updated - a.updated);
}
export async function getReview(id) { const d = await db(); return (await req(d.transaction('reviews').objectStore('reviews').get(id))) ?? null; }
export async function getClip(id) { const d = await db(); return (await req(d.transaction('clips').objectStore('clips').get(id))) ?? null; }
export async function putClip(id, blob) {
  const d = await db(); const tx = d.transaction('clips', 'readwrite');
  try { tx.objectStore('clips').put(blob, id); await done(tx); } catch (e) { throw isFull(e) ? new Error(FULL) : e; }
}

// Saves are merged per review and written 300ms after the last change; flush() writes them now.
const pending = new Map(); let timer = 0;
export function saveReview(id, patch) {
  pending.set(id, { ...(pending.get(id) || {}), ...patch });
  clearTimeout(timer); timer = setTimeout(flush, 300);
}
export async function flush() {
  clearTimeout(timer);
  if (!pending.size) return;
  const batch = [...pending]; pending.clear();
  const d = await db(); const tx = d.transaction('reviews', 'readwrite'); const st = tx.objectStore('reviews');
  for (const [id, patch] of batch) {
    const rq = st.get(id);
    rq.onsuccess = () => { if (rq.result) st.put({ ...rq.result, ...patch, id, updated: Date.now() }); };
  }
  await done(tx);
}

export async function deleteReview(id) {
  pending.delete(id);
  const d = await db(); const tx = d.transaction(['reviews', 'clips'], 'readwrite');
  tx.objectStore('reviews').delete(id); tx.objectStore('clips').delete(id); await done(tx);
}
export async function deleteAll() {
  pending.clear();
  const d = await db(); const tx = d.transaction(['reviews', 'clips'], 'readwrite');
  tx.objectStore('reviews').clear(); tx.objectStore('clips').clear(); await done(tx);
}
export async function usage() {
  const d = await db(); const st = d.transaction('clips').objectStore('clips');
  let bytes = 0;
  await new Promise((res, rej) => {
    const c = st.openCursor();
    c.onsuccess = () => { const cur = c.result; if (!cur) return res(); bytes += cur.value?.size || 0; cur.continue(); };
    c.onerror = () => rej(c.error);
  });
  return { bytes };
}
