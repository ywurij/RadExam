import { ONEDRIVE_APP_FOLDER_SCOPE } from './oneDriveSyncProvider.mjs';
import {
    DEFAULT_SYNC_REQUEST_TIMEOUT_MS,
    fetchWithTimeout,
} from './fetchWithTimeout.mjs';

export const MICROSOFT_AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
export const MICROSOFT_ONEDRIVE_SCOPES = Object.freeze([
    'openid',
    'profile',
    'email',
    'offline_access',
    'User.Read',
    ONEDRIVE_APP_FOLDER_SCOPE,
]);

const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const REDIRECT_PENDING_STORAGE_KEY = 'radexam_microsoft_oauth_pending';
const REDIRECT_PENDING_MAX_AGE_MS = 10 * 60_000;
const MICROSOFT_CALLBACK_PATH = '/sync';
const PAGE_REDIRECT_SETTLE_MS = 300;

const base64Url = bytes => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return globalThis.btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
};

const randomBase64Url = byteLength => {
    const bytes = new Uint8Array(byteLength);
    globalThis.crypto.getRandomValues(bytes);
    return base64Url(bytes);
};

export const createMicrosoftPkcePair = async () => {
    if (!globalThis.crypto?.subtle) {
        throw new Error('このブラウザでは安全なMicrosoft認証を利用できません。');
    }
    const verifier = randomBase64Url(64);
    const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(verifier)
    );
    return {
        verifier,
        challenge: base64Url(new Uint8Array(digest)),
    };
};

export const buildMicrosoftAuthorizationUrl = ({
    clientId,
    redirectUri,
    state,
    codeChallenge,
    prompt = 'select_account',
}) => {
    const query = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        response_mode: 'query',
        scope: MICROSOFT_ONEDRIVE_SCOPES.join(' '),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt,
    });
    return `${MICROSOFT_AUTHORITY}/authorize?${query}`;
};

const storageFromWindow = windowRef => {
    try {
        return windowRef?.localStorage || null;
    } catch {
        return null;
    }
};

const readPendingRedirect = windowRef => {
    const storage = storageFromWindow(windowRef);
    if (!storage) return null;
    try {
        const pending = JSON.parse(storage.getItem(REDIRECT_PENDING_STORAGE_KEY) || 'null');
        if (!pending?.state || !pending?.verifier || !pending?.redirectUri) return null;
        return pending;
    } catch {
        return null;
    }
};

export const hasPendingMicrosoftAuthorizationRedirect = (
    windowRef = globalThis.window,
    now = () => Date.now()
) => {
    const pending = readPendingRedirect(windowRef);
    if (!pending || Number(pending.expiresAt) <= now()) return false;
    try {
        const currentUrl = new URL(windowRef.location.href);
        return Boolean(
            currentUrl.searchParams.get('code')
            || currentUrl.searchParams.get('error')
        );
    } catch {
        return false;
    }
};

const parseTokenResponse = async response => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = body.error_description || body.error || `HTTP ${response.status}`;
        throw new Error(`Microsoft認証トークンを取得できませんでした: ${message}`);
    }
    if (!body.access_token) {
        throw new Error('Microsoft認証からアクセストークンが返されませんでした。');
    }
    return body;
};

export class MicrosoftOneDriveWebTokenManager {
    constructor({
        clientId,
        windowRef = globalThis.window,
        fetchImpl = (...args) => globalThis.fetch(...args),
        now = () => Date.now(),
        requestTimeoutMs = DEFAULT_SYNC_REQUEST_TIMEOUT_MS,
    }) {
        if (!clientId) throw new Error('Microsoft OAuthのクライアントIDが必要です。');
        this.clientId = clientId;
        this.window = windowRef;
        this.fetch = (...args) => fetchImpl(...args);
        this.now = now;
        this.requestTimeoutMs = requestTimeoutMs;
        this.tokens = null;
        this.completedPageRedirect = false;
    }

    hasValidToken() {
        return Boolean(this.tokens?.accessToken)
            && Number(this.tokens.expiresAt) > this.now() + TOKEN_EXPIRY_MARGIN_MS;
    }

    clear() {
        this.tokens = null;
    }

