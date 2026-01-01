"use client";

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getExamData, getAllQuestions, getQuestionsByYear, getGlobalQuestionId } from '@/lib/data';
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
                    const sourceQs = getExamData(targetExamId);

                    if (sourceQs.length === 0) {
                        console.warn(`No data found for examId: ${targetExamId}`);
                        data = getQuestionsByYear(examId, yearFilter);
                    } else {
                        const questionMap = new Map(sourceQs.map(q => [q.id, q]));
                        data = session.questionIds.map(id => questionMap.get(id)).filter(Boolean);

                        if (data.length > 0) {
                            setCurrentIndex(session.currentIndex || 0);
                        } else {
                            data = getQuestionsByYear(examId, yearFilter);
                        }
                    }
                } catch (e) {
                    console.error("Failed to resume session:", e);
                    data = getQuestionsByYear(examId, yearFilter);
                }
            } else if (idFilter) {
                const allQs = getAllQuestions();
                data = allQs.filter(q => q.id.toString() === idFilter);
            } else {
                data = getQuestionsByYear(examId, yearFilter);

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
            getAllQuestions().forEach(q => {
                if (q.genre) uniqueGenres.add(q.genre);
            });

            Object.keys(overrides).forEach(globalQid => { // overrides use global keys?
                // Actually overrides might need global keys too?
                // Let's assume overrides collection keys are also global ID for consistency.
                const ov = overrides[globalQid];
                combinedProgress[globalQid] = {
                    ...(combinedProgress[globalQid] || {}),
                    overrideAnswer: ov.answer,
                    overrideGenre: ov.genre,
                    overrideExplanation: ov.explanation
                };
                if (ov.genre) uniqueGenres.add(ov.genre);
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

        // Update local state (keyed by globalId now?)
        // Wait, progress state comes from DB (global keys).
        // BUT overrides are loaded from DB (questionId keys?).
        // Let's ensure consistency. getUserExamProgress returns global keys.

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
        setProgress(prev => ({
            ...prev,
            [globalId]: {
                ...prev[globalId],
                overrideAnswer: overrideData.answer,
                overrideGenre: overrideData.genre,
                overrideExplanation: overrideData.explanation
            }
        }));
        await saveQuestionOverride(globalId, {
            answer: overrideData.answer,
            genre: overrideData.genre,
            explanation: overrideData.explanation,
        });
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
