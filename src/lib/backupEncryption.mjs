const FORMAT = 'radexam-encrypted-backup';
const VERSION = 1;
const ALGORITHM = 'AES-GCM-256';
const KDF = 'PBKDF2-SHA256';
const ITERATIONS = 600_000;
const CHUNK_SIZE = 4 * 1024 * 1024;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_PLAINTEXT_BYTES = 2 * 1024 * 1024 * 1024;
const MAGIC = new Uint8Array([0x52, 0x41, 0x44, 0x45, 0x58, 0x41, 0x4d, 0x42, 0x4b, 0x45, 0x4e, 0x43, 0x01]);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const cryptoApi = () => {
    const value = globalThis.crypto;
    if (!value?.subtle || typeof value.getRandomValues !== 'function') {
        throw new Error('この端末では暗号化バックアップを利用できません。');
    }
    return value;
};

const normalizePassphrase = value => {
    const normalized = typeof value === 'string' ? value.normalize('NFKC') : '';
    if (normalized.length < 12 || normalized.length > 1024) {
        throw new Error('バックアップパスワードは12文字以上1024文字以内で入力してください。');
    }
    return normalized;
};

const randomBytes = length => cryptoApi().getRandomValues(new Uint8Array(length));
const uint32Bytes = value => {
    const result = new Uint8Array(4);
    new DataView(result.buffer).setUint32(0, value, false);
    return result;
};
const readUint32 = bytes => new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
const bytesToBase64 = bytes => {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return globalThis.btoa(binary);
};
const base64ToBytes = value => {
    try {
        const binary = globalThis.atob(String(value || ''));
        return Uint8Array.from(binary, character => character.charCodeAt(0));
    } catch {
        throw new Error('暗号化バックアップの形式が不正です。');
    }
};
const concatBytes = (...values) => {
    const result = new Uint8Array(values.reduce((total, value) => total + value.length, 0));
    let offset = 0;
    for (const value of values) {
        result.set(value, offset);
        offset += value.length;
    }
    return result;
};

