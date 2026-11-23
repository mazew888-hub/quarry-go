// Library: your Quarry library as of the PC's last sync. Search, filter by folder or tag,
// open an item to change its tags or move it, or step through the untagged ones.
import { esc, statusLine, openFolderSheet } from './ui.js';

const PAGE = 120;
// Replaces an element's content only when it actually changed (keeps a tap landing on the same button).
const setHtml = (el, html) => { if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; } };

export function createLibrary(root, { phone, drive, toast }) {
  let state = 'ok', folder = null, tag = null, list = [], shown = 0, io = null, lastSig = '';
  root.innerHTML = `
    <header class="rv-head"><h1>Library</h1></header>
    <input id="libSearch" class="lib-search" type="search" placeholder="Search titles, tags, people" autocomplete="off" autocapitalize="off" spellcheck="false">
    <div class="lib-chips">
      <button class="chip" id="libAll">All</button>
      <button class="chip" id="libUntagged">Untagged</button>
      <button class="chip" id="libFolder">Folder</button>
      <button class="chip" id="libTag">Tag</button>
    </div>
    <div class="lib-meta"><span id="libCount"></span><span class="sp"></span><span class="so-status" id="libStatus"></span></div>
    <div id="libMsg"></div>
    <div class="lib-grid" id="libGrid"></div>
    <div id="libMore" style="height:1px"></div>`;
  const $ = id => root.querySelector('#' + id), D = id => document.getElementById(id);

  const matches = (it, q) => !q || (it.title || '').toLowerCase().includes(q) || (it.author || '').toLowerCase().includes(q)
    || it.tags.some(t => t.toLowerCase().includes(q));
  function filtered(v) {
    const q = $('libSearch').value.trim().toLowerCase();
    return v.items.filter(it => (folder === null || it.folder === folder || it.folder.startsWith(folder + '/'))
      && (tag === null || it.tags.some(t => t.toLowerCase() === tag.toLowerCase())) && matches(it, q));
  }

  function render() {
    const v = phone.current();
    statusLine($('libStatus'), v, phone);
    const untagged = v.items.filter(it => !it.tags.length).length;
    $('libUntagged').textContent = `Untagged ${untagged}`;
    $('libFolder').textContent = folder === null ? 'Folder' : folder.split('/').pop();
    $('libTag').textContent = tag === null ? 'Tag' : '#' + tag;
    $('libFolder').classList.toggle('on', folder !== null); $('libTag').classList.toggle('on', tag !== null);
    $('libAll').classList.toggle('on', folder === null && tag === null);
    let msg = '';
    if (!v.items.length) {
      if (state === 'notsetup') msg = ['Google sign-in isn’t set up yet', 'Library needs a Google sign-in for Quarry Go first.'];
      else if (state === 'signedout') msg = ['Connect Google Drive', 'Library shows your Quarry library through your Quarry Sync folder.', true];
      else if (state === 'nofolder') msg = ['Nothing from Quarry yet', 'Quarry hasn’t made the phone folder yet. Open Quarry on your PC and sync.'];
    }
    $('libMsg').innerHTML = msg ? `<div class="rv-empty"><p><b>${esc(msg[0])}</b><br>${esc(msg[1])}</p>${msg[2] ? '<button class="btn pri" id="libConnect" style="margin-top:14px">Connect Google Drive</button>' : ''}</div>` : '';
    if (msg && msg[2]) $('libConnect').onclick = () => { try { drive.signIn(); } catch (e) { toast(e.message); } };
    list = filtered(v);
    $('libCount').textContent = v.items.length ? `${list.length.toLocaleString('en-US')} items` : '';
    // Only rebuild the grid when what it shows changed, so a background refresh never swaps tiles under a finger.
    const sig = list.length + ':' + list.slice(0, 400).map(it => it.key + '|' + it.thumb).join(',');
    if (sig !== lastSig) { lastSig = sig; $('libGrid').innerHTML = ''; shown = 0; more(); }
    if (sheet.key) sheet.render();
  }

  function more() {
    const frag = document.createDocumentFragment();
    for (const it of list.slice(shown, shown + PAGE)) {
      const b = document.createElement('button'); b.className = 'lib-tile'; b.dataset.key = it.key;
      b.innerHTML = `<img alt="">${it.kind === 'video' || it.kind === 'gif' ? `<span class="lib-kind">${it.kind === 'gif' ? 'GIF' : '▶'}</span>` : ''}`;
      const img = b.firstChild;
      phone.thumbUrl(it.thumb).then(u => { if (u) img.src = u; });
      frag.append(b);
    }
    shown += PAGE; $('libGrid').append(frag);
  }
  io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && shown < list.length) more(); }, { root, rootMargin: '600px' });
  io.observe($('libMore'));

  $('libSearch').oninput = render;
  $('libAll').onclick = () => { folder = tag = null; render(); };
  $('libFolder').onclick = async () => {
    const v = phone.current();
    const r = await openFolderSheet({ title: 'Show folder', folders: v.folders, okLabel: 'Show', current: folder });
    if (r) { folder = r.folder; render(); }
  };
  $('libTag').onclick = async () => {
    const v = phone.current();
    const r = await openFolderSheet({ title: 'Show tag', folders: v.tags.map(t => t.tag), okLabel: 'Show', current: tag });
    if (r) { tag = r.folder; render(); }
  };
  $('libGrid').onclick = e => { const t = e.target.closest('.lib-tile'); if (t) sheet.open(t.dataset.key, null); };
  $('libUntagged').onclick = () => {
    const q = phone.current().items.filter(it => !it.tags.length).map(it => it.key);
    if (q.length) sheet.open(q[0], q); else toast('Everything has a tag.');
  };

  // ---------- the item sheet
  const sheet = {
    key: null, queue: null,
    open(key, queue) { this.key = key; this.queue = queue; D('itemTagIn').value = ''; D('itemVeil').style.display = 'flex'; this.render(); },
    close() { this.key = null; this.queue = null; D('itemVeil').style.display = 'none'; const p = D('itemPreview').querySelector('video'); if (p) p.pause(); },
    item() { return phone.current().items.find(it => it.key === this.key); },
    async render() {
      const it = this.item(); if (!it) return this.close();
      D('itemTitle').textContent = it.title || it.key.split('/').pop();
      D('itemAuthor').textContent = [it.author && '@' + it.author, it.source].filter(Boolean).join(' · ');
      D('itemFolder').textContent = it.folder || 'Top of the library';
      setHtml(D('itemTags'), it.tags.map(t => `<button class="chip on" data-rm="${esc(t)}">${esc(t)} ✕</button>`).join('') || '<span style="color:var(--faint)">No tags yet</span>');
      const q = D('itemTagIn').value.trim().toLowerCase();
      setHtml(D('itemSugg'), phone.current().tags.map(t => t.tag)
        .filter(t => !it.tags.some(x => x.toLowerCase() === t.toLowerCase()) && (!q || t.toLowerCase().includes(q))).slice(0, 8)
        .map(t => `<button class="chip" data-add="${esc(t)}">${esc(t)}</button>`).join(''));
      D('itemNext').style.display = this.queue ? '' : 'none';
      if (this.queue) {
        const left = phone.current().items.filter(x => !x.tags.length).length;
        D('itemNext').textContent = left ? 'Next' : 'Done';
      }
      if (D('itemPreview').dataset.key !== it.key) {
        D('itemPreview').dataset.key = it.key;
        const web = it.media_url && /^https?:/.test(it.media_url);
        D('itemPreview').innerHTML = web && (it.kind === 'video' || it.kind === 'gif')
          ? `<video src="${esc(it.media_url)}" muted loop playsinline autoplay></video>`
          : `<img alt="" src="${web && it.kind === 'image' ? esc(it.media_url) : ''}">`;
        const img = D('itemPreview').querySelector('img');
        if (img && !img.getAttribute('src')) phone.thumbUrl(it.thumb).then(u => { if (u && this.key === it.key) img.src = u; });
      }
    },
    async tag(add, remove) { const it = this.item(); if (!it) return; await phone.act({ op: 'tag', key: it.key, add, remove }); },
  };
  D('itemTags').onclick = e => { const t = e.target.closest('[data-rm]'); if (t) sheet.tag([], [t.dataset.rm]); };
  D('itemSugg').onclick = e => { const t = e.target.closest('[data-add]'); if (t) { D('itemTagIn').value = ''; sheet.tag([t.dataset.add], []); } };
  D('itemTagIn').oninput = () => sheet.render();
  D('itemTagIn').onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault(); const t = D('itemTagIn').value.trim(); D('itemTagIn').value = '';
    if (t) sheet.tag([t], []);
  };
  D('itemMove').onclick = async () => {
    const it = sheet.item(); if (!it) return;
    const r = await openFolderSheet({ title: 'Move to folder', folders: phone.current().folders, okLabel: 'Move', current: it.folder });
    if (!r || r.folder === it.folder) return;
    const name = it.key.split('/').pop(), from = it.key;
    sheet.key = (r.folder ? r.folder + '/' : '') + name;   // follow the item to its new key before the view changes
    await phone.act({ op: 'move', key: from, folder: r.folder });
    sheet.render();
  };
  D('itemNext').onclick = () => {
    const rest = phone.current().items.filter(x => !x.tags.length && x.key !== sheet.key).map(x => x.key);
    const left = rest.filter(k => sheet.queue.includes(k));
    if (left.length) sheet.open(left[0], sheet.queue); else sheet.close();
  };
  D('itemClose').onclick = () => sheet.close();
  D('itemVeil').onclick = e => { if (e.target === D('itemVeil')) sheet.close(); };

  const off = phone.onChange(render);
  return {
    async open() {
      root.classList.add('show'); render();
      const r = await phone.refresh();
      state = !drive.configured() ? 'notsetup' : r.state;
      if (r.state === 'offline' && r.message) toast(r.message);
      render();
    },
    close() { root.classList.remove('show'); sheet.close(); },
    destroy() { off(); io.disconnect(); },
  };
}
