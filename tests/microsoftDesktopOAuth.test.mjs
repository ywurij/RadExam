import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
    MICROSOFT_ONEDRIVE_SCOPES,
    MicrosoftDesktopOAuthManager,
    buildAuthorizationUrl,
    createPkcePair,
} = require('../electron/microsoftDesktopOAuth');

test('builds a desktop Microsoft authorization request with PKCE', () => {
    const { verifier, challenge } = createPkcePair();
    const authorizationUrl = new URL(buildAuthorizationUrl({
        clientId: '11111111-2222-3333-4444-555555555555',
        redirectUri: 'http://localhost:45678',
        state: 'state-123',
        codeChallenge: challenge,
    }));

    assert.ok(verifier.length >= 43 && verifier.length <= 128);
    assert.match(challenge, /^[A-Za-z0-9_-]+$/);
    assert.equal(authorizationUrl.searchParams.get('response_type'), 'code');
    assert.equal(authorizationUrl.searchParams.get('state'), 'state-123');
    assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(MICROSOFT_ONEDRIVE_SCOPES.includes('Files.ReadWrite.AppFolder'));
    assert.ok(MICROSOFT_ONEDRIVE_SCOPES.includes('User.Read'));
});

test('refreshes and securely stores desktop Microsoft credentials without a secret', async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'radexam-ms-oauth-test-'));
    const requests = [];
    const safeStorage = {
        isEncryptionAvailable: () => true,
        encryptString: value => Buffer.from(value),
        decryptString: value => value.toString(),
    };
    try {
        const manager = new MicrosoftDesktopOAuthManager({
            clientId: '11111111-2222-3333-4444-555555555555',
            userDataPath: temporaryDirectory,
            safeStorage,
            shell: { openExternal: async () => {} },
            now: () => 2_000_000,
            fetchImpl: async (url, options) => {
                requests.push({ url: String(url), options });
                return new Response(JSON.stringify({
                    access_token: 'new-access-token',
                    refresh_token: 'new-refresh-token',
                    expires_in: 3600,
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            },
        });
        manager.saveTokens({
            accessToken: 'expired-token',
            refreshToken: 'old-refresh-token',
            expiresAt: 1_000_000,
        });

        const accessToken = await manager.getAccessToken();

        assert.equal(accessToken, 'new-access-token');
        assert.equal(requests[0].options.body.get('grant_type'), 'refresh_token');
        assert.equal(requests[0].options.body.get('client_secret'), null);
        assert.equal(manager.getStatus().hasCredentials, true);
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});
