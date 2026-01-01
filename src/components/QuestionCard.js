"use client";

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import AnswerEditor from './AnswerEditor';
import { getSelectionCount } from '@/lib/utils';
import styles from './QuestionCard.module.scss';
import 'katex/dist/katex.min.css'; // Import global Katex CSS here just in case

export default function QuestionCard({ question, userProgress, onAnswer, onSaveOverride, onUpdateStatus, availableGenres }) {
    const [selectedOptions, setSelectedOptions] = useState([]);
    const [showAnswer, setShowAnswer] = useState(false);

    // Editing States
    // Editing States
    const [isEditingAnswer, setIsEditingAnswer] = useState(false);
    const [isEditingGenre, setIsEditingGenre] = useState(false);
    const [isEditingExplanation, setIsEditingExplanation] = useState(false);

    const [editAnswerKey, setEditAnswerKey] = useState("");
    const [editGenre, setEditGenre] = useState("");
    const [draftExplanation, setDraftExplanation] = useState("");

    // Lightbox state
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(0);

    // Parse selection limit
    const maxSelection = getSelectionCount(question.question);

    // Memoize slides
    const slides = useMemo(() => question.images?.map(img => ({ src: `/${img.path}` })) || [], [question.images]);

    // Derived states
    const currentAnswer = userProgress?.overrideAnswer || question.answer || [];
    const currentGenre = userProgress?.overrideGenre || question.genre || "";
    const currentExplanation = userProgress?.overrideExplanation || question.explanation || "";

    // KaTeX Rendering for View Mode
    useEffect(() => {
        if (!isEditingExplanation && showAnswer) {
            import('katex').then(katex => {
                const mathNodes = document.querySelectorAll('.richTextContent span[data-type="math"]');
                mathNodes.forEach(node => {
                    const latex = node.getAttribute('latex');
                    if (latex) {
                        try {
                            katex.default.render(latex, node, {
                                throwOnError: false,
                                displayMode: false // Inline math
                            });
                        } catch (e) {
                            console.error("KaTeX render error:", e);
                            node.textContent = latex;
                        }
                    }
                });
            });
        }
    }, [isEditingExplanation, showAnswer, currentExplanation]); // Re-run when switching to view mode or explanation changes

    // Sync state if revisiting a question
    useEffect(() => {
        setSelectedOptions([]);
        setShowAnswer(false);
        setIsEditingAnswer(false);
        setIsEditingGenre(false);
        setIsEditingExplanation(false);
    }, [question.id]);

    // Initialize draft state correctly
    // Ensure editAnswerKey is a string even if currentAnswer is array
    // Initialize draft state when entering edit mode
    useEffect(() => {
        if (isEditingAnswer) {
            const ansStr = Array.isArray(currentAnswer) ? currentAnswer.join(',') : (currentAnswer || "");
            setEditAnswerKey(ansStr);
        }
    }, [isEditingAnswer, currentAnswer]);

    useEffect(() => {
        if (isEditingGenre) {
            setEditGenre(currentGenre);
        }
    }, [isEditingGenre, currentGenre]);

    useEffect(() => {
        if (isEditingExplanation) {
            setDraftExplanation(currentExplanation);
        }
    }, [isEditingExplanation, currentExplanation]);

    const toggleOption = (key) => {
        if (showAnswer) return;

        if (selectedOptions.includes(key)) {
            setSelectedOptions(prev => prev.filter(k => k !== key));
        } else {
            if (selectedOptions.length < maxSelection) {
                setSelectedOptions(prev => [...prev, key]);
            }
        }
    };

    const handleAnswerCheck = () => {
        setShowAnswer(true);
        onAnswer(selectedOptions);

        if (currentAnswer && onUpdateStatus) {
            const normalize = (val) => {
                if (Array.isArray(val)) return [...val].sort().join('');
                return (val || '').split(',').sort().join('');
            };
            const isCorrect = normalize(selectedOptions) === normalize(currentAnswer);
            onUpdateStatus(question.id, { status: isCorrect ? 'correct' : 'incorrect' });
        }
    };

    const handleSaveAnswer = () => {
        if (onSaveOverride) {
            const safeAnswer = editAnswerKey.split(/[,、\s]+/).map(s => s.trim()).filter(Boolean);
            onSaveOverride(question.id, {
                answer: safeAnswer,
                genre: currentGenre,
                explanation: currentExplanation
            });
        }
        setIsEditingAnswer(false);
    };

    const handleSaveGenre = () => {
        if (onSaveOverride) {
            onSaveOverride(question.id, {
                answer: currentAnswer,
                genre: editGenre,
                explanation: currentExplanation
            });
        }
        setIsEditingGenre(false);
    };

    const handleSaveExplanation = () => {
        if (onSaveOverride) {
            onSaveOverride(question.id, {
                answer: currentAnswer,
                genre: currentGenre,
                explanation: draftExplanation
            });
        }
        setIsEditingExplanation(false);
    };

    // Status / Favorite handlers
    const isCorrect = userProgress?.status === 'correct';
    const isIncorrect = userProgress?.status === 'incorrect';
    const isLiked = userProgress?.isLiked || false;

    const handleStatusToggle = (status) => {
        const newStatus = userProgress?.status === status ? null : status;
        if (onUpdateStatus) onUpdateStatus(question.id, { status: newStatus });
    };

    const handleLikeToggle = () => {
        if (onUpdateStatus) onUpdateStatus(question.id, { isLiked: !isLiked });
    };

    return (
        <div className={styles.card}>
            {/* Header / ID & Status (Genre Removed from here) */}
            <div className={styles.header}>
                <span className={styles.questionId}>{question.year} - {question.id}</span>
                {/* Genre logic moved to result area, but if not showing answer, user might want to see genre? 
                    User asked: "After clicking reveal button, display genre with answer/explanation".
                    So we hide it here? Or keep it? "Genre display position... after clicking...". 
                    implies it shouldn't be here, OR it should be duplicated/moved. 
                    I'll remove it from header to reduce clutter as requested. 
                */}

                <div className={styles.statusIcons}>
                    <button
                        className={`${styles.statusBtn} ${isLiked ? styles.activeLiked : ''}`}
                        onClick={handleLikeToggle}
                        title="お気に入り"
                    >
                        ★
                    </button>
                    <button
                        className={`${styles.statusBtn} ${isCorrect ? styles.activeCorrect : ''}`}
                        onClick={() => handleStatusToggle('correct')}
                        title="正解として記録"
                    >
                        ✓
                    </button>
                    <button
                        className={`${styles.statusBtn} ${isIncorrect ? styles.activeIncorrect : ''}`}
                        onClick={() => handleStatusToggle('incorrect')}
                        title="不正解として記録"
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Question Text */}
            <div
                className={styles.questionText}
                dangerouslySetInnerHTML={{ __html: question.question }}
            />

            {/* Images */}
            {question.images && question.images.length > 0 && (
                <div className={`${styles.imageGrid} ${question.images.length === 1 ? styles.singleGrid : ''}`}>
                    {question.images.map((img, idx) => (
                        <div key={idx} className={styles.imageWrapper} onClick={() => { setLightboxIndex(idx); setLightboxOpen(true); }}>
                            <img
                                src={`/${img.path}`}
                                alt={img.legend || `Image ${idx + 1}`}
                                className={styles.thumbnail}
                            />
                            {img.legend && <div className={styles.legend}>{img.legend}</div>}
                        </div>
                    ))}
                </div>
            )}

            <Lightbox
                open={lightboxOpen}
                close={() => setLightboxOpen(false)}
                index={lightboxIndex}
                slides={slides}
            />

            {/* Options */}
            <div className={styles.options}>
                {question.options && Object.entries(question.options).map(([key, text]) => {
                    const isSelected = selectedOptions.includes(key);
                    const isActualAnswer = Array.isArray(currentAnswer) ? currentAnswer.includes(key) : currentAnswer === key;
                    const isCorrectChoice = isActualAnswer;
                    let optionClass = styles.optionBtn;

                    if (isSelected) optionClass += ` ${styles.selected}`;
                    if (showAnswer) {
                        if (isCorrectChoice) optionClass += ` ${styles.correct}`;
                        if (isSelected && !isCorrectChoice) optionClass += ` ${styles.wrong}`;
                    }

                    return (
                        <button
                            key={key}
                            className={optionClass}
                            onClick={() => toggleOption(key)}
                        >
                            <span className={styles.optionKey}>{key}</span>
                            <span dangerouslySetInnerHTML={{ __html: text }} />
                        </button>
                    );
                })}
            </div>

            {/* Actions */}
            <div className={styles.actionRow}>
                {!showAnswer ? (
                    <button
                        className={styles.revealBtn}
                        onClick={handleAnswerCheck}
                    >
                        回答・解説を見る
                    </button>
                ) : (
                    <div className={styles.resultArea}>
                        {/* Explicit Answer & Genre Display */}
                        <div className={`${styles.explicitAnswer} ${isCorrect ? styles.correct : ''}`}>
                            <div className={styles.answerBlock}>
                                {isEditingAnswer ? (
                                    <div className={styles.inlineEdit}>
                                        <span className={styles.label}>正解:</span>
                                        <input
                                            type="text"
                                            value={editAnswerKey}
                                            onChange={(e) => setEditAnswerKey(e.target.value)}
                                            className={styles.answerInput}
                                            placeholder="a, b..."
                                        />
                                        <div className={styles.miniActions}>
                                            <button onClick={handleSaveAnswer} className={styles.saveBtn}>保存</button>
                                            <button onClick={() => setIsEditingAnswer(false)} className={styles.cancelBtn}>キャンセル</button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className={styles.answerText}>
                                            <span className={styles.label}>正解は</span>
                                            <span className={styles.value}>
                                                {Array.isArray(currentAnswer) ? currentAnswer.join(', ') : currentAnswer} です
                                            </span>
                                        </div>
                                        <button onClick={() => setIsEditingAnswer(true)} className={styles.iconEditBtn} title="編集">✎</button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Explanation Area */}
                        <div className={styles.explanation}>
                            <div className={styles.expHeader}>
                                <h3>解説</h3>
                                {!isEditingExplanation && (
                                    <button onClick={() => setIsEditingExplanation(true)} className={styles.iconEditBtn} title="編集">✎</button>
                                )}
                            </div>

                            {!isEditingExplanation ? (
                                <div
                                    className={`richTextContent ${styles.richTextContent}`}
                                    dangerouslySetInnerHTML={{ __html: currentExplanation || '解説がありません' }}
                                />
                            ) : (
                                <div className={styles.editorWrapper}>
                                    <AnswerEditor content={draftExplanation} onChange={setDraftExplanation} />
                                    <div className={styles.editActions}>
                                        <button onClick={() => setIsEditingExplanation(false)} className={styles.cancelBtn}>キャンセル</button>
                                        <button onClick={handleSaveExplanation} className={styles.saveBtn}>保存</button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Genre Display - Moved Below Explanation */}
                        {/* Genre Display - Moved Below Explanation */}
                        <div className={styles.genreArea}>
                            {isEditingGenre ? (
                                <div className={styles.genreEdit}>
                                    <span className={styles.label}>ジャンル:</span>
                                    <input
                                        type="text"
                                        value={editGenre}
                                        onChange={(e) => setEditGenre(e.target.value)}
                                        className={styles.genreInput}
                                        placeholder="ジャンル (カンマ区切り)"
                                        list="genre-list"
                                    />
                                    <datalist id="genre-list">
                                        {availableGenres?.map(g => <option key={g} value={g} />)}
                                    </datalist>
                                    <small>カンマ区切りで複数指定可能</small>
                                    <div className={styles.miniActions}>
                                        <button onClick={handleSaveGenre} className={styles.saveBtn}>保存</button>
                                        <button onClick={() => setIsEditingGenre(false)} className={styles.cancelBtn}>キャンセル</button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className={styles.genreContent}>
                                        <span className={styles.label}>ジャンル:</span>
                                        <div className={styles.genreTags}>
                                            {(Array.isArray(currentGenre) ? currentGenre : (currentGenre || '未設定').split(/[,、\s]+/)).map((g, i) => g && (
                                                <span key={i} className={styles.genreBadge}>{g}</span>
                                            ))}
                                        </div>
                                    </div>
                                    <button onClick={() => setIsEditingGenre(true)} className={styles.iconEditBtn} title="編集">✎</button>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
