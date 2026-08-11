import assert from 'node:assert/strict';
import test from 'node:test';
import {
    MICROSOFT_ONEDRIVE_SCOPES,
    MicrosoftOneDriveWebTokenManager,
    buildMicrosoftAuthorizationUrl,
    createMicrosoftPkcePair,
} from '../src/lib/sync/microsoftIdentityWebAuth.js';

test('builds a Microsoft SPA authorization request with PKCE and app-folder scope', async () => {
    const { verifier, challenge } = await createMicrosoftPkcePair();
    const authorizationUrl = new URL(buildMicrosoftAuthorizationUrl({
        clientId: '11111111-2222-3333-4444-555555555555',
        redirectUri: 'http://127.0.0.1:3001/sync',
        state: 'state-123',
        codeChallenge: challenge,
    }));

    assert.ok(verifier.length >= 43 && verifier.length <= 128);
    assert.match(verifier, /^[A-Za-z0-9_-]+$/);
    assert.equal(
        authorizationUrl.origin,
        'https://login.microsoftonline.com'
    );
    assert.equal(authorizationUrl.searchParams.get('response_type'), 'code');
    assert.equal(authorizationUrl.searchParams.get('state'), 'state-123');
    assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(MICROSOFT_ONEDRIVE_SCOPES.includes('Files.ReadWrite.AppFolder'));
    assert.ok(MICROSOFT_ONEDRIVE_SCOPES.includes('User.Read'));
    assert.ok(MICROSOFT_ONEDRIVE_SCOPES.includes('offline_access'));
});

test('refreshes a browser Microsoft token without persisting it', async () => {
    const requests = [];
    const manager = new MicrosoftOneDriveWebTokenManager({
        clientId: '11111111-2222-3333-4444-555555555555',
        windowRef: {},
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
    manager.tokens = {
        accessToken: 'expired-token',
        refreshToken: 'old-refresh-token',
        expiresAt: 1_000_000,
    };

    const accessToken = await manager.getAccessToken();

    assert.equal(accessToken, 'new-access-token');
    assert.equal(manager.tokens.refreshToken, 'new-refresh-token');
    assert.equal(requests[0].url, 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token');
    assert.equal(requests[0].options.body.get('grant_type'), 'refresh_token');
    assert.equal(requests[0].options.body.get('client_secret'), null);
});
