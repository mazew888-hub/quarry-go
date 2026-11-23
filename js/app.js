// Quarry Go: boot, routing (#/ is Reviews, #/r/<id> is the player), saving and settings.
import { loadFrames, CANT_OPEN } from './frames.js';
import { openPlayer, log, status } from './player.js';
import { renderReviews } from './reviews.js';
import * as S from './store.js';

export const VERSION = '0.1.1';
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

// ---------- Reviews
let player = null, pending = null; // pending: {id, media} just made, so it opens without decoding again
let openSeq = 0;                     // only the newest open request may show its review
const dropPending = () => { if (pending) { pending.media.cancel(); pending = null; } };
const save = () => S.flush().catch(e => toast(e.message));
let thumbUrls = [];
async function showReviews() {
  openSeq++;
  if (player) { player.close(); player = null; }
  dropPending(); $('reviews').classList.remove('busy');
  hide('missing');
  await save();
  const list = await S.listReviews();
  for (const u of thumbUrls) URL.revokeObjectURL(u); thumbUrls = [];
  renderReviews($('reviews'), list, {
    onOpen: id => { location.hash = `#/r/${id}`; },
    onHold: id => cardSheet(list.find(r => r.id === id)),
    onSettings: settings,
  }, r => { const u = URL.createObjectURL(r.thumb); thumbUrls.push(u); return u; });
  $('reviews').classList.add('show');
  fileMode = { kind: 'new' };
}

function cardSheet(r) {
  $('renameIn').value = r.name; show('cardVeil');
  $('renameOk').onclick = async () => {
    const name = $('renameIn').value.trim(); hide('cardVeil');
    if (name && name !== r.name) { S.saveReview(r.id, { name }); await S.flush(); showReviews(); }
  };
  $('deleteOne').onclick = async () => {
    hide('cardVeil');
    if (await confirmSheet(`Delete "${r.name}"?`)) { await S.deleteReview(r.id); showReviews(); }
  };
}

async function settings() {
  const [{ bytes }, list] = await Promise.all([S.usage(), S.listReviews()]);
  $('spaceUsed').textContent = `${(bytes / 1e6).toFixed(1)} MB · ${list.length} review${list.length === 1 ? '' : 's'}`;
  $('version').textContent = VERSION;
  show('settingsVeil');
  $('deleteAll').onclick = async () => {
    hide('settingsVeil');
    if (await confirmSheet('Delete all reviews?')) { await S.deleteAll(); showReviews(); }
  };
}

// ---------- opening clips
let fileMode = { kind: 'new' };
const baseName = f => (f.name || 'Clip').replace(/\.[^.]+$/, '') || 'Clip';

async function firstFrame(media) {
  for (let i = 0; i < 200 && !media.frames[0]; i++) await new Promise(r => setTimeout(r, 50));
  return media.frames[0];
}
async function thumbOf(bmp) {
  const c = document.createElement('canvas'); c.width = 320; c.height = Math.round(320 * bmp.height / bmp.width);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
}
async function open(file) {
  // Everything is checked before anything is saved: a clip that can't be read leaves no review behind.
  status('Opening…', 0);
  try {
    const media = await loadFrames(file, { log });
    const f0 = await firstFrame(media);
    if (!f0) { media.cancel(); throw new Error(CANT_OPEN); }
    return { media, thumb: await thumbOf(f0) };
  } finally { status(''); }
}

$('file').onchange = async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  const mode = fileMode;
  let got;
  try { got = await open(file); } catch (err) { toast(err.message); return; }
  const { media, thumb } = got;
  try {
    if (mode.kind === 'repick') {
      await S.putClip(mode.id, file); S.saveReview(mode.id, { clipType: file.type, thumb }); await S.flush();
      dropPending(); pending = { id: mode.id, media }; hide('missing'); openReview(mode.id);
      return;
    }
    const r = await S.createReview({ name: baseName(file), fps: media.fps, frameCount: media.count, width: media.W, height: media.H, thumb }, file);
    dropPending(); pending = { id: r.id, media }; location.hash = `#/r/${r.id}`;
  } catch (err) { media.cancel(); toast(err.message); }
};

async function openReview(id) {
  const my = ++openSeq, stale = () => my !== openSeq;
  $('reviews').classList.add('busy'); // no second tap while this one opens
  const review = await S.getReview(id);
  if (stale()) return;
  if (!review) { location.hash = '#/'; return; }
  let media = null;
  if (pending && pending.id === id) { media = pending.media; pending = null; } else dropPending();
  if (!media) {
    const clip = await S.getClip(id);
    if (stale()) return;
    if (!clip) { $('reviews').classList.remove('busy'); fileMode = { kind: 'repick', id }; $('reviews').classList.add('show'); show('missing'); return; }
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
    onBack: () => { location.hash = '#/'; },
  });
}
$('missingBack').onclick = () => { location.hash = '#/'; showReviews(); };

// ---------- routing and lifecycle
function route() {
  const m = location.hash.match(/^#\/r\/(.+)$/);
  if (m) openReview(decodeURIComponent(m[1])); else showReviews();
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
    openPlayer($('player'), { media, name: name.replace(/\.[^.]+$/, ''), onChange: p => window.changes.push(p), onBack: () => {} });
  } catch (e) { toast(e.message); }
}
function sample() {
  const thumb = (a, b) => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 320, 180); g.addColorStop(0, a); g.addColorStop(1, b); x.fillStyle = g; x.fillRect(0, 0, 320, 180);
    x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.arc(150, 95, 26, 0, 7); x.fill(); x.fillRect(146, 118, 8, 40); return c.toDataURL(); };
  const now = Date.now();
  const rs = [
    { id: '1', name: 'Grunt_attack_combo_v3', updated: now - 6e5, frameCount: 96, marks: [{ type: 'note' }, { type: 'note' }, { type: 'note' }, { type: 'arrow' }], secs: [{}], thumb: 1, t: thumb('#4A7590', '#1D2024') },
    { id: '2', name: 'Brute_hitreact_heavy', updated: now - 864e5 * 1.2, frameCount: 58, marks: [{ type: 'circle' }, { type: 'box' }], secs: [], thumb: 1, t: thumb('#8a6f5a', '#282C31') },
    { id: '3', name: 'Archer_dodge_back', updated: now - 864e5 * 3, frameCount: 41, marks: [], secs: [], thumb: 1, t: thumb('#5a7a64', '#212429') },
  ];
  $('reviews').classList.add('show');
  renderReviews($('reviews'), rs, { onOpen() {}, onHold() {}, onSettings() {} }, r => r.t);
}

const q = new URLSearchParams(location.search);
if (local && q.get('test') === 'player') testPlayer(q);
else if (local && q.get('test') === 'sample') sample();
else {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => log('offline: ' + e.message));
  route();
}
