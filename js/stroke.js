// Freehand strokes, as Quarry draws them.
// steady: the stabilizer (the stroke follows the pen on a short leash; Quarry's default is 60%).
// centreline + pieces: a Pencil stroke whose width changes is filled as one shape (round dabs joined by
// four-sided pieces, all wound the same way) so a see-through stroke has no darker beads where parts overlap.

export const SMOOTH_DEFAULT = 0.6;

// last, raw: [x, y]. s: 0 (raw) to 1 (most steady; still moves a little).
export function steady(last, raw, s) {
  const k = 1 - Math.min(0.9, Math.max(0, s));
  return [last[0] + (raw[0] - last[0]) * k, last[1] + (raw[1] - last[1]) * k];
}

// pts: [[x, y, widthFactor]]. Returns points along the midpoint curve, about `step` apart.
export function centreline(pts, step = 1.5) {
  if (pts.length < 3) return pts.map(p => [p[0], p[1], p[2] ?? 1]);
  const out = [[pts[0][0], pts[0][1], pts[0][2] ?? 1]];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ((a[2] ?? 1) + (b[2] ?? 1)) / 2];
  let from = out[0];
  for (let i = 1; i < pts.length; i++) {
    const last = i === pts.length - 1, ctl = pts[i], to = last ? [ctl[0], ctl[1], ctl[2] ?? 1] : mid(pts[i], pts[i + 1]);
    const len = Math.hypot(ctl[0] - from[0], ctl[1] - from[1]) + Math.hypot(to[0] - ctl[0], to[1] - ctl[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let j = 1; j <= n; j++) {
      const t = j / n, u = 1 - t;
      const q = last ? [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
        : [u * u * from[0] + 2 * u * t * ctl[0] + t * t * to[0], u * u * from[1] + 2 * u * t * ctl[1] + t * t * to[1]];
      out.push([q[0], q[1], from[2] + (to[2] - from[2]) * t]);
    }
    from = to;
  }
  return out;
}

export const area = ps => { let a = 0; for (let i = 0; i < ps.length; i++) { const p = ps[i], q = ps[(i + 1) % ps.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

// c: centreline points; w: full width at factor 1. Returns dabs {x, y, r} and quads {pts}.
export function pieces(c, w) {
  const out = [], R = p => Math.max(0.25, w * p[2] / 2);
  for (const p of c) out.push({ x: p[0], y: p[1], r: R(p) });
  for (let i = 1; i < c.length; i++) {
    const a = c[i - 1], b = c[i], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
    if (d < 1e-6) continue;
    const nx = -dy / d, ny = dx / d, ra = R(a), rb = R(b);
    let q = [[a[0] + nx * ra, a[1] + ny * ra], [b[0] + nx * rb, b[1] + ny * rb], [b[0] - nx * rb, b[1] - ny * rb], [a[0] - nx * ra, a[1] - ny * ra]];
    if (area(q) < 0) q = q.reverse();
    out.push({ pts: q });
  }
  return out;
}

// Fills a varying-width stroke on a canvas context in one go.
export function fillStroke(c, pts, w) {
  const step = Math.max(0.5, w / 4);
  c.beginPath();
  for (const p of pieces(centreline(pts, step), w)) {
    if (p.r != null) { c.moveTo(p.x + p.r, p.y); c.arc(p.x, p.y, p.r, 0, Math.PI * 2, false); }
    else { c.moveTo(p.pts[0][0], p.pts[0][1]); for (let i = 1; i < 4; i++) c.lineTo(p.pts[i][0], p.pts[i][1]); c.closePath(); }
  }
  c.fill('nonzero');
}
