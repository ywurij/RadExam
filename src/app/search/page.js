"use client";

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getExamName, getGlobalQuestionId, searchQuestions } from '@/lib/data';
import styles from './search.module.scss';

const SEARCH_HISTORY_KEY = 'radexam_search_history';
const MAX_SEARCH_HISTORY = 6;
const loadSearchHistory = () => {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
        const parsed = JSON.parse(raw || '[]');
        if (Array.isArray(parsed)) {
            return parsed.filter((item) => typeof item === 'string' && item.trim()).slice(0, MAX_SEARCH_HISTORY);
        }
    } catch (error) {
        console.error('Failed to load search history:', error);
    }
    return [];
};

export default function SearchPage() {
    const router = useRouter();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [filterExam, setFilterExam] = useState('all');
    const [filterYear, setFilterYear] = useState('all');
    const [sortOrder, setSortOrder] = useState('relevance');
    const [searchHistory, setSearchHistory] = useState(loadSearchHistory);
    const [isHistoryVisible, setIsHistoryVisible] = useState(false);
    const [hoveredQuestionId, setHoveredQuestionId] = useState(null);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

    const stripHtml = (value) => String(value || '').replace(/<[^>]*>?/gm, '').trim();
    const formatQuestionNumber = (question) => question.questionNumber || question.id;
    const truncateText = (value, maxLength = 80) => {
        const normalized = stripHtml(value);
        return normalized.length > maxLength ? `${normalized.substring(0, maxLength)}...` : normalized;
    };

    const persistSearchHistory = (nextHistory) => {
        setSearchHistory(nextHistory);
        if (typeof window !== 'undefined') {
            localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(nextHistory));
        }
    };

    const recordSearchHistory = (term) => {
        const normalized = String(term || '').trim();
        if (normalized.length < 2) return;
        const nextHistory = [
            normalized,
            ...searchHistory.filter((item) => item !== normalized)
        ].slice(0, MAX_SEARCH_HISTORY);
        persistSearchHistory(nextHistory);
    };

    const runSearch = async (nextQuery) => {
        const normalized = String(nextQuery || '');
        setQuery(normalized);

        if (normalized.trim().length > 1) {
            const res = await searchQuestions(normalized);
            setResults(res.slice(0, 100));
            recordSearchHistory(normalized);
        } else {
            setResults([]);
        }
    };

    const handleSearch = async (e) => {
        const q = e.target.value;
        await runSearch(q);
    };

    const handleHistorySelect = async (term) => {
        setIsHistoryVisible(false);
        await runSearch(term);
    };

    const clearSearchHistory = () => {
        persistSearchHistory([]);
    };

    // Derived Logic
    const availableExams = useMemo(() => (
        [...new Map(results.map((q) => [q.examId, { id: q.examId, name: getExamName(q.examId) }])).values()]
            .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
    ), [results]);

    const effectiveFilterExam = filterExam === 'all' || availableExams.some((exam) => exam.id === filterExam)
        ? filterExam
        : 'all';

    const examFilteredResults = useMemo(() => (
        results.filter((q) => effectiveFilterExam === 'all' || q.examId === effectiveFilterExam)
    ), [results, effectiveFilterExam]);

    const availableYears = useMemo(() => (
        [...new Set(examFilteredResults.map((q) => q.year))].sort((a, b) => b - a)
    ), [examFilteredResults]);

    const effectiveFilterYear = filterYear === 'all' || availableYears.some((year) => year.toString() === filterYear)
        ? filterYear
        : 'all';

    const displayResults = [...examFilteredResults]
        .filter(q => effectiveFilterYear === 'all' || q.year.toString() === effectiveFilterYear)
        .sort((a, b) => {
            if (sortOrder === 'newest') return b.year - a.year || (parseInt(a.questionNumber || 0) - parseInt(b.questionNumber || 0));
            // ID sort: year desc, then question number asc (or just ID string asc)
            if (sortOrder === 'id') return a.id.localeCompare(b.id, undefined, { numeric: true });
            // Relevance (default) - rely on original Fuse order
            return 0;
        });

    const hoveredQuestion = useMemo(() => (
        displayResults.find((q) => getGlobalQuestionId(q.examId, q.id) === hoveredQuestionId) || null
    ), [hoveredQuestionId, displayResults]);

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <button onClick={() => router.push('/')} className={styles.backBtn}>← 戻る</button>
                <h1 className={styles.title}>問題検索</h1>
            </header>

            <div className={styles.searchBox}>
                <input
                    type="text"
                    value={query}
                    onChange={handleSearch}
                    onFocus={() => setIsHistoryVisible(true)}
                    onBlur={() => window.setTimeout(() => setIsHistoryVisible(false), 120)}
                    placeholder="問題文、解説、ID（例: 2022048）を検索..."
                    autoFocus
                    className={styles.input}
                />
                {isHistoryVisible && searchHistory.length > 0 && (
                    <div className={styles.historyPanel}>
                        <div className={styles.historyHeader}>
                            <span>最近の検索</span>
                            <button type="button" onMouseDown={clearSearchHistory} className={styles.historyClearBtn}>クリア</button>
                        </div>
                        <div className={styles.historyList}>
                            {searchHistory.map((term) => (
                                <button
                                    key={term}
                                    type="button"
                                    className={styles.historyChip}
                                    onMouseDown={() => handleHistorySelect(term)}
                                >
                                    {term}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {results.length > 0 && (
                <div className={styles.controls}>
                    <div className={styles.controlGroup}>
                        <label>並び替え:</label>
                        <select
                            value={sortOrder}
                            onChange={(e) => setSortOrder(e.target.value)}
                            className={styles.select}
                        >
                            <option value="relevance">関連度順</option>
                            <option value="newest">新しい順</option>
                            <option value="id">ID順</option>
                        </select>
                    </div>

                    <div className={styles.controlGroup}>
                        <label>試験名:</label>
                        <select
                            value={effectiveFilterExam}
                            onChange={(e) => {
                                setFilterExam(e.target.value);
                                setFilterYear('all');
                            }}
                            className={styles.select}
                        >
                            <option value="all">全て</option>
                            {availableExams.map((exam) => (
                                <option key={exam.id} value={exam.id}>{exam.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className={styles.controlGroup}>
                        <label>年度:</label>
                        <select
                            value={effectiveFilterYear}
                            onChange={(e) => setFilterYear(e.target.value)}
                            className={styles.select}
                        >
                            <option value="all">全て</option>
                            {availableYears.map(year => (
                                <option key={year} value={year}>{year}年</option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            <div
                className={styles.results}
                onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
            >
                {displayResults.map(q => (
                    <div
                        key={getGlobalQuestionId(q.examId, q.id)}
                        className={styles.resultItem}
                        onMouseEnter={(e) => {
                            setHoveredQuestionId(getGlobalQuestionId(q.examId, q.id));
                            setMousePos({ x: e.clientX, y: e.clientY });
                        }}
                        onMouseLeave={() => setHoveredQuestionId(null)}
                        onClick={() => router.push(`/quiz?mode=search&exam=${q.examId}&id=${getGlobalQuestionId(q.examId, q.id)}`)}
                    >
                        <span className={styles.badge}>[{getExamName(q.examId)}-{q.year}-{formatQuestionNumber(q)}]</span>
                        <p className={styles.questionPreview}>{truncateText(q.question)}</p>
                    </div>
                ))}
                {query.length > 1 && displayResults.length === 0 && (
                    <div className={styles.empty}>
                        {results.length > 0 ? '条件に一致する結果がありません。' : '結果が見つかりませんでした。'}
                    </div>
                )}
            </div>

            {hoveredQuestion && (
                <div
                    className={styles.tooltip}
                    style={{ top: mousePos.y + 20, left: Math.min(mousePos.x, window.innerWidth - 360) }}
                >
                    <div className={styles.tooltipContent}>
                        <div className={styles.tooltipBadge}>
                            [{getExamName(hoveredQuestion.examId)}-{hoveredQuestion.year}-{formatQuestionNumber(hoveredQuestion)}]
                        </div>
                        <p className={styles.fullQuestion}>{stripHtml(hoveredQuestion.question)}</p>
                        <ul className={styles.optionsList}>
                            {Object.entries(hoveredQuestion.options || {}).map(([key, value]) => (
                                <li key={key}>
                                    <b>{key}</b>: {stripHtml(value)}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
}
