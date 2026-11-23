// Sort: your X likes and reposts one at a time. Swipe right (or Keep) to keep, left (or Skip) to skip.
import { esc, statusLine, openFolderSheet, ago, pullToRefresh, REFRESH_ICON } from './ui.js';

const THRESHOLD = 120; // px of swipe that counts as a decision

export function createSort(root, { phone, drive, toast }) {
  const history = [];   // this session's decisions, for Undo: {id, post}
  let busy = false, state = 'loading', mediaIx = 0, shownId = null, stageKey = '', dragging = false;
  const connect = () => { try { drive.signIn(); } catch (e) { toast(e.message); } };

  root.innerHTML = `
    <div class="so-top">
      <div><div class="so-count" id="soCount"></div><div class="so-status" id="soStatus"></div></div><span class="sp"></span>
      <button class="btn" id="soRefresh" aria-label="Refresh">${REFRESH_ICON}</button>
      <button class="btn" id="soUndo" aria-label="Undo">↶ Undo</button>
    </div>
    <div class="so-stage" id="soStage"></div>
    <div class="so-info" id="soInfo"></div>
    <div class="so-keys" id="soKeys">
      <button class="btn so-skip" id="soSkip">Skip</button>
      <button class="btn pri so-keep" id="soKeep">Keep</button>
    </div>`;
  const $ = id => root.querySelector('#' + id);

  function media(post, big) {
    const m = post.media || [], one = m[Math.min(mediaIx, m.length - 1)] || null;
    if (!one) return '<div class="so-nomedia">No picture</div>';
    const dots = m.length > 1 ? `<div class="so-dots">${m.map((_, i) => `<i class="${i === mediaIx ? 'on' : ''}"></i>`).join('')}</div>` : '';
    if (one.type === 'photo') return `<img class="so-media" alt="" src="${esc(one.url)}">${dots}`;
    return `<video class="so-media" src="${esc(one.url)}" ${one.poster ? `poster="${esc(one.poster)}"` : ''} muted loop playsinline ${big ? 'autoplay' : ''} preload="metadata"></video>${dots}`;
  }

  function message(title, body, button) {
    const k = 'msg:' + title; if (stageKey === k) return; stageKey = k;
    $('soStage').innerHTML = `<div class="so-msg"><h2>${esc(title)}</h2><p>${esc(body)}</p>${button ? `<button class="btn pri" id="soMsgBtn">${esc(button.label)}</button>` : ''}</div>`;
    if (button) $('soMsgBtn').onclick = button.run;
    $('soInfo').innerHTML = ''; $('soKeys').style.visibility = 'hidden';
  }

  function render() {
    if (!root.classList.contains('show')) return;
    const v = phone.current(), q = v.queue;
    $('soCount').textContent = q.length ? `${q.length} to sort` : '';
    $('soUndo').style.visibility = history.length ? 'visible' : 'hidden';
    statusLine($('soStatus'), v, phone, { signedOut: state === 'signedout', connect });
    if (state === 'notsetup') return message('Google sign-in isn’t set up yet', 'Sort needs a Google sign-in for Quarry Go first.');
    if (state === 'signedout' && !v.status) return message('Connect Google Drive', 'Sort reads the X likes Quarry finds on your PC, through your Quarry Sync folder.', { label: 'Connect Google Drive', run: connect });
    if (state === 'loading' && !v.status) return message('Loading…', 'Checking your Quarry Sync folder.');
    if (state === 'nofolder') return message('Nothing from Quarry yet', 'Quarry hasn’t made the phone folder yet. Open Quarry on your PC and sync.');
    if (!q.length) return message('All sorted', `Quarry last looked for new likes ${ago(v.status && v.status.x_checked)}.`);
    const post = q[0], next = q[1];
    if (post.id !== shownId) { mediaIx = 0; shownId = post.id; }
    // A background refresh mustn't rebuild the card under a finger or restart its video.
    const k = `${post.id}|${next ? next.id : ''}|${mediaIx}`;
    if (k === stageKey || dragging) return;
    stageKey = k;
    $('soKeys').style.visibility = 'visible';
    $('soStage').innerHTML = (next ? `<div class="so-card under">${media(next, false)}</div>` : '') + `<div class="so-card top" id="soCard">${media(post, true)}
        <div class="so-stamp keep">KEEP</div><div class="so-stamp skip">SKIP</div></div>`;
    $('soInfo').innerHTML = `<div class="so-author"><b>${esc(post.author_name || post.author)}</b> <span>@${esc(post.author)}</span></div>
      <div class="so-text">${esc(post.text || '')}</div>`;
    wire($('soCard'), post);
  }

  function wire(card, post) {
    let x0 = null, dx = 0, moved = false;
    card.onpointerdown = e => { if (busy) return; dragging = true; x0 = e.clientX; dx = 0; moved = false; card.setPointerCapture(e.pointerId); card.style.transition = 'none'; };
    card.onpointermove = e => {
      if (x0 === null) return; dx = e.clientX - x0; if (Math.abs(dx) > 6) moved = true;
      card.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
      card.querySelector('.keep').style.opacity = Math.max(0, Math.min(1, dx / THRESHOLD));
      card.querySelector('.skip').style.opacity = Math.max(0, Math.min(1, -dx / THRESHOLD));
    };
    const end = () => {
      if (x0 === null) return; x0 = null; dragging = false; card.style.transition = '';
      if (dx > THRESHOLD) keep(post);
      else if (dx < -THRESHOLD) skip(post);
      else { card.style.transform = ''; for (const s of card.querySelectorAll('.so-stamp')) s.style.opacity = 0;
        if (!moved && (post.media || []).length > 1) { mediaIx = (mediaIx + 1) % post.media.length; render(); } }
      render();
    };
    card.onpointerup = end; card.onpointercancel = end;
  }

  function flyOut(dir) {
    const c = $('soCard'); if (!c) return Promise.resolve();
    c.style.transition = 'transform .22s ease-in, opacity .22s'; c.style.transform = `translateX(${dir * innerWidth * 1.2}px) rotate(${dir * 18}deg)`; c.style.opacity = 0;
    return new Promise(r => setTimeout(r, 200));
  }
  function snapBack() { const c = $('soCard'); if (c) { c.style.transform = ''; for (const s of c.querySelectorAll('.so-stamp')) s.style.opacity = 0; } }

  async function keep(post) {
    if (busy) return; busy = true;
    try {
      const v = phone.current();
      const pick = await openFolderSheet({ title: 'Keep in folder', folders: v.folders, tags: v.tags, withTags: true });
      if (!pick) { snapBack(); return; }
      stageKey = '';
      await flyOut(1);
      await phone.act({ op: 'keep', id: post.id, folder: pick.folder, tags: pick.tags, post });
      history.push(post);
    } finally { busy = false; render(); }
  }
  async function skip(post) {
    if (busy) return; busy = true;
    try { await flyOut(-1); stageKey = ''; await phone.act({ op: 'skip', id: post.id, post }); history.push(post); }
    finally { busy = false; render(); }
  }
  $('soKeep').onclick = () => { const q = phone.current().queue; if (q[0]) keep(q[0]); };
  $('soSkip').onclick = () => { const q = phone.current().queue; if (q[0]) skip(q[0]); };
  $('soUndo').onclick = async () => { const post = history.pop(); if (post) { await phone.act({ op: 'undo', id: post.id, post }); render(); } };

  async function reload() {
    $('soRefresh').classList.add('spin');
    try {
      const r = await phone.refresh();
      state = !drive.configured() ? 'notsetup' : r.state;
      if (r.state === 'offline' && r.message) toast(r.message);
      stageKey = ''; render();
    } finally { $('soRefresh').classList.remove('spin'); }
  }
  $('soRefresh').onclick = reload;
  pullToRefresh(root, null, reload);

  const off = phone.onChange(render);
  return {
    async open() {
      root.classList.add('show'); stageKey = ''; await phone.init(); render();
      await reload();
    },
    close() { root.classList.remove('show'); for (const v of root.querySelectorAll('video')) v.pause(); },
    destroy() { off(); },
  };
}
