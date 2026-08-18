import Link from 'next/link';

export default function LegalLinks({ compact = false }) {
    return (
        <nav className={compact ? 'legalLinks legalLinksCompact' : 'legalLinks'} aria-label="アプリ情報">
            <Link href="/privacy">プライバシーポリシー</Link>
            <Link href="/terms">利用規約</Link>
            <Link href="/contact">お問い合わせ</Link>
        </nav>
    );
}
