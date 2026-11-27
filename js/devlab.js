// Dev lab: X likes, kept off other people's phones. There's no way in from Settings: hold the Quarry
// logo key for 3 seconds, then Face ID, and it opens straight into Sort. The first time, this phone saves a
// passkey for it; after that only that passkey (and so your face) opens it. Unlocked until the app closes.
const KEY = 'qg_devlab_cred';
export const HOLD_MS = 3000;
// Tests on this machine (localhost only) may start unlocked; the real site never can.
let unlocked = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && localStorage.getItem('qg_devlab_test') === '1';
export const isUnlocked = () => unlocked;
export const lock = () => { unlocked = false; };
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const b64 = u => btoa(String.fromCharCode(...new Uint8Array(u)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function unlock() {
  if (!window.PublicKeyCredential || !navigator.credentials) throw new Error('Face ID isn’t available here');
  const saved = localStorage.getItem(KEY);
  if (!saved) {
    const c = await navigator.credentials.create({ publicKey: {
      challenge: rnd(32), rp: { name: 'Quarry Go' },
      user: { id: rnd(16), name: 'Quarry Go Dev lab', displayName: 'Quarry Go Dev lab' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000 } });
    localStorage.setItem(KEY, b64(c.rawId));
  } else {
    await navigator.credentials.get({ publicKey: {
      challenge: rnd(32), allowCredentials: [{ type: 'public-key', id: unb64(saved) }], userVerification: 'required', timeout: 60000 } });
  }
  unlocked = true;
}

// Holding a key: fires after HOLD_MS without moving off it, and swallows the tap that ends the hold.
export function holdToOpen(el, onHold) {
  let timer = null, held = false;
  const stop = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', () => { held = false; stop(); timer = setTimeout(() => { held = true; timer = null; onHold(); }, HOLD_MS); });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(t, stop);
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('click', e => { if (held) { held = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
}
