// Feel: small sounds and taps for X likes. Sounds are made on the spot (no files) and follow the
// iPhone's silent switch. Taps: iPhone Safari has no vibrate, but flipping a hidden on/off switch gives
// the same light tap the system switches give (iOS 18 and later); elsewhere navigator.vibrate is used.

let ctx = null, sw = null;

// Call from a touch (pointerdown/click) so later sounds are allowed to play.
export function prime() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {}
  if (!sw) {
    try {
      const l = document.createElement('label'), i = document.createElement('input');
      i.type = 'checkbox'; i.setAttribute('switch', ''); l.append(i);
      l.style.cssText = 'position:fixed;left:-99px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      l.setAttribute('aria-hidden', 'true'); document.body.append(l); sw = l;
    } catch {}
  }
}

export function tap(strong = false) {
  try {
    if (navigator.vibrate) { navigator.vibrate(strong ? 18 : 8); return; }
    if (!sw) prime();
    sw && sw.click();
    if (strong && sw) setTimeout(() => sw.click(), 70);   // a double tap reads as a firmer one
  } catch {}
}

// a note: frequency glide f0→f1 over dur seconds, with a quick attack and a soft tail
function note(f0, f1, at, dur, { type = 'sine', vol = 0.18 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + at;
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
}
// a breath of noise through a sweeping filter: whooshes and swishes
function air(at, dur, fFrom, fTo, vol = 0.12) {
  const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime + at;
  f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(fFrom, t); f.frequency.exponentialRampToValueAtTime(fTo, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.buffer = buf; s.connect(f).connect(g).connect(ctx.destination); s.start(t); s.stop(t + dur);
}

const SOUNDS = {
  open: () => { air(0, 0.55, 300, 2400, 0.1); note(392, 392, 0.05, 0.5, { vol: 0.08 }); note(587, 587, 0.12, 0.55, { vol: 0.07 }); note(784, 784, 0.2, 0.6, { vol: 0.06 }); },
  keep: () => { note(660, 700, 0, 0.09, { type: 'triangle', vol: 0.16 }); note(990, 1050, 0.07, 0.16, { type: 'triangle', vol: 0.14 }); },
  skip: () => { air(0, 0.18, 1800, 400, 0.09); note(220, 160, 0, 0.12, { vol: 0.08 }); },
  undo: () => { note(990, 940, 0, 0.08, { type: 'triangle', vol: 0.12 }); note(660, 620, 0.06, 0.14, { type: 'triangle', vol: 0.12 }); },
  line: () => note(1400, 1400, 0, 0.04, { type: 'sine', vol: 0.05 }),   // crossing the keep/skip line
  send: () => { note(784, 784, 0, 0.12, { vol: 0.1 }); note(988, 988, 0.08, 0.14, { vol: 0.1 }); note(1319, 1319, 0.16, 0.3, { vol: 0.09 }); },
};
export function sound(name) {
  try { if (!ctx) prime(); if (!ctx) return; if (ctx.state === 'suspended') ctx.resume(); SOUNDS[name] && SOUNDS[name](); } catch {}
}
