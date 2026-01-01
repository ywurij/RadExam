"use client";

import { useState, useMemo, useEffect } from 'react';
import { getExamTypes, getYears, getGenres } from '@/lib/data';
import styles from './ExamSelector.module.scss';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function ExamSelector() {
    const router = useRouter();
    const { isAdmin, user, userData, logout, migrationDebugMsg } = useAuth();
    const exams = getExamTypes();
    const [selectedExam, setSelectedExam] = useState(exams[0]?.id || 'diagnostic');
    const [userGenres, setUserGenres] = useState({}); // { [examId]: Set(genres) }

    // Filters
    const [selectedYear, setSelectedYear] = useState('all');
    const [selectedGenres, setSelectedGenres] = useState([]);
    const [count, setCount] = useState('all'); // Default to All
    const [statusFilter, setStatusFilter] = useState([]); // Array: ['incorrect', 'liked']
    const [logicFilter, setLogicFilter] = useState('or'); // 'and' | 'or'
    const [isShuffle, setIsShuffle] = useState(false);

    // Derived options based on selected exam
    const years = useMemo(() => getYears(selectedExam), [selectedExam]);
    const genres = useMemo(() => {
        const staticGenres = getGenres(selectedExam);
        const uGenres = userGenres[selectedExam] || new Set();
        // Merge static and user genres
        const combined = new Set(staticGenres);
        uGenres.forEach(g => combined.add(g));
        return Array.from(combined).sort();
    }, [selectedExam, userGenres]);

    const [hasSession, setHasSession] = useState(false);

    // Check for previous session AND Load last settings
    useEffect(() => {
        // 1. Resume Session
        const session = localStorage.getItem('radexam_session');
        if (session) {
            setHasSession(true);
        }

        // 2. Load Last Settings
        const lastSettings = localStorage.getItem('radexam_last_settings');
        if (lastSettings) {
            try {
                const settings = JSON.parse(lastSettings);
                if (settings.examId) setSelectedExam(settings.examId);
                if (settings.year) setSelectedYear(settings.year);
                if (settings.count) setCount(settings.count);
                if (settings.shuffle !== undefined) setIsShuffle(settings.shuffle);
                if (settings.status) setStatusFilter(settings.status);
                if (settings.logic) setLogicFilter(settings.logic);
                if (settings.genres) setSelectedGenres(settings.genres);
            } catch (e) {
                console.error("Failed to load last settings", e);
            }
        }


        // 3. Load User Custom Genres
        // We need to fetch all overrides or iterate progress to find custom genres across ALL questions? 
        // Or just for this exam? Ideally for all or filtered by exam if possible.
        // For simplicity, let's fetch all overrides since they contain the custom genres.
        // Importing getAllOverrides dynamically or using a prop would be better if passed down,
        // but here we can fetch it once on mount if user is logged in.
    }, []);

    // Fetch user genres effect
    useEffect(() => {
        if (!user) return;

        const fetchUserGenres = async () => {
            // We need a way to get ALL user genres. 
            // Option A: Fetch all progress/overrides and extract.
            // Option B: Store unique genres in a separate user field/doc? (Not implemented)
            // Let's go with Option A as it matches our current architecture (client-heavy for now).
            // We'll import getUserExamProgress/getAllOverrides dynamically to avoid server-side issues if any.

            try {
                const { getAllOverrides, getUserExamProgress } = await import('@/lib/db');

                // Temp structure: { examId: Set() }
                const genreMap = {};

                const processGenre = (globalKey, genreVal) => {
                    // Parse Key: test_{examId}_{number}
                    // e.g. test_radiology_2015001
                    const parts = globalKey.split('_');
                    if (parts.length >= 3) {
                        const examId = parts[1]; // 'radiology', 'diagnostic', etc.
                        if (!genreMap[examId]) genreMap[examId] = new Set();

                        const add = (val) => {
                            if (Array.isArray(val)) {
                                val.forEach(g => genreMap[examId].add(g));
                            } else if (typeof val === 'string') {
                                val.split(/[,、\s]+/).forEach(g => g && genreMap[examId].add(g));
                            }
                        };
                        add(genreVal);
                    }
                };

                // Check overrides
                const overrides = await getAllOverrides();
                Object.entries(overrides).forEach(([key, ov]) => {
                    if (ov.genre) {
                        processGenre(key, ov.genre);
                    }
                });

                // Check progress (includes overrides usually)
                // Actually progress merges overrides, so overrides collection is the source of truth for "custom" things usually?
                // Wait, migrateLegacyData writes to `users/{uid}/progress`.
                // So we must check `getUserExamProgress`.
                const progress = await getUserExamProgress(user.uid);
                Object.entries(progress).forEach(([key, p]) => {
                    if (p.overrideGenre) {
                        processGenre(key, p.overrideGenre);
                    }
                });

                setUserGenres(genreMap);
            } catch (e) {
                console.error("Failed to fetch user genres", e);
            }
        };

        fetchUserGenres();
    }, [user]);

    const handleStart = () => {
        // Construct query params
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

        // Clear session when starting NEW exam
        localStorage.removeItem('radexam_session');

        // SAVE Settings
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

    const handleResume = () => {
        const session = localStorage.getItem('radexam_session');
        let query = 'resume=true';
        if (session) {
            try {
                const parsed = JSON.parse(session);
                if (parsed.examId) {
                    query += `&exam=${parsed.examId}`;
                }
            } catch (e) {
                console.error("Error parsing session for resume URL", e);
            }
        }
        router.push(`/quiz?${query}`);
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
            // eslint-disable-next-line
        } // Add lint check fix if needed or just remove unreachable

        setStatusFilter(prev => {
            if (prev.includes(id)) {
                return prev.filter(s => s !== id);
            } else {
                return [...prev, id];
            }
        });
    };

    return (
        <div className={styles.container}>
            <h1 className={styles.title}>RadTest</h1>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                {/* User Info & Logout */}
                {user && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', color: '#718096' }}>
                            <span>ログイン中: <b>{user.email}</b></span>
                            <LogoutButton user={user} logout={logout} />
                        </div>
                        {/* Migration Status Indicator */}
                        {userData && (
                            <div style={{ fontSize: '0.75rem', color: userData.migrationToNextJsAppDone ? '#38a169' : '#e53e3e', marginBottom: '4px' }}>
                                {userData.migrationToNextJsAppDone
                                    ? `✓ データ移行完了 (${new Date(userData.migrationDate?.seconds * 1000).toLocaleDateString()})`
                                    : '⚠ データ移行保留中 (自動実行待ち)'}
                            </div>
                        )}


                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
                    <button onClick={() => router.push('/search')} style={{ background: 'transparent', border: '1px solid #cbd5e0', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer', color: '#4a5568', fontSize: '1rem' }}>
                        🔍 問題を検索
                    </button>
                    {isAdmin && (
                        <button
                            onClick={() => router.push('/admin')}
                            style={{ background: '#2d3748', border: 'none', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer', color: 'white', fontSize: '1rem', fontWeight: 'bold' }}
                        >
                            ⚙️ 管理者メニュー
                        </button>
                    )}
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.label}>試験を選択</h2>
                <div className={styles.examGrid}>
                    {exams.map(exam => (
                        <button
                            key={exam.id}
                            className={`${styles.examCard} ${selectedExam === exam.id ? styles.active : ''}`}
                            onClick={() => setSelectedExam(exam.id)}
                        >
                            <span className={styles.examName}>{exam.name}</span>
                            <span className={styles.examCount}>{exam.count} 問</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.label}>フィルター設定</h2>

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
                            <button
                                className={statusFilter.length === 0 ? styles.activeToggle : ''}
                                onClick={() => toggleStatus('all')}
                            >
                                すべて
                            </button>
                            <button
                                className={statusFilter.includes('incorrect') ? styles.activeToggle : ''}
                                onClick={() => toggleStatus('incorrect')}
                            >
                                不正解のみ
                            </button>
                            <button
                                className={statusFilter.includes('liked') ? styles.activeToggle : ''}
                                onClick={() => toggleStatus('liked')}
                            >
                                お気に入り
                            </button>
                        </div>

                        {statusFilter.length > 1 && (
                            <div className={styles.toggleGroup} style={{ borderLeft: '1px solid #e2e8f0', paddingLeft: '1rem' }}>
                                <small style={{ marginRight: '0.5rem', fontWeight: 600, color: '#4a5568' }}>条件:</small>
                                <button
                                    className={logicFilter === 'or' ? styles.activeToggle : ''}
                                    onClick={() => setLogicFilter('or')}
                                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}
                                >
                                    OR (いずれか)
                                </button>
                                <button
                                    className={logicFilter === 'and' ? styles.activeToggle : ''}
                                    onClick={() => setLogicFilter('and')}
                                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}
                                >
                                    AND (すべて)
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className={styles.filterGroup}>
                    <label>ジャンル</label>
                    <div className={styles.genreTags}>
                        {genres.map(g => (
                            <button
                                key={g}
                                className={`${styles.tag} ${selectedGenres.includes(g) ? styles.tagActive : ''}`}
                                onClick={() => toggleGenre(g)}
                            >
                                {g}
                            </button>
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

            {hasSession && (
                <button
                    onClick={handleResume}
                    style={{
                        display: 'block',
                        width: '100%',
                        padding: '1rem',
                        marginBottom: '1rem',
                        background: '#fff',
                        border: '2px solid #3b82f6',
                        color: '#3b82f6',
                        fontSize: '1.25rem',
                        fontWeight: '700',
                        borderRadius: '0.75rem',
                        cursor: 'pointer'
                    }}
                >
                    前回の続きから再開
                </button>
            )}

            <button className={styles.startButton} onClick={handleStart}>
                演習開始
            </button>
        </div>
    );
}

function LogoutButton({ logout }) {
    const [confirming, setConfirming] = useState(false);
    const router = useRouter();

    const handleLogout = async () => {
        if (!confirming) {
            setConfirming(true);
            // Auto reset after 3 seconds
            setTimeout(() => setConfirming(false), 3000);
            return;
        }

        try {
            await logout();
        } catch (e) {
            console.error("Logout failed", e);
            router.replace('/login');
        }
    };

    return (
        <button
            onClick={handleLogout}
            style={{
                background: confirming ? '#fed7d7' : 'none',
                border: confirming ? '1px solid #e53e3e' : 'none',
                borderRadius: confirming ? '4px' : '0',
                padding: confirming ? '2px 6px' : '0',
                color: '#e53e3e',
                cursor: 'pointer',
                textDecoration: confirming ? 'none' : 'underline',
                fontSize: '0.9rem',
                transition: 'all 0.2s'
            }}
        >
            {confirming ? '本当にログアウト？' : 'ログアウト'}
        </button>
    );
}
