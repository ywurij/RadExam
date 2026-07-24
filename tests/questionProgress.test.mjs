import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveQuestionProgress } from '../src/lib/questionProgress.mjs';

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
