// Quarry Go: boot, routing (#/ is Reviews, #/r/<id> is the player), saving and settings.
import { loadFrames, CANT_OPEN } from './frames.js';
import { openPlayer, log, status } from './player.js';
import { renderHistory, renderDay } from './reviews.js';
import { dayOf, dayInfo, dayTitle, today } from './days.js';
import { videoNames } from './names.js';
import { openExport } from './pack.js';
import * as S from './store.js';
import * as G from './drive.js';
import * as phone from './phone.js';
import { createSort } from './sort.js';
import { createLibrary } from './library.js';

export const VERSION = '0.6.4';
const $ = id => document.getElementById(id);
const local = ['localhost', '127.0.0.1'].includes(location.hostname);

let toastT = 0;
export function toast(msg, ms = 3500) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}
const show = id => { $(id).style.display = 'flex'; $(id).classList.add('show'); };
const hide = id => { $(id).style.display = 'none'; $(id).classList.remove('show'); };
for (const v of ['cardVeil', 'settingsVeil', 'confirmVeil']) $(v).addEventListener('click', e => { if (e.target === $(v)) hide(v); });

// ---------- confirm sheet (never the browser's confirm())
function confirmSheet(text) {
  return new Promise(res => {
    $('confirmTxt').textContent = text; show('confirmVeil');
    $('confirmYes').onclick = () => { hide('confirmVeil'); res(true); };
    $('confirmNo').onclick = () => { hide('confirmVeil'); res(false); };
  });
}

// ---------- iPhone home-screen fixes
// iOS can lay out a home-screen web app about one status bar short of the screen, leaving a dead band at the
// bottom (a WebKit bug, fixed in Safari 26.1 for some layouts). Where that happens, size the app to the screen
// itself. Turned sideways, the notch is only on one side: say which, so controls hug the other edge.
function fitScreen() {
  const root = document.documentElement, standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const landscape = innerWidth > innerHeight, full = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
  const short = full - innerHeight;
  root.style.setProperty('--appH', standalone && short > 8 && short < 90 ? `${full}px` : '100%');
  const angle = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
  root.classList.toggle('notch-l', landscape && (angle === 90));
  root.classList.toggle('notch-r', landscape && (angle === 270 || angle === -90));
}
fitScreen();
addEventListener('resize', fitScreen); addEventListener('orientationchange', () => setTimeout(fitScreen, 350));

