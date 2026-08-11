export const THEME_STORAGE_KEY = 'radexam_theme_preference';
export const THEME_PREFERENCES = Object.freeze(['system', 'light', 'dark']);

export const normalizeThemePreference = value => (
    THEME_PREFERENCES.includes(value) ? value : 'system'
);

export const resolveTheme = (preference, systemDark = false) => (
    normalizeThemePreference(preference) === 'system'
        ? (systemDark ? 'dark' : 'light')
        : normalizeThemePreference(preference)
);
