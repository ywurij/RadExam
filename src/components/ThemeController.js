"use client";

import { useEffect, useState } from 'react';
import {
    normalizeThemePreference,
    resolveTheme,
    THEME_STORAGE_KEY,
} from '@/lib/themePreference.mjs';
import {
    APP_PRIVACY_LOCK_CHANGED_EVENT,
    createAppPrivacyLock,
    readAppPrivacyLockConfig,
    removeAppPrivacyLock,
    requestAppPrivacyLock,
} from '@/lib/appPrivacyLock.mjs';

const applyTheme = (preference, systemDark) => {
    const normalized = normalizeThemePreference(preference);
    const resolved = resolveTheme(normalized, systemDark);
    document.documentElement.dataset.themePreference = normalized;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
};

export default function ThemeController() {
    const [preference, setPreference] = useState(() => (
        typeof document === 'undefined'
            ? 'system'
            : normalizeThemePreference(document.documentElement.dataset.themePreference)
    ));
    const [zoomFactor, setZoomFactor] = useState(1);
    const [zoomAvailable, setZoomAvailable] = useState(false);
    const [privacyLockEnabled, setPrivacyLockEnabled] = useState(false);
    const [privacyCode, setPrivacyCode] = useState('');
    const [privacyCodeConfirm, setPrivacyCodeConfirm] = useState('');
    const [privacyMessage, setPrivacyMessage] = useState('');
    const [privacyError, setPrivacyError] = useState('');
    const [privacyBusy, setPrivacyBusy] = useState(false);

    useEffect(() => {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const stored = normalizeThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
        applyTheme(stored, media.matches);
        const handleSystemTheme = event => {
            const current = normalizeThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
            if (current === 'system') applyTheme(current, event.matches);
        };
        media.addEventListener?.('change', handleSystemTheme);
        return () => media.removeEventListener?.('change', handleSystemTheme);
    }, []);

    useEffect(() => {
        const refresh = () => setPrivacyLockEnabled(Boolean(readAppPrivacyLockConfig()));
        refresh();
        window.addEventListener(APP_PRIVACY_LOCK_CHANGED_EVENT, refresh);
        return () => window.removeEventListener(APP_PRIVACY_LOCK_CHANGED_EVENT, refresh);
    }, []);

    useEffect(() => {
        const displayApi = window.radexamDisplay;
        if (!displayApi?.getZoomFactor) return;
        displayApi.getZoomFactor()
            .then(value => {
                setZoomFactor(Number(value) || 1);
                setZoomAvailable(true);
            })
            .catch(error => console.error('Failed to read display zoom:', error));
    }, []);

    const handleChange = event => {
        const next = normalizeThemePreference(event.target.value);
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        localStorage.setItem(THEME_STORAGE_KEY, next);
        setPreference(next);
        applyTheme(next, systemDark);
    };

    const handleZoomChange = async event => {
        const requested = Number(event.target.value);
        try {
            const applied = await window.radexamDisplay.setZoomFactor(requested);
            setZoomFactor(Number(applied) || 1);
        } catch (error) {
            console.error('Failed to update display zoom:', error);
        }
    };

    const enablePrivacyLock = async () => {
        setPrivacyBusy(true);
        setPrivacyError('');
        setPrivacyMessage('');
        try {
            if (privacyCode !== privacyCodeConfirm) throw new Error('解除コードが一致しません。');
            await createAppPrivacyLock(privacyCode);
            setPrivacyCode('');
            setPrivacyCodeConfirm('');
            setPrivacyMessage('アプリロックを有効にしました。次回起動時と15分間操作がない場合にロックします。');
        } catch (error) {
            setPrivacyError(error.message || 'アプリロックを設定できませんでした。');
        } finally {
            setPrivacyBusy(false);
        }
    };

    const disablePrivacyLock = async () => {
        setPrivacyBusy(true);
        setPrivacyError('');
        setPrivacyMessage('');
        try {
            await removeAppPrivacyLock(privacyCode);
            setPrivacyCode('');
            setPrivacyMessage('アプリロックを無効にしました。');
        } catch (error) {
            setPrivacyError(error.message || 'アプリロックを解除できませんでした。');
        } finally {
            setPrivacyBusy(false);
        }
    };

    return (
        <>
        <section className="themeSettings" aria-labelledby="theme-settings-title">
            <div className="themeSettingsText">
                <strong id="theme-settings-title">表示設定</strong>
                <span>アプリ全体の表示方法を設定します。</span>
            </div>
            <div className="displaySettingsFields">
                <label className="themeSettingsField">
                    <span>表示モード</span>
                    <select
                        value={preference}
                        onChange={handleChange}
                        aria-label="表示テーマ"
                        suppressHydrationWarning
                    >
                        <option value="system">端末に合わせる</option>
                        <option value="light">ライト</option>
                        <option value="dark">ダーク</option>
                    </select>
                </label>
                {zoomAvailable && (
                    <label className="themeSettingsField">
                        <span>表示サイズ</span>
                        <select value={String(zoomFactor)} onChange={handleZoomChange} aria-label="表示サイズ">
                            <option value="0.75">75%</option>
                            <option value="0.8">80%</option>
                            <option value="0.9">90%</option>
                            <option value="1">100%</option>
                            <option value="1.1">110%</option>
                            <option value="1.25">125%</option>
                            <option value="1.5">150%</option>
                        </select>
                    </label>
                )}
            </div>
        </section>
        <section className="themeSettings privacyLockSettings" aria-labelledby="privacy-lock-settings-title">
            <div className="themeSettingsText">
                <strong id="privacy-lock-settings-title">アプリロック</strong>
                <span>起動時と15分間操作がない場合に、画面を解除コードで保護します。端末内ファイル自体を暗号化する機能ではありません。</span>
            </div>
            <div className="privacyLockFields">
                <input
                    type="password"
                    value={privacyCode}
                    onChange={event => setPrivacyCode(event.target.value)}
                    autoComplete={privacyLockEnabled ? 'current-password' : 'new-password'}
                    minLength={8}
                    maxLength={256}
                    placeholder={privacyLockEnabled ? '現在の解除コード' : '解除コード（8文字以上）'}
                    disabled={privacyBusy}
                    aria-label={privacyLockEnabled ? '現在の解除コード' : '新しい解除コード'}
                />
                {!privacyLockEnabled && (
                    <input
                        type="password"
                        value={privacyCodeConfirm}
                        onChange={event => setPrivacyCodeConfirm(event.target.value)}
                        autoComplete="new-password"
                        minLength={8}
                        maxLength={256}
                        placeholder="解除コードを再入力"
                        disabled={privacyBusy}
                        aria-label="解除コードの確認"
                    />
                )}
                <button type="button" onClick={privacyLockEnabled ? disablePrivacyLock : enablePrivacyLock} disabled={privacyBusy || !privacyCode}>
                    {privacyLockEnabled ? 'アプリロックを無効化' : 'アプリロックを有効化'}
                </button>
                {privacyLockEnabled && (
                    <button type="button" className="secondaryPrivacyButton" onClick={requestAppPrivacyLock} disabled={privacyBusy}>
                        今すぐロック
                    </button>
                )}
            </div>
            {privacyMessage && <p className="privacySettingsMessage" role="status">{privacyMessage}</p>}
            {privacyError && <p className="privacySettingsError" role="alert">{privacyError}</p>}
        </section>
        </>
    );
}
