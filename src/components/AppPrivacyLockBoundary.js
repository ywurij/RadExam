"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    APP_PRIVACY_LOCK_CHANGED_EVENT,
    APP_PRIVACY_LOCK_REQUEST_EVENT,
    readAppPrivacyLockConfig,
    verifyAppPrivacyLock,
} from '@/lib/appPrivacyLock.mjs';

const IDLE_LOCK_MS = 15 * 60 * 1000;

export default function AppPrivacyLockBoundary({ children }) {
    const [enabled, setEnabled] = useState(false);
    const [locked, setLocked] = useState(false);
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const idleTimer = useRef(null);

    const applyLockedState = useCallback(nextLocked => {
        setLocked(nextLocked);
        document.documentElement.dataset.appPrivacyLock = nextLocked ? 'locked' : 'unlocked';
    }, []);

    const armIdleTimer = useCallback(() => {
        clearTimeout(idleTimer.current);
        if (!readAppPrivacyLockConfig() || locked) return;
        idleTimer.current = setTimeout(() => applyLockedState(true), IDLE_LOCK_MS);
    }, [applyLockedState, locked]);

    useEffect(() => {
        const configEnabled = Boolean(readAppPrivacyLockConfig());
        setEnabled(configEnabled);
        applyLockedState(configEnabled);
        const handleChanged = () => {
            const nextEnabled = Boolean(readAppPrivacyLockConfig());
            setEnabled(nextEnabled);
            if (!nextEnabled) applyLockedState(false);
        };
        const handleLockRequest = () => applyLockedState(Boolean(readAppPrivacyLockConfig()));
        window.addEventListener(APP_PRIVACY_LOCK_CHANGED_EVENT, handleChanged);
        window.addEventListener(APP_PRIVACY_LOCK_REQUEST_EVENT, handleLockRequest);
        return () => {
            clearTimeout(idleTimer.current);
            window.removeEventListener(APP_PRIVACY_LOCK_CHANGED_EVENT, handleChanged);
            window.removeEventListener(APP_PRIVACY_LOCK_REQUEST_EVENT, handleLockRequest);
        };
    }, [applyLockedState]);

    useEffect(() => {
        if (!enabled || locked) return undefined;
        const resetEvents = ['pointerdown', 'keydown', 'touchstart'];
        resetEvents.forEach(eventName => window.addEventListener(eventName, armIdleTimer, { passive: true }));
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') armIdleTimer();
        };
        document.addEventListener('visibilitychange', handleVisibility);
        armIdleTimer();
        return () => {
            clearTimeout(idleTimer.current);
            resetEvents.forEach(eventName => window.removeEventListener(eventName, armIdleTimer));
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [armIdleTimer, enabled, locked]);

    const unlock = async event => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            if (!(await verifyAppPrivacyLock(code))) throw new Error('解除コードが正しくありません。');
            setCode('');
            applyLockedState(false);
        } catch (unlockError) {
            setError(unlockError.message || 'アプリロックを解除できませんでした。');
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <div className="appPrivacyContent" aria-hidden={locked ? 'true' : undefined}>{children}</div>
            {locked && (
                <div className="appPrivacyLock" role="dialog" aria-modal="true" aria-labelledby="app-lock-title">
                    <form className="appPrivacyLockCard" onSubmit={unlock}>
                        <span className="appPrivacyLockIcon" aria-hidden="true">🔒</span>
                        <h1 id="app-lock-title">RadExamはロックされています</h1>
                        <p>設定した解除コードを入力してください。</p>
                        <input
                            type="password"
                            value={code}
                            onChange={event => setCode(event.target.value)}
                            autoFocus
                            autoComplete="current-password"
                            aria-label="アプリロック解除コード"
                            disabled={busy}
                        />
                        <button type="submit" disabled={busy || !code}>{busy ? '確認中…' : 'ロックを解除'}</button>
                        {error && <p className="appPrivacyLockError" role="alert">{error}</p>}
                    </form>
                </div>
            )}
        </>
    );
}
