"use client";

import { useEffect, useRef, useState } from 'react';

function PdfPage({ pdf, pageNumber, active, onClip }) {
    const canvasRef = useRef(null);
    const dragStartRef = useRef(null);
    const [selection, setSelection] = useState(null);
    const [size, setSize] = useState({ width: 1050, height: 1485 });

    useEffect(() => {
        let cancelled = false;
        let renderTask;
        (async () => {
            const page = await pdf.getPage(pageNumber);
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(1.7, 1050 / base.width);
            const viewport = page.getViewport({ scale });
            if (cancelled) return;
            setSize({ width: Math.floor(viewport.width), height: Math.floor(viewport.height) });
            if (!active || !canvasRef.current) return;
            const canvas = canvasRef.current;
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
            await renderTask.promise;
        })().catch(error => {
            if (!cancelled && error?.name !== 'RenderingCancelledException') console.error('PDF page render error:', error);
        });
        return () => {
            cancelled = true;
            renderTask?.cancel();
        };
    }, [pdf, pageNumber, active]);

    const pointFromEvent = event => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
            y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)),
        };
    };
    const updateSelection = (start, end) => setSelection({
        x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y),
    });
    const pointerDown = event => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragStartRef.current = pointFromEvent(event);
        updateSelection(dragStartRef.current, dragStartRef.current);
    };
    const pointerMove = event => dragStartRef.current && updateSelection(dragStartRef.current, pointFromEvent(event));
    const pointerUp = event => {
        if (dragStartRef.current) updateSelection(dragStartRef.current, pointFromEvent(event));
        dragStartRef.current = null;
    };
    const clip = () => {
        if (!selection || selection.width < 8 || selection.height < 8) return;
        const output = document.createElement('canvas');
        output.width = Math.round(selection.width);
        output.height = Math.round(selection.height);
        output.getContext('2d').drawImage(canvasRef.current, selection.x, selection.y, selection.width, selection.height, 0, 0, output.width, output.height);
        onClip?.(output.toDataURL('image/png'));
    };

    return (
        <section data-pdf-page={pageNumber} style={{ width: 'min(100%, 1050px)', margin: '0 auto 1.25rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '0.35rem', color: '#4a5568', fontSize: '0.8rem', fontWeight: 'bold' }}>— {pageNumber} —</div>
            <div style={{ position: 'relative', width: '100%', aspectRatio: `${size.width} / ${size.height}`, background: '#fff', boxShadow: '0 1px 5px rgba(0,0,0,0.18)', cursor: onClip ? 'crosshair' : 'default', lineHeight: 0 }}>
                {active && <canvas ref={canvasRef} onPointerDown={onClip ? pointerDown : undefined} onPointerMove={onClip ? pointerMove : undefined} onPointerUp={onClip ? pointerUp : undefined} style={{ display: 'block', width: '100%', height: '100%' }} />}
                {selection && active && <div style={{ position: 'absolute', left: `${selection.x / size.width * 100}%`, top: `${selection.y / size.height * 100}%`, width: `${selection.width / size.width * 100}%`, height: `${selection.height / size.height * 100}%`, border: '2px solid #e53e3e', background: 'rgba(229,62,62,0.12)', pointerEvents: 'none' }} />}
            </div>
            {onClip && selection && selection.width >= 8 && selection.height >= 8 && (
                <div style={{ textAlign: 'center', marginTop: '0.4rem' }}><button type="button" onClick={clip} style={{ background: '#3182ce', color: '#fff', border: 0, borderRadius: '0.35rem', padding: '0.45rem 0.8rem', fontWeight: 'bold' }}>この範囲を画像登録</button></div>
            )}
        </section>
    );
}

export default function PdfClipper({ pdfBlob, onClip, initialSearchText = '' }) {
    const scrollRef = useRef(null);
    const [pdf, setPdf] = useState(null);
    const [pageCount, setPageCount] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [activePages, setActivePages] = useState(new Set([1, 2]));
    const [error, setError] = useState('');
    const [initialPage, setInitialPage] = useState(null);

    useEffect(() => {
        let cancelled = false;
        if (!pdfBlob) return undefined;
        (async () => {
            const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
            pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
            const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
            const document = await pdfjs.getDocument({ data: bytes, cMapUrl: '/cmaps/', cMapPacked: true, standardFontDataUrl: '/standard_fonts/', wasmUrl: '/' }).promise;
            if (cancelled) return;
            setPdf(document);
            setPageCount(document.numPages);
            setCurrentPage(1);
            setActivePages(new Set([1, 2, 3].filter(number => number <= document.numPages)));
            const query = String(initialSearchText || '').replace(/<[^>]+>/g, '').replace(/\s+/g, '').slice(0, 22);
            if (query.length >= 6) {
                for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
                    const page = await document.getPage(pageNumber);
                    const content = await page.getTextContent();
                    const pageText = content.items.map(item => item.str || '').join('').replace(/\s+/g, '');
                    if (pageText.includes(query)) {
                        if (!cancelled) {
                            setCurrentPage(pageNumber);
                            setActivePages(new Set([pageNumber - 2, pageNumber - 1, pageNumber, pageNumber + 1, pageNumber + 2].filter(number => number >= 1 && number <= document.numPages)));
                            setInitialPage(pageNumber);
                        }
                        break;
                    }
                }
            }
        })().catch(e => !cancelled && setError(`PDFを開けませんでした: ${e.message}`));
        return () => { cancelled = true; };
    }, [pdfBlob, initialSearchText]);

    useEffect(() => {
        if (!initialPage || !scrollRef.current) return;
        const frame = requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const root = scrollRef.current;
                const target = root?.querySelector(`[data-pdf-page="${initialPage}"]`);
                if (root && target) {
                    root.scrollTop += target.getBoundingClientRect().top - root.getBoundingClientRect().top - 12;
                    setCurrentPage(initialPage);
                }
                setInitialPage(null);
            });
        });
        return () => cancelAnimationFrame(frame);
    }, [initialPage, pageCount]);

    const handleScroll = event => {
        const root = event.currentTarget;
        const pages = [...root.querySelectorAll('[data-pdf-page]')];
        const rootTop = root.getBoundingClientRect().top;
        let nearest = 1;
        let distance = Infinity;
        pages.forEach(element => {
            const nextDistance = Math.abs(element.getBoundingClientRect().top - rootTop - 12);
            if (nextDistance < distance) {
                distance = nextDistance;
                nearest = Number(element.dataset.pdfPage);
            }
        });
        setCurrentPage(nearest);
        setActivePages(new Set([nearest - 2, nearest - 1, nearest, nearest + 1, nearest + 2].filter(number => number >= 1 && number <= pageCount)));
    };
    const moveToPage = pageNumber => {
        const next = Math.max(1, Math.min(pageCount, pageNumber));
        scrollRef.current?.querySelector(`[data-pdf-page="${next}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    if (error) return <div style={{ color: '#c53030' }}>{error}</div>;
    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
                <button type="button" disabled={currentPage <= 1} onClick={() => moveToPage(currentPage - 1)}>前のページ</button>
                <strong>{pageCount ? `${currentPage} / ${pageCount}` : '読込中…'}</strong>
                <button type="button" disabled={!pageCount || currentPage >= pageCount} onClick={() => moveToPage(currentPage + 1)}>次のページ</button>
            </div>
            <p style={{ margin: '0 0 0.5rem', textAlign: 'center', color: '#4a5568', fontSize: '0.85rem' }}>
                {onClip ? '上下にスクロールできます。PDF上をドラッグして登録範囲を選択してください。' : '上下にスクロールしてPDFを連続閲覧できます。'}
            </p>
            <div ref={scrollRef} onScroll={handleScroll} style={{ height: 'calc(90vh - 175px)', minHeight: '420px', overflowY: 'scroll', overflowX: 'hidden', padding: '0.75rem', background: '#cbd5e0', border: '1px solid #a0aec0', borderRadius: '0.4rem', scrollbarGutter: 'stable' }}>
                {pdf && Array.from({ length: pageCount }, (_, index) => {
                    const pageNumber = index + 1;
                    return <PdfPage key={pageNumber} pdf={pdf} pageNumber={pageNumber} active={activePages.has(pageNumber)} onClip={onClip} />;
                })}
            </div>
        </div>
    );
}
