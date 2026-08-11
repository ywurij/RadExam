const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const LOOPBACK_HOST = '127.0.0.1';
const CALLBACK_PATH = '/google-oauth-callback';
const TOKEN_FILE_NAME = 'google-drive-oauth.json';
const AUTHORIZATION_TIMEOUT_MS = 5 * 60 * 1000;
const TOKEN_EXPIRY_MARGIN_MS = 60 * 1000;

const base64Url = value => Buffer.from(value)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/g, '');

const createPkcePair = () => {
  const verifier = base64Url(crypto.randomBytes(64));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
};

const createState = () => base64Url(crypto.randomBytes(32));

const buildAuthorizationUrl = ({
  clientId,
  redirectUri,
  state,
  codeChallenge,
}) => {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_DRIVE_APPDATA_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${GOOGLE_AUTHORIZATION_URL}?${query}`;
};

const successPage = `<!doctype html>
<html lang="ja"><meta charset="utf-8"><title>RadExam</title>
<body style="font-family:system-ui;padding:3rem;line-height:1.7">
<h1>RadExamへの接続が完了しました</h1>
<p>この画面を閉じてRadExamへ戻ってください。</p>
</body></html>`;

const errorPage = `<!doctype html>
<html lang="ja"><meta charset="utf-8"><title>RadExam</title>
<body style="font-family:system-ui;padding:3rem;line-height:1.7">
<h1>RadExamへ接続できませんでした</h1>
<p>この画面を閉じてRadExamへ戻り、もう一度お試しください。</p>
</body></html>`;

const sendHtml = (response, status, body) => {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(body);
};

const parseTokenResponse = async response => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.error_description || body.error || `HTTP ${response.status}`;
    throw new Error(`Google認証トークンを取得できませんでした: ${message}`);
  }
  if (!body.access_token) throw new Error('Google認証からアクセストークンが返されませんでした。');
  return body;
};

class GoogleDesktopOAuthManager {
  constructor({
    clientId,
    clientSecret,
    userDataPath,
    safeStorage,
    shell,
    fetchImpl = (...args) => globalThis.fetch(...args),
    createServer = handler => http.createServer(handler),
    now = () => Date.now(),
  }) {
    this.clientId = String(clientId || '');
    this.clientSecret = String(clientSecret || '');
    this.userDataPath = userDataPath;
    this.safeStorage = safeStorage;
    this.shell = shell;
    this.fetch = (...args) => fetchImpl(...args);
    this.createServer = createServer;
    this.now = now;
    this.memoryTokens = null;
    this.authorizationPromise = null;
  }

  assertConfigured() {
    if (!this.clientId.endsWith('.apps.googleusercontent.com')) {
      throw new Error('デスクトップ版のGoogle OAuthクライアントIDが設定されていません。');
    }
    if (!this.clientSecret) {
      throw new Error('デスクトップ版のGoogle OAuthクライアントシークレットが設定されていません。');
    }
  }

  get tokenPath() {
    return path.join(this.userDataPath, TOKEN_FILE_NAME);
  }

  encryptionAvailable() {
    return Boolean(
      this.safeStorage
      && this.safeStorage.isEncryptionAvailable()
    );
  }

  saveTokens(tokens) {
    this.memoryTokens = tokens;
    if (!this.encryptionAvailable()) return false;
    fs.mkdirSync(this.userDataPath, { recursive: true });
    const encrypted = this.safeStorage.encryptString(JSON.stringify(tokens));
    fs.writeFileSync(this.tokenPath, JSON.stringify({
      version: 1,
      encrypted: encrypted.toString('base64'),
    }), { mode: 0o600 });
    return true;
  }

  loadTokens() {
    if (this.memoryTokens) return this.memoryTokens;
    if (!this.encryptionAvailable() || !fs.existsSync(this.tokenPath)) return null;
    try {
      const stored = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'));
      const decrypted = this.safeStorage.decryptString(
        Buffer.from(stored.encrypted, 'base64')
      );
      this.memoryTokens = JSON.parse(decrypted);
      return this.memoryTokens;
    } catch {
      return null;
    }
  }

  clear() {
    this.memoryTokens = null;
    if (fs.existsSync(this.tokenPath)) fs.rmSync(this.tokenPath);
    return { cleared: true };
  }

  getStatus() {
    return {
      configured: this.clientId.endsWith('.apps.googleusercontent.com'),
      hasCredentials: Boolean(this.loadTokens()?.refreshToken),
      encryptionAvailable: this.encryptionAvailable(),
    };
  }

  async exchangeAuthorizationCode({ code, redirectUri, verifier }) {
    const response = await this.fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    const token = await parseTokenResponse(response);
    const previous = this.loadTokens();
    const tokens = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token || previous?.refreshToken || null,
      expiresAt: this.now() + (Number(token.expires_in) || 3600) * 1000,
      scope: token.scope || GOOGLE_DRIVE_APPDATA_SCOPE,
    };
    if (!tokens.refreshToken) {
      throw new Error('Googleから更新トークンが返されませんでした。接続許可を解除して再試行してください。');
    }
    this.saveTokens(tokens);
    return {
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      storedSecurely: this.encryptionAvailable(),
    };
  }

  async refreshAccessToken(tokens) {
    const response = await this.fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const token = await parseTokenResponse(response);
    const refreshed = {
      ...tokens,
      accessToken: token.access_token,
      expiresAt: this.now() + (Number(token.expires_in) || 3600) * 1000,
      scope: token.scope || tokens.scope,
    };
    this.saveTokens(refreshed);
    return refreshed.accessToken;
  }

  async getAccessToken() {
    this.assertConfigured();
    const tokens = this.loadTokens();
    if (!tokens?.refreshToken) {
      const error = new Error('Google Driveへの再認証が必要です。');
      error.requiresReauth = true;
      throw error;
    }
    if (tokens.accessToken && Number(tokens.expiresAt) > this.now() + TOKEN_EXPIRY_MARGIN_MS) {
      return tokens.accessToken;
    }
    return this.refreshAccessToken(tokens);
  }

  async authorize() {
    this.assertConfigured();
    if (this.authorizationPromise) return this.authorizationPromise;
    this.authorizationPromise = this.performAuthorization()
      .finally(() => {
        this.authorizationPromise = null;
      });
    return this.authorizationPromise;
  }

  async performAuthorization() {
    const { verifier, challenge } = createPkcePair();
    const state = createState();
    let callbackResolve;
    let callbackReject;
    const callbackPromise = new Promise((resolve, reject) => {
      callbackResolve = resolve;
      callbackReject = reject;
    });
    const server = this.createServer((request, response) => {
      try {
        const requestUrl = new URL(request.url, `http://${LOOPBACK_HOST}`);
        if (requestUrl.pathname !== CALLBACK_PATH) {
          sendHtml(response, 404, errorPage);
          return;
        }
        if (requestUrl.searchParams.get('state') !== state) {
          sendHtml(response, 400, errorPage);
          callbackReject(new Error('Google認証のstate確認に失敗しました。'));
          return;
        }
        const oauthError = requestUrl.searchParams.get('error');
        if (oauthError) {
          sendHtml(response, 400, errorPage);
          callbackReject(new Error(`Google認証がキャンセルされました: ${oauthError}`));
          return;
        }
        const code = requestUrl.searchParams.get('code');
        if (!code) {
          sendHtml(response, 400, errorPage);
          callbackReject(new Error('Google認証コードが返されませんでした。'));
          return;
        }
        sendHtml(response, 200, successPage);
        callbackResolve(code);
      } catch (error) {
        sendHtml(response, 500, errorPage);
        callbackReject(error);
      }
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, LOOPBACK_HOST, resolve);
    });
    const port = server.address().port;
    const redirectUri = `http://${LOOPBACK_HOST}:${port}${CALLBACK_PATH}`;
    const authorizationUrl = buildAuthorizationUrl({
      clientId: this.clientId,
      redirectUri,
      state,
      codeChallenge: challenge,
    });
    const timeout = setTimeout(() => {
      callbackReject(new Error('Google認証が時間切れになりました。'));
    }, AUTHORIZATION_TIMEOUT_MS);

    try {
      await this.shell.openExternal(authorizationUrl);
      const code = await callbackPromise;
      return await this.exchangeAuthorizationCode({ code, redirectUri, verifier });
    } finally {
      clearTimeout(timeout);
      await new Promise(resolve => server.close(resolve));
    }
  }
}

module.exports = {
  AUTHORIZATION_TIMEOUT_MS,
  GOOGLE_DRIVE_APPDATA_SCOPE,
  GoogleDesktopOAuthManager,
  buildAuthorizationUrl,
  createPkcePair,
};
