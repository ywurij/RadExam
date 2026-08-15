import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { configurePdfJsWorker, pdfJsWorkerUrl } from '../src/lib/pdfJsWorker.mjs';
import { syncPdfJsWorker } from '../scripts/sync-pdfjs-assets.mjs';

test('uses the PDF.js API version in the Worker URL to avoid a stale cached Worker', () => {
    assert.equal(pdfJsWorkerUrl('6.2.108'), '/pdf.worker.min.mjs?v=6.2.108');
    const pdfjs = { version: '6.2.108', GlobalWorkerOptions: {} };
    assert.equal(configurePdfJsWorker(pdfjs), '/pdf.worker.min.mjs?v=6.2.108');
    assert.equal(pdfjs.GlobalWorkerOptions.workerSrc, '/pdf.worker.min.mjs?v=6.2.108');
});

test('copies the installed PDF.js Worker into public assets before a build', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'radexam-pdfjs-'));
    const sourceDirectory = path.join(root, 'node_modules', 'pdfjs-dist', 'build');
    mkdirSync(sourceDirectory, { recursive: true });
    writeFileSync(path.join(sourceDirectory, 'pdf.worker.min.mjs'), 'worker-version-6.2.108');

    const { destination } = syncPdfJsWorker(root);
    assert.equal(readFileSync(destination, 'utf8'), 'worker-version-6.2.108');
});

