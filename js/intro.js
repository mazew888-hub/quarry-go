// Start screen: the Quarry mark itself: the whole block spins in, its corner chips off, tumbles over and
// lands in place; a hold, then a fade.
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
// The whole block (2×2×2) spins in; partway round, its top corner chips off: it cracks loose, is flung
// up a little, tumbles over and drops into its place, rocking to rest. No text: just the mark.
// HOLD is the moment the corner lands: the landing goes straight into the antic's compression.
export const SPIN = 0.6, REL = 0.68, FLIGHT = 0.52, LANDS = 0.68 + 0.52, HOLD = LANDS,
  ANTIC = 0.7, FLY = 0.7 + 0.56, RIPPLE = 0.6, END = LANDS + 1.26 + 0.6;
const back = (k, c1 = 1.4) => 1 + (c1 + 1) * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
const TURN = -Math.PI * 2.5;
const spinAt = t => TURN * (1 - back(clamp(t / SPIN)));
const rotZ = (p, a, cx = 1, cy = 1) => { const c = Math.cos(a), s = Math.sin(a), x = p[0] - cx, y = p[1] - cy; return [cx + x * c - y * s, cy + x * s + y * c, p[2]]; };
const rotAxis = (p, k, a) => {   // Rodrigues: p turned by a about unit axis k (through the origin)
  const c = Math.cos(a), s = Math.sin(a), d = k[0] * p[0] + k[1] * p[1] + k[2] * p[2];
  const x = [k[1] * p[2] - k[2] * p[1], k[2] * p[0] - k[0] * p[2], k[0] * p[1] - k[1] * p[0]];
  return [0, 1, 2].map(i => p[i] * c + x[i] * s + k[i] * d * (1 - c));
};
// little crumbs knocked off where it breaks
const CRUMBS = Array.from({ length: 5 }, (_, i) => { const a = i * 2.39996 + 0.4, u = (i * 0.618) % 1;
  return { v: [Math.cos(a) * (0.8 + u), Math.sin(a) * (0.8 + u), 2.2 + u * 1.6], size: 0.12 + u * 0.08 }; });

// The finished mark's outline at size 1 (for fitting it into the Quarry logo key on Reviews)
const MARK_BOX = (() => { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const q of [...BLOCK, LOGO]) for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) {
    const x = q[0] + dx, y = q[1] + dy, z = q[2] + dz, px = (x - y) * C30, py = (x + y) * 0.5 - z;
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
  return { x0, x1, y0, y1 }; })();

