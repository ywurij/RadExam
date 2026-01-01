"use client";

import { useState, useEffect, Suspense } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import styles from '../login/login.module.scss'; // Reuse styles

function SignupContent() {
    const { signup, user } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get('token');

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (user) router.push('/');
    }, [user, router]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!token) {
            setError('招待リンクが無効です（トークンがありません）');
            return;
        }

        setIsSubmitting(true);
        try {
            await signup(email, password, token);
            alert('登録が完了しました！');
            router.push('/');
        } catch (err) {
            console.error(err);
            setError(err.message || '登録に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!token) {
        return (
            <div className={styles.container}>
                <div className={styles.card}>
                    <h1>新規登録エラー</h1>
                    <p className={styles.hint}>
                        招待リンクからアクセスしてください。
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <h1>アカウント作成</h1>
                <p className={styles.hint} style={{ marginBottom: '1.5rem' }}>
                    招待されたユーザーのみ登録可能です。
                </p>
                <form onSubmit={handleSubmit} className={styles.form}>
                    <div className={styles.group}>
                        <label>メールアドレス</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            placeholder="name@example.com"
                        />
                    </div>
                    <div className={styles.group}>
                        <label>パスワード (6文字以上)</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={6}
                            placeholder="••••••••"
                        />
                    </div>
                    {error && <p className={styles.error}>{error}</p>}
                    <button type="submit" disabled={isSubmitting} className={styles.btn}>
                        {isSubmitting ? '登録中...' : 'アカウント作成'}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default function SignupPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <SignupContent />
        </Suspense>
    );
}
