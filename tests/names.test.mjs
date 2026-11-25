import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeCode, videoNames } from '../js/names.js';

test('code-like names from the Photos picker are spotted, real names are not', () => {
  for (const n of ['adf40401c68e605028d78a3d8c0b1e2f', 'ec22deccd6b1bf84d30dd0a4bdd9', 'D4F1A2B3-9C8E-4F7A-B6D5-1E2F3A4B5C6D', '774b9879c9b0d45ecf752581728'])
    assert.ok(looksLikeCode(n), n);
  for (const n of ['IMG_1234', 'Brute hitreact', 'run_cycle_v02', 'deadbeef', 'Clip', 'Video 3', '2026-11-24 attack'])
    assert.ok(!looksLikeCode(n), n);
});

test('code-named videos are numbered in the order they were added, after the videos already named that way', () => {
  const day = [
    { id: 'a', name: 'Video 1', created: 1 },
    { id: 'b', name: 'Brute hitreact', created: 2 },
    { id: 'c', name: 'adf40401c68e605028d78a3d8c0b1e2f', created: 4 },
    { id: 'd', name: 'ec22deccd6b1bf84d30dd0a4bdd9aa11', created: 3 },
  ];
  assert.deepEqual(videoNames(day), { d: 'Video 2', c: 'Video 3' });
});

test('nothing to rename gives nothing back', () => {
  assert.deepEqual(videoNames([{ id: 'a', name: 'Run', created: 1 }]), {});
});
