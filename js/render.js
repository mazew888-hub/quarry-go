// Drawing a review's frame with its notes and marks, apart from the player so videos that aren't open
// can be exported too. state() gives the review's current {marks, holds, retimed, shown}: shown is the
// set of video frames the time warp plays (null when it plays them all), so marks on frames it skips stay hidden.
import { isDrawn, drawingAt, drawingStarts } from './draw.js';
import { fillStroke } from './stroke.js';

export const HOLD = 12; // frames a note stays on screen (drawings use their own holds)

export function wrap(c, t, max) { if (t.includes('\n')) return t.split('\n').flatMap(p => p.trim() ? wrap(c, p, max) : ['']); const out = []; let line = ''; for (const w of t.split(/\s+/)) { const n = line ? line + ' ' + w : w; if (c.measureText(n).width > max && line) { out.push(line); line = w; } else line = n; } if (line) out.push(line); return out; }
export function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

export function renderer({ frames, W, H, state }) {
  function drawMark(c, m) {
    c.save(); if (m.alpha != null) c.globalAlpha *= m.alpha; c.strokeStyle = m.color || '#FF3B5C'; c.fillStyle = m.color || '#FF3B5C'; c.lineWidth = m.size || Math.max(3, W/220); c.lineCap = 'round'; c.lineJoin = 'round';
    if (m.type === 'arrow') {
      c.beginPath(); c.moveTo(m.x1, m.y1); c.lineTo(m.x2, m.y2); c.stroke();
      const a = Math.atan2(m.y2-m.y1, m.x2-m.x1), L = Math.max(14, W/45);
      c.beginPath(); c.moveTo(m.x2, m.y2);
      c.lineTo(m.x2 - L*Math.cos(a-0.45), m.y2 - L*Math.sin(a-0.45));
      c.lineTo(m.x2 - L*Math.cos(a+0.45), m.y2 - L*Math.sin(a+0.45)); c.closePath(); c.fill();
    } else if (m.type === 'draw') {
      // freehand: smoothed through the midpoints of the points the finger left
      const p = m.pts, w = c.lineWidth;
      if (p[0].length > 2) {
        // Apple Pencil pressure: each point carries a width factor; filled as one shape so see-through ink stays even
        fillStroke(c, p, w);
      } else {
        c.beginPath(); c.moveTo(p[0][0], p[0][1]);
        for (let i = 1; i < p.length - 1; i++) c.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
        c.lineTo(p[p.length - 1][0], p[p.length - 1][1]); c.stroke();
      }
    } else if (m.type === 'circle') {
      // grows from where you touched: that point is the centre, the drag sets the radius
      c.beginPath(); c.arc(m.x1, m.y1, Math.hypot(m.x2-m.x1, m.y2-m.y1), 0, Math.PI*2); c.stroke();
    } else if (m.type === 'box') {
      c.strokeRect(Math.min(m.x1,m.x2), Math.min(m.y1,m.y2), Math.abs(m.x2-m.x1), Math.abs(m.y2-m.y1));
    } else if (m.type === 'note') {
      const fs = Math.max(14, W/34); c.font = `600 ${fs}px -apple-system,system-ui,sans-serif`;
      const lines = wrap(c, m.text, W*0.8), pad = fs*0.5, h = lines.length*fs*1.25 + pad*2;
      const w = Math.max(...lines.map(l => c.measureText(l).width)) + pad*2;
      c.fillStyle = 'rgba(29,28,30,.82)'; roundRect(c, pad, H - h - pad, w, h, 6); c.fill();
      c.fillStyle = '#fff'; lines.forEach((l, i) => c.fillText(l, pad*2, H - h - pad + pad + fs*(i+0.95)));
    }
    c.restore();
  }
  // Notes show for HOLD frames; drawn marks show while their frame's drawing holds.
  const visible = (f, ret) => {
    const { marks, holds, retimed, shown } = state();
    if (ret === undefined) ret = retimed;
    const s = drawingAt(marks, holds, f);
    return marks.filter(m => (isDrawn(m) ? m.f === s : f >= m.f && f < m.f + HOLD) && !(ret && shown && !shown.has(m.f)));
  };
  function pic(f) { if (frames[f]) return frames[f]; for (let d = 1; d < frames.length; d++) { if (frames[f - d]) return frames[f - d]; if (frames[f + d]) return frames[f + d]; } return null; }
  // Tracing paper (state().trace, 0..1): a sheet of white over the video, under the notes, as Quarry draws it.
  // Onion skin (state().onion = {before, after}, or null): the drawings either side of this frame's, fading out.
  function compose(c, f, withNotes = true, ret) {
    const p = pic(f); if (p) c.drawImage(p, 0, 0); else { c.fillStyle = '#1D2024'; c.fillRect(0, 0, W, H); }
    const st = state();
    if (st.trace > 0) { c.save(); c.fillStyle = `rgba(255,255,255,${Math.min(0.9, st.trace * 0.85)})`; c.fillRect(0, 0, W, H); c.restore(); }
    if (st.onion) {
      const starts = drawingStarts(st.marks), here = drawingAt(st.marks, st.holds, f);
      const before = starts.filter(s => s < (here ?? f + 1) && s !== here).slice(-st.onion.before).reverse();
      const after = starts.filter(s => s > f && s !== here).slice(0, st.onion.after);
      for (const [list] of [[before], [after]]) list.forEach((s, i) => {
        c.save(); c.globalAlpha = 0.45 / (i + 1);
        for (const m of st.marks) if (isDrawn(m) && m.f === s && !(ret && st.shown && !st.shown.has(m.f))) drawMark(c, m);
        c.restore();
      });
    }
    // Exports: a note is about its moment, so it shows on its own frame only (the video plays at its real or retimed
    // speed, never pausing). Notes on one frame share a box. Frame 1 lists the frames with notes (noteBanner).
    const vis = visible(f, ret);
    for (const m of vis) if (m.type !== 'note') drawMark(c, m);
    const { marks, retimed, shown } = state(), r = ret === undefined ? retimed : ret;
    const now = marks.filter(m => m.type === 'note' && m.f === f && !(r && shown && !shown.has(m.f)));
    if (withNotes && now.length) drawMark(c, now.length === 1 ? now[0] : { ...now[0], text: now.map(m => m.text).join('\n\n') });
  }
  // Frame 1 of an export: "Notes on frames 12, 35, 87" along the bottom, so the artist knows where to stop.
  // seq: the export's frames in order (video frame per exported frame); numbers are the exported frames.
  function noteFrames(seq) {
    const at = new Map(); seq.forEach((v, j) => { if (!at.has(v)) at.set(v, j + 1); });
    return [...new Set(state().marks.filter(m => m.type === 'note' && at.has(m.f)).map(m => at.get(m.f)))].sort((a, b) => a - b);
  }
  function noteBanner(c, seq) {
    const list = noteFrames(seq); if (!list.length) return;
    const fs = Math.max(14, W / 34), pad = fs * 0.5;
    c.save(); c.font = `600 ${fs}px -apple-system,system-ui,sans-serif`;
    const lines = wrap(c, `Notes on frame${list.length > 1 ? 's' : ''} ${list.join(', ')}`, W * 0.9), h = lines.length * fs * 1.25 + pad * 2;
    const w = Math.max(...lines.map(l => c.measureText(l).width)) + pad * 2;
    c.fillStyle = 'rgba(232,52,79,.92)'; roundRect(c, (W - w) / 2, H - h - pad, w, h, 6); c.fill();
    c.fillStyle = '#fff'; lines.forEach((l, i) => c.fillText(l, (W - w) / 2 + pad, H - h - pad + pad + fs * (i + 0.95)));
    c.restore();
  }
  return { drawMark, visible, compose, pic, noteFrames, noteBanner };
}
