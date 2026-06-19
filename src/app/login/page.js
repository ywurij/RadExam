"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import styles from './login.module.scss'; // We'll create simple styles

export default function LoginPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/');
    }, [router]);

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <h1>このページは不要になりました</h1>
                <p className={styles.hint}>
                    認証機能は削除済みです。ホームへ移動します。
                </p>
            </div>
        </div>
    );
}
