// Tag: library items with no tags, one at a time. Tap tags (recent first) or make new ones, tap the
// folder pill to move it or make a folder, then Done (or swipe right) for the next. Later puts it at the
// back. Everything goes to Quarry as 'tag' and 'move' actions, sent with Sort's file (Send).
import { esc, openFolderSheet } from './ui.js';
import * as S from './store.js';

const THRESHOLD = 110;
const FOLDER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const today = () => new Date().toISOString().slice(0, 10);
const leaf = f => (f || '').split('/').join(' › ');

export function createTag(root, { phone, toast }) {
  let later = [], recent = [], picked = [], folder = null, shownKey = null, busy = false, startCount = null, doneToday = 0;

  root.innerHTML = `
    <div class="tg-prog"><i id="tgBar"></i></div>
    <div class="tg-top">
      <h1 id="tgCount"></h1><span class="sp"></span><span class="tg-today" id="tgToday"></span>
      <button class="btn pri" id="tgSend" hidden></button>
      <label class="btn" id="tgBring" for="tgPick" hidden>Bring in</label>
      <input type="file" id="tgPick" accept=".json,application/json" multiple hidden>
    </div>
    <div class="tg-deck" id="tgDeck"></div>
    <div class="tg-cap" id="tgCap"><span>ADD TAGS</span><b>Recent first</b></div>
    <div class="tg-chips" id="tgChips"></div>
    <div class="tg-keys" id="tgKeys"><button class="btn" id="tgLater">Later</button><button class="btn pri" id="tgDone">Done ✓</button></div>`;
  const $ = id => root.querySelector('#' + id);

  const isPic = u => !!u && (/^https?:\/\/pbs\.twimg\.com\//.test(u) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u));
  phone.loadThumbNames && phone.loadThumbNames().then(() => render());
  // ---------- what's left: untagged items, Later ones at the back
  function queue() {
    const v = phone.current();
    // ones Quarry sent a picture for come first (it sends pictures for the newest untagged items only)
    const pic = it => phone.hasThumb && (phone.hasThumb(it.thumb) || isPic(it.media_url));
    const all = v.items.filter(it => !it.tags.length), un = [...all.filter(pic), ...all.filter(it => !pic(it))];
    const back = un.filter(it => later.includes(it.key)).sort((a, b) => later.indexOf(a.key) - later.indexOf(b.key));
    return { v, list: [...un.filter(it => !later.includes(it.key)), ...back] };
  }
  const tagList = v => {   // recent first, then the most used; picked ones aren't offered again
    const all = v.tags.map(t => t.tag);
    const seen = new Set(), out = [];
    for (const t of [...recent, ...all]) { const k = t.toLowerCase(); if (seen.has(k) || picked.some(p => p.toLowerCase() === k)) continue; seen.add(k); out.push(t); }
    return out;
  };

  // ---------- render
  function render() {
    if (!root.classList.contains('show')) return;
    const { v, list } = queue();
    const unsent = phone.unsentCount ? phone.unsentCount() : 0;
    $('tgSend').hidden = !unsent; $('tgSend').textContent = `Send ${unsent}`;
    $('tgBring').hidden = !v.status;
    if (startCount === null || list.length > startCount) startCount = list.length;
    $('tgBar').style.width = startCount ? `${Math.round(100 * (1 - list.length / startCount))}%` : '0';
    $('tgCount').innerHTML = `<span>${list.length}</span> untagged`;
    $('tgToday').textContent = doneToday ? `${doneToday} tagged today` : '';
    const msgOnly = on => { for (const id of ['tgCap', 'tgChips', 'tgKeys']) $(id).style.visibility = on ? 'hidden' : ''; };
    if (!v.status) {
      shownKey = null; msgOnly(true); $('tgCount').textContent = 'Tag';
      $('tgDeck').innerHTML = `<div class="so-msg"><h2>Bring in your library</h2><p>In Files, open Quarry Sync › phone and pick “${esc(phone.BUNDLE || 'for phone.json')}”.</p><button class="btn pri" id="tgMsgBtn">Bring in</button></div>`;
      $('tgMsgBtn').onclick = () => $('tgPick').click(); return;
    }
    if (!list.length) {
      shownKey = null; msgOnly(true);
      $('tgDeck').innerHTML = `<div class="so-msg"><h2>All tagged</h2><p>${unsent ? `Send your ${unsent} changes to Quarry: save the file in Quarry Sync › phone › actions.` : 'Nothing in your library is waiting for tags.'}</p>${unsent ? `<button class="btn pri" id="tgMsgBtn">Send ${unsent}</button>` : ''}</div>`;
      if (unsent) $('tgMsgBtn').onclick = sendFile; return;
    }
    msgOnly(false);
    const it = list[0];
    if (shownKey !== it.key) { shownKey = it.key; picked = []; folder = it.folder || null; drawCard(it, list[1]); }
    else paintCard(it);
    paintChips(v);
    $('tgDone').disabled = !picked.length; $('tgDone').textContent = picked.length ? 'Done ✓' : 'Pick a tag';
  }

  // the picture Quarry sent; media_url only when it's a picture itself (usually it's the post's page)
  const isPic2 = isPic;
  const picUrl = async it => (it.thumb && await phone.thumbUrl(it.thumb)) || (isPic2(it.media_url) ? it.media_url : null);
  function drawCard(it, next) {
    $('tgDeck').innerHTML = `${next ? '<div class="tg-ghost"></div>' : ''}
      <div class="tg-card" id="tgCard">
        <img class="tg-pic" alt="">
        <div class="tg-shade"></div>
        <button class="tg-folder" id="tgFolder">${FOLDER_ICON}<span></span> ▾</button>
        <div class="tg-hint">Swipe → done</div>
        <div class="tg-name"></div>
        <div class="tg-on" id="tgOn"></div>
      </div>`;
    const img = $('tgDeck').querySelector('.tg-pic');
    picUrl(it).then(u => { if (u && shownKey === it.key) img.src = u; else if (!u) img.remove(); });
    $('tgDeck').querySelector('.tg-name').textContent = [it.title || it.key.split('/').pop(), it.author ? '@' + it.author : ''].filter(Boolean).join(' · ');
    $('tgFolder').onpointerdown = e => e.stopPropagation();
    $('tgFolder').onclick = pickFolder;
    $('tgOn').onpointerdown = e => e.stopPropagation();
    $('tgOn').onclick = e => { const t = e.target.closest('[data-rm]'); if (t) { picked = picked.filter(p => p !== t.dataset.rm); render(); } };
    wire($('tgCard'));
    paintCard(it);
  }
  function paintCard() {
    $('tgFolder').querySelector('span').textContent = folder ? leaf(folder) : 'No folder';
    $('tgOn').innerHTML = picked.map(t => `<button class="tg-pill" data-rm="${esc(t)}">${esc(t)} <i>×</i></button>`).join('');
  }
  function paintChips(v) {
    $('tgChips').innerHTML = `<button class="tg-chip make" id="tgNew">＋ New tag</button>` +
      tagList(v).map(t => `<button class="tg-chip" data-add="${esc(t)}">${esc(t)}</button>`).join('');
    $('tgNew').onclick = newTag;
  }
  $('tgChips').onclick = e => { const t = e.target.closest('[data-add]'); if (t) addTag(t.dataset.add); };
  function addTag(t) {
    t = t.trim().replace(/\s+/g, ' '); if (!t) return;
    if (!picked.some(p => p.toLowerCase() === t.toLowerCase())) picked.push(t);
    render();
  }
  function newTag() {
    const b = $('tgNew'), inp = document.createElement('input');
    inp.className = 'tg-chip make tg-input'; inp.placeholder = 'New tag'; inp.enterKeyHint = 'done';
    b.replaceWith(inp); inp.focus();
    const commit = () => { const t = inp.value; inp.remove(); if (t.trim()) addTag(t); else render(); };
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } if (e.key === 'Escape') { inp.value = ''; inp.blur(); } };
    inp.onblur = commit;
  }
  async function pickFolder() {
    const v = phone.current();
    const r = await openFolderSheet({ title: 'Move to folder', folders: v.folders, okLabel: 'Move', current: folder, allowNew: true });
    if (r) { folder = r.folder; render(); }
  }

  // ---------- swipe right for Done, left for Later
  function wire(card) {
    let x0 = null, dx = 0;
    card.onpointerdown = e => { if (busy) return; x0 = e.clientX; dx = 0; card.setPointerCapture(e.pointerId); card.style.transition = 'none'; };
    card.onpointermove = e => { if (x0 === null) return; dx = e.clientX - x0; card.style.transform = `translateX(${dx}px) rotate(${dx / 24}deg)`; };
    const end = () => {
      if (x0 === null) return; x0 = null; card.style.transition = '';
      if (dx > THRESHOLD && picked.length) done();
      else if (dx < -THRESHOLD) laterOne();
      else { card.style.transform = ''; if (dx > THRESHOLD) toast('Pick a tag first'); }
    };
    card.onpointerup = end; card.onpointercancel = end;
  }
  function flyOut(dir) {
    const c = $('tgCard'); if (!c) return Promise.resolve();
    c.style.transition = 'transform .22s ease-in, opacity .22s'; c.style.transform = `translateX(${dir * innerWidth * 1.2}px) rotate(${dir * 16}deg)`; c.style.opacity = 0;
    return new Promise(r => setTimeout(r, 200));
  }

  async function done() {
    if (busy || !picked.length) return; busy = true;
    try {
      const { list } = queue(); const it = list[0]; if (!it) return;
      const tags = [...picked], to = folder;
      await flyOut(1);
      await phone.act({ op: 'tag', key: it.key, add: tags, remove: [] });
      if ((to || null) !== (it.folder || null)) await phone.act({ op: 'move', key: it.key, folder: to });
      recent = [...tags, ...recent.filter(r => !tags.some(t => t.toLowerCase() === r.toLowerCase()))].slice(0, 20);
      later = later.filter(k => k !== it.key);
      doneToday++;
      await S.kvSet('tagRecent', recent); await S.kvSet('tagLater', later); await S.kvSet('tagToday', { day: today(), n: doneToday });
    } finally { busy = false; shownKey = null; render(); }
  }
  async function laterOne() {
    if (busy) return; busy = true;
    try {
      const { list } = queue(); const it = list[0]; if (!it) return;
      await flyOut(-1);
      later = [...later.filter(k => k !== it.key), it.key]; await S.kvSet('tagLater', later);
    } finally { busy = false; shownKey = null; render(); }
  }
  $('tgDone').onclick = done;
  $('tgLater').onclick = laterOne;

  // ---------- files in and out (the same file as Sort)
  $('tgPick').onchange = async e => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length) return;
    try { await phone.bringIn(files); startCount = null; shownKey = null; } catch (err) { toast(err.message); }
    render();
  };
  async function sendFile() {
    const out = phone.actionsFile(); if (!out) return;
    if (navigator.canShare && navigator.canShare({ files: [out.file] })) {
      toast('Save to Files › Quarry Sync › phone › actions');
      try { await navigator.share({ files: [out.file] }); await phone.markSent(out); toast('Sent: Quarry carries it out on your PC'); }
      catch (err) { if (err.name !== 'AbortError') toast(err.message); }
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(out.file); a.download = out.file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000); await phone.markSent(out);
    }
    render();
  }
  $('tgSend').onclick = sendFile;

  const off = phone.onChange(render);
  return {
    async open() {
      root.classList.add('show');
      await phone.init(); if (phone.fileReady) await phone.fileReady();
      later = (await S.kvGet('tagLater')) || []; recent = (await S.kvGet('tagRecent')) || [];
      const t = await S.kvGet('tagToday'); doneToday = t && t.day === today() ? t.n : 0;
      shownKey = null; render();
    },
    close() { root.classList.remove('show'); },
    destroy() { off(); },
  };
}
