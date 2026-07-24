import assert from 'node:assert/strict';
import test from 'node:test';
import {
    getQuestionSearchIdentifiers,
    prioritizeExactQuestionIdMatches,
} from '../src/lib/questionSearch.mjs';

test('finds a question by its stored ID', () => {
    const questions = [
        { examId: 'diagnostic', id: '2022048', year: 2022, questionNumber: 48 },
        { examId: 'diagnostic', id: '2022049', year: 2022, questionNumber: 49 },
    ];

    assert.deepEqual(prioritizeExactQuestionIdMatches(questions, '2022048'), [questions[0]]);
});

test('builds searchable IDs from year and question number', () => {
    const identifiers = getQuestionSearchIdentifiers({
        examId: 'diagnostic',
        id: 'legacy-48',
        year: 2022,
        questionNumber: 48,
    });

    assert.equal(identifiers.has('2022048'), true);
    assert.equal(identifiers.has('test_diagnostic_legacy-48'), true);
});
