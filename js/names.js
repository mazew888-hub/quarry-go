// Names for videos picked from Photos. The iPhone hides a video's real name from web apps there and hands
// over a made-up code (a long hex string or a UUID); those videos are called Video 1, 2, 3... instead.

// A long run of hex digits, with or without dashes: 20 or more, so short words like "deadbeef" are left alone.
export const looksLikeCode = name => {
  const s = String(name || '').trim();
  return /^[0-9a-f-]+$/i.test(s) && s.replace(/-/g, '').length >= 20 && /\d/.test(s);
};

// For one day's videos: { id: 'Video n' } for each code-named one, numbered in the order they were added,
// carrying on after the highest Video n already there.
export function videoNames(reviews) {
  let n = 0;
  for (const r of reviews) { const m = /^Video (\d+)$/.exec(r.name || ''); if (m) n = Math.max(n, +m[1]); }
  const out = {};
  for (const r of [...reviews].sort((a, b) => a.created - b.created)) if (looksLikeCode(r.name)) out[r.id] = `Video ${++n}`;
  return out;
}
