// js/loader.js — "mirror squares" loading indicator.
// Usage:
//   const stop = mirrorLoader(canvasEl);           // starts looping
//   stop();                                        // stops and clears
// The canvas is sized by CSS (keep it square); ink colour is its CSS `color`.
export function mirrorLoader(canvas, opts) {
  opts = opts || {};
  var cycle = opts.cycleSeconds || 2;      // seconds per 180-degree turn
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var raf = 0, start = null, stopped = false;
  var size = 0, s = 0, dpr = 1, ink = '#fff';

  function measure() {
    dpr = window.devicePixelRatio || 1;
    size = canvas.clientWidth || 72;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    s = size * 0.25;                       // square side; grid is 2s across,
    ink = getComputedStyle(canvas).color;  // diamonds reach ~2.83s
  }

  function ease(u) {
    var v = Math.min(1, u / 0.85);
    return v < 0.5 ? 0.5 * Math.pow(2 * v, 3.2)
                   : 1 - 0.5 * Math.pow(2 * (1 - v), 3.6);
  }

  function pair(px, py, ang) {
    var lw = Math.max(1, size / 48);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.fillStyle = ink;
    ctx.fillRect(-s, -s, s, s);                       // filled square
    ctx.lineWidth = lw;
    ctx.strokeStyle = ink;
    ctx.strokeRect(lw / 2, lw / 2, s - lw, s - lw);   // outlined square
    ctx.restore();
  }

  function draw(seconds) {
    var c = seconds / cycle, n = Math.floor(c), u = c - n;
    var ang = Math.PI * (n + ease(u));
    var off = -s * Math.abs(Math.sin(ang));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    for (var i = 0; i < 4; i++) {
      ctx.save();
      ctx.translate(size / 2, size / 2);
      ctx.scale(i % 2 ? -1 : 1, i < 2 ? 1 : -1);
      ctx.beginPath();
      ctx.rect(-size, -size, size, size);             // keep one quadrant
      ctx.clip();
      pair(off, 0, ang);
      ctx.restore();
    }
  }

  function frame(now) {
    if (stopped) return;
    if (start === null) start = now;
    draw((now - start) / 1000);
    raf = requestAnimationFrame(frame);
  }

  measure();
  if (reduce) {
    draw(0);                                          // still 2x2 grid
  } else {
    raf = requestAnimationFrame(frame);
  }

  var stop = function stop() {
    stopped = true;
    cancelAnimationFrame(raf);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
  stop.drawAt = draw;   // for rendering samples
  return stop;
}

// ---------- the Quarry mark, folding (sample) ----------
// The mirror-squares idea on the logo's shapes: the block is a hexagon made of three faces (light top,
// mid left, dark right). Each cycle the faces whip a third of a turn about the middle, swinging apart into
// three petals at the fastest point and closing back into the cube, each face now where the next one was,
// so the light face has moved round. The small cube does the same a beat later. Same timing as above.
export function logoFolder(canvas, opts) {
  opts = opts || {};
  const cycle = opts.cycleSeconds || 2, ctx = canvas.getContext('2d');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SHADES = opts.shades || ['#EEF1F5', '#C3CEDB', '#DDE3EA'];   // top, right, left: the logo's stone
  let raf = 0, start = null, stopped = false, size = 0, dpr = 1;
  const measure = () => { dpr = window.devicePixelRatio || 1; size = canvas.clientWidth || 72; canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr); };
  const ease = u => { const v = Math.min(1, u / 0.85); return v < 0.5 ? 0.5 * Math.pow(2 * v, 3.2) : 1 - 0.5 * Math.pow(2 * (1 - v), 3.6); };
  const C30 = Math.cos(Math.PI / 6);
  // one face: the top rhombus of an iso cube of radius R, with its point at the middle
  const face = (R) => { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-R * C30, -R / 2); ctx.lineTo(0, -R); ctx.lineTo(R * C30, -R / 2); ctx.closePath(); };
  function cube(cx, cy, R, t) {
    const c = t / cycle, n = Math.floor(c), e = ease(c - n), ang = (2 * Math.PI / 3) * e, apart = R * 0.42 * Math.sin(Math.PI * e);
    for (let k = 0; k < 3; k++) {
      const a = k * 2 * Math.PI / 3 + ang, dir = a - Math.PI / 2;   // each face's middle points this way
      ctx.save(); ctx.translate(cx + Math.cos(dir) * apart, cy + Math.sin(dir) * apart); ctx.rotate(a);
      face(R); ctx.fillStyle = ctx.strokeStyle = SHADES[((k - n) % 3 + 3) % 3]; ctx.fill(); ctx.lineWidth = 0.8; ctx.lineJoin = 'round'; ctx.stroke();   // the stroke closes the hairline seams
      ctx.restore();
    }
  }
  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size, size);
    const R = size * 0.3, cx = size * 0.44, cy = size * 0.56;
    cube(cx, cy, R, t);
    cube(cx + R * 1.05, cy - R * 1.05, R * 0.42, Math.max(0, t - cycle * 0.12));
  }
  function frame(now) { if (stopped) return; if (start === null) start = now; draw((now - start) / 1000); raf = requestAnimationFrame(frame); }
  measure();
  if (reduce) draw(0); else raf = requestAnimationFrame(frame);
  const stop = () => { stopped = true; cancelAnimationFrame(raf); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); };
  stop.drawAt = draw;   // for rendering samples
  return stop;
}

