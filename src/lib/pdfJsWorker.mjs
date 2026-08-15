export const pdfJsWorkerUrl = version => {
    const cacheKey = encodeURIComponent(String(version || 'current'));
    return `/pdf.worker.min.mjs?v=${cacheKey}`;
};

export const configurePdfJsWorker = pdfjs => {
    if (!pdfjs?.GlobalWorkerOptions) {
        throw new Error('PDF表示ライブラリを初期化できませんでした。');
    }
    pdfjs.GlobalWorkerOptions.workerSrc = pdfJsWorkerUrl(pdfjs.version);
    return pdfjs.GlobalWorkerOptions.workerSrc;
};

