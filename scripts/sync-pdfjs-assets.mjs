import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const pdfJsWorkerPaths = (root = projectRoot) => ({
    source: path.join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs'),
    destination: path.join(root, 'public', 'pdf.worker.min.mjs'),
});

export const syncPdfJsWorker = (root = projectRoot) => {
    const paths = pdfJsWorkerPaths(root);
    if (!existsSync(paths.source)) {
        throw new Error(`pdfjs-dist Workerが見つかりません: ${paths.source}`);
    }
    mkdirSync(path.dirname(paths.destination), { recursive: true });
    copyFileSync(paths.source, paths.destination);
    return paths;
};

const isDirectRun = process.argv[1]
    && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
    const { destination } = syncPdfJsWorker();
    console.log(`Synchronized PDF.js Worker: ${path.relative(projectRoot, destination)}`);
}

