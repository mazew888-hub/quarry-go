import { test } from 'node:test';
import assert from 'node:assert/strict';
import { view } from '../js/overlay.js';

const snap = () => ({
  status: { snapshot: 3 },
  library: { items: [
    { key: 'Poses/a.jpg', folder: 'Poses', tags: ['misc', 'pose'], title: 'A' },
    { key: 'Poses/b.jpg', folder: 'Poses', tags: [], title: 'B' },
  ] },
  folders: { folders: ['Anatomy', 'Poses'] },
  tags: { tags: [] },
  xqueue: { posts: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] },
});
const none = { last: 0, failed: [] };

test('keep removes from queue', () => {
  const v = view(snap(), [{ n: 1, op: 'keep', id: 'p2', folder: 'Poses' }], none);
  assert.deepEqual(v.queue.map(p => p.id), ['p1', 'p3']);
  assert.equal(v.pending, 1);
});

test('undo restores order', () => {
  const v = view(snap(), [{ n: 1, op: 'skip', id: 'p2' }, { n: 2, op: 'undo', id: 'p2' }], none);
  assert.deepEqual(v.queue.map(p => p.id), ['p1', 'p2', 'p3']);
});

test('undo of a post the snapshot no longer has puts it back first', () => {
  const s = snap(); s.xqueue.posts = [{ id: 'p1' }];
  const v = view(s, [{ n: 4, op: 'undo', id: 'p9', post: { id: 'p9' } }], { last: 3, failed: [] });
  assert.deepEqual(v.queue.map(p => p.id), ['p9', 'p1']);
});

test('tag add/remove', () => {
  const v = view(snap(), [{ n: 1, op: 'tag', key: 'Poses/a.jpg', add: ['Gesture', 'pose'], remove: ['misc'] }], none);
  assert.deepEqual(v.items[0].tags, ['Gesture', 'pose']);
});

test('move rewrites key and folder', () => {
  const v = view(snap(), [{ n: 1, op: 'move', key: 'Poses/b.jpg', folder: 'Anatomy' }], none);
  assert.equal(v.items[1].key, 'Anatomy/b.jpg');
  assert.equal(v.items[1].folder, 'Anatomy');
  const t = view(snap(), [{ n: 1, op: 'move', key: 'Poses/b.jpg', folder: 'Anatomy' }, { n: 2, op: 'tag', key: 'Anatomy/b.jpg', add: ['x'], remove: [] }], none);
  assert.deepEqual(t.items[1].tags, ['x']);
});

test('overlay drops applied actions', () => {
  const acts = [4, 5, 6].map(n => ({ n, op: 'skip', id: 'p' + (n - 3) }));
  const v = view(snap(), acts, { last: 5, failed: [] });
  assert.deepEqual(v.queue.map(p => p.id), ['p1', 'p2']);
  assert.equal(v.pending, 1);
});

test('failed listed with reason', () => {
  const acts = [{ n: 2, op: 'tag', key: 'Gone/x.jpg', add: ['a'], remove: [] }];
  const v = view(snap(), acts, { last: 2, failed: [{ n: 2, op: 'tag', reason: "That item isn't in the library any more" }] });
  assert.equal(v.failed.length, 1);
  assert.equal(v.failed[0].reason, "That item isn't in the library any more");
  assert.equal(v.failed[0].action.key, 'Gone/x.jpg');
  assert.equal(v.pending, 0);
});

test('tag counts follow overlay', () => {
  const v = view(snap(), [{ n: 1, op: 'tag', key: 'Poses/b.jpg', add: ['pose'], remove: [] }], none);
  assert.deepEqual(v.tags.find(t => t.tag === 'pose'), { tag: 'pose', n: 2 });
  assert.equal(v.tags[0].tag, 'pose');
});

test('empty snapshot gives an empty view', () => {
  const v = view(null, [], none);
  assert.deepEqual([v.items, v.queue, v.folders, v.tags, v.pending], [[], [], [], [], 0]);
});
