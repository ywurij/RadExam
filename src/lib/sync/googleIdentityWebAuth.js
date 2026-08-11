import { GOOGLE_DRIVE_APPDATA_SCOPE } from './googleDriveSyncProvider.mjs';

export const GOOGLE_IDENTITY_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

let googleIdentityLoadPromise = null;

export const loadGoogleIdentityServices = ({
    documentRef = globalThis.document,
    googleRef = () => globalThis.google,
} = {}) => {
    if (googleRef()?.accounts?.oauth2) return Promise.resolve(googleRef());
    if (!documentRef) {
        return Promise.reject(new Error('Google認証はブラウザ画面から実行してください。'));
    }
    if (googleIdentityLoadPromise) return googleIdentityLoadPromise;

    googleIdentityLoadPromise = new Promise((resolve, reject) => {
        const existing = documentRef.querySelector(`script[src="${GOOGLE_IDENTITY_SCRIPT_URL}"]`);
        const script = existing || documentRef.createElement('script');
        const handleLoad = () => {
            const google = googleRef();
            if (google?.accounts?.oauth2) resolve(google);
            else reject(new Error('Google認証ライブラリを初期化できませんでした。'));
        };
        const handleError = () => reject(new Error('Google認証ライブラリを読み込めませんでした。'));
        script.addEventListener('load', handleLoad, { once: true });
        script.addEventListener('error', handleError, { once: true });
        if (!existing) {
            script.src = GOOGLE_IDENTITY_SCRIPT_URL;
            script.async = true;
            script.defer = true;
            documentRef.head.appendChild(script);
        }
    }).catch(error => {
        googleIdentityLoadPromise = null;
        throw error;
    });
    return googleIdentityLoadPromise;
};

export class GoogleDriveWebTokenManager {
    constructor({
        clientId,
        loadIdentityServices = loadGoogleIdentityServices,
        now = () => Date.now(),
    }) {
        if (!clientId) throw new Error('Google OAuthのクライアントIDが必要です。');
        this.clientId = clientId;
        this.loadIdentityServices = loadIdentityServices;
        this.now = now;
        this.accessToken = '';
        this.expiresAt = 0;
        this.tokenClient = null;
    }

    hasValidToken() {
        return Boolean(this.accessToken) && this.expiresAt > this.now() + 60_000;
    }

    async getAccessToken() {
        return this.hasValidToken() ? this.accessToken : null;
    }

    clear() {
        this.accessToken = '';
        this.expiresAt = 0;
    }

    async requestAccessToken({ prompt = 'consent' } = {}) {
        const google = await this.loadIdentityServices();
        return new Promise((resolve, reject) => {
            const callback = response => {
                if (response?.error || !response?.access_token) {
                    reject(new Error(response?.error_description || response?.error || 'Google認証に失敗しました。'));
                    return;
                }
                this.accessToken = response.access_token;
                this.expiresAt = this.now() + (Number(response.expires_in) || 3600) * 1000;
                resolve(this.accessToken);
            };
            this.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: this.clientId,
                scope: GOOGLE_DRIVE_APPDATA_SCOPE,
                callback,
                error_callback: error => reject(
                    new Error(error?.message || error?.type || 'Google認証画面を開けませんでした。')
                ),
            });
            this.tokenClient.requestAccessToken({ prompt });
        });
    }
}
