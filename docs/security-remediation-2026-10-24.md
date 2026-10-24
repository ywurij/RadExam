# セキュリティ修正結果（2026-10-24）

ブランチ: `codex/security-hardening`

## 対応内容

重大な既知の脆弱性から順に依存関係を更新し、デスクトップのクラウド通信を修正した。

| 対象 | 更新前 | 更新後（lockfile） |
| --- | --- | --- |
| next / eslint-config-next | 16.3.0 | 16.4.3 |
| sharp | 0.35.3 | 0.35.5 |
| Electron | 42.9.0 | 45.0.0 |
| electron-builder | 26.15.3 | 26.18.0 |
| @tiptap/* | 3.14.0 / 3.15.3 | 3.32.0 |
| prosemirror-view | 1.41.4 | 1.42.8 |
| sanitize-html | 2.17.6 | 2.18.1 |
| KaTeX | 0.16.27 | 0.19.1 |
| serialize-javascript（override） | 7.1.0 | 7.1.3 |

ほかの脆弱な推移依存も、互換範囲内の `npm audit fix` で更新。`--force` やnext-pwaのダウングレードは使用していない。今回警告のない依存関係は、無関係な最新版へ一括更新していない。

`electron/cloudSyncFetch.js` は次のように変更した。

- HTTPS・許可ホスト・APIパス・資格情報なし・標準ポートを検証する。
- リダイレクトを手動で追跡し、毎回URLを再検証。最大5回で停止する。
- originが変わるリダイレクトではAuthorizationを除去。通常のfetchと同様、POSTの301/302や303ではGETへ変換し、本文を再送しない。307/308ではメソッドと本文を維持する。
- レスポンスをストリームで読み、512MiBを超えた時点で読み取りを中止する。Content-Length省略・偽装でも制限する。
- 15分の上限で、ヘッダー待ち・リダイレクト・本文読取を含む通信全体を中断する。
- IPC本文はArrayBuffer/typed arrayに限定し、サイズ検査前に任意の数値・lengthからバッファを確保しない。送信上限32MiBを維持する。

リリースCIには `npm run security:check`（`npm audit --audit-level=high`）を追加した。ElectronがdevDependenciesに置かれていることを考慮し、開発用も含めて監査する。

新しいeslint-plugin-react-hooksが検出した8件のエラーにも対応した。更新前のlint環境を一時フォルダーに再現し、更新前はエラー0・警告8、更新後は既存コードに新たに8エラーが出ることを確認した。

- 非同期のデータ取得・同期状態の取得後に状態を更新する流れを明示。
- 問題カードは問題ID・参照PDFが変わるときにkeyで状態をリセットする構成へ変更。
- PDF切り抜きボタンの描画判定をrefから既存のstateへ変更。
- 検索結果のReact keyからMath.randomを除去。

## 検証

- `npm run security:check`: **既知の脆弱性0件**（全依存。修正前23件）。
- `npm test`: **264成功、0失敗**。新規9テストで不正本文、許可外リダイレクト、認証ヘッダー除去、相対URL、メソッド変換、ループ、サイズ超過、ヘッダー待ち・本文待ちタイムアウトを検証。
- `npm run lint`: **エラー0、警告8**。警告は従来のimg要素・useMemo依存に関するもの。
- `npm run build:desktop` / `npm run build:mobile`: **成功**。モバイルのService Workerも再生成。
- Electron **45.0.0** 実行ファイルの取得・バージョン確認に成功。
- 既存の学習データを触らない一時appDataを使った検証ハーネスで、Electron 45からデスクトップ本番サーバーを起動し、画面の `did-finish-load` を確認。パッケージ起動分岐を検証するため、ハーネス内でapp.isPackaged/app.getAppPathを切り替えた。配布アプリそのものの起動検証と同一ではない。
- macOS arm64の `.app` 作成に成功（electron-builder、`--dir --publish never`）。`codesign --verify --deep --strict` に成功。
- 作成した.appのfusesを読み取り、RunAsNode・NODE_OPTIONS・inspect引数・file特権がOFF、Cookie暗号化・ASAR整合性検証・OnlyLoadAppFromAsarがONであることを確認。
- 最終モバイル本番ビルドでホームとデータ管理・クラウド同期設定画面の描画をブラウザーで確認。

## 残る作業・制約

- Windows実機、macOS Intel実機、iOS/Android実機での確認は未実施。
- OAuthの実アカウント接続、クラウドサービスへの実送受信、大容量PDFの実データ操作、PWAのオフライン利用は今回の動作確認に含めていない。関連する既存の自動テストは成功している。
- macOS Developer ID署名・Hardened Runtime・公証、Windowsコード署名は未導入。証明書・資格情報の準備と、各OS上での配布確認を伴う別工程として残す。
- Electron 45は既存safeStorageの同期APIに非推奨警告を出す。今回は従来のOS暗号化保存を維持しており、非同期APIへの移行は今後の課題。
- CSPのunsafe-inline許可と、端末内学習データのアプリ独自の保存時暗号化については、当初のレポートに記載した改善余地が残る。
- GitHubへのpush、Release公開、モバイル版デプロイは行っていない。既存配布物・公開PWAにこの修正が適用されたという意味ではない。
- audit 0件は確認時点のレジストリに既知の警告がないことを示すもので、すべての脆弱性がないという保証ではない。

修正後の根拠: [npm audit](security-review-2026-10-24/npm-audit-after.json)、[監査コマンド](security-review-2026-10-24/security-check-after.txt)、[自動テスト](security-review-2026-10-24/tests-after.txt)、[lint](security-review-2026-10-24/lint-after.txt)。
