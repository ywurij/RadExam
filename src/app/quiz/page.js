"use client";

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getExamData, getAllQuestions, getQuestionsByYear, getGlobalQuestionId, getGenres } from '@/lib/data';
import QuestionCard from '@/components/QuestionCard';
import styles from './quiz.module.scss';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { saveUserProgress, saveQuestionOverride, getUserExamProgress, getAllOverrides } from '@/lib/db';
import QuizResult from '@/components/QuizResult';

function QuizContent() {
    const searchParams = useSearchParams();
    const router = useRouter();

    // Params
    const examId = searchParams.get('exam') || 'diagnostic';
    const yearFilter = searchParams.get('year') || 'all';
    const countFilter = searchParams.get('count') || '10';
    const isShuffle = searchParams.get('shuffle') === 'true';
    const genreFilter = searchParams.get('genres') ? searchParams.get('genres').split(',') : [];
    const statusFilter = searchParams.get('status') || 'all';
    const idFilter = searchParams.get('id');

    const [questions, setQuestions] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [isFinished, setIsFinished] = useState(false);
    const [isReviewing, setIsReviewing] = useState(false);

    // Progress State
    const [progress, setProgress] = useState({});

    // Auth
    const { user } = useAuth();
    const [allGenres, setAllGenres] = useState([]);

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);

            // 1. Load Overrides
            const overrides = await getAllOverrides();

            // 2. Load User Progress
            let userProg = {};
            if (user) {
                userProg = await getUserExamProgress(user.uid);
            }

            // 3. Prepare Questions
            let data = [];

            // CHECK FOR RESUME
            const isResume = searchParams.get('resume') === 'true';
            const savedSession = typeof window !== 'undefined' ? localStorage.getItem('radexam_session') : null;

            if (isResume && savedSession) {
                try {
                    const session = JSON.parse(savedSession);
                    // Verify data integrity - fetch questions from the SPECIFIC exam to avoid ID collisions
                    const targetExamId = session.examId || examId;
                    const sourceQs = await getExamData(targetExamId);

                    if (sourceQs.length === 0) {
                        console.warn(`No data found for examId: ${targetExamId}`);
                        data = await getQuestionsByYear(examId, yearFilter);
                    } else {
                        const questionMap = new Map(sourceQs.map(q => [q.id, q]));
                        data = session.questionIds.map(id => questionMap.get(id)).filter(Boolean);

                        if (data.length > 0) {
                            setCurrentIndex(session.currentIndex || 0);
                        } else {
                            data = await getQuestionsByYear(examId, yearFilter);
                        }
                    }
                } catch (e) {
                    console.error("Failed to resume session:", e);
                    data = await getQuestionsByYear(examId, yearFilter);
                }
            } else if (idFilter) {
                const allQs = await getAllQuestions();
                data = allQs.filter(q => q.id.toString() === idFilter);
            } else {
                data = await getQuestionsByYear(examId, yearFilter);

                // Status Filter
                const statuses = statusFilter !== 'all' ? statusFilter.split(',') : [];
                const logic = searchParams.get('logic') || 'or';

                if (statuses.length > 0) {
                    data = data.filter(q => {
                        const globalQid = getGlobalQuestionId(examId, q.id);
                        const isIncorrect = userProg[globalQid]?.status === 'incorrect';
                        const isLiked = userProg[globalQid]?.isLiked === true;

                        const matches = [];
                        if (statuses.includes('incorrect')) matches.push(isIncorrect);
                        if (statuses.includes('liked')) matches.push(isLiked);

                        if (logic === 'and') {
                            return matches.every(m => m);
                        } else {
                            return matches.some(m => m);
                        }
                    });
                }

                const genres = searchParams.get('genres') ? searchParams.get('genres').split(',') : [];
                if (genres.length > 0) {
                    data = data.filter(q => q.genre && genres.includes(q.genre));
                }

                if (isShuffle) {
                    data = [...data].sort(() => Math.random() - 0.5);
                }

                if (countFilter !== 'all') {
                    data = data.slice(0, parseInt(countFilter));
                }
            }

            // Merge Progress & Genres
            const combinedProgress = { ...userProg };
            const uniqueGenres = new Set();

            const addGenre = (g) => {
                if (!g) return;
                if (Array.isArray(g)) {
                    g.forEach(item => addGenre(item));
                } else if (typeof g === 'string') {
                    g.split(/[,、]/).forEach(s => {
                        const trimmed = s.trim();
                        if (trimmed) uniqueGenres.add(trimmed);
                    });
                }
            };

            // Static Genres for CURRENT exam only
            const staticGenres = getGenres(examId);
            staticGenres.forEach(g => addGenre(g));

            // Map user progress 'note' to 'overrideExplanation' for the UI
            Object.keys(combinedProgress).forEach(key => {
                // Only consider progress for the current exam
                if (!key.includes(`_${examId}_`)) return;

                const p = combinedProgress[key];
                if (p.note) {
                    p.overrideExplanation = p.note;
                }
                addGenre(p.overrideGenre);
            });

            // (Optional) Global Overrides Fallback:
            Object.keys(overrides).forEach(globalQid => {
                // Only consider overrides for the current exam
                if (!globalQid.includes(`_${examId}_`)) return;

                const ov = overrides[globalQid];
                const existing = combinedProgress[globalQid] || {};

                combinedProgress[globalQid] = {
                    ...existing,
                    overrideAnswer: existing.overrideAnswer || ov.answer,
                    overrideGenre: existing.overrideGenre || ov.genre,
                    overrideExplanation: existing.note || ov.explanation
                };
                addGenre(ov.genre);
            });

            setAllGenres(Array.from(uniqueGenres).sort());
            setProgress(combinedProgress);
            setQuestions(data);
            setLoading(false);
        };

        loadData();
    }, [examId, yearFilter, countFilter, isShuffle, searchParams, statusFilter, idFilter, user]);

    // Save Session Effect
    useEffect(() => {
        if (questions.length > 0 && !isFinished && !isReviewing) {
            const sessionData = {
                questionIds: questions.map(q => q.id),
                currentIndex: currentIndex,
                timestamp: Date.now(),
                examId
            };
            // console.log("Saving session to localStorage:", sessionData);
            localStorage.setItem('radexam_session', JSON.stringify(sessionData));
        }
    }, [questions, currentIndex, examId, isFinished, isReviewing]);

    const handleUpdateStatus = async (qid, updates) => {
        const globalId = getGlobalQuestionId(examId, qid);

        setProgress(prev => ({
            ...prev,
            [globalId]: { ...prev[globalId], ...updates }
        }));
        if (user) {
            await saveUserProgress(user.uid, globalId, updates);
        }
    };

    const handleSaveOverride = async (qid, overrideData) => {
        const globalId = getGlobalQuestionId(examId, qid);

        // Update local state
        setProgress(prev => ({
            ...prev,
            [globalId]: {
                ...prev[globalId],
                overrideAnswer: overrideData.answer,
                overrideGenre: overrideData.genre,
                overrideExplanation: overrideData.explanation, // UI uses this
                note: overrideData.explanation // DB uses this (for Export compatibility)
            }
        }));

        if (user) {
            // Save as Personal Private Data
            await saveUserProgress(user.uid, globalId, {
                overrideAnswer: overrideData.answer,
                overrideGenre: overrideData.genre,
                note: overrideData.explanation // Mapped to 'note' for consistency/export
            });
        }
    };

    const handleFinish = () => {
        setIsFinished(true);
        setIsReviewing(false);
    };

    const handleHome = () => {
        if (typeof window !== 'undefined') {
            localStorage.removeItem('radexam_session');
        }
        router.push('/');
    };

    const handleEditQuestion = (index) => {
        setCurrentIndex(index);
        setIsReviewing(true);
    };

    const handleBackToResults = () => {
        setIsReviewing(false);
    };

    const currentQuestion = questions[currentIndex];

    if (loading) return <div className={styles.loading}>読み込み中...</div>;

    if (isFinished && !isReviewing) {
        return (
            <QuizResult
                questions={questions}
                userProgress={progress}
                onHome={handleHome}
                onToggleLike={(qid) => {
                    const globalId = getGlobalQuestionId(examId, qid);
                    const isLiked = progress[globalId]?.isLiked;
                    handleUpdateStatus(qid, { isLiked: !isLiked });
                }}
                onEdit={handleEditQuestion}
            />
        );
    }

    if (!currentQuestion) return <div className={styles.error}>条件に一致する問題がありません。</div>;

    return (
        <div className={styles.container}>
            <header className={styles.topBar}>
                {isReviewing ? (
                    <button onClick={handleBackToResults} className={styles.backBtn}>← 結果に戻る</button>
                ) : (
                    <button onClick={() => router.push('/')} className={styles.backBtn}>← 中断</button>
                )}

                <div className={styles.progress}>
                    {currentIndex + 1} 問目 / 全 {questions.length} 問
                </div>
            </header>

            <QuestionCard
                question={currentQuestion}
                userProgress={progress[getGlobalQuestionId(examId, currentQuestion.id)]}
                onAnswer={() => { }}
                onUpdateStatus={handleUpdateStatus}
                onSaveOverride={handleSaveOverride}
                availableGenres={allGenres}
            />

            <div className={styles.navigation}>
                <button
                    onClick={() => setCurrentIndex(p => Math.max(0, p - 1))}
                    disabled={currentIndex === 0}
                    className={styles.navBtn}
                >
                    前の問題
                </button>

                {isReviewing ? (
                    <button
                        onClick={handleBackToResults}
                        className={styles.navBtn}
                        style={{ border: '2px solid #3b82f6', color: '#3b82f6' }}
                    >
                        結果に戻る
                    </button>
                ) : currentIndex === questions.length - 1 ? (
                    <button
                        onClick={handleFinish}
                        className={`${styles.navBtn} ${styles.finishBtn}`}
                        style={{ background: '#ef4444', borderColor: '#ef4444', color: '#fff' }}
                    >
                        終了する
                    </button>
                ) : (
                    <button
                        onClick={() => setCurrentIndex(p => Math.min(questions.length - 1, p + 1))}
                        className={styles.navBtn}
                    >
                        次の問題
                    </button>
                )}
            </div>
        </div>
    );
}

export default function QuizPage() {
    return (
        <Suspense fallback={<div>読み込み中...</div>}>
            <QuizContent />
        </Suspense>
    );
}