export function drawIntro(c, w, h, t, target = null) {
  let s = Math.min(w, h) * 0.085, ox = w / 2 - s * 0.6, oy = h * 0.47;
  // the hand-off: the mark shrinks and flies into the Quarry logo key; when it hits, the page ripples
  // out from that corner: the dark opens in a widening soft circle while the page itself warps and settles (pageWarp)
  const go = target ? t - HOLD : -1;
  if (go > 0) {
    const B = MARK_BOX, k = E.inOut(clamp((go - ANTIC) / (FLY - ANTIC)));
    const cx0 = ox + s * (B.x0 + B.x1) / 2, cy0 = oy + s * (B.y0 + B.y1) / 2;
    const s1 = target.width / 1.06 / Math.max(B.x1 - B.x0, B.y1 - B.y0) * 0.965;   // measured against mark.png, so the hand-over doesn't jump in size
    const cx1 = target.left + target.width / 2, cy1 = target.top + target.height / 2;
    const hitT = go - FLY, punch = 1;   // no bump on landing: it settles into the key at exactly the key's size
    // a jump: a quick crouch, then it leaps up and out toward you (it grows on the way) and drops onto the key
    // the antic: the landing drives it straight down into the crouch (no ease-in, so no pause), it gathers, then springs out into the jump
    const ak = clamp(go / ANTIC), gather = go < ANTIC ? E.out(ak) : Math.max(0, 1 - (go - ANTIC) / 0.07);
    const crouch = 1 - 0.12 * gather, sink = s * 0.35 * gather;
    const toward = 1 + 0.7 * Math.sin(Math.PI * Math.pow(k, 0.8));
    const sk = lerp(s, s1, k) * toward * crouch * punch, cx = lerp(cx0, cx1, k), cy = lerp(cy0, cy1, k) - Math.sin(Math.PI * k) * s * 2.4 + sink;
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#1E2024'; c.fillRect(0, 0, w, h);
    if (hitT > 0) {
      const R = Math.hypot(Math.max(cx1, w - cx1), Math.max(cy1, h - cy1)) * 1.05, rk = E.out(clamp(hitT / RIPPLE)), r = R * rk;
      c.save(); c.globalCompositeOperation = 'destination-out';
      const soft = Math.max(1, r * 0.18), gr = c.createRadialGradient(cx1, cy1, Math.max(0, r - soft), cx1, cy1, r);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gr; c.beginPath(); c.arc(cx1, cy1, r, 0, Math.PI * 2); c.fill(); c.restore();
    }
    drawScene(c, cx - sk * (B.x0 + B.x1) / 2, cy - sk * (B.y0 + B.y1) / 2, sk, [{ cubes: BLOCK, tf: p => p }, { cubes: [[0, 0, 0]], tf: p => [p[0] + LOGO[0], p[1] + LOGO[1], p[2] + LOGO[2]], bias: 0.01 }]);
    return;
  }
  const a = spinAt(t), g = lerp(0.5, 1, E.out(clamp(t / 0.35)));
  const grow = p => [1 + (p[0] - 1) * g, 1 + (p[1] - 1) * g, 1 + (p[2] - 1) * g];
  // a sharp knock: the block gives a hard little jolt as the corner breaks away
  const hit = t > REL && t < REL + 0.1 ? Math.sin(Math.PI * (t - REL) / 0.1) * 0.13 * (1 - (t - REL) / 0.1) : 0;
  const objects = [{ cubes: BLOCK, tf: p => { const q = grow(rotZ(p, a)); return [q[0] - hit * 0.6, q[1] + hit * 0.4, q[2] - hit * 0.5]; } }];
  let small;
  if (t < REL) small = p => grow(rotZ([p[0] + HOME[0], p[1] + HOME[1], p[2] + HOME[2]], a));
  else {
    // The block has stopped. A hit: the corner is knocked loose and thrown up (fast off the block, hangs at
    // the top, drops fast), turning over only a quarter, lands hard in its place and gives one small bounce.
    const from = [HOME[0] + 0.5, HOME[1] + 0.5, HOME[2] + 0.5], to = [LOGO[0] + 0.5, LOGO[1] + 0.5, LOGO[2] + 0.5];
    const d = [to[0] - from[0], to[1] - from[1]], dl = Math.hypot(...d) || 1, dir = [d[0] / dl, d[1] / dl];
    const tau = Math.min(t - REL, FLIGHT), k = tau / FLIGHT;
    const G = 34, v = (to[2] - from[2] + G * FLIGHT * FLIGHT) / FLIGHT;   // a real throw: up fast, gravity brings it down
    const across = E.out(k);                                           // air drag: quick off the block, slower in
    let pos = [lerp(from[0], to[0], across), lerp(from[1], to[1], across), from[2] + v * tau - G * tau * tau];
    let turn = Math.PI / 2 * E.outQuad(k);                                 // a quarter turn over, not a spin
    const after = t - LANDS;
    if (after > 0) {   // one small bounce, then still
      const b = 0.2; pos[2] = to[2] + (after < b ? 0.16 * Math.sin(Math.PI * after / b) : 0);
      turn = Math.PI / 2 + (after < 0.3 ? -0.09 * Math.sin(Math.PI * after / 0.3) : 0);
    }
    // turned about the cube's own axis nearest its path, so a quarter turn lands square; its top goes the way it travels
    const axis = Math.abs(dir[0]) >= Math.abs(dir[1]) ? [0, Math.sign(dir[0]), 0] : [-Math.sign(dir[1]), 0, 0];
    small = p => { const q = rotAxis([p[0] - 0.5, p[1] - 0.5, p[2] - 0.5], axis, turn); return [q[0] + pos[0], q[1] + pos[1], q[2] + pos[2]]; };
    const ct = (t - REL - 0.02) * 1.3;   // crumbs once the corner has cleared the break
    if (ct > 0 && ct < 0.6) for (const cr of CRUMBS) {
      const o = [from[0] + 0.4 + cr.v[0] * ct * 0.8, from[1] - 0.2 + cr.v[1] * ct * 0.8, from[2] + cr.v[2] * ct - 8 * ct * ct], sc = cr.size * (1 - ct / 0.6);
      objects.push({ cubes: [[0, 0, 0]], tf: p => [o[0] + (p[0] - 0.5) * sc, o[1] + (p[1] - 0.5) * sc, o[2] + (p[2] - 0.5) * sc], bias: 0.3 });
    }
  }
  c.clearRect(0, 0, w, h);
  c.fillStyle = '#1E2024'; c.fillRect(0, 0, w, h);
  // once it's loose the corner is drawn on its own, over the block, so the two never fight over who's in front
  if (t < REL) { objects.push({ cubes: [[0, 0, 0]], tf: small, bias: 0.01 }); drawScene(c, ox, oy, s, objects); }
  else { drawScene(c, ox, oy, s, [objects[0]]); drawScene(c, ox, oy, s, [...objects.slice(1), { cubes: [[0, 0, 0]], tf: small }]); }
  const f = target ? 0 : clamp((t - HOLD) / (END - HOLD));   // no key to fly to: just fade
  if (f > 0) { c.save(); c.globalCompositeOperation = 'destination-out'; c.globalAlpha = E.sine(f); c.fillRect(0, 0, w, h); c.restore(); }
}

