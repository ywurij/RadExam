"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { searchQuestions } from '@/lib/data';
import styles from './search.module.scss';

export default function SearchPage() {
    const router = useRouter();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [filterYear, setFilterYear] = useState('all');
    const [sortOrder, setSortOrder] = useState('relevance');

    const handleSearch = async (e) => {
        const q = e.target.value;
        setQuery(q);
        if (q.length > 1) { // Searching with 2+ chars
            const res = await searchQuestions(q);
            setResults(res.slice(0, 100)); // Increased limit slightly for sorting potential
        } else {
            setResults([]);
        }
    };

    // Derived Logic
    const availableYears = [...new Set(results.map(q => q.year))].sort((a, b) => b - a);

    const displayResults = results
        .filter(q => filterYear === 'all' || q.year.toString() === filterYear)
        .sort((a, b) => {
            if (sortOrder === 'newest') return b.year - a.year || (parseInt(a.questionNumber || 0) - parseInt(b.questionNumber || 0));
            // ID sort: year desc, then question number asc (or just ID string asc)
            if (sortOrder === 'id') return a.id.localeCompare(b.id, undefined, { numeric: true });
            // Relevance (default) - rely on original Fuse order
            return 0;
        });

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
                    placeholder="問題文や解説を検索..."
                    autoFocus
                    className={styles.input}
                />
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
                        <label>年度:</label>
                        <select
                            value={filterYear}
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

            <div className={styles.results}>
                {displayResults.map(q => (
                    <div key={q.id} className={styles.resultItem} onClick={() => router.push(`/quiz?id=${q.id}`)}>
                        <span className={styles.badge}>{q.year} - {q.genre}</span>
                        <p className={styles.questionPreview}>{q.question.replace(/<[^>]*>?/gm, '').substring(0, 80)}...</p>
                    </div>
                ))}
                {query.length > 1 && displayResults.length === 0 && (
                    <div className={styles.empty}>
                        {results.length > 0 ? '条件に一致する結果がありません。' : '結果が見つかりませんでした。'}
                    </div>
                )}
            </div>
        </div>
    );
}
