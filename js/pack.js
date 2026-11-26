// Export notes: a review's videos handed back to the team as one zip, the way Quarry's Export notes does it.
// One folder per video holding any of: the video with notes burned in, the .quarrynotes file, the Maya image
// plane .py and (retimed videos) the Maya time warp .py. Everything is made on the phone; nothing is uploaded.
import { loadFrames } from './frames.js';
import { frameMap } from './warp.js';
import { legacyHolds } from './draw.js';
import { renderer } from './render.js';
import { recordVideo, deliver } from './export.js';
import { zipParts } from './zip.js';
import { thumbBlob } from './store.js';
import { quarryNotes, timeWarpPy, mayaDropHead, stamp, hasNotes, isRetimed, folderFor, warpOf, NOTES_EXT } from './handback.js';
import { ICONS } from './reviews.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KINDS = [
  { k: 'video', label: 'Video', icon: ICONS.video },
  { k: 'notes', label: 'Quarry notes', icon: ICONS.notes },
  { k: 'maya', label: 'Maya', icon: ICONS.maya },
];
const can = (v, k) => k !== 'warp' || isRetimed(v);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The files a video's picks make, by name (no folder).
export function filesFor(v, picks, name = folderFor(v)) {
  const out = [];
  if (picks.has('video')) out.push(`${name} - notes.mp4`);
  if (picks.has('maya')) out.push(`${name} - image plane.py`);
  if (picks.has('warp') && can(v, 'warp')) out.push(`${name} - time warp.py`);
  if (picks.has('notes')) out.push(`${name}.${NOTES_EXT}`);
  return out;
}

