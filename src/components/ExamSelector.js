"use client";

import { useState, useMemo, useEffect } from 'react';
import { getExamTypes, getYears, getGenres, initializeLocalExams } from '@/lib/data';
import styles from './ExamSelector.module.scss';
import { useRouter } from 'next/navigation';

export default function ExamSelector() {
    const router = useRouter();

    const [exams, setExams] = useState([]);
    const [selectedExam, setSelectedExam] = useState('');
 
     // Filters
     const [selectedYear, setSelectedYear] = useState('all');
     const [selectedGenres, setSelectedGenres] = useState([]);
     const [count, setCount] = useState('all');
     const [statusFilter, setStatusFilter] = useState([]);
     const [logicFilter, setLogicFilter] = useState('or');
     const [isShuffle, setIsShuffle] = useState(false);
 
     // Derived options based on selected exam
     const years = useMemo(() => getYears(selectedExam), [selectedExam]);
     const genres = useMemo(() => getGenres(selectedExam), [selectedExam]);
 
     const [sessions, setSessions] = useState([]);

    const isYearValidForExam = (examId, yearValue) => {
        if (!examId || yearValue === 'all' || yearValue === 'last3' || yearValue === 'last5') {
            return true;
        }
        const availableYears = getYears(examId);
        const numericYear = parseInt(yearValue, 10);
        return availableYears.includes(numericYear) || availableYears.includes(yearValue.toString());
    };

    const applyExamSelection = (examId, nextSelectedYear = selectedYear, nextSelectedGenres = selectedGenres) => {
        setSelectedExam(examId);

        if (!isYearValidForExam(examId, nextSelectedYear)) {
            setSelectedYear('all');
        } else if (nextSelectedYear !== selectedYear) {
            setSelectedYear(nextSelectedYear);
        }

        const availableGenres = getGenres(examId);
        const sanitizedGenres = nextSelectedGenres.filter((genre) => availableGenres.includes(genre));
        if (sanitizedGenres.length !== selectedGenres.length || sanitizedGenres.some((genre, index) => genre !== selectedGenres[index])) {
            setSelectedGenres(sanitizedGenres);
        } else if (nextSelectedGenres !== selectedGenres) {
            setSelectedGenres(nextSelectedGenres);
        }
    };

    useEffect(() => {
        const init = async () => {
            // ローカルのカスタム試験キャッシュを初期化
            await initializeLocalExams();
            const types = getExamTypes();
            setExams(types);

            const sessionsKey = 'radexam_sessions';
            const oldSessionKey = 'radexam_session';
            
            let localSessions = [];

            // 1. 旧セッションキーからの移行処理
            if (typeof window !== 'undefined') {
                const oldSession = localStorage.getItem(oldSessionKey);
                if (oldSession) {
                    try {
                        const parsed = JSON.parse(oldSession);
                        if (parsed) {
                            if (!parsed.id) {
                                parsed.id = parsed.timestamp ? `migrated-${parsed.timestamp}` : `migrated-${Date.now()}`;
                            }
                            if (!parsed.name) {
                                parsed.name = `移行されたセッション`;
                            }
                            localSessions.push(parsed);
                        }
                    } catch (e) {
                        console.error("Invalid old session data", e);
                    }
                    localStorage.removeItem(oldSessionKey);
                    localStorage.setItem(sessionsKey, JSON.stringify(localSessions));
                } else {
                    const raw = localStorage.getItem(sessionsKey);
                    if (raw) {
                        try {
                            localSessions = JSON.parse(raw);
                            if (!Array.isArray(localSessions)) {
                                localSessions = [];
                            }
                        } catch (e) {
                            console.error("Invalid sessions data", e);
                            localSessions = [];
                        }
                    }
                }
            }

            setSessions(localSessions);

            // 前回設定のロード
            const lastSettings = localStorage.getItem('radexam_last_settings');
            if (lastSettings) {
                try {
                    const settings = JSON.parse(lastSettings);
                    const initialExamId = settings.examId || types[0]?.id || '';
                    const initialYear = settings.year || 'all';
                    const initialGenres = Array.isArray(settings.genres) ? settings.genres : [];

                    if (initialExamId) {
                        setSelectedExam(initialExamId);
                        setSelectedYear(isYearValidForExam(initialExamId, initialYear) ? initialYear : 'all');
                        setSelectedGenres(initialGenres.filter((genre) => getGenres(initialExamId).includes(genre)));
                    }
                    if (settings.count) setCount(settings.count);
                    if (settings.shuffle !== undefined) setIsShuffle(settings.shuffle);
                    if (settings.status) setStatusFilter(settings.status);
                    if (settings.logic) setLogicFilter(settings.logic);
                } catch (e) {
                    console.error("Failed to load last settings", e);
                    if (types[0]?.id) {
                        setSelectedExam(types[0].id);
                        setSelectedYear('all');
                        setSelectedGenres([]);
                    }
                }
            } else if (types[0]?.id) {
                setSelectedExam(types[0].id);
                setSelectedYear('all');
                setSelectedGenres([]);
            }
        };

        init();
    }, []);
    const handleStart = () => {
        const params = new URLSearchParams();
        params.set('exam', selectedExam);
        params.set('year', selectedYear);
        params.set('count', count.toString());
        params.set('shuffle', isShuffle.toString());

        if (statusFilter.length > 0) {
            params.set('status', statusFilter.join(','));
            if (statusFilter.length > 1) {
                params.set('logic', logicFilter);
            }
        } else {
            params.set('status', 'all');
        }

        if (selectedGenres.length > 0) {
            params.set('genres', selectedGenres.join(','));
        }

        const settingsToSave = {
            examId: selectedExam,
            year: selectedYear,
            count: count,
            shuffle: isShuffle,
            status: statusFilter,
            logic: logicFilter,
            genres: selectedGenres
        };
        localStorage.setItem('radexam_last_settings', JSON.stringify(settingsToSave));

        router.push(`/quiz?${params.toString()}`);
    };

    const handleResumeSession = (session) => {
        router.push(`/quiz?resume=true&sessionId=${session.id}&exam=${session.examId}`);
    };

    const handleDeleteSession = async (e, session) => {
        e.stopPropagation();
        
        const examName = exams.find(ex => ex.id === session.examId)?.name || session.examId;
        const dateStr = session.timestamp ? new Date(session.timestamp).toLocaleString() : '不明';
        
        if (!confirm(`中断した演習「${examName} (${dateStr})」を削除しますか？`)) {
            return;
        }
        
        const sessionsKey = 'radexam_sessions';
        const updated = sessions.filter(s => s.id !== session.id);
        setSessions(updated);
        localStorage.setItem(sessionsKey, JSON.stringify(updated));
    };

    const toggleGenre = (genre) => {
        if (selectedGenres.includes(genre)) {
            setSelectedGenres(prev => prev.filter(g => g !== genre));
        } else {
            setSelectedGenres(prev => [...prev, genre]);
        }
    };

    const toggleStatus = (id) => {
        if (id === 'all') {
            setStatusFilter([]);
            return;
        }
        setStatusFilter(prev => {
            if (prev.includes(id)) return prev.filter(s => s !== id);
            else return [...prev, id];
        });
    };



    return (
        <div className={styles.container}>
            <h1 className={styles.title}>RadExam</h1>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <button onClick={() => router.push('/search')} style={{ background: 'transparent', border: '1px solid #cbd5e0', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer', color: '#4a5568', fontSize: '1rem' }}>
                        🔍 問題を検索
                    </button>

                    <button
                        onClick={() => router.push('/usage')}
                        style={{
                            background: '#4a5568',
                            border: 'none',
                            padding: '0.5rem 1rem',
                            borderRadius: '0.5rem',
                            cursor: 'pointer',
                            color: 'white',
                            fontSize: '1rem',
                            fontWeight: 'bold',
                            marginRight: '0.5rem'
                        }}
                    >
                        ❓ 使い方
                    </button>
                    <button
                        onClick={() => router.push('/admin')}
                        style={{ background: '#2d3748', border: 'none', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer', color: 'white', fontSize: '1rem', fontWeight: 'bold' }}
                    >
                        ⚙️ 試験管理
                    </button>
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.label}>試験を選択</h2>
                <div className={styles.examGrid}>
                    {exams.map(exam => (
                        <button
                            key={exam.id}
                            className={`${styles.examCard} ${selectedExam === exam.id ? styles.active : ''}`}
                            onClick={() => applyExamSelection(exam.id)}
                        >
                            <span className={styles.examName}>{exam.name}</span>
                            <span className={styles.examCount}>{exam.count} 問</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.label}>フィルター設定</h2>

                {/* ... (Existing Filters) ... */}
                <div className={styles.filterRow}>
                    <div className={styles.filterGroup}>
                        <label>年度</label>
                        <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)}>
                            <option value="all">全年度</option>
                            <option value="last3">直近3年分</option>
                            <option value="last5">直近5年分</option>
                            {years.length > 0 && <option disabled>──────────</option>}
                            {years.map(y => <option key={y} value={y}>{y}年</option>)}
                        </select>
                    </div>

                    <div className={styles.filterGroup}>
                        <label>出題数</label>
                        <select value={count} onChange={(e) => setCount(e.target.value)}>
                            <option value="all">すべて</option>
                            <option value="10">10問</option>
                            <option value="20">20問</option>
                            <option value="30">30問</option>
                            <option value="50">50問</option>
                            <option value="100">100問</option>
                        </select>
                    </div>
                </div>

                <div className={styles.filterGroup}>
                    <label>ステータス</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                        <div className={styles.toggleGroup}>
                            <button className={statusFilter.length === 0 ? styles.activeToggle : ''} onClick={() => toggleStatus('all')}>すべて</button>
                            <button className={statusFilter.includes('incorrect') ? styles.activeToggle : ''} onClick={() => toggleStatus('incorrect')}>不正解のみ</button>
                            <button className={statusFilter.includes('liked') ? styles.activeToggle : ''} onClick={() => toggleStatus('liked')}>お気に入り</button>
                        </div>
                        {statusFilter.length > 1 && (
                            <div className={styles.toggleGroup} style={{ borderLeft: '1px solid #e2e8f0', paddingLeft: '1rem' }}>
                                <small style={{ marginRight: '0.5rem', fontWeight: 600, color: '#4a5568' }}>条件:</small>
                                <button className={logicFilter === 'or' ? styles.activeToggle : ''} onClick={() => setLogicFilter('or')} style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}>OR (いずれか)</button>
                                <button className={logicFilter === 'and' ? styles.activeToggle : ''} onClick={() => setLogicFilter('and')} style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}>AND (すべて)</button>
                            </div>
                        )}
                    </div>
                </div>

                <div className={styles.filterGroup}>
                    <label>ジャンル</label>
                    <div className={styles.genreTags}>
                        {genres.map(g => (
                            <button key={g} className={`${styles.tag} ${selectedGenres.includes(g) ? styles.tagActive : ''}`} onClick={() => toggleGenre(g)}>{g}</button>
                        ))}
                    </div>
                </div>

                <div className={styles.checkboxGroup}>
                    <label>
                        <input type="checkbox" checked={isShuffle} onChange={(e) => setIsShuffle(e.target.checked)} />
                        ランダム出題
                    </label>
                </div>
            </div>

            {sessions.length > 0 && (
                <div className={styles.resumeSection}>
                    <h2 className={styles.label}>中断した演習から再開</h2>
                    <div className={styles.resumeGrid}>
                        {sessions.map(session => {
                            const examName = exams.find(e => e.id === session.examId)?.name || session.examId;
                            const progressPercent = session.questionIds && session.questionIds.length > 0
                                ? Math.round(((session.currentIndex || 0) / session.questionIds.length) * 100)
                                : 0;
                            const solvedCount = session.currentIndex || 0;
                            const totalCount = session.questionIds ? session.questionIds.length : 0;
                            const displayDate = session.timestamp ? new Date(session.timestamp).toLocaleString() : '不明';
                            
                            // フィルター情報のタグを作成
                            const details = [];
                            if (session.yearFilter && session.yearFilter !== 'all') {
                                details.push(`${session.yearFilter === 'last3' ? '直近3年' : session.yearFilter === 'last5' ? '直近5年' : `${session.yearFilter}年`}`);
                            }
                            if (session.countFilter && session.countFilter !== 'all') {
                                details.push(`${session.countFilter}問`);
                            }
                            if (session.statusFilter && session.statusFilter.length > 0) {
                                details.push(session.statusFilter.map(s => s === 'incorrect' ? '不正解' : s === 'liked' ? 'お気に入り' : s).join('+'));
                            }
                            if (session.genreFilter && session.genreFilter.length > 0) {
                                details.push(`ジャンル:${session.genreFilter.length}件`);
                            }
                            if (session.isShuffle) {
                                details.push('ランダム');
                            }

                            return (
                                <div key={session.id} className={styles.resumeCard}>
                                    <div className={styles.resumeCardInfo}>
                                        <div className={styles.resumeExamName}>{examName}</div>
                                        {details.length > 0 && (
                                            <div className={styles.resumeDetails}>
                                                {details.map((d, i) => <span key={i}>{d}</span>)}
                                            </div>
                                        )}
                                        <div className={styles.resumeDate}>中断日時: {displayDate}</div>
                                        <div className={styles.resumeProgress}>
                                            進捗: {solvedCount} / {totalCount} 問 ({progressPercent}%)
                                        </div>
                                        <div className={styles.resumeBar}>
                                            <div className={styles.resumeBarFill} style={{ width: `${progressPercent}%` }} />
                                        </div>
                                    </div>
                                    <div className={styles.resumeCardActions}>
                                        <button className={styles.resumeBtn} onClick={() => handleResumeSession(session)}>
                                            再開する
                                        </button>
                                        <button className={styles.deleteBtn} onClick={(e) => handleDeleteSession(e, session)}>
                                            削除
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <button className={styles.startButton} onClick={handleStart}>
                演習開始
            </button>
        </div>
    );
}
