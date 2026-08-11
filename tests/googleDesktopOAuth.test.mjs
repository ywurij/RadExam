import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
    GOOGLE_DRIVE_APPDATA_SCOPE,
    GoogleDesktopOAuthManager,
    buildAuthorizationUrl,
    createPkcePair,
} = require('../electron/googleDesktopOAuth');

test('builds a desktop Google authorization request with PKCE and loopback redirect', () => {
    const { verifier, challenge } = createPkcePair();
    const authorizationUrl = new URL(buildAuthorizationUrl({
        clientId: 'desktop-client.apps.googleusercontent.com',
        redirectUri: 'http://127.0.0.1:45678/google-oauth-callback',
        state: 'state-123',
        codeChallenge: challenge,
    }));

    assert.ok(verifier.length >= 43 && verifier.length <= 128);
    assert.match(verifier, /^[A-Za-z0-9_-]+$/);
    assert.match(challenge, /^[A-Za-z0-9_-]+$/);
    assert.equal(authorizationUrl.origin, 'https://accounts.google.com');
    assert.equal(authorizationUrl.searchParams.get('response_type'), 'code');
    assert.equal(authorizationUrl.searchParams.get('scope'), GOOGLE_DRIVE_APPDATA_SCOPE);
    assert.equal(authorizationUrl.searchParams.get('state'), 'state-123');
    assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorizationUrl.searchParams.get('access_type'), 'offline');
});

test('refreshes and securely stores desktop Google credentials', async () => {
    const encryptedValues = [];
    const safeStorage = {
        isEncryptionAvailable: () => true,
        encryptString: value => {
            encryptedValues.push(value);
            return Buffer.from(value);
        },
        decryptString: value => value.toString(),
    };
    const fileSystem = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const temporaryDirectory = fileSystem.mkdtempSync(path.join(os.tmpdir(), 'radexam-oauth-test-'));
    const requests = [];
    try {
        const manager = new GoogleDesktopOAuthManager({
            clientId: 'desktop-client.apps.googleusercontent.com',
            clientSecret: 'desktop-client-secret',
            userDataPath: temporaryDirectory,
            safeStorage,
            shell: { openExternal: async () => {} },
            fetchImpl: async (url, options) => {
                requests.push({ url, options });
                return new Response(JSON.stringify({
                    access_token: 'refreshed-access-token',
                    expires_in: 3600,
                    scope: GOOGLE_DRIVE_APPDATA_SCOPE,
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            },
            now: () => 2_000_000,
        });
        manager.saveTokens({
            accessToken: 'expired-access-token',
            refreshToken: 'refresh-token',
            expiresAt: 1_000_000,
            scope: GOOGLE_DRIVE_APPDATA_SCOPE,
        });

        const accessToken = await manager.getAccessToken();

        assert.equal(accessToken, 'refreshed-access-token');
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, 'https://oauth2.googleapis.com/token');
        assert.equal(requests[0].options.body.get('grant_type'), 'refresh_token');
        assert.equal(requests[0].options.body.get('client_secret'), 'desktop-client-secret');
        assert.equal(manager.getStatus().hasCredentials, true);
        assert.ok(encryptedValues.length >= 2);
    } finally {
        fileSystem.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});
