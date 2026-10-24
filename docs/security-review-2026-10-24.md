# RadExam セキュリティ確認（2026-10-24 JST）

> 以下は修正前の調査記録。後続作業で依存関係とデスクトップ通信を修正し、npm auditは0件になった。修正内容・残課題は[修正結果](security-remediation-2026-10-24.md)参照。

対象: この作業ツリーの Windows/macOS Electron アプリとモバイル PWA。アプリ版数 0.1.15。

## 結論

依存関係のセキュリティ更新を優先して行う必要がある。特に Next.js と Electron、解説エディター関連を先に更新する。今回の作業ではアプリコード・依存関係・公開環境は変更していない。

`npm audit` の結果は23パッケージ（Critical 1 / High 14 / Moderate 2 / Low 6）。これは脆弱性のある依存パッケージとその影響を受ける親パッケージの数であり、23種類の攻撃がこのアプリで成立したという意味ではない。

`npm audit --omit=dev` は16パッケージ（Critical 1 / High 8 / Moderate 1 / Low 6）。ただし Electron は devDependencies にあっても配布物の実行環境そのものなので、この集計から除外して安全と判断してはいけない。PWAのビルド用依存も production dependencies に含まれているため、この16件がすべて配布物の実行時に到達可能とは限らない。

## 優先して対応する事項

### 1. 最優先: Next.js 16.3.0 の既知の重大な脆弱性（全版）

