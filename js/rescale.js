// A review whose clip was read at the wrong frame rate (an MPEG-4 playblast at 30 fps that Quarry Go
// guessed as 24): once the real rate is known, everything stored in frames moves to the real frames,
// keeping its time in seconds, so notes, drawings, holds and the time warp land where they were made.
// Returns the patch to save, or null when there's nothing to change.
export function rescaleReview(r, fps, count) {
  if (!r || !(r.fps > 0) || !(fps > 0) || Math.abs(fps / r.fps - 1) < 0.01) return null;
  const k = fps / r.fps, last = Math.max(0, count - 1);
  const fr = f => Math.max(0, Math.min(last, Math.round(f * k)));
  const r3 = v => Math.round(v * 1000) / 1000;
  const p = { fps, frameCount: count };
  if (r.marks) p.marks = r.marks.map(m => (typeof m.f === 'number' ? { ...m, f: fr(m.f) } : m));
  if (r.holds) p.holds = Object.fromEntries(Object.entries(r.holds).map(([f, n]) => [fr(+f), Math.max(1, Math.round(n * k))]));
  if (r.warp && r.warp.keys) {
    // played frames (x) and video frames (y) both scale; slopes (y per x) don't change
    let px = -1;
    p.warp = { ...r.warp, keys: r.warp.keys.map(key => {
      const x = Math.max(px + 1, Math.round(key.x * k)); px = x;
      return { ...key, x, y: Math.min(last, r3(key.y * k)) };
    }) };
  }
  for (const f of ['inF', 'outF']) if (typeof r[f] === 'number') p[f] = fr(r[f]);
  if (typeof r.pos === 'number') p.pos = Math.round(r.pos * k);   // a played frame: the player keeps it in range
  if (r.secs) p.secs = r.secs.map(s => ({ ...s, a: fr(s.a), b: fr(s.b) }));
  return p;
}
