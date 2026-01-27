"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import styles from './announcements.module.scss';
import { ANNOUNCEMENTS, getLatestAnnouncementId } from '@/lib/announcementsData';
import { saveLastReadAnnouncement } from '@/lib/db';
import { useAuth } from '@/context/AuthContext';

export default function AnnouncementsPage() {
    const router = useRouter();
    const { user } = useAuth(); // If no auth context usage, we need to import or assume logged in state retrieval

    useEffect(() => {
        // Mark as read on visit
        const latestId = getLatestAnnouncementId();
        if (latestId) {
            localStorage.setItem('radexam_last_read_announcement', latestId);

            // Sync to Firestore
            if (user) {
                saveLastReadAnnouncement(user.uid, latestId);
            }
        }
    }, [user]);

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1 className={styles.title}>お知らせ</h1>
                <button className={styles.backButton} onClick={() => router.back()}>
                    ← 戻る
                </button>
            </header>

            <div className={styles.list}>
                {ANNOUNCEMENTS.map(item => (
                    <article key={item.id} className={styles.card}>
                        <span className={styles.date}>{item.date}</span>
                        <h2 className={styles.cardTitle}>{item.title}</h2>
                        <p className={styles.content}>{item.content}</p>
                    </article>
                ))}
            </div>
        </div>
    );
}
