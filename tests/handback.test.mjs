import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipBytes, crc32 } from '../js/zip.js';
import { quarryNotes, warpKeys, timeWarpPy, fillMayaDrop, hasNotes, stemOf, folderFor } from '../js/handback.js';
import { dayOf, weekOfMonth, groupHistory } from '../js/days.js';
import { buildSeq } from '../js/retime.js';

const enc = s => new TextEncoder().encode(s);

// ---------- zip
test('crc32 matches the standard check value', () => {
  assert.equal(crc32(enc('123456789')), 0xCBF43926);
});
test('a zip that unzip reads back, folders and all', () => {
  const z = zipBytes([
    { name: 'grunt_attack/grunt_attack.quarrynotes', data: enc('{"a":1}') },
    { name: 'brute slam/brute slam - notes.mp4', data: new Uint8Array([0, 1, 2, 255]) },
  ], new Date(2026, 10, 24, 10, 30));
  const dir = mkdtempSync(join(tmpdir(), 'qgzip-'));
  writeFileSync(join(dir, 'a.zip'), z);
  execFileSync('unzip', ['-q', '-t', join(dir, 'a.zip')]);
  execFileSync('unzip', ['-q', join(dir, 'a.zip'), '-d', join(dir, 'out')]);
  assert.equal(readFileSync(join(dir, 'out/grunt_attack/grunt_attack.quarrynotes'), 'utf8'), '{"a":1}');
  assert.deepEqual([...readFileSync(join(dir, 'out/brute slam/brute slam - notes.mp4'))], [0, 1, 2, 255]);
});

// ---------- names
test('names: stem drops the extension, folders lose characters Windows refuses', () => {
  assert.equal(stemOf('grunt_attack_v3.mp4'), 'grunt_attack_v3');
  assert.equal(stemOf('noext'), 'noext');
  assert.equal(folderFor({ name: 'a:b?c' }), 'a-b-c');
});

// ---------- .quarrynotes
const review = {
  name: 'grunt_attack', fileName: 'grunt_attack.mp4', fps: 24, frameCount: 48, width: 1920, height: 1080,
  marks: [
    { f: 3, type: 'draw', pts: [[10, 20], [30.456, 40]], color: '#FF3B5C', size: 6 },
    { f: 3, type: 'arrow', x1: 1, y1: 2, x2: 3, y2: 4, color: '#4FA3FF', size: 4 },
    { f: 10, type: 'box', x1: 50, y1: 60, x2: 10, y2: 20, color: '#ECEEF1', size: 5 },
    { f: 12, type: 'circle', x1: 100, y1: 100, x2: 103, y2: 104 },
    { f: 7, type: 'note', text: 'Arc is flat here' },
  ],
  holds: { 3: 4 },
};
test('quarrynotes: Quarry\'s review-notes file with drawings as annotations and notes as comments', () => {
  const j = quarryNotes(review, { now: new Date('2026-11-24T10:00:00Z'), id: () => 'x' });
  assert.equal(j.app, 'quarry'); assert.equal(j.kind, 'review-notes'); assert.equal(j.version, 1);
  assert.equal(j.exported, '2026-11-24T10:00:00.000Z');
  assert.deepEqual(j.video, { name: 'grunt_attack.mp4', w: 1920, h: 1080, fps: 24, frames: 48, duration: 2 });
  const [pen, arrow, rect, ell] = j.annotations;
  assert.deepEqual(pen, { id: 1, kind: 'pen', color: 0xFFFF3B5C, size: 6, opacity: 1, points: [10, 20, 30.46, 40], frame: 3, hold: 4, pressure_width: false, pressure_opacity: false });
  assert.deepEqual(arrow.points, [1, 2, 3, 4]); assert.equal(arrow.kind, 'arrow'); assert.equal(arrow.hold, 4);
  assert.equal(arrow.color, 0xFF4FA3FF);
  assert.equal(rect.kind, 'rect'); assert.deepEqual(rect.points, [10, 20, 50, 20, 50, 60, 10, 60]); assert.equal(rect.hold, undefined);
  assert.equal(ell.kind, 'ellipse'); assert.deepEqual(ell.points, [95, 95, 105, 95, 105, 105, 95, 105]);
  assert.equal(ell.color, 0xFFFF3B5C); // the old default red
  assert.ok(ell.size > 0);
  assert.equal(j.comments.length, 1);
  assert.deepEqual(j.comments[0], { id: 'x', author: 'quarry-go', name: 'Quarry Go', at: '2026-11-24T10:00:00.000Z', frame: 7, text: 'Arc is flat here', replies: [] });
});
test('quarrynotes: annotation frame 0 is left out, as Quarry writes it', () => {
  const j = quarryNotes({ ...review, marks: [{ f: 0, type: 'draw', pts: [[1, 1], [2, 2]] }], holds: {} });
  assert.equal('frame' in j.annotations[0], false);
});
test('quarrynotes: reviews from before holds keep their 12 frames', () => {
  const j = quarryNotes({ ...review, holds: undefined });
  assert.equal(j.annotations[0].hold, 12);
});
test('time warp .py from a curve: smooth keys go in with their slopes', () => {
  const py = timeWarpPy({ name: 'g', fps: 24, frameCount: 20, retimed: true,
    warp: { keys: [{ x: 0, y: 0, t: 'linear' }, { x: 10, y: 5, t: 'smooth' }, { x: 20, y: 19, t: 'flat' }] } });
  const code = JSON.parse(py.match(/^_CODE = (.*)$/m)[1]);
  assert.match(code, /\(10,5,0\.95,0\.95,"fixed","fixed",1\)/);
  assert.match(code, /\(20,19,0,0,"flat","flat",1\)/);
});
test('hasNotes: marks or an applied retime', () => {
  assert.equal(hasNotes({ marks: [], secs: [] }), false);
  assert.equal(hasNotes({ marks: [{ type: 'note' }], secs: [] }), true);
  assert.equal(hasNotes({ marks: [], secs: [{ a: 0, b: 1, type: 'hold' }], retimed: true }), true);
  assert.equal(hasNotes({ marks: [], secs: [{ a: 0, b: 1, type: 'hold' }], retimed: false }), false);
});

