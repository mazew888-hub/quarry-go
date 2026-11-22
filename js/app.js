// Quarry Go: boot and routing.
import { loadFrames } from './frames.js';
import { openPlayer, log } from './player.js';

const $ = id => document.getElementById(id);
let toastT = 0;
export function toast(msg, ms = 3500) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}

// Test route, only when served from this machine: opens the player straight on a fixture.
async function testPlayer(q) {
  window.changes = [];
  try {
    const name = q.get('clip');
    const blob = await (await fetch(`tests/fixtures/${name}`)).blob();
    const maxBytes = q.has('maxBytes') ? +q.get('maxBytes') : undefined;
    const media = await loadFrames(blob, { maxBytes, log });
    openPlayer($('player'), { media, name: name.replace(/\.[^.]+$/, ''), onChange: p => window.changes.push(p), onBack: () => {} });
  } catch (e) { toast(e.message); }
}

const q = new URLSearchParams(location.search);
if (q.get('test') === 'player' && ['localhost', '127.0.0.1'].includes(location.hostname)) testPlayer(q);