// ---------- the original mirror-squares motion, drawn with the logo's cubes (sample) ----------
// Exactly mirrorLoader's turn, slide, timing and four-way mirror; only the pair changes: the filled
// square becomes a solid cube in the logo's three stone shades, the outlined square an outlined cube.
export function mirrorCubes(canvas, opts) {
  opts = opts || {};
  const cycle = opts.cycleSeconds || 2, ctx = canvas.getContext('2d');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SH = opts.shades || ['#EEF1F5', '#DDE3EA', '#C3CEDB'];   // top, left, right
  let raf = 0, start = null, stopped = false, size = 0, s = 0, dpr = 1, ink = '#fff';
  const measure = () => { dpr = window.devicePixelRatio || 1; size = canvas.clientWidth || 72; canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr); s = size * 0.25; ink = getComputedStyle(canvas).color; };
  const ease = u => { const v = Math.min(1, u / 0.85); return v < 0.5 ? 0.5 * Math.pow(2 * v, 3.2) : 1 - 0.5 * Math.pow(2 * (1 - v), 3.6); };
  // an iso cube fitting the square box x0..x0+w, y0..y0+w: a hexagon of three faces
  function cube(x0, y0, w, solid, lw) {
    const cx = x0 + w / 2, cy = y0 + w / 2, R = w / 2, k = Math.cos(Math.PI / 6) * R;
    const P = { t: [cx, cy - R], tr: [cx + k, cy - R / 2], br: [cx + k, cy + R / 2], b: [cx, cy + R], bl: [cx - k, cy + R / 2], tl: [cx - k, cy - R / 2], m: [cx, cy] };
    const faces = [[P.m, P.tl, P.t, P.tr], [P.m, P.bl, P.tl], [P.m, P.tr, P.br, P.b]];
    const poly = pts => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.closePath(); };
    if (solid) {
      poly([P.m, P.tl, P.t, P.tr]); ctx.fillStyle = SH[0]; ctx.fill();
      poly([P.m, P.tl, P.bl, P.b]); ctx.fillStyle = SH[1]; ctx.fill();
      poly([P.m, P.b, P.br, P.tr]); ctx.fillStyle = SH[2]; ctx.fill();
    } else {
      ctx.lineWidth = lw; ctx.strokeStyle = ink; ctx.lineJoin = 'round';
      poly([P.t, P.tr, P.br, P.b, P.bl, P.tl]); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(...P.tl); ctx.lineTo(...P.m); ctx.lineTo(...P.tr); ctx.moveTo(...P.m); ctx.lineTo(...P.b); ctx.stroke();
    }
  }
  function pair(px, py, ang) {
    const lw = Math.max(1, size / 48);
    ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
    cube(-s, -s, s, true, lw);
    cube(lw / 2, lw / 2, s - lw, false, lw);
    ctx.restore();
  }
  function draw(seconds) {
    const c = seconds / cycle, n = Math.floor(c), u = c - n, ang = Math.PI * (n + ease(u)), off = -s * Math.abs(Math.sin(ang));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 4; i++) {
      ctx.save(); ctx.translate(size / 2, size / 2); ctx.scale(i % 2 ? -1 : 1, i < 2 ? 1 : -1);
      ctx.beginPath(); ctx.rect(-size, -size, size, size); ctx.clip();
      pair(off, 0, ang); ctx.restore();
    }
  }
  function frame(now) { if (stopped) return; if (start === null) start = now; draw((now - start) / 1000); raf = requestAnimationFrame(frame); }
  measure();
  if (reduce) draw(0); else raf = requestAnimationFrame(frame);
  const stop = () => { stopped = true; cancelAnimationFrame(raf); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); };
  stop.drawAt = draw;
  return stop;
}

