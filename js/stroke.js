// Freehand strokes, as Quarry draws them.
// steady: the stabilizer (the stroke follows the pen on a short leash; Quarry's default is 60%).
// centreline + pieces: a Pencil stroke whose width changes is filled as one shape (round dabs joined by
// four-sided pieces, all wound the same way) so a see-through stroke has no darker beads where parts overlap.

export const SMOOTH_DEFAULT = 0.6;

// Pencil pressure (0..1) to a width factor, tuned from a Pencil test on iPad: most drawing reads 0.01–0.1,
// a firm press 0.3–0.5. A square-root curve gives light lines a real width and saves the thickest for pressing
// hard: 0.3 (no pressure) to 1.2 (half pressure and up). a = how much pressure counts (always full now).
export const widthFor = (pressure, a = 1) => {
  const p = Math.sqrt(Math.min(1, Math.max(0, pressure || 0) / 0.5));
  return Math.round((1 - a + a * (0.3 + 0.9 * p)) * 100) / 100;
};

// One stroke's points from Pencil or finger samples: the same steps everywhere a line is drawn.
// - each sample once: Safari can send a move twice, and repeats older samples in later coalesced lists
// - the Pencil's touch-down reading (a fixed 0.08 before its real pressure) doesn't set the width
// - stabilizer (smooth), a point once the steadied tip has moved most of a screen pixel (k = screen px per unit),
//   eased pressure, and on lift the line catches up to where the tip left the glass
// Finger lines (no pressure) get their thick-thin from speed instead, like a brush: slow is full width, a
// quick flick thins out; they start from a fine point, swell in, and taper off when the finger lifts.
export const speedWidth = v => Math.round((0.22 + 1.48 * Math.exp(-v / 0.65)) * 100) / 100;   // v: screen px per ms
const TAPER_IN = 0.06, TAPER_OUT = 12;   // starting width factor; points the lift tapers over
export function ink({ pen = true, smooth = SMOOTH_DEFAULT, toPoint, k = 1, a = 1, brush = false }) {
  let last = -Infinity, lastXY = [NaN, NaN], downP = null, real = false, p = null;
  const pts = [], r = v => Math.round(v * 100) / 100;
  const add = (x, y) => { const q = [r(x), r(y)]; if (pen) q.push(p ?? 0); else if (brush) q.push(r(p ?? TAPER_IN)); pts.push(q); };
  let vEase = 0;   // the finger's speed, eased, so the width breathes rather than jitters
  const speed = e => {
    if (pen || !brush) return;
    const dt = Math.max(1, e.timeStamp - last), d = Math.hypot(e.clientX - lastXY[0], e.clientY - lastXY[1]);
    vEase += (Math.min(6, d / dt) - vEase) * 0.25;
    p = (p ?? TAPER_IN) + (speedWidth(vEase) - (p ?? TAPER_IN)) * 0.22;
  };
  const pressure = e => {
    if (!pen) return;
    if (!real && e.pressure === downP) return;               // still the touch-down placeholder
    const w = widthFor(e.pressure, a);
    if (!real) { real = true; p = w; for (const q of pts) q[2] = w; } else p += (w - p) * 0.35;
  };
  return {
    pts,
    down(e) { last = e.timeStamp; lastXY = [e.clientX, e.clientY]; downP = e.pressure; const [x, y] = toPoint(e); add(x, y); },
    move(evs) {
      let changed = false;
      for (const e of evs) {
        // seen already: older than the last sample, or the very same one again (same time and place)
        if (e.timeStamp < last || (e.timeStamp === last && e.clientX === lastXY[0] && e.clientY === lastXY[1])) continue;
        speed(e); last = e.timeStamp; lastXY = [e.clientX, e.clientY]; pressure(e);
        const l = pts[pts.length - 1], [tx, ty] = steady(l, toPoint(e), smooth);
        if (Math.hypot(tx - l[0], ty - l[1]) * k < 0.75) continue;
        add(tx, ty); changed = true;
      }
      return changed;
    },
    up(e) {
      if (e) { const l = pts[pts.length - 1], [x, y] = toPoint(e); if (Math.hypot(x - l[0], y - l[1]) * k >= 0.75) add(x, y); }
      if (brush && !pen && pts.length > 2) {   // the lift: the last few points thin down to a point
        const n = Math.min(TAPER_OUT, pts.length - 1);
        for (let i = 0; i < n; i++) { const q = pts[pts.length - 1 - i]; q[2] = r(q[2] * Math.max(0.04, Math.pow(i / n, 0.8))); }
      }
      return pts;
    },
  };
}

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

// Fills a varying-width stroke on a canvas context in one go. The shape is worked out once per stroke and
// kept (a stroke's points don't change once drawn; the one being drawn is rebuilt as it grows), so redrawing a
// frame full of drawings, and the onion skin's frames either side, stays quick.
const shapes = new WeakMap();
export function fillStroke(c, pts, w) {
  let e = shapes.get(pts);
  if (!e || e.w !== w || e.n !== pts.length || typeof Path2D === 'undefined') {
    const step = Math.max(0.5, w / 4), path = typeof Path2D !== 'undefined' ? new Path2D() : c;
    if (path === c) c.beginPath();
    for (const p of pieces(centreline(pts, step), w)) {
      if (p.r != null) { path.moveTo(p.x + p.r, p.y); path.arc(p.x, p.y, p.r, 0, Math.PI * 2, false); }
      else { path.moveTo(p.pts[0][0], p.pts[0][1]); for (let i = 1; i < 4; i++) path.lineTo(p.pts[i][0], p.pts[i][1]); path.closePath(); }
    }
    if (path === c) { c.fill('nonzero'); return; }
    e = { w, n: pts.length, path }; shapes.set(pts, e);
  }
  c.fill(e.path, 'nonzero');
}
