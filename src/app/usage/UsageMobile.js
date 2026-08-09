"use client";

import { useRouter } from 'next/navigation';

const sectionStyle = {
    padding: '1.2rem',
    border: '1px solid var(--border-color)',
    borderRadius: '1rem',
    background: 'var(--surface-raised)',
};

export default function UsagePage() {
    const router = useRouter();

    return (
        <main style={{ width: 'min(100%, 760px)', minHeight: '100dvh', margin: '0 auto', padding: 'max(1.25rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(2rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left))', color: 'var(--text-primary)', background: 'var(--surface)' }}>
            <button type="button" onClick={() => router.push('/')} style={{ minHeight: 44, padding: '0 0.9rem', border: '1px solid var(--border-color)', borderRadius: '0.7rem', background: 'var(--surface-raised)', color: 'var(--text-primary)', fontWeight: 700 }}>← 戻る</button>
            <header style={{ margin: '1.3rem 0 1.5rem' }}>
                <p style={{ margin: 0, color: 'var(--accent)', fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.12em' }}>RADEXAM MOBILE</p>
                <h1 style={{ margin: '0.25rem 0 0.45rem', fontSize: 'clamp(1.8rem, 7vw, 2.6rem)' }}>簡易版の使い方</h1>
                <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.7 }}>iPhone・iPad・Androidで、Mac/PC版の試験データを使って演習するためのアプリです。</p>
            </header>

            <div style={{ display: 'grid', gap: '1rem' }}>
                <section style={sectionStyle}>
                    <h2 style={{ margin: '0 0 0.55rem', fontSize: '1.15rem' }}>1. Mac/PC版でデータを書き出す</h2>
                    <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.7 }}>試験データと画像をRadExamバックアップ（.radexam）として書き出し、AirDrop、iCloud Drive、Google Driveなどでモバイル端末へ移します。</p>
                </section>
                <section style={sectionStyle}>
                    <h2 style={{ margin: '0 0 0.55rem', fontSize: '1.15rem' }}>2. モバイル版へ登録する</h2>
                    <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.7 }}>ホームの「データ転送」からRadExamバックアップ（.radexam）を選びます。現在の試験と学習履歴は、読み込んだ内容に置き換わります。問題に紐づく参照PDFも引き継がれます。</p>
                </section>
                <section style={sectionStyle}>
                    <h2 style={{ margin: '0 0 0.55rem', fontSize: '1.15rem' }}>3. 演習・記録・編集</h2>
                    <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.7 }}>年度・ジャンル・出題数を選び、演習を開始します。正誤、お気に入り、中断位置は自動保存されます。回答表示後は解説とジャンルを編集できます。</p>
                </section>
                <section style={sectionStyle}>
                    <h2 style={{ margin: '0 0 0.55rem', fontSize: '1.15rem' }}>4. 定期的にバックアップ</h2>
                    <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.7 }}>「データ転送」の書き出しを使い、編集内容と学習履歴を保管します。ブラウザのデータ削除やアプリ削除をすると端末内データも失われます。</p>
                </section>
            </div>

            <aside style={{ marginTop: '1rem', padding: '1rem', borderRadius: '0.9rem', background: 'var(--accent-soft)', color: 'var(--accent)', lineHeight: 1.65 }}>
                ホーム画面へ追加すると、通常のアプリに近い全画面表示で利用できます。iPhone／iPadはSafariの共有メニュー、Androidはブラウザのメニューから追加してください。
            </aside>
        </main>
    );
}
