"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './login.module.scss'; // We'll create simple styles

export default function LoginPage() {
    const { login, user } = useAuth();
    const router = useRouter();
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
        setIsSubmitting(true);
        try {
            await login(email, password);
            router.push('/');
        } catch (err) {
            console.error(err);
            if (err.code === 'auth/invalid-credential') {
                setError('メールアドレスまたはパスワードが間違っています');
            } else {
                setError('ログインに失敗しました: ' + err.message);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <h1>RadTest ログイン</h1>
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
                        <label>パスワード</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            placeholder="••••••••"
                        />
                    </div>
                    {error && <p className={styles.error}>{error}</p>}
                    <button type="submit" disabled={isSubmitting} className={styles.btn}>
                        {isSubmitting ? 'ログイン中...' : 'ログイン'}
                    </button>
                </form>
                {/* <p className={styles.hint}>
                    新規登録は管理者から送られた招待リンクから行ってください。
                </p> */}
            </div>
        </div>
    );
}