const deriveKey = async (passphrase, salt, iterations) => {
    const material = await cryptoApi().subtle.importKey(
        'raw',
        encoder.encode(normalizePassphrase(passphrase)),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    return cryptoApi().subtle.deriveKey({
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt,
        iterations,
    }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
};

const readBytes = async (blob, offset, length) => {
    if (offset < 0 || length < 0 || offset + length > blob.size) {
        throw new Error('暗号化バックアップが途中で切れています。');
    }
    return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
};

const validateHeader = header => {
    const salt = base64ToBytes(header?.salt);
    if (
        header?.format !== FORMAT
        || header.version !== VERSION
        || header.algorithm !== ALGORITHM
        || header.kdf !== KDF
        || !Number.isSafeInteger(header.iterations)
        || header.iterations < 100_000
        || header.iterations > 2_000_000
        || salt.length !== 16
        || !Number.isSafeInteger(header.chunkSize)
        || header.chunkSize < 1024 * 1024
        || header.chunkSize > 16 * 1024 * 1024
        || !Number.isSafeInteger(header.plaintextSize)
        || header.plaintextSize < 1
        || header.plaintextSize > MAX_PLAINTEXT_BYTES
        || !Number.isSafeInteger(header.chunkCount)
        || header.chunkCount !== Math.ceil(header.plaintextSize / header.chunkSize)
    ) {
        throw new Error('暗号化バックアップの設定が不正です。');
    }
    return { header, salt };
};

const aadForChunk = (headerBytes, index) => concatBytes(
    encoder.encode('radexam:backup:v1:'),
    uint32Bytes(headerBytes.length),
    headerBytes,
    uint32Bytes(index)
);

export const isEncryptedBackupBlob = async file => {
    if (!(file instanceof Blob) || file.size < MAGIC.length) return false;
    const prefix = await readBytes(file, 0, MAGIC.length);
    return MAGIC.every((value, index) => prefix[index] === value);
};

export const encryptBackupBlob = async (plaintext, passphrase) => {
    if (!(plaintext instanceof Blob) || plaintext.size > MAX_PLAINTEXT_BYTES) {
        throw new Error('バックアップファイルのサイズが上限を超えています。');
    }
    const salt = randomBytes(16);
    const header = {
        format: FORMAT,
        version: VERSION,
        algorithm: ALGORITHM,
        kdf: KDF,
        iterations: ITERATIONS,
        salt: bytesToBase64(salt),
        chunkSize: CHUNK_SIZE,
        plaintextSize: plaintext.size,
        chunkCount: Math.ceil(plaintext.size / CHUNK_SIZE),
        createdAt: new Date().toISOString(),
    };
    const headerBytes = encoder.encode(JSON.stringify(header));
    const key = await deriveKey(passphrase, salt, header.iterations);
    const parts = [MAGIC, uint32Bytes(headerBytes.length), headerBytes];

    for (let index = 0; index < header.chunkCount; index += 1) {
        const offset = index * header.chunkSize;
        const plaintextChunk = await readBytes(
            plaintext,
            offset,
            Math.min(header.chunkSize, plaintext.size - offset)
        );
        const iv = randomBytes(12);
        const ciphertext = new Uint8Array(await cryptoApi().subtle.encrypt({
            name: 'AES-GCM',
            iv,
            additionalData: aadForChunk(headerBytes, index),
            tagLength: 128,
        }, key, plaintextChunk));
        parts.push(uint32Bytes(ciphertext.length), iv, ciphertext);
    }

    return new Blob(parts, { type: 'application/x-radexam-encrypted-backup' });
};

export const decryptBackupBlob = async (encrypted, passphrase) => {
    if (!(encrypted instanceof Blob) || !(await isEncryptedBackupBlob(encrypted))) {
        throw new Error('暗号化されたRadExamバックアップではありません。');
    }
    let offset = MAGIC.length;
    const headerLength = readUint32(await readBytes(encrypted, offset, 4));
    offset += 4;
    if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) {
        throw new Error('暗号化バックアップのヘッダーが不正です。');
    }
    const headerBytes = await readBytes(encrypted, offset, headerLength);
    offset += headerLength;
    let parsedHeader;
    try {
        parsedHeader = JSON.parse(decoder.decode(headerBytes));
    } catch {
        throw new Error('暗号化バックアップのヘッダーを読み取れません。');
    }
    const { header, salt } = validateHeader(parsedHeader);
    const expectedEncryptedSize = MAGIC.length
        + 4
        + headerLength
        + header.plaintextSize
        + header.chunkCount * (4 + 12 + 16);
    if (encrypted.size !== expectedEncryptedSize) {
        throw new Error('暗号化バックアップのサイズが不正です。');
    }
    const key = await deriveKey(passphrase, salt, header.iterations);
    const plaintextParts = [];

    try {
        for (let index = 0; index < header.chunkCount; index += 1) {
            const ciphertextLength = readUint32(await readBytes(encrypted, offset, 4));
            offset += 4;
            const expectedPlaintextLength = Math.min(
                header.chunkSize,
                header.plaintextSize - index * header.chunkSize
            );
            if (ciphertextLength !== expectedPlaintextLength + 16) {
                throw new Error('暗号化バックアップのブロックサイズが不正です。');
            }
            const iv = await readBytes(encrypted, offset, 12);
            offset += 12;
            const ciphertext = await readBytes(encrypted, offset, ciphertextLength);
            offset += ciphertextLength;
            const plaintext = await cryptoApi().subtle.decrypt({
                name: 'AES-GCM',
                iv,
                additionalData: aadForChunk(headerBytes, index),
                tagLength: 128,
            }, key, ciphertext);
            plaintextParts.push(plaintext);
        }
    } catch (error) {
        if (/サイズ|途中/.test(error?.message || '')) throw error;
        throw new Error('バックアップパスワードが異なるか、ファイルが破損しています。');
    }
    if (offset !== encrypted.size) {
        throw new Error('暗号化バックアップの終端後に余分なデータがあります。');
    }
    return new Blob(plaintextParts, { type: 'application/x-radexam-backup' });
};
