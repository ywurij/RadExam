"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { createInviteToken, getInvites, migrateLegacyData } from '@/lib/db';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, getDocs, updateDoc } from 'firebase/firestore';
import styles from '../login/login.module.scss';
import { useRouter } from 'next/navigation';

export default function AdminPage() {
    const { user, isAdmin, logout } = useAuth();
    const router = useRouter();
    const [inviteLink, setInviteLink] = useState('');
    const [invites, setInvites] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (user) {
            loadInvites();
        }
    }, [user]);

    const loadInvites = async () => {
        const data = await getInvites();
        setInvites(data);
    };

    const generateLink = async () => {
        setLoading(true);
        try {
            const token = await createInviteToken(user.uid);
            const link = `${window.location.origin}/signup?token=${token}`;
            setInviteLink(link);
            loadInvites(); // Refresh list
        } catch (e) {
            console.error(e);
            alert('作成に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        alert('コピーしました');
    };

    if (!user) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>;

    return (
        <div className={styles.container} style={{ alignItems: 'flex-start', paddingTop: '2rem', height: 'auto', minHeight: '100vh' }}>
            <div className={styles.card} style={{ maxWidth: '900px', margin: '0 auto', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                    <h1 style={{ fontSize: '1.5rem', margin: 0 }}>管理者ダッシュボード</h1>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button
                            onClick={() => router.push('/')}
                            style={{ padding: '0.5rem 1rem', background: 'transparent', border: '1px solid #cbd5e0', borderRadius: '0.5rem', cursor: 'pointer', color: '#4a5568' }}
                        >
                            ← ホームに戻る
                        </button>
                        <button
                            onClick={async () => {
                                await logout();
                                router.push('/login');
                            }}
                            style={{ padding: '0.5rem 1rem', background: '#cbd5e0', border: 'none', borderRadius: '0.5rem', fontWeight: 'bold', cursor: 'pointer', color: '#2d3748' }}
                        >
                            ログアウト
                        </button>
                    </div>
                </div>

                <div style={{ marginBottom: '2rem', paddingBottom: '1rem', borderBottom: '1px solid #e2e8f0' }}>
                    <p style={{ margin: 0, color: '#4a5568' }}>管理者: <b>{user.email}</b></p>
                </div>

                {/* Generator Section */}
                <div className={styles.group} style={{ marginBottom: '2rem', padding: '1.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: '#f8fafc' }}>
                    <h3 style={{ marginBottom: '1rem', fontWeight: 'bold', fontSize: '1.1rem' }}>新規招待リンクの発行</h3>

                    {!inviteLink ? (
                        <button onClick={generateLink} disabled={loading} className={styles.btn} style={{ width: 'auto', padding: '0.75rem 1.5rem' }}>
                            {loading ? '生成中...' : '招待リンクを生成する'}
                        </button>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <input type="text" value={inviteLink} readOnly className={styles.input} style={{ padding: '0.5rem', background: '#fff', border: '1px solid #cbd5e0', flex: 1 }} />
                                <button onClick={() => copyToClipboard(inviteLink)} className={styles.btn} style={{ background: '#48bb78', width: 'auto' }}>
                                    コピー
                                </button>
                            </div>
                            <button onClick={() => setInviteLink('')} style={{ alignSelf: 'flex-start', marginTop: '0.5rem', background: 'none', border: 'none', color: '#718096', cursor: 'pointer', textDecoration: 'underline' }}>
                                閉じる
                            </button>
                        </div>
                    )}
                </div>

                {/* List Section */}
                <div style={{ marginBottom: '2rem' }}>
                    <h3 style={{ marginBottom: '1rem', fontWeight: 'bold', fontSize: '1.1rem' }}>発行済みリンク一覧</h3>
                    <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '0.5rem' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                            <thead>
                                <tr style={{ background: '#edf2f7', textAlign: 'left', color: '#4a5568' }}>
                                    <th style={{ padding: '0.75rem', borderBottom: '2px solid #e2e8f0', whiteSpace: 'nowrap' }}>作成日時</th>
                                    <th style={{ padding: '0.75rem', borderBottom: '2px solid #e2e8f0', whiteSpace: 'nowrap' }}>ステータス</th>
                                    <th style={{ padding: '0.75rem', borderBottom: '2px solid #e2e8f0', whiteSpace: 'nowrap' }}>使用ユーザー</th>
                                    <th style={{ padding: '0.75rem', borderBottom: '2px solid #e2e8f0', width: '100px' }}>アクション</th>
                                </tr>
                            </thead>
                            <tbody style={{ background: '#fff' }}>
                                {invites.map((invite) => {
                                    const created = invite.createdAt?.toDate ? invite.createdAt.toDate().toLocaleString('ja-JP') : '---';
                                    const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/signup?token=${invite.token}`;

                                    return (
                                        <tr key={invite.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                            <td style={{ padding: '0.75rem', color: '#2d3748' }}>{created}</td>
                                            <td style={{ padding: '0.75rem' }}>
                                                {invite.used ? (
                                                    <span style={{ color: '#e53e3e', fontWeight: 'bold', background: '#fff5f5', padding: '2px 6px', borderRadius: '4px' }}>使用済み</span>
                                                ) : (
                                                    <span style={{ color: '#38a169', fontWeight: 'bold', background: '#f0fff4', padding: '2px 6px', borderRadius: '4px' }}>有効</span>
                                                )}
                                            </td>
                                            <td style={{ padding: '0.75rem', color: '#718096', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {invite.usedBy || '-'}
                                            </td>
                                            <td style={{ padding: '0.75rem' }}>
                                                {!invite.used && (
                                                    <button
                                                        onClick={() => copyToClipboard(link)}
                                                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', border: '1px solid #cbd5e0', borderRadius: '0.25rem', background: 'white', cursor: 'pointer', color: '#4a5568' }}
                                                    >
                                                        コピー
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {invites.length === 0 && (
                                    <tr>
                                        <td colSpan="4" style={{ padding: '2rem', textAlign: 'center', color: '#718096' }}>招待リンクはまだありません</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Data Inspector & Migration Section */}
                <DataTools uid={user.uid} />
            </div>
        </div>
    );
}

// Sub-component for Data Inspection & Migration
function DataTools({ uid }) {
    const [userData, setUserData] = useState(null);
    const [subData, setSubData] = useState({});
    const [loading, setLoading] = useState(false);
    const [migrating, setMigrating] = useState(false);
    const [migrationResult, setMigrationResult] = useState(null);
    const [confirmingMigration, setConfirmingMigration] = useState(false);
    const [confirmingReset, setConfirmingReset] = useState(false);
    const [inspectError, setInspectError] = useState(null);

    const inspectData = async () => {
        setLoading(true);
        setSubData({});
        setInspectError(null);
        try {
            // 1. Fetch User Doc
            const userDoc = await getDoc(doc(db, 'users', uid));
            if (userDoc.exists()) {
                setUserData(userDoc.data());
            } else {
                setUserData({ error: 'Document not found' });
            }

            // 2. Check Potential Subcollections
            const potentialCollections = ['questions', 'progress', 'records', 'history', 'favorites', 'bookmarks', 'answers'];
            const foundSubData = {};

            for (const subName of potentialCollections) {
                try {
                    const snap = await getDocs(collection(db, 'users', uid, subName));
                    if (!snap.empty) {
                        foundSubData[subName] = { count: snap.size, sample: snap.docs[0].data() };
                    }
                } catch (e) {
                    // Do not ignore errors now, log them
                    console.error(`Error checking subcollection ${subName}:`, e);
                    foundSubData[subName] = { error: e.message };
                }
            }
            setSubData(foundSubData);

        } catch (e) {
            console.error(e);
            setInspectError(e.message);
            alert("Error inspecting data: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    const runMigration = async () => {
        if (!confirmingMigration) {
            setConfirmingMigration(true);
            setTimeout(() => setConfirmingMigration(false), 3000);
            return;
        }

        setMigrating(true);
        setMigrationResult(null);
        setConfirmingMigration(false);

        try {
            const result = await migrateLegacyData(uid);
            setMigrationResult(result);
            if (result.success) {
                inspectData(); // Refresh view
            }
        } catch (e) {
            console.error(e);
            setMigrationResult({ success: false, message: 'エラーが発生しました: ' + e.message });
        } finally {
            setMigrating(false);
        }
    };

    const resetFlag = async () => {
        if (!confirmingReset) {
            setConfirmingReset(true);
            setTimeout(() => setConfirmingReset(false), 3000); // 3-second timeout
            return;
        }

        try {
            await updateDoc(doc(db, 'users', uid), {
                migrationToNextJsAppDone: false
            });
            setConfirmingReset(false); // Reset state immediately on success
            alert("フラグをリセットしました。\nブラウザをリロードして、一度ログアウトしてください。");
            inspectData();
        } catch (e) {
            console.error(e);
            alert("エラー: " + e.message);
        }
    };

    return (
        <div className={styles.group} style={{ padding: '1.5rem', border: '1px solid #cbd5e0', borderRadius: '0.5rem', background: '#fff' }}>
            <h3 style={{ marginBottom: '1rem', fontWeight: 'bold' }}>🛠 データ管理ツール</h3>
            <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
                ユーザーデータの構造確認および旧アプリからのデータ移行を行います。
            </p>

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                <button onClick={inspectData} disabled={loading} className={styles.btn} style={{ width: 'auto', background: '#4a5568' }}>
                    {loading ? '調査中...' : 'データを調査'}
                </button>
                <button
                    onClick={runMigration}
                    disabled={migrating}
                    className={styles.btn}
                    style={{
                        width: 'auto',
                        background: confirmingMigration ? '#e53e3e' : '#d69e2e',
                        transition: 'all 0.2s'
                    }}
                >
                    {migrating ? '移行中...' : confirmingMigration ? '本当に実行しますか？' : 'データ移行を実行'}
                </button>
                <button
                    onClick={resetFlag}
                    className={styles.btn}
                    style={{
                        width: 'auto',
                        background: confirmingReset ? '#e53e3e' : '#718096'
                    }}
                >
                    {confirmingReset ? '本当にリセットする？' : 'フラグをリセット'}
                </button>
            </div>

            {inspectError && (
                <div style={{ padding: '0.5rem', background: '#fed7d7', color: '#c53030', marginBottom: '1rem', borderRadius: '4px' }}>
                    Inspection Error: {inspectError}
                </div>
            )}

            {migrationResult && (
                <div style={{ marginBottom: '1rem', padding: '0.5rem', background: migrationResult.success ? '#f0fff4' : '#fff5f5', color: migrationResult.success ? '#2f855a' : '#c53030', borderRadius: '0.25rem' }}>
                    {migrationResult.message}
                </div>
            )}

            {userData && (
                <div style={{ marginTop: '1rem', background: '#2d3748', color: '#fff', padding: '1rem', borderRadius: '0.5rem', fontSize: '0.8rem', overflowX: 'auto' }}>
                    <p style={{ fontWeight: 'bold', color: '#63b3ed' }}>User Document:</p>
                    <pre>{JSON.stringify(userData, null, 2)}</pre>

                    <p style={{ fontWeight: 'bold', color: '#63b3ed', marginTop: '1rem' }}>Subcollections Found:</p>
                    {Object.keys(subData).length > 0 ? (
                        <pre>{JSON.stringify(subData, null, 2)}</pre>
                    ) : (
                        <p>No common subcollections found (checked: questions, progress, records...)</p>
                    )}
                </div>
            )}
        </div>
    );
}
