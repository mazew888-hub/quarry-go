// Retime sections, in source frames: {a, b, type:'speed'|'hold'|'cut', r}. They stay applied.
// buildSeq maps each timeline position to the source frame it shows.

export function buildSeq(n, secs, retimed) {
  const seq = [], at = [], cuts = [];
  const ss = [...secs].sort((x, y) => x.a - y.a);
  if (!retimed) {
    for (let f = 0; f < n; f++) { seq.push(f); at.push(ss.find(z => f >= z.a && f <= z.b) || null); }
    return { seq, at, cuts };
  }
  let f = 0;
  for (const z of ss) {
    for (; f < z.a; f++) { seq.push(f); at.push(null); }
    if (z.type === 'cut') cuts.push(seq.length);
    else if (z.type === 'hold') for (let k = 0; k <= z.b - z.a; k++) { seq.push(z.a); at.push(z); }
    else {
      const len = z.b - z.a + 1, m = Math.max(1, Math.round(len / z.r));
      for (let k = 0; k < m; k++) { seq.push(Math.min(z.b, z.a + Math.floor(k * len / m))); at.push(z); }
    }
    f = z.b + 1;
  }
  for (; f < n; f++) { seq.push(f); at.push(null); }
  if (!seq.length) { seq.push(0); at.push(null); }
  return { seq, at, cuts };
}

// Puts a section over source frames a..b, trimming whatever it overlaps. A null type just clears a..b.
export function applySection(secs, a, b, type, r) {
  const out = [];
  for (const z of secs) {
    if (z.b < a || z.a > b) { out.push(z); continue; }
    if (z.a < a) out.push({ ...z, b: a - 1 });
    if (z.b > b) out.push({ ...z, a: b + 1 });
  }
  const mine = type ? { a, b, type, r } : null;
  if (mine) out.push(mine);
  out.sort((x, y) => x.a - y.a);
  return { secs: out, mine };
}

export const isCut = (secs, f) => secs.some(z => z.type === 'cut' && f >= z.a && f <= z.b);
export function posAtOrAfter(seq, f) { for (let p = 0; p < seq.length; p++) if (seq[p] >= f) return p; return seq.length - 1; }
export function posAtOrBefore(seq, f) { for (let p = seq.length - 1; p >= 0; p--) if (seq[p] <= f) return p; return 0; }
