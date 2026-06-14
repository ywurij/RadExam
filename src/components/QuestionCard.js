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
    const [isEditingAnswer, setIsEditingAnswer] = useState(false);
    const [isEditingGenre, setIsEditingGenre] = useState(false);
    const [isEditingExplanation, setIsEditingExplanation] = useState(false);
    const [isEditingQuestion, setIsEditingQuestion] = useState(false);
    const [isEditingOptions, setIsEditingOptions] = useState(false);
    const [editingLegendIdx, setEditingLegendIdx] = useState(null);

    const [editAnswerKey, setEditAnswerKey] = useState("");
    const [editGenre, setEditGenre] = useState("");
    const [draftExplanation, setDraftExplanation] = useState("");
    const [isSavingExplanation, setIsSavingExplanation] = useState(false);
    
    const [draftQuestionText, setDraftQuestionText] = useState("");
    const [draftOptions, setDraftOptions] = useState({});
    const [draftLegendText, setDraftLegendText] = useState("");

    // Lightbox state
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(0);

    // Stable reference for empty array
    const EMPTY_ARRAY = useMemo(() => [], []);

    // Derived states
    const currentAnswer = userProgress?.overrideAnswer || question.answer || EMPTY_ARRAY;
    const currentGenre = userProgress?.overrideGenre || question.genre || "";
    const currentExplanation = userProgress?.overrideExplanation || question.explanation || "";
    const currentQuestionText = userProgress?.overrideQuestion || question.question || "";
    const currentOptions = userProgress?.overrideOptions || question.options || {};
    const currentImages = userProgress?.overrideImages || question.images || EMPTY_ARRAY;

    // Parse selection limit
    const maxSelection = getSelectionCount(currentQuestionText);

    // Memoize slides
    const slides = useMemo(() => currentImages?.map(img => {
        const isBase64 = img.path?.startsWith('data:');
        return { src: isBase64 ? img.path : `/${img.path}` };
    }) || [], [currentImages]);

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
        setIsSavingExplanation(false);
        setIsEditingQuestion(false);
        setIsEditingOptions(false);
        setEditingLegendIdx(null);
        // Reset drafts to avoid stale content
        setEditAnswerKey("");
        setEditGenre("");
        setDraftExplanation("");
        setDraftQuestionText("");
        setDraftOptions({});
        setDraftLegendText("");
    }, [question.id]);

    // Handlers for starting edit
    const startEditingAnswer = () => {
        const ansStr = Array.isArray(currentAnswer) ? currentAnswer.join(',') : (currentAnswer || "");
        setEditAnswerKey(ansStr);
        setIsEditingAnswer(true);
    };

    const startEditingGenre = () => {
        setEditGenre(currentGenre);
        setIsEditingGenre(true);
    };

    const startEditingExplanation = () => {
        setDraftExplanation(currentExplanation);
        setIsEditingExplanation(true);
    };

    const startEditingQuestion = () => {
        setDraftQuestionText(currentQuestionText);
        setIsEditingQuestion(true);
    };

    const startEditingOptions = () => {
        setDraftOptions({ ...currentOptions });
        setIsEditingOptions(true);
    };

    const startEditingLegend = (idx, currentLegend) => {
        setDraftLegendText(currentLegend || "");
        setEditingLegendIdx(idx);
    };

    const handleSaveQuestionText = () => {
        if (onSaveOverride) {
            onSaveOverride(question.id, {
                question: draftQuestionText
            });
        }
        setIsEditingQuestion(false);
    };

    const handleSaveOptions = () => {
        if (onSaveOverride) {
            onSaveOverride(question.id, {
                options: draftOptions
            });
        }
        setIsEditingOptions(false);
    };

    const handleSaveLegend = (idx) => {
        if (onSaveOverride) {
            const updatedImages = currentImages.map((img, i) => {
                if (i === idx) {
                    return { ...img, legend: draftLegendText };
                }
                return img;
            });
            onSaveOverride(question.id, {
                images: updatedImages
            });
        }
        setEditingLegendIdx(null);
    };

    const toggleOption = (key) => {
        if (showAnswer) return;

        if (selectedOptions.includes(key)) {
            setSelectedOptions(prev => prev.filter(k => k !== key));
        } else {
            if (maxSelection === 1) {
                // Single choice: Replace
                setSelectedOptions([key]);
            } else if (selectedOptions.length < maxSelection) {
                // Multi choice: Add if within limit
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

    const handleSaveExplanation = async () => {
        if (isSavingExplanation) return;
        setIsSavingExplanation(true);

        try {
            if (onSaveOverride) {
                await onSaveOverride(question.id, {
                    answer: currentAnswer,
                    genre: currentGenre,
                    explanation: draftExplanation
                });
            }
            setIsEditingExplanation(false);
        } catch (error) {
            console.error("Failed to save explanation:", error);
            alert("解説の保存に失敗しました。");
        } finally {
            setIsSavingExplanation(false);
        }
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
            <div className={styles.questionSection} style={{ marginBottom: '1.5rem' }}>
                {!isEditingQuestion ? (
                    <div className={styles.questionTextWrapper} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <div
                            className={styles.questionText}
                            style={{ margin: 0, flex: 1 }}
                            dangerouslySetInnerHTML={{ __html: currentQuestionText }}
                        />
                        <button onClick={startEditingQuestion} className={styles.iconEditBtn} style={{ marginTop: '4px' }} title="問題文を編集">✎</button>
                    </div>
                ) : (
                    <div className={styles.editorWrapper} style={{ marginBottom: '1rem' }}>
                        <h4 style={{ margin: '0 0 0.5rem 0' }}>問題文の編集</h4>
                        <AnswerEditor content={draftQuestionText} onChange={setDraftQuestionText} />
                        <div className={styles.editActions}>
                            <button onClick={() => setIsEditingQuestion(false)} className={styles.cancelBtn}>キャンセル</button>
                            <button onClick={handleSaveQuestionText} className={styles.saveBtn}>保存</button>
                        </div>
                    </div>
                )}
            </div>

            {/* Images */}
            {currentImages && currentImages.length > 0 && (
                <div className={`${styles.imageGrid} ${currentImages.length === 1 ? styles.singleGrid : ''}`}>
                    {currentImages.map((img, idx) => (
                        <div key={idx} className={styles.imageWrapper} onClick={() => { setLightboxIndex(idx); setLightboxOpen(true); }}>
                            <img
                                src={img.path?.startsWith('data:') ? img.path : `/${img.path}`}
                                alt={img.legend || `Image ${idx + 1}`}
                                className={styles.thumbnail}
                            />
                            {editingLegendIdx === idx ? (
                                <div className={styles.legendEditWrapper} onClick={(e) => e.stopPropagation()} style={{ marginTop: '0.5rem', width: '100%' }}>
                                    <input
                                        type="text"
                                        value={draftLegendText}
                                        onChange={(e) => setDraftLegendText(e.target.value)}
                                        style={{ width: '100%', padding: '0.3rem', fontSize: '0.85rem', border: '1px solid #cbd5e0', borderRadius: '0.25rem' }}
                                        autoFocus
                                    />
                                    <div className={styles.legendEditActions} style={{ marginTop: '0.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.25rem' }}>
                                        <button onClick={() => setEditingLegendIdx(null)} style={{ padding: '0.1rem 0.4rem', fontSize: '0.75rem', background: '#e2e8f0', border: 'none', borderRadius: '0.25rem', cursor: 'pointer' }}>✕</button>
                                        <button onClick={() => handleSaveLegend(idx)} style={{ padding: '0.1rem 0.4rem', fontSize: '0.75rem', background: '#3182ce', color: 'white', border: 'none', borderRadius: '0.25rem', cursor: 'pointer' }}>✓</button>
                                    </div>
                                </div>
                            ) : (
                                <div className={styles.legendWrapper} onClick={(e) => e.stopPropagation()} style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                                    {img.legend ? (
                                        <span className={styles.legend} style={{ margin: 0 }} dangerouslySetInnerHTML={{ __html: img.legend }} />
                                    ) : (
                                        <span className={styles.legend} style={{ margin: 0, color: '#a0aec0', fontStyle: 'italic' }}>凡例なし</span>
                                    )}
                                    <button onClick={() => startEditingLegend(idx, img.legend)} className={styles.iconEditBtn} style={{ padding: 0 }} title="凡例を編集">✎</button>
                                </div>
                            )}
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

            {/* Options Section */}
            <div className={styles.optionsSection} style={{ marginBottom: '2rem' }}>
                <div className={styles.optionsHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h4 style={{ margin: 0, fontSize: '1rem', color: '#4a5568' }}>選択肢</h4>
                    {!isEditingOptions && (
                        <button onClick={startEditingOptions} style={{ fontSize: '0.8rem', background: 'none', border: 'none', color: '#3182ce', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            ✎ 選択肢を編集
                        </button>
                    )}
                </div>

                {!isEditingOptions ? (
                    <div className={styles.options} style={{ marginBottom: 0 }}>
                        {currentOptions && Object.entries(currentOptions).sort((a,b) => a[0].localeCompare(b[0])).map(([key, text]) => {
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
                ) : (
                    <div className={styles.optionsEditForm} style={{ background: '#f8fafc', padding: '1rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
                        {currentOptions && Object.keys(currentOptions).sort().map(key => (
                            <div key={key} style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <span style={{ fontWeight: 'bold', width: '24px', color: '#4a5568' }}>{key}</span>
                                <input
                                    type="text"
                                    value={draftOptions[key] || ""}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setDraftOptions(prev => ({ ...prev, [key]: val }));
                                    }}
                                    style={{ flex: 1, padding: '0.4rem', border: '1px solid #cbd5e0', borderRadius: '0.25rem', fontSize: '0.9rem' }}
                                />
                            </div>
                        ))}
                        <div className={styles.editActions} style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.75rem' }}>
                            <button onClick={() => setIsEditingOptions(false)} className={styles.cancelBtn}>キャンセル</button>
                            <button onClick={handleSaveOptions} className={styles.saveBtn}>保存</button>
                        </div>
                    </div>
                )}
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
                                    <div className={styles.inlineEditAnswer}>
                                        <span className={styles.label}>正解を選択（タップして切替）:</span>
                                        <div className={styles.answerEditFlexWrapper}>
                                            <div className={styles.answerSelectionGrid}>
                                                {question.options && Object.keys(question.options).map(key => {
                                                    const currentList = editAnswerKey.split(/[,、\s]+/).map(s => s.trim()).filter(Boolean);
                                                    const isSelected = currentList.includes(key);
                                                    return (
                                                        <button
                                                            key={key}
                                                            type="button"
                                                            className={`${styles.answerTileBtn} ${isSelected ? styles.active : ''}`}
                                                            onClick={() => {
                                                                let newList;
                                                                if (isSelected) {
                                                                    newList = currentList.filter(item => item !== key);
                                                                } else {
                                                                    newList = [...currentList, key];
                                                                }
                                                                const sortedList = newList.sort((a, b) => a.localeCompare(b));
                                                                setEditAnswerKey(sortedList.join(', '));
                                                            }}
                                                        >
                                                            {key}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            <div className={styles.editActions}>
                                                <button onClick={() => setIsEditingAnswer(false)} className={styles.cancelBtn}>キャンセル</button>
                                                <button onClick={handleSaveAnswer} className={styles.saveBtn}>保存</button>
                                            </div>
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
                                        <button onClick={startEditingAnswer} className={styles.iconEditBtn} title="編集">✎</button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Explanation Area */}
                        <div className={styles.explanation}>
                            <div className={styles.expHeader}>
                                <h3>解説</h3>
                                {!isEditingExplanation && (
                                    <button onClick={startEditingExplanation} className={styles.iconEditBtn} title="編集">✎</button>
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
                                        <button 
                                            onClick={() => setIsEditingExplanation(false)} 
                                            className={styles.cancelBtn}
                                            disabled={isSavingExplanation}
                                        >
                                            キャンセル
                                        </button>
                                        <button 
                                            onClick={handleSaveExplanation} 
                                            className={styles.saveBtn}
                                            disabled={isSavingExplanation}
                                        >
                                            {isSavingExplanation ? '保存中...' : '保存'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Genre Display - Moved Below Explanation */}
                        {/* Genre Display - Moved Below Explanation */}
                        <div className={styles.genreArea}>
                            {isEditingGenre ? (
                                <div className={styles.genreEdit}>
                                    <span className={styles.label}>ジャンルを選択:</span>
                                    <div className={styles.genreSelectionGrid}>
                                        {availableGenres?.map(g => {
                                            const isSelected = editGenre.split(/[,、\s]+/).includes(g);
                                            return (
                                                <label key={g} className={styles.genreCheckbox}>
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={(e) => {
                                                            const currentList = editGenre.split(/[,、\s]+/).filter(x => x && x.trim() !== '');
                                                            let newList;
                                                            if (e.target.checked) {
                                                                newList = [...currentList, g];
                                                            } else {
                                                                newList = currentList.filter(item => item !== g);
                                                            }
                                                            // Unique and clean
                                                            const uniqueList = Array.from(new Set(newList));
                                                            setEditGenre(uniqueList.join(', '));
                                                        }}
                                                    />
                                                    <span>{g}</span>
                                                </label>
                                            );
                                        })}
                                    </div>

                                    <div className={styles.customGenreInput}>
                                        <label>新規/その他:</label>
                                        <input
                                            type="text"
                                            value={(() => {
                                                // Extract items NOT in availableGenres to show in input?
                                                // Or just allow appending?
                                                // Simpler: Just allow append. But that's messy if they untoggle.
                                                // Let's keep it simple: reliable checklist + free text appending is complex in one string.
                                                // Let's purely rely on the Checkbox to MANAGE the string for known genres.
                                                // And simple text input for "Everything else".
                                                // Strategy:
                                                // The `editGenre` state holds the FULL string.
                                                // The input field shows items that are NOT in `availableGenres`.
                                                const currentList = editGenre.split(/[,、\s]+/).filter(x => x && x.trim() !== '');
                                                const customItems = currentList.filter(item => !availableGenres?.includes(item));
                                                return customItems.join(', ');
                                            })()}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                const customParts = val.split(/[,、\s]+/).filter(x => x && x.trim() !== '');
                                                // Get currently selected KNOWN genres
                                                const currentList = editGenre.split(/[,、\s]+/).filter(x => x && x.trim() !== '');
                                                const knownSelected = currentList.filter(item => availableGenres?.includes(item));

                                                // Combine
                                                const final = [...knownSelected, ...customParts];
                                                setEditGenre(final.join(', '));
                                            }}
                                            placeholder="リストにないジャンルを入力"
                                        />
                                    </div>

                                    <div className={styles.editActions}>
                                        <button onClick={() => setIsEditingGenre(false)} className={styles.cancelBtn}>キャンセル</button>
                                        <button onClick={handleSaveGenre} className={styles.saveBtn}>保存</button>
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
                                    <button onClick={startEditingGenre} className={styles.iconEditBtn} title="編集">✎</button>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
