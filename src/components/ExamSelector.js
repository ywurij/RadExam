"use client";

import { useState, useMemo, useEffect } from 'react';
import { getExamTypes, getYears, getGenres, initializeLocalExams } from '@/lib/data';
import styles from './ExamSelector.module.scss';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { 
    getLocalProgress, 
    getAllLocalOverrides
} from '@/lib/localDb';

export default function ExamSelector() {
    const router = useRouter();
    const { logout } = useAuth(); // Auth is bypassed, but we keep logout hook for legacy clean UI
    
    // Auth bypass: 誰でも管理画面にアクセスできるように管理者フラグを真にする
    const isAdmin = true;
    const user = null; // ローカル完結型なのでログイン不要
    const userData = null;

    const [exams, setExams] = useState([]);
    const [selectedExam, setSelectedExam] = useState('');
    const [userGenres, setUserGenres] = useState({});
 
     // Filters
     const [selectedYear, setSelectedYear] = useState('all');
     const [selectedGenres, setSelectedGenres] = useState([]);
     const [count, setCount] = useState('all');
     const [statusFilter, setStatusFilter] = useState([]);
     const [logicFilter, setLogicFilter] = useState('or');
     const [isShuffle, setIsShuffle] = useState(false);
 
     // Offline Download State
     const [downloadingExamId, setDownloadingExamId] = useState(null);
     const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
 
     // Derived options based on selected exam
     const years = useMemo(() => getYears(selectedExam), [selectedExam]);
     const genres = useMemo(() => {
         const staticGenres = getGenres(selectedExam);
         const uGenres = userGenres[selectedExam] || new Set();
         const combined = new Set(staticGenres);
         uGenres.forEach(g => combined.add(g));
         return Array.from(combined).sort();
     }, [selectedExam, userGenres]);
 
     const [sessions, setSessions] = useState([]);

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
                    if (settings.examId) {
                        setSelectedExam(settings.examId);
                    } else if (types[0]?.id) {
                        setSelectedExam(types[0].id);
                    }
                    if (settings.year) setSelectedYear(settings.year);
                    if (settings.count) setCount(settings.count);
                    if (settings.shuffle !== undefined) setIsShuffle(settings.shuffle);
                    if (settings.status) setStatusFilter(settings.status);
                    if (settings.logic) setLogicFilter(settings.logic);
                    if (settings.genres) setSelectedGenres(settings.genres);
                } catch (e) {
                    console.error("Failed to load last settings", e);
                    if (types[0]?.id) setSelectedExam(types[0].id);
                }
            } else if (types[0]?.id) {
                setSelectedExam(types[0].id);
            }
        };

        init();
    }, []);

    // Fetch user genres effect (Local IndexedDB)
    useEffect(() => {
        const fetchUserGenres = async () => {
            try {
                const genreMap = {};
                const processGenre = (globalKey, genreVal) => {
                    const parts = globalKey.split('_');
                    if (parts.length >= 3) {
                        const examId = parts[1];
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

                const overrides = await getAllLocalOverrides();
                Object.entries(overrides).forEach(([key, ov]) => {
                    if (ov.genre) processGenre(key, ov.genre);
                });

                const progress = await getLocalProgress();
                Object.entries(progress).forEach(([key, p]) => {
                    if (p.overrideGenre) processGenre(key, p.overrideGenre);
                });

                setUserGenres(genreMap);
            } catch (e) {
                console.error("Failed to fetch user genres", e);
            }
        };
        if (exams.length > 0) {
            fetchUserGenres();
        }
    }, [exams]);

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

    const handleDownloadOffline = async (e, examId, isAuto = false) => {
        if (e) e.stopPropagation();
        if (downloadingExamId) return;

        // Check if Cache API is supported (requires HTTPS or localhost)
        if (typeof window === 'undefined' || !('caches' in window)) {
            if (!isAuto) {
                alert("お使いの環境（非HTTPS接続など）では、オフライン用の画像ダウンロード機能はご利用いただけません。");
            } else {
                console.warn("[AutoDL] Cache API is not supported in this context (requires HTTPS or localhost). Skipping auto-download.");
            }
            return;
        }

        // Manual mode: Confirm
        if (!isAuto) {
            if (!confirm(`${examId} の全画像をダウンロードしますか？\n(Wi-Fi環境推奨)`)) return;
        }

        // We don't set downloading state yet for Auto, until we know we need to.
        // But to avoid race conditions, let's set a temp state or just proceed carefully.
        // Actually, fetching manifest is fast. Let's do it before setting state if possible, 
        // OR set state and clear it quickly if skipped.
        // Better: Set state to block duplicates.
        setDownloadingExamId(examId);

        try {
            const res = await fetch('/data/image-manifest.json');
            if (!res.ok) throw new Error("Manifest not found");
            const manifest = await res.json();
            const images = manifest[examId] || [];

            if (images.length === 0) {
                if (!isAuto) alert("ダウンロード対象の画像がありません。");
                setDownloadingExamId(null);
                return;
            }

            // Generate content hash (Simple stringify is sufficient for list of URLs)
            const currentHash = JSON.stringify(images);
            const savedHash = localStorage.getItem(`radexam_img_hash_${examId}`);

            if (isAuto && savedHash === currentHash) {
                // Content unchanged, skip download
                console.log(`[AutoDL] ${examId}: Images up to date, skipping.`);
                setDownloadingExamId(null);
                return;
            }

            // Proceed with download
            setDownloadProgress({ current: 0, total: images.length });

            const cache = await caches.open('question-images');
            const BATCH_SIZE = 10;

            for (let i = 0; i < images.length; i += BATCH_SIZE) {
                const batch = images.slice(i, i + BATCH_SIZE);
                await Promise.all(batch.map(async (url) => {
                    try {
                        await cache.add(url);
                    } catch (err) {
                        console.warn(`Failed to cache ${url}`, err);
                    }
                }));
                setDownloadProgress(prev => ({ ...prev, current: Math.min(prev.current + BATCH_SIZE, images.length) }));
            }

            if (!isAuto) alert("ダウンロードが完了しました。");

            // Save new hash
            localStorage.setItem(`radexam_img_hash_${examId}`, currentHash);
            // Also keep timestamp just in case/debug
            localStorage.setItem(`radexam_dl_${examId}`, Date.now().toString());

        } catch (e) {
            console.error(e);
            if (!isAuto) alert("ダウンロードに失敗しました: " + e.message);
        } finally {
            setDownloadingExamId(null);
        }
    };

    // Auto-download Trigger
    useEffect(() => {
        if (selectedExam) {
            // Wait 1s to allow UI to settle and avoid conflict with initial mount
            const timer = setTimeout(() => {
                handleDownloadOffline(null, selectedExam, true);
            }, 1000);
            return () => clearTimeout(timer);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedExam]);

    // 試験変更時のフィルター整合性チェックと自動リセット
    useEffect(() => {
        if (!selectedExam) return;

        // 1. 年度フィルターの整合性チェック
        const availableYears = getYears(selectedExam);
        if (selectedYear !== 'all' && selectedYear !== 'last3' && selectedYear !== 'last5') {
            const numYear = parseInt(selectedYear);
            const strYear = selectedYear.toString();
            // 数値・文字列両方で存在チェック
            if (!availableYears.includes(numYear) && !availableYears.includes(strYear)) {
                setSelectedYear('all');
            }
        }

        // 2. ジャンルフィルターの整合性チェック
        const availableGenres = getGenres(selectedExam);
        setSelectedGenres(prev => prev.filter(g => availableGenres.includes(g)));
    }, [selectedExam, exams]);

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
                    {isAdmin && (
                        <button
                            onClick={() => router.push('/admin')}
                            style={{ background: '#2d3748', border: 'none', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer', color: 'white', fontSize: '1rem', fontWeight: 'bold' }}
                        >
                            ⚙️ 試験管理
                        </button>
                    )}
                </div>
            </div>

            <div className={styles.section}>
                <h2 className={styles.label}>試験を選択</h2>
                <div className={styles.examGrid}>
                    {exams.map(exam => (
                        <div key={exam.id} style={{ position: 'relative' }}>
                            <button
                                className={`${styles.examCard} ${selectedExam === exam.id ? styles.active : ''}`}
                                onClick={() => setSelectedExam(exam.id)}
                                style={{ width: '100%', paddingRight: '2.5rem' }}
                            >
                                <span className={styles.examName}>{exam.name}</span>
                                <span className={styles.examCount}>{exam.count} 問</span>
                            </button>
                            {/* Download Button */}
                            {!exam.isLocal && (
                                <button
                                    onClick={(e) => handleDownloadOffline(e, exam.id)}
                                    disabled={!!downloadingExamId}
                                    title="オフライン用に画像をダウンロード"
                                    style={{
                                        position: 'absolute',
                                        right: '10px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontSize: '1.2rem',
                                        opacity: 0.6,
                                        transition: 'opacity 0.2s',
                                        zIndex: 10
                                    }}
                                    onMouseEnter={e => e.target.style.opacity = 1}
                                    onMouseLeave={e => e.target.style.opacity = 0.6}
                                >
                                    {downloadingExamId === exam.id ? '⏳' : '📥'}
                                </button>
                            )}
                        </div>
                    ))}
                </div>
                {/* Progress Bar */}
                {downloadingExamId && (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#4a5568', textAlign: 'center' }}>
                        ダウンロード中: {downloadProgress.current} / {downloadProgress.total} 枚完了 (画面を閉じないでください)
                        <div style={{ width: '100%', height: '4px', background: '#e2e8f0', borderRadius: '2px', marginTop: '4px', overflow: 'hidden' }}>
                            <div style={{
                                width: `${(downloadProgress.current / downloadProgress.total) * 100}%`,
                                height: '100%',
                                background: '#3182ce',
                                transition: 'width 0.3s'
                            }} />
                        </div>
                    </div>
                )}
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

function LogoutButton({ logout }) {
    const [confirming, setConfirming] = useState(false);
    const router = useRouter();

    const handleLogout = async () => {
        if (!confirming) {
            setConfirming(true);
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