// ---------- mirror squares, with the logo's notch (sample) ----------
// The original motion exactly; one of the pair is a square with its outer corner taken out, like the
// logo's block missing its small cube. opts.notched: 'fill' (the filled one is notched) or 'outline'.
export function mirrorNotch(canvas, opts) {
  opts = opts || {};
  const cycle = opts.cycleSeconds || 2, notched = opts.notched || 'fill', one = !!opts.oneCorner, ctx = canvas.getContext('2d');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0, start = null, stopped = false, size = 0, s = 0, dpr = 1, ink = '#fff';
  const measure = () => { dpr = window.devicePixelRatio || 1; size = canvas.clientWidth || 72; canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr); s = size * 0.25; ink = getComputedStyle(canvas).color; };
  const ease = u => { const v = Math.min(1, u / 0.85); return v < 0.5 ? 0.5 * Math.pow(2 * v, 3.2) : 1 - 0.5 * Math.pow(2 * (1 - v), 3.6); };
  // a square x0..x0+w with the quarter at corner (cx, cy) (each -1 or 1, from its middle) taken out
  function notchPath(x0, y0, w, cx, cy) {
    const h = w / 2, mx = x0 + h, my = y0 + h, X = v => mx + v * h, Y = v => my + v * h;
    // walk the square's corners, stepping in round the missing quarter
    const pts = [];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      if (a === cx && b === cy) { pts.push(a === b ? [X(a), Y(0)] : [X(0), Y(b)], [X(0), Y(0)], a === b ? [X(0), Y(b)] : [X(a), Y(0)]); }
      else pts.push([X(a), Y(b)]);
    }
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.closePath();
  }
  function pair(px, py, ang, cut) {
    const lw = Math.max(1, size / 48);
    ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
    ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineWidth = lw; ctx.lineJoin = 'miter';
    if (notched === 'fill') { if (cut) notchPath(-s, -s, s, -1, -1); else { ctx.beginPath(); ctx.rect(-s, -s, s, s); } ctx.fill(); ctx.strokeRect(lw / 2, lw / 2, s - lw, s - lw); }
    else { ctx.fillRect(-s, -s, s, s); if (cut) notchPath(lw / 2, lw / 2, s - lw, 1, 1); else { ctx.beginPath(); ctx.rect(lw / 2, lw / 2, s - lw, s - lw); } ctx.stroke(); }
    ctx.restore();
  }
  function draw(seconds) {
    const c = seconds / cycle, n = Math.floor(c), u = c - n, ang = Math.PI * (n + ease(u)), off = -s * Math.abs(Math.sin(ang));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 4; i++) {
      ctx.save(); ctx.translate(size / 2, size / 2); ctx.scale(i % 2 ? -1 : 1, i < 2 ? 1 : -1);
      ctx.beginPath(); ctx.rect(-size, -size, size, size); ctx.clip();
      pair(off, 0, ang, !one || i === 1); ctx.restore();   // oneCorner: only the top-right copy is notched, like the logo
    }
  }
  function frame(now) { if (stopped) return; if (start === null) start = now; draw((now - start) / 1000); raf = requestAnimationFrame(frame); }
  measure();
  if (reduce) draw(0); else raf = requestAnimationFrame(frame);
  const stop = () => { stopped = true; cancelAnimationFrame(raf); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); };
  stop.drawAt = draw;
  return stop;
}

