// Dev lab: X likes and Tag, kept out of the way on other people's phones. There's no way in from
// Settings: hold the Quarry logo key for 5 seconds and they open. Unlocked until the app closes.
export const HOLD_MS = 5000;
// Tests on this machine (localhost only) may start unlocked; the real site never can.
let unlocked = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && localStorage.getItem('qg_devlab_test') === '1';
export const isUnlocked = () => unlocked;
export const lock = () => { unlocked = false; };
export function unlock() { unlocked = true; }

// Holding a key: fires after HOLD_MS without moving off it, and swallows the tap that ends the hold.
export function holdToOpen(el, onHold) {
  let timer = null, held = false;
  const stop = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', () => { held = false; stop(); timer = setTimeout(() => { held = true; timer = null; onHold(); }, HOLD_MS); });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(t, stop);
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('click', e => { if (held) { held = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
}
