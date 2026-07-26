import assert from 'node:assert/strict';
import test from 'node:test';
import {
    GoogleDriveWebTokenManager,
} from '../src/lib/sync/googleIdentityWebAuth.js';
import { GOOGLE_DRIVE_APPDATA_SCOPE } from '../src/lib/sync/googleDriveSyncProvider.mjs';

test('requests only the Google Drive app-data scope and keeps the token in memory', async () => {
    let tokenOptions = null;
    let requestOptions = null;
    let now = 1_000_000;
    const manager = new GoogleDriveWebTokenManager({
        clientId: 'web-client-id',
        now: () => now,
        loadIdentityServices: async () => ({
            accounts: {
                oauth2: {
                    initTokenClient(options) {
                        tokenOptions = options;
                        return {
                            requestAccessToken(optionsForRequest) {
                                requestOptions = optionsForRequest;
                                options.callback({
                                    access_token: 'temporary-access-token',
                                    expires_in: 3600,
                                });
                            },
                        };
                    },
                },
            },
        }),
    });

    assert.equal(await manager.getAccessToken(), null);
    assert.equal(await manager.requestAccessToken(), 'temporary-access-token');
    assert.equal(tokenOptions.client_id, 'web-client-id');
    assert.equal(tokenOptions.scope, GOOGLE_DRIVE_APPDATA_SCOPE);
    assert.deepEqual(requestOptions, { prompt: 'consent' });
    assert.equal(await manager.getAccessToken(), 'temporary-access-token');

    now += 3_550_000;
    assert.equal(await manager.getAccessToken(), null);
});

test('does not persist a rejected Google authorization response', async () => {
    const manager = new GoogleDriveWebTokenManager({
        clientId: 'web-client-id',
        loadIdentityServices: async () => ({
            accounts: {
                oauth2: {
                    initTokenClient(options) {
                        return {
                            requestAccessToken() {
                                options.callback({
                                    error: 'access_denied',
                                    error_description: 'User denied access',
                                });
                            },
                        };
                    },
                },
            },
        }),
    });

    await assert.rejects(
        () => manager.requestAccessToken(),
        /User denied access/
    );
    assert.equal(await manager.getAccessToken(), null);
});
