"use client";

import { useEffect, useMemo, useState } from 'react';
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import AnswerEditor from './AnswerEditor';
import PdfClipper from '@target/pdf-clipper';
import QuestionSourcePages from './QuestionSourcePages';
import StructuredLegendEditor, { createStructuredLegendFromText } from '@target/structured-legend-editor';
import { getSelectionCount } from '@/lib/utils';
import { APP_FEATURES } from '@/lib/appTarget';
import { sanitizeQuestionRichText, sanitizeRichHtml } from '@/lib/sanitizeRichHtml.mjs';
import styles from './QuestionCard.module.scss';
import 'katex/dist/katex.min.css';

const normalizeAnswer = value => Array.isArray(value) ? value : String(value || '').split(/[,、\s]+/).filter(Boolean);
const splitColumnOption = (value, columnCount) => {
    const cells = String(value || '').split(/\s*―\s*/s);
    return cells.length === columnCount && cells.every(Boolean) ? cells : null;
};
const buildColumnGridTemplate = (columnCount, includeOptionKey = false) => {
    const columns = Array.from({ length: columnCount }, () => 'minmax(0, 1fr)');
    const withConnectors = columns.flatMap((column, index) => (
        index === columns.length - 1 ? [column] : [column, '2.5rem']
    ));
    return [...(includeOptionKey ? ['3rem'] : []), ...withConnectors].join(' ');
};
const FigureLabels = ({ labels, position }) => {
    const matchingLabels = labels.filter(label => label.position === position);
    if (matchingLabels.length === 0) return null;
    const isSide = position === 'left' || position === 'right';

    return <div className={isSide ? styles.figureSideLabels : styles.figureEdgeLabels} data-position={position}>
        {matchingLabels.map((label, index) => {
            const offset = `${Math.max(0, Math.min(1, Number(label.offset) || 0)) * 100}%`;
            return <span
                key={`${position}-${label.text}-${index}`}
                style={isSide ? { top: offset } : { left: offset }}
                dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(label.text) }}
            />;
        })}
    </div>;
};

