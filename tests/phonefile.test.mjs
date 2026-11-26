import test from 'node:test';
import assert from 'node:assert/strict';
import { readParts } from '../js/phone.js';

test('the bundle gives every part, applied included', () => {
  const g = readParts([{ name: 'for phone.json', json: { kind: 'quarry-phone', status: { snapshot: 1 }, xqueue: { posts: [] }, applied: { p1: { last: 3, failed: [] } } } }]);
  assert.deepEqual(g.status, { snapshot: 1 }); assert.equal(g.applied.p1.last, 3);
});
test('separate files are named by part, copies like "status (1)" too', () => {
  const g = readParts([{ name: 'status (1).json', json: { snapshot: 2 } }, { name: 'xqueue.json', json: { posts: [1] } }, { name: 'p-x.json', json: { last: 5, failed: [] } }]);
  assert.equal(g.status.snapshot, 2); assert.deepEqual(g.xqueue.posts, [1]); assert.equal(g.appliedOne.last, 5);
});
test('anything else is ignored', () => {
  assert.deepEqual(readParts([{ name: 'notes.json', json: { hello: 1 } }]), {});
});