// ---------- Reviews: the history (#/), one review = one day of videos (#/d/<day>), the player (#/r/<id>)
let player = null;
let openSeq = 0;                     // only the newest open request may show its screen
const save = () => S.flush().catch(e => toast(e.message));
let thumbUrls = [];
const thumbUrl = r => { const u = URL.createObjectURL(S.thumbBlob(r.thumb)); thumbUrls.push(u); return u; };
const freeThumbs = () => { for (const u of thumbUrls) URL.revokeObjectURL(u); thumbUrls = []; };
async function leavePlayer() {
  openSeq++;
  if (player) { player.close(); player = null; }
  $('reviews').classList.remove('busy'); hide('missing'); hide('exportVeil');
  await save();
}
// Videos picked from Photos arrive with made-up code names: they become Video 1, 2, 3... in their day.
async function nameCodes(list) {
  const byDay = new Map(); for (const r of list) { const d = dayOf(r); byDay.set(d, [...(byDay.get(d) || []), r]); }
  let n = 0;
  for (const day of byDay.values()) for (const [id, name] of Object.entries(videoNames(day))) {
    list.find(r => r.id === id).name = name; S.saveReview(id, { name }); n++;
  }
  if (n) await save();
}
async function showHistory() {
  await leavePlayer(); const my = openSeq;
  const list = await S.listReviews();
  if (my !== openSeq) return;
  await nameCodes(list);
  freeThumbs();
  renderHistory($('reviews'), list, {
    onOpenDay: day => { location.hash = `#/d/${day}`; },
    onHoldDay: day => deleteDay(day, list),
    onSettings: settings,
  }, thumbUrl);
  $('reviews').classList.add('show'); $('reviews').scrollTop = 0;
  fileMode = { kind: 'add', day: today() };
  repairThumbs(list);
}
async function showDay(day) {
  await leavePlayer(); const my = openSeq;
  const list = await S.listReviews();
  if (my !== openSeq) return;
  await nameCodes(list);
  const info = dayInfo(list, day);
  freeThumbs();
  renderDay($('reviews'), info, {
    onBack: () => { location.hash = '#/'; },
    onOpen: id => { location.hash = `#/r/${id}`; },
    onHold: id => cardSheet(info.videos.find(r => r.id === id)),
    onExport: () => openExport($('exportVeil'), info, { getClip: S.getClip, toast, log }),
  }, thumbUrl);
  $('reviews').classList.add('show');
  fileMode = { kind: 'add', day };
  repairThumbs(info.videos);
}
// Old previews (stored as pictures) become bytes; missing or broken ones are made again from the video.
const repairing = new Set();
async function repairThumbs(list) {
  let fixed = 0;
  for (const r of list) {
    if (r.thumb instanceof ArrayBuffer && r.thumb.byteLength) continue;
    if (repairing.has(r.id)) continue; repairing.add(r.id);
    let thumb = null;
    if (r.thumb instanceof Blob) { try { const b = await r.thumb.arrayBuffer(); if (b.byteLength) thumb = b; } catch { /* broken: make it again */ } }
    if (!thumb) {
      try { const clip = await S.getClip(r.id); if (clip) thumb = (await probe(clip)).thumb; } catch (e) { log(`preview for ${r.name}: ${e.message}`); }
    }
    if (thumb) { S.saveReview(r.id, { thumb }); fixed++; }
  }
  if (!fixed) return;
  await save();
  if (!player && !$('missing').classList.contains('show') && location.hash.match(/^#\/(d\/[\d-]+)?$|^$/)) showCurrent();
}
const showCurrent = () => { const m = location.hash.match(/^#\/d\/(\d{4}-\d\d-\d\d)$/); return m ? showDay(m[1]) : showHistory(); };
async function deleteDay(day, list) {
  const vids = list.filter(v => dayOf(v) === day);
  if (!vids.length || !await confirmSheet(`Delete the review for ${dayTitle(day)} (${vids.length} video${vids.length === 1 ? '' : 's'})?`)) return;
  for (const v of vids) await S.deleteReview(v.id);
  showCurrent();
}
function cardSheet(r) {
  $('renameIn').value = r.name; show('cardVeil');
  $('renameOk').onclick = async () => {
    const name = $('renameIn').value.trim(); hide('cardVeil');
    if (name && name !== r.name) { S.saveReview(r.id, { name }); await S.flush(); showCurrent(); }
  };
  $('deleteOne').onclick = async () => {
    hide('cardVeil');
    if (await confirmSheet(`Delete "${r.name}"?`)) { await S.deleteReview(r.id); showCurrent(); }
  };
}
async function settings() {
  const [{ bytes }, list] = await Promise.all([S.usage(), S.listReviews()]);
  $('spaceUsed').textContent = `${(bytes / 1e6).toFixed(1)} MB · ${list.length} video${list.length === 1 ? '' : 's'}`;
  $('version').textContent = VERSION;
  const on = extraTabs();
  $('extraTabs').textContent = on ? 'On' : 'Off'; $('extraTabs').classList.toggle('on', on);
  $('extraTabs').onclick = () => {
    try { localStorage.setItem('qg_extra_tabs', on ? '0' : '1'); } catch {}
    $('extraTabs').textContent = on ? 'Off' : 'On'; $('tabbar').classList.toggle('show', !on); settings();
  };
  $('gRow').style.display = on ? '' : 'none';
  const acc = G.connected() ? await G.account().catch(() => null) : null;
  $('gAccount').textContent = !G.configured() ? 'Not set up yet' : acc ? acc.email : 'Not connected';
  $('gBtn').textContent = acc ? 'Disconnect' : 'Connect';
  $('gBtn').style.display = G.configured() ? '' : 'none';
  $('gCheckRow').style.display = acc && on ? '' : 'none';
  $('gCheck').textContent = 'Check what this phone can see in your Drive.';
  $('gCheckBtn').onclick = async () => {
    $('gCheck').textContent = 'Checking…';
    try {
      const d = await G.diagnose();
      const lines = [`Signed in as ${d.email}.`];
      if (!d.roots.length) lines.push('No folder called “Quarry Sync” is visible in this Google Drive. Is Quarry syncing to this same Google account?');
      d.roots.forEach((r, i) => lines.push(`Quarry Sync ${d.roots.length > 1 ? i + 1 : ''}: ` + (r.phone
        ? `phone folder found with ${r.files.length} file(s): ${r.files.slice(0, 8).join(', ') || 'none yet'}.`
        : `no phone folder inside (has: ${r.children.slice(0, 6).join(', ') || 'nothing'}).`)));
      $('gCheck').textContent = lines.join('\n');
    } catch (e) { $('gCheck').textContent = e.message; }
  };
  $('gBtn').onclick = () => { if (acc) { G.signOut(); settings(); } else { try { G.signIn(); } catch (e) { toast(e.message); } } };
  show('settingsVeil');
  $('deleteAll').onclick = async () => {
    hide('settingsVeil');
    if (await confirmSheet('Delete all reviews?')) { await S.deleteAll(); location.hash = '#/'; showHistory(); }
  };
}

// ---------- adding videos (several at once) and picking a missing clip again
let fileMode = { kind: 'add', day: null };
const baseName = f => (f.name || 'Clip').replace(/\.[^.]+$/, '') || 'Clip';
async function firstFrame(media) {
  for (let i = 0; i < 200 && !media.frames[0]; i++) await new Promise(r => setTimeout(r, 50));
  return media.frames[0];
}
async function thumbOf(bmp) {
  const c = document.createElement('canvas'); c.width = 320; c.height = Math.round(320 * bmp.height / bmp.width);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const jpg = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
  return jpg.arrayBuffer();  // bytes, not a picture object: see thumbBlob in store.js
}
// Reads just enough of a clip for its card (size, rate, frames, first picture). Nothing is saved if it can't be read.
async function probe(file) {
  const media = await loadFrames(file, { log: () => {} }); // quiet: the player's log is for the clip that's open
  try {
    const f0 = await firstFrame(media);
    if (!f0) throw new Error(CANT_OPEN);
    return { fps: media.fps, frameCount: media.count, width: media.W, height: media.H, thumb: await thumbOf(f0) };
  } finally { media.cancel(); }
}
async function addFiles(files, day) {
  const failed = [];
  $('reviews').classList.add('busy');
  try {
    for (const [i, file] of files.entries()) {
      status(files.length > 1 ? `Adding ${i + 1} of ${files.length}…` : 'Adding…', i / files.length);
      try { await S.createReview({ name: baseName(file), fileName: file.name || '', day, ...await probe(file) }, file); }
      catch (err) { failed.push(err.message === CANT_OPEN ? `${file.name || 'A clip'} can't be opened` : err.message); if (/space/i.test(err.message)) break; }
    }
  } finally { status(''); $('reviews').classList.remove('busy'); }
  if (failed.length) toast(failed.length === 1 ? failed[0] : `${failed.length} videos weren't added: ${failed[0]}`, 5000);
}
$('file').onchange = async e => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  const mode = fileMode;
  if (mode.kind === 'repick') {
    let info;
    try { status('Opening…', 0); info = await probe(files[0]); } catch (err) { toast(err.message); return; } finally { status(''); }
    try {
      // the new clip may be a different length or size: the review takes all of its details, and an
      // in/out range that no longer fits is cleared
      const old = await S.getReview(mode.id), fit = f => f != null && f < info.frameCount ? f : null;
      await S.putClip(mode.id, files[0]);
      S.saveReview(mode.id, { clipType: files[0].type, fileName: files[0].name || '', ...info, inF: fit(old?.inF), outF: fit(old?.outF) });
      await S.flush();
    }
    catch (err) { toast(err.message); return; }
    hide('missing'); openReview(mode.id);
    return;
  }
  const day = mode.day || today();
  await addFiles(files, day);
  if (location.hash !== `#/d/${day}`) location.hash = `#/d/${day}`; else showDay(day);
};
async function openReview(id) {
  const my = ++openSeq, stale = () => my !== openSeq;
  $('reviews').classList.add('busy'); // no second tap while this one opens
  const review = await S.getReview(id);
  if (stale()) return;
  if (!review) { location.hash = '#/'; return; }
  let media = null;
  {
    const clip = await S.getClip(id);
    if (stale()) return;
    if (!clip) { $('reviews').classList.remove('busy'); fileMode = { kind: 'repick', id, day: dayOf(review) }; $('reviews').classList.add('show'); show('missing'); return; }
    try { status('Opening…', 0); media = await loadFrames(clip, { log }); }
    catch (err) { status(''); if (!stale()) { toast(err.message); location.hash = '#/'; } return; }
    status('');
    if (stale()) { media.cancel(); return; }
  }
  $('reviews').classList.remove('busy');
  if (player) player.close();
  $('reviews').classList.remove('show');
  player = openPlayer($('player'), {
    media, review, name: review.name,
    onChange: patch => {
      S.saveReview(id, patch);
      // Notes, shapes, loops and retimes are written at once; playhead moves wait for the next save.
      if (Object.keys(patch).some(k => k !== 'pos')) save();
    },
    onBack: () => { location.hash = `#/d/${dayOf(review)}`; },
  });
}
$('missingBack').onclick = () => { hide('missing'); const d = fileMode.day; location.hash = d ? `#/d/${d}` : '#/'; };

// ---------- routing and lifecycle
// ---------- tabs: Review, Sort, Library
let sortTab = null, libTab = null;
// Quarry Go is a review app first: Sort and Library stay hidden until switched on in Settings.
const extraTabs = () => { try { return localStorage.getItem('qg_extra_tabs') === '1'; } catch { return false; } };
function setTab(name) {
  $('tabbar').classList.toggle('show', !!name && extraTabs());
  for (const t of ['review', 'sort', 'library']) $('tab-' + t).classList.toggle('on', t === name);
  if (name !== 'review') $('reviews').classList.remove('show');
  if (name !== 'sort' && sortTab) sortTab.close();
  if (name !== 'library' && libTab) libTab.close();
}
async function showSort() {
  openSeq++; if (player) { player.close(); player = null; }
  setTab('sort');
  if (!sortTab) sortTab = createSort($('sort'), { phone, drive: G, toast });
  sortTab.open();
}

function route() {
  const h = location.hash;
  const m = h.match(/^#\/r\/(.+)$/);
  if (m) { setTab(null); openReview(decodeURIComponent(m[1])); }
  else if ((h === '#/sort' || h === '#/library') && !extraTabs()) { location.replace('#/'); }
  else if (h === '#/sort') showSort();
  else if (h === '#/library') {
    openSeq++; if (player) { player.close(); player = null; }
    setTab('library');
    if (!libTab) libTab = createLibrary($('library'), { phone, drive: G, toast });
    libTab.open();
  }
  else if (/^#\/d\/\d{4}-\d\d-\d\d$/.test(h)) { setTab('review'); showDay(h.slice(4)); }
  else { setTab('review'); showHistory(); }
}
addEventListener('hashchange', route);
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
addEventListener('pagehide', () => save());

// ---------- test routes, only when served from this machine
async function testPlayer(q) {
  window.changes = [];
  try {
    const name = q.get('clip');
    const blob = await (await fetch(`tests/fixtures/${name}`)).blob();
    const maxBytes = q.has('maxBytes') ? +q.get('maxBytes') : undefined;
    const media = await loadFrames(blob, { maxBytes, log });
    const review = q.has('secs') ? { secs: JSON.parse(q.get('secs')), retimed: true } : null;  // a review from before time warp
    openPlayer($('player'), { media, review, name: name.replace(/\.[^.]+$/, ''), onChange: p => window.changes.push(p), onBack: () => {} });
  } catch (e) { toast(e.message); }
}
function sample(q) {
  const thumb = (a, b) => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 320, 180); g.addColorStop(0, a); g.addColorStop(1, b); x.fillStyle = g; x.fillRect(0, 0, 320, 180);
    x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.arc(150, 95, 26, 0, 7); x.fill(); x.fillRect(146, 118, 8, 40); return c.toDataURL(); };
  const C = [['#4A7590', '#1D2024'], ['#8a6f5a', '#282C31'], ['#5a7a64', '#212429'], ['#6b5a8a', '#2a2436'], ['#7a6656', '#2c2520'], ['#4f6a84', '#202a33']];
  const now = Date.now(), dayAgo = n => dayOf(now - n * 864e5);
  const names = ['grunt_attack_combo_v3', 'brute_hitreact_heavy_v2', 'archer_dodge_back_v5', 'brute_slam_v4', 'grunt_idle_v1', 'archer_shoot_v2'];
  const marks = [[{ type: 'note' }, { type: 'note' }, { type: 'note' }, { type: 'draw' }, { type: 'arrow' }], [{ type: 'note' }], [{ type: 'draw' }, { type: 'box' }, { type: 'circle' }, { type: 'draw' }], [{ type: 'note' }, { type: 'note' }], [], []];
  const rs = [];
  const add = (day, n, notes) => { for (let i = 0; i < n; i++) rs.push({ id: day + i, day, created: i, name: names[i % 6], frameCount: [96, 58, 41, 80, 120, 64][i % 6],
    marks: i < notes ? marks[i % 4] : [], secs: i === 1 ? [{ a: 0, b: 4, type: 'hold' }] : [], retimed: i === 1, thumb: 1, t: thumb(...C[(i + day.length) % 6]) }); };
  add(dayAgo(0), 6, 4); add(dayAgo(2), 9, 9); add(dayAgo(5), 5, 2); add(dayAgo(8), 3, 3); add(dayAgo(13), 7, 0); add(dayAgo(25), 4, 4);
  $('reviews').classList.add('show');
  if (q.get('day') === 'today') {
    const info = dayInfo(rs, dayAgo(0));
    renderDay($('reviews'), info, { onBack() {}, onOpen() {}, onHold() {}, onExport() {} }, r => r.t);
    if (q.get('sheet')) {
      const veil = $('exportVeil');
      openExport(veil, { ...info, videos: info.videos.map(v => ({ ...v, thumb: null })) }, { getClip: async () => null });
      veil.querySelectorAll('.li .rv-th').forEach((el, i) => { el.innerHTML = `<img alt="" src="${info.videos.filter(v => v.marks.length || v.retimed)[i].t}">`; });
    }
  } else renderHistory($('reviews'), rs, { onOpenDay() {}, onHoldDay() {}, onSettings() {} }, r => r.t);
}
// Back from Google's sign-in page: take the token, put the address back.
if (G.handleRedirect() && G.ready()) G.account().catch(e => log('google: ' + e.message));

async function sortSample(q) {
  const { view } = await import('./overlay.js');
  const j = async n => (await fetch(`tests/fixtures/phone/${n}.json`)).json();
  const snap = { status: await j('status'), library: await j('library'), folders: await j('folders'), tags: await j('tags'), xqueue: await j('xqueue') };
  for (const [i, p] of snap.xqueue.posts.entries()) p.media = [{ type: 'photo', url: `tests/fixtures/phone/x${i}.jpg`, poster: null }];
  snap.xqueue.posts[0].text = 'Quick blocking pass on a heavy attack. Anticipation is still too long, trimming next.';
  snap.status.written = new Date(Date.now() - 4 * 60e3).toISOString();
  const fake = { init: async () => {}, current: () => view(snap, [], { last: 0, failed: [] }), onChange: () => () => {}, refresh: async () => ({ state: 'ok' }), act: async () => {} };
  setTab('sort'); sortTab = createSort($('sort'), { phone: fake, drive: { configured: () => true }, toast });
  await sortTab.open();
  if (q.get('sheet')) setTimeout(() => $('soKeep').click(), 300);
}

const q = new URLSearchParams(location.search);
if (local && q.get('test') === 'sortsample') sortSample(q);
else if (local && q.get('test') === 'player') testPlayer(q);
else if (local && q.get('test') === 'sample') sample(q);
else {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      // Look for an update each time the app comes back to the front (home-screen apps rarely reload).
      addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(e => log('offline: ' + e.message));
    // When a new version takes over, reload once, unless a review is open (it updates next time instead).
    let had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (had && !/^#\/r\//.test(location.hash)) location.reload();
      had = true;
    });
  }
  route();
}
