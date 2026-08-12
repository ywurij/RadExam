import assert from 'node:assert/strict';
import test from 'node:test';
import {
    decryptBackupBlob,
    encryptBackupBlob,
    isEncryptedBackupBlob,
} from '../src/lib/backupEncryption.mjs';

test('encrypts a multi-chunk backup without exposing plaintext', async () => {
    const privateText = '秘密の試験データ';
    const source = new Blob([
        privateText,
        new Uint8Array(5 * 1024 * 1024),
        privateText,
    ], { type: 'application/x-radexam-backup' });
    const encrypted = await encryptBackupBlob(source, 'correct horse battery staple');

    assert.equal(await isEncryptedBackupBlob(encrypted), true);
    assert.equal((await encrypted.text()).includes(privateText), false);
    const restored = await decryptBackupBlob(encrypted, 'correct horse battery staple');
    assert.deepEqual(
        new Uint8Array(await restored.arrayBuffer()),
        new Uint8Array(await source.arrayBuffer())
    );
});

test('rejects a wrong backup password and modified ciphertext', async () => {
    const encrypted = await encryptBackupBlob(
        new Blob(['private backup']),
        'correct horse battery staple'
    );
    await assert.rejects(
        decryptBackupBlob(encrypted, 'different horse battery staple'),
        /パスワード/
    );

    const modified = new Uint8Array(await encrypted.arrayBuffer());
    modified[modified.length - 1] ^= 1;
    await assert.rejects(
        decryptBackupBlob(new Blob([modified]), 'correct horse battery staple'),
        /破損/
    );
});
