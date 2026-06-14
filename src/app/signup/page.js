"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import styles from '../login/login.module.scss'; // Reuse styles

export default function SignupPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/');
    }, [router]);

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <h1>このページは不要になりました</h1>
                <p className={styles.hint}>
                    招待登録機能は削除済みです。ホームへ移動します。
                </p>
            </div>
        </div>
    );
}
