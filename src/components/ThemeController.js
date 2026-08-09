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

    const handleChange = event => {
        const next = normalizeThemePreference(event.target.value);
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        localStorage.setItem(THEME_STORAGE_KEY, next);
        setPreference(next);
        applyTheme(next, systemDark);
    };

    return (
        <label className="themeSelector">
            <span>表示</span>
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
    );
}
