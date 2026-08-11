import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
    loadCloudSyncConfig,
    parseEnvText,
} = require('../electron/cloudSyncConfig');

test('parses quoted and unquoted desktop OAuth settings', () => {
    assert.deepEqual(parseEnvText(`
        # comment
        GOOGLE_DESKTOP_CLIENT_SECRET="GOCSPX-secret"
        OTHER_VALUE=value
    `), {
        GOOGLE_DESKTOP_CLIENT_SECRET: 'GOCSPX-secret',
        OTHER_VALUE: 'value',
    });
});

test('prefers a runtime desktop OAuth secret without exposing a public variable', () => {
    const config = loadCloudSyncConfig({
        appPath: '/path/that/does/not/exist',
        isPackaged: false,
        env: {
            GOOGLE_DESKTOP_CLIENT_SECRET: 'runtime-secret',
            NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_SECRET: 'must-not-be-used',
        },
    });

    assert.deepEqual(config, {
        googleDesktopClientSecret: 'runtime-secret',
    });
});
