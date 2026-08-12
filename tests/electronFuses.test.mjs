import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveElectronExecutable } = require('../scripts/after-pack.cjs');

const context = platform => ({
    appOutDir: path.join(path.sep, 'tmp', 'radexam-dist'),
    electronPlatformName: platform,
    packager: {
        appInfo: { productFilename: 'RadExam' },
    },
});

test('resolves the packaged macOS executable before flipping Electron fuses', () => {
    assert.equal(
        resolveElectronExecutable(context('darwin')),
        path.join(path.sep, 'tmp', 'radexam-dist', 'RadExam.app', 'Contents', 'MacOS', 'RadExam')
    );
});

test('resolves the packaged Windows executable before flipping Electron fuses', () => {
    assert.equal(
        resolveElectronExecutable(context('win32')),
        path.join(path.sep, 'tmp', 'radexam-dist', 'RadExam.exe')
    );
});
