// Pieces shared by Sort and Library: the folder sheet, the status line, the failed-actions sheet.
import * as S from './store.js';

const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const show = id => { $(id).style.display = 'flex'; };
const hide = id => { $(id).style.display = 'none'; };

export function ago(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// "Quarry synced 3 min ago · 2 waiting · 1 failed" (the failed part opens the failed sheet)
export function statusLine(el, v, phone, { signedOut = false, connect = null } = {}) {
  const parts = [`Quarry synced ${ago(v.status && v.status.written)}`];
  if (v.pending) parts.push(`${v.pending} waiting`);
  const html = esc(parts.join(' · ')) + (v.failed.length ? ` · <button class="st-failed">${v.failed.length} failed</button>` : '')
    + (signedOut && connect ? ' · <button class="st-connect">Connect to send</button>' : '');
  if (el.dataset.h === html) return;
  el.innerHTML = html; el.dataset.h = html;
  const b = el.querySelector('.st-failed'); if (b) b.onclick = () => failedSheet(phone);
  const c = el.querySelector('.st-connect'); if (c) c.onclick = connect;
}

export function failedSheet(phone) {
  const render = () => {
    const v = phone.current();
    if (!v.failed.length) { hide('failedVeil'); return; }
    $('failedList').innerHTML = v.failed.map(f => `
      <div class="note"><span class="t"><b>${esc(label(f.action))}</b><br><span style="color:var(--mut)">${esc(f.reason)}</span></span>
        <button class="btn" data-retry="${f.n}">Retry</button><button class="btn" data-drop="${f.n}">Drop</button></div>`).join('');
  };
  $('failedList').onclick = async e => {
    const r = e.target.dataset.retry, d = e.target.dataset.drop;
    if (r) await phone.retry(+r); if (d) await phone.drop(+d); render();
  };
  render(); show('failedVeil');
}
const label = a => a.op === 'keep' ? `Keep post by @${a.post ? a.post.author : a.id}` : a.op === 'skip' ? 'Skip post' :
  a.op === 'undo' ? 'Undo' : a.op === 'tag' ? `Tags on ${a.key.split('/').pop()}` : `Move ${a.key.split('/').pop()} to ${a.folder || 'top'}`;

// The folder sheet: recent folders first, a search, the full list; with tags when asked.
// Resolves {folder, tags} or null when cancelled.
export async function openFolderSheet({ title, folders, tags = [], withTags = false, okLabel = 'Keep', current = null, allowNew = false }) {
  // Folders made here (Keep): kept on the phone until Quarry's next file lists them; Quarry makes them on Keep.
  if (allowNew) folders = [...new Set([...folders, ...((await S.kvGet('newFolders')) || [])])].sort((a, b) => a.localeCompare(b));
  const recent = ((await S.kvGet('recentFolders')) || []).filter(f => folders.includes(f));
  let chosen = current && folders.includes(current) ? current : (recent[0] ?? null), picked = [];
  $('folderCap').textContent = title; $('folderOk').textContent = okLabel;
  $('folderSearch').value = ''; $('tagIn').value = '';
  $('folderSearch').placeholder = allowNew ? 'Search or name a new folder' : 'Search folders';
  $('tagsBox').style.display = withTags ? '' : 'none';
  const depth = f => f.split('/').length - 1, leaf = f => f.split('/').pop();
  const renderFolders = () => {
    const q = $('folderSearch').value.trim().toLowerCase();
    $('recentFolders').innerHTML = q ? '' : recent.map(f => `<button class="chip${f === chosen ? ' on' : ''}" data-f="${esc(f)}">${esc(leaf(f))}</button>`).join('');
    $('recentWrap').style.display = !q && recent.length ? '' : 'none';
    const list = folders.filter(f => !q || f.toLowerCase().includes(q));
    const typed = $('folderSearch').value.trim().replace(/\s*\/\s*/g, '/').replace(/^\/+|\/+$/g, '');
    const make = allowNew && typed && !folders.some(f => f.toLowerCase() === typed.toLowerCase())
      ? `<div class="fl new" data-new="${esc(typed)}"><span>+ New folder “${esc(typed)}”</span></div>` : '';
    $('folderList').innerHTML = make + list.map(f => `<div class="fl${f === chosen ? ' on' : ''}" data-f="${esc(f)}" style="padding-left:${12 + (q ? 0 : depth(f) * 16)}px">
        <span>${esc(q ? f : leaf(f))}</span>${f === chosen ? '<span class="ck">✓</span>' : ''}</div>`).join('')
      || (make ? '' : '<div style="color:var(--mut);padding:12px">No folder by that name.</div>');
    $('folderOk').disabled = chosen === null;
    $('folderOk').textContent = chosen === null ? 'Pick a folder' : okLabel;
  };
  const renderTags = () => {
    $('tagChips').innerHTML = picked.map(t => `<button class="chip on" data-rm="${esc(t)}">${esc(t)} ✕</button>`).join('');
    const q = $('tagIn').value.trim().toLowerCase();
    $('tagSugg').innerHTML = tags.map(t => t.tag).filter(t => !picked.includes(t) && (!q || t.toLowerCase().includes(q))).slice(0, 8)
      .map(t => `<button class="chip" data-add="${esc(t)}">${esc(t)}</button>`).join('');
  };
  renderFolders(); renderTags(); show('folderVeil');
  const pickF = async e => {
    const n = e.target.closest('[data-new]');
    if (n) {
      const f = n.dataset.new; folders = [...folders, f].sort((a, b) => a.localeCompare(b));
      chosen = f; $('folderSearch').value = ''; renderFolders();
      await S.kvSet('newFolders', [...new Set([...((await S.kvGet('newFolders')) || []), f])]); return;
    }
    const f = e.target.closest('[data-f]'); if (f) { chosen = f.dataset.f; renderFolders(); }
  };
  $('folderList').onclick = pickF; $('recentFolders').onclick = pickF;
  $('folderSearch').oninput = renderFolders;
  $('tagIn').oninput = renderTags;
  const addTag = t => { t = t.trim(); if (t && !picked.some(p => p.toLowerCase() === t.toLowerCase())) picked.push(t); $('tagIn').value = ''; renderTags(); };
  $('tagIn').onkeydown = e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag($('tagIn').value); } };
  $('tagSugg').onclick = e => { const t = e.target.dataset.add; if (t) addTag(t); };
  $('tagChips').onclick = e => { const t = e.target.dataset.rm; if (t) { picked = picked.filter(p => p !== t); renderTags(); } };
  return new Promise(res => {
    const close = v => { hide('folderVeil'); res(v); };
    $('folderNo').onclick = () => close(null);
    $('folderVeil').onclick = e => { if (e.target === $('folderVeil')) close(null); };
    $('folderOk').onclick = async () => {
      if (chosen === null) return;
      if (withTags && $('tagIn').value.trim()) addTag($('tagIn').value);
      await S.kvSet('recentFolders', [chosen, ...recent.filter(f => f !== chosen)].slice(0, 6));
      close({ folder: chosen, tags: picked });
    };
  });
}

export const REFRESH_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';

// Pull down from the top to refresh (iPhone style): a little pill shows "Pull to refresh" / "Release" / "Checking…".
export function pullToRefresh(el, scroller, run) {
  let y0 = null, dy = 0, busy = false;
  const pill = document.createElement('div'); pill.className = 'ptr'; document.body.append(pill);
  const show = (t, o) => { pill.textContent = t; pill.style.opacity = o; pill.style.transform = `translate(-50%, ${Math.min(60, dy / 2)}px)`; };
  el.addEventListener('touchstart', e => {
    if (busy || e.touches.length !== 1 || (scroller && scroller.scrollTop > 0) || e.target.closest('.veil')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (y0 === null) return; dy = e.touches[0].clientY - y0;
    if (dy > 10) show(dy > 80 ? 'Release to refresh' : 'Pull to refresh', Math.min(1, dy / 80));
  }, { passive: true });
  el.addEventListener('touchend', async () => {
    if (y0 === null) return; y0 = null;
    if (dy > 80) { busy = true; show('Checking…', 1); try { await run(); } finally { busy = false; } }
    dy = 0; pill.style.opacity = 0;
  });
}
