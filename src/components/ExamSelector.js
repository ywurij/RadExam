"use client";

import { useState, useMemo, useEffect } from 'react';
import { getExamTypes, getYears, getGenres } from '@/lib/data';
import { getLatestAnnouncementId } from '@/lib/announcementsData';
import styles from './ExamSelector.module.scss';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function ExamSelector() {
    const router = useRouter();
    const { isAdmin, user, userData, logout, migrationDebugMsg } = useAuth();
    const exams = getExamTypes();
    const [selectedExam, setSelectedExam] = useState(exams[0]?.id || 'diagnostic');
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
    const [hasUnreadAnnouncements, setHasUnreadAnnouncements] = useState(false);

    // Derived options based on selected exam
    const years = useMemo(() => getYears(selectedExam), [selectedExam]);
    const genres = useMemo(() => {
        const staticGenres = getGenres(selectedExam);
        const uGenres = userGenres[selectedExam] || new Set();
        const combined = new Set(staticGenres);
        uGenres.forEach(g => combined.add(g));
        return Array.from(combined).sort();
    }, [selectedExam, userGenres]);

    const [hasSession, setHasSession] = useState(false);

    useEffect(() => {
        // Use user-specific key if logged in
        const sessionKey = user ? `radexam_session_${user.uid}` : 'radexam_session';
        const session = localStorage.getItem(sessionKey);

        if (session) {
            try {
                const parsed = JSON.parse(session);
                // Simple validation - just check if it exists and is valid JSON
                // ID mismatch checks are no longer needed because the key itself is user-scoped
                setHasSession(true);
            } catch (e) {
                console.error("Invalid session data", e);
                localStorage.removeItem(sessionKey);
                setHasSession(false);
            }
        } else {
            setHasSession(false);
        }

        // Check remote session if no local session (or even if local exists, to see if remote is newer? 
        // For "Resume Availability" just existence is enough. 
        // If local doesn't exist but remote does, we should show resume.
        const checkRemote = async () => {
            if (user) {
                try {
                    const { getActiveSession } = await import('@/lib/db');
                    const remote = await getActiveSession(user.uid);
                    if (remote) {
                        setHasSession(true);
                    }
                } catch (e) {
                    console.error("Error checking remote session", e);
                }
            }
        };
        if (!session) {
            checkRemote();
        }

        // Check if there are unread announcements
        const checkAnnouncements = async () => {
            const latestId = getLatestAnnouncementId();
            if (!latestId) return;

            let remoteReadId = null;
            if (user) {
                try {
                    const { getLastReadAnnouncement } = await import('@/lib/db');
                    remoteReadId = await getLastReadAnnouncement(user.uid);
                    // If remote has a newer read ID than local, update local
                    if (remoteReadId) {
                        const localRead = localStorage.getItem('radexam_last_read_announcement');
                        if (!localRead || localRead < remoteReadId) {
                            localStorage.setItem('radexam_last_read_announcement', remoteReadId);
                        }
                    }
                } catch (e) {
                    console.error("Failed to check remote announcements", e);
                }
            }

            const lastRead = localStorage.getItem('radexam_last_read_announcement');

            // Logic: If latestId > lastRead, then unread.
            // Assumption: IDs are comparable (e.g. YYYYMMDD or incremental). 
            // If IDs are not comparable strings, we need strict inequality check or just simple equality if we only care about "not the latest".
            // Usually "unread" means latest is DIFFERENT from last read? Or strictly newer?
            // Let's assume strict inequality if formatted as date/number, or just logic: "if saved != latest".
            // But if I read ID "2", and latest is "3", then unread.
            // If I read ID "3", and latest is "3", then read.
            // What if I read "3" and then "2" comes out (unlikely)?
            // Simple: lastRead !== latestId means unread (assuming user always reads the latest eventually).
            // Better: if (!lastRead || lastRead !== latestId)

            // BUT, if we synced remoteReadId, we use that effectively via localStorage update above.
            // So just check localStorage again.

            if (!lastRead || lastRead !== latestId) {
                setHasUnreadAnnouncements(true);
            } else {
                setHasUnreadAnnouncements(false);
            }
        };
        checkAnnouncements();

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
    }, [user]);

    // Fetch user genres effect
    useEffect(() => {
        if (!user) return;
        const fetchUserGenres = async () => {
            try {
                const { getAllOverrides, getUserExamProgress } = await import('@/lib/db');
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

                const overrides = await getAllOverrides();
                Object.entries(overrides).forEach(([key, ov]) => {
                    if (ov.genre) processGenre(key, ov.genre);
                });

                const progress = await getUserExamProgress(user.uid);
                Object.entries(progress).forEach(([key, p]) => {
                    if (p.overrideGenre) processGenre(key, p.overrideGenre);
                });

                setUserGenres(genreMap);
            } catch (e) {
                console.error("Failed to fetch user genres", e);
            }
        };
        fetchUserGenres();
    }, [user]);

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

        localStorage.removeItem('radexam_session');

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
        // Use user-specific key if logged in
        const sessionKey = user ? `radexam_session_${user.uid}` : 'radexam_session';
        const session = localStorage.getItem(sessionKey);
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

    const handleDownloadOffline = async (e, examId, isAuto = false) => {
        if (e) e.stopPropagation();
        if (downloadingExamId) return;

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
    }, [selectedExam]);

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

    // --- Data Management ---
    const [showDataModal, setShowDataModal] = useState(false);
    const [isProcessingData, setIsProcessingData] = useState(false);
    const [exportOptions, setExportOptions] = useState({
        history: true, answers: true, notes: true, genres: true
    });
    const [importStrategy, setImportStrategy] = useState('overwrite');

    const handleExport = async () => {
        if (!user || isProcessingData) return;
        setIsProcessingData(true);
        try {
            const { exportUserData } = await import('@/lib/db');
            const data = await exportUserData(user.uid, exportOptions);
            if (Object.keys(data.data).length === 0) {
                alert('出力対象のデータがありませんでした。');
                setIsProcessingData(false);
                return;
            }
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `radtest_backup_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            alert('エクスポートが完了しました。');
            setShowDataModal(false);
        } catch (e) {
            console.error(e);
            alert('エクスポートに失敗しました: ' + e.message);
        } finally {
            setIsProcessingData(false);
        }
    };

    const handleImport = async (e) => {
        const file = e.target.files[0];
        if (!file || !user || isProcessingData) return;
        const strategyLabel = importStrategy === 'overwrite' ? '【上書き】' : '【既存優先】';
        if (!confirm(`現在の設定: ${strategyLabel}\nデータをインポートしてよろしいですか？`)) {
            e.target.value = '';
            return;
        }
        setIsProcessingData(true);
        try {
            const text = await file.text();
            const json = JSON.parse(text);
            const { importUserData } = await import('@/lib/db');
            const result = await importUserData(user.uid, json, importStrategy);
            alert(`インポート完了: ${result.count} 件のデータを処理しました。画面をリロードします。`);
            window.location.reload();
        } catch (e) {
            console.error(e);
            alert('インポートに失敗しました: ' + e.message);
        } finally {
            setIsProcessingData(false);
            e.target.value = '';
        }
    };

    return (
        <div className={styles.container}>
            <h1 className={styles.title}>RadTest</h1>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                {user && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', color: '#718096' }}>
                            <span>ログイン中: <b>{user.email}</b></span>
                            <LogoutButton user={user} logout={logout} />
                        </div>
                        {userData && (
                            <div style={{ fontSize: '0.75rem', color: userData.migrationToNextJsAppDone ? '#38a169' : '#e53e3e', marginBottom: '4px' }}>
                                {userData.migrationToNextJsAppDone
                                    ? `✓ データ移行完了 (${new Date(userData.migrationDate?.seconds * 1000).toLocaleDateString()})`
                                    : '⚠ データ移行保留中 (自動実行待ち)'}
                            </div>
                        )}
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <button onClick={() => router.push('/search')} style={{ background: 'transparent', border: '1px solid #cbd5e0', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer', color: '#4a5568', fontSize: '1rem' }}>
                        🔍 問題を検索
                    </button>
                    <button
                        onClick={() => setShowDataModal(true)}
                        style={{ background: 'transparent', border: '1px solid #cbd5e0', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer', color: '#4a5568', fontSize: '1rem' }}
                    >
                        💾 データ管理
                    </button>
                    <button
                        onClick={() => router.push('/announcements')}
                        style={{ position: 'relative', background: 'transparent', border: '1px solid #cbd5e0', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer', color: '#4a5568', fontSize: '1rem' }}
                    >
                        🔔 お知らせ
                        {hasUnreadAnnouncements && (
                            <span style={{
                                position: 'absolute',
                                top: '-5px',
                                right: '-5px',
                                width: '12px',
                                height: '12px',
                                background: '#e53e3e',
                                borderRadius: '50%',
                                border: '2px solid white'
                            }} />
                        )}
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

            {/* Data Management Modal */}
            {showDataModal && (
                <div className={styles.modalOverlay}>
                    <div className={styles.modalContent}>
                        <h3 className={styles.modalTitle}>データ管理</h3>
                        <p className={styles.modalDesc}>
                            学習履歴やメモをJSON形式でバックアップ・共有できます。
                        </p>

                        <div style={{ marginTop: '1.5rem' }}>
                            <h4 className={styles.modalSectionTitle} style={{ borderBottomColor: '#3182ce' }}>📤 エクスポート (保存)</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
                                <label style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'inherit' }}><input type="checkbox" checked={exportOptions.history} onChange={e => setExportOptions({ ...exportOptions, history: e.target.checked })} style={{ marginRight: '0.3rem' }} />学習履歴 (正誤/★)</label>
                                <label style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'inherit' }}><input type="checkbox" checked={exportOptions.answers} onChange={e => setExportOptions({ ...exportOptions, answers: e.target.checked })} style={{ marginRight: '0.3rem' }} />自分の解答</label>
                                <label style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'inherit' }}><input type="checkbox" checked={exportOptions.notes} onChange={e => setExportOptions({ ...exportOptions, notes: e.target.checked })} style={{ marginRight: '0.3rem' }} />解説メモ</label>
                                <label style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'inherit' }}><input type="checkbox" checked={exportOptions.genres} onChange={e => setExportOptions({ ...exportOptions, genres: e.target.checked })} style={{ marginRight: '0.3rem' }} />ジャンル設定</label>
                            </div>
                            <button onClick={handleExport} disabled={isProcessingData} style={{ width: '100%', padding: '0.75rem', background: '#3182ce', color: 'white', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', opacity: isProcessingData ? 0.7 : 1 }}>
                                ⬇️ JSONファイルをダウンロード
                            </button>
                        </div>

                        <div style={{ marginTop: '2rem' }}>
                            <h4 className={styles.modalSectionTitle} style={{ borderBottomColor: '#38a169' }}>📥 インポート (復元・結合)</h4>
                            <div style={{ marginBottom: '1rem', background: 'rgba(0,0,0,0.05)', padding: '0.8rem', borderRadius: '0.5rem' }}>
                                <div style={{ marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: 'bold' }}>競合時の動作:</div>
                                <label style={{ display: 'flex', alignItems: 'center', marginBottom: '0.4rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                                    <input type="radio" name="strategy" value="overwrite" checked={importStrategy === 'overwrite'} onChange={() => setImportStrategy('overwrite')} style={{ marginRight: '0.5rem' }} />
                                    <span><b>完全同期 (Mirror)</b><br /><span style={{ fontSize: '0.8rem', opacity: 0.8 }}>ファイルの状態と完全に一致させます (ファイルにないデータは消えます)</span></span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.9rem', cursor: 'pointer' }}>
                                    <input type="radio" name="strategy" value="keep" checked={importStrategy === 'keep'} onChange={() => setImportStrategy('keep')} style={{ marginRight: '0.5rem' }} />
                                    <span><b>既存を優先 (Keep Local)</b><br /><span style={{ fontSize: '0.8rem', opacity: 0.8 }}>自分のデータを残し、空白のみ埋めます</span></span>
                                </label>
                            </div>
                            <input type="file" accept=".json" onChange={handleImport} disabled={isProcessingData} style={{ fontSize: '0.9rem', width: '100%' }} />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                            <button onClick={() => setShowDataModal(false)} className={styles.modalCloseBtn}>閉じる</button>
                        </div>
                    </div>
                </div>
            )}
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