    async exchangeToken(parameters) {
        const response = await fetchWithTimeout({
            fetchImpl: this.fetch,
            url: `${MICROSOFT_AUTHORITY}/token`,
            timeoutMs: this.requestTimeoutMs,
            options: {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: this.clientId,
                scope: MICROSOFT_ONEDRIVE_SCOPES.join(' '),
                ...parameters,
            }),
            },
        });
        return parseTokenResponse(response);
    }

    saveTokenResponse(token, previous = this.tokens) {
        this.tokens = {
            accessToken: token.access_token,
            refreshToken: token.refresh_token || previous?.refreshToken || null,
            expiresAt: this.now() + (Number(token.expires_in) || 3600) * 1000,
            scope: token.scope || MICROSOFT_ONEDRIVE_SCOPES.join(' '),
        };
        return this.tokens.accessToken;
    }

    async refreshAccessToken() {
        if (!this.tokens?.refreshToken) return null;
        const token = await this.exchangeToken({
            refresh_token: this.tokens.refreshToken,
            grant_type: 'refresh_token',
        });
        return this.saveTokenResponse(token);
    }

    async getAccessToken() {
        if (this.hasValidToken()) return this.tokens.accessToken;
        if (!this.tokens?.refreshToken) return null;
        try {
            return await this.refreshAccessToken();
        } catch {
            this.clear();
            return null;
        }
    }

    async requestAccessToken({ prompt = 'select_account' } = {}) {
        if (!this.window) {
            throw new Error('Microsoft認証はブラウザ画面から実行してください。');
        }
        const callbackToken = await this.completePendingPageRedirect();
        if (callbackToken) return callbackToken;

        const { verifier, challenge } = await createMicrosoftPkcePair();
        const state = randomBase64Url(32);
        const redirectUri = `${this.window.location.origin}${MICROSOFT_CALLBACK_PATH}`;
        const authorizationUrl = buildMicrosoftAuthorizationUrl({
            clientId: this.clientId,
            redirectUri,
            state,
            codeChallenge: challenge,
            prompt,
        });
        const storage = storageFromWindow(this.window);
        if (!storage) {
            throw new Error('Microsoft認証の一時情報をこのブラウザに保存できません。');
        }
        // Microsoftの認証ページは環境によってCross-Origin-Opener-Policyを適用し、
        // 認証後にpopupと元ページのWindowProxyを切り離すことがある。その場合、
        // callback先のRadExamがpopup内に残って接続処理を再開できないため、Web/PWA版は
        // 端末にかかわらず同一ページのリダイレクトに統一する。
        storage.setItem(REDIRECT_PENDING_STORAGE_KEY, JSON.stringify({
            state,
            verifier,
            redirectUri,
            returnPath: `${this.window.location.pathname}${this.window.location.search || ''}`,
            expiresAt: this.now() + REDIRECT_PENDING_MAX_AGE_MS,
        }));
        this.window.location.assign(authorizationUrl);
        return new Promise(() => {});
    }

    async completePendingPageRedirect() {
        const pending = readPendingRedirect(this.window);
        if (!pending) return null;
        const storage = storageFromWindow(this.window);
        if (Number(pending.expiresAt) <= this.now()) {
            storage?.removeItem(REDIRECT_PENDING_STORAGE_KEY);
            throw new Error('Microsoft認証が時間切れになりました。もう一度接続してください。');
        }
        let callbackUrl;
        try {
            callbackUrl = new URL(this.window.location.href);
        } catch {
            return null;
        }
        if (!callbackUrl.searchParams.get('code') && !callbackUrl.searchParams.get('error')) {
            return null;
        }
        if (callbackUrl.searchParams.get('state') !== pending.state) {
            storage?.removeItem(REDIRECT_PENDING_STORAGE_KEY);
            throw new Error('Microsoft認証のstate確認に失敗しました。');
        }
        const oauthError = callbackUrl.searchParams.get('error');
        if (oauthError) {
            storage?.removeItem(REDIRECT_PENDING_STORAGE_KEY);
            throw new Error(
                callbackUrl.searchParams.get('error_description')
                || `Microsoft認証がキャンセルされました: ${oauthError}`
            );
        }
        const code = callbackUrl.searchParams.get('code');
        if (!code) return null;
        const token = await this.exchangeToken({
            code,
            code_verifier: pending.verifier,
            grant_type: 'authorization_code',
            redirect_uri: pending.redirectUri,
        });
        storage?.removeItem(REDIRECT_PENDING_STORAGE_KEY);
        this.completedRedirectReturnPath = pending.returnPath || '/data';
        this.completedPageRedirect = true;
        this.window.history?.replaceState?.({}, '', MICROSOFT_CALLBACK_PATH);
        return this.saveTokenResponse(token);
    }

    async waitForPageRedirectToSettle() {
        if (!this.completedPageRedirect) return;
        this.completedPageRedirect = false;
        const schedule = this.window?.setTimeout?.bind(this.window) || globalThis.setTimeout;
        await new Promise(resolve => schedule(resolve, PAGE_REDIRECT_SETTLE_MS));
    }
}
