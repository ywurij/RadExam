export const CLOUD_ENCRYPTION_VERSION = 1;
export const CLOUD_ENCRYPTION_ITERATIONS = 600_000;
export const CLOUD_ENCRYPTION_ALGORITHM = 'AES-GCM-256';
export const CLOUD_ENCRYPTION_KDF = 'PBKDF2-SHA256';
export const CLOUD_ENCRYPTION_ENVELOPE = 'radexam-cloud-encrypted';

const BINARY_MAGIC = new Uint8Array([0x52, 0x41, 0x44, 0x45, 0x4e, 0x43, 0x01]);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const cryptoApi = () => {
    const value = globalThis.crypto;
    if (!value?.subtle || typeof value.getRandomValues !== 'function') {
        throw new Error('この端末では安全なクラウド暗号化を利用できません。');
    }
    return value;
};

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
        throw new Error('クラウド暗号化データの形式が不正です。');
    }
};

const randomBytes = length => cryptoApi().getRandomValues(new Uint8Array(length));
const normalizePassphrase = value => {
    const normalized = typeof value === 'string' ? value.normalize('NFKC') : '';
    if (normalized.length < 12 || normalized.length > 1024) {
        throw new Error('同期パスフレーズは12文字以上1024文字以内で入力してください。');
    }
    return normalized;
};

const importPassphrase = passphrase => cryptoApi().subtle.importKey(
    'raw',
    encoder.encode(normalizePassphrase(passphrase)),
    'PBKDF2',
    false,
    ['deriveKey']
);

export const validateCloudEncryptionMetadata = metadata => {
    const salt = metadata?.salt ? base64ToBytes(metadata.salt) : new Uint8Array();
    const verifierIv = metadata?.verifier?.iv
        ? base64ToBytes(metadata.verifier.iv)
        : new Uint8Array();
    const verifierCiphertext = metadata?.verifier?.ciphertext
        ? base64ToBytes(metadata.verifier.ciphertext)
        : new Uint8Array();
    if (
        !metadata
        || metadata.version !== CLOUD_ENCRYPTION_VERSION
        || metadata.algorithm !== CLOUD_ENCRYPTION_ALGORITHM
        || metadata.kdf !== CLOUD_ENCRYPTION_KDF
        || !Number.isSafeInteger(metadata.iterations)
        || metadata.iterations < 100_000
        || metadata.iterations > 2_000_000
        || salt.length !== 16
        || verifierIv.length !== 12
        || verifierCiphertext.length < 16
        || verifierCiphertext.length > 256
    ) {
        throw new Error('クラウドの暗号化設定が不正です。');
    }
    return metadata;
};

