// The Reviews screen: a grid of saved reviews, newest first, and the one primary key, New review.

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function when(ts, now = Date.now()) {
  const d = new Date(ts), n = new Date(now);
  const same = d.toDateString() === n.toDateString();
  const y = new Date(now - 864e5).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  if (same) return `Today ${time}`;
  if (y) return `Yesterday ${time}`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== n.getFullYear() ? { year: 'numeric' } : {}) });
}

function badges(r) {
  const notes = r.marks.filter(m => m.type === 'note').length, shapes = r.marks.length - notes;
  const out = [];
  if (notes) out.push(`<span class="bd">${notes} note${notes > 1 ? 's' : ''}</span>`);
  if (shapes) out.push(`<span class="bd">${shapes} shape${shapes > 1 ? 's' : ''}</span>`);
  if (r.secs && r.secs.length) out.push('<span class="bd acc">Retimed</span>');
  return out.join('');
}

// handlers: { onNew(), onOpen(id), onHold(id), onSettings() }
export function renderReviews(root, reviews, h, thumbUrl = r => r.thumb ? URL.createObjectURL(r.thumb) : '') {
  root.innerHTML = `
    <header class="rv-head">
      <h1>Reviews</h1>
      <button class="btn rv-gear" id="gear" aria-label="Settings"><svg viewBox="0.5 0.5 23 23" width="28" height="28" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 1 0 0-5.6z"/></svg></button>
    </header>
    <label class="btn pri rv-new" for="file">New review</label>
    ${reviews.length ? `<div class="rv-grid">${reviews.map(r => `
      <button class="rv-card" data-id="${esc(r.id)}">
        <span class="rv-thumb">${r.thumb ? `<img alt="" src="${thumbUrl(r)}">` : ''}</span>
        <span class="rv-name">${esc(r.name)}</span>
        <span class="rv-meta">${when(r.updated)} · ${r.frameCount} fr</span>
        <span class="rv-badges">${badges(r)}</span>
      </button>`).join('')}</div>`
    : `<div class="rv-empty"><p>Open a clip from Files or Photos to start a review. Clips stay on this phone.</p></div>`}`;
  root.querySelector('#gear').onclick = () => h.onSettings();
  for (const card of root.querySelectorAll('.rv-card')) {
    const id = card.dataset.id; let t = 0, held = false;
    card.addEventListener('pointerdown', () => { held = false; t = setTimeout(() => { held = true; h.onHold(id); }, 500); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) card.addEventListener(ev, () => clearTimeout(t));
    card.addEventListener('contextmenu', e => e.preventDefault());
    card.addEventListener('click', () => { if (!held) h.onOpen(id); });
  }
}