export default function QuestionCard({ question, userProgress, onAnswer, onSaveQuestionData, onUpdateStatus, availableGenres, pdfFiles = [], onEditingChange }) {
    const [selectedOptions, setSelectedOptions] = useState([]);
    const [showAnswer, setShowAnswer] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isEditingAnswer, setIsEditingAnswer] = useState(false);
    const [isEditingGenre, setIsEditingGenre] = useState(false);
    const [isEditingExplanation, setIsEditingExplanation] = useState(false);
    const [editAnswer, setEditAnswer] = useState([]);
    const [editGenre, setEditGenre] = useState('');
    const [editExplanation, setEditExplanation] = useState('');
    const [draft, setDraft] = useState(null);
    const [draggedImageIndex, setDraggedImageIndex] = useState(null);
    const [pdfTarget, setPdfTarget] = useState(null);
    const [selectedPdfKey, setSelectedPdfKey] = useState('');
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(0);
    const [imageDimensions, setImageDimensions] = useState({});

    const currentAnswer = question.answer || [];
    const currentImages = useMemo(() => question.images || [], [question.images]);
    const figureDisplay = useMemo(() => {
        const figures = currentImages.map((image, index) => {
        const dimensions = imageDimensions[`${question.id}:${index}`];
        const aspect = dimensions?.width && dimensions?.height ? dimensions.width / dimensions.height : 1;
        const isTall = aspect < 0.75;
        const imageWidth = Math.min(340, Math.max(120, Math.round((isTall ? 400 : 260) * aspect)));
        const labels = Array.isArray(image.legendLayout?.labels) ? image.legendLayout.labels : [];
        const sideLabelWidth = (labels.some(label => label.position === 'left') ? 88 : 0)
            + (labels.some(label => label.position === 'right') ? 88 : 0);
            return { imageWidth, isTall, sideLabelWidth, width: imageWidth + sideLabelWidth };
        });

        if (figures.length >= 2 && figures.length <= 3) {
            const availableWidth = 760 - (figures.length - 1) * 16;
            const totalWidth = figures.reduce((sum, figure) => sum + figure.width, 0);
            if (totalWidth > availableWidth) {
                const sideLabelWidth = figures.reduce((sum, figure) => sum + figure.sideLabelWidth, 0);
                const imageWidth = figures.reduce((sum, figure) => sum + figure.imageWidth, 0);
                const scale = Math.max(0, (availableWidth - sideLabelWidth) / imageWidth);
                if (figures.every(figure => figure.isTall || figure.imageWidth * scale >= 180)) {
                    return figures.map(figure => ({
                        ...figure,
                        width: Math.floor(figure.imageWidth * scale) + figure.sideLabelWidth
                    }));
                }
            }
        }
        return figures;
    }, [currentImages, imageDimensions, question.id]);
    const currentOptions = question.options || {};
    const isColumnOptionLayout = ['paired', 'columns'].includes(question.optionLayout?.type);
    const optionColumnCount = isColumnOptionLayout
        ? Math.max(2, Math.min(3, Number(question.optionLayout?.columnCount)
            || (question.optionLayout?.type === 'paired' ? 2 : question.optionLayout?.headers?.length)
            || 2))
        : 0;
    const optionColumnHeaders = isColumnOptionLayout
        && Array.isArray(question.optionLayout.headers)
        && question.optionLayout.headers.length === optionColumnCount
        ? question.optionLayout.headers
        : [];
    const maxSelection = getSelectionCount(question.question || '', currentAnswer);
    const slides = useMemo(() => currentImages.map(img => ({ src: img.path?.startsWith('data:') ? img.path : `/${img.path}` })), [currentImages]);
    const selectedPdf = pdfFiles.find(pdf => pdf.key === selectedPdfKey) || pdfFiles[0];
    const questionPdfKey = pdfFiles.find(pdf => Number(pdf.year) === Number(question.year))?.key || pdfFiles[0]?.key || '';

    useEffect(() => {
        setSelectedOptions([]);
        setShowAnswer(false);
        setIsEditing(false);
        onEditingChange?.(false);
        setIsEditingAnswer(false);
        setIsEditingGenre(false);
        setIsEditingExplanation(false);
        setDraft(null);
        setPdfTarget(null);
        setSelectedPdfKey(questionPdfKey);
    }, [question.id, questionPdfKey, onEditingChange]);

    useEffect(() => {
        if (!showAnswer) return;
        import('katex').then(katex => {
            document.querySelectorAll('.richTextContent span[data-type="math"]').forEach(node => {
                const latex = node.getAttribute('latex');
                if (latex) katex.default.render(latex, node, { throwOnError: false, displayMode: false });
            });
        });
    }, [showAnswer, question.explanation]);

    const beginEditing = () => {
        setDraft({
            question: question.question || '',
            options: { ...currentOptions },
            images: currentImages.map(image => ({ ...image })),
        });
        setSelectedPdfKey(questionPdfKey);
        setIsEditing(true);
        onEditingChange?.(true);
    };

    const closeEditing = () => {
        setIsEditing(false);
        setDraft(null);
        setPdfTarget(null);
        onEditingChange?.(false);
    };

    const saveAll = async () => {
        if (!draft || isSaving) return;
        setIsSaving(true);
        try {
            await onSaveQuestionData?.(question.id, sanitizeQuestionRichText(draft));
            closeEditing();
        } catch (error) {
            console.error('Failed to save question:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const updateDraftImage = (index, updates) => setDraft(previous => ({
        ...previous,
        images: previous.images.map((image, imageIndex) => imageIndex === index ? { ...image, ...updates } : image),
    }));

    const handleImageFile = file => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = event => setDraft(previous => ({
            ...previous,
            images: [...previous.images, { path: event.target.result, legend: '' }],
        }));
        reader.readAsDataURL(file);
    };

    const handleDropImage = targetIndex => {
        if (draggedImageIndex == null || draggedImageIndex === targetIndex) return;
        setDraft(previous => {
            const images = [...previous.images];
            const [moved] = images.splice(draggedImageIndex, 1);
            images.splice(targetIndex, 0, moved);
            return {
                ...previous,
                images: images.map(({ layout: _layout, ...image }) => image)
            };
        });
        setDraggedImageIndex(null);
    };

    const handlePdfClip = path => {
        setDraft(previous => {
            const images = [...previous.images];
            if (pdfTarget?.mode === 'replace') {
                const { storageKey: _oldStorageKey, ...imageWithoutStorageKey } = images[pdfTarget.index];
                images[pdfTarget.index] = { ...imageWithoutStorageKey, path };
            } else {
                images.push({ path, legend: '' });
            }
            return { ...previous, images };
        });
        setPdfTarget(null);
    };

    const toggleOption = key => {
        if (showAnswer) return;
        setSelectedOptions(previous => previous.includes(key)
            ? previous.filter(item => item !== key)
            : maxSelection === 1 ? [key] : previous.length < maxSelection ? [...previous, key] : previous);
    };

    const revealAnswer = () => {
        setShowAnswer(true);
        onAnswer(selectedOptions);
        const expected = [...normalizeAnswer(currentAnswer)].sort().join('');
        const actual = [...selectedOptions].sort().join('');
        onUpdateStatus?.(question.id, { status: expected === actual ? 'correct' : 'incorrect' });
    };

    const saveAnswer = async () => {
        await onSaveQuestionData?.(question.id, { answer: editAnswer });
        setIsEditingAnswer(false);
    };
    const saveGenre = async () => {
        await onSaveQuestionData?.(question.id, { genre: editGenre });
        setIsEditingGenre(false);
    };
    const saveExplanation = async () => {
        await onSaveQuestionData?.(question.id, { explanation: sanitizeRichHtml(editExplanation) });
        setIsEditingExplanation(false);
    };

    const isCorrect = userProgress?.status === 'correct';
    const isIncorrect = userProgress?.status === 'incorrect';
    const isLiked = userProgress?.isLiked || false;
    const toggleStatus = status => onUpdateStatus?.(question.id, { status: userProgress?.status === status ? null : status });

    return (
        <div className={styles.cardLayout}>
            <div className={styles.questionBlock}>
                <div className={styles.header}>
                    <span className={styles.questionId}>{question.year} - {question.id}</span>
                    <div className={styles.statusIcons}>
                        {APP_FEATURES.questionEditing && !isEditing && <button type="button" onClick={beginEditing} className={styles.editQuestionBtn}>設問を編集</button>}
                        <button className={`${styles.statusBtn} ${isLiked ? styles.activeLiked : ''}`} onClick={() => onUpdateStatus?.(question.id, { isLiked: !isLiked })} title="お気に入り">★</button>
                        <button className={`${styles.statusBtn} ${isCorrect ? styles.activeCorrect : ''}`} onClick={() => toggleStatus('correct')} title="正解として記録">✓</button>
                        <button className={`${styles.statusBtn} ${isIncorrect ? styles.activeIncorrect : ''}`} onClick={() => toggleStatus('incorrect')} title="不正解として記録">✕</button>
                    </div>
                </div>

                {isEditing && draft ? (
                    <div className={`${styles.editWorkspace} ${selectedPdf ? styles.withPdf : ''}`}>
                    <div className={styles.unifiedEditor}>
                        <div className={styles.editorTitleRow}><h3>設問全体の編集</h3><span>編集後、下部の「変更を保存」でまとめて反映します。</span></div>

                        <label className={styles.editorLabel}>問題文</label>
                        <AnswerEditor content={draft.question} onChange={value => setDraft(previous => ({ ...previous, question: value }))} />

                        <label className={styles.editorLabel}>選択肢</label>
                        <div className={styles.optionEditorGrid}>
                            {Object.keys(draft.options).sort().map(key => <div key={key}><strong>{key}.</strong><input value={draft.options[key] || ''} onChange={event => setDraft(previous => ({ ...previous, options: { ...previous.options, [key]: event.target.value } }))} /></div>)}
                        </div>

                        <label className={styles.editorLabel}>画像・レジェンド</label>
                        <div className={styles.imageEditToolbar}>
                            <label>＋ 画像ファイルを追加<input type="file" accept="image/*" hidden onChange={event => handleImageFile(event.target.files?.[0])} /></label>
                            {pdfFiles.length > 0 && <><select value={selectedPdfKey} onChange={event => { setSelectedPdfKey(event.target.value); setPdfTarget(null); }}>{pdfFiles.map(pdf => <option key={pdf.key} value={pdf.key}>{pdf.year ? `${pdf.year}年 — ` : ''}{pdf.name}</option>)}</select><button type="button" onClick={() => setPdfTarget({ mode: 'add' })}>PDFから画像を追加</button></>}
                        </div>
                        {draft.images.length === 0 ? <p className={styles.emptyImages}>画像は登録されていません。</p> : <div className={styles.editImageGrid}>{draft.images.map((image, index) => (
                            <div key={`${image.storageKey || image.path?.slice(0, 30)}-${index}`} draggable onDragStart={() => setDraggedImageIndex(index)} onDragOver={event => event.preventDefault()} onDrop={() => handleDropImage(index)} className={styles.editImageCard}>
                                <div className={styles.dragHandle}>⠿ ドラッグして並べ替え</div>
                                <img src={image.path?.startsWith('data:') ? image.path : `/${image.path}`} alt={image.legend || `画像${index + 1}`} />
                                {image.legendLayout ? <StructuredLegendEditor
                                    legendLayout={image.legendLayout}
                                    onChange={(legendLayout, legend) => updateDraftImage(index, { legendLayout, legend })}
                                    onDisable={legend => updateDraftImage(index, { legendLayout: undefined, legend })}
                                /> : <div className={styles.flatLegendEditor}>
                                    <input value={image.legend || ''} onChange={event => updateDraftImage(index, { legend: event.target.value })} placeholder="画像レジェンド" />
                                    <button type="button" onClick={() => updateDraftImage(index, { legendLayout: createStructuredLegendFromText(image.legend) })}>構造化へ変換</button>
                                </div>}
                                <div><button type="button" disabled={!selectedPdf} onClick={() => setPdfTarget({ mode: 'replace', index })}>PDFから差し替え</button><button type="button" className={styles.deleteImageBtn} onClick={() => setDraft(previous => ({ ...previous, images: previous.images.filter((_, imageIndex) => imageIndex !== index) }))}>削除</button></div>
                            </div>
                        ))}</div>}
                        <div className={styles.unifiedEditActions}><button type="button" onClick={closeEditing} disabled={isSaving}>キャンセル</button><button type="button" onClick={saveAll} disabled={isSaving}>{isSaving ? '保存中…' : '変更を保存'}</button></div>
                    </div>
                    {selectedPdf && <aside className={styles.pdfReferencePanel}>
                        <div className={styles.pdfReferenceHeader}>
                            <div><strong>登録元PDF</strong><span>{pdfTarget ? (pdfTarget.mode === 'replace' ? `画像${pdfTarget.index + 1}の差し替え範囲を選択中` : '追加する画像範囲を選択中') : '問題文・選択肢・レジェンドの確認用'}</span></div>
                            {pdfTarget && <button type="button" onClick={() => setPdfTarget(null)}>切り抜きを解除</button>}
                        </div>
                        <PdfClipper pdfBlob={selectedPdf.blob} initialSearchText={question.question || ''} onClip={pdfTarget ? handlePdfClip : undefined} />
                    </aside>}
                    </div>
                ) : (
                    <>
                        <div className={styles.questionSection} style={{ marginBottom: '1.5rem' }}><div className={styles.questionText} dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(question.question) }} /></div>
                        <QuestionSourcePages sourcePages={question.sourcePages || []} pdfFiles={pdfFiles} />
                        {currentImages.length > 0 && <div className={`${styles.responsiveImageGrid} ${currentImages.length === 1 ? styles.singleGrid : ''}`}>{currentImages.map((img, idx) => {
                            const labels = Array.isArray(img.legendLayout?.labels) ? img.legendLayout.labels : [];
                            const hasLeftLabels = labels.some(label => label.position === 'left');
                            const hasRightLabels = labels.some(label => label.position === 'right');
                            const structuredStyle = { '--figure-width': `${figureDisplay[idx].width}px` };
                            const displayedLegend = img.legendLayout ? img.legendLayout.title : img.legend;
                            const wrapperClassName = `${styles.imageWrapper} ${hasLeftLabels ? styles.hasLeftLabels : ''} ${hasRightLabels ? styles.hasRightLabels : ''} ${figureDisplay[idx].isTall ? styles.tallImageWrapper : ''}`;
                            return <div key={idx} className={wrapperClassName} style={structuredStyle} onClick={() => { setLightboxIndex(idx); setLightboxOpen(true); }}>
                                <FigureLabels labels={labels} position="top" />
                                <div className={styles.structuredFigureBody}>
                                    <FigureLabels labels={labels} position="left" />
                                    <img
                                        src={img.path?.startsWith('data:') ? img.path : `/${img.path}`}
                                        alt={img.legend || `Image ${idx + 1}`}
                                        className={styles.thumbnail}
                                        onLoad={event => {
                                            const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
                                            const dimensionKey = `${question.id}:${idx}`;
                                            setImageDimensions(previous => previous[dimensionKey]?.width === width && previous[dimensionKey]?.height === height
                                                ? previous
                                                : { ...previous, [dimensionKey]: { width, height } });
                                        }}
                                    />
                                    <FigureLabels labels={labels} position="right" />
                                </div>
                                <FigureLabels labels={labels} position="bottom" />
                                {displayedLegend && <div className={styles.legend} dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(displayedLegend) }} />}
                            </div>;
                        })}</div>}
                        <div className={styles.optionsSection} style={{ marginBottom: '2rem' }}>
                            <h4>選択肢</h4>
                            <div className={styles.options}>
                                {optionColumnHeaders.length === optionColumnCount && <div
                                    className={styles.pairedOptionHeader}
                                    style={{ gridTemplateColumns: buildColumnGridTemplate(optionColumnCount, true) }}
                                >
                                    <span aria-hidden="true" />
                                    {optionColumnHeaders.flatMap((header, index) => [
                                        <strong key={`header-${index}`} dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(header) }} />,
                                        ...(index < optionColumnHeaders.length - 1
                                            ? [<span key={`header-connector-${index}`} aria-hidden="true" />]
                                            : []),
                                    ])}
                                </div>}
                                {Object.entries(currentOptions).sort((a, b) => a[0].localeCompare(b[0])).map(([key, text]) => {
                                    const selected = selectedOptions.includes(key);
                                    const answer = normalizeAnswer(currentAnswer).includes(key);
                                    const columnCells = isColumnOptionLayout
                                        ? splitColumnOption(text, optionColumnCount)
                                        : null;
                                    let className = styles.optionBtn;
                                    if (selected) className += ` ${styles.selected}`;
                                    if (showAnswer && answer) className += ` ${styles.correct}`;
                                    if (showAnswer && selected && !answer) className += ` ${styles.wrong}`;
                                    return <button key={key} className={className} onClick={() => toggleOption(key)}>
                                        <span className={styles.optionKey}>{key}</span>
                                        {columnCells
                                            ? <span
                                                className={styles.pairedOptionCells}
                                                style={{ gridTemplateColumns: buildColumnGridTemplate(optionColumnCount) }}
                                            >
                                                {columnCells.flatMap((cell, index) => [
                                                    <span key={`cell-${index}`} dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(cell) }} />,
                                                    ...(index < columnCells.length - 1
                                                        ? [<span key={`connector-${index}`} className={styles.pairedOptionConnector} aria-hidden="true">―</span>]
                                                        : []),
                                                ])}
                                            </span>
                                            : <span dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(text) }} />}
                                    </button>;
                                })}
                            </div>
                        </div>
                        <div className={styles.actionRow}>{!showAnswer ? <button className={styles.revealBtn} onClick={revealAnswer}>回答・解説を見る</button> : <div className={`${styles.explicitAnswer} ${isCorrect ? styles.correct : ''}`}><div className={styles.answerBlock}>{isEditingAnswer ? <div className={styles.inlineEditAnswer}><span className={styles.label}>正解を選択:</span><div className={styles.answerSelectionGrid}>{Object.keys(currentOptions).sort().map(key => <button type="button" key={key} className={`${styles.answerTileBtn} ${editAnswer.includes(key) ? styles.draftAnswerActive : ''}`} onClick={() => setEditAnswer(previous => previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key].sort())}>{key}</button>)}</div><div className={styles.editActions}><button onClick={() => setIsEditingAnswer(false)} className={styles.cancelBtn}>キャンセル</button><button onClick={saveAnswer} className={styles.saveBtn}>保存</button></div></div> : <><div className={styles.answerText}><span className={styles.label}>正解は</span><span className={styles.value}>{normalizeAnswer(currentAnswer).join(', ')} です</span></div>{APP_FEATURES.answerEditing && <button onClick={() => { setEditAnswer(normalizeAnswer(currentAnswer)); setIsEditingAnswer(true); }} className={styles.iconEditBtn} title="正解を編集">✎</button>}</>}</div></div>}</div>
                    </>
                )}
            </div>

            {showAnswer && !isEditing && <><div className={styles.explanation}><div className={styles.expHeader}><h3>解説</h3>{!isEditingExplanation && <button onClick={() => { setEditExplanation(question.explanation || ''); setIsEditingExplanation(true); }} className={styles.iconEditBtn} title="解説を編集">✎</button>}</div>{isEditingExplanation ? <div className={styles.editorWrapper}><AnswerEditor content={editExplanation} onChange={setEditExplanation} /><div className={styles.editActions}><button onClick={() => setIsEditingExplanation(false)} className={styles.cancelBtn}>キャンセル</button><button onClick={saveExplanation} className={styles.saveBtn}>保存</button></div></div> : <div className={`richTextContent ${styles.richTextContent}`} dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(question.explanation || '解説がありません') }} />}</div><div className={styles.genreArea}>{isEditingGenre ? <div className={styles.genreEdit}><span className={styles.label}>ジャンル:</span><input className={styles.fullWidthInput} value={editGenre} onChange={event => setEditGenre(event.target.value)} list="question-genres" /><datalist id="question-genres">{availableGenres?.map(genre => <option key={genre} value={genre} />)}</datalist><div className={styles.editActions}><button onClick={() => setIsEditingGenre(false)} className={styles.cancelBtn}>キャンセル</button><button onClick={saveGenre} className={styles.saveBtn}>保存</button></div></div> : <><div className={styles.genreContent}><span className={styles.label}>ジャンル:</span><div className={styles.genreTags}>{(Array.isArray(question.genre) ? question.genre : (question.genre || '未設定').split(/[,、\s]+/)).map((genre, index) => genre && <span key={index} className={styles.genreBadge}>{genre}</span>)}</div></div><button onClick={() => { setEditGenre(Array.isArray(question.genre) ? question.genre.join(', ') : (question.genre || '')); setIsEditingGenre(true); }} className={styles.iconEditBtn} title="ジャンルを編集">✎</button></>}</div></>}

            <Lightbox
                open={lightboxOpen}
                close={() => setLightboxOpen(false)}
                index={lightboxIndex}
                slides={slides}
                plugins={[Zoom]}
                zoom={{ maxZoomPixelRatio: 5, scrollToZoom: true }}
            />
        </div>
    );
}
