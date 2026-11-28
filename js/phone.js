// Sort and Library's link to Quarry: the last snapshot Quarry wrote to Quarry Sync/phone/,
// kept on the phone, and the queue of things done here, sent to phone/actions/ when online.
import * as G from './drive.js';
import * as S from './store.js';
import { view } from './overlay.js';

let snap = null, applied = { last: 0, failed: [] }, appliedOk = { last: 0 }, actions = [], folder = null, thumbIds = null;
let loaded = null;
const listeners = new Set();
const emit = () => { for (const f of listeners) try { f(); } catch {} };
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

export function init() {
  if (!loaded) loaded = (async () => {
    snap = await S.kvGet('snap'); applied = (await S.kvGet('applied')) || { last: 0, failed: [] };
    appliedOk = (await S.kvGet('appliedOk')) || { last: 0 };
    actions = await S.actionsAll(); thumbIds = await S.kvGet('thumbIds');
  })();
  return loaded;
}

export async function phoneId() {
  let id = await S.kvGet('phoneId');
  if (!id) { id = 'p-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)); await S.kvSet('phoneId', id); }
  return id;
}

// Fetches a new snapshot if Quarry wrote one, picks up what Quarry carried out, and sends what's waiting.
export async function refresh() {
  await init();
  if (!G.configured() || !G.connected()) return { state: 'signedout' };
  try {
    folder = await G.phoneFolder();
    if (!folder) return { state: 'nofolder' };
    const status = await G.readJson(folder.id, 'status.json');
    if (!status) return { state: 'nofolder' };
    if (!snap || !snap.status || snap.status.snapshot !== status.snapshot) {
      const [library, folders, tags, xqueue] = await Promise.all(['library', 'folders', 'tags', 'xqueue'].map(n => G.readJson(folder.id, n + '.json')));
      // Drive can bring status.json ahead of library.json: only take a snapshot whose parts match.
      if (library && library.snapshot === status.snapshot) {
        snap = { status, library, folders, tags, xqueue };
        await S.kvSet('snap', snap);
        if (folder.thumbsId) { thumbIds = Object.fromEntries(await G.listNames(folder.thumbsId)); await S.kvSet('thumbIds', thumbIds); }
      }
    }
    if (folder.appliedId) {
      const a = await G.readJson(folder.appliedId, (await phoneId()) + '.json');
      if (a) { applied = { last: a.last || 0, failed: a.failed || [], time: a.time || null }; await S.kvSet('applied', applied); }
    }
    await settle();
    emit();
    await send();
    return { state: 'ok', status };
  } catch (e) {
    emit();
    if (e instanceof G.DriveError && e.expired && G.renewNow()) return new Promise(() => {}); // off to Google and back
    if (e instanceof G.DriveError && e.auth && navigator.onLine) return { state: 'signedout' };
    return { state: 'offline', message: e.message };
  }
}

// Quarry writes applied/ at the start of a sync and the snapshot at the end: only once the snapshot
// is at least as new as applied/ are those actions really in it, and can be let go here.
async function settle() {
  const written = snap && snap.status && snap.status.written;
  if (!applied.time || (written && written >= applied.time)) {
    appliedOk = { last: applied.last }; await S.kvSet('appliedOk', appliedOk);
    const failedN = new Set(applied.failed.map(f => f.n));
    for (const a of actions.filter(a => a.n <= applied.last && !failedN.has(a.n))) await S.actionDel(a.n);
    actions = actions.filter(a => a.n > applied.last || failedN.has(a.n));
  }
}

// ---------- By file, through the iPhone Files app (Quarry Go isn't signed in to Drive):
// Quarry puts "for phone.json" in Quarry Sync › phone; Bring in reads it, and Send makes the
// actions file to save into Quarry Sync › phone › actions, the same file a signed-in phone would write.
export const BUNDLE = 'for phone.json';
const PARTS = ['status', 'library', 'folders', 'tags', 'xqueue'];
export function readParts(named) {   // [{name, json}] → the snapshot's parts, from the bundle or the separate files
  const got = {};
  for (const { name, json } of named) {
    if (!json || typeof json !== 'object') continue;
    if (json.kind === 'quarry-phone') { for (const k of [...PARTS, 'applied', 'thumbs']) if (json[k]) got[k] = json[k]; continue; }
    const n = name.replace(/\.json$/i, '').replace(/[ -]\(?\d+\)?$/, '').toLowerCase();
    if (PARTS.includes(n)) got[n] = json;
    else if (typeof json.last === 'number' && Array.isArray(json.failed)) got.appliedOne = json;
  }
  return got;
}
export async function bringIn(files) {
  await init();
  // Quarry puts a fingerprint ("sig") of the bundle's contents in its first few hundred bytes: the same
  // sig as last time means nothing changed, so the big file needn't be read again
  if (files.length === 1) {
    const m = (await files[0].slice(0, 600).text()).match(/"sig"\s*:\s*"([0-9a-f]{16,64})"/);
    if (m && snap && m[1] === (await S.kvGet('bundleSig2'))) { await settle(); emit(); return { ...snap.status, same: true }; }
  }
  const named = [];
  for (const f of files) { try { named.push({ name: f.name, json: JSON.parse(await f.text()) }); } catch {} }
  const got = readParts(named);
  const sig = (named.find(n => n.json && n.json.kind === 'quarry-phone') || {}).json?.sig || null;
  if (!got.status) throw new Error(`That isn't the file from Quarry. Pick "${BUNDLE}" in Quarry Sync › phone.`);
  snap = { status: got.status, library: got.library || snap?.library || { items: [] }, folders: got.folders || snap?.folders || null,
           tags: got.tags || snap?.tags || null, xqueue: got.xqueue || { posts: [] } };
  await S.kvSet('snap', snap);
  const a = (got.applied && got.applied[await phoneId()]) || got.appliedOne;
  if (a) { applied = { last: a.last || 0, failed: a.failed || [], time: a.time || null }; await S.kvSet('applied', applied); }
  if (got.thumbs) { await keepThumbs(got.thumbs); thumbNames = new Set(Object.keys(got.thumbs)); await S.kvSet('thumbNames', [...thumbNames]); }
  await S.kvSet('bundleSig2', sig);
  await settle(); emit();
  return snap.status;
}
// What hasn't gone to Quarry yet, as the file to save (built ahead, so Share opens straight from a tap).
let seqNow = null;
export const unsentCount = () => actions.filter(a => !a.sent).length;
export function actionsFile() {
  const unsent = actions.filter(a => !a.sent);
  if (!unsent.length || seqNow === null || !idNow) return null;
  const seq = seqNow + 1, name = `${idNow}-${String(seq).padStart(8, '0')}.json`;
  const body = { version: 1, phone: idNow, seq, time: new Date().toISOString().slice(0, 19), actions: unsent.map(({ sent, ...x }) => x) };
  return { file: new File([JSON.stringify(body)], name, { type: 'application/json' }), seq, ns: unsent.map(a => a.n) };
}
export async function markSent(out) {
  seqNow = out.seq; await S.kvSet('seq', out.seq);
  for (const a of actions) if (out.ns.includes(a.n)) { a.sent = true; await S.actionPut(a); }
  emit();
}
let idNow = null;
export async function fileReady() { await init(); idNow = await phoneId(); seqNow = (await S.kvGet('seq')) || 0; }

export async function act(a) {
  await init();
  const n = ((await S.kvGet('nextN')) || 1);
  await S.kvSet('nextN', n + 1);
  const rec = { ...a, n, sent: false };
  await S.actionPut(rec); actions.push(rec); emit();
  send().catch(() => {});
  return n;
}

// Sends are queued one after another, so a send that's still running never swallows a later one.
let chain = Promise.resolve();
export function send() {
  const run = chain.catch(() => {}).then(sendNow);
  chain = run;
  return run;
}
async function sendNow() {
  const unsent = actions.filter(a => !a.sent);
  if (!unsent.length) return;
  if (!folder) folder = await G.phoneFolder();
  if (!folder) return;
  const phone = await phoneId(), seq = ((await S.kvGet('seq')) || 0) + 1;
  await S.kvSet('seq', seq);  // taken before writing: a reply lost on the way back never reuses this file name
  await G.writeJson(folder.actionsId, `${phone}-${String(seq).padStart(8, '0')}.json`, {
    version: 1, phone, seq, time: new Date().toISOString().slice(0, 19),
    actions: unsent.map(({ sent, ...a }) => a),
  });
  for (const a of unsent) { a.sent = true; await S.actionPut(a); }
  emit();
}

export function current() { return view(snap, actions, { last: appliedOk.last, failed: applied.failed }); }

export async function drop(n) { await S.actionDel(n); actions = actions.filter(a => a.n !== n); emit(); }
export async function retry(n) {
  const a = actions.find(x => x.n === n); if (!a) return;
  await drop(n); const { n: _, sent, ...rest } = a; return act(rest);
}

// Thumbnails: kept in the phone's cache after the first look, so Library works offline. With the offline
// worker running, the picture is served from that cache by its own address (no copies held in memory);
// before it runs (the very first visit), a temporary blob address is used instead.
const urls = new Map();
// Thumbnails that came inside the bundle ({name: data URL}) go into the same cache Drive thumbs use.
// Which pictures came in the latest file (Quarry sends them for the newest untagged items only).
let thumbNames = null;
export async function loadThumbNames() { if (!thumbNames) { const a = await S.kvGet('thumbNames'); thumbNames = new Set(a || []); } return thumbNames; }
export const hasThumb = name => !!(name && thumbNames && thumbNames.has(name));
async function keepThumbs(map) {
  // kept twice: as the data links themselves (always works), and in the picture cache (faster to show)
  thumbData = map; try { await S.kvSet('thumbData', map); } catch {}
  let cache = null; try { cache = await caches.open('qg-thumbs'); } catch {}
  for (const [name, data] of Object.entries(map)) {
    urls.delete(name);
    if (!cache || typeof data !== 'string' || !data.startsWith('data:image/')) continue;
    try {
      const url = new URL('qg-thumbs/' + encodeURIComponent(name), document.baseURI).href;
      const bin = atob(data.slice(data.indexOf(',') + 1)), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await cache.put(url, new Response(bytes, { headers: { 'Content-Type': data.slice(5, data.indexOf(';')) } }));
    } catch {}   // one picture failing doesn't stop the rest
  }
}
let thumbData = null;
export async function thumbUrl(name) {
  if (!name) return null;
  if (urls.has(name)) return urls.get(name);
  const url = new URL('qg-thumbs/' + encodeURIComponent(name), document.baseURI).href;
  const cache = await caches.open('qg-thumbs');
  let res = await cache.match(url);
  if (!res) {
    if (!thumbData) thumbData = (await S.kvGet('thumbData')) || {};
    if (typeof thumbData[name] === 'string') { urls.set(name, thumbData[name]); return thumbData[name]; }
    const id = thumbIds && thumbIds[name];
    if (!id) return null;
    try { await cache.put(url, new Response(await G.readBlob(id), { headers: { 'Content-Type': 'image/jpeg' } })); res = await cache.match(url); }
    catch { return null; }
  }
  const u = navigator.serviceWorker && navigator.serviceWorker.controller ? url : URL.createObjectURL(await res.blob());
  urls.set(name, u); return u;
}
