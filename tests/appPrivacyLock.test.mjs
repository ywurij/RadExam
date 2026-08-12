import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createAppPrivacyLock,
    readAppPrivacyLockConfig,
    removeAppPrivacyLock,
    verifyAppPrivacyLock,
} from '../src/lib/appPrivacyLock.mjs';

const storage = new Map();
globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
};
globalThis.dispatchEvent = () => true;
globalThis.CustomEvent = class CustomEvent {
    constructor(type) { this.type = type; }
};

test('stores only a slow password verifier and verifies the app lock code', async () => {
    storage.clear();
    const code = 'private lock code';
    await createAppPrivacyLock(code);
    const serialized = JSON.stringify(readAppPrivacyLockConfig());

    assert.equal(serialized.includes(code), false);
    assert.equal(await verifyAppPrivacyLock(code), true);
    assert.equal(await verifyAppPrivacyLock('different lock code'), false);
});

test('requires the current code before disabling app lock', async () => {
    storage.clear();
    await createAppPrivacyLock('private lock code');
    await assert.rejects(removeAppPrivacyLock('different lock code'), /正しくありません/);
    await removeAppPrivacyLock('private lock code');
    assert.equal(readAppPrivacyLockConfig(), null);
});
