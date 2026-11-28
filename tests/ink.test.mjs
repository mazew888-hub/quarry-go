import test from 'node:test';
import assert from 'node:assert/strict';
import { ink, widthFor } from '../js/stroke.js';

const E = (t, x, y, p) => ({ timeStamp: t, clientX: x, clientY: y, pressure: p });
const mk = (o = {}) => ink({ pen: true, smooth: 0, toPoint: e => [e.clientX, e.clientY], k: 1, ...o });

test('widthFor: the iPad Pencil reports light pressure (most lines under 0.1): light still draws a real line, zero is thinnest', () => {
  assert.ok(widthFor(0) < widthFor(0.03));
  assert.ok(widthFor(0.03) > 0.4, 'a light line is too thin');
  assert.ok(widthFor(0.4) > widthFor(0.1) && widthFor(0.1) > widthFor(0.03));
  assert.ok(widthFor(1) / widthFor(0) <= 5);
});

test('ink: each sample is used once, even when Safari sends the same samples again', () => {
  const s = mk();
  s.down(E(0, 0, 0, 0.08));
  s.move([E(4, 4, 0, .05), E(8, 8, 0, .05)]);
  s.move([E(4, 4, 0, .05), E(8, 8, 0, .05)]);           // the same move, sent twice
  s.move([E(4, 4, 0, .05), E(8, 8, 0, .05), E(12, 12, 0, .05)]);   // older samples repeated in a later list
  const xs = s.pts.map(p => p[0]);
  assert.deepEqual(xs, [0, 4, 8, 12]);                   // never steps back
});

test('ink: the 0.08 the Pencil reports on touch-down (before its real pressure) does not set the width', () => {
  const s = mk();
  s.down(E(0, 0, 0, 0.08));
  s.move([E(4, 5, 0, 0.08), E(8, 10, 0, 0.08), E(12, 15, 0, 0.01), E(16, 20, 0, 0.01)]);
  const w = s.pts.map(p => p[2]);
  assert.ok(w.every(v => Math.abs(v - w.at(-1)) < 0.05), w.join(','));   // the start matches the real light pressure
});

test('ink: a Pencil tap leaves a dot; lifting catches the line up to the tip', () => {
  const t = mk(); t.down(E(0, 5, 5, .2)); assert.equal(t.up(E(30, 5, 5, .2)).length, 1);
  const s = mk({ smooth: 0.75 });
  s.down(E(0, 0, 0, .2)); s.move([E(4, 20, 0, .2), E(8, 40, 0, .2)]);
  assert.ok(s.pts.at(-1)[0] < 30);                        // trailing behind while drawing
  assert.equal(s.up(E(9, 40, 0, .2)).at(-1)[0], 40);      // ends where the Pencil lifted
});

test('finger lines (brush): fine tips, full when slow, thin when fast', () => {
  const run = (stepPx) => {
    const s = ink({ pen: false, brush: true, smooth: 0, toPoint: e => [e.clientX, e.clientY] });
    s.down({ timeStamp: 0, clientX: 0, clientY: 0, pressure: 0 });
    for (let i = 1; i <= 60; i++) s.move([{ timeStamp: i * 8, clientX: i * stepPx, clientY: 0, pressure: 0 }]);
    return s.up();
  };
  const slow = run(1.2), fast = run(24), mid = a => a[Math.floor(a.length / 2)][2];
  assert.ok(slow[0][2] < 0.2 && slow.at(-1)[2] < 0.2, 'both ends come to a point');
  assert.ok(mid(slow) > 1.2, 'slow is full');
  assert.ok(mid(fast) < 0.5, 'fast thins');
});
test('finger lines without brush keep one even width', () => {
  const s = ink({ pen: false, toPoint: e => [e.clientX, e.clientY] });
  s.down({ timeStamp: 0, clientX: 0, clientY: 0 }); s.move([{ timeStamp: 8, clientX: 10, clientY: 0 }]);
  assert.equal(s.up()[0].length, 2);
});