// Plays once on launch over the app; never blocks touches, and skipped for reduced motion.
export function playIntro() {
  const el = document.getElementById('intro'); if (!el) return;
  // Once per launch: a reload in the same session (a new version taking over) doesn't play it again
  let seen = false; try { seen = sessionStorage.getItem('qg_intro') === '1'; sessionStorage.setItem('qg_intro', '1'); } catch {}
  if (seen || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.remove(); window.__introDone = Promise.resolve(); return; }
  let finished; window.__introDone = new Promise(r => { finished = r; });
  const cv = el.querySelector('canvas'), dpr = Math.min(3, devicePixelRatio || 1);
  const size = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
  size();
  const c = cv.getContext('2d'); let t0 = null, target;
  document.documentElement.classList.add('intro-on');   // the Quarry logo key waits for the mark to land in it
  const done = () => { el.remove(); document.documentElement.classList.remove('intro-on'); finished(); };
  const tick = now => {
    if (t0 === null) t0 = now;
    const t = (now - t0) / 1000;
    if (t >= HOLD && target === undefined) {
      const img = document.querySelector('#gear img'), r = img && img.getBoundingClientRect();
      target = r && r.width > 4 && r.top >= 0 && r.top < innerHeight ? r : null;
      el.style.background = 'transparent';
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (t < END) drawIntro(c, innerWidth, innerHeight, t, target || null); else { c.clearRect(0, 0, innerWidth, innerHeight); document.documentElement.classList.remove('intro-on'); }
    const page = document.querySelector('#reviews.show'), wv = pageWarp(t, target);
    if (page && wv !== null) { page.style.transformOrigin = `${target.left + target.width / 2}px ${target.top + target.height / 2}px`; page.style.transform = wv; }
    if (t < END + 0.35) requestAnimationFrame(tick); else { if (page) page.style.transform = ''; done(); }
  };
  requestAnimationFrame(tick);
}

// The page's warp as it ripples into view: it swells out from the corner the mark hit, tipped a little
// away from it, and springs back flat. A CSS transform for the page (applied by playIntro).
export function pageWarp(t, target) {
  const hitT = t - HOLD - FLY; if (!target || hitT <= 0) return null;
  const k = clamp(hitT / (RIPPLE + 0.35)); if (k >= 1) return '';
  const wave = Math.exp(-k * 4.2) * Math.cos(k * Math.PI * 3.2);     // a damped swing: in, out a little, settled
  const sc = 1 - 0.1 * wave, rx = 10 * wave, ry = -10 * wave;
  return `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${sc.toFixed(4)})`;
}

// The mark at rest, on a clear background (used to make icons/mark.png).
export function drawMark(c, w, h) {
  const s = Math.min(w, h) / 7, ox = w * 0.38, oy = h * 0.55;
  drawScene(c, ox, oy, s, [{ cubes: BLOCK, tf: p => p }, { cubes: [[0, 0, 0]], tf: p => [p[0] + LOGO[0], p[1] + LOGO[1], p[2] + LOGO[2]], bias: 0.01 }]);
}

// ---------- loader: the Quarry mark as a looping loading indicator (samples A and B) ----------
// The same creep, whip, settle and hold as the mirror-squares loader, on the mark itself.
const loaderEase = u => { const v = Math.min(1, u / 0.85); return v < 0.5 ? 0.5 * Math.pow(2 * v, 3.2) : 1 - 0.5 * Math.pow(2 * (1 - v), 3.6); };
export function drawLoaderMark(c, size, t, variant = 'A', cycle = 2) {
  const s = size / 5.6, ox = size / 2 - s * 0.6, oy = size * 0.66;
  const n = Math.floor(t / cycle), u = t / cycle - n, e = loaderEase(u);
  c.clearRect(0, 0, size, size);
  if (variant === 'A') {
    // the corner hops out to its place and back into the notch, turn about
    const out = n % 2 === 0, k = out ? e : 1 - e;
    const pos = [lerp(HOME[0], LOGO[0], k), lerp(HOME[1], LOGO[1], k), lerp(HOME[2], LOGO[2], k) + Math.sin(k * Math.PI) * 0.7];
    drawScene(c, ox, oy, s, [{ cubes: BLOCK, tf: p => p }, { cubes: [[0, 0, 0]], tf: p => [p[0] + pos[0], p[1] + pos[1], p[2] + pos[2]], bias: 0.25 }]);
  } else {
    // the whole mark turns a quarter about its middle each cycle, and the corner cube hops as it goes
    const a = (n + e) * Math.PI / 2, hop = Math.sin(e * Math.PI) * 0.45;
    const rz = (p, cx, cy) => { const co = Math.cos(a), si = Math.sin(a), x = p[0] - cx, y = p[1] - cy; return [cx + x * co - y * si, cy + x * si + y * co, p[2]]; };
    const C = [1.4, 0.6];
    drawScene(c, ox, oy - s * 0.1, s, [{ cubes: BLOCK, tf: p => rz(p, ...C) },
      { cubes: [[0, 0, 0]], tf: p => { const q = rz([p[0] + LOGO[0], p[1] + LOGO[1], p[2] + LOGO[2]], ...C); return [q[0], q[1], q[2] + hop]; }, bias: 0.25 }]);
  }
}
