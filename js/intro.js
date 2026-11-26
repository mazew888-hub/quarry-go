// Start screen: the Quarry mark itself (the block of seven cubes and the small cube), no app tile.
// The mark grows in, the small cube pops out of its notch into place, and it holds before fading to the app.
const TOP = [238, 241, 245], RIGHT = [184, 196, 211], LEFT = [226, 230, 236];
const BG0 = '#353B45', BG1 = '#1A1D22';
const C30 = Math.cos(Math.PI / 6);

// ---------- easing and keyframes
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, x) => a + (b - a) * x;
export const E = {
  out: x => 1 - Math.pow(1 - x, 3), in: x => x * x * x, inOut: x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
  out4: x => 1 - Math.pow(1 - x, 4), outQuad: x => 1 - (1 - x) * (1 - x), inQuad: x => x * x, sine: x => -(Math.cos(Math.PI * x) - 1) / 2,
};
// track(t, [t0, v0], [t1, v1, ease], ...): the value at t, eased into each key by that key's ease
export function track(t, ...keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, ease = E.inOut] = keys[i], [t0, v0] = keys[i - 1];
    if (t <= t1) return lerp(v0, v1, ease(clamp((t - t0) / (t1 - t0))));
  }
  return keys[keys.length - 1][1];
}

