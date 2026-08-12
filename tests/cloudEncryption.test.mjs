import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
if (!globalThis.btoa) globalThis.btoa = value => Buffer.from(value, 'binary').toString('base64');
if (!globalThis.atob) globalThis.atob = value => Buffer.from(value, 'base64').toString('binary');

const {
    createCloudEncryption,
    decryptCloudBlob,
    decryptCloudJson,
    encryptCloudBlob,
    encryptCloudJson,
    unlockCloudEncryption,
} = await import('../src/lib/sync/cloudEncryption.mjs');

test('同じ同期パスフレーズでJSONとファイルを端末間復号できる', async () => {
    const { metadata, key } = await createCloudEncryption('correct horse battery staple');
    const otherDeviceKey = await unlockCloudEncryption('correct horse battery staple', metadata);
    const envelope = await encryptCloudJson(key, { question: '秘密の問題文' }, 'spaces/id/manifest.json');
    assert.equal(JSON.stringify(envelope).includes('秘密の問題文'), false);
    assert.deepEqual(await decryptCloudJson(otherDeviceKey, envelope, 'spaces/id/manifest.json'), {
        question: '秘密の問題文',
    });
    const encryptedBlob = await encryptCloudBlob(key, new Blob(['secret-pdf']), 'spaces/id/objects/hash');
    assert.equal(await encryptedBlob.text().then(value => value.includes('secret-pdf')), false);
    assert.equal(await (await decryptCloudBlob(otherDeviceKey, encryptedBlob, 'spaces/id/objects/hash')).text(), 'secret-pdf');
});

test('異なる同期パスフレーズでは鍵を解除できない', async () => {
    const { metadata } = await createCloudEncryption('correct horse battery staple');
    await assert.rejects(unlockCloudEncryption('this is a wrong passphrase', metadata), /パスフレーズ|破損/);
});

test('暗号文を別の保存先へ移動すると認証に失敗する', async () => {
    const { key } = await createCloudEncryption('correct horse battery staple');
    const envelope = await encryptCloudJson(key, { value: 1 }, 'manifest.json');
    await assert.rejects(decryptCloudJson(key, envelope, 'changes/other.json'), /パスフレーズ|破損/);
});
