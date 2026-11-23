// Draw-over rules, kept apart from the player so they can be tested on their own.
// A "drawing" is everything drawn (pen strokes and shapes) on one frame; it holds for holds[f] frames
// (1 if not set). Notes are not part of drawings.

export const DRAWN = new Set(['draw', 'arrow', 'box', 'circle']);
export const isDrawn = m => DRAWN.has(m.type);
export const holdOf = (holds, f) => Math.max(1, (holds && holds[f]) || 1);

export function drawingStarts(marks) {
  return [...new Set(marks.filter(isDrawn).map(m => m.f))].sort((a, b) => a - b);
}

// The drawing a frame shows: the latest one that started at or before it and still holds there.
export function drawingAt(marks, holds, f) {
  let found = null;
  for (const s of drawingStarts(marks)) if (s <= f && f < s + holdOf(holds, s)) found = s;
  return found;
}

// Reviews made before holds existed showed every mark for 12 frames: keep that for them.
export function legacyHolds(marks) {
  const h = {};
  for (const s of drawingStarts(marks)) h[s] = 12;
  return h;
}

const dist2 = (p, a, b) => { // squared distance from point p to segment ab
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return x * x + y * y;
};
const near = (p, path, r) => {
  if (path.length === 1) return dist2(p, path[0], path[0]) <= r * r;
  for (let i = 1; i < path.length; i++) if (dist2(p, path[i - 1], path[i]) <= r * r) return true;
  return false;
};

// Rubs out the parts of a stroke within r of the eraser's path. Long segments are first cut into
// short steps, so the eraser bites where it crosses them, not only at the points the finger left.
export function eraseStroke(pts, path, r) {
  const fine = [pts[0]];
  const step = Math.max(0.5, r / 2);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
    for (let k = 1; k <= n; k++) fine.push(k === n ? b : [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  const out = []; let run = [], cut = false;
  for (const p of fine) {
    if (near(p, path, r)) { cut = true; if (run.length > 1) out.push(run); run = []; }
    else run.push(p);
  }
  if (run.length > 1) out.push(run);
  if (!cut) return [pts];
  // keep the original points where a piece is untouched at its ends, dropping the extra steps
  return out.map(piece => simplify(piece, pts));
}
function simplify(piece, orig) {
  const keep = new Set(orig.map(p => p.join(',')));
  return piece.filter((p, i) => i === 0 || i === piece.length - 1 || keep.has(p.join(',')));
}

// Does the eraser at point p touch a shape's outline?
export function hitsShape(m, p, r) {
  if (m.type === 'arrow') return dist2(p, [m.x1, m.y1], [m.x2, m.y2]) <= r * r;
  if (m.type === 'box') {
    const a = [Math.min(m.x1, m.x2), Math.min(m.y1, m.y2)], b = [Math.max(m.x1, m.x2), Math.max(m.y1, m.y2)];
    const c = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [a[0], a[1]]];
    for (let i = 1; i < c.length; i++) if (dist2(p, c[i - 1], c[i]) <= r * r) return true;
    return false;
  }
  if (m.type === 'circle') {
    const R = Math.hypot(m.x2 - m.x1, m.y2 - m.y1);
    return Math.abs(Math.hypot(p[0] - m.x1, p[1] - m.y1) - R) <= r;
  }
  return false;
}
