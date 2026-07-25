import assert from 'node:assert/strict';
import test from 'node:test';

import { validateReleaseTag } from '../scripts/check-release-tag.mjs';

test('accepts a tag matching the package version', () => {
    assert.equal(validateReleaseTag('v0.1.0', '0.1.0'), 'v0.1.0');
});

test('rejects a tag that does not match the package version', () => {
    assert.throws(
        () => validateReleaseTag('v0.1.1', '0.1.0'),
        /must match package version v0\.1\.0/
    );
});
