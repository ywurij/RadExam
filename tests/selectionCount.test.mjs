import assert from 'node:assert/strict';
import test from 'node:test';

import { getSelectionCount } from '../src/lib/utils.js';

test('uses the number of registered answers as the selection limit', () => {
    assert.equal(getSelectionCount('1つ選べ。', ['a', 'c']), 2);
    assert.equal(getSelectionCount('1つ選べ。', 'a, c, e'), 3);
});

test('infers multiple selection from the question when answers are not registered', () => {
    assert.equal(getSelectionCount('正しいものを2つ選べ。', []), 2);
    assert.equal(getSelectionCount('正しいものを２ つ選びなさい。', ''), 2);
    assert.equal(getSelectionCount('<p>誤っているものを二つ選択してください。</p>'), 2);
});

test('defaults to single selection without an answer or multiple-choice instruction', () => {
    assert.equal(getSelectionCount('正しいものはどれか。'), 1);
});
