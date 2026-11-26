// The review player: exact frames, play rate, zoom, loop, notes and shapes, retime sections.
// Ported from the "Vista review test" spike. One player at a time; state comes in from a review
// and every edit goes back out through onChange with just the fields that changed.
import { posAtOrAfter, posAtOrBefore } from './retime.js';
import * as TW from './warp.js';
import { exportVideo } from './export.js';
import { renderer, roundRect } from './render.js';
export { roundRect };
import { steady, SMOOTH_DEFAULT } from './stroke.js';
import { isDrawn, drawingAt, drawingStarts, holdOf, legacyHolds, eraseStroke, hitsShape } from './draw.js';

const $ = id => document.getElementById(id);
export const PRESETS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
export const fmt = r => (Math.round(r * 100) / 100) + '×';
const PEN_SIZES = { 1: 2.5, 2: 4.5, 3: 9 };   // on-screen px, so drawing zoomed in gives finer lines (the old three sizes)
const ERASER = 14;        // on-screen px
const PX_PER_FRAME = 10;  // one-finger slide

export function log(s) { const l = $('log2'); if (l) l.textContent += s + '\n'; }
export function status(t, p) { $('status').style.display = t ? 'block' : 'none'; $('stxt').textContent = t || ''; $('sbar').style.width = ((p || 0) * 100) + '%'; }

