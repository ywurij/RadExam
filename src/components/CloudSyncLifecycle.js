"use client";

import { useEffect } from 'react';
import { isMobileTarget } from '@/lib/appTarget';
import { runGoogleDriveBackgroundSync } from '@/lib/sync/googleDriveBrowserSync';
import { runGoogleDriveDesktopBackgroundSync } from '@/lib/sync/googleDriveDesktopSync';
import { runOneDriveBackgroundSync } from '@/lib/sync/oneDriveBrowserSync';
import { runOneDriveDesktopBackgroundSync } from '@/lib/sync/oneDriveDesktopSync';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const GOOGLE_DESKTOP_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID || '';
const MICROSOFT_CLIENT_ID = process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID || '';
const MICROSOFT_DESKTOP_CLIENT_ID = process.env.NEXT_PUBLIC_MICROSOFT_DESKTOP_CLIENT_ID || '';
const MINIMUM_SYNC_INTERVAL_MS = 15_000;
const PERIODIC_SYNC_INTERVAL_MS = 15 * 60_000;

export default function CloudSyncLifecycle() {
    useEffect(() => {
        const googleClientId = isMobileTarget
            ? GOOGLE_CLIENT_ID
            : GOOGLE_DESKTOP_CLIENT_ID;
        const microsoftClientId = isMobileTarget
            ? MICROSOFT_CLIENT_ID
            : MICROSOFT_DESKTOP_CLIENT_ID;
        if (!googleClientId && !microsoftClientId) return undefined;

        let disposed = false;
        let lastAttemptAt = 0;

        const requestUpdateCheck = async () => {
            const now = Date.now();
            if (disposed || now - lastAttemptAt < MINIMUM_SYNC_INTERVAL_MS) return;
            lastAttemptAt = now;
            try {
                const attempts = [];
                if (googleClientId) {
                    attempts.push(() => (
                        isMobileTarget
                            ? runGoogleDriveBackgroundSync({ clientId: googleClientId })
                            : runGoogleDriveDesktopBackgroundSync({ clientId: googleClientId })
                    ));
                }
                if (microsoftClientId) {
                    attempts.push(() => (
                        isMobileTarget
                            ? runOneDriveBackgroundSync({ clientId: microsoftClientId })
                            : runOneDriveDesktopBackgroundSync({ clientId: microsoftClientId })
                    ));
                }
                let response = { status: 'skipped', reason: 'not-connected' };
                for (const attempt of attempts) {
                    response = await attempt();
                    if (response.status === 'completed') break;
                }
                if (response.status === 'completed') {
                    window.dispatchEvent(new CustomEvent('radexam-cloud-update-status', {
                        detail: response.result || response,
                    }));
                }
            } catch (error) {
                // 通常利用は止めず、データ管理画面に保存されたエラーを表示する。
                console.warn('Background cloud update check failed:', error);
            }
        };
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') requestUpdateCheck();
        };

        requestUpdateCheck();
        const periodicTimer = window.setInterval(requestUpdateCheck, PERIODIC_SYNC_INTERVAL_MS);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('online', requestUpdateCheck);
        return () => {
            disposed = true;
            window.clearInterval(periodicTimer);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('online', requestUpdateCheck);
        };
    }, []);

    return null;
}
