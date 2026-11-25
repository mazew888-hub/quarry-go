import test from 'node:test';
import assert from 'node:assert/strict';
import { friendlySaveError } from '../js/store.js';

test('a full phone reads as a plain message, including the UnknownError iPhone gives', () => {
  for (const e of [new DOMException('x', 'QuotaExceededError'), new DOMException('An unknown error occurred within Indexed Database.', 'UnknownError')])
    assert.match(friendlySaveError(e).message, /space/i);
});
test('other errors pass through untouched', () => {
  const e = new Error('something else');
  assert.equal(friendlySaveError(e), e);
});
