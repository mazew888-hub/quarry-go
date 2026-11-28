// Feel: small sounds for X likes: slides when a card is swiped away, a
// keyboard-key click for the big buttons, a mouse click for the small ones, a deep whoomph for the ripple. Sounds are made on the spot (no files) and follow the
// iPhone's silent switch and media volume.

let ctx = null;

// Call from a touch so later sounds are allowed to play. iPhone only lets sound start from the end of a
// touch (touchend/click, not touchdown), and only once something has actually played in it, so every
// touch end resumes the sound and plays a silent blip.
export function prime() {
  try {
    // after another app plays sound (or a call), iPhone can leave the old one stuck "interrupted": start fresh
    if (ctx && ctx.state !== 'running' && ctx.state !== 'suspended') { try { ctx.close(); } catch {} ctx = null; noiseBuf = null; }
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    const b = ctx.createBuffer(1, 1, 22050), src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start(0);
  } catch {}
}
// Taps: iPhone gives web apps no way to make them (the hidden-switch trick Apple allowed in iOS 17.4 to 26.4
// was closed in 26.5), so this only does anything where navigator.vibrate exists (Android).
export function tap(strong = false) {
  try { if (navigator.vibrate) navigator.vibrate(strong ? [10, 60, 10] : 10); } catch {}
}

// Tactile sounds: short taps, clicks and paper-soft swishes made from filtered noise, with only a low
// "body" thump under some (no beepy tones). ac is the audio context (live, or offline to make samples).
let noiseBuf = null;
function noise(ac) {
  if (noiseBuf && noiseBuf.sampleRate === ac.sampleRate) return noiseBuf;
  const n = ac.sampleRate, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return (noiseBuf = b);
}
// a burst of noise through a filter: type, centre frequency (from → to), length, loudness, attack
function hiss(ac, at, { type = 'bandpass', f0 = 2000, f1 = f0, q = 0.8, dur = 0.03, vol = 0.3, atk = 0.002 } = {}) {
  const t = ac.currentTime + at, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noise(ac); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + atk); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(ac.destination); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.01);
}
// a soft low thump: the "body" you feel more than hear
function thump(ac, at, { f0 = 150, f1 = 70, dur = 0.07, vol = 0.35 } = {}) {
  const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.01);
}

// a keyboard key: the plasticky "clack" of the keycap and the low "thock" of it bottoming out
function key(ac, at, { vol = 0.32 } = {}) {
  hiss(ac, at, { f0: 2400, q: 1.4, dur: 0.014, vol, atk: 0.0008 });
  thump(ac, at + 0.004, { f0: 340, f1: 190, dur: 0.035, vol: vol * 0.9 });
  hiss(ac, at + 0.004, { type: 'lowpass', f0: 1100, dur: 0.03, vol: vol * 0.5, atk: 0.001 });
}
// a mouse click: a tiny, crisp, light snap
function mouse(ac, at, { vol = 0.22 } = {}) {
  hiss(ac, at, { f0: 5200, q: 2.5, dur: 0.004, vol, atk: 0.0005 });
  thump(ac, at, { f0: 1800, f1: 1200, dur: 0.006, vol: vol * 0.4 });
}
// a slide: a card gliding over felt, the air rising (away to Keep) or falling (away to Skip)
function slide(ac, at, { f0 = 900, f1 = 2600, dur = 0.24, vol = 0.15 } = {}) {
  hiss(ac, at, { f0, f1, q: 0.7, dur, vol, atk: dur * 0.4 });
  hiss(ac, at, { type: 'lowpass', f0: f0 * 0.6, f1: f1 * 0.4, q: 0.5, dur: dur * 0.9, vol: vol * 0.6, atk: dur * 0.35 });
}
// the ripple: a deep soft "whoomph" that blooms out with the circle, and a faint glassy shimmer on its edge
function ripple(ac, at) {
  thump(ac, at, { f0: 85, f1: 38, dur: 0.55, vol: 0.5 });
  hiss(ac, at, { type: 'lowpass', f0: 160, f1: 900, q: 0.6, dur: 0.5, vol: 0.22, atk: 0.06 });
  hiss(ac, at + 0.05, { f0: 5200, f1: 7800, q: 1.2, dur: 0.6, vol: 0.035, atk: 0.2 });
}

export const SOUNDS = {
  open: ac => ripple(ac, 0),
  swipeKeep: ac => slide(ac, 0, { f0: 800, f1: 2800 }),
  swipeSkip: ac => slide(ac, 0, { f0: 2600, f1: 700 }),
  key: ac => key(ac, 0),         // the big buttons: Keep, Skip, Send, Bring in
  mouse: ac => mouse(ac, 0),     // the small ones: Undo, On X
  line: ac => mouse(ac, 0, { vol: 0.14 }),   // crossing the keep/skip line while swiping
};
export function sound(name) {
  try { if (!ctx) prime(); if (!ctx) return; if (ctx.state === 'suspended') ctx.resume(); SOUNDS[name] && SOUNDS[name](ctx); } catch {}
}

// unlock on every touch end, so the first Keep or Skip already has sound
for (const ev of ['touchend', 'click', 'pointerup']) addEventListener(ev, () => { if (!ctx || ctx.state !== 'running') prime(); }, { capture: true, passive: true });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running') { try { ctx.close(); } catch {} ctx = null; noiseBuf = null; } });

