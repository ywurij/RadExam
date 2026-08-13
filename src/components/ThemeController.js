"use client";

import { useEffect, useState } from 'react';
import {
    normalizeThemePreference,
    resolveTheme,
    THEME_STORAGE_KEY,
} from '@/lib/themePreference.mjs';

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

    return (
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
    );
}
