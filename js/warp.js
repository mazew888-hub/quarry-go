// Time warp, as Quarry does it: a curve of keys mapping each played (output) frame x to the video
// (source) frame y it shows. Keys: {x, y, t} with t the key's tangent: 'linear', 'smooth', 'flat' or
// 'step' (holds its value until the next key). Between keys the curve is a Hermite spline, the way a
// time warp curve behaves in Maya's Graph Editor, so it exports to Maya key for key.
// Every function returns new keys (or null when the change can't be made); nothing is changed in place.

export const TANS = ['linear', 'smooth', 'flat', 'step'];
const r3 = v => Math.round(v * 1000) / 1000;
const sorted = keys => [...keys].sort((a, b) => a.x - b.x);

export function identity(n) {
  return n <= 1 ? [{ x: 0, y: 0, t: 'linear' }] : [{ x: 0, y: 0, t: 'linear' }, { x: n - 1, y: n - 1, t: 'linear' }];
}

// In and out slopes (source frames per output frame) at each key.
export function slopes(keys) {
  return keys.map((k, i) => {
    const p = keys[i - 1], q = keys[i + 1];
    const sl = p ? (k.y - p.y) / (k.x - p.x) : null, sr = q ? (q.y - k.y) / (q.x - k.x) : null;
    const lin = { in: sl ?? sr ?? 0, out: sr ?? sl ?? 0 };
    if (k.t === 'flat') return { in: 0, out: 0 };
    if (k.t === 'smooth') { const s = p && q ? (q.y - p.y) / (q.x - p.x) : (sl ?? sr ?? 0); return { in: s, out: s }; }
    if (k.t === 'step') return { in: lin.in, out: 0 };
    return lin;
  });
}

export function sampler(keys) {
  const s = slopes(keys);
  return x => {
    if (keys.length === 1 || x <= keys[0].x) return keys[0].y;
    const last = keys[keys.length - 1];
    if (x >= last.x) return last.y;
    let i = 0; while (keys[i + 1].x <= x) i++;
    const a = keys[i], b = keys[i + 1];
    if (x === a.x) return a.y;
    if (a.t === 'step') return a.y;
    const h = b.x - a.x, t = (x - a.x) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * a.y + (t3 - 2 * t2 + t) * h * s[i].out + (-2 * t3 + 3 * t2) * b.y + (t3 - t2) * h * s[i + 1].in;
  };
}

// The video frame shown at each played frame (whole frames, inside the clip).
export function frameMap(keys, n) {
  const f = sampler(keys), len = Math.max(1, Math.round(keys[keys.length - 1].x) + 1), out = new Array(len);
  for (let i = 0; i < len; i++) out[i] = Math.max(0, Math.min(n - 1, Math.round(f(i))));
  return out;
}
export const isIdentity = (keys, n) => { const m = frameMap(keys, n); return m.length === n && m.every((v, i) => v === i); };
export const keyAt = (keys, x) => keys.findIndex(k => k.x === Math.round(x));
// How fast the video plays around played frame x (1 = real time, 0 = held).
export function rateAt(keys, x) { const f = sampler(keys); return Math.round((f(x + 0.5) - f(x - 0.5)) * 100) / 100; }

// Hold / Cut / Speed sections (Quarry Go before 0.6) as a curve: linear keys, stepped where a hold ends or a cut jumps.
export function fromSections(n, secs) {
  const keys = [];
  const put = (x, y, step = false) => {
    const last = keys[keys.length - 1];
    if (last && last.x === x) { last.y = y; last.t = step ? 'step' : 'linear'; } else keys.push({ x, y, t: step ? 'step' : 'linear' });
  };
  let o = 0, f = 0, tail = null;
  for (const z of sorted(secs.map(s => ({ ...s, x: s.a })))) {
    if (z.a > f) { put(o, f); o += z.a - f; f = z.a; tail = { x: o - 1, y: f - 1 }; }
    if (z.type === 'cut') { if (o > 0) put(o - 1, f - 1, true); f = z.b + 1; continue; }
    const len = z.b - z.a + 1;
    if (z.type === 'hold') { put(o, z.a); put(o + len - 1, z.a, true); o += len; tail = { x: o - 1, y: z.a }; }
    else { const m = Math.max(1, Math.round(len / z.r)); put(o, z.a); o += m; tail = { x: o - 1, y: z.a + (m - 1) * len / m }; }
    f = z.b + 1;
  }
  if (f < n) { put(o, f); o += n - f; put(o - 1, n - 1); }
  else if (tail && (!keys.length || tail.x > keys[keys.length - 1].x)) put(tail.x, tail.y);
  if (!keys.length) keys.push({ x: 0, y: 0, t: 'linear' });
  return keys;
}

