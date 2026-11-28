// Sort: your X likes and reposts one at a time. Swipe right (or Keep) to keep, left (or Skip) to skip.
import * as Feel from './feel.js';
import { esc, statusLine, ago, pullToRefresh, REFRESH_ICON } from './ui.js';

const THRESHOLD = 120; // px of swipe that counts as a decision
const svg = (d, w = 2.4) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  bring: svg('<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>', 2),
  send: svg('<path d="M12 16V5"/><path d="M7 10l5-5 5 5"/><path d="M5 20h14"/>', 2),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', 2.2),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.8),
  cross: svg('<path d="M6 6l12 12M18 6L6 18"/>', 2.8),
};

export function createSort(root, { phone, drive, toast }) {
  const history = [];   // this session's decisions, for Undo: {id, post}
  let busy = false, state = 'loading', mediaIx = 0, shownId = null, stageKey = '', dragging = false;
  const connect = () => { try { drive.signIn(); } catch (e) { toast(e.message); } };

  root.innerHTML = `
    <div class="so-top">
      <h1>Sort <small class="so-count" id="soCount"></small></h1>
      <label class="btn so-key" id="soBring" for="soPick" aria-label="Bring in" hidden>${I.bring}</label>
      <input type="file" id="soPick" accept=".json,application/json" multiple hidden>
      <button class="btn so-key" id="soRefresh" aria-label="Refresh">${REFRESH_ICON}</button>
      <button class="btn pri so-key" id="soSend" aria-label="Send" hidden>${I.send}<b id="soSendN"></b></button>
    </div>
    <div class="so-status" id="soStatus"></div>
    <div class="so-bar"><span id="soBar"></span></div>
    <div class="so-stage" id="soStage"></div>
    <div class="so-keys" id="soKeys">
      <button class="btn so-big so-skip" id="soSkip" aria-label="Skip">${I.cross}</button>
      <button class="btn so-key so-undo" id="soUndo" aria-label="Undo">${I.undo}</button>
      <button class="btn pri so-big so-keep" id="soKeep" aria-label="Keep">${I.check}</button>
    </div>`;
  const $ = id => root.querySelector('#' + id);
  // Without a Drive sign-in, likes come in and decisions go out as files through the Files app.
  const byFile = () => !(drive.configured && drive.configured() && drive.connected && drive.connected());
  const pick = () => $('soPick').click();
  $('soPick').onchange = async e => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length) return;
    try { const st = await phone.bringIn(files); const v = phone.current(); toast(st && st.same ? 'Already up to date' : v.queue.length ? `${v.queue.length} to sort` : 'Nothing new to sort'); }
    catch (err) { toast(err.message); }
    stageKey = ''; render();
  };
  // Send hands the file to the Share sheet: Save to Files › Quarry Sync › phone › actions. (An iPhone
  // Shortcut can't do it in one tap: the Google Drive folders are greyed out in Shortcuts' folder picker.)
  const sendFile = () => share();
  async function share() {
    const out = phone.actionsFile(); if (!out) return;
    if (navigator.canShare && navigator.canShare({ files: [out.file] })) {
      toast('Save to Files › Quarry Sync › phone › actions');
      try { await navigator.share({ files: [out.file] }); await phone.markSent(out); Feel.sound('send'); toast('Sent: Quarry carries it out on your PC'); }
      catch (err) { if (err.name !== 'AbortError') toast(err.message); }
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(out.file); a.download = out.file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000); await phone.markSent(out);
    }
    stageKey = ''; render();
  }
  $('soSend').onclick = sendFile;

  function media(post, big) {
    const m = post.media || [], one = m[Math.min(mediaIx, m.length - 1)] || null;
    if (!one) return '<div class="so-nomedia">No picture</div>';
    const dots = m.length > 1 ? `<div class="so-dots">${m.map((_, i) => `<i class="${i === mediaIx ? 'on' : ''}"></i>`).join('')}</div>` : '';
    // behind the picture: a soft, blurred, darkened copy of it, so the card isn't empty dark around the video
    const still = one.type === 'photo' ? one.url : one.poster;
    const bg = still ? `<div class="so-bg" style="background-image:url('${esc(still)}')"></div>` : '';
    if (one.type === 'photo') return `${bg}<img class="so-media" alt="" src="${esc(one.url)}">${dots}`;
    return `${bg}<video class="so-media" src="${esc(one.url)}" ${one.poster ? `poster="${esc(one.poster)}"` : ''} muted loop playsinline ${big ? 'autoplay' : ''} preload="${big ? 'metadata' : 'auto'}"></video>${dots}`;
  }
  // the name and words sit on the bottom of the card, over a shade
  function who(post) {
    const xUrl = `https://x.com/${encodeURIComponent(post.author || 'i')}/status/${encodeURIComponent(post.id)}`;
    const name = post.author_name || post.author || '';
    return `<div class="so-shade"></div><div class="so-who"><div class="so-head"><div class="so-av">${esc((name[0] || '?').toUpperCase())}</div>
      <div class="so-author"><b>${esc(name)}</b><span>@${esc(post.author)}</span></div>
      <a class="so-onx" href="${esc(xUrl)}" target="_blank" rel="noreferrer">On X ↗</a></div>
      ${post.text ? `<div class="so-text">${esc(post.text)}</div>` : ''}</div>`;
  }
  const FEEL = `<div class="so-dim"></div><div class="so-badge keep">${I.check}<em>KEEP</em></div><div class="so-badge skip">${I.cross}<em>SKIP</em></div>`;

  function message(title, body, button) {
    const k = 'msg:' + title; if (stageKey === k) return; stageKey = k;
    $('soStage').innerHTML = `<div class="so-msg"><h2>${esc(title)}</h2><p>${esc(body)}</p>${button ? `<button class="btn pri" id="soMsgBtn">${esc(button.label)}</button>` : ''}</div>`;
    if (button) $('soMsgBtn').onclick = button.run;
    $('soKeys').style.visibility = 'hidden';
  }

  function render() {
    if (!root.classList.contains('show')) return;
    const v = phone.current(), q = v.queue;
    $('soCount').textContent = q.length ? `${q.length} left` : '';
    $('soCount').hidden = !q.length;
    $('soUndo').disabled = !history.length;
    const file = byFile(), unsent = phone.unsentCount ? phone.unsentCount() : 0;
    $('soBring').hidden = !file || !v.status; $('soRefresh').hidden = file;
    $('soSend').hidden = !file || !unsent; $('soSendN').textContent = unsent; $('soSend').setAttribute('aria-label', `Send ${unsent}`);
    // how far through the pile: what's been sorted (and not sent yet, or this visit) against what's left
    const done = Math.max(unsent, history.length);
    $('soBar').style.width = (done + q.length ? Math.round(100 * done / (done + q.length)) : 0) + '%';
    statusLine($('soStatus'), v, phone, { signedOut: !file && state === 'signedout', connect });
    $('soStatus').style.visibility = file && !v.status ? 'hidden' : '';
    if (file && !v.status) return message('Bring in your likes', `In Files, open Quarry Sync › phone and pick “${phone.BUNDLE || 'for phone.json'}”. Quarry on your PC keeps it up to date.`, { label: 'Bring in', run: pick });
    if (file && !q.length && unsent) return message('All sorted', `Send your ${unsent} choices to Quarry: save the file in Quarry Sync › phone › actions.`, { label: `Send ${unsent}`, run: sendFile });
    if (file && !q.length) return message('All sorted', `Bring in a newer file to see more. This one is from ${ago(v.status && v.status.written)}.`, { label: 'Bring in', run: pick });
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
    // The card underneath already holds the next post, loaded: when it comes up it's moved to the top as it
    // is, rather than built again, so its picture never blanks out for a moment (the flash between posts)
    const stage = $('soStage'), under = stage.querySelector('.so-card.under');
    const underHtml = next ? `<div class="so-card under" data-id="${esc(next.id)}">${media(next, false)}${who(next)}${FEEL}</div>` : '';
    if (under && under.dataset.id === String(post.id) && mediaIx === 0) {
      for (const el of [...stage.children]) if (el !== under) el.remove();
      under.className = 'so-card top'; under.id = 'soCard'; under.removeAttribute('data-id'); under.style.cssText = ''; under.querySelector('.so-who').style.opacity = '';
      under.insertAdjacentHTML('beforebegin', underHtml);
    } else {
      stage.innerHTML = underHtml + `<div class="so-card top" id="soCard">${media(post, true)}${who(post)}${FEEL}</div>`;
    }
    // "On X" opens the post in the X app (or x.com) to look at it there; nothing is changed on X
    const top = $('soCard'); top.querySelector('.so-who').id = 'soInfo'; top.querySelector('.so-onx').id = 'soOnX';
    top.querySelector('.so-who').addEventListener('pointerdown', e => { if (e.target.closest('.so-onx')) e.stopPropagation(); });
    $('soKeep').style.transform = $('soSkip').style.transform = '';
    wire(top, post);
    startVideo($('soCard'), post);
  }

  // iOS only autoplays a video that is muted as a property and started from script; a picture that
  // won't play gets a tap-to-play key, and one that can't load says so with a link to the post on X.
  function startVideo(card, post) {
    const v = card.querySelector('video'); if (!v) return;
    v.muted = true; v.defaultMuted = true; v.playsInline = true;
    const badge = (html, cls) => { card.querySelector('.so-vbadge')?.remove(); if (!html) return;
      const b = document.createElement('div'); b.className = 'so-vbadge ' + cls; b.innerHTML = html;
      b.addEventListener('pointerdown', e => e.stopPropagation()); card.append(b); return b; };
    const go = () => v.play().then(() => badge(''), () => { const b = badge('▶ Play', 'play'); if (b) b.onclick = () => go(); });
    v.addEventListener('error', () => badge(`Can't play this video here · <a href="https://x.com/i/status/${encodeURIComponent(post.id)}" target="_blank" rel="noreferrer">Open on X</a>`, 'err'), { once: true });
    go();
  }

  // The feel: the card follows the finger and leans from where you grabbed it (gently, at most 8°), lifting
  // a touch while held. Toward Keep, a soft glow rings the card and the ✓ badge grows in; toward Skip the
  // picture dims and the ✕ badge grows in; the matching key swells. The next card rises behind it.
  function pose(card, dx, dy, grabTop, held) {
    const w = card.offsetWidth || innerWidth, p = Math.max(-1, Math.min(1, dx / THRESHOLD)), a = Math.abs(p), e = a * a * (3 - 2 * a);
    const lean = (grabTop ? 1 : -1) * Math.max(-8, Math.min(8, dx / w * 14));
    card.style.transformOrigin = `50% ${grabTop ? '115%' : '-15%'}`;
    card.style.transform = dx || dy || held ? `translate(${dx}px,${dy}px) rotate(${lean.toFixed(2)}deg) scale(${held ? 1.02 : 1})` : '';
    card.style.boxShadow = p > 0 ? `0 18px 40px rgba(0,0,0,.5),0 0 0 ${(2 * e).toFixed(2)}px rgba(255,138,155,${(.9 * e).toFixed(2)}),0 0 ${(34 * e).toFixed(1)}px rgba(255,77,103,${(.45 * e).toFixed(2)})` : '';
    const bk = card.querySelector('.so-badge.keep'), bs = card.querySelector('.so-badge.skip'), ek = p > 0 ? e : 0, es = p < 0 ? e : 0;
    bk.style.opacity = ek; bk.style.transform = `scale(${.5 + .5 * ek}) rotate(${(1 - ek) * -30}deg)`;
    bs.style.opacity = es; bs.style.transform = `scale(${.5 + .5 * es}) rotate(${(1 - es) * 30}deg)`;
    card.querySelector('.so-dim').style.opacity = es;
    const u = $('soStage').querySelector('.so-card.under'), r = Math.min(1, Math.abs(dx) / w);
    if (u) { u.style.transform = `scale(${.94 + .06 * r}) translateY(${14 - 14 * r}px)`; u.style.opacity = .5 + .5 * r; u.querySelector('.so-who').style.opacity = r; }
    $('soKeep').style.transform = ek ? `scale(${1 + .14 * ek})` : ''; $('soSkip').style.transform = es ? `scale(${1 + .14 * es})` : '';
  }
  function wire(card, post) {
    let x0 = null, y0 = 0, dx = 0, dy = 0, moved = false, grabTop = true;
    card.onpointerdown = e => {
      if (busy) return; Feel.prime(); side = 0; dragging = true; x0 = e.clientX; y0 = e.clientY; dx = dy = 0; moved = false;
      const b = card.getBoundingClientRect(); grabTop = e.clientY < b.top + b.height / 2;
      card.getAnimations().forEach(a => a.cancel());
      card.setPointerCapture(e.pointerId); card.style.transition = 'none'; pose(card, 0, 0, grabTop, true);
    };
    let side = 0;
    card.onpointermove = e => {
      if (x0 === null) return; dx = e.clientX - x0; dy = (e.clientY - y0) * .25; if (Math.abs(dx) > 6) moved = true;
      pose(card, dx, dy, grabTop, true);
      const now = dx > THRESHOLD ? 1 : dx < -THRESHOLD ? -1 : 0;   // a tick each time it crosses the keep/skip line
      if (now !== side) { side = now; if (now) { Feel.tap(); Feel.sound('line'); } }
    };
    const end = () => {
      if (x0 === null) return; x0 = null; dragging = false;
      if (dx > THRESHOLD) keep(post, { dx, dy, grabTop });
      else if (dx < -THRESHOLD) skip(post, { dx, dy, grabTop });
      else {
        springBack(card, dx, dy, grabTop);
        if (!moved && (post.media || []).length > 1) { mediaIx = (mediaIx + 1) % post.media.length; render(); }
      }
      render();
    };
    card.onpointerup = end; card.onpointercancel = end;
  }
  // let go before the line: it springs back with a small wobble
  function springBack(card, dx, dy, grabTop) {
    const t0 = performance.now(), D = 600;
    const step = now => {
      if (dragging || !card.isConnected) return;
      const t = (now - t0) / 1000, k = Math.exp(-t * 7) * Math.cos(t * 11);
      if (now - t0 >= D) { pose(card, 0, 0, grabTop, false); card.style.transformOrigin = ''; return; }
      pose(card, dx * k, dy * k, grabTop, false); requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // past the line (or a key): it carries on off the screen the way it was going, speeding up
  function flyOut(dir, from = null) {
    const c = $('soCard'); if (!c) return Promise.resolve();
    const f = from || { dx: 0, dy: 0, grabTop: true }, t0 = performance.now(), D = 280;
    return new Promise(res => {
      const step = now => {
        const k = Math.min(1, (now - t0) / D);
        if (c.isConnected) pose(c, f.dx + dir * (500 * k * k + 120 * k), f.dy + 10 * k, f.grabTop, false);
        if (k < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
  }

  async function keep(post, from) {
    if (busy) return; busy = true; Feel.tap(true); Feel.sound('keep');
    try {
      // Keep is one swipe: no folder or tags here. Filing goes in a separate library tagging tab.
      stageKey = '';
      await flyOut(1, from);
      await phone.act({ op: 'keep', id: post.id, folder: null, tags: [], post });
      history.push(post);
    } finally { busy = false; render(); }
  }
  async function skip(post, from) {
    if (busy) return; busy = true; Feel.tap(); Feel.sound('skip');
    try { await flyOut(-1, from); stageKey = ''; await phone.act({ op: 'skip', id: post.id, post }); history.push(post); }
    finally { busy = false; render(); }
  }
  $('soKeep').onclick = () => { const q = phone.current().queue; if (q[0]) keep(q[0]); };
  $('soSkip').onclick = () => { const q = phone.current().queue; if (q[0]) skip(q[0]); };
  $('soUndo').onclick = async () => { const post = history.pop(); if (post) { Feel.tap(); Feel.sound('undo'); stageKey = ''; await phone.act({ op: 'undo', id: post.id, post }); render(); } };

  async function reload() {
    if (byFile()) { if (phone.fileReady) await phone.fileReady(); state = 'file'; stageKey = ''; render(); return; }
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
