"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { searchQuestions } from '@/lib/data';
import styles from './search.module.scss';

export default function SearchPage() {
    const router = useRouter();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);

    const handleSearch = (e) => {
        const q = e.target.value;
        setQuery(q);
        if (q.length > 1) { // Searching with 2+ chars
            const res = searchQuestions(q);
            setResults(res.slice(0, 50));
        } else {
            setResults([]);
        }
    };

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

            <div className={styles.results}>
                {results.map(q => (
                    <div key={q.id} className={styles.resultItem} onClick={() => router.push(`/quiz?id=${q.id}`)}>
                        <span className={styles.badge}>{q.year} - {q.genre}</span>
                        <p className={styles.questionPreview}>{q.question.replace(/<[^>]*>?/gm, '').substring(0, 80)}...</p>
                    </div>
                ))}
                {query.length > 1 && results.length === 0 && (
                    <div className={styles.empty}>結果が見つかりませんでした。</div>
                )}
            </div>
        </div>
    );
}