// ---------- mirror squares, notched, with the corner piece flying out (sample) ----------
// The original motion; each square has its outer corner cut, and the cut piece rides with it: as the
// shape unfolds it flies out of its notch, and it slides back in just as the shape folds shut.
export function mirrorChip(canvas, opts) {
  opts = opts || {};
  const cycle = opts.cycleSeconds || 2, ctx = canvas.getContext('2d'), reach = opts.reach ?? 0.42;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0, start = null, stopped = false, size = 0, s = 0, dpr = 1, ink = '#fff';
  const measure = () => { dpr = window.devicePixelRatio || 1; size = canvas.clientWidth || 72; canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr); s = size * 0.25; ink = getComputedStyle(canvas).color; };
  const ease = u => { const v = Math.min(1, u / 0.85); return v < 0.5 ? 0.5 * Math.pow(2 * v, 3.2) : 1 - 0.5 * Math.pow(2 * (1 - v), 3.6); };
  // an L: the square x0..x0+w with its quarter at the corner (cx, cy) taken out
  function lPath(x0, y0, w, cx, cy) {
    const h = w / 2, X = v => x0 + h + v * h, Y = v => y0 + h + v * h, pts = [];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      if (a === cx && b === cy) pts.push(a === b ? [X(a), Y(0)] : [X(0), Y(b)], [X(0), Y(0)], a === b ? [X(0), Y(b)] : [X(a), Y(0)]);
      else pts.push([X(a), Y(b)]);
    }
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.closePath();
  }
  function pair(px, py, ang, out) {
    const lw = Math.max(1, size / 48), h = s / 2, d = out * s * reach;
    ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
    ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineWidth = lw; ctx.lineJoin = 'miter';
    // the filled square, its outer (top-left) corner cut; the piece flies out along the diagonal
    lPath(-s, -s, s, -1, -1); ctx.fill();
    ctx.fillRect(-s - d, -s - d, h, h);
    // the outlined square, its outer (bottom-right) corner cut; its piece the same way
    lPath(lw / 2, lw / 2, s - lw, 1, 1); ctx.stroke();
    ctx.strokeRect(lw / 2 + h + d, lw / 2 + h + d, h - lw, h - lw);
    ctx.restore();
  }
  function draw(seconds) {
    const c = seconds / cycle, n = Math.floor(c), u = c - n, e = ease(u), ang = Math.PI * (n + e), off = -s * Math.abs(Math.sin(ang));
    // out as it unfolds, back in just as it folds shut (a little ahead of the shape, so it lands first)
    const out = Math.pow(Math.sin(Math.PI * Math.min(1, e * 1.08)), 0.8);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 4; i++) {
      ctx.save(); ctx.translate(size / 2, size / 2); ctx.scale(i % 2 ? -1 : 1, i < 2 ? 1 : -1);
      ctx.beginPath(); ctx.rect(-size, -size, size, size); ctx.clip();
      pair(off, 0, ang, out); ctx.restore();
    }
  }
  function frame(now) { if (stopped) return; if (start === null) start = now; draw((now - start) / 1000); raf = requestAnimationFrame(frame); }
  measure();
  if (reduce) draw(0); else raf = requestAnimationFrame(frame);
  const stop = () => { stopped = true; cancelAnimationFrame(raf); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); };
  stop.drawAt = draw;
  return stop;
}

