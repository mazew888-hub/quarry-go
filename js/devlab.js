import { prime, tap } from './feel.js';
// Dev lab: X likes and Tag, kept out of the way on other people's phones. There's no way in from
// Settings: hold the Quarry logo key for 3 seconds and they open. Unlocked until the app closes.
export const HOLD_MS = 3000;
// Tests on this machine (localhost only) may start unlocked; the real site never can.
let unlocked = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && localStorage.getItem('qg_devlab_test') === '1';
export const isUnlocked = () => unlocked;
export const lock = () => { unlocked = false; };
export function unlock() { unlocked = true; }

// Holding a key: fires after HOLD_MS without moving off it, and swallows the tap that ends the hold.
export function holdToOpen(el, onHold) {
  // hold: once it's long enough the key lights up and gives a tap; letting go then opens (so the opening's
  // sound and tap come from the release, which iPhone allows)
  let timer = null, held = false;
  const stop = () => { clearTimeout(timer); timer = null; };
  const unlight = () => el.classList.remove('charged');
  el.addEventListener('pointerdown', () => { prime(); held = false; stop(); unlight(); timer = setTimeout(() => { held = true; timer = null; el.classList.add('charged'); tap(); }, HOLD_MS); });
  el.addEventListener('pointerup', () => { stop(); if (held) { unlight(); onHold(); } });
  for (const t of ['pointercancel', 'pointerleave']) el.addEventListener(t, () => { stop(); if (held) { held = false; unlight(); } });
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('click', e => { if (held) { held = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
}
