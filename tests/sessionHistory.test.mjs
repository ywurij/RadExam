import assert from 'node:assert/strict';
import test from 'node:test';

import { limitResumableSessions, MAX_RESUMABLE_SESSIONS } from '../src/lib/sessionHistory.js';

test('keeps only the four newest resumable sessions', () => {
    const sessions = [1, 5, 3, 2, 4].map(timestamp => ({ id: `session-${timestamp}`, timestamp, interrupted: true }));

    assert.equal(MAX_RESUMABLE_SESSIONS, 4);
    assert.deepEqual(
        limitResumableSessions(sessions).map(session => session.id),
        ['session-5', 'session-4', 'session-3', 'session-2'],
    );
});

test('keeps only sessions created by an explicit interruption', () => {
    assert.deepEqual(limitResumableSessions(null), []);
    assert.deepEqual(
        limitResumableSessions([
            { id: 'interrupted', timestamp: 1, mode: 'practice', interrupted: true },
            { id: 'active', timestamp: 3, mode: 'practice' },
            { id: 'search', timestamp: 2, mode: 'search', interrupted: true },
            null,
        ]).map(session => session.id),
        ['interrupted'],
    );
});
