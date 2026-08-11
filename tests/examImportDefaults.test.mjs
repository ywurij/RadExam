import assert from 'node:assert/strict';
import test from 'node:test';

import { getExamImportDefaults } from '../src/lib/examImportDefaults.mjs';

test('provides the requested exam ID and name for every PDF import category', () => {
    assert.deepEqual(getExamImportDefaults('1'), {
        id: 'radiology',
        name: '放射線科専門医',
    });
    assert.deepEqual(getExamImportDefaults('2'), {
        id: 'diagnostic',
        name: '放射線科診断専門医',
    });
    assert.deepEqual(getExamImportDefaults('3'), {
        id: 'nuclear',
        name: '核医学専門医',
    });
    assert.deepEqual(getExamImportDefaults('4'), {
        id: 'IVR',
        name: 'IVR専門医',
    });
});