export function openPlayer(root, { media, review = null, name = 'clip', onChange = () => {}, onBack = () => {} }) {
  const ac = new AbortController(), on = (el, ev, fn) => el.addEventListener(ev, fn, { signal: ac.signal });
  const cv = $('cv'), cx = cv.getContext('2d'), sc = $('scrub'), sx = sc.getContext('2d'), lane = $('drawLane'), lx = lane.getContext('2d');
  const { fps, W, H, frames } = media;
  const r0 = review || {};
  // The time warp: a curve of keys (warp.js). Reviews from before it keep their Hold / Cut / Speed sections as a curve.
  let marks = r0.marks ? [...r0.marks] : [];
  let warp = r0.warp && r0.warp.keys && r0.warp.keys.length ? r0.warp.keys.map(k => ({ ...k }))
    : (r0.secs || []).length ? TW.fromSections(frames.length, r0.secs) : null;
  const warped = () => !!warp && !TW.isIdentity(warp, frames.length);
  let retimed = !!r0.retimed && warped();
  let inF = r0.inF ?? null, outF = r0.outF ?? null, rate = r0.rate || 1, pos = r0.pos || 0;
  // How long each frame's drawing holds. Reviews from before holds existed keep their 12 frames.
  let holds = r0.holds ? { ...r0.holds } : legacyHolds(marks);
  let pen = { color: '#E5484D', size: 2, alpha: 1, pressure: 1, smooth: SMOOTH_DEFAULT };
  const penPx = () => pen.px ?? PEN_SIZES[pen.size] ?? 4.5;   // the stroke's on-screen width: the size slider sets it
  // Drawing aids: tracing paper is kept with the review (Quarry keeps it with the video); onion skin is a preference.
  let trace = r0.trace || 0, lastTrace = trace || 0.5, onion = { on: false, before: 2, after: 2 }, quietAids = false;
  try { onion = { ...onion, ...JSON.parse(localStorage.getItem('qg_onion') || '{}') }; } catch {}
  try { pen = { ...pen, ...JSON.parse(localStorage.getItem('qg_pen') || '{}') }; } catch {}
  pen.pressure = 1;   // Pencil pressure always at full: the most difference between a light and a heavy stroke
  const undoStack = [], redoStack = [];
  const remember = () => { redoStack.length = 0; undoStack.push({ marks: JSON.parse(JSON.stringify(marks)), holds: { ...holds }, warp: warp && warp.map(k => ({ ...k })) }); if (undoStack.length > 60) undoStack.shift(); };
  let seq = [0], segAt = [null], cutMarks = [], firstPos = new Int32Array(1), shown = null;
  let inkP = 1;   // the eased Pencil pressure of the stroke being drawn
  let cur = 0, playing = false, tool = null, drag = null, zoom = 1, panX = 0, panY = 0;
  const changed = (...keys) => {
    const o = {}; for (const k of keys) o[k] = { marks, warp: warp && { keys: warp }, retimed, inF, outF, rate, pos, holds, trace }[k]; onChange(o);
    if (keys.includes('marks') || keys.includes('holds')) renderList();
  };
  const stage = $('stage');

  // ---------- timeline
  function rebuild() {
    const n = Math.max(1, frames.length);
    if (retimed && warp) {
      seq = TW.frameMap(warp, n); shown = new Set(seq);
      // how each played frame moves: held, slow, fast or 1x (for the scrub bar), and where it jumps ahead
      segAt = seq.map((v, p) => { const r = TW.rateAt(warp, p); return r <= 0.02 ? HOLDZ : r < 0.95 ? SLOWZ : r > 1.05 ? FASTZ : null; });
      cutMarks = []; for (let p = 1; p < seq.length; p++) if (seq[p] - seq[p - 1] > 1 && segAt[p] !== FASTZ) cutMarks.push(p);
    } else { seq = Array.from({ length: n }, (_, i) => i); segAt = seq.map(() => null); cutMarks = []; shown = null; }
    firstPos = new Int32Array(Math.max(1, frames.length)).fill(-1);
    for (let p = seq.length - 1; p >= 0; p--) firstPos[seq[p]] = p;
    pos = Math.max(0, Math.min(seq.length - 1, pos));
  }
  const lo = () => inF ?? 0, hi = () => outF ?? seq.length - 1;

  // ---------- view: the video sits on a full-screen canvas, fitted into the space the cards leave
  // (between the header and the bottom card upright; the whole screen sideways). Pinch to zoom in or
  // out and drag it anywhere, like Procreate; double-tap fits it back.
  const sideways = () => matchMedia('(orientation:landscape) and (max-height:600px)').matches;
  let area = { top: 0, bottom: 0, right: 0 };
  const isPad = () => matchMedia('(min-width:900px) and (min-height:600px)').matches;
  function sizeAll() {
    const d = devicePixelRatio || 1;
    const sr = stage.getBoundingClientRect();
    cv.width = Math.max(1, sr.width * d); cv.height = Math.max(1, sr.height * d);
    if (sideways()) area = { top: 0, bottom: 0, right: 0 };
    else {
      const tb = $('top').getBoundingClientRect(), db = $('dock').getBoundingClientRect();
      area = { top: Math.max(0, tb.bottom - sr.top + 8), bottom: Math.max(0, sr.bottom - db.top + 8), right: 0 };
      // iPad: the side panel takes the right, unless it's tucked away
      if (isPad() && !$('player').classList.contains('tucked')) area.right = Math.max(0, sr.right - $('side').getBoundingClientRect().left + 8);
    }
    const r = sc.getBoundingClientRect(); sc.width = r.width * d; sc.height = r.height * d;
    const lr = lane.getBoundingClientRect(); lane.width = lr.width * d; lane.height = lr.height * d;
    if (!$('wPanel').hidden) sizeCurve();
  }
  function view() {
    const d = devicePixelRatio || 1, ah = Math.max(40 * d, cv.height - (area.top + area.bottom) * d), aw = Math.max(40 * d, cv.width - (area.right || 0) * d);
    const fit = Math.min(aw / W, ah / H), s = fit * zoom;
    return { d, s, ox: (aw - W * s) / 2 + panX * d, oy: area.top * d + (ah - H * s) / 2 + panY * d };
  }
  function clampPan() {   // keep at least a quarter of the picture on screen
    const d = devicePixelRatio || 1, v = view(), pw = W * v.s / d, ph = H * v.s / d, cw = cv.width / d, ch = cv.height / d;
    const mx = (cw + pw) / 2 - Math.min(pw, cw) * 0.25, my = (ch + ph) / 2 - Math.min(ph, ch) * 0.25;
    panX = Math.max(-mx, Math.min(mx, panX)); panY = Math.max(-my, Math.min(my, panY));
  }

  // ---------- marks (drawn by render.js, shared with the review exporter)
  const { drawMark, visible, compose } = renderer({ frames, W, H, state: () => ({ marks, holds, retimed, shown, trace,
    onion: onion.on && !playing && !quietAids ? onion : null }) });

  // ---------- drawing
  const HOLDZ = { type: 'hold' }, SLOWZ = { type: 'speed', r: 0.5 }, FASTZ = { type: 'speed', r: 2 };
  const secLabel = z => z === HOLDZ ? 'hold' : z === SLOWZ ? 'slow' : 'fast';
  function draw() {
    cur = seq[pos] ?? 0;
    if (mode === 'note') $('noteBtnTxt').textContent = `Add note at ${cur + 1}`;
    const v = view();
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.fillStyle = '#101114'; cx.fillRect(0, 0, cv.width, cv.height);
    cv.dataset.pic = [v.ox, v.oy, W * v.s, H * v.s].map(n => Math.round(n / v.d)).join(',');   // where the picture sits (for tests)
    cx.setTransform(v.s, 0, 0, v.s, v.ox, v.oy);
    cx.imageSmoothingQuality = zoom > 2 ? 'low' : 'high';
    compose(cx, cur, false); if (drag) drawMark(cx, drag);
    showNoteChip();
    cx.setTransform(1, 0, 0, 1, 0, 0);
    $('fr').innerHTML = `<b>${pos + 1}</b> / ${seq.length}${retimed ? ` · fr ${cur + 1}` : ''}`;
    if (!playing) markList();
    if (!$('wPanel').hidden) drawCurve();
    const got = media.loading ? frames.reduce((n, x) => n + (x ? 1 : 0), 0) : 0;
    // only what's worth a glance: the zoom when zoomed in, and loading while frames come in (no seconds or fps)
    $('tc').textContent = [Math.abs(zoom - 1) > .01 ? zoom.toFixed(1) + '× zoom' : '', media.loading ? `loading ${Math.round(got / frames.length * 100)}%` : ''].filter(Boolean).join(' · ');
    const hasR = inF !== null || outF !== null;
    // the loop shows only on the ruler (red bracket); hold the ruler to change or clear it
    $('inBtn').lastElementChild.textContent = inF !== null ? `In ${inF + 1}` : 'Set In'; $('inBtn').classList.toggle('on', inF !== null);
    $('outBtn').lastElementChild.textContent = outF !== null ? `Out ${outF + 1}` : 'Set Out'; $('outBtn').classList.toggle('on', outF !== null);
    drawScrub();
  }
  function drawScrub() {
    const w = sc.width, h = sc.height, d = devicePixelRatio || 1, n = seq.length, X = f => w * (f + 0.5) / n, E = p => w * p / n;
    sx.clearRect(0, 0, w, h);
    const r = (x, y, ww, hh, rr) => { sx.beginPath(); sx.roundRect ? sx.roundRect(x, y, ww, hh, rr) : sx.rect(x, y, ww, hh); sx.fill(); };
    // Quarry's timeline: a dark frame ruler, a tick at every frame (where they fit) and numbers spaced to read
    const cs = getComputedStyle(sc), cv = (k, f) => cs.getPropertyValue(k).trim() || f;   // ruler colours follow the theme
    sx.fillStyle = cv('--ruler', 'rgba(10,12,16,.32)'); r(0, 0, w, h, 6 * d);
    const cell = w / n, every = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000].find(k => k * cell >= 30 * d) || 1000;
    sx.fillStyle = cv('--tick', 'rgba(255,255,255,.07)');
    if (cell >= 4 * d) for (let p = 1; p < n; p++) sx.fillRect(Math.round(E(p)), h - 6 * d, Math.max(1, d / 2), 6 * d);
    sx.font = `500 ${9 * d}px Rubik,system-ui`; sx.textAlign = 'left'; sx.textBaseline = 'alphabetic';
    for (let p = 0; p < n; p += every) {
      sx.fillStyle = cv('--tick2', 'rgba(255,255,255,.16)'); sx.fillRect(Math.round(E(p)), h - 12 * d, Math.max(1, d / 2), 12 * d);
      if (E(p) + 3 * d + sx.measureText(String(p + 1)).width < w - 2 * d) { sx.fillStyle = cv('--rulerTxt', 'rgba(236,238,241,.42)'); sx.fillText(String(p + 1), E(p) + 3 * d, h - 4 * d); }
    }
    // retime sections: slow darker blue, fast lighter blue, hold pale, cut coral (a thin mark once it's gone)
    for (let p = 0; p < n;) {
      const z = segAt[p]; let q = p; while (q < n && segAt[q] === z) q++;
      if (z) {
        const x0 = E(p), x1 = E(q);
        sx.fillStyle = z.type === 'cut' ? 'rgba(232,144,140,.32)' : z.type === 'hold' ? 'rgba(236,238,241,.22)' : z.r < 1 ? 'rgba(74,117,144,.75)' : 'rgba(134,176,194,.45)';
        r(x0 + d, h / 2 - 15 * d, Math.max(2 * d, x1 - x0 - 2 * d), 30 * d, 5 * d);
        const t = secLabel(z); sx.font = `600 ${10 * d}px Rubik,system-ui`;
        if (x1 - x0 > sx.measureText(t).width + 8 * d) { sx.fillStyle = z.type === 'cut' ? '#E8908C' : '#ECEEF1'; sx.textAlign = 'center'; sx.fillText(t, (x0 + x1) / 2, h / 2 - 6 * d); }
      }
      p = q;
    }
    sx.fillStyle = '#E8908C'; for (const p of cutMarks) r(E(p) - 1.5 * d, h / 2 - 15 * d, 3 * d, 30 * d, 1.5 * d);
    if (inF !== null || outF !== null) {
      // the loop: shade outside it, a red bracket along it, a drag handle at each end
      const a0 = E(lo()), a1 = E(hi() + 1);
      sx.fillStyle = 'rgba(0,0,0,.32)'; sx.fillRect(0, 0, a0, h); sx.fillRect(a1, 0, w - a1, h);
      sx.fillStyle = '#FF4D67'; sx.fillRect(a0, 0, a1 - a0, 2 * d); sx.fillRect(a0, h - 2 * d, a1 - a0, 2 * d);
      for (const x of [a0, a1]) r(x - 4 * d, 0, 8 * d, h, 4 * d);
    }
    sx.fillStyle = '#E8908C'; for (const m of marks) { const p = firstPos[m.f]; if (p >= 0 && !(retimed && shown && !shown.has(m.f))) r(X(p) - 1.5 * d, h / 2 + 7 * d, 3 * d, 7 * d, 1.5 * d); }
    if (media.loading) { sx.fillStyle = '#6FBF8E'; for (let p = 0; p < n;) { const has = !!frames[seq[p]]; let q = p; while (q < n && !!frames[seq[q]] === has) q++; if (has) sx.fillRect(E(p), h - 3 * d, E(q) - E(p), 2 * d); p = q; } }
    // handle: a plain round knob on the track
    // the playhead: Quarry's green block over the current frame's cell
    { const cw = Math.max(cell, 8 * d), x0 = Math.max(0, Math.min(w - cw, E(pos) + cell / 2 - cw / 2));
      sx.fillStyle = '#7FD4B0'; r(x0, 0, cw, h, 3 * d); }
    drawLane();
  }

  // ---------- the drawings lane: one bar per drawing, as long as it holds; drag its light end to change that
  function spanOf(s) {  // first and last timeline positions a drawing shows on
    const e = s + holdOf(holds, s) - 1; let a = -1, b = -1;
    for (let p = 0; p < seq.length; p++) if (seq[p] >= s && seq[p] <= e && drawingAt(marks, holds, seq[p]) === s) { if (a < 0) a = p; b = p; }
    return a < 0 ? null : [a, b];
  }
  function drawLane() {
    const w = lane.width, h = lane.height, d = devicePixelRatio || 1, n = seq.length, E = p => w * p / n;
    lx.clearRect(0, 0, w, h);
    for (const s of drawingStarts(marks)) {
      const sp = spanOf(s); if (!sp) continue;
      const m = marks.find(x => isDrawn(x) && x.f === s), x0 = E(sp[0]), x1 = E(sp[1] + 1);
      lx.globalAlpha = .85; lx.fillStyle = (m && m.color) || '#FF3B5C';
      lx.beginPath(); lx.roundRect ? lx.roundRect(x0 + d, 3 * d, Math.max(3 * d, x1 - x0 - 2 * d), h - 6 * d, 3 * d) : lx.rect(x0, 3 * d, x1 - x0, h - 6 * d); lx.fill();
      lx.globalAlpha = 1; lx.fillStyle = '#ECEEF1';
      lx.beginPath(); lx.roundRect ? lx.roundRect(x1 - 5 * d, d, 4 * d, h - 2 * d, 2 * d) : lx.rect(x1 - 5 * d, d, 4 * d, h - 2 * d); lx.fill();
    }
  }
  let laneDrag = null;
  const lanePos = e => { const r = lane.getBoundingClientRect(); return { x: e.clientX - r.left, w: r.width, p: Math.min(seq.length - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * seq.length))) }; };
  on(lane, 'pointerdown', e => {
    stop(); lane.setPointerCapture(e.pointerId); poke();
    const { x, w, p } = lanePos(e), n = seq.length;
    let best = null;
    for (const s of drawingStarts(marks)) {
      const sp = spanOf(s); if (!sp) continue;
      const end = w * (sp[1] + 1) / n, start = w * sp[0] / n;
      if (Math.abs(x - end) <= 14) { if (!best || best.kind !== 'end' || Math.abs(x - end) < best.dx) best = { kind: 'end', s, dx: Math.abs(x - end) }; }
      else if (x >= start && x < end && (!best || best.kind !== 'end')) best = { kind: 'bar', s, start: sp[0] };
    }
    if (!best) return;
    if (best.kind === 'bar') { pos = best.start; draw(); changed('pos'); return; }
    remember(); laneDrag = { s: best.s, changedHold: false };
  });
  on(lane, 'pointermove', e => {
    if (!laneDrag) return;
    const { p } = lanePos(e), s = laneDrag.s;
    const next = drawingStarts(marks).find(x => x > s);
    let hold = Math.max(1, seq[p] - s + 1);
    if (next !== undefined) hold = Math.min(hold, next - s);   // a hold stops where the next drawing starts
    if (hold !== holdOf(holds, s)) { if (hold === 1) delete holds[s]; else holds[s] = hold; laneDrag.changedHold = true; draw(); }
  });
  on(lane, 'pointerup', () => {
    if (!laneDrag) return;
    if (laneDrag.changedHold) changed('holds');
    else { undoStack.pop(); const sp = spanOf(laneDrag.s); if (sp) { pos = sp[0]; draw(); changed('pos'); } }  // a tap on the end jumps too
    laneDrag = null;
  });

  // ---------- scrub bar: only ever moves the playhead, and stays inside In/Out
  let scrubbing = false;
  const frameAt = e => { const r = sc.getBoundingClientRect(); return Math.min(seq.length - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * seq.length))); };
  let endDrag = null, ioT = 0, ioAt = null;
  const scrubMove = e => {
    if (ioAt && Math.abs(e.clientX - ioAt.x) > 8) { clearTimeout(ioT); ioAt = null; }
    if (endDrag) { const f = frameAt(e); if (endDrag === 'in') inF = Math.min(f, outF ?? seq.length - 1); else outF = Math.max(f, inF ?? 0); pos = Math.max(lo(), Math.min(hi(), pos)); draw(); return; }
    if (!scrubbing) return; pos = Math.max(lo(), Math.min(hi(), frameAt(e))); draw();
  };
  on(sc, 'pointerdown', e => {
    stop(); sc.setPointerCapture(e.pointerId); poke(); hideIo();
    // near an end of the loop: drag that end
    if (inF !== null || outF !== null) {
      const r = sc.getBoundingClientRect(), x = e.clientX - r.left, ex = f => r.width * f / seq.length;
      if (Math.abs(x - ex(lo())) < 14) { endDrag = 'in'; if (inF === null) inF = lo(); return; }
      if (Math.abs(x - ex(hi() + 1)) < 14) { endDrag = 'out'; if (outF === null) outF = hi(); return; }
    }
    scrubbing = true; scrubMove(e);
    // held still: Set In / Set Out for that frame, right above the finger
    ioAt = { x: e.clientX }; clearTimeout(ioT);
    ioT = setTimeout(() => { if (!ioAt) return; scrubbing = false; navigator.vibrate && navigator.vibrate(12); showIo(ioAt.x); ioAt = null; changed('pos'); }, 450);
  });
  on(sc, 'pointermove', scrubMove);
  on(sc, 'pointerup', () => {
    clearTimeout(ioT); ioAt = null;
    if (endDrag) { endDrag = null; changed('inF', 'outF'); return; }
    if (scrubbing) { scrubbing = false; changed('pos'); }
  });
  on(sc, 'contextmenu', e => e.preventDefault());
  function showIo(x) {
    const m = $('ioMenu'); m.hidden = false;
    const pr = $('player').getBoundingClientRect(), sr = sc.getBoundingClientRect(), mw = m.offsetWidth;
    const left = Math.max(8, Math.min(pr.width - mw - 8, x - pr.left - mw / 2));
    m.style.left = left + 'px'; m.style.top = (sr.top - pr.top - m.offsetHeight - 10) + 'px';
    m.style.setProperty('--ax', (x - pr.left - left) + 'px');
  }
  function hideIo() { $('ioMenu').hidden = true; }
  $('ioClear').onclick = () => { hideIo(); inF = outF = null; draw(); poke(); changed('inF', 'outF'); };

  // ---------- In / Out: tap sets; hold clears that point; the loop chip clears both
  const pressed = { t: 0, long: false };
  $('inBtn').onclick = () => { hideIo(); if (pressed.long) return; inF = pos; if (outF !== null && outF < inF) outF = null; draw(); poke(); changed('inF', 'outF'); };
  $('outBtn').onclick = () => { hideIo(); if (pressed.long) return; outF = pos; if (inF !== null && inF > outF) inF = null; draw(); poke(); changed('inF', 'outF'); };
  for (const [id, clear] of [['inBtn', () => { inF = null; }], ['outBtn', () => { outF = null; }]]) {
    const el = $(id);
    on(el, 'pointerdown', () => { pressed.long = false; clearTimeout(pressed.t);
      pressed.t = setTimeout(() => { pressed.long = true; clear(); navigator.vibrate && navigator.vibrate(15); draw(); poke(); changed('inF', 'outF'); }, 450); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) on(el, ev, () => clearTimeout(pressed.t));
    on(el, 'contextmenu', e => e.preventDefault());
  }

  // ---------- playback: real time decides the frame, looping inside the range
  let raf = 0, startT = 0, startF = 0;
  function play() {
    if (pos < lo() || pos >= hi()) pos = lo();
    playing = true; $('play').textContent = '❚❚'; startT = performance.now(); startF = pos;
    const tick = now => {
      if (!playing) return;
      const a = lo(), len = hi() - a + 1;
      const f = startF + Math.floor((now - startT) / 1000 * fps * rate);
      pos = a + ((f - a) % len + len) % len;
      draw(); raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick); poke();
  }
  function stop() { const was = playing; playing = false; cancelAnimationFrame(raf); $('play').textContent = '▶︎'; showUi(); if (was) { drawCurve(); changed('pos'); } }
  $('play').onclick = () => playing ? stop() : play();
  $('stepBack').onclick = () => { stop(); stepBy(-1); draw(); changed('pos'); };
  $('stepFwd').onclick = () => { stop(); stepBy(1); draw(); changed('pos'); };

  // ---------- one play-rate control: presets + custom
  function setRate(r) {
    rate = Math.max(0.01, Math.min(8, r)); $('rateBtn').textContent = fmt(rate);
    if (playing) { startT = performance.now(); startF = pos; }
    renderRates();
  }
  function renderRates() {
    $('rateList').innerHTML = PRESETS.map(r => `<div class="opt${r === rate ? ' on' : ''}" data-r="${r}">${fmt(r)}</div>`).join('');
    $('customOpt').classList.toggle('on', !PRESETS.includes(rate));
    $('customOpt').textContent = PRESETS.includes(rate) ? 'Custom…' : `Custom (${fmt(rate)})`;
  }
  $('rateList').onclick = e => { const r = e.target.dataset.r; if (r) { setRate(+r); closeSheets(); changed('rate'); } };
  $('rateBtn').onclick = () => { $('customBox').style.display = 'none'; openSheet('rateVeil'); };
  $('customOpt').onclick = () => { $('customBox').style.display = 'block'; $('customIn').value = rate; $('customIn').focus(); };
  $('customOk').onclick = () => { const r = parseFloat($('customIn').value); if (r > 0) { setRate(r); changed('rate'); } closeSheets(); };

  // ---------- sheets
  function openSheet(id) { $(id).style.display = 'flex'; showUi(true); }
  function closeSheets() { for (const v of document.querySelectorAll('.veil')) v.style.display = 'none'; poke(); }
  for (const v of document.querySelectorAll('.veil')) on(v, 'click', e => { if (e.target === v) closeSheets(); });
  $('more').onclick = () => { stop(); renderNotes(); updateRetimeUi(); showAids(); openSheet('moreVeil'); };
  $('back').onclick = () => { stop(); onBack(); };
  $('reset').onclick = () => { zoom = 1; panX = panY = 0; draw(); closeSheets(); };

  // ---------- controls fade while playing; a tap brings them back
  let fadeT = 0;
  const uis = () => document.querySelectorAll('#player .ui');
  function showUi(stay) { for (const u of uis()) u.classList.remove('hide'); clearTimeout(fadeT); if (!stay) poke(); }
  function poke() {
    clearTimeout(fadeT); for (const u of uis()) u.classList.remove('hide');
    fadeT = setTimeout(() => { if (playing && !scrubbing && !mode) for (const u of uis()) u.classList.add('hide'); }, 2200);
  }
  const uiHidden = () => $('bot').classList.contains('hide');

  // ---------- touch on the video
  // Tools draw. Otherwise: one finger slides to scrub, a tap on the left/right third steps a frame,
  // a tap in the middle shows/hides the controls (double-tap there fits the zoom), two fingers pinch and pan.
  const pts = new Map(); let pinch = null, tapStart = null, lastTap = 0, sliding = false, erasing = null;
  // The eraser rubs out what it passes over in the drawing showing on this frame.
  function eraseAt() {
    const s = drawingAt(marks, holds, cur); if (s === null) return;
    const path = erasing.path.slice(-2), out = [];
    for (const m of marks) {
      if (!isDrawn(m) || m.f !== s) { out.push(m); continue; }
      if (m.type === 'draw') {
        const parts = eraseStroke(m.pts, path, erasing.r + (m.size || 3) / 2);
        if (parts.length === 1 && parts[0] === m.pts) { out.push(m); continue; }
        erasing.hit = true; for (const p of parts) out.push({ ...m, pts: p });
      } else if (path.some(p => hitsShape(m, p, erasing.r + (m.size || 3) / 2))) erasing.hit = true;
      else out.push(m);
    }
    marks = out;
    if (!drawingStarts(marks).includes(s)) delete holds[s];
    draw();
  }
  const box = () => cv.getBoundingClientRect();
  const toVideo = (x, y) => { const v = view(), d = v.d, b = box(); return [((x - b.left) * d - v.ox) / v.s, ((y - b.top) * d - v.oy) / v.s]; };
  const stepBy = n => { const a = lo(), len = hi() - a + 1; pos = a + (((pos - a + n) % len) + len) % len; };
  // two fingers tapped together: undo; three: redo (as in Procreate)
  let multi = null, pencilSeen = false, penPressure = false;
  // pressure to a width factor: harder presses thicken the line, as much as the Pressure setting says
  const pf = e => { const a = pen.pressure ?? 0.6, p = Math.min(1, (e.pressure || 0.5) * 1.6); return Math.round((1 - a + a * p * 1.4) * 100) / 100; };
  on(cv, 'pointerdown', e => {
    try { cv.setPointerCapture(e.pointerId); } catch {}
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) multi = { t: performance.now(), n: 1, moved: false, at: new Map() };
    if (multi) { multi.n = Math.max(multi.n, pts.size); multi.at.set(e.pointerId, [e.clientX, e.clientY]); }
    if (pts.size >= 3) { if (drag) drag = null; return; }
    if (pts.size === 2) {
      drag = null; tapStart = null; sliding = false; const [a, b] = [...pts.values()];
      pinch = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]), z0: zoom, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, px: panX, py: panY }; return;
    }
    tapStart = { x: e.clientX, y: e.clientY, t: performance.now(), f: pos };
    sliding = false;
    // Apple Pencil draws any time (the pen, or the shape or eraser picked); once it has been used,
    // fingers only scrub, pinch and move, like Procreate.
    const isPen = e.pointerType === 'pen'; if (isPen) pencilSeen = true;
    const tool_ = isPen ? (tool || 'draw') : (pencilSeen ? null : tool);
    penPressure = isPen && pen.pressure > 0;
    if (tool_) {
      const tool = tool_; tapStart = null;
      stop(); const [x, y] = toVideo(e.clientX, e.clientY);
      const v = view(), toVid = px => px * v.d / v.s;   // on-screen px to picture px at this zoom
      if (tool === 'erase') { remember(); erasing = { path: [[x, y]], r: toVid(ERASER), hit: false }; eraseAt(); return; }
      // Drawing on a frame where an earlier drawing still holds adds to that drawing.
      const s = drawingAt(marks, holds, cur), f = s ?? cur, style = { color: pen.color, size: Math.round(toVid(penPx()) * 10) / 10, ...(pen.alpha < 1 ? { alpha: Math.round(pen.alpha * 100) / 100 } : {}) };
      if (tool === 'draw') inkP = pf(e);
      drag = tool === 'draw' ? { f, type: 'draw', pts: [penPressure ? [x, y, inkP] : [x, y]], ...style } : { f, type: tool, x1: x, y1: y, x2: x, y2: y, ...style };
    }
  });
  on(cv, 'pointermove', e => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (multi && multi.at.has(e.pointerId)) { const [x0, y0] = multi.at.get(e.pointerId); if (Math.hypot(e.clientX - x0, e.clientY - y0) > 12) multi.moved = true; }
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()], dd = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const z = Math.max(0.3, Math.min(12, pinch.z0 * dd / pinch.d0));
      const r = box(), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, cxm = r.left + r.width / 2, cym = r.top + area.top + (r.height - area.top - area.bottom) / 2;
      panX = (pinch.mx - cxm - pinch.px) * (1 - z / pinch.z0) + pinch.px + (mx - pinch.mx);
      panY = (pinch.my - cym - pinch.py) * (1 - z / pinch.z0) + pinch.py + (my - pinch.my);
      zoom = z; clampPan(); draw(); return;
    }
    if (erasing) { erasing.path.push(toVideo(e.clientX, e.clientY)); eraseAt(); return; }
    if (drag) {
      const [x, y] = toVideo(e.clientX, e.clientY);
      if (drag.type === 'draw') {
        // Every pen sample (the Pencil reports many between frames), each pulled through the stabilizer;
        // a point is kept once the steadied pen has moved most of a screen pixel. Pressure is eased too.
        const k = view().s / (devicePixelRatio || 1), evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        for (const ev of evs.length ? evs : [e]) {
          const l = drag.pts[drag.pts.length - 1], [tx, ty] = steady(l, toVideo(ev.clientX, ev.clientY), pen.smooth ?? SMOOTH_DEFAULT);
          if (penPressure) inkP += (pf(ev) - inkP) * 0.4;
          if (Math.hypot(tx - l[0], ty - l[1]) * k < 0.75) continue;
          const q = [Math.round(tx * 10) / 10, Math.round(ty * 10) / 10];
          drag.pts.push(penPressure ? [...q, Math.round(inkP * 100) / 100] : q);
        }
      }
      else [drag.x2, drag.y2] = [x, y];
      draw(); return;
    }
    if (!tapStart) return;
    const dx = e.clientX - tapStart.x;
    if (!sliding && Math.abs(dx) > 8) { sliding = true; stop(); showUi(true); tapStart.x = e.clientX; }
    if (sliding) {
      const n = Math.round((e.clientX - tapStart.x) / PX_PER_FRAME);
      const a = lo(), len = hi() - a + 1; pos = a + (((tapStart.f - a + n) % len) + len) % len; draw();
    }
  });
  const up = e => {
    pts.delete(e.pointerId);
    if (multi && multi.n >= 2) {
      if (pts.size === 0) {
        const quick = !multi.moved && performance.now() - multi.t < 400, n = multi.n; multi = null; pinch = null; tapStart = null;
        if (quick) { stop(); $(n === 2 ? 'undo' : 'redo').click(); }
      } else if (pts.size < 2) pinch = null;
      return;
    }
    if (pinch) { if (pts.size < 2) pinch = null; tapStart = null; return; }
    if (erasing) { if (erasing.hit) changed('marks'); else undoStack.pop(); erasing = null; draw(); return; }
    if (drag) {
      const big = drag.type === 'draw' ? drag.pts.length > 2 : Math.hypot(drag.x2 - drag.x1, drag.y2 - drag.y1) > 6;
      if (big) { remember(); marks.push(drag); changed('marks'); usedColor(drag.color); } drag = null; draw(); return;
    }
    if (sliding) { sliding = false; tapStart = null; poke(); changed('pos'); return; }
    if (tapStart && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) < 10 && performance.now() - tapStart.t < 350) {
      const r = box(), third = (e.clientX - r.left) / r.width;
      if (third < 0.3) { stop(); stepBy(-1); draw(); changed('pos'); }
      else if (third > 0.7) { stop(); stepBy(1); draw(); changed('pos'); }
      else {
        const now = performance.now();
        if (now - lastTap < 300) { zoom = 1; panX = panY = 0; draw(); lastTap = 0; }
        else { lastTap = now; if (uiHidden()) poke(); else if (playing) for (const u of uis()) u.classList.add('hide'); }
      }
    }
    tapStart = null;
  };
  on(cv, 'pointerup', up); on(cv, 'pointercancel', up);
  on(window, 'resize', () => { sizeAll(); clampPan(); draw(); });
  // iPhone reports a rotation before it has laid the screen out again: size the canvases whenever their boxes
  // actually change, and once more after the turn settles, so the video never draws stretched.
  const ro = new ResizeObserver(() => { sizeAll(); clampPan(); draw(); });
  for (const el of [stage, sc, lane, $('wCurve')]) ro.observe(el);
  ac.signal.addEventListener('abort', () => ro.disconnect());
  on(window, 'orientationchange', () => setTimeout(() => { sizeAll(); clampPan(); draw(); }, 350));

  // ---------- note chip: a note on this frame shows at the top edge, only while paused
  const chipHidden = new Set();
  function showNoteChip() {
    const el = $('noteChip');
    const ns = playing ? [] : visible(cur).filter(m => m.type === 'note' && !chipHidden.has(m));
    if (!ns.length) { el.style.display = 'none'; return; }
    el.innerHTML = ns.map(m => `<div class="t"><span class="fn">FR ${m.f + 1}</span></div>`).join('');
    [...el.children].forEach((d, i) => d.append(document.createTextNode(ns[i].text)));
    el.style.display = 'block';
    el.onclick = () => { ns.forEach(m => chipHidden.add(m)); showNoteChip(); };
  }

  // ---------- annotate
  function pick(t) {
    tool = tool === t ? null : t;
    for (const k of ['draw', 'arrow', 'box', 'circle']) $(k + 'Btn').classList.toggle('on', tool === k);
    $('eraseBtn').classList.toggle('on', tool === 'erase');
    poke();
  }
  // ---------- modes: Draw, Note, Retime (or none: just watching). Each brings its own tools.
  let mode = null;
  const undoTo = slot => { $(slot).append($('undo'), $('redo')); };
  function setTray(open) {   // Draw mode: the tool card beside the Draw key, the edge sliders
    if (open) { setWarpMode(false); setNoteMode(false); undoTo('drawUndoSlot'); mode = 'draw'; } else if (mode === 'draw') mode = null;
    $('tray').hidden = !open; $('sizeSl').hidden = !open; $('opSl').hidden = !open; $('smSl').hidden = !open;
    if (!open || isPad()) $('penRow').hidden = !open;   // iPad: the colours sit in the panel while drawing
    $('annBtn').classList.toggle('on', open); $('player').classList.toggle('drawing', open);
    fitDock();
  }
  function setNoteMode(open) {
    if (open) { setTray(false); setWarpMode(false); mode = 'note'; } else if (mode === 'note') mode = null;
    $('pNotes').hidden = !open; $('noteMode').classList.toggle('on', open);
    if (open) $('noteBtnTxt').textContent = `Add note at ${cur + 1}`;
    fitDock();
  }
  $('annBtn').onclick = () => {
    const open = $('tray').hidden; setTray(open);
    if (open) { stop(); if (!tool) pick('draw'); showPen(); } else { if (tool) pick(null); showUi(); }
  };
  $('noteMode').onclick = () => { const open = $('pNotes').hidden; if (tool) pick(null); setNoteMode(open); };
  $('colorBtn').onclick = () => { $('penRow').hidden = !$('penRow').hidden; };
  // iPad: tuck the side panel away for watching, and back
  $('sideTab').onclick = () => { $('player').classList.toggle('tucked'); fitDock(); };
  // the bottom card's height places the mode pill and the tool cards just above it
  function fitDock() { requestAnimationFrame(() => { $('player').style.setProperty('--dockH', $('dock').offsetHeight + 'px'); sizeAll(); clampPan(); draw(); }); }
  $('drawBtn').onclick = () => pick('draw'); $('arrowBtn').onclick = () => pick('arrow'); $('boxBtn').onclick = () => pick('box'); $('circleBtn').onclick = () => pick('circle');
  const snap = () => ({ marks: JSON.parse(JSON.stringify(marks)), holds: { ...holds }, warp: warp && warp.map(k => ({ ...k })) });
  $('redo').onclick = () => restore(redoStack.pop(), undoStack);
  $('undo').onclick = () => restore(undoStack.pop(), redoStack);
  function restore(u, other) {
    if (!u) return; other.push(snap());
    const warpChanged = JSON.stringify(u.warp) !== JSON.stringify(warp);
    marks = u.marks; holds = u.holds; warp = u.warp;
    if (warpChanged) { retimed = warped() && (retimed || mode === 'retime'); rebuild(); updateRetimeUi(); drawCurve(); changed('warp', 'retimed'); }
    changed('marks', 'holds'); draw(); poke();
  }
  // ---------- pen bar: colour, size, eraser, clear this frame's drawing
  const savePen = () => { try { localStorage.setItem('qg_pen', JSON.stringify(pen)); } catch {} };
  const showPen = () => {
    showRecent();
    for (const b of document.querySelectorAll('#penRow .sw')) b.classList.toggle('on', b.dataset.color.toLowerCase() === pen.color.toLowerCase());
    $('colorBtn').style.setProperty('--c', pen.color);
    $('sizeSl').style.setProperty('--v', 1 - (penPx() - 1.5) / 12.5); $('opSl').style.setProperty('--v', 1 - pen.alpha);
    $('smSl').style.setProperty('--v', 1 - (pen.smooth ?? SMOOTH_DEFAULT));
    // the reading inside each pill, as Quarry shows it
    $('sizeSl').querySelector('.val').textContent = Math.round(penPx() * 2) / 2;
    $('opSl').querySelector('.val').textContent = `${Math.round(pen.alpha * 100)}%`;
    $('smSl').querySelector('.val').textContent = `${Math.round((pen.smooth ?? SMOOTH_DEFAULT) * 100)}%`;
    $('eraseBtn').classList.toggle('on', tool === 'erase');
  };
  // Quarry's palette: a column per colour (light, bright, dark), plus the colours you drew with lately
  const PAL = [['#FFFFFF', '#EDECEF', '#B5B4B9'], ['#6F6E73', '#2B2A2E', '#1D1C1E'],
    ['#E59A93', '#E5484D', '#7C3836'], ['#EBB27F', '#F08C3A', '#83522B'], ['#E8D07E', '#F5D153', '#866F30'],
    ['#9DCDA4', '#4FBF7A', '#426449'], ['#9AB8E3', '#5A8FF0', '#3D527C'], ['#BBA8E3', '#A98BEF', '#5A4A7B'], ['#E09EBF', '#E35D9B', '#78405B']];
  const swatch = c => `<button class="sw" data-color="${c}" style="--c:${c}" aria-label="${c}"></button>`;
  $('pal').innerHTML = PAL.flat().map(swatch).join('');
  let recent = []; try { recent = JSON.parse(localStorage.getItem('qg_recent') || '[]'); } catch {}
  function showRecent() { $('palRecent').innerHTML = recent.map(swatch).join(''); }
  const usedColor = c => { recent = [c, ...recent.filter(x => x.toLowerCase() !== c.toLowerCase())].slice(0, 8); try { localStorage.setItem('qg_recent', JSON.stringify(recent)); } catch {} showRecent(); };
  // + : the system colour picker, for any colour; the colour joins Recent
  $('palPick').oninput = $('palPick').onchange = () => {
    pen.color = $('palPick').value.toUpperCase(); if (tool === 'erase' || !tool) pick('draw');
    usedColor(pen.color); savePen(); showPen(); poke();
  };
  $('penRow').onclick = e => {
    const c = e.target.closest('.sw'), z = e.target.closest('.sz');
    if (c) { pen.color = c.dataset.color; if (tool === 'erase' || !tool) pick('draw'); if (!isPad()) $('penRow').hidden = true; }   // iPad: the colours stay in the panel
    if (z) { pen.size = +z.dataset.size; if (tool === 'erase' || !tool) pick('draw'); }
    if (c || z) { savePen(); showPen(); poke(); }
  };
  // size and opacity: drag the frosted sliders; a bubble shows the stroke while you do
  for (const [id, set, label] of [
    ['sizeSl', v => { pen.px = 1.5 + (1 - v) * 12.5; }, () => `Size ${Math.round((penPx() - 1.5) / 12.5 * 100)}%`],
    ['opSl', v => { pen.alpha = Math.max(.1, 1 - v); }, () => `Opacity ${Math.round(pen.alpha * 100)}%`],
    ['smSl', v => { pen.smooth = Math.round((1 - v) * 100) / 100; }, () => `Smoothing ${Math.round(pen.smooth * 100)}%`],
  ]) {
    const el = $(id); let on_ = false;
    const move = e => {
      // upright on iPhone (top = biggest); across the panel on iPad (right = biggest)
      const r = el.getBoundingClientRect(), across = r.width > r.height;
      const v = Math.max(0, Math.min(1, across ? 1 - (e.clientX - r.left - 13) / (r.width - 26) : (e.clientY - r.top - 13) / (r.height - 26)));
      set(v); showPen();
      const b = $('slBub'), pr = $('player').getBoundingClientRect(); b.hidden = false;
      b.style.top = (Math.max(8, Math.min(pr.height - 104, e.clientY - pr.top - 48))) + 'px';
      b.querySelector('span').textContent = label();
      const dot = b.querySelector('b'), dpx = Math.max(4, penPx() * 2.2);
      dot.style.width = dot.style.height = dpx + 'px'; dot.style.background = pen.color; dot.style.opacity = pen.alpha;
    };
    on(el, 'pointerdown', e => { el.setPointerCapture(e.pointerId); on_ = true; move(e); });
    on(el, 'pointermove', e => { if (on_) move(e); });
    for (const ev of ['pointerup', 'pointercancel']) on(el, ev, () => { if (!on_) return; on_ = false; $('slBub').hidden = true; if (tool === 'erase' || !tool) pick('draw'); savePen(); });
  }
  $('eraseBtn').onclick = () => { pick('erase'); showPen(); };
  $('clearBtn').onclick = () => {
    const s = drawingAt(marks, holds, cur); if (s === null) return;
    remember(); marks = marks.filter(m => !(isDrawn(m) && m.f === s)); delete holds[s];
    changed('marks', 'holds'); draw(); poke();
  };
  $('noteBtn').onclick = () => { stop(); if (tool) pick(null); hideIo(); $('noteCap').textContent = `Note on frame ${cur + 1}`; $('noteIn').value = ''; openSheet('noteVeil'); $('noteIn').focus(); };
  $('noteNo').onclick = closeSheets;
  $('noteOk').onclick = () => { const t = $('noteIn').value.trim(); closeSheets(); if (t) { remember(); marks.push({ f: cur, type: 'note', text: t }); changed('marks'); draw(); } };
  function jumpTo(f) {
    stop(); if (retimed && shown && !shown.has(f)) setView(false);
    pos = firstPos[f] >= 0 ? firstPos[f] : posAtOrAfter(seq, f); inF = outF = null; draw(); changed('pos', 'inF', 'outF');
  }
  // ---------- this video's notes and drawings, under the scrub bar: tap one to go to its frame
  const kindName = { draw: 'stroke', arrow: 'arrow', box: 'box', circle: 'circle' };
  let listItems = [];
  function renderList() {
    const notes = marks.filter(m => m.type === 'note'), starts = drawingStarts(marks);
    listItems = [
      ...notes.map(m => ({ f: m.f, note: m, text: m.text })),
      ...starts.map(st => {
        const ms = marks.filter(m => isDrawn(m) && m.f === st), kinds = [...new Set(ms.map(m => kindName[m.type]))];
        return { f: st, drawing: true, color: (ms[0] && ms[0].color) || '#FF3B5C',
          text: `Drawing · ${ms.length === 1 ? kinds[0] : `${ms.length} ${kinds.length === 1 ? kinds[0] + 's' : 'marks'}`}${holdOf(holds, st) > 1 ? ` · holds ${holdOf(holds, st)}` : ''}` };
      }),
    ].sort((a, b) => a.f - b.f || (a.drawing ? 1 : -1));
    const nNotes = notes.length, nDraw = starts.length;
    $('pSub').textContent = [`${seq.length} frames`, nNotes && `${nNotes} note${nNotes === 1 ? '' : 's'}`, nDraw && `${nDraw} drawing${nDraw === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    $('pNotesCap').textContent = listItems.length ? `Notes · ${listItems.length}` : 'Notes';
    const box = $('pList'); box.innerHTML = '';
    for (const it of listItems) {
      const d = document.createElement('div'); d.className = 'pli';
      d.innerHTML = '<span class="f"></span><span class="dot"></span><span class="x"></span>';
      d.querySelector('.f').textContent = it.f + 1; d.querySelector('.x').textContent = it.text;
      if (it.drawing) d.querySelector('.dot').style.background = it.color;
      d.onclick = () => jumpTo(it.f);
      box.append(d);
    }
    let none = $('pNotes').querySelector('.none');
    if (!listItems.length && !none) { none = document.createElement('p'); none.className = 'none'; none.textContent = 'No notes yet. Tap Draw to mark up a frame or add a note.'; $('pNotes').append(none); }
    if (listItems.length && none) none.remove();
    markList();
  }
  function markList() {  // light up what's showing on this frame
    const here = visible(cur), rows = $('pList').children;
    listItems.forEach((it, i) => rows[i] && rows[i].classList.toggle('on', it.note ? here.includes(it.note) : here.some(m => isDrawn(m) && m.f === it.f)));
  }
  function renderNotes() {
    const box = $('notes'); box.innerHTML = marks.length ? '' : '<div style="color:var(--mut);padding:8px 2px">No notes or marks yet.</div>';
    [...marks].map((m, i) => ({ m, i })).sort((a, b) => a.m.f - b.m.f).forEach(({ m, i }) => {
      const d = document.createElement('div'); d.className = 'note';
      d.innerHTML = '<span class="f"></span><span class="t"></span><span class="x">×</span>';
      d.querySelector('.f').textContent = `FR ${m.f + 1}`;
      d.querySelector('.t').textContent = m.type === 'note' ? m.text : m.type === 'draw' ? 'Drawing' : m.type[0].toUpperCase() + m.type.slice(1);
      d.querySelector('.t').onclick = () => { jumpTo(m.f); closeSheets(); };
      d.querySelector('.x').onclick = () => { remember(); marks.splice(i, 1); changed('marks'); renderNotes(); draw(); };
      box.append(d);
    });
  }

  // ---------- time warp: Retime swaps the rail to the curve's tools and the notes area to the curve
  function setView(r) {
    const src = seq[pos], sIn = inF == null ? null : seq[inF], sOut = outF == null ? null : seq[outF];
    retimed = r && warped(); rebuild();
    pos = posAtOrAfter(seq, src);
    inF = sIn == null ? null : posAtOrAfter(seq, sIn); outF = sOut == null ? null : posAtOrBefore(seq, sOut);
    if (inF != null && outF != null && outF < inF) inF = outF = null;
    updateRetimeUi(); draw(); drawCurve(); poke(); changed('retimed', 'pos', 'inF', 'outF');
  }
  function updateRetimeUi() {
    const w = warped(), vb = $('viewBtn'); vb.style.display = w ? '' : 'none';
    vb.textContent = retimed ? 'Retimed' : 'Original'; vb.classList.toggle('on', retimed);
    $('exportBoth').style.display = w ? '' : 'none';
    $('export').textContent = w ? 'Export retimed' : 'Export video';
  }
  let selKey = -1, wView = null;           // the selected key; the curve's view (null = the whole curve)
  function setWarpMode(open) {
    if (open) { setTray(false); setNoteMode(false); undoTo('warpUndoSlot'); mode = 'retime'; } else if (mode === 'retime') mode = null;
    $('wRows').hidden = !open; $('wTop').hidden = !open; $('wPanel').hidden = !open; $('wCap').hidden = !open; $('wInfo').hidden = !open;
    $('secBtn').classList.toggle('on', open); $('dock').classList.toggle('rt', open);
    fitDock();
    if (open) {
      stop();
      if (!warp) warp = TW.identity(frames.length);
      if (!retimed) { retimed = true; rebuild(); updateRetimeUi(); draw(); }
      selKey = TW.keyAt(warp, pos); requestAnimationFrame(() => { sizeCurve(); drawCurve(); });
    }
    poke();
  }
  // Every change to the curve goes through here: undo, the timeline, the panel and the saved review.
  function setWarp(keys, { keepPos = true, sel } = {}) {
    if (!keys) return;
    remember();
    const at = pos; warp = keys; retimed = true; rebuild();
    pos = keepPos ? Math.min(at, seq.length - 1) : pos;
    if (inF != null) inF = Math.min(inF, seq.length - 1); if (outF != null) outF = Math.min(outF, seq.length - 1);
    selKey = sel ?? Math.min(selKey, warp.length - 1);
    updateRetimeUi(); draw(); drawCurve(); changed('warp', 'retimed', 'pos', 'inF', 'outF');
  }
  const TAN_NAMES = { linear: 'Linear', smooth: 'Smooth', flat: 'Flat', step: 'Stepped' };
  // The key the Retime tools act on: the one picked, or the one under a parked playhead. While playing, only a
  // picked key counts, so the tools don't light up and grey out as the playhead passes each key.
  const selIndex = () => selKey >= 0 && selKey < (warp || []).length ? selKey : (warp && !playing ? TW.keyAt(warp, pos) : -1);
  $('secBtn').onclick = () => setWarpMode(mode !== 'retime');
  $('viewBtn').onclick = () => setView(!retimed);
  $('wKey').onclick = () => { const k = TW.setKey(warp, pos); setWarp(k, { sel: TW.keyAt(k, pos) }); };
  $('wLeft').onclick = () => { const k = TW.nudgeAfter(warp, pos, -1); if (k) setWarp(k); else status('Nothing after the playhead can move sooner', 0), setTimeout(() => status(''), 1600); };
  $('wRight').onclick = () => { const k = TW.nudgeAfter(warp, pos, 1); if (k) setWarp(k); else status('No keys after the playhead', 0), setTimeout(() => status(''), 1600); };
  const nudgeSel = d => { const i = selIndex(); if (i < 0) { status('Select a key (or set one) first', 0); setTimeout(() => status(''), 1600); return; } setWarp(TW.nudgeKey(warp, i, d, frames.length), { sel: i }); };
  $('wUp').onclick = () => nudgeSel(1);
  $('wDown').onclick = () => nudgeSel(-1);
  $('wTan').onclick = () => {
    const i = selIndex(); if (i < 0) return;
    const t = TW.TANS[(TW.TANS.indexOf(warp[i].t) + 1) % TW.TANS.length];
    setWarp(TW.setTangent(warp, i, t), { sel: i });
  };
  $('wDel').onclick = () => { const i = selIndex(); const k = i >= 0 && TW.deleteKey(warp, i); if (k) setWarp(k, { sel: -1 }); };
  // Reset this span: the span around the playhead plays at real time, later keys slide to keep their shape
  $('secSpan').onclick = () => { closeSheets(); const k = TW.resetSpan(warp, pos); if (k) setWarp(k, { sel: -1 }); else status('This span already plays at real time', 0), setTimeout(() => status(''), 1600); };
  // Reset the curve: every key stays on its video frame, all at real time, plain linear
  $('secReset').onclick = () => { closeSheets(); setWarp(TW.resetAll(warp), { sel: -1 }); };
  $('secClearAll').onclick = () => { closeSheets(); inF = outF = null; setWarp(TW.identity(frames.length), { sel: -1 }); };
  $('wFrame').onclick = () => { wView = wView ? null : TW.frameView(warp, pos); drawCurve(); };

  // the curve: played frames across, video frames up; the faint diagonal is the original timing
  const wc = $('wCurve'), wx = wc.getContext('2d');
  function sizeCurve() { const r = wc.getBoundingClientRect(), d = devicePixelRatio || 1; wc.width = Math.max(1, r.width * d); wc.height = Math.max(1, r.height * d); }
  function curveView() {
    if (wView) return wView;
    const last = warp[warp.length - 1].x, n = frames.length;
    return { x0: -last * 0.03, x1: last * 1.03, y0: -n * 0.04, y1: (n - 1) * 1.04 };
  }
  const CX = (v, x) => (x - v.x0) / (v.x1 - v.x0) * wc.width, CY = (v, y) => wc.height - (y - v.y0) / (v.y1 - v.y0) * wc.height;
  function drawCurve() {
    if ($('wPanel').hidden || !warp) return;
    const d = devicePixelRatio || 1, w = wc.width, h = wc.height, v = curveView(), f = TW.sampler(warp);
    wx.clearRect(0, 0, w, h);
    // grid every 10 or 50 frames
    const stepX = (v.x1 - v.x0) > 150 ? 50 : (v.x1 - v.x0) > 30 ? 10 : 5;
    wx.strokeStyle = 'rgba(255,255,255,.05)'; wx.lineWidth = d;
    for (let x = Math.ceil(v.x0 / stepX) * stepX; x < v.x1; x += stepX) { wx.beginPath(); wx.moveTo(CX(v, x), 0); wx.lineTo(CX(v, x), h); wx.stroke(); }
    for (let y = Math.ceil(v.y0 / stepX) * stepX; y < v.y1; y += stepX) { wx.beginPath(); wx.moveTo(0, CY(v, y)); wx.lineTo(w, CY(v, y)); wx.stroke(); }
    wx.strokeStyle = 'rgba(255,255,255,.14)'; wx.setLineDash([4 * d, 4 * d]);
    wx.beginPath(); wx.moveTo(CX(v, 0), CY(v, 0)); wx.lineTo(CX(v, frames.length - 1), CY(v, frames.length - 1)); wx.stroke(); wx.setLineDash([]);
    // In-Out range
    if (inF != null || outF != null) { wx.fillStyle = 'rgba(74,117,144,.18)'; wx.fillRect(CX(v, lo()), 0, CX(v, hi()) - CX(v, lo()), h); }
    // the curve
    const last = warp[warp.length - 1].x;
    wx.strokeStyle = '#7FB2FF'; wx.lineWidth = 2.5 * d; wx.beginPath();
    const steps = Math.min(800, Math.max(60, Math.round(w / d)));
    for (let i = 0; i <= steps; i++) {
      const x = Math.max(0, v.x0) + (Math.min(last, v.x1) - Math.max(0, v.x0)) * i / steps, px = CX(v, x), py = CY(v, f(x));
      i ? wx.lineTo(px, py) : wx.moveTo(px, py);
    }
    wx.stroke();
    // playhead
    wx.strokeStyle = '#7FD4B0'; wx.lineWidth = 2 * d; wx.beginPath(); wx.moveTo(CX(v, pos), 0); wx.lineTo(CX(v, pos), h); wx.stroke();
    // keys: stepped as squares, flat as bars, smooth and linear as dots (linear hollow)
    warp.forEach((k, i) => {
      const px = CX(v, k.x), py = CY(v, k.y), on = i === selIndex(), r = (on ? 7 : 5) * d;
      wx.fillStyle = on ? '#FF4D67' : '#EEF0F3'; wx.strokeStyle = wx.fillStyle; wx.lineWidth = 2 * d;
      if (k.t === 'step') wx.fillRect(px - r, py - r, r * 2, r * 2);
      else if (k.t === 'flat') { wx.fillRect(px - r * 1.4, py - r * 0.5, r * 2.8, r); }
      else { wx.beginPath(); wx.arc(px, py, r, 0, Math.PI * 2); k.t === 'linear' ? (wx.fillStyle = '#1D2024', wx.fill(), wx.stroke()) : wx.fill(); }
    });
    const i = selIndex();
    $('wInfo').textContent = i >= 0 ? `Key ${i + 1} · played ${warp[i].x + 1} → video ${Math.round(warp[i].y) + 1}` : `Frame ${pos + 1} shows ${seq[pos] + 1}`;
    $('wTan').lastElementChild.textContent = i >= 0 ? TAN_NAMES[warp[i].t] : 'Tangent';
    $('wTan').disabled = $('wDel').disabled = $('wUp').disabled = $('wDown').disabled = i < 0;
    $('wDel').disabled = i <= 0 || i >= warp.length - 1;
    $('wFrame').textContent = wView ? 'All' : 'Frame';
  }
  // tap a key to select it (and go to it); drag it to move it; tap anywhere else to move the playhead
  let wDrag = null;
  const wPoint = e => { const r = wc.getBoundingClientRect(), d = devicePixelRatio || 1, v = curveView();
    const px = (e.clientX - r.left) * d, py = (e.clientY - r.top) * d;
    return { px, py, x: v.x0 + px / wc.width * (v.x1 - v.x0), y: v.y0 + (wc.height - py) / wc.height * (v.y1 - v.y0), v }; };
  on(wc, 'pointerdown', e => {
    if (!warp) return; const p = wPoint(e), d = devicePixelRatio || 1;
    let best = -1, bd = 24 * d;
    warp.forEach((k, i) => { const dd = Math.hypot(CX(p.v, k.x) - p.px, CY(p.v, k.y) - p.py); if (dd < bd) { bd = dd; best = i; } });
    wc.setPointerCapture(e.pointerId);
    if (best >= 0) { selKey = best; wDrag = { i: best, moved: false, x0: e.clientX, y0: e.clientY }; pos = Math.min(seq.length - 1, warp[best].x); draw(); drawCurve(); changed('pos'); }
    // anywhere else: a tap steps a frame towards that side of the playhead; a drag scrubs
    else wDrag = { scrub: true, moved: false, x0: e.clientX, y0: e.clientY, side: p.x < pos ? -1 : 1 };
  });
  on(wc, 'pointermove', e => {
    if (!wDrag) return; const p = wPoint(e);
    if (wDrag.scrub) {
      if (!wDrag.moved && Math.hypot(e.clientX - wDrag.x0, e.clientY - wDrag.y0) < 8) return;
      wDrag.moved = true; selKey = -1; pos = Math.max(0, Math.min(seq.length - 1, Math.round(p.x))); draw(); drawCurve(); return;
    }
    if (!wDrag.moved && Math.hypot(e.clientX - wDrag.x0, e.clientY - wDrag.y0) < 6) return;
    if (!wDrag.moved) { remember(); wDrag.moved = true; }
    warp = TW.moveKey(warp, wDrag.i, p.x, p.y, frames.length); retimed = true; rebuild();
    pos = Math.min(warp[wDrag.i].x, seq.length - 1); updateRetimeUi(); draw(); drawCurve();
  });
  const wEnd = () => {
    if (wDrag && wDrag.scrub) { if (!wDrag.moved) { stop(); stepBy(wDrag.side); draw(); } changed('pos'); }
    else if (wDrag && wDrag.moved) changed('warp', 'retimed', 'pos');
    wDrag = null;
  };
  on(wc, 'pointerup', wEnd); on(wc, 'pointercancel', () => { if (wDrag && wDrag.moved) wEnd(); wDrag = null; });

  // Shape: Hold, Cut or a speed over In-Out (played frames), as keys on the curve
  let range = null;
  function openRetime() {
    stop();
    const ok = inF !== null && outF !== null;
    $('secBody').style.display = ok ? '' : 'none'; $('secMsg').style.display = ok ? 'none' : '';
    $('secCap').textContent = ok ? `Played frames ${lo() + 1}–${hi() + 1}` : 'Shape';
    $('secRates').innerHTML = PRESETS.map(x => `<div class="opt" data-r="${x}">${fmt(x)}</div>`).join('');
    $('secHold').classList.remove('on'); $('secCut').classList.remove('on');
    $('secCustomBox').style.display = 'none'; $('secCustom').textContent = 'Custom speed…';
    range = ok ? [lo(), hi()] : null;
    openSheet('secVeil');
  }
  function applySec(type, r) {
    if (!range) return; const [a, b] = range;
    const base = warp || TW.identity(frames.length);
    const keys = type === 'hold' ? TW.holdRange(base, a, b) : type === 'cut' ? TW.cutRange(base, a, b) : TW.speedRange(base, a, b, r);
    closeSheets(); inF = outF = null;
    setWarp(keys, { sel: -1 });
    if (type !== 'cut') { const m = type === 'hold' ? b - a + 1 : Math.max(1, Math.round((b - a + 1) / r)); inF = a; outF = Math.min(seq.length - 1, a + m - 1); pos = a; }
    else pos = Math.min(a, seq.length - 1);
    draw(); drawCurve(); changed('inF', 'outF', 'pos');
  }
  $('wShape').onclick = openRetime;
  $('secRates').onclick = e => { const r = e.target.dataset.r; if (r) applySec('speed', +r); };
  $('secHold').onclick = () => applySec('hold');
  $('secCut').onclick = () => applySec('cut');
  $('secClear').onclick = () => applySec('speed', 1);
  $('secCustom').onclick = () => { $('secCustomBox').style.display = 'block'; $('secCustomIn').value = ''; $('secCustomIn').focus(); };
  $('secCustomOk').onclick = () => { const r = parseFloat($('secCustomIn').value); if (r > 0) applySec('speed', Math.max(0.01, Math.min(8, r))); };

  // ---------- full screen, where the browser allows it (not iPhone Safari; the home-screen app is full screen anyway)
  const fsEl = document.documentElement;
  $('fsBtn').style.display = (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen) && !matchMedia('(display-mode: standalone)').matches ? '' : 'none';
  $('fsBtn').onclick = async () => {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else await (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen).call(fsEl);
    } catch { $('fsBtn').style.display = 'none'; }
    poke();
  };

  // ---------- export
  // exports carry the tracing paper (as Quarry's do) but not the onion skin
  const exportCompose = (...a) => { quietAids = true; try { compose(...a); } finally { quietAids = false; } };
  const exportCtx = () => ({ frames, fps, W, H, marks, warpSeq: warped() ? TW.frameMap(warp, frames.length) : null, name, compose: exportCompose, closeSheets, stop, loading: () => media.loading, left: () => ac.signal.aborted });

  // ---------- drawing aids, in More
  function showAids() {
    $('onionBtn').classList.toggle('on', onion.on); $('paperBtn').classList.toggle('on', trace > 0);
    $('onionBefore').querySelector('.n').textContent = onion.before; $('onionAfter').querySelector('.n').textContent = onion.after;
    for (const b of document.querySelectorAll('#paperAmt .chip')) b.classList.toggle('on', +b.dataset.t === (trace || lastTrace));
  }
  const saveOnion = () => { try { localStorage.setItem('qg_onion', JSON.stringify(onion)); } catch {} };
  $('onionBtn').onclick = () => { onion.on = !onion.on; saveOnion(); showAids(); draw(); };
  for (const [id, k] of [['onionBefore', 'before'], ['onionAfter', 'after']]) $(id).onclick = e => {
    const d = +e.target.dataset.d; if (!d) return;
    onion[k] = Math.max(k === 'before' ? 1 : 0, Math.min(5, onion[k] + d)); onion.on = true; saveOnion(); showAids(); draw();
  };
  const setTrace = t => { trace = t; if (t > 0) lastTrace = t; showAids(); draw(); changed('trace'); };
  $('paperBtn').onclick = () => setTrace(trace > 0 ? 0 : lastTrace);
  $('paperAmt').onclick = e => { const t = +e.target.dataset.t; if (t) setTrace(t); };
  $('export').onclick = () => exportVideo(warped() ? 'retimed' : 'notes', exportCtx());
  $('exportBoth').onclick = () => exportVideo('both', exportCtx());

  // ---------- start
  $('player').classList.add('open'); $('pName').textContent = name;
  for (const k of ['draw', 'arrow', 'box', 'circle']) $(k + 'Btn').classList.remove('on');
  setTray(false); setWarpMode(false); wView = null;
  $('log2').textContent = '';
  rebuild(); setRate(rate); updateRetimeUi(); sizeAll(); closeSheets(); renderList(); draw(); poke();
  let drawT = 0;
  media.onFrame = () => { const now = performance.now(); if (!playing && now - drawT > 120) { drawT = now; draw(); } };
  media.done.then(() => { if (!ac.signal.aborted) { log(`${name}: ${media.count} frames, loaded in`); draw(); } });

  return {
    close() { stop(); ac.abort(); media.cancel(); $('player').classList.remove('open'); closeSheets(); },
  };
}

