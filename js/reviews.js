// Review history (like Quarry's review panel) and one review (a day's videos).
// History: this week's reviews as raised cards, older ones as rows under their month, newest first.
import { groupHistory } from './days.js';
import { hasNotes, isRetimed } from './handback.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = d => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const ICONS = {
  back: icon('<path d="M15 5l-7 7 7 7"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  chev: icon('<path d="M9 6l6 6-6 6"/>'),
  share: icon('<path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>'),
  video: icon('<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M10 9.5l4.5 2.5-4.5 2.5z"/>'),
  notes: icon('<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h5"/>'),
  maya: icon('<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>'),
  warp: icon('<path d="M3 20C9 20 9 4 15 4h6"/><circle cx="3" cy="20" r="1.5"/><circle cx="21" cy="4" r="1.5"/>'),
};
const GEAR = '<svg viewBox="0.5 0.5 23 23" width="28" height="28" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 1 0 0-5.6z"/></svg>';

const notesBadge = (n, label = '') => n ? `<span class="bd acc"><i class="d"></i>${n}${label}</span>` : '';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// A tap, or a long press (half a second) for the item's sheet.
function pressable(el, onTap, onHold) {
  let t = 0, held = false;
  el.addEventListener('pointerdown', () => { held = false; t = setTimeout(() => { held = true; onHold(); }, 500); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => clearTimeout(t));
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('click', () => { if (!held) onTap(); });
}

// handlers: { onOpenDay(day), onHoldDay(day), onSettings() }. The New review key is a label for the file picker.
export function renderHistory(root, videos, h, thumbUrl, now = Date.now()) {
  const { week, months } = groupHistory(videos, now);
  const th = v => `<span class="rv-th">${v.thumb ? `<img alt="" src="${thumbUrl(v)}">` : ''}</span>`;
  root.innerHTML = `
    <header class="rv-head"><h1>Reviews</h1><button class="btn rv-gear" id="gear" aria-label="Settings">${GEAR}</button></header>
    <div class="acts"><label class="btn pri" id="newReview" for="file">${ICONS.plus}New review</label></div>
    ${!videos.length ? `<div class="rv-empty"><p>Pick videos from Photos or Files to start today's review. Videos stay on this phone.</p></div>` : ''}
    ${week.length ? `<div class="rv-cap">This week</div>${week.map(d => `
      <button class="rv-card rv-day" data-day="${d.day}">
        <span class="rv-th3">${d.videos.slice(0, 3).map(th).join('')}</span>
        <span class="rv-name">${d.title}${d.today ? ' <span class="bd acc">TODAY</span>' : ''}</span>
        <span class="rv-meta">${plural(d.count, 'video')} ${notesBadge(d.withNotes, ' with notes')}</span>
      </button>`).join('')}` : ''}
    ${months.map(m => `<div class="rv-cap">${m.label}</div><div class="list rv-list">${m.days.map(d => `
      <div class="li rv-dayrow" data-day="${d.day}" role="button">
        <span class="wd">${d.weekday}</span>
        <span class="tx"><span class="nm">${d.date}</span><span class="mt">Week ${d.week} · ${plural(d.count, 'video')} ${notesBadge(d.withNotes)}</span></span>
        <span class="chev">${ICONS.chev}</span>
      </div>`).join('')}</div>`).join('')}`;
  root.querySelector('#gear').onclick = () => h.onSettings();
  for (const el of root.querySelectorAll('[data-day]')) pressable(el, () => h.onOpenDay(el.dataset.day), () => h.onHoldDay(el.dataset.day));
}

function badges(v) {
  const notes = v.marks.filter(m => m.type === 'note').length, drawn = v.marks.length - notes;
  return [notesBadge(notes, notes === 1 ? ' note' : ' notes'), drawn ? `<span class="bd">${plural(drawn, 'drawing')}</span>` : '',
    isRetimed(v) ? '<span class="bd">Retimed</span>' : ''].join('');
}

// info: dayInfo(); handlers: { onBack(), onOpen(id), onHold(id), onExport() }. Add videos is a label for the picker.
export function renderDay(root, info, h, thumbUrl) {
  root.innerHTML = `
    <header class="rv-head"><button class="btn key" id="dayBack" aria-label="Back">${ICONS.back}</button><h1>${info.title}</h1></header>
    <div class="acts"><label class="btn" id="addVideos" for="file">${ICONS.plus}Add videos</label>
      <button class="btn pri" id="exportNotes"${info.count ? '' : ' disabled'}>${ICONS.share}Export notes</button></div>
    <div class="rv-cap">${plural(info.count, 'video')}${info.withNotes ? ` · ${info.withNotes} with notes` : ''}</div>
    ${info.count ? `<div class="list rv-list">${info.videos.map(v => `
      <div class="li rv-clip" data-id="${esc(v.id)}" role="button">
        <span class="rv-th">${v.thumb ? `<img alt="" src="${thumbUrl(v)}">` : ''}</span>
        <span class="tx"><span class="nm rv-name">${esc(v.name)}</span><span class="mt">${v.frameCount} fr ${badges(v)}</span></span>
      </div>`).join('')}</div>`
    : `<div class="rv-empty"><p>No videos in this review yet. Add some from Photos or Files.</p></div>`}`;
  root.querySelector('#dayBack').onclick = () => h.onBack();
  root.querySelector('#exportNotes').onclick = () => h.onExport();
  for (const el of root.querySelectorAll('.rv-clip')) pressable(el, () => h.onOpen(el.dataset.id), () => h.onHold(el.dataset.id));
}

export { hasNotes };
