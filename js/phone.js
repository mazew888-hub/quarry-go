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
    // Quarry writes applied/ at the start of a sync and the snapshot at the end: only once the snapshot
    // is at least as new as applied/ are those actions really in it, and can be let go here.
    const written = snap && snap.status && snap.status.written;
    if (!applied.time || (written && written >= applied.time)) {
      appliedOk = { last: applied.last }; await S.kvSet('appliedOk', appliedOk);
      const failedN = new Set(applied.failed.map(f => f.n));
      for (const a of actions.filter(a => a.n <= applied.last && !failedN.has(a.n))) await S.actionDel(a.n);
      actions = actions.filter(a => a.n > applied.last || failedN.has(a.n));
    }
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
export async function thumbUrl(name) {
  if (!name) return null;
  if (urls.has(name)) return urls.get(name);
  const url = new URL('qg-thumbs/' + encodeURIComponent(name), document.baseURI).href;
  const cache = await caches.open('qg-thumbs');
  let res = await cache.match(url);
  if (!res) {
    const id = thumbIds && thumbIds[name];
    if (!id) return null;
    try { await cache.put(url, new Response(await G.readBlob(id), { headers: { 'Content-Type': 'image/jpeg' } })); res = await cache.match(url); }
    catch { return null; }
  }
  const u = navigator.serviceWorker && navigator.serviceWorker.controller ? url : URL.createObjectURL(await res.blob());
  urls.set(name, u); return u;
}