// veil: the sheet's veil; info: dayInfo() for the review; deps: { getClip(id), toast(msg), log(msg) }
export function openExport(veil, info, { getClip, toast = () => {}, log = () => {} }) {
  const picks = new Map(info.videos.map(v => [v.id, new Set(['video', 'notes', 'maya', ...(isRetimed(v) ? ['warp'] : [])])]));
  let onlyNotes = info.videos.some(hasNotes), running = false, stop = false;
  const shown = () => info.videos.filter(v => !onlyNotes || hasNotes(v));
  const zipName = `Review ${info.day}.zip`;
  const close = () => { if (running) { stop = true; return; } veil.style.display = 'none'; veil.classList.remove('show'); };

  let urls = [];
  const thumb = v => { const u = URL.createObjectURL(thumbBlob(v.thumb)); urls.push(u); return u; };
  function render() {
    for (const u of urls) URL.revokeObjectURL(u); urls = [];
    const vids = shown(), count = vids.reduce((n, v) => n + filesFor(v, picks.get(v.id)).length, 0);
    veil.innerHTML = `<div class="sheet grain ex-sheet">
      <div class="cap">Export notes</div>
      <div class="chips ex-flip">${KINDS.map(({ k, label, icon }) => `<button class="chip${vids.length && vids.every(v => picks.get(v.id).has(k)) ? ' on' : ''}" data-flip="${k}">${icon}${label}</button>`).join('')}</div>
      <div class="rv-cap">${vids.length} video${vids.length === 1 ? '' : 's'}</div>
      <div class="list rv-list ex-list">${vids.map(v => `
        <div class="li" data-id="${esc(v.id)}">
          <span class="rv-th">${v.thumb ? `<img alt="" src="${thumb(v)}">` : ''}</span>
          <span class="tx"><span class="nm">${esc(v.name)}</span></span>
          ${[...KINDS, ...(isRetimed(v) ? [{ k: 'warp', label: 'Time warp', icon: ICONS.warp }] : [])].map(({ k, label, icon }) =>
            `<button class="btn tg${picks.get(v.id).has(k) ? ' on' : ''}" data-k="${k}" aria-label="${label}" title="${label}">${icon}</button>`).join('')}
        </div>`).join('') || '<div class="li" style="color:var(--mut)">No videos with notes yet.</div>'}</div>
      <div class="ex-foot">
        <div class="ex-sw"><span>Only videos with notes</span><button class="tog${onlyNotes ? ' on' : ''}" id="exOnly" aria-label="Only videos with notes"></button></div>
        <div class="ex-ln" id="exLine">${count} file${count === 1 ? '' : 's'}, one folder per video, in <b>${esc(zipName)}</b></div>
        <div class="ex-bar" id="exBar" hidden><i></i></div>
        <div class="acts"><button class="btn" id="exCancel">Cancel</button><button class="btn pri" id="exGo" style="flex:2"${count ? '' : ' disabled'}>Export zip</button></div>
      </div></div>`;
    for (const b of veil.querySelectorAll('[data-flip]')) b.onclick = () => {
      const k = b.dataset.flip, all = shown().every(v => picks.get(v.id).has(k));
      for (const v of shown()) all ? picks.get(v.id).delete(k) : picks.get(v.id).add(k);
      render();
    };
    for (const b of veil.querySelectorAll('.tg')) b.onclick = () => {
      const p = picks.get(b.closest('[data-id]').dataset.id), k = b.dataset.k;
      p.has(k) ? p.delete(k) : p.add(k); render();
    };
    veil.querySelector('#exOnly').onclick = () => { onlyNotes = !onlyNotes; render(); };
    veil.querySelector('#exCancel').onclick = close;
    veil.querySelector('#exGo').onclick = run;
  }

  function progress(text, frac) {
    veil.querySelector('#exLine').textContent = text;
    const bar = veil.querySelector('#exBar'); bar.hidden = false; bar.firstChild.style.width = `${Math.round(frac * 100)}%`;
  }

  async function run() {
    const vids = shown().filter(v => picks.get(v.id).size);
    running = true; stop = false;
    for (const b of veil.querySelectorAll('.chip,.tg,.tog,#exGo')) b.disabled = true;
    veil.querySelector('#exCancel').textContent = 'Stop';
    const entries = [], failed = [], used = new Set();
    let tpl = null;
    try {
      for (const [i, v] of vids.entries()) {
        if (stop) break;
        const p = picks.get(v.id), step = (t, f = 0) => progress(`${v.name}: ${t}`, (i + f) / vids.length);
        let folder = folderFor(v), n = 2; while (used.has(folder.toLowerCase())) folder = `${folderFor(v)} (${n++})`; used.add(folder.toLowerCase());
        const name = folderFor(v), add = async (file, data) => entries.push({ name: `${folder}/${file}`, data: data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer()) });
        try {
          if (p.has('notes')) await add(`${name}.${NOTES_EXT}`, new TextEncoder().encode(JSON.stringify(quarryNotes(v), null, 1)));
          if (p.has('warp') && isRetimed(v)) await add(`${name} - time warp.py`, new TextEncoder().encode(timeWarpPy(v)));
          if (!p.has('video') && !p.has('maya')) continue;
          const clip = await getClip(v.id);
          if (!clip) throw new Error('its clip is missing from this phone');
          step('loading frames');
          const media = await loadFrames(clip, { log, fps: v.fps });
          try {
            while (media.loading && !stop) { step(`loading frames ${media.frames.filter(Boolean).length} / ${media.count}`); await sleep(150); }
            if (stop) break;
            const marks = v.marks || [], holds = v.holds || legacyHolds(marks), retimed = isRetimed(v);
            const seq = retimed ? frameMap(warpOf(v), media.count) : Array.from({ length: media.count }, (_, j) => j), shown = retimed ? new Set(seq) : null;
            const { compose, noteBanner } = renderer({ frames: media.frames, W: media.W, H: media.H, state: () => ({ marks, holds, retimed, shown, trace: v.trace || 0, onion: null }) });
            if (p.has('video')) {
              const { blob, ext } = await recordVideo({
                W: media.W, H: media.H, fps: media.fps, total: seq.length, draw: (c, j) => { compose(c, seq[j], true); if (j === 0) noteBanner(c, seq); },
                onFrame: (j, t) => step(`video, frame ${j} / ${t}`, j / t * .6), stopped: () => stop,
              });
              if (!blob) break;
              await add(`${name} - notes.${ext}`, blob);
            }
            if (p.has('maya')) {
              tpl = tpl || await (await fetch('maya/maya_drop.py')).text();
              const c = document.createElement('canvas'); c.width = media.W; c.height = media.H; const cx = c.getContext('2d');
              const parts = [mayaDropHead(tpl, { shot: name, stamp: stamp(), fps: media.fps, count: seq.length })];
              for (const [j, f] of seq.entries()) {
                if (stop) break;
                cx.setTransform(1, 0, 0, 1, 0, 0); compose(cx, f, true); if (j === 0) noteBanner(cx, seq);
                const jpg = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
                parts.push(`"${await b64(jpg)}",\n`);
                if (j % 4 === 0) step(`Maya image plane, frame ${j + 1} / ${seq.length}`, .6 + j / seq.length * .4);
              }
              if (stop) break;
              parts.push(']\n');
              await add(`${name} - image plane.py`, new Blob(parts));
            }
          } finally { media.cancel(); }
        } catch (e) { failed.push(`${v.name}: ${e.message}`); log(`export ${v.name}: ${e.message}`); }
      }
      if (stop) { running = false; render(); toast('Export stopped. Nothing was saved.'); return; }
      if (!entries.length) throw new Error(failed[0] || 'Nothing to export');
      progress('Making the zip…', 1);
      const zip = new File(zipParts(entries), zipName, { type: 'application/zip' });
      log(`exported ${zipName}: ${entries.length} files, ${(zip.size / 1e6).toFixed(1)} MB`);
      running = false; close();
      if (failed.length) toast(`Some files weren't made. ${failed[0]}`, 6000);
      await deliver(zip);
    } catch (e) { running = false; render(); toast(e.message, 5000); }
  }

  veil.onclick = e => { if (e.target === veil && !running) close(); };
  render();
  veil.style.display = 'flex'; veil.classList.add('show');
}

const b64 = blob => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(String(r.result).slice(String(r.result).indexOf(',') + 1)); r.onerror = () => rej(r.error); r.readAsDataURL(blob);
});
