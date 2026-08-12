export const APP_PRIVACY_LOCK_STORAGE_KEY = 'radexam_app_privacy_lock_v1';
export const APP_PRIVACY_LOCK_CHANGED_EVENT = 'radexam-app-privacy-lock-changed';
export const APP_PRIVACY_LOCK_REQUEST_EVENT = 'radexam-app-privacy-lock-request';
export const APP_PRIVACY_LOCK_ITERATIONS = 600_000;

const encoder = new TextEncoder();

const cryptoApi = () => {
    if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== 'function') {
        throw new Error('この端末ではアプリロックを利用できません。');
    }
    return globalThis.crypto;
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
        throw new Error('アプリロックの設定が破損しています。');
    }
};
const normalizeCode = value => {
    const normalized = typeof value === 'string' ? value.normalize('NFKC') : '';
    if (normalized.length < 8 || normalized.length > 256) {
        throw new Error('アプリロックの解除コードは8文字以上256文字以内で入力してください。');
    }
    return normalized;
};
const constantTimeEqual = (left, right) => {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
    return difference === 0;
};
const deriveVerifier = async (code, salt, iterations) => {
    const material = await cryptoApi().subtle.importKey(
        'raw', encoder.encode(normalizeCode(code)), 'PBKDF2', false, ['deriveBits']
    );
    return new Uint8Array(await cryptoApi().subtle.deriveBits({
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt,
        iterations,
    }, material, 256));
};

export const readAppPrivacyLockConfig = () => {
    try {
        const config = JSON.parse(globalThis.localStorage?.getItem(APP_PRIVACY_LOCK_STORAGE_KEY) || 'null');
        const salt = base64ToBytes(config?.salt);
        const verifier = base64ToBytes(config?.verifier);
        if (
            config?.version !== 1
            || config.iterations !== APP_PRIVACY_LOCK_ITERATIONS
            || salt.length !== 16
            || verifier.length !== 32
        ) return null;
        return config;
    } catch {
        return null;
    }
};

export const createAppPrivacyLock = async code => {
    const salt = cryptoApi().getRandomValues(new Uint8Array(16));
    const config = {
        version: 1,
        iterations: APP_PRIVACY_LOCK_ITERATIONS,
        salt: bytesToBase64(salt),
        verifier: bytesToBase64(await deriveVerifier(code, salt, APP_PRIVACY_LOCK_ITERATIONS)),
        createdAt: new Date().toISOString(),
    };
    globalThis.localStorage?.setItem(APP_PRIVACY_LOCK_STORAGE_KEY, JSON.stringify(config));
    globalThis.dispatchEvent?.(new CustomEvent(APP_PRIVACY_LOCK_CHANGED_EVENT));
    return config;
};

export const verifyAppPrivacyLock = async code => {
    const config = readAppPrivacyLockConfig();
    if (!config) return false;
    const actual = await deriveVerifier(code, base64ToBytes(config.salt), config.iterations);
    return constantTimeEqual(actual, base64ToBytes(config.verifier));
};

export const removeAppPrivacyLock = async code => {
    if (!(await verifyAppPrivacyLock(code))) throw new Error('現在の解除コードが正しくありません。');
    globalThis.localStorage?.removeItem(APP_PRIVACY_LOCK_STORAGE_KEY);
    globalThis.dispatchEvent?.(new CustomEvent(APP_PRIVACY_LOCK_CHANGED_EVENT));
};

export const requestAppPrivacyLock = () => (
    globalThis.dispatchEvent?.(new CustomEvent(APP_PRIVACY_LOCK_REQUEST_EVENT))
);
