import assert from 'node:assert/strict';
import test from 'node:test';
import {
    collectExamProgressDeletionKeys,
    isProgressKeyForExam,
    resolveQuestionProgress,
} from '../src/lib/questionProgress.mjs';

test('resolves result status and favorite from the global progress ID', () => {
    const question = { examId: 'diagnostic', id: '2022048' };
    const savedProgress = {
        test_diagnostic_2022048: { status: 'correct', isLiked: true },
    };

    assert.deepEqual(resolveQuestionProgress(savedProgress, question), {
        status: 'correct',
        isLiked: true,
    });
});

test('collects scoped progress and only unambiguous legacy progress when deleting an exam', () => {
    assert.equal(isProgressKeyForExam('test_radiation_2024001', 'radiation'), true);
    assert.equal(isProgressKeyForExam('test_radiology_2024001', 'radiation'), false);
    assert.deepEqual(collectExamProgressDeletionKeys({
        examId: 'radiation',
        progressKeys: [
            'test_radiation_2024001',
            'test_radiation_old-question',
            'test_radiology_2024001',
            '2024001',
            '2024002',
        ],
        deletedQuestionIds: ['2024001', '2024002'],
        remainingQuestionIds: ['2024002'],
    }), [
        'test_radiation_2024001',
        'test_radiation_old-question',
        '2024001',
    ]);
});