// ---------- mirror squares: the square breathes out its corners, then folds (sample) ----------
// Each time the solid square has formed, its four corner blocks slide out along the diagonals and ease
// back in; then the shape folds with the original whip. On the outlined turn it just holds, then folds.
export function mirrorCorners(canvas, opts) {
  opts = opts || {};
  const hold = opts.hold ?? 0.62, holdOutline = opts.holdOutline ?? 0, whip = opts.whip ?? 1.25, reach = opts.reach ?? 1.25, ctx = canvas.getContext('2d');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0, start = null, stopped = false, size = 0, s = 0, dpr = 1, ink = '#fff';
  const measure = () => { dpr = window.devicePixelRatio || 1; size = canvas.clientWidth || 72; canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr); s = size * 0.19; ink = getComputedStyle(canvas).color; };
  // the original's creep, whip and settle (its hold is now the corners' moment)
  // the fold: off the mark at once (the corners' landing kicks it), a fast whip, a long settle. No creep and
  // no hold at the end, so the next throw starts the moment the solid square has formed
  const whipEase = v => v < 0.5 ? 0.5 * Math.pow(2 * v, 1.7) : 1 - 0.5 * Math.pow(2 * (1 - v), 3.6);
  const inOut = v => v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
  function lPath(x0, y0, w) {   // the square with its outer (top-left) quarter taken out
    const h = w / 2; ctx.beginPath();
    ctx.moveTo(x0 + h, y0); ctx.lineTo(x0 + w, y0); ctx.lineTo(x0 + w, y0 + w); ctx.lineTo(x0, y0 + w); ctx.lineTo(x0, y0 + h); ctx.lineTo(x0 + h, y0 + h); ctx.closePath();
  }
  function pair(px, py, ang, out) {
    const lw = Math.max(1, size / 48), h = s / 2, d = out * s * reach;
    ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
    ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineWidth = lw;
    lPath(-s, -s, s); ctx.fill();
    ctx.fillRect(-s - d, -s - d, h + 0.5, h + 0.5);   // its corner block (a hair over, so no seam shows when it's home)
    // the outlined square: only the sides that aren't lying on the mirror lines, so when the four come
    // together they make one clean outline with nothing left inside
    const q = lw / 2, e = s - lw / 2, corners = [[q, q], [e, q], [e, e], [q, e]];
    const at = ([x, y]) => [px + x * Math.cos(ang) - y * Math.sin(ang), py + x * Math.sin(ang) + y * Math.cos(ang)];
    ctx.restore();
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const A = at(corners[i]), B = at(corners[(i + 1) % 4]), near = lw * 1.5;
      if ((Math.abs(A[0]) < near && Math.abs(B[0]) < near) || (Math.abs(A[1]) < near && Math.abs(B[1]) < near)) continue;
      const snap = P => P.map(v => (Math.abs(v) < near ? 0 : v));   // run right to the mirror line, so the halves meet
      ctx.moveTo(...snap(A)); ctx.lineTo(...snap(B));
    }
    ctx.strokeStyle = ink; ctx.lineWidth = lw; ctx.lineCap = 'butt'; ctx.stroke();
  }
  function draw(t) {
    // two turns make a loop: the solid one and the outlined one. The throw starts a touch before the fold
    // into the solid square has finished settling (ov), so there's no still moment before it
    const ov = Math.min(hold * 0.5, 0.16), loop = (hold - ov) + whip + holdOutline + whip;
    const m = Math.floor(t / loop), r = t - m * loop;
    const a1 = hold - ov, a2 = a1 + whip, a3 = a2 + holdOutline;
    let ang = Math.PI * 2 * m, out = 0;
    if (r < a1) {}                                                    // the corners are out
    else if (r < a2) ang += Math.PI * whipEase((r - a1) / whip);     // their landing kicks off the fold
    else if (r < a3) ang += Math.PI;                                  // the outlined square, briefly
    else ang += Math.PI + Math.PI * whipEase((r - a3) / whip);       // folds back into the solid square
    // a ball thrown up: leaves sharp and fast, turns over at the top without stopping, drops back fast
    const since = r < a1 ? r + ov : r - (loop - ov);
    if (since >= 0 && since < hold) { const k = since / hold, x = k < 0.5 ? 2 * k : 2 - 2 * k; out = 1 - Math.pow(1 - x, 2.8); }   // a softer turn at the top than a plain throw, without stopping there
    const off = -s * Math.abs(Math.sin(ang));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 4; i++) {
      ctx.save(); ctx.translate(size / 2, size / 2); ctx.scale(i % 2 ? -1 : 1, i < 2 ? 1 : -1);
      ctx.beginPath(); ctx.rect(-size, -size, size, size); ctx.clip();
      pair(off, 0, ang, out); ctx.restore();
    }
  }
  function frame(now) { if (stopped) return; if (start === null) start = now; draw((now - start) / 1000); raf = requestAnimationFrame(frame); }
  measure();
  if (reduce) draw(0); else raf = requestAnimationFrame(frame);
  const stop = () => { stopped = true; cancelAnimationFrame(raf); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); };
  stop.drawAt = draw;
  return stop;
}