// A key at played frame x, on the curve as it is (so nothing moves). Returns the same keys if there's one there.
export function setKey(keys, x) {
  const last = keys[keys.length - 1].x;
  x = Math.max(0, Math.min(last, Math.round(x)));
  if (keyAt(keys, x) >= 0) return keys;
  const prev = [...keys].reverse().find(k => k.x < x), next = keys.find(k => k.x > x);
  const t = prev && prev.t === 'step' ? 'step' : prev && next && (prev.t === 'smooth' || next.t === 'smooth') ? 'smooth' : 'linear';
  return sorted([...keys, { x, y: r3(sampler(keys)(x)), t }]);
}
export function deleteKey(keys, i) {
  if (keys.length <= 2 || i <= 0 || i >= keys.length - 1) return null;
  return keys.filter((_, j) => j !== i);
}
// Every key after played frame x moves d frames later (or sooner): that stretch plays longer (or shorter).
export function nudgeAfter(keys, x, d) {
  if (!keys.some(k => k.x > x)) return null;
  const out = keys.map(k => k.x > x ? { ...k, x: k.x + d } : k);
  for (let i = 1; i < out.length; i++) if (out[i].x <= out[i - 1].x) return null;
  return out;
}
// One key shows a frame later (or sooner) in the video.
export function nudgeKey(keys, i, d, n) {
  return keys.map((k, j) => j === i ? { ...k, y: Math.max(0, Math.min(n - 1, Math.round(k.y) + d)) } : k);
}
export const setTangent = (keys, i, t) => keys.map((k, j) => j === i ? { ...k, t } : k);
// Drag a key: whole frames, between its neighbours; the first key stays on the first frame.
export function moveKey(keys, i, x, y, n) {
  const p = keys[i - 1], q = keys[i + 1];
  const nx = i === 0 ? 0 : Math.max(p.x + 1, q ? Math.min(q.x - 1, Math.round(x)) : Math.round(x));
  return keys.map((k, j) => j === i ? { ...k, x: nx, y: Math.max(0, Math.min(n - 1, Math.round(y))) } : k);
}

// ---------- the one-tap shapes, over played frames a..b (inclusive)
// Keys before a, pinned at a-1 so the curve up to the range keeps its shape.
function head(keys, a, f, t = 'linear') {
  const out = keys.filter(k => k.x < a).map(k => ({ ...k }));
  if (a > 0) {
    const lastK = out[out.length - 1];
    if (lastK && lastK.x === a - 1) { if (t === 'step') lastK.t = 'step'; }
    else out.push({ x: a - 1, y: r3(f(a - 1)), t });
  }
  return out;
}
export function holdRange(keys, a, b) {
  const f = sampler(keys), last = keys[keys.length - 1].x, y0 = Math.round(f(a));
  const out = head(keys, a, f);
  if (b + 1 <= last) {
    out.push({ x: a, y: y0, t: 'step' }, { x: b + 1, y: r3(f(b + 1)), t: 'linear' });
    out.push(...keys.filter(k => k.x > b + 1));
  } else { out.push({ x: a, y: y0, t: 'linear' }); if (last > a) out.push({ x: last, y: y0, t: 'linear' }); }
  return out;
}
export function cutRange(keys, a, b) {
  const f = sampler(keys), last = keys[keys.length - 1].x, len = b - a + 1;
  if (a <= 0 && b >= last) return keys;
  const out = head(keys, a, f, 'step');
  if (b + 1 <= last) {
    out.push({ x: a, y: r3(f(b + 1)), t: 'linear' });
    out.push(...keys.filter(k => k.x > b + 1).map(k => ({ ...k, x: k.x - len })));
  }
  return out;
}
export function speedRange(keys, a, b, r) {
  const f = sampler(keys), last = keys[keys.length - 1].x, len = b - a + 1, m = Math.max(1, Math.round(len / r));
  const out = head(keys, a, f);
  const ya = r3(f(a));
  out.push({ x: a, y: ya, t: 'linear' });
  if (b + 1 <= last) {
    out.push({ x: a + m, y: r3(f(b + 1)), t: 'linear' });
    out.push(...keys.filter(k => k.x > b + 1).map(k => ({ ...k, x: k.x + m - len })));
  } else {
    const yEnd = f(b) + (len > 1 ? (f(b) - f(a)) / (len - 1) : 1);
    if (m > 1) out.push({ x: a + m - 1, y: r3(ya + (yEnd - ya) * (m - 1) / m), t: 'linear' });
  }
  return out;
}

