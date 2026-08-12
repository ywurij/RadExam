const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  DEFAULT_OAUTH_REQUEST_TIMEOUT_MS,
  fetchWithTimeout,
} = require('./fetchWithTimeout');

const MICROSOFT_AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const MICROSOFT_ONEDRIVE_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Files.ReadWrite.AppFolder',
];
const LOOPBACK_HOST = '127.0.0.1';
const REDIRECT_HOST = 'localhost';
const CALLBACK_PATH = '/';
const TOKEN_FILE_NAME = 'onedrive-oauth.json';
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
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: MICROSOFT_ONEDRIVE_SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${MICROSOFT_AUTHORITY}/authorize?${query}`;
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
    throw new Error(`Microsoft認証トークンを取得できませんでした: ${message}`);
  }
  if (!body.access_token) {
    throw new Error('Microsoft認証からアクセストークンが返されませんでした。');
  }
  return body;
};

class MicrosoftDesktopOAuthManager {
  constructor({
    clientId,
    userDataPath,
    safeStorage,
    shell,
    fetchImpl = (...args) => globalThis.fetch(...args),
    createServer = handler => http.createServer(handler),
    now = () => Date.now(),
    requestTimeoutMs = DEFAULT_OAUTH_REQUEST_TIMEOUT_MS,
  }) {
    this.clientId = String(clientId || '');
    this.userDataPath = userDataPath;
    this.safeStorage = safeStorage;
    this.shell = shell;
    this.fetch = (...args) => fetchImpl(...args);
    this.createServer = createServer;
    this.now = now;
    this.requestTimeoutMs = requestTimeoutMs;
    this.memoryTokens = null;
    this.authorizationPromise = null;
  }

  assertConfigured() {
    if (!/^[0-9a-f-]{36}$/i.test(this.clientId)) {
      throw new Error('デスクトップ版のMicrosoft OAuthクライアントIDが設定されていません。');
    }
  }

  get tokenPath() {
    return path.join(this.userDataPath, TOKEN_FILE_NAME);
  }

  encryptionAvailable() {
    return Boolean(this.safeStorage && this.safeStorage.isEncryptionAvailable());
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
    fs.chmodSync(this.tokenPath, 0o600);
    return true;
  }

  loadTokens() {
    if (this.memoryTokens) return this.memoryTokens;
    if (!this.encryptionAvailable() || !fs.existsSync(this.tokenPath)) return null;
    try {
      if (fs.statSync(this.tokenPath).size > 1024 * 1024) return null;
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
      configured: /^[0-9a-f-]{36}$/i.test(this.clientId),
      hasCredentials: Boolean(this.loadTokens()?.refreshToken),
      encryptionAvailable: this.encryptionAvailable(),
    };
  }

  async requestToken(parameters) {
    const response = await fetchWithTimeout(this.fetch, `${MICROSOFT_AUTHORITY}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        scope: MICROSOFT_ONEDRIVE_SCOPES.join(' '),
        ...parameters,
      }),
    }, this.requestTimeoutMs);
    return parseTokenResponse(response);
  }

  saveTokenResponse(token, previous = this.loadTokens()) {
    const tokens = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token || previous?.refreshToken || null,
      expiresAt: this.now() + (Number(token.expires_in) || 3600) * 1000,
      scope: token.scope || MICROSOFT_ONEDRIVE_SCOPES.join(' '),
    };
    if (!tokens.refreshToken) {
      throw new Error('Microsoftから更新トークンが返されませんでした。再接続してください。');
    }
    this.saveTokens(tokens);
    return tokens;
  }

  async exchangeAuthorizationCode({ code, redirectUri, verifier }) {
    const token = await this.requestToken({
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    const tokens = this.saveTokenResponse(token);
    return {
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      storedSecurely: this.encryptionAvailable(),
    };
  }

  async refreshAccessToken(tokens) {
    const token = await this.requestToken({
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token',
    });
    return this.saveTokenResponse(token, tokens).accessToken;
  }

  async getAccessToken() {
    this.assertConfigured();
    const tokens = this.loadTokens();
    if (!tokens?.refreshToken) {
      const error = new Error('OneDriveへの再認証が必要です。');
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
        const requestUrl = new URL(request.url, `http://${REDIRECT_HOST}`);
        if (requestUrl.pathname !== CALLBACK_PATH) {
          sendHtml(response, 404, errorPage);
          return;
        }
        if (requestUrl.searchParams.get('state') !== state) {
          sendHtml(response, 400, errorPage);
          callbackReject(new Error('Microsoft認証のstate確認に失敗しました。'));
          return;
        }
        const oauthError = requestUrl.searchParams.get('error');
        if (oauthError) {
          sendHtml(response, 400, errorPage);
          callbackReject(new Error(
            requestUrl.searchParams.get('error_description')
            || `Microsoft認証がキャンセルされました: ${oauthError}`
          ));
          return;
        }
        const code = requestUrl.searchParams.get('code');
        if (!code) {
          sendHtml(response, 400, errorPage);
          callbackReject(new Error('Microsoft認証コードが返されませんでした。'));
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
    const redirectUri = `http://${REDIRECT_HOST}:${port}`;
    const authorizationUrl = buildAuthorizationUrl({
      clientId: this.clientId,
      redirectUri,
      state,
      codeChallenge: challenge,
    });
    const timeout = setTimeout(() => {
      callbackReject(new Error('Microsoft認証が時間切れになりました。'));
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
  MICROSOFT_ONEDRIVE_SCOPES,
  MicrosoftDesktopOAuthManager,
  buildAuthorizationUrl,
  createPkcePair,
};
