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
            color: '#2d3748',
            backgroundColor: '#f7fafc',
            minHeight: '100vh',
            lineHeight: 1.7
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '2.5rem',
                borderBottom: '1px solid #e2e8f0',
                paddingBottom: '1.2rem'
            }}>
                <div>
                    <h1 style={{ fontSize: '2rem', fontWeight: 800, margin: 0, color: '#1a202c', letterSpacing: '-0.025em' }}>
                        ❓ RadExam 使い方ガイド
                    </h1>
                    <p style={{ margin: '0.4rem 0 0 0', color: '#718096', fontSize: '0.95rem' }}>
                        PDFから試験問題を取り込み、演習を行うための手順を解説します。
                    </p>
                </div>
                <button
                    onClick={() => router.push('/')}
                    style={{
                        padding: '0.6rem 1.2rem',
                        background: '#fff',
                        border: '1px solid #cbd5e0',
                        borderRadius: '0.5rem',
                        cursor: 'pointer',
                        fontWeight: '600',
                        color: '#4a5568',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                        transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#a0aec0';
                        e.currentTarget.style.background = '#f7fafc';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#cbd5e0';
                        e.currentTarget.style.background = '#fff';
                    }}
                >
                    ← アプリに戻る
                </button>
            </div>

            {/* Note about copyright/local concept */}
            <div style={{
                background: '#ebf8ff',
                borderLeft: '4px solid #3182ce',
                color: '#2b6cb0',
                padding: '1.25rem',
                borderRadius: '0.5rem',
                marginBottom: '2rem',
                fontSize: '0.95rem'
            }}>
                <h3 style={{ margin: '0 0 0.5rem 0', fontWeight: 'bold' }}>💡 本アプリの仕組み</h3>
                著作権保護およびデータ転載防止の観点から、本アプリにはあらかじめ試験データが登録されていません。<br />
                ご自身で入手した試験問題PDFから問題データを抽出し、<b>ご利用中の端末内（アプリの内部ストレージ）に安全に保存して演習を行う</b>仕組みです。プライバシーが保護され、外部のサーバー等にデータが送信されることはありません。
            </div>

            {/* Step-by-step Guide */}
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#2d3748', marginBottom: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                🚀 過去問インポートの5ステップ
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '2.5rem' }}>
                {/* Step 1 */}
                <div style={{
                    background: '#fff',
                    padding: '1.5rem',
                    borderRadius: '0.75rem',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
                    border: '1px solid #edf2f7'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
                        <span style={{
                            background: '#3182ce',
                            color: 'white',
                            fontWeight: '800',
                            fontSize: '0.8rem',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '0.25rem',
                            boxShadow: '0 2px 4px rgba(49, 130, 206, 0.2)'
                        }}>STEP 1</span>
                        <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: '#1a202c' }}>
                            試験管理画面を開く
                        </h4>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.92rem', color: '#4a5568' }}>
                        トップ画面右上の「<b>⚙️ 試験管理</b>」ボタンを押し、「<b>試験データインポート</b>」画面を開きます。
                    </p>
                </div>

                {/* Step 2 */}
                <div style={{
                    background: '#fff',
                    padding: '1.5rem',
                    borderRadius: '0.75rem',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
                    border: '1px solid #edf2f7'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
                        <span style={{
                            background: '#3182ce',
                            color: 'white',
                            fontWeight: '800',
                            fontSize: '0.8rem',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '0.25rem',
                            boxShadow: '0 2px 4px rgba(49, 130, 206, 0.2)'
                        }}>STEP 2</span>
                        <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: '#1a202c' }}>
                            試験種別を選んでPDFを読み込む
                        </h4>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.92rem', color: '#4a5568' }}>
                        「<b>放射線科専門医試験</b>」「<b>放射線診断専門医試験</b>」「<b>IVR専門医試験</b>」など対象の試験を選択し、過去問PDFファイルをドロップするかクリックして選択します。<br />
                        アプリがPDFを解析し、問題文、選択肢、埋め込み画像を自動で抽出します。
                    </p>
                </div>

                {/* Step 3 */}
                <div style={{
                    background: '#fff',
                    padding: '1.5rem',
                    borderRadius: '0.75rem',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
                    border: '1px solid #edf2f7'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
                        <span style={{
                            background: '#3182ce',
                            color: 'white',
                            fontWeight: '800',
                            fontSize: '0.8rem',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '0.25rem',
                            boxShadow: '0 2px 4px rgba(49, 130, 206, 0.2)'
                        }}>STEP 3</span>
                        <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: '#1a202c' }}>
                            抽出結果を確認する
                        </h4>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.92rem', color: '#4a5568' }}>
                        自動抽出された問題文、選択肢、画像、レジェンドを一覧で確認します。<br />
                        問題番号や本文、選択肢に気になる点があれば、この画面でそのまま修正できます。
                    </p>
                </div>

                {/* Step 4 */}
                <div style={{
                    background: '#fff',
                    padding: '1.5rem',
                    borderRadius: '0.75rem',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
                    border: '1px solid #edf2f7'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
                        <span style={{
                            background: '#3182ce',
                            color: 'white',
                            fontWeight: '800',
                            fontSize: '0.8rem',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '0.25rem',
                            boxShadow: '0 2px 4px rgba(49, 130, 206, 0.2)'
                        }}>STEP 4</span>
                        <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: '#1a202c' }}>
                            保存先の試験を設定する
                        </h4>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.92rem', color: '#4a5568' }}>
                        「<b>既存の試験に追加 (マージ)</b>」するか、「<b>新しい試験として登録</b>」するかを選びます。<br />
                        既存試験へ追加する場合は保存先の試験を選択し、新規登録する場合は<b>試験ID</b>と<b>試験名</b>を入力します。
                    </p>
                </div>

                {/* Step 5 */}
                <div style={{
                    background: '#fff',
                    padding: '1.5rem',
                    borderRadius: '0.75rem',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
                    border: '1px solid #edf2f7'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
                        <span style={{
                            background: '#3182ce',
                            color: 'white',
                            fontWeight: '800',
                            fontSize: '0.8rem',
                            padding: '0.2rem 0.6rem',
                            borderRadius: '0.25rem',
                            boxShadow: '0 2px 4px rgba(49, 130, 206, 0.2)'
                        }}>STEP 5</span>
                        <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: '#1a202c' }}>
                            保存して演習を開始する
                        </h4>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.92rem', color: '#4a5568' }}>
                        画面下部の「<b>保存する</b>」ボタンをクリックします。保存が完了すると、トップ画面（ホーム）に新しく登録した試験カードが表示されます。<br />
                        試験カードをクリックし、年度を選択して「<b>演習を開始する</b>」をクリックすると、過去問演習が始まります。
                    </p>
                </div>
            </div>

            {/* Crucial Backup Guide */}
            <div style={{
                background: '#fffaf0',
                borderLeft: '4px solid #dd6b20',
                color: '#dd6b20',
                padding: '1.5rem',
                borderRadius: '0.75rem',
                marginBottom: '2.5rem',
                boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                fontSize: '0.95rem'
            }}>
                <h3 style={{ margin: '0 0 0.5rem 0', color: '#c05621', fontWeight: 'bold' }}>⚠️ データのバックアップについて</h3>
                <p style={{ margin: '0 0 0.8rem 0', color: '#7b341e' }}>
                    本アプリのデータは、アプリ専用の安全なデータ領域に保存されます。通常のWebブラウザの履歴削除やキャッシュ削除によって、本アプリのデータが消去されることはありません。
                </p>
                <p style={{ margin: '0 0 0.8rem 0', color: '#7b341e' }}>
                    ただし、PC自体の初期化やアプリのデータフォルダの手動削除など、万が一の不測の事態に備えて定期的なバックアップを推奨します。
                </p>
                <p style={{ margin: 0, color: '#7b341e' }}>
                    「試験管理」の「<b>追加済み試験の管理</b>」タブにある「<b>📤 エクスポート (バックアップ)</b>」ボタンより、定期的にバックアップ用のJSONファイルをPC上に保存してください。不測の事態でデータが個人環境から消失した場合や、別のPCへ移行したい場合は、そのバックアップファイルを「<b>インポート (復元)</b>」することで完璧に元の状態に復元可能です。
                </p>
            </div>

            {/* Back Button */}
            <div style={{ textAlign: 'center' }}>
                <button
                    onClick={() => router.push('/')}
                    style={{
                        padding: '0.8rem 2rem',
                        background: '#3182ce',
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
