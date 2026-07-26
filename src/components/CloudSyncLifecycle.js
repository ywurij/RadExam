"use client";

import { useEffect } from 'react';
import { isMobileTarget } from '@/lib/appTarget';
import { runGoogleDriveBackgroundSync } from '@/lib/sync/googleDriveBrowserSync';
import { runGoogleDriveDesktopBackgroundSync } from '@/lib/sync/googleDriveDesktopSync';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const GOOGLE_DESKTOP_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID || '';
const MINIMUM_SYNC_INTERVAL_MS = 15_000;

export default function CloudSyncLifecycle() {
    useEffect(() => {
        const clientId = isMobileTarget
            ? GOOGLE_CLIENT_ID
            : GOOGLE_DESKTOP_CLIENT_ID;
        if (!clientId) return undefined;

        let disposed = false;
        let lastAttemptAt = 0;

        const requestSync = async () => {
            const now = Date.now();
            if (disposed || now - lastAttemptAt < MINIMUM_SYNC_INTERVAL_MS) return;
            lastAttemptAt = now;
            try {
                const response = isMobileTarget
                    ? await runGoogleDriveBackgroundSync({ clientId })
                    : await runGoogleDriveDesktopBackgroundSync({ clientId });
                if (response.status === 'completed') {
                    window.dispatchEvent(new CustomEvent('radexam-cloud-sync-completed'));
                }
            } catch (error) {
                // 通常利用は止めず、同期画面に保存されたエラーを表示する。
                console.warn('Background cloud sync failed:', error);
            }
        };
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') requestSync();
        };

        requestSync();
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('online', requestSync);
        return () => {
            disposed = true;
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('online', requestSync);
        };
    }, []);

    return null;
}