- 根拠: `package-lock.json` の next 16.3.0、sharp 0.35.3。`package.json:45`、`electron/main.js` の startPackagedNextServer。
- Windows版はNext.jsをElectronのメインプロセス内で起動する構成。Windowsファイルシステム上での認証不要コード実行の影響範囲に該当するバージョンを使用している。
- localhost限定待受とHost検証は実装されているため、インターネットへの直接公開サーバーとは露出が異なる。ただし、これを脆弱性修正の代替にしない。実際の攻撃経路やコード実行の再現は今回行っていない。
- 最新の修正版候補: **next / eslint-config-next 16.4.3**。sharpも **0.35.5以上**へ解決されることをlockfileで確認する。
- 公開PWAはVercel上。コード上で `use cache`、Server Actions、`next/og`、`next/image` の直接利用は見つからなかった。個別アドバイザリの成立条件は異なり、すべてのRCEがこのアプリで成立するという判定ではない。公式はCache Components関連について類似関数の有無にかかわらず更新を推奨している。
- 公式: [Windows RCE / GHSA-p293-qw3h-jr36](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36)、[10月14日のセキュリティ更新](https://nextjs.org/blog/nextjs-security-update-october-14-2026)。

### 2. 高: Electron 42.9.0 の修正不足とサポート終了（Windows/macOS）

- 根拠: `package.json:57`、lockfile の electron 42.9.0。
- sandbox、preloadキャッシュ、permission判定などに関する既知の警告がある。webview禁止、全権限拒否、別ウィンドウ禁止など現在の設定で成立条件を減らしているが、Chromiumを含むランタイム更新は必要。
- **43～45系のサポート中ブランチ**へ移行する。今回の最新版候補は **45.0.0**。更新後はmacOS arm64/x64とWindows x64で実機検証する。
- 同一メジャーの **42.11.18** は暫定候補にすぎない。42系は **2026-10-20** にサポート終了済みで、`^42.9.0` のままではサポート中メジャーへ上がらない。
- 公式: [Electron release schedule](https://releases.electronjs.org/schedule)、[Electron 45](https://www.electronjs.org/blog/electron-45-0)。

### 3. 高: エディターの貼り付け処理に既知のXSS（全版）

- 根拠: prosemirror-view **1.41.4**、@tiptap/core **3.15.3**。`src/components/AnswerEditor.js:562` でTiptapを使用し、クリップボードのHTMLを扱う。
- prosemirror-view **1.42.3未満**には、攻撃者のHTMLをエディターに貼り付けるとJavaScriptを実行し得る問題がある。保存・表示時のsanitizeだけに依存しない。
- すべての `@tiptap/*` を **3.32.0** に揃え、core **3.30.5以上**、prosemirror-view **1.42.3以上**、markdown-it **14.3.3以上**になったことを確認する。
- TiptapのmergeAttributesにも警告があるが、アプリの通常の固定スキーマにJSONを渡すだけで直ちに悪用できるとは限らない。今回、アプリ固有のXSSペイロードによる実行は確認していない。
- CSPには `script-src-attr 'none'` がありイベント属性は制限される一方、`script-src 'unsafe-inline'` が残る。CSPだけを対策とみなさない。
- 公式: [ProseMirror paste XSS](https://github.com/ProseMirror/prosemirror-view/security/advisories/GHSA-c8x8-7fp4-3x9w)、[Tiptap mergeAttributes](https://github.com/ueberdosis/tiptap/security/advisories/GHSA-cp6q-959q-f8rh)。

### 4. 中: 配布物の発行者確認とmacOS実行時保護（Windows/macOS）

- 根拠: `package.json:79` と `.github/workflows/release-desktop.yml`。
- macOSはad-hoc署名、`hardenedRuntime: false`、`notarize: false`。WindowsのCIビルドもunsigned設定。
- Developer ID署名・Hardened Runtime・公証、Windowsのコード署名を導入する。証明書とCI資格情報が必要。設定値だけを切り替えて完了とはしない。
- SHA-256チェックサム、GitHubの成果物attestation手順は既にあるが、OSが発行者を認証する署名の代わりにはならない。

### 5. 中: Electronクラウド通信のリダイレクト先未検証・取得量制限の適用時点

- 根拠: `electron/cloudSyncFetch.js:98-116`。
- 最初のURLは許可リストで検証するが、その後 `redirect: 'follow'` で移動先を検証しない。許可先が外部へのリダイレクトを返す状況では、メインプロセスが意図しない宛先へ通信し得る。許可先で攻撃者がリダイレクトを制御できることが前提で、実サービス上での悪用成立は未確認。
- `Content-Length` がない・不正な場合、512MiB制限は `arrayBuffer()` による全量確保の後でしか評価しない。巨大レスポンスでは制限前にメインプロセスのメモリを消費し得る。
- この関数には明示的なタイムアウト・AbortSignalがなく、遅い通信の打ち切りを呼び出し側から伝えられない。
- 対策: 手動リダイレクトと各段のURL検証・回数上限、ストリーム読取中の累積バイト制限とcancel、ヘッダー取得から本文読取完了までを覆うタイムアウトを設ける。

## その他の更新候補

以下は2026-10-24のnpmレジストリ照合結果。最新版であることと、現在のアプリから脆弱性に到達することは別に扱う。

| パッケージ | 現在 | 更新候補 | 理由・注意 |
| --- | --- | --- | --- |
| sanitize-html | 2.17.6 | 2.18.1 | サニタイズ関連の既知の修正。現在はSVG/meta等を許可しておらず個々の条件は限定される |
| KaTeX | 0.16.27 | 0.19.1 | prototype pollutionが前提のtrust制限回避。audit上は0.18.2未満が対象。wantedの0.16.47だけでは警告解消にならない |
| serialize-javascript | 7.1.0 | 7.1.3以上 | overridesが脆弱な版を固定。親パッケージとの互換性も確認する |
| pdfjs-dist | 6.2.108 | 6.4.299 | 今回audit警告なし。PDF処理系の保守更新候補。workerとwasm/cmaps/fontsの整合を確認 |
| react / react-dom | 19.2.3 | 19.3.1 | 今回の直接audit警告なし。Next.js更新と組み合わせて確認 |
| electron-builder | 26.15.3 | 26.18.0 | ビルド・配布ツールの保守更新 |
| react-hook-form | 7.69.0 | 7.91.0 | 保守更新 |
| sass | 1.97.1 | 1.106.1 | 保守更新 |
| yet-another-react-lightbox | 3.27.0 | 3.32.2 | 保守更新 |
| eslint | 9.39.2 | 9.39.5 | 既存メジャー内候補。最新10.13.0への移行は別途互換性確認 |
| fuse.js | 7.1.0 | 7.5.0 | 保守更新 |

推移依存には sharp、markdown-it、brace-expansion、browserslist、fast-uri、source-map-js、undici、@xmldom/xmldom、http-cache-semantics、js-yaml、@humanfs/node の警告もある。全件の範囲と修正情報は添付JSON参照。ビルド時だけに使うものも含む。

`npm audit fix --force` は一括実行しない。next-pwa関連で **10.2.6へのダウングレード**が提案されており、古い構成へ戻すことが適切とは限らない。serialize-javascriptの固定を見直し、Workbox依存・生成SWを再確認する。

## 改善余地と既存対策

- CSPのinline script許可はnonce/hash方式へ移行する余地がある。Next.jsのレンダリング・PWAオフライン動作・Google認証との互換性を確認して対応する。
- IndexedDB/localStorageの学習データにはアプリ独自の保存時暗号化がない。クラウドやバックアップの暗号化は端末内データ全体を暗号化するものではない。端末のディスク暗号化・画面ロックを前提とする設計か明文化する。
- Google desktop client secretを配布物へ入れる構成は確認した。インストール型OAuthクライアントの値は利用者が抽出できるため、サーバーの秘密鍵として信頼しない。PKCEは実装されている。値自体は本レポートへ出力していない。
- Electronは `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`。外部画面への遷移・webview・権限付与を制限。IPC送信元のwebContentsとoriginを検証している。
- Electron fusesでRunAsNode、NODE_OPTIONS、inspect引数を禁止し、ASAR検証を有効化するビルド手順がある。今回の配布バイナリ検証は未実施。
- Desktop OAuthはPKCE/state、OS safeStorageによるトークン保存を使用。Webのアクセストークン・更新トークンはメモリ内管理。Microsoft認証の一時state/verifierはlocalStorageへ保存し、期限とstateを検証して削除する。
- HTML表示と取込にはsanitize処理がある。バックアップのサイズ・件数・危険なキーの検証もある。
- バックアップ・クラウド暗号化はAES-GCM、ランダムIV、PBKDF2-SHA256 600,000回を使用し、復号条件に上限・形式検証がある。暗号実装全体の専門的な証明・監査は今回の範囲外。
- PWAの設定では外部認証・クラウドAPIをruntime cacheの対象から除外している。
- 公開PWAの `/` にHEADアクセスし、HTTPS、HSTS、CSP、nosniff、DENY、Permissions-Policy等の応答を確認した。公開物の依存バージョンや全ルートのヘッダーまでは確認できていない。
- Git管理対象のテキストを代表的な秘密鍵・GitHub token・Google API key・AWS access keyのパターンで検査し、該当0件。網羅的なsecret scanやGit履歴の検査ではない。
- DependabotはnpmとGitHub Actionsを週次確認する設定がある。リリースCIではauditを必須検査にしていない。重大な本番依存とElectronを見落とさない検査を追加する余地がある。

## 実施した検証と限界

- ソース・lockfile・パッケージ設定・リリースCI・OAuth・IPC・同期通信・HTML処理・暗号化・PWAキャッシュ設定を静的確認。
- `npm audit --json`、`npm audit --omit=dev --json`、`npm outdated --json` を公式npmレジストリへ照会。
- `npm test`: **255成功 / 0失敗**。既存テストの成功は既知の脆弱性が存在しないという証明ではない。
- 公開PWAに対する検証は正常なHEAD取得のみ。攻撃リクエスト・侵入試験は行っていない。
- Windows実機、iOS/Android実機、現在配布されているDMG/EXE、Vercel管理設定、GitHub上のsecret値は確認していない。手元の古いdist成果物を現行配布版とみなしていない。

## 推奨する対応順序

1. Next.js / eslint-config-next、sharpを更新。
2. Tiptap一式、ProseMirror、sanitize-html、KaTeX、serialize-javascriptを更新し、lockfileを再監査。
3. Electronをサポート中メジャーへ移行し、通信制限を修正。
4. desktop/mobile両方の本番ビルド、オフライン起動、PDF表示、HTML貼り付け、バックアップ復元、Google/OneDrive同期を検証。
5. Windows/macOSの実機確認後、配布物を再作成・PWAを再デプロイ。署名・公証は資格情報の準備と合わせて導入。

根拠データ: [全依存audit](security-review-2026-10-24/npm-audit.json)、[本番依存audit](security-review-2026-10-24/npm-audit-production.json)、[outdated](security-review-2026-10-24/npm-outdated.json)、[テスト出力](security-review-2026-10-24/tests.txt)。
