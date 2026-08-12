import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
    LOOPBACK_HOST,
    createNextServerEnv,
    createNextServerLaunch,
    isAllowedLoopbackRequest,
    isNextServerReadyOutput,
} = require('../electron/serverCommand.js');

test('trusts only the spawned Next.js ready message as startup completion', () => {
    assert.equal(isNextServerReadyOutput('✓ Ready in 843ms'), true);
    assert.equal(isNextServerReadyOutput('\u001b[32m✓\u001b[0m Ready in 1.2s'), true);
    assert.equal(isNextServerReadyOutput('HTTP/1.1 200 OK'), false);
    assert.equal(isNextServerReadyOutput('Ready'), false);
});

test('rejects loopback requests with a forged Host header', () => {
    assert.equal(isAllowedLoopbackRequest({ hostHeader: '127.0.0.1:4567', port: 4567 }), true);
    assert.equal(isAllowedLoopbackRequest({ hostHeader: 'evil.example:4567', port: 4567 }), false);
    assert.equal(isAllowedLoopbackRequest({ hostHeader: 'localhost:4567', port: 4567 }), false);
});

test('launches the packaged Next.js server with the Electron runtime', () => {
    const projectPath = path.join(path.sep, 'Applications', 'Rad Exam.app', 'Contents', 'Resources', 'app');
    const execPath = path.join(path.sep, 'Applications', 'Rad Exam.app', 'Contents', 'MacOS', 'RadExam');

    const launch = createNextServerLaunch({
        execPath,
        projectPath,
        port: 3012,
        isDev: false,
    });

    assert.equal(launch.command, execPath);
    assert.deepEqual(launch.args, [
        path.join(projectPath, 'server.js'),
    ]);
    assert.equal(launch.args.includes('node'), false);
    assert.equal(launch.args.includes('cmd.exe'), false);
    assert.equal(launch.args.includes('zsh'), false);
});

test('passes development flags as separate arguments', () => {
    const launch = createNextServerLaunch({
        execPath: '/path/to/electron',
        projectPath: '/path with spaces/project',
        port: 3000,
        isDev: true,
    });

    assert.deepEqual(launch.args.slice(1), [
        'dev',
        '--webpack',
        '-p',
        '3000',
        '--hostname',
        LOOPBACK_HOST,
    ]);
});

test('forces a desktop loopback server environment', () => {
    const env = createNextServerEnv({
        baseEnv: { PATH: '/usr/bin', APP_TARGET: 'mobile' },
        extraEnv: { NODE_ENV: 'test' },
        port: 4567,
        isDev: false,
    });

    assert.equal(env.PATH, '/usr/bin');
    assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(env.APP_TARGET, 'desktop');
    assert.equal(env.NODE_ENV, 'production');
    assert.equal(env.HOSTNAME, LOOPBACK_HOST);
    assert.equal(env.PORT, '4567');
    assert.equal(env.RADEXAM_NEXT_DIST_DIR, undefined);
});

test('isolates the Electron development build from other Next.js servers', () => {
    const env = createNextServerEnv({
        baseEnv: {},
        port: 3001,
        isDev: true,
    });

    assert.equal(env.RADEXAM_NEXT_DIST_DIR, '.next-electron-dev');
});