// ---------- reset: the keys stay, the curve goes back to real time
// The span around played frame x (between the keys either side of it) plays at real time: its end key
// keeps its video frame and slides to where that frame plays at 1x, and every later key slides with it,
// so the rest of the curve keeps its shape. A hold (or a span that runs backwards) closes up into one key.
// Both keys of the span become plain linear keys. null when there's nothing to change.
export function resetSpan(keys, x) {
  if (keys.length < 2) return null;
  let i = keys.length - 2; while (i > 0 && keys[i].x > x) i--;
  const a = keys[i], b = keys[i + 1], dy = Math.round(b.y - a.y);
  const out = keys.map(k => ({ ...k }));
  if (dy <= 0) {   // closes up: the span's end key goes, its start key takes its place in time
    const shift = a.x - b.x;
    out[i] = { x: a.x, y: b.y, t: 'linear' };
    out.splice(i + 1, 1);
    for (let j = i + 1; j < out.length; j++) out[j].x += shift;
    return out;
  }
  const shift = a.x + dy - b.x;
  if (shift === 0 && a.t === 'linear' && b.t === 'linear') return null;
  out[i].t = 'linear'; out[i + 1].t = 'linear';
  for (let j = i + 1; j < out.length; j++) out[j].x += shift;
  return out;
}
// Every span at real time: each key keeps its video frame and sits where that frame plays at 1x.
export function resetAll(keys) {
  const out = [{ x: keys[0].x, y: keys[0].y, t: 'linear' }];
  for (const k of keys.slice(1)) {
    const p = out[out.length - 1], dy = Math.round(k.y - p.y);
    if (dy <= 0) { p.y = k.y; continue; }   // a hold or a step back closes up
    out.push({ x: p.x + dy, y: k.y, t: 'linear' });
  }
  return out;
}

// Rows for Quarry's Maya time warp code: (x, y relative to the first key; in and out slopes; tangent types).
export function mayaRows(keys) {
  const s = slopes(keys), type = t => ({ linear: 'linear', flat: 'flat', step: 'step', smooth: 'fixed' }[t] || 'linear');
  return keys.map((k, i) => ({
    x: k.x - keys[0].x, y: k.y - keys[0].y, in: s[i].in, out: s[i].out,
    it: k.t === 'step' ? 'linear' : type(k.t), ot: type(k.t), unified: k.t === 'step' || s[i].in !== s[i].out ? 0 : 1,
  }));
}

// Frame keys: the view (played frames x0..x1, video frames y0..y1) around the 3 keys before played
// frame x and the 3 after (a key on x counts as after), with a little room round the edges.
export function frameView(keys, x, each = 3) {
  const before = keys.filter(k => k.x < x).slice(-each), after = keys.filter(k => k.x >= x).slice(0, each);
  const ks = [...before, ...after], f = sampler(keys);
  let x0 = Math.min(...ks.map(k => k.x), x), x1 = Math.max(...ks.map(k => k.x), x);
  const ys = [...ks.map(k => k.y), f(x)];
  for (let i = Math.floor(x0); i <= Math.ceil(x1); i++) ys.push(f(i)); // overshoot between keys stays in view
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (x1 - x0 < 4) { const c = (x0 + x1) / 2; x0 = c - 2; x1 = c + 2; }
  if (y1 - y0 < 4) { const c = (y0 + y1) / 2; y0 = c - 2; y1 = c + 2; }
  const px = (x1 - x0) * 0.06, py = (y1 - y0) * 0.08;
  return { x0: x0 - px, x1: x1 + px, y0: y0 - py, y1: y1 + py };
}
