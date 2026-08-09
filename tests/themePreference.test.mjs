import assert from 'node:assert/strict';
import test from 'node:test';

import {
    normalizeThemePreference,
    resolveTheme,
} from '../src/lib/themePreference.mjs';

test('normalizes and resolves the three supported theme preferences', () => {
    assert.equal(normalizeThemePreference('unknown'), 'system');
    assert.equal(resolveTheme('system', false), 'light');
    assert.equal(resolveTheme('system', true), 'dark');
    assert.equal(resolveTheme('light', true), 'light');
    assert.equal(resolveTheme('dark', false), 'dark');
});
