export const MAX_RESUMABLE_SESSIONS = 4;

export const normalizeSessionConditions = (source = {}) => ({
    yearFilter: source.yearFilter || 'all',
    countFilter: source.countFilter || 'all',
    statusFilter: Array.isArray(source.statusFilter) ? [...source.statusFilter] : [],
    genreFilter: Array.isArray(source.genreFilter) ? [...source.genreFilter] : [],
    isShuffle: source.isShuffle === true,
    mode: source.mode || 'practice',
});

export const limitResumableSessions = (sessions, limit = MAX_RESUMABLE_SESSIONS) => (
    (Array.isArray(sessions) ? sessions : [])
        .filter(session => (
            session
            && typeof session === 'object'
            && session.mode !== 'search'
            && session.interrupted === true
        ))
        .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))
        .slice(0, Math.max(0, limit))
);
