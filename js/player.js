// The review player: exact frames, play rate, zoom, loop, notes and shapes, retime sections.
// Ported from the "Vista review test" spike. One player at a time; state comes in from a review
// and every edit goes back out through onChange with just the fields that changed.
import { buildSeq, applySection, isCut, posAtOrAfter, posAtOrBefore } from './retime.js';
import { exportVideo } from './export.js';
import { renderer, roundRect } from './render.js';
export { roundRect };
import { isDrawn, drawingAt, drawingStarts, holdOf, legacyHolds, eraseStroke, hitsShape } from './draw.js';

const $ = id => document.getElementById(id);
export const PRESETS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
export const fmt = r => (Math.round(r * 100) / 100) + '×';
const PEN_SIZES = { 1: 2.5, 2: 4.5, 3: 9 };   // on-screen px, so drawing zoomed in gives finer lines
const ERASER = 14;        // on-screen px
const PX_PER_FRAME = 10;  // one-finger slide

export function log(s) { const l = $('log2'); if (l) l.textContent += s + '\n'; }
export function status(t, p) { $('status').style.display = t ? 'block' : 'none'; $('stxt').textContent = t || ''; $('sbar').style.width = ((p || 0) * 100) + '%'; }

export function openPlayer(root, { media, review = null, name = 'clip', onChange = () => {}, onBack = () => {} }) {
  const ac = new AbortController(), on = (el, ev, fn) => el.addEventListener(ev, fn, { signal: ac.signal });
  const cv = $('cv'), cx = cv.getContext('2d'), sc = $('scrub'), sx = sc.getContext('2d'), lane = $('drawLane'), lx = lane.getContext('2d');
  const { fps, W, H, frames } = media;
  const r0 = review || {};
  let marks = r0.marks ? [...r0.marks] : [], secs = r0.secs ? [...r0.secs] : [], retimed = !!r0.retimed && secs.length > 0;
  let inF = r0.inF ?? null, outF = r0.outF ?? null, rate = r0.rate || 1, pos = r0.pos || 0;
  // How long each frame's drawing holds. Reviews from before holds existed keep their 12 frames.
  let holds = r0.holds ? { ...r0.holds } : legacyHolds(marks);
  let pen = { color: '#FF3B5C', size: 2 };
  try { pen = { ...pen, ...JSON.parse(localStorage.getItem('qg_pen') || '{}') }; } catch {}
  const undoStack = [];
  const remember = () => { undoStack.push({ marks: JSON.parse(JSON.stringify(marks)), holds: { ...holds } }); if (undoStack.length > 60) undoStack.shift(); };
  let seq = [0], segAt = [null], cutMarks = [], firstPos = new Int32Array(1);
  let cur = 0, playing = false, tool = null, drag = null, zoom = 1, panX = 0, panY = 0;
  const changed = (...keys) => { const o = {}; for (const k of keys) o[k] = { marks, secs, retimed, inF, outF, rate, pos, holds }[k]; onChange(o); };

  // ---------- timeline
  function rebuild() {
    const b = buildSeq(frames.length, secs, retimed); seq = b.seq; segAt = b.at; cutMarks = b.cuts;
    firstPos = new Int32Array(Math.max(1, frames.length)).fill(-1);
    for (let p = seq.length - 1; p >= 0; p--) firstPos[seq[p]] = p;
    pos = Math.max(0, Math.min(seq.length - 1, pos));
  }
  const lo = () => inF ?? 0, hi = () => outF ?? seq.length - 1;

  // ---------- view: fit to screen, then the viewer's zoom and pan
  function sizeAll() {
    const d = devicePixelRatio || 1;
    cv.width = innerWidth * d; cv.height = innerHeight * d;
    const r = sc.getBoundingClientRect(); sc.width = r.width * d; sc.height = r.height * d;
    const lr = lane.getBoundingClientRect(); lane.width = lr.width * d; lane.height = lr.height * d;
  }
  function view() {
    const d = devicePixelRatio || 1, fit = Math.min(cv.width / W, cv.height / H), s = fit * zoom;
    return { d, s, ox: (cv.width - W * s) / 2 + panX * d, oy: (cv.height - H * s) / 2 + panY * d };
  }
  function clampPan() {
    const d = devicePixelRatio || 1, v = view();
    const mx = Math.max(0, (W * v.s - cv.width) / 2) / d, my = Math.max(0, (H * v.s - cv.height) / 2) / d;
    panX = Math.max(-mx, Math.min(mx, panX)); panY = Math.max(-my, Math.min(my, panY));
  }

  // ---------- marks (drawn by render.js, shared with the review exporter)
  const { drawMark, visible, compose } = renderer({ frames, W, H, state: () => ({ marks, holds, secs, retimed }) });

  // ---------- drawing
  const secLabel = z => z.type === 'speed' ? fmt(z.r) : z.type;
  function draw() {
    cur = seq[pos] ?? 0;
    const v = view();
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.fillStyle = '#1D2024'; cx.fillRect(0, 0, cv.width, cv.height);
    cx.setTransform(v.s, 0, 0, v.s, v.ox, v.oy);
    cx.imageSmoothingQuality = zoom > 2 ? 'low' : 'high';
    compose(cx, cur, false); if (drag) drawMark(cx, drag);
    showNoteChip();
    cx.setTransform(1, 0, 0, 1, 0, 0);
    $('fr').innerHTML = `<b>${pos + 1}</b> / ${seq.length}${retimed ? ` · fr ${cur + 1}` : ''}`;
    const got = media.loading ? frames.reduce((n, x) => n + (x ? 1 : 0), 0) : 0;
    $('tc').textContent = `${(pos / fps).toFixed(2)}s · ${fps} fps${zoom > 1.01 ? ' · ' + zoom.toFixed(1) + '× zoom' : ''}${media.loading ? ` · loading ${Math.round(got / frames.length * 100)}%` : ''}`;
    const hasR = inF !== null || outF !== null;
    $('rangeTxt').textContent = hasR ? `Loop ${lo() + 1}–${hi() + 1}` : ''; $('rangeChip').style.display = hasR ? '' : 'none';
    $('inBtn').textContent = inF !== null ? `In ${inF + 1}` : 'In'; $('inBtn').classList.toggle('on', inF !== null);
    $('outBtn').textContent = outF !== null ? `Out ${outF + 1}` : 'Out'; $('outBtn').classList.toggle('on', outF !== null);
    drawScrub();
  }
  function drawScrub() {
    const w = sc.width, h = sc.height, d = devicePixelRatio || 1, n = seq.length, X = f => w * (f + 0.5) / n, E = p => w * p / n;
    sx.clearRect(0, 0, w, h);
    const r = (x, y, ww, hh, rr) => { sx.beginPath(); sx.roundRect ? sx.roundRect(x, y, ww, hh, rr) : sx.rect(x, y, ww, hh); sx.fill(); };
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
      sx.fillStyle = 'rgba(74,117,144,.30)'; r(X(lo()) - 3 * d, h / 2 - 11 * d, X(hi()) - X(lo()) + 6 * d, 22 * d, 6 * d);
      sx.fillStyle = '#86B0C2'; for (const f of [lo(), hi()]) r(X(f) - 2 * d, h / 2 - 13 * d, 4 * d, 26 * d, 2 * d);
    }
    sx.fillStyle = 'rgba(255,255,255,.08)'; r(0, h / 2 - 3 * d, w, 6 * d, 3 * d);
    sx.fillStyle = '#86B0C2'; r(0, h / 2 - 3 * d, X(pos), 6 * d, 3 * d);
    sx.fillStyle = '#E8908C'; for (const m of marks) { const p = firstPos[m.f]; if (p >= 0 && !(retimed && isCut(secs, m.f))) r(X(p) - 1.5 * d, h / 2 + 7 * d, 3 * d, 7 * d, 1.5 * d); }
    if (media.loading) { sx.fillStyle = '#6FBF8E'; for (let p = 0; p < n;) { const has = !!frames[seq[p]]; let q = p; while (q < n && !!frames[seq[q]] === has) q++; if (has) sx.fillRect(E(p), h - 3 * d, E(q) - E(p), 2 * d); p = q; } }
    // handle: a fingertip-sized raised key standing proud of the lane, with grip lines, lit from above
    const hx = X(pos), hw = 22 * d, hh = h - 4 * d, hy = 2 * d;
    sx.save(); sx.shadowColor = 'rgba(0,0,0,.5)'; sx.shadowBlur = 8 * d; sx.shadowOffsetY = 2 * d;
    sx.fillStyle = '#3E454E'; r(hx - hw / 2, hy, hw, hh, 8 * d); sx.restore();
    sx.fillStyle = 'rgba(255,255,255,.14)'; r(hx - hw / 2 + 2 * d, hy + 1 * d, hw - 4 * d, 1.5 * d, d);
    sx.fillStyle = '#ECEEF1'; for (const o of [-4, 0, 4]) r(hx + o * d - 0.75 * d, h / 2 - 6 * d, 1.5 * d, 12 * d, 0.75 * d);
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
  const scrubMove = e => { if (!scrubbing) return; pos = Math.max(lo(), Math.min(hi(), frameAt(e))); draw(); };
  on(sc, 'pointerdown', e => { stop(); sc.setPointerCapture(e.pointerId); poke(); scrubbing = true; scrubMove(e); });
  on(sc, 'pointermove', scrubMove);
  on(sc, 'pointerup', () => { if (scrubbing) { scrubbing = false; changed('pos'); } });

  // ---------- In / Out: tap sets; hold clears that point; the loop chip clears both
  const pressed = { t: 0, long: false };
  $('inBtn').onclick = () => { if (pressed.long) return; inF = pos; if (outF !== null && outF < inF) outF = null; draw(); poke(); changed('inF', 'outF'); };
  $('outBtn').onclick = () => { if (pressed.long) return; outF = pos; if (inF !== null && inF > outF) inF = null; draw(); poke(); changed('inF', 'outF'); };
  $('rangeChip').onclick = () => { inF = outF = null; draw(); poke(); changed('inF', 'outF'); };
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
  function stop() { const was = playing; playing = false; cancelAnimationFrame(raf); $('play').textContent = '▶︎'; showUi(); if (was) changed('pos'); }
  $('play').onclick = () => playing ? stop() : play();

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
  $('more').onclick = () => { stop(); renderNotes(); updateRetimeUi(); openSheet('moreVeil'); };
  $('back').onclick = () => { stop(); onBack(); };
  $('reset').onclick = () => { zoom = 1; panX = panY = 0; draw(); closeSheets(); };

  // ---------- controls fade while playing; a tap brings them back
  let fadeT = 0;
  const uis = () => document.querySelectorAll('#player .ui');
  function showUi(stay) { for (const u of uis()) u.classList.remove('hide'); clearTimeout(fadeT); if (!stay) poke(); }
  function poke() {
    clearTimeout(fadeT); for (const u of uis()) u.classList.remove('hide');
    fadeT = setTimeout(() => { if (playing && !scrubbing && $('tray').hidden) for (const u of uis()) u.classList.add('hide'); }, 2200);
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
  const toVideo = (x, y) => { const v = view(), d = v.d; return [(x * d - v.ox) / v.s, (y * d - v.oy) / v.s]; };
  const stepBy = n => { const a = lo(), len = hi() - a + 1; pos = a + (((pos - a + n) % len) + len) % len; };
  on(cv, 'pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      drag = null; tapStart = null; sliding = false; const [a, b] = [...pts.values()];
      pinch = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]), z0: zoom, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, px: panX, py: panY }; return;
    }
    tapStart = { x: e.clientX, y: e.clientY, t: performance.now(), f: pos };
    sliding = false;
    if (tool) {
      stop(); const [x, y] = toVideo(e.clientX, e.clientY);
      const v = view(), toVid = px => px * v.d / v.s;   // on-screen px to picture px at this zoom
      if (tool === 'erase') { remember(); erasing = { path: [[x, y]], r: toVid(ERASER), hit: false }; eraseAt(); return; }
      // Drawing on a frame where an earlier drawing still holds adds to that drawing.
      const s = drawingAt(marks, holds, cur), f = s ?? cur, style = { color: pen.color, size: Math.round(toVid(PEN_SIZES[pen.size]) * 10) / 10 };
      drag = tool === 'draw' ? { f, type: 'draw', pts: [[x, y]], ...style } : { f, type: tool, x1: x, y1: y, x2: x, y2: y, ...style };
    }
  });
  on(cv, 'pointermove', e => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()], dd = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const z = Math.max(1, Math.min(12, pinch.z0 * dd / pinch.d0));
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, cxm = innerWidth / 2, cym = innerHeight / 2;
      panX = (pinch.mx - cxm - pinch.px) * (1 - z / pinch.z0) + pinch.px + (mx - pinch.mx);
      panY = (pinch.my - cym - pinch.py) * (1 - z / pinch.z0) + pinch.py + (my - pinch.my);
      zoom = z; clampPan(); draw(); return;
    }
    if (erasing) { erasing.path.push(toVideo(e.clientX, e.clientY)); eraseAt(); return; }
    if (drag) {
      const [x, y] = toVideo(e.clientX, e.clientY);
      if (drag.type === 'draw') { const l = drag.pts[drag.pts.length - 1]; if (Math.hypot(x - l[0], y - l[1]) * view().s / (devicePixelRatio || 1) > 2) drag.pts.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]); }
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
    if (pinch) { if (pts.size < 2) pinch = null; tapStart = null; return; }
    if (erasing) { if (erasing.hit) changed('marks'); else undoStack.pop(); erasing = null; draw(); return; }
    if (drag) {
      const big = drag.type === 'draw' ? drag.pts.length > 2 : Math.hypot(drag.x2 - drag.x1, drag.y2 - drag.y1) > 6;
      if (big) { remember(); marks.push(drag); changed('marks'); } drag = null; draw(); return;
    }
    if (sliding) { sliding = false; tapStart = null; poke(); changed('pos'); return; }
    if (tapStart && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) < 10 && performance.now() - tapStart.t < 350) {
      const third = e.clientX / innerWidth;
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
    $('annBtn').textContent = tool ? tool[0].toUpperCase() + tool.slice(1) : 'Annotate';
    $('annBtn').classList.toggle('on', !!tool); poke();
  }
  $('annBtn').onclick = () => {
    const t = $('tray'); t.hidden = !t.hidden; $('penRow').hidden = t.hidden; $('annBtn').classList.toggle('open', !t.hidden);
    if (!t.hidden) { stop(); showPen(); } else { if (tool) pick(null); showUi(); }   // closing the menu puts the pen down
  };
  $('drawBtn').onclick = () => pick('draw'); $('arrowBtn').onclick = () => pick('arrow'); $('boxBtn').onclick = () => pick('box'); $('circleBtn').onclick = () => pick('circle');
  $('undo').onclick = () => {
    const u = undoStack.pop(); if (!u) return;
    marks = u.marks; holds = u.holds; changed('marks', 'holds'); draw(); poke();
  };
  // ---------- pen bar: colour, size, eraser, clear this frame's drawing
  const savePen = () => { try { localStorage.setItem('qg_pen', JSON.stringify(pen)); } catch {} };
  const showPen = () => {
    for (const b of document.querySelectorAll('#penRow .sw')) b.classList.toggle('on', b.dataset.color === pen.color);
    for (const b of document.querySelectorAll('#penRow .sz')) b.classList.toggle('on', +b.dataset.size === pen.size);
    $('eraseBtn').classList.toggle('on', tool === 'erase');
  };
  $('penRow').onclick = e => {
    const c = e.target.closest('.sw'), z = e.target.closest('.sz');
    if (c) { pen.color = c.dataset.color; if (tool === 'erase' || !tool) pick('draw'); }
    if (z) { pen.size = +z.dataset.size; if (tool === 'erase' || !tool) pick('draw'); }
    if (c || z) { savePen(); showPen(); poke(); }
  };
  $('eraseBtn').onclick = () => { pick('erase'); showPen(); };
  $('clearBtn').onclick = () => {
    const s = drawingAt(marks, holds, cur); if (s === null) return;
    remember(); marks = marks.filter(m => !(isDrawn(m) && m.f === s)); delete holds[s];
    changed('marks', 'holds'); draw(); poke();
  };
  $('noteBtn').onclick = () => { stop(); $('noteCap').textContent = `Note on frame ${cur + 1}`; $('noteIn').value = ''; openSheet('noteVeil'); $('noteIn').focus(); };
  $('noteNo').onclick = closeSheets;
  $('noteOk').onclick = () => { const t = $('noteIn').value.trim(); closeSheets(); if (t) { remember(); marks.push({ f: cur, type: 'note', text: t }); changed('marks'); draw(); } };
  function renderNotes() {
    const box = $('notes'); box.innerHTML = marks.length ? '' : '<div style="color:var(--mut);padding:8px 2px">No notes or marks yet.</div>';
    [...marks].map((m, i) => ({ m, i })).sort((a, b) => a.m.f - b.m.f).forEach(({ m, i }) => {
      const d = document.createElement('div'); d.className = 'note';
      d.innerHTML = '<span class="f"></span><span class="t"></span><span class="x">×</span>';
      d.querySelector('.f').textContent = `FR ${m.f + 1}`;
      d.querySelector('.t').textContent = m.type === 'note' ? m.text : m.type === 'draw' ? 'Drawing' : m.type[0].toUpperCase() + m.type.slice(1);
      d.querySelector('.t').onclick = () => { if (retimed && isCut(secs, m.f)) setView(false); pos = firstPos[m.f] >= 0 ? firstPos[m.f] : posAtOrAfter(seq, m.f); inF = outF = null; closeSheets(); draw(); changed('pos', 'inF', 'outF'); };
      d.querySelector('.x').onclick = () => { remember(); marks.splice(i, 1); changed('marks'); renderNotes(); draw(); };
      box.append(d);
    });
  }

  // ---------- retime sections
  function setView(r) {
    const src = seq[pos], sIn = inF == null ? null : seq[inF], sOut = outF == null ? null : seq[outF];
    retimed = r && secs.length > 0; rebuild();
    pos = posAtOrAfter(seq, src);
    inF = sIn == null ? null : posAtOrAfter(seq, sIn); outF = sOut == null ? null : posAtOrBefore(seq, sOut);
    if (inF != null && outF != null && outF < inF) inF = outF = null;
    updateRetimeUi(); draw(); poke(); changed('retimed', 'pos', 'inF', 'outF');
  }
  function updateRetimeUi() {
    const vb = $('viewBtn'); vb.style.display = secs.length ? '' : 'none';
    vb.textContent = retimed ? 'Retimed' : 'Original'; vb.classList.toggle('on', retimed);
    $('exportBoth').style.display = secs.length ? '' : 'none';
    $('export').textContent = secs.length ? 'Export retimed' : 'Export video';
  }
  let range = null, editing = null;
  function openRetime() {
    stop(); editing = null;
    const hasRange = inF !== null || outF !== null;
    if (!hasRange && segAt[pos]) editing = segAt[pos];
    let a, b;
    if (hasRange) { const ps = seq.slice(lo(), hi() + 1); a = Math.min(...ps); b = Math.max(...ps); }
    else if (editing) { a = editing.a; b = editing.b; }
    const ok = a !== undefined;
    $('secBody').style.display = ok ? '' : 'none'; $('secMsg').style.display = ok ? 'none' : '';
    $('secCap').textContent = ok ? `Frames ${a + 1}–${b + 1}${editing ? ' · ' + secLabel(editing) : ''}` : 'Retime';
    const r = editing && editing.type === 'speed' ? editing.r : null;
    $('secRates').innerHTML = PRESETS.map(x => `<div class="opt${x === r ? ' on' : ''}" data-r="${x}">${fmt(x)}</div>`).join('');
    $('secHold').classList.toggle('on', !!editing && editing.type === 'hold');
    $('secCut').classList.toggle('on', !!editing && editing.type === 'cut');
    $('secCustomBox').style.display = 'none';
    $('secCustom').textContent = r !== null && !PRESETS.includes(r) ? `Custom (${fmt(r)})` : 'Custom speed…';
    range = ok ? [a, b] : null;
    openSheet('secVeil');
  }
  function applySec(type, r) {
    if (!range) return; const [a, b] = range;
    const res = applySection(secs, a, b, type, r);
    secs = res.secs; inF = outF = null; closeSheets();
    retimed = secs.length > 0; rebuild();
    if (res.mine && type !== 'cut') {
      const ps = []; segAt.forEach((z, i) => { if (z === res.mine) ps.push(i); });
      if (ps.length) { inF = ps[0]; outF = ps[ps.length - 1]; pos = inF; }
    } else pos = Math.min(retimed ? posAtOrAfter(seq, a) : a, seq.length - 1);
    updateRetimeUi(); draw(); changed('secs', 'retimed', 'inF', 'outF', 'pos');
  }
  $('secBtn').onclick = openRetime;
  $('viewBtn').onclick = () => setView(!retimed);
  $('secRates').onclick = e => { const r = e.target.dataset.r; if (r) applySec(+r === 1 ? null : 'speed', +r); };
  $('secHold').onclick = () => applySec('hold');
  $('secCut').onclick = () => applySec('cut');
  $('secClear').onclick = () => applySec(null);
  $('secCustom').onclick = () => { $('secCustomBox').style.display = 'block'; $('secCustomIn').value = ''; $('secCustomIn').focus(); };
  $('secCustomOk').onclick = () => { const r = parseFloat($('secCustomIn').value); if (r > 0) applySec(Math.abs(r - 1) < 1e-6 ? null : 'speed', Math.max(0.01, Math.min(8, r))); };

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
  const exportCtx = () => ({ frames, fps, W, H, marks, secs, name, compose, closeSheets, stop, loading: () => media.loading });
  $('export').onclick = () => exportVideo(secs.length ? 'retimed' : 'notes', exportCtx());
  $('exportBoth').onclick = () => exportVideo('both', exportCtx());

  // ---------- start
  $('player').style.display = 'block';
  for (const k of ['draw', 'arrow', 'box', 'circle']) $(k + 'Btn').classList.remove('on');
  $('annBtn').textContent = 'Annotate'; $('annBtn').classList.remove('on', 'open'); $('tray').hidden = true; $('penRow').hidden = true;
  $('log2').textContent = '';
  rebuild(); setRate(rate); updateRetimeUi(); sizeAll(); closeSheets(); draw(); poke();
  let drawT = 0;
  media.onFrame = () => { const now = performance.now(); if (!playing && now - drawT > 120) { drawT = now; draw(); } };
  media.done.then(() => { if (!ac.signal.aborted) { log(`${name}: ${media.count} frames, loaded in`); draw(); } });

  return {
    close() { stop(); ac.abort(); media.cancel(); $('player').style.display = 'none'; closeSheets(); },
  };
}

