// How big each held frame can be. Every frame is kept decoded, so a long clip at full size can run an
// iPad or iPhone out of graphics memory, and then the whole picture goes black. Long clips are held
// smaller instead, to fit the budget; a clip that would end up under MIN_W wide is refused.
export const MAX_W = 960, MIN_W = 320;
export const IOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
export const IPHONE = typeof navigator !== 'undefined' && /iPhone|iPod/.test(navigator.userAgent);
// iPad: a 240-frame clip fits at full size. iPhone has less graphics memory: a 291-frame clip went black at 512 MB.
export const BUDGET = IPHONE ? 220e6 : IOS ? 512e6 : 900e6;

export function frameSize(count, w, h, budget = BUDGET) {
  const s = Math.min(1, MAX_W / w, Math.sqrt(budget / (count * w * h * 4)));
  const W = Math.floor(w * s), H = Math.floor(h * s);
  return W < Math.min(MIN_W, w) ? null : { W, H };
}
