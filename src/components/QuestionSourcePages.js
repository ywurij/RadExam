"use client";

import { useEffect, useMemo, useRef, useState } from 'react';

const documentCache = new WeakMap();

const loadPdfDocument = async blob => {
    if (documentCache.has(blob)) return documentCache.get(blob);
    const promise = (async () => {
        const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return pdfjs.getDocument({
            data: bytes,
            cMapUrl: '/cmaps/',
            cMapPacked: true,
            standardFontDataUrl: '/standard_fonts/',
            wasmUrl: '/'
        }).promise;
    })();
    documentCache.set(blob, promise);
    return promise;
};

const resolvePdf = (sourcePage, pdfFiles) => (
    pdfFiles.find(pdf => sourcePage.pdfKey && pdf.key === sourcePage.pdfKey)
    || pdfFiles.find(pdf => pdf.name === sourcePage.pdfName && Number(pdf.year) === Number(sourcePage.pdfYear))
    || pdfFiles.find(pdf => Number(pdf.year) === Number(sourcePage.pdfYear))
);

function SourcePageCanvas({ sourcePage, pdfRecord }) {
    const canvasRef = useRef(null);
    const [size, setSize] = useState({ width: 1, height: 1 });
    const [showFullPage, setShowFullPage] = useState(!sourcePage.focusRect);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        let renderTask;
        (async () => {
            const pdf = await loadPdfDocument(pdfRecord.blob);
            const page = await pdf.getPage(sourcePage.pageNumber);
            const rotation = ((Number(page.rotate) || 0) + (Number(sourcePage.rotation) || 0)) % 360;
            const base = page.getViewport({ scale: 1, rotation });
            const scale = Math.min(2, 1200 / base.width);
            const viewport = page.getViewport({ scale, rotation });
            if (cancelled || !canvasRef.current) return;
            const canvas = canvasRef.current;
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            setSize({ width: canvas.width, height: canvas.height });
            renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
            await renderTask.promise;
        })().catch(nextError => {
            if (!cancelled && nextError?.name !== 'RenderingCancelledException') {
                setError(`PDFページを表示できません: ${nextError.message}`);
            }
        });
        return () => {
            cancelled = true;
            renderTask?.cancel();
        };
    }, [pdfRecord.blob, sourcePage.pageNumber, sourcePage.rotation]);

    const focus = sourcePage.focusRect;
    const focused = Boolean(focus && !showFullPage);
    const frameStyle = focused ? {
        position: 'relative',
        width: '100%',
        aspectRatio: `${size.width * focus.width} / ${size.height * focus.height}`,
        overflow: 'hidden'
    } : { position: 'relative', width: '100%' };
    const canvasStyle = focused ? {
        position: 'absolute',
        width: `${100 / focus.width}%`,
        height: 'auto',
        maxWidth: 'none',
        left: `${-focus.x / focus.width * 100}%`,
        top: `${-focus.y / focus.height * 100}%`,
        display: 'block'
    } : { width: '100%', height: 'auto', display: 'block' };

    return (
        <section style={{ border: '1px solid #cbd5e0', borderRadius: '0.6rem', overflow: 'hidden', background: '#edf2f7' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.7rem', background: '#f7fafc', borderBottom: '1px solid #cbd5e0' }}>
                <strong style={{ fontSize: '0.85rem', color: '#2d3748' }}>{sourcePage.pageNumber}ページ</strong>
                {focus && (
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button type="button" onClick={() => setShowFullPage(false)} disabled={!showFullPage} style={{ padding: '0.3rem 0.55rem' }}>設問範囲</button>
                        <button type="button" onClick={() => setShowFullPage(true)} disabled={showFullPage} style={{ padding: '0.3rem 0.55rem' }}>ページ全体</button>
                    </div>
                )}
            </div>
            {error ? <div style={{ padding: '1rem', color: '#c53030' }}>{error}</div> : (
                <div style={{ padding: '0.6rem', overflow: 'auto', background: '#a0aec0' }}>
                    <div style={{ ...frameStyle, maxWidth: '1050px', margin: '0 auto', background: '#fff', boxShadow: '0 1px 5px rgba(0,0,0,0.2)' }}>
                        <canvas ref={canvasRef} style={canvasStyle} />
                    </div>
                </div>
            )}
        </section>
    );
}

export default function QuestionSourcePages({ sourcePages = [], pdfFiles = [] }) {
    const resolvedPages = useMemo(() => sourcePages.map(sourcePage => ({
        sourcePage,
        pdfRecord: resolvePdf(sourcePage, pdfFiles)
    })), [sourcePages, pdfFiles]);

    if (sourcePages.length === 0) return null;
    return (
        <section style={{ margin: '0 0 2rem' }}>
            <div style={{ marginBottom: '0.55rem', fontWeight: 800, color: '#2d3748' }}>
                {sourcePages.some(sourcePage => sourcePage.sourceType === 'nuclear-appendix') ? '巻末図（別紙）' : '登録元PDFページ'}
            </div>
            <div style={{ display: 'grid', gap: '0.8rem' }}>
                {resolvedPages.map(({ sourcePage, pdfRecord }, index) => (
                    pdfRecord ? (
                        <SourcePageCanvas key={`${sourcePage.pdfName}-${sourcePage.pageNumber}-${index}`} sourcePage={sourcePage} pdfRecord={pdfRecord} />
                    ) : (
                        <div key={`${sourcePage.pdfName}-${sourcePage.pageNumber}-${index}`} style={{ padding: '0.8rem', border: '1px solid #feb2b2', borderRadius: '0.4rem', color: '#c53030', background: '#fff5f5' }}>
                            元PDF「{sourcePage.pdfName}」が見つかりません（{sourcePage.pageNumber}ページ）。
                        </div>
                    )
                ))}
            </div>
        </section>
    );
}
