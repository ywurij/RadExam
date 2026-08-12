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
const AUTHORIZATION_TIMEOUT_MS = 5 * 60_000;

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
        pollIntervalMs = 200,
        authorizationTimeoutMs = AUTHORIZATION_TIMEOUT_MS,
        requestTimeoutMs = DEFAULT_SYNC_REQUEST_TIMEOUT_MS,
    }) {
        if (!clientId) throw new Error('Microsoft OAuthのクライアントIDが必要です。');
        this.clientId = clientId;
        this.window = windowRef;
        this.fetch = (...args) => fetchImpl(...args);
        this.now = now;
        this.pollIntervalMs = pollIntervalMs;
        this.authorizationTimeoutMs = authorizationTimeoutMs;
        this.requestTimeoutMs = requestTimeoutMs;
        this.tokens = null;
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

    waitForAuthorizationCode(popup, { redirectUri, state }) {
        return new Promise((resolve, reject) => {
            const startedAt = this.now();
            const timer = this.window.setInterval(() => {
                if (popup.closed) {
                    this.window.clearInterval(timer);
                    reject(new Error('Microsoft認証画面が閉じられました。'));
                    return;
                }
                if (this.now() - startedAt > this.authorizationTimeoutMs) {
                    this.window.clearInterval(timer);
                    popup.close();
                    reject(new Error('Microsoft認証が時間切れになりました。'));
                    return;
                }
                let location;
                try {
                    location = popup.location.href;
                } catch {
                    return;
                }
                if (!location?.startsWith(redirectUri)) return;
                this.window.clearInterval(timer);
                const callbackUrl = new URL(location);
                popup.close();
                if (callbackUrl.searchParams.get('state') !== state) {
                    reject(new Error('Microsoft認証のstate確認に失敗しました。'));
                    return;
                }
                const oauthError = callbackUrl.searchParams.get('error');
                if (oauthError) {
                    reject(new Error(
                        callbackUrl.searchParams.get('error_description')
                        || `Microsoft認証がキャンセルされました: ${oauthError}`
                    ));
                    return;
                }
                const code = callbackUrl.searchParams.get('code');
                if (!code) {
                    reject(new Error('Microsoft認証コードが返されませんでした。'));
                    return;
                }
                resolve(code);
            }, this.pollIntervalMs);
        });
    }

    async requestAccessToken({ prompt = 'select_account' } = {}) {
        if (!this.window) {
            throw new Error('Microsoft認証はブラウザ画面から実行してください。');
        }
        const { verifier, challenge } = await createMicrosoftPkcePair();
        const state = randomBase64Url(32);
        const redirectUri = `${this.window.location.origin}${this.window.location.pathname}`;
        const authorizationUrl = buildMicrosoftAuthorizationUrl({
            clientId: this.clientId,
            redirectUri,
            state,
            codeChallenge: challenge,
            prompt,
        });
        const popup = this.window.open(
            authorizationUrl,
            'radexam-microsoft-oauth',
            'popup=yes,width=520,height=720'
        );
        if (!popup) {
            throw new Error('Microsoft認証画面を開けませんでした。ポップアップを許可してください。');
        }
        const code = await this.waitForAuthorizationCode(popup, { redirectUri, state });
        const token = await this.exchangeToken({
            code,
            code_verifier: verifier,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
        });
        return this.saveTokenResponse(token);
    }
}
