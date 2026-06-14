"use client";

import { useRouter } from 'next/navigation';

export default function UsagePage() {
    const router = useRouter();

    return (
        <div style={{
            maxWidth: '900px',
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
                ご自身で入手した試験問題（PDFなど）から、AI（ChatGPT、Claude、Gemini等）を介して作成した問題データを、<b>ご利用中の端末内（アプリの内部ストレージ）に安全に保存して演習を行う</b>仕組みです。プライバシーが完全に保護され、外部のサーバー等にデータが送信されることはありません。
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
                            AI指示プロンプトのコピー
                        </h4>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.92rem', color: '#4a5568' }}>
                        トップ画面右上の「<b>⚙️ 試験管理</b>」ボタンを押し、「<b>AI指示プロンプト</b>」タブを開いて、プロンプト文面をコピーします。
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
                            AI（ChatGPTやClaude等）で問題データの作成
                        </h4>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.92rem', color: '#4a5568' }}>
                        ChatGPT (GPT-4o推奨) や Claude、Gemini などのチャットAIを開き、過去問PDFファイル（または抽出したテキスト）を添付したうえで、コピーしたプロンプトを送信します。<br />
                        AIが出力した問題データのJSONコードをコピーするか、JSONファイル（.json）として保存します。
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
                            データのインポートと自動補正
                        </h4>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.92rem', color: '#4a5568' }}>
                        「試験管理」の「<b>試験の追加 (JSON貼り付け)</b>」画面へ戻り、コピーしたJSONコードを貼り付けるか、「<b>📁 JSONファイルを選択</b>」ボタンから保存したファイルを選択して「解析」を実行します。<br />
                        <span style={{ color: '#2b6cb0' }}>※AIの出力が `1` などの連番IDになっていた場合も、システムが自動的に「年度＋3桁の問題番号（例: 2026001）」の7桁IDに自動補正します。</span>
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
                            画像の紐付けとマージ（追加）設定
                        </h4>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.92rem', color: '#4a5568' }}>
                        画像がある問題については、プレビュー上の画像枠をクリックするか、ファイルをドラッグ＆ドロップして個別に登録します（画像はBase64形式で試験データ内に保存されます）。<br />
                        その後、上部に<b>試験ID</b>と<b>試験名</b>を入力します。<br />
                        <span style={{ fontWeight: 'bold' }}>【年度の追加マージ】</span><br />
                        入力した試験IDが既存の試験と重複している場合、「<b>既存の試験に問題を追加（マージ）する</b>」のチェックボックスが表示されます。チェックを入れて保存することで、同一の試験カードの中に複数年度の過去問をまとめて管理できます。
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
                    本アプリのデータは、アプリ専用の安全なデータ領域（ブラウザとは独立した内部ストレージ）に保存されます。そのため、<b>Safari や Google Chrome などの「通常のブラウザ」で閲覧履歴やキャッシュを消去しても、本アプリのデータが消去されることはありません。</b>
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
