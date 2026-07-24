
import { useState } from 'react';
import { resolveQuestionProgress } from '@/lib/questionProgress.mjs';
import styles from './QuizResult.module.scss';


export default function QuizResult({ questions, userProgress, onHome, onToggleLike, onEdit }) {
    const total = questions.length;
    let correctCount = 0;

    questions.forEach(q => {
        if (resolveQuestionProgress(userProgress, q).status === 'correct') {
            correctCount++;
        }
    });

    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    const [hoveredQ, setHoveredQ] = useState(null);
    const [modalQ, setModalQ] = useState(null);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

    const handleMouseMove = (e) => {
        if (hoveredQ) {
            setMousePos({ x: e.clientX, y: e.clientY });
        }
    };

    return (
        <div className={styles.container} onMouseMove={handleMouseMove}>
            <div className={styles.resultHeader}>
                <h1 className={styles.title}>演習結果</h1>
                <button onClick={onHome} className={styles.homeBtn}>
                    ホームに戻る
                </button>
            </div>

            <div className={styles.scoreCard}>
                <div className={styles.scoreLabel}>正解率</div>
                <div className={styles.scoreValue}>{percentage}%</div>
                <div className={styles.scoreDetail}>{correctCount} / {total} 問</div>
            </div>

            <div className={styles.listContainer}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>No.</th>
                            <th>問題</th>
                            <th>結果</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {questions.map((q, index) => {
                            const questionProgress = resolveQuestionProgress(userProgress, q);
                            const status = questionProgress.status;
                            const isLiked = questionProgress.isLiked;
                            return (
                                <tr key={q.id}>
                                    <td>{index + 1}</td>
                                    <td
                                        className={styles.questionText}
                                        onMouseEnter={() => setHoveredQ(q)}
                                        onMouseLeave={() => setHoveredQ(null)}
                                        onClick={() => setModalQ(q)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        {q.question.substring(0, 40)}...
                                        <span className={styles.infoIcon}>ⓘ</span>
                                    </td>
                                    <td className={status === 'correct' ? styles.correct : styles.incorrect}>
                                        {status === 'correct' ? '正解' : '不正解'}
                                    </td>
                                    <td>
                                        <div className={styles.actionBtns}>
                                            <button
                                                onClick={() => onToggleLike(q.id)}
                                                className={`${styles.starBtn} ${isLiked ? styles.active : ''}`}
                                                title={isLiked ? "お気に入り解除" : "お気に入り登録"}
                                            >
                                                {isLiked ? '★' : '☆'}
                                            </button>
                                            <button
                                                onClick={() => onEdit && onEdit(index)}
                                                className={styles.editBtn}
                                                title="解説を編集"
                                            >
                                                ✎
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <button onClick={onHome} className={styles.homeBtn}>
                ホームに戻る
            </button>

            {/* Hover Tooltip (Desktop) */}
            {hoveredQ && !modalQ && (
                <div
                    className={styles.tooltip}
                    style={{ top: mousePos.y + 20, left: Math.min(mousePos.x, window.innerWidth - 320) }}
                >
                    <div className={styles.tooltipContent}>
                        <p className={styles.fullQuestion}>{hoveredQ.question}</p>
                        <ul className={styles.optionsList}>
                            {Object.entries(hoveredQ.options).map(([key, val]) => (
                                <li key={key}><b>{key}</b>: {val}</li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}

            {/* Click Modal (Mobile/Desktop) */}
            {modalQ && (
                <div className={styles.modalOverlay} onClick={() => setModalQ(null)}>
                    <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
                        <button className={styles.closeBtn} onClick={() => setModalQ(null)}>×</button>
                        <h3 className={styles.modalTitle}>問題詳細</h3>
                        <p className={styles.fullQuestion}>{modalQ.question}</p>
                        <ul className={styles.optionsList}>
                            {Object.entries(modalQ.options).map(([key, val]) => (
                                <li key={key}><b>{key}</b>: {val}</li>
                            ))}
                        </ul>
                        <div className={styles.modalFooter}>
                            <button className={styles.secondaryBtn} onClick={() => setModalQ(null)}>閉じる</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
