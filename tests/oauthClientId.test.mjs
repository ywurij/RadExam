import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
    normalizeGoogleClientId,
    normalizeMicrosoftClientId,
} = require('../electron/oauthClientId.js');

test('Electron IPCで正しいOAuthクライアントIDだけを許可する', () => {
    assert.equal(
        normalizeGoogleClientId(' 123-example.apps.googleusercontent.com '),
        '123-example.apps.googleusercontent.com'
    );
    assert.equal(
        normalizeMicrosoftClientId('11111111-2222-3333-4444-555555555555'),
        '11111111-2222-3333-4444-555555555555'
    );
    assert.throws(() => normalizeGoogleClientId('https://evil.example/callback'), /形式が不正/);
    assert.throws(() => normalizeMicrosoftClientId('1111\nmalicious'), /形式が不正/);
    assert.throws(() => normalizeGoogleClientId('x'.repeat(513)), /形式が不正/);
});