export const deriveCloudEncryptionKey = async (passphrase, metadata) => {
    validateCloudEncryptionMetadata(metadata);
    const material = await importPassphrase(passphrase);
    return cryptoApi().subtle.deriveKey({
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: base64ToBytes(metadata.salt),
        iterations: metadata.iterations,
    }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
};

const encryptBytes = async (key, bytes, aad) => {
    const iv = randomBytes(12);
    const ciphertext = await cryptoApi().subtle.encrypt({
        name: 'AES-GCM',
        iv,
        additionalData: encoder.encode(aad),
        tagLength: 128,
    }, key, bytes);
    return { iv, ciphertext: new Uint8Array(ciphertext) };
};

const decryptBytes = async (key, iv, ciphertext, aad) => {
    try {
        return new Uint8Array(await cryptoApi().subtle.decrypt({
            name: 'AES-GCM',
            iv,
            additionalData: encoder.encode(aad),
            tagLength: 128,
        }, key, ciphertext));
    } catch {
        const error = new Error('同期パスフレーズが異なるか、クラウドデータが破損しています。');
        error.code = 'CLOUD_ENCRYPTION_FAILED';
        throw error;
    }
};

export const createCloudEncryption = async passphrase => {
    const metadata = {
        version: CLOUD_ENCRYPTION_VERSION,
        algorithm: CLOUD_ENCRYPTION_ALGORITHM,
        kdf: CLOUD_ENCRYPTION_KDF,
        iterations: CLOUD_ENCRYPTION_ITERATIONS,
        salt: bytesToBase64(randomBytes(16)),
        createdAt: new Date().toISOString(),
    };
    const key = await deriveCloudEncryptionKey(passphrase, {
        ...metadata,
        verifier: {
            iv: bytesToBase64(new Uint8Array(12)),
            ciphertext: bytesToBase64(new Uint8Array(16)),
        },
    });
    const verifier = await encryptBytes(key, encoder.encode('RadExam cloud encryption key v1'), 'radexam:key-verifier:v1');
    metadata.verifier = {
        iv: bytesToBase64(verifier.iv),
        ciphertext: bytesToBase64(verifier.ciphertext),
    };
    return { metadata, key };
};

export const unlockCloudEncryption = async (passphrase, metadata) => {
    const key = await deriveCloudEncryptionKey(passphrase, metadata);
    const plaintext = await decryptBytes(
        key,
        base64ToBytes(metadata.verifier.iv),
        base64ToBytes(metadata.verifier.ciphertext),
        'radexam:key-verifier:v1'
    );
    if (decoder.decode(plaintext) !== 'RadExam cloud encryption key v1') {
        throw new Error('同期パスフレーズを確認できませんでした。');
    }
    return key;
};

export const encryptCloudJson = async (key, value, logicalPath) => {
    const encrypted = await encryptBytes(key, encoder.encode(JSON.stringify(value)), `radexam:json:${logicalPath}`);
    return {
        envelope: CLOUD_ENCRYPTION_ENVELOPE,
        version: CLOUD_ENCRYPTION_VERSION,
        iv: bytesToBase64(encrypted.iv),
        ciphertext: bytesToBase64(encrypted.ciphertext),
    };
};

export const decryptCloudJson = async (key, envelope, logicalPath) => {
    if (envelope?.envelope !== CLOUD_ENCRYPTION_ENVELOPE || envelope.version !== CLOUD_ENCRYPTION_VERSION) {
        throw new Error('暗号化されていないデータが暗号化同期領域に混在しています。');
    }
    const plaintext = await decryptBytes(
        key,
        base64ToBytes(envelope.iv),
        base64ToBytes(envelope.ciphertext),
        `radexam:json:${logicalPath}`
    );
    try {
        return JSON.parse(decoder.decode(plaintext));
    } catch {
        throw new Error('復号したクラウドデータの形式が不正です。');
    }
};

export const encryptCloudBlob = async (key, blob, logicalPath) => {
    const encrypted = await encryptBytes(key, new Uint8Array(await blob.arrayBuffer()), `radexam:blob:${logicalPath}`);
    const mimeType = encoder.encode(String(blob.type || '').slice(0, 1024));
    const mimeLength = new Uint8Array([mimeType.length >> 8, mimeType.length & 0xff]);
    return new Blob([BINARY_MAGIC, encrypted.iv, mimeLength, mimeType, encrypted.ciphertext], {
        type: 'application/x-radexam-encrypted',
    });
};

export const decryptCloudBlob = async (key, blob, logicalPath) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (
        bytes.length < BINARY_MAGIC.length + 12 + 2 + 16
        || BINARY_MAGIC.some((value, index) => bytes[index] !== value)
    ) {
        throw new Error('暗号化されていないファイルが暗号化同期領域に混在しています。');
    }
    const ivStart = BINARY_MAGIC.length;
    const mimeLengthStart = ivStart + 12;
    const mimeLength = (bytes[mimeLengthStart] << 8) | bytes[mimeLengthStart + 1];
    const ciphertextStart = mimeLengthStart + 2 + mimeLength;
    if (mimeLength > 1024 || ciphertextStart + 16 > bytes.length) {
        throw new Error('クラウド暗号化ファイルの形式が不正です。');
    }
    const plaintext = await decryptBytes(
        key,
        bytes.slice(ivStart, ivStart + 12),
        bytes.slice(ciphertextStart),
        `radexam:blob:${logicalPath}`
    );
    return new Blob([plaintext], {
        type: decoder.decode(bytes.slice(mimeLengthStart + 2, ciphertextStart)),
    });
};
