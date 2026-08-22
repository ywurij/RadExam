import assert from 'node:assert/strict';
import test from 'node:test';

import { EXAM_IMPORT_CATEGORY_OPTIONS, getExamImportDefaults } from '../src/lib/examImportDefaults.mjs';

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
    assert.deepEqual(getExamImportDefaults('5'), {
        id: 'radiation',
        name: '放射線治療専門医',
    });
});

test('orders the admin PDF import categories with radiation oncology third', () => {
    assert.deepEqual(EXAM_IMPORT_CATEGORY_OPTIONS, [
        { id: '1', label: '1. 放射線科専門医試験' },
        { id: '2', label: '2. 放射線診断専門医試験' },
        { id: '5', label: '3. 放射線治療専門医試験' },
        { id: '3', label: '4. 核医学専門医試験' },
        { id: '4', label: '5. IVR専門医試験' },
    ]);
});
