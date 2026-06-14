"use client";

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getExamData, getAllQuestions, getQuestionsByYear, getGlobalQuestionId, getGenres } from '@/lib/data';
import QuestionCard from '@/components/QuestionCard';
import styles from './quiz.module.scss';
import { saveLocalProgress, getLocalProgress, getAllLocalOverrides } from '@/lib/localDb';
import QuizResult from '@/components/QuizResult';

const generateUUID = () => {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
    }
    return 'sec-' + Math.random().toString(36).substring(2, 15) + '-' + Date.now();
};

function QuizContent() {
    const searchParams = useSearchParams();
    const router = useRouter();

    // Params
    const examId = searchParams.get('exam') || 'diagnostic';
    const yearFilter = searchParams.get('year') || 'all';
    const countFilter = searchParams.get('count') || '10';
    const isShuffle = searchParams.get('shuffle') === 'true';
    const genreFilter = useMemo(() => {
        return searchParams.get('genres') ? searchParams.get('genres').split(',') : [];
    }, [searchParams]);
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
    const user = null; // ローカル完結型のためログイン不要
    const [allGenres, setAllGenres] = useState([]);
    const [sessionId, setSessionId] = useState(null);

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);

            // 1. Load Overrides (Local)
            const overrides = await getAllLocalOverrides();

            // 2. Load User Progress (Local)
            let userProg = {};
            try {
                userProg = await getLocalProgress();
            } catch (e) {
                console.error("Failed to load local progress:", e);
            }

            // 3. Prepare Questions
            let data = [];

            // CHECK FOR RESUME (Local only)
            const isResume = searchParams.get('resume') === 'true';
            const resumeSessionId = searchParams.get('sessionId');
            const sessionsKey = 'radexam_sessions';

            // Load local session
            let session = null;
            if (isResume && resumeSessionId && typeof window !== 'undefined') {
                const raw = localStorage.getItem(sessionsKey);
                if (raw) {
                    try {
                        const localSessions = JSON.parse(raw);
                        if (Array.isArray(localSessions)) {
                            session = localSessions.find(s => s.id === resumeSessionId) || null;
                        }
                    } catch (e) { console.error("Invalid local sessions data", e); }
                }
            }

            if (isResume && session) {
                setSessionId(session.id);
                try {
                    // Verify data integrity - fetch questions from the SPECIFIC exam to avoid ID collisions
                    const targetExamId = session.examId || examId;

                    // If URL exam param doesn't match the resumed session's examId, redirect to correct URL
                    if (searchParams.get('exam') !== targetExamId) {
                        const params = new URLSearchParams(searchParams.toString());
                        params.set('exam', targetExamId);
                        router.replace(`/quiz?${params.toString()}`);
                        return;
                    }

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
            } else {
                // 新規セッション開始
                const newId = generateUUID();
                setSessionId(newId);

                if (idFilter) {
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

                    // フィルターの結果問題数が0件になった場合のフォールバック（全問題を表示）
                    if (data.length === 0) {
                        console.warn("Filtered questions count is 0. Falling back to all questions.");
                        const fallbackData = await getQuestionsByYear(examId, 'all');
                        data = isShuffle 
                            ? [...fallbackData].sort(() => Math.random() - 0.5) 
                            : fallbackData;
                        if (countFilter !== 'all') {
                            data = data.slice(0, parseInt(countFilter));
                        }
                    }
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
    }, [examId, yearFilter, countFilter, isShuffle, searchParams, statusFilter, idFilter, user, router]);

    // Save Session Effect
    useEffect(() => {
        if (questions.length > 0 && !isFinished && !isReviewing && sessionId) {
            const sessionData = {
                id: sessionId,
                questionIds: questions.map(q => q.id),
                currentIndex: currentIndex,
                timestamp: Date.now(),
                examId,
                yearFilter,
                countFilter,
                statusFilter: searchParams.get('status') ? searchParams.get('status').split(',') : [],
                genreFilter,
                isShuffle,
                userId: user?.uid
            };

            const sessionsKey = 'radexam_sessions';
            let localSessions = [];
            if (typeof window !== 'undefined') {
                const raw = localStorage.getItem(sessionsKey);
                if (raw) {
                    try {
                        localSessions = JSON.parse(raw);
                        if (!Array.isArray(localSessions)) localSessions = [];
                    } catch(e) {
                        localSessions = [];
                    }
                }
                
                const idx = localSessions.findIndex(s => s.id === sessionId);
                if (idx !== -1) {
                    localSessions[idx] = sessionData;
                } else {
                    localSessions.unshift(sessionData);
                }
                
                localStorage.setItem(sessionsKey, JSON.stringify(localSessions));
            }
        }
    }, [questions, currentIndex, examId, isFinished, isReviewing, user, sessionId, yearFilter, countFilter, genreFilter, isShuffle, searchParams]);

    const handleUpdateStatus = async (qid, updates) => {
        const globalId = getGlobalQuestionId(examId, qid);

        setProgress(prev => ({
            ...prev,
            [globalId]: { ...prev[globalId], ...updates }
        }));
        await saveLocalProgress(globalId, updates);
    };

    const handleSaveOverride = async (qid, overrideData) => {
        const globalId = getGlobalQuestionId(examId, qid);

        // Update local state
        setProgress(prev => {
            const current = prev[globalId] || {};
            return {
                ...prev,
                [globalId]: {
                    ...current,
                    overrideAnswer: overrideData.answer !== undefined ? overrideData.answer : current.overrideAnswer,
                    overrideGenre: overrideData.genre !== undefined ? overrideData.genre : current.overrideGenre,
                    overrideExplanation: overrideData.explanation !== undefined ? overrideData.explanation : current.overrideExplanation,
                    note: overrideData.explanation !== undefined ? overrideData.explanation : current.note,
                    overrideQuestion: overrideData.question !== undefined ? overrideData.question : current.overrideQuestion,
                    overrideOptions: overrideData.options !== undefined ? overrideData.options : current.overrideOptions,
                    overrideImages: overrideData.images !== undefined ? overrideData.images : current.overrideImages,
                }
            };
        });

        // Dynamically update available genres if new one is added
        if (overrideData.genre) {
            const newGenres = new Set(allGenres);
            const process = (val) => {
                if (Array.isArray(val)) {
                    val.forEach(g => newGenres.add(g));
                } else if (typeof val === 'string') {
                    val.split(/[,、\s]+/).forEach(g => g && newGenres.add(g.trim()));
                }
            };
            process(overrideData.genre);

            if (newGenres.size > allGenres.length) {
                setAllGenres(Array.from(newGenres).sort());
            }
        }

        // Save as Personal Private Data (Local)
        const saveObj = {};
        if (overrideData.answer !== undefined) saveObj.overrideAnswer = overrideData.answer;
        if (overrideData.genre !== undefined) saveObj.overrideGenre = overrideData.genre;
        if (overrideData.explanation !== undefined) {
            saveObj.overrideExplanation = overrideData.explanation;
            saveObj.note = overrideData.explanation;
        }
        if (overrideData.question !== undefined) saveObj.overrideQuestion = overrideData.question;
        if (overrideData.options !== undefined) saveObj.overrideOptions = overrideData.options;
        if (overrideData.images !== undefined) saveObj.overrideImages = overrideData.images;

        await saveLocalProgress(globalId, saveObj);
    };

    const handleFinish = async () => {
        setIsFinished(true);
        setIsReviewing(false);
        
        if (typeof window !== 'undefined' && sessionId) {
            const sessionsKey = 'radexam_sessions';
            const raw = localStorage.getItem(sessionsKey);
            if (raw) {
                try {
                    const localSessions = JSON.parse(raw);
                    if (Array.isArray(localSessions)) {
                        const updated = localSessions.filter(s => s.id !== sessionId);
                        localStorage.setItem(sessionsKey, JSON.stringify(updated));
                    }
                } catch (e) {
                    console.error("Failed to remove local session on finish", e);
                }
            }
        }
    };

    const handleHome = async () => {
        if (typeof window !== 'undefined' && sessionId) {
            const sessionsKey = 'radexam_sessions';
            const raw = localStorage.getItem(sessionsKey);
            if (raw) {
                try {
                    const localSessions = JSON.parse(raw);
                    if (Array.isArray(localSessions)) {
                        const updated = localSessions.filter(s => s.id !== sessionId);
                        localStorage.setItem(sessionsKey, JSON.stringify(updated));
                    }
                } catch (e) {
                    console.error("Failed to remove local session on home", e);
                }
            }
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