// ---------- 3D: cubes as faces, transformed, shaded by which way they face, drawn far to near
const FACES = [
  [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
  [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
  [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
  [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
  [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
  [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = v => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
function shade(n) {
  const wz = Math.max(0, n[2]) ** 2, wx = Math.max(0, n[0]) ** 2, wy = Math.max(0, n[1]) ** 2, sum = wz + wx + wy || 1;
  const ch = i => Math.round((TOP[i] * wz + RIGHT[i] * wx + LEFT[i] * wy) / sum);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}
function drawScene(c, ox, oy, s, objects, pattern) {
  const faces = [];
  // where every cube's middle is, so a face pressed against another cube (even one drawn on its own) is hidden
  const mids = []; for (const o of objects) for (const [cx, cy, cz] of o.cubes) mids.push(o.tf([cx + 0.5, cy + 0.5, cz + 0.5]));
  const touching = (P, n) => { const m = P.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4, a[2] + p[2] / 4], [0, 0, 0]), q = [m[0] + n[0] * 0.5, m[1] + n[1] * 0.5, m[2] + n[2] * 0.5];
    return mids.some(c => Math.abs(c[0] - q[0]) < 0.06 && Math.abs(c[1] - q[1]) < 0.06 && Math.abs(c[2] - q[2]) < 0.06); };
  for (const o of objects) {
    const has = new Set(o.cubes.map(q => q.join()));
    for (const [cx, cy, cz] of o.cubes) for (const [nrm, pts] of FACES) {
      if (has.has([cx + nrm[0], cy + nrm[1], cz + nrm[2]].join())) continue;
      const P = pts.map(([a, b, d]) => o.tf([cx + a, cy + b, cz + d]));
      const n = norm(cross(sub(P[1], P[0]), sub(P[3], P[0])));
      if (n[0] + n[1] + n[2] <= 0.001) continue;
      if (touching(P, n)) continue;
      faces.push({ P, n, depth: P.reduce((m, p) => m + p[0] + p[1] + p[2], 0) / 4 + (o.bias || 0) });
    }
  }
  faces.sort((a, b) => a.depth - b.depth);
  for (const f of faces) {
    c.beginPath();
    f.P.forEach(([x, y, z], i) => { const px = ox + (x - y) * C30 * s, py = oy + (x + y) * 0.5 * s - z * s; i ? c.lineTo(px, py) : c.moveTo(px, py); });
    c.closePath(); const col = shade(f.n);
    c.fillStyle = col; c.fill(); c.strokeStyle = col; c.lineWidth = 1; c.lineJoin = 'round'; c.stroke();
    if (pattern) { c.fillStyle = pattern; c.fill(); }
  }
}
const squashAbout = (p, base, sz, sxy) => [base[0] + (p[0] - base[0]) * sxy, base[1] + (p[1] - base[1]) * sxy, base[2] + (p[2] - base[2]) * sz];

const BLOCK = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [0, 1, 1], [1, 1, 1]];
const HOME = [1, 0, 1], LOGO = [2.25, -0.85, 1.9], MID = [0.5, 0.5, 0];
export const GROW = 0.5, POP = 0.42, POPPED = 0.74, HOLD = 2.3, END = 2.6;
const C = [1.3, 0.2, 1.1];   // the middle of the mark, which it grows from

export function drawIntro(c, w, h, t) {
  const s = Math.min(w, h) * 0.085, ox = w / 2 - s * 0.6, oy = h * 0.47;
  // the whole mark grows out of nothing with a little overshoot
  const g = track(t, [0, 0], [GROW * 0.7, 1.08, E.out], [GROW, 0.98, E.inOut], [GROW + 0.15, 1, E.inOut]);
  const grow = p => [C[0] + (p[0] - C[0]) * g, C[1] + (p[1] - C[1]) * g, C[2] + (p[2] - C[2]) * g];
  const at = pos => p => [p[0] + pos[0], p[1] + pos[1], p[2] + pos[2]];
  // the small cube: tucked in the notch, then springs out on an arc into its spot and settles
  let tf;
  if (t < POP) tf = p => grow(at(HOME)(p));
  else {
    const k = clamp((t - POP) / (POPPED - POP)), e = E.out(k);
    const ss = track(t, [POP, 1.18], [POP + 0.15, 1, E.out], [POPPED, 1], [POPPED + 0.06, 0.86, E.out], [POPPED + 0.25, 1, E.inOut]);
    const pos = [lerp(HOME[0], LOGO[0], e), lerp(HOME[1], LOGO[1], e), lerp(HOME[2], LOGO[2], e) + Math.sin(k * Math.PI) * 0.9];
    tf = p => grow(at(pos)(squashAbout(p, MID, ss, 1 / Math.sqrt(ss))));
  }
  c.clearRect(0, 0, w, h);
  c.fillStyle = '#1E2024'; c.fillRect(0, 0, w, h);
  if (g > 0.01) drawScene(c, ox, oy, s, [{ cubes: BLOCK, tf: grow }, { cubes: [[0, 0, 0]], tf, bias: 0.01 }]);
  const f = clamp((t - HOLD) / (END - HOLD));
  if (f > 0) { c.save(); c.globalCompositeOperation = 'destination-out'; c.globalAlpha = E.sine(f); c.fillRect(0, 0, w, h); c.restore(); }
}

// Plays once on launch over the app; never blocks touches, and skipped for reduced motion.
export function playIntro() {
  const el = document.getElementById('intro'); if (!el) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.remove(); return; }
  const cv = el.querySelector('canvas'), dpr = Math.min(3, devicePixelRatio || 1);
  const size = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
  size();
  const c = cv.getContext('2d'); let t0 = null;
  const tick = now => {
    if (t0 === null) t0 = now;
    const t = (now - t0) / 1000;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); drawIntro(c, innerWidth, innerHeight, t);
    if (t < END) requestAnimationFrame(tick); else el.remove();
  };
  requestAnimationFrame(tick);
}

// The mark at rest, on a clear background (used to make icons/mark.png).
export function drawMark(c, w, h) {
  const s = Math.min(w, h) / 7, ox = w * 0.38, oy = h * 0.55;
  drawScene(c, ox, oy, s, [{ cubes: BLOCK, tf: p => p }, { cubes: [[0, 0, 0]], tf: p => [p[0] + LOGO[0], p[1] + LOGO[1], p[2] + LOGO[2]], bias: 0.01 }]);
}
