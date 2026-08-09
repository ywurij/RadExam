"use client";

import { useRouter } from 'next/navigation';

export default function UsagePage() {
    const router = useRouter();

    return (
        <div style={{
            maxWidth: 'var(--page-max-width-wide)',
            margin: '0 auto',
            padding: '2.5rem 1.5rem',
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            color: 'var(--text-primary)',
            backgroundColor: 'var(--surface-soft)',
            minHeight: '100vh',
            lineHeight: 1.7
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '2.5rem',
                borderBottom: '1px solid var(--border-color)',
                paddingBottom: '1.2rem'
            }}>
                <div>
                    <h1 style={{ fontSize: '2rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)', letterSpacing: '-0.025em' }}>
                        ❓ RadExam 使い方ガイド
                    </h1>
                    <p style={{ margin: '0.4rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                        PDFから試験問題を取り込み、演習を行うための手順を解説します。
                    </p>
                </div>
                <button
                    onClick={() => router.push('/')}
                    style={{
                        padding: '0.6rem 1.2rem',
                        background: 'var(--surface-raised)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '0.5rem',
                        cursor: 'pointer',
                        fontWeight: '600',
                        color: 'var(--text-secondary)',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                        transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#a0aec0';
                        e.currentTarget.style.background = '#f7fafc';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border-color)';
                        e.currentTarget.style.background = '#fff';
                    }}
                >
                    ← アプリに戻る
                </button>
            </div>

            {/* Note about copyright/local concept */}
            <div style={{
                background: 'var(--accent-soft)',
                borderLeft: '4px solid #3182ce',
                color: 'var(--accent)',
                padding: '1.25rem',
                borderRadius: '0.5rem',
                marginBottom: '2rem',
                fontSize: '0.95rem'
            }}>
                <h3 style={{ margin: '0 0 0.5rem 0', fontWeight: 'bold' }}>💡 本アプリの仕組み</h3>
                著作権保護およびデータ転載防止の観点から、本アプリにはあらかじめ試験データが登録されていません。<br />
                ご自身で入手した試験問題PDFから問題データを抽出し、<b>ご利用中の端末内（アプリの内部ストレージ）に保存して演習を行う</b>仕組みです。PDF・設問・学習履歴は外部サーバーへ送信せず、端末内で処理します。
            </div>

            {/* Step-by-step Guide */}
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                🚀 過去問インポートの5ステップ
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '2.5rem' }}>
                {/* Step 1 */}
                <div style={{
                    background: 'var(--surface-raised)',
                    padding: '1.5rem',
                    borderRadius: '0.75rem',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
                    border: '1px solid var(--border-color)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
                        <span style={{
                            background: 'var(--accent)',
                            color: 'white',
                            fontWeight: '800',
                            fontSize: '0.8rem',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '0.25rem',
                            boxShadow: '0 2px 4px rgba(49, 130, 206, 0.2)'
                        }}>STEP 1</span>
                        <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                            試験管理画面を開く
                        </h4>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.92rem', color: 'var(--text-secondary)' }}>
                        トップ画面右上の「<b>⚙️ 試験管理</b>」ボタンを押し、「<b>試験データインポート</b>」画面を開きます。
                    </p>
                </div>

                {/* Step 2 */}
                <div style={{
                    background: 'var(--surface-raised)',
                    padding: '1.5rem',
                    borderRadius: '0.75rem',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
                    border: '1px solid var(--border-color)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
                        <span style={{
                            background: 'var(--accent)',
                            color: 'white',
                            fontWeight: '800',
                            fontSize: '0.8rem',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '0.25rem',
                            boxShadow: '0 2px 4px rgba(49, 130, 206, 0.2)'
                        }}>STEP 2</span>
                        <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                            試験種別を選んでPDFを読み込む
                        </h4>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.92rem', color: 'var(--text-secondary)' }}>
                        放射線科専門医、放射線診断専門医、核医学専門医、IVR専門医から対象を選択し、同じ試験の複数年度PDFをまとめて読み込みます。<br />
                        アプリが年度ごとに問題文、選択肢、画像、レジェンドを抽出します。登録に使用したPDF自体も端末内へ保存され、後から参照できます。
                    </p>
                </div>

                {/* Step 3 */}
                <div style={{
                    background: 'var(--surface-raised)',
                    padding: '1.5rem',
                    borderRadius: '0.75rem',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
                    border: '1px solid var(--border-color)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
                        <span style={{
                            background: 'var(--accent)',
                            color: 'white',
                            fontWeight: '800',
                            fontSize: '0.8rem',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '0.25rem',
                            boxShadow: '0 2px 4px rgba(49, 130, 206, 0.2)'
                        }}>STEP 3</span>
                        <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                            抽出結果を確認する
                        </h4>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.92rem', color: 'var(--text-secondary)' }}>
                        自動抽出された問題文、選択肢、画像、レジェンドを一覧で確認します。画像は追加・削除・表示順変更が可能です。核医学は「巻末図ページを参照」が推奨で、問題文中の別紙番号に対応する巻末ページを表示します。<br />
                        保存後の詳細な修正は「データ管理 / バックアップ」の試験編集から行えます。
                    </p>
                </div>

                {/* Step 4 */}
                <div style={{
                    background: 'var(--surface-raised)',
                    padding: '1.5rem',
                    borderRadius: '0.75rem',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
                    border: '1px solid var(--border-color)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
                        <span style={{
                            background: 'var(--accent)',
                            color: 'white',
                            fontWeight: '800',
                            fontSize: '0.8rem',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '0.25rem',
                            boxShadow: '0 2px 4px rgba(49, 130, 206, 0.2)'
                        }}>STEP 4</span>
                        <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                            保存先の試験を設定する
                        </h4>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.92rem', color: 'var(--text-secondary)' }}>
                        「<b>既存の試験に追加 (マージ)</b>」するか、「<b>新しい試験として登録</b>」するかを選びます。<br />
                        既存試験へ追加する場合は保存先の試験を選択し、新規登録する場合は<b>試験ID</b>と<b>試験名</b>を入力します。
                    </p>
                </div>

                {/* Step 5 */}
                <div style={{
                    background: 'var(--surface-raised)',
                    padding: '1.5rem',
                    borderRadius: '0.75rem',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
                    border: '1px solid var(--border-color)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
                        <span style={{
                            background: 'var(--accent)',
                            color: 'white',
                            fontWeight: '800',
                            fontSize: '0.8rem',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '0.25rem',
                            boxShadow: '0 2px 4px rgba(49, 130, 206, 0.2)'
                        }}>STEP 5</span>
                        <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                            保存して演習を開始する
                        </h4>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.92rem', color: 'var(--text-secondary)' }}>
                        「<b>この内容で保存</b>」をクリックします。保存が完了すると、トップ画面（ホーム）に新しく登録した試験カードが表示されます。<br />
                        試験カードをクリックし、年度を選択して「<b>演習を開始する</b>」をクリックすると、過去問演習が始まります。
                    </p>
                </div>
            </div>

            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1.2rem' }}>🩻 核医学の巻末図について</h2>
            <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.4rem', marginBottom: '2.5rem' }}>
                <p style={{ margin: '0 0 0.8rem', color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
                    核医学は個別図へ分割せず、問題文中の別紙No.に対応する巻末図ページを原本の配置のまま表示します。
                </p>
                <ul style={{ margin: 0, paddingLeft: '1.3rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    <li>問題文・選択肢のページではなく、該当する巻末図ページを表示します。</li>
                    <li>ページをクリックすると拡大表示でき、＋／−ボタンで倍率を調整できます。</li>
                    <li>VLMモデルの導入や外部アプリへの接続は不要です。</li>
                </ul>
            </div>

            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1.2rem' }}>🏠 ホーム画面と演習設定</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
                {[
                    ['試験カードの並べ替え', '試験カードを長押ししてドラッグすると、ホーム画面での表示順を変更できます。並び順は端末内に保存されます。'],
                    ['出題条件', '年度、出題数、ステータス、ジャンル、ランダム出題を組み合わせて演習を開始できます。'],
                    ['中断・再開', '演習画面左上の「← 中断」を押した場合だけ履歴を保存します。ホームには新しい順に最大4件が表示され、古い履歴は自動削除されます。'],
                    ['検索', 'ホームの「問題を検索」から、試験をまたいで問題文や選択肢を検索できます。'],
                ].map(([title, text]) => <div key={title} style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-color)', borderRadius: '0.65rem', padding: '1.1rem' }}><h3 style={{ margin: '0 0 0.4rem', fontSize: '1rem' }}>{title}</h3><p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{text}</p></div>)}
            </div>

            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1.2rem' }}>✏️ 問題データの修正</h2>
            <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.4rem', marginBottom: '2.5rem' }}>
                <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>演習画面から修正する</h3>
                <p style={{ margin: '0 0 1rem', color: 'var(--text-secondary)', fontSize: '0.92rem' }}>「設問を編集」を押すと、問題文・選択肢・画像・画像レジェンドをまとめて編集できます。登録元PDFがある場合は編集欄の右側に該当設問のページが表示されます。</p>
                <ul style={{ margin: '0 0 1.2rem', paddingLeft: '1.3rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    <li>画像カードはドラッグして表示順を変更できます。</li>
                    <li>PDF上の範囲を選択して、画像の追加や既存画像の差し替えができます。</li>
                    <li>通常レジェンドと構造化レジェンドを相互に切り替え、中央タイトル、上下左右のラベル、表示位置を編集できます。</li>
                    <li>正解・ジャンル・解説は「回答・解説を見る」の後に個別編集できます。</li>
                </ul>
                <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>試験管理画面から修正する</h3>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.92rem' }}>「データ管理 / バックアップ」で試験の「編集」を選ぶと、問題追加・削除を含めて年度単位で修正できます。編集欄と登録元PDFは左右2ペインで表示され、選択中の問題をPDFと見比べながら修正・画像切り抜きができます。</p>
            </div>

            {/* Crucial Backup Guide */}
            <div style={{
                background: 'var(--warning-soft)',
                borderLeft: '4px solid #dd6b20',
                color: '#dd6b20',
                padding: '1.5rem',
                borderRadius: '0.75rem',
                marginBottom: '2.5rem',
                boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                fontSize: '0.95rem'
            }}>
                <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--warning-text)', fontWeight: 'bold' }}>⚠️ データのバックアップについて</h3>
                <p style={{ margin: '0 0 0.8rem 0', color: 'var(--warning-text)' }}>
                    本アプリのデータは端末内のアプリ専用領域に保存されます。Mac/PC版の通常利用ではブラウザ履歴の影響を受けませんが、ブラウザ開発版ではサイトデータの消去によりデータが失われる場合があります。
                </p>
                <p style={{ margin: '0 0 0.8rem 0', color: 'var(--warning-text)' }}>
                    ただし、PC自体の初期化やアプリのデータフォルダの手動削除など、万が一の不測の事態に備えて定期的なバックアップを推奨します。
                </p>
                <p style={{ margin: 0, color: 'var(--warning-text)' }}>
                    「試験管理」の「<b>データ管理 / バックアップ</b>」にある「<b>📤 エクスポート (バックアップ)</b>」から、定期的にRadExamバックアップ（.radexam）を保存してください。試験データ、画像、登録元PDF、学習進捗が対象です。「<b>インポート (完全復元)</b>」で別のPCへ移行できます。
                </p>
            </div>

            {/* Back Button */}
            <div style={{ textAlign: 'center' }}>
                <button
                    onClick={() => router.push('/')}
                    style={{
                        padding: '0.8rem 2rem',
                        background: 'var(--accent)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '0.5rem',
                        fontWeight: 'bold',
                        fontSize: '1rem',
                        cursor: 'pointer',
                        boxShadow: '0 4px 6px rgba(49, 130, 206, 0.3)',
                        transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#2b6cb0';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(49, 130, 206, 0.4)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#3182ce';
                        e.currentTarget.style.boxShadow = '0 4px 6px rgba(49, 130, 206, 0.3)';
                    }}
                >
                    さっそくはじめる (ホームへ)
                </button>
            </div>
        </div>
    );
}
