import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    loadZoomFactor,
    normalizeZoomFactor,
    saveZoomFactor,
} = require('../electron/displayZoom.js');

test('normalizes the Electron display zoom to a safe range', () => {
    assert.equal(normalizeZoomFactor('1.25'), 1.25);
    assert.equal(normalizeZoomFactor(0.2), 0.75);
    assert.equal(normalizeZoomFactor(3), 1.5);
    assert.equal(normalizeZoomFactor('invalid'), 1);
});

test('persists and restores the Electron display zoom', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'radexam-display-'));
    assert.equal(loadZoomFactor(directory), 1);
    assert.equal(saveZoomFactor(directory, 1.1), 1.1);
    assert.equal(loadZoomFactor(directory), 1.1);
    assert.deepEqual(
        JSON.parse(readFileSync(path.join(directory, 'display-settings.json'), 'utf8')),
        { zoomFactor: 1.1 }
    );
});
