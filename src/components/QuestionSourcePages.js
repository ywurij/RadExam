"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { configurePdfJsWorker } from '@/lib/pdfJsWorker.mjs';

const documentCache = new WeakMap();

const loadPdfDocument = async blob => {
    if (documentCache.has(blob)) return documentCache.get(blob);
    const promise = (async () => {
        const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
        configurePdfJsWorker(pdfjs);
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
    const [renderedPages, setRenderedPages] = useState({ full: '', focused: '' });
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewZoom, setPreviewZoom] = useState(1);
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
            if (cancelled) return;
            let focusedDataUrl = '';
            if (sourcePage.focusRect) {
                const focus = sourcePage.focusRect;
                const cropCanvas = document.createElement('canvas');
                const cropX = Math.max(0, Math.floor(canvas.width * focus.x));
                const cropY = Math.max(0, Math.floor(canvas.height * focus.y));
                const cropWidth = Math.max(1, Math.min(canvas.width - cropX, Math.ceil(canvas.width * focus.width)));
                const cropHeight = Math.max(1, Math.min(canvas.height - cropY, Math.ceil(canvas.height * focus.height)));
                cropCanvas.width = cropWidth;
                cropCanvas.height = cropHeight;
                cropCanvas.getContext('2d').drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
                focusedDataUrl = cropCanvas.toDataURL('image/png');
            }
            setRenderedPages({ full: canvas.toDataURL('image/png'), focused: focusedDataUrl });
        })().catch(nextError => {
            if (!cancelled && nextError?.name !== 'RenderingCancelledException') {
                setError(`PDFページを表示できません: ${nextError.message}`);
            }
        });
        return () => {
            cancelled = true;
            renderTask?.cancel();
        };
    }, [pdfRecord.blob, sourcePage.focusRect, sourcePage.pageNumber, sourcePage.rotation]);

    useEffect(() => {
        if (!previewOpen) return undefined;
        const handleKeyDown = event => event.key === 'Escape' && setPreviewOpen(false);
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [previewOpen]);

    const focus = sourcePage.focusRect;
    const focused = Boolean(focus && !showFullPage);
    const displayWidth = focused ? size.width * focus.width : size.width;
    const displayHeight = focused ? size.height * focus.height : size.height;
    const displayAspect = Math.max(0.1, displayWidth / Math.max(1, displayHeight));
    const frameWidth = `min(720px, ${42 * displayAspect}vh, calc(100vw - 3rem))`;
    const sectionWidth = `min(742px, calc(${42 * displayAspect}vh + 1.2rem + 2px), calc(100vw - 2rem))`;
    const frameStyle = focused ? {
        position: 'relative',
        width: frameWidth,
        maxWidth: '100%',
        aspectRatio: `${displayWidth} / ${displayHeight}`,
        overflow: 'hidden'
    } : {
        position: 'relative',
        width: frameWidth,
        maxWidth: '100%',
        aspectRatio: `${displayWidth} / ${displayHeight}`,
        overflow: 'hidden'
    };
    const canvasStyle = focused ? {
        position: 'absolute',
        width: `${100 / focus.width}%`,
        height: 'auto',
        maxWidth: 'none',
        left: `${-focus.x / focus.width * 100}%`,
        top: `${-focus.y / focus.height * 100}%`,
        display: 'block'
    } : { width: '100%', height: 'auto', display: 'block' };
    const previewSrc = focused ? renderedPages.focused : renderedPages.full;

    return (
        <section style={{ width: sectionWidth, maxWidth: '100%', margin: '0 auto', border: '1px solid var(--border-color)', borderRadius: '0.6rem', overflow: 'hidden', background: 'var(--surface-soft)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.7rem', background: 'var(--surface-soft)', borderBottom: '1px solid var(--border-color)' }}>
                <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{sourcePage.pageNumber}ページ</strong>
                {focus && (
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button type="button" onClick={() => setShowFullPage(false)} disabled={!showFullPage} style={{ padding: '0.3rem 0.55rem' }}>設問範囲</button>
                        <button type="button" onClick={() => setShowFullPage(true)} disabled={showFullPage} style={{ padding: '0.3rem 0.55rem' }}>ページ全体</button>
                    </div>
                )}
            </div>
            {error ? <div style={{ padding: '1rem', color: 'var(--danger-text)' }}>{error}</div> : (
                <div style={{ padding: '0.6rem', overflow: 'auto', background: 'var(--surface-muted)' }}>
                    <div
                        style={{ ...frameStyle, margin: '0 auto', background: 'var(--surface-raised)', boxShadow: '0 1px 5px rgba(0,0,0,0.2)', cursor: previewSrc ? 'zoom-in' : 'default' }}
                        onClick={() => previewSrc && setPreviewOpen(true)}
                        title={previewSrc ? 'クリックして拡大表示' : undefined}
                    >
                        <canvas ref={canvasRef} style={canvasStyle} />
                    </div>
                </div>
            )}
            {previewOpen && previewSrc && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={`${sourcePage.pageNumber}ページの拡大表示`}
                    onClick={() => setPreviewOpen(false)}
                    style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', flexDirection: 'column', padding: '1rem', background: 'rgba(15, 23, 42, 0.94)' }}
                >
                    <div onClick={event => event.stopPropagation()} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', color: '#fff' }}>
                        <button type="button" onClick={() => setPreviewZoom(value => Math.max(0.75, value - 0.25))} aria-label="縮小">−</button>
                        <button type="button" onClick={() => setPreviewZoom(1)}>100%</button>
                        <button type="button" onClick={() => setPreviewZoom(value => Math.min(4, value + 0.25))} aria-label="拡大">＋</button>
                        <span>{Math.round(previewZoom * 100)}%</span>
                        <button type="button" onClick={() => setPreviewOpen(false)}>閉じる</button>
                    </div>
                    <div onClick={event => event.stopPropagation()} style={{ flex: 1, overflow: 'auto', textAlign: 'center' }}>
                        <img src={previewSrc} alt={`${sourcePage.pageNumber}ページ`} style={{ width: `${previewZoom * 90}%`, maxWidth: 'none', height: 'auto', background: 'var(--surface-raised)' }} />
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
            <div style={{ marginBottom: '0.55rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {sourcePages.some(sourcePage => sourcePage.sourceType === 'nuclear-appendix') ? '巻末図（別紙）' : '登録元PDFページ'}
            </div>
            <div style={{ display: 'grid', gap: '0.8rem' }}>
                {resolvedPages.map(({ sourcePage, pdfRecord }, index) => (
                    pdfRecord ? (
                        <SourcePageCanvas key={`${sourcePage.pdfName}-${sourcePage.pageNumber}-${index}`} sourcePage={sourcePage} pdfRecord={pdfRecord} />
                    ) : (
                        <div key={`${sourcePage.pdfName}-${sourcePage.pageNumber}-${index}`} style={{ padding: '0.8rem', border: '1px solid #feb2b2', borderRadius: '0.4rem', color: 'var(--danger-text)', background: 'var(--danger-soft)' }}>
                            元PDF「{sourcePage.pdfName}」が見つかりません（{sourcePage.pageNumber}ページ）。
                        </div>
                    )
                ))}
            </div>
        </section>
    );
}
