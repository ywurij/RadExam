import Link from 'next/link';
import styles from './LegalPage.module.scss';

export default function LegalPage({ eyebrow, title, lead, children }) {
    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <Link href="/" className={styles.backLink}>← ホームへ戻る</Link>
                <span className={styles.eyebrow}>{eyebrow}</span>
                <h1>{title}</h1>
                <p>{lead}</p>
            </header>

            <article className={styles.content}>{children}</article>

            <footer className={styles.footer}>
                <p>制定日：2026年8月18日</p>
            </footer>
        </main>
    );
}
