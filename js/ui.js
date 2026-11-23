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
export async function openFolderSheet({ title, folders, tags = [], withTags = false, okLabel = 'Keep', current = null }) {
  const recent = ((await S.kvGet('recentFolders')) || []).filter(f => folders.includes(f));
  let chosen = current && folders.includes(current) ? current : (recent[0] ?? null), picked = [];
  $('folderCap').textContent = title; $('folderOk').textContent = okLabel;
  $('folderSearch').value = ''; $('tagIn').value = '';
  $('tagsBox').style.display = withTags ? '' : 'none';
  const depth = f => f.split('/').length - 1, leaf = f => f.split('/').pop();
  const renderFolders = () => {
    const q = $('folderSearch').value.trim().toLowerCase();
    $('recentFolders').innerHTML = q ? '' : recent.map(f => `<button class="chip${f === chosen ? ' on' : ''}" data-f="${esc(f)}">${esc(leaf(f))}</button>`).join('');
    $('recentWrap').style.display = !q && recent.length ? '' : 'none';
    const list = folders.filter(f => !q || f.toLowerCase().includes(q));
    $('folderList').innerHTML = list.map(f => `<div class="fl${f === chosen ? ' on' : ''}" data-f="${esc(f)}" style="padding-left:${12 + (q ? 0 : depth(f) * 16)}px">
        <span>${esc(q ? f : leaf(f))}</span>${f === chosen ? '<span class="ck">✓</span>' : ''}</div>`).join('')
      || '<div style="color:var(--mut);padding:12px">No folder by that name.</div>';
    $('folderOk').disabled = chosen === null;
  };
  const renderTags = () => {
    $('tagChips').innerHTML = picked.map(t => `<button class="chip on" data-rm="${esc(t)}">${esc(t)} ✕</button>`).join('');
    const q = $('tagIn').value.trim().toLowerCase();
    $('tagSugg').innerHTML = tags.map(t => t.tag).filter(t => !picked.includes(t) && (!q || t.toLowerCase().includes(q))).slice(0, 8)
      .map(t => `<button class="chip" data-add="${esc(t)}">${esc(t)}</button>`).join('');
  };
  renderFolders(); renderTags(); show('folderVeil');
  const pickF = e => { const f = e.target.closest('[data-f]'); if (f) { chosen = f.dataset.f; renderFolders(); } };
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
      if ($('tagIn').value.trim()) addTag($('tagIn').value);
      await S.kvSet('recentFolders', [chosen, ...recent.filter(f => f !== chosen)].slice(0, 6));
      close({ folder: chosen, tags: picked });
    };
  });
}