// ---------- time warp
function sample(keys, x) { // value of the keyed curve at whole frame x (linear, or held after a stepped key)
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (x >= a.x && x <= b.x) {
      if (x === b.x) return b.y;
      if (a.step) return a.y;
      return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
    }
  }
  return keys[keys.length - 1].y;
}
const cases = [
  ['hold', 20, [{ a: 5, b: 9, type: 'hold' }]],
  ['cut', 20, [{ a: 5, b: 9, type: 'cut' }]],
  ['cut at the start', 20, [{ a: 0, b: 3, type: 'cut' }]],
  ['half speed', 20, [{ a: 4, b: 11, type: 'speed', r: 0.5 }]],
  ['double speed', 30, [{ a: 4, b: 19, type: 'speed', r: 2 }]],
  ['mixed', 40, [{ a: 2, b: 5, type: 'hold' }, { a: 8, b: 12, type: 'cut' }, { a: 20, b: 27, type: 'speed', r: 0.5 }]],
];
for (const [label, n, secs] of cases) {
  test(`time warp keys play the retime back: ${label}`, () => {
    const seq = buildSeq(n, secs, true).seq, keys = warpKeys(n, secs);
    assert.equal(keys[0].x, 0);
    assert.equal(keys[keys.length - 1].x, seq.length - 1);
    for (let i = 1; i < keys.length; i++) assert.ok(keys[i].x > keys[i - 1].x, 'keys move forward in time');
    const speed = secs.some(z => z.type === 'speed');
    seq.forEach((src, x) => {
      const v = Math.round(sample(keys, x));
      if (speed) assert.ok(Math.abs(v - src) <= 1, `${label} frame ${x}: ${v} vs ${src}`); else assert.equal(v, src, `${label} frame ${x}`);
    });
  });
}
test('time warp .py: Quarry\'s Maya file with relative keys', () => {
  const py = timeWarpPy({ name: 'grunt', fileName: 'grunt.mp4', fps: 24, frameCount: 20, secs: [{ a: 5, b: 9, type: 'hold' }] });
  assert.match(py, /^# -\*- coding: utf-8 -\*-\n# QUARRY TIME WARP: grunt\.mp4\n/);
  assert.match(py, /def onMayaDroppedPythonFile\(\*args\):/);
  const code = JSON.parse(py.match(/^_CODE = (.*)$/m)[1]);
  assert.match(code, /^import maya\.cmds as c, math\nK=\[\(0,0,1,1,"linear","linear",1\),/);
  assert.match(code, /\(9,5,0,0,"linear","step",0\)/); // the held frame, then a jump
  assert.match(code, /\nF=24\n/);
});

// ---------- Maya image plane
test('maya drop: Quarry\'s loader with the shot, rate and frames filled in', () => {
  const tpl = readFileSync(new URL('../maya/maya_drop.py', import.meta.url), 'utf8');
  const py = fillMayaDrop(tpl, { shot: 'grunt "v3"', stamp: '20261124_103000', fps: 24, frames: ['QUJD', 'REVG'] });
  assert.match(py, /^SHOT = 'grunt "v3"'  # QUARRY:SHOT$/m);
  assert.match(py, /^STAMP = '20261124_103000'  # QUARRY:STAMP$/m);
  assert.match(py, /^FPS = 24\.0  # QUARRY:FPS$/m);
  assert.match(py, /^DIGITS = 4  # QUARRY:DIGITS$/m);
  assert.match(py, /^EXT = 'jpg'  # QUARRY:EXT$/m);
  assert.match(py, /^STILL = False  # QUARRY:STILL$/m);
  assert.match(py, /^ALPHA = False  # QUARRY:ALPHA$/m);
  assert.ok(py.endsWith('_FRAMES = [\n"QUJD",\n"REVG",\n]\n'));
  assert.equal(py.split('_FRAMES = [').length, 2, 'the template\'s empty list is replaced, not kept');
});
test('maya drop: a shot name with a backslash and quote stays valid Python', () => {
  const tpl = readFileSync(new URL('../maya/maya_drop.py', import.meta.url), 'utf8');
  const py = fillMayaDrop(tpl, { shot: "it's\\x", stamp: '1', fps: 30, frames: [] });
  const line = py.split('\n').find(l => l.startsWith('SHOT = '));
  const out = execFileSync('python3', ['-c', line.replace('  # QUARRY:SHOT', '') + '\nprint(SHOT, end="")']).toString();
  assert.equal(out, "it's\\x");
});

// ---------- days
test('dayOf: the local date', () => {
  assert.equal(dayOf(new Date(2026, 10, 4, 23, 59).getTime()), '2026-11-04');
  assert.equal(dayOf({ day: '2026-10-30', created: 0 }), '2026-10-30');
  assert.equal(dayOf({ created: new Date(2026, 0, 2).getTime() }), '2026-01-02');
});
test('weekOfMonth: days 1-7 are week 1', () => {
  assert.deepEqual(['2026-11-01', '2026-11-07', '2026-11-08', '2026-11-19', '2026-10-30'].map(weekOfMonth), [1, 1, 2, 3, 5]);
});
test('groupHistory: this week as cards, older days under their month, newest first', () => {
  const now = new Date(2026, 10, 24, 12).getTime(); // a Tuesday
  const v = (day, i, notes) => ({ id: day + i, day, created: i, marks: notes ? [{ type: 'note' }] : [], secs: [] });
  const vids = [v('2026-11-24', 1, true), v('2026-11-24', 2, false), v('2026-11-23', 1, false), v('2026-11-22', 1, true),
    v('2026-11-19', 1, true), v('2026-11-11', 1, false), v('2026-10-30', 1, true), v('2026-10-30', 2, true)];
  const h = groupHistory(vids, now);
  assert.deepEqual(h.week.map(d => d.day), ['2026-11-24', '2026-11-23']); // the week starts on Monday
  assert.equal(h.week[0].today, true); assert.equal(h.week[1].today, false);
  assert.equal(h.week[0].count, 2); assert.equal(h.week[0].withNotes, 1);
  assert.deepEqual(h.week[0].videos.map(x => x.id), ['2026-11-241', '2026-11-242']); // in the order added
  assert.deepEqual(h.months.map(m => m.label), ['November 2026', 'October 2026']);
  assert.deepEqual(h.months[0].days.map(d => d.day), ['2026-11-22', '2026-11-19', '2026-11-11']);
  assert.deepEqual(h.months[1].days[0], { ...h.months[1].days[0], weekday: 'Fri', date: '30 Oct', week: 5, count: 2, withNotes: 2 });
});
