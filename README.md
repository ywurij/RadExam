# RadExam

RadExamは、放射線科専門医試験の問題を登録・整理し、Mac、Windows、スマートフォン、タブレットで演習するための学習アプリです。

問題、解説、学習履歴などのデータ本体は各端末内に保存されます。クラウド同期を使用しない限り、インターネット接続なしで利用できます。

> このリポジトリと配布アプリには試験問題や試験PDFは含まれていません。利用者自身が、使用許諾や著作権を確認できる資料だけを登録してください。

## 主な機能

- PDFから試験・問題を登録し、問題文、選択肢、正答、画像、解説を編集
- 年度、ジャンル、正誤、お気に入りなどによる問題の絞り込み
- 正誤履歴、お気に入り、中断位置の端末内保存
- 解説、表、数式、ジャンルの編集
- `.radexam`ファイルによるバックアップ・端末間移行
- Google DriveまたはOneDriveを使った任意の端末間同期
- ライト、ダーク、端末設定連動の表示モード

## 版ごとの違い

| 版 | 対応端末 | 主な用途 |
| --- | --- | --- |
| Mac/PC版 | macOS、Windows | PDF取込、試験・問題の登録と編集、問題演習 |
| モバイル版（PWA） | iPhone、iPad、Android | Mac/PC版で作成したデータの演習、解説・ジャンル編集 |

モバイル版では、PDFからの新規試験作成や問題文・選択肢・画像の編集は行いません。登録済みの参照PDFは表示できます。

## Mac/PC版のインストール

[GitHub Releases](https://github.com/ywurij/RadExam/releases)から、お使いの端末に合うファイルをダウンロードします。

| 端末 | 選ぶファイル |
| --- | --- |
| Apple Silicon Mac（M1以降） | `RadExam-*-macOS-Apple-Silicon.dmg` |
| Intel Mac | `RadExam-*-macOS-Intel.dmg` |
| Windows（通常はこちら） | `RadExam-*-Windows-Installer-x64.exe` |
| Windows（インストール不要） | `RadExam-*-Windows-Portable-x64.exe` |

### macOS

1. DMGを開き、RadExamをApplicationsフォルダーへドラッグします。
2. ApplicationsからRadExamを起動します。
3. 未公証版で警告が出た場合は、FinderでControlキーを押しながらRadExamをクリックして「開く」を選びます。または「システム設定」→「プライバシーとセキュリティ」から起動を許可します。

### Windows

Installer版は通常のアプリとしてインストールされ、スタートメニューなどから起動できます。迷った場合はこちらを選んでください。

Portable版はインストールを行わず、ダウンロードしたEXEを置いた場所から直接起動します。一時的な動作確認、USBメモリ等への配置、PCへインストールしたくない場合に向いています。アプリを削除しても端末内データが別の保存領域に残る場合があるため、データ削除はアプリ内の「データ管理」から行ってください。

現在の配布物はコード署名されていないため、macOSやMicrosoft Defender SmartScreenの警告が表示される場合があります。必ず公式GitHub Releasesから取得したファイルだけを使用してください。

## iPhone・iPad・Androidへの導入

モバイル版はPWAとして、次のURLで配信しています。

**[RadExam モバイル版を開く](https://rad-exam.vercel.app/)**

- iPhone / iPad: Safariの共有メニューから「ホーム画面に追加」を選択
- Android: Chromeのメニューから「アプリをインストール」または「ホーム画面に追加」を選択

モバイル版のURLを変更すると、別アプリ・別保存領域として扱われることがあります。URL変更や再インストールの前に`.radexam`バックアップを保存してください。

詳しい配布方法は[配布・インストールガイド](docs/installation-guide.md)を参照してください。

## 基本的な使い方

1. Mac/PC版の「試験管理」からPDFを取り込み、試験名、年度、問題内容を確認します。
2. ホーム画面で試験、年度、ジャンル、出題数などを選んで演習を開始します。
3. 回答後に正誤、お気に入り、解説、ジャンルを記録します。
4. 「データ管理 / バックアップ」から、定期的に`.radexam`バックアップを書き出します。
5. 別端末へ移す場合は、バックアップを読み込むか、端末間共有でクラウド同期を使用します。

アプリ内の「使い方」ページにも、各画面の操作方法があります。

## データ保存とクラウド同期

- データ本体は常に各端末内へ保存され、オフラインでも演習・編集できます。
- Google DriveまたはOneDriveのアプリ専用領域へ、利用者の操作で変更を送受信できます。
- 同時に接続するクラウドは1サービスだけです。
- クラウド暗号化を有効にした場合、同じ同期パスフレーズがないと別端末で復元できません。
- クラウド同期はバックアップの代わりではありません。緊急復旧用の`.radexam`ファイルも保管してください。

クラウド同期を使わない場合、GoogleまたはMicrosoftアカウントへの接続は不要です。

## 更新時の注意

更新前に`.radexam`バックアップを保存してください。通常、Mac/PC版は新しいInstallerまたはDMGを使って更新でき、端末内データは維持されます。Portable版は新しいEXEへ置き換えます。

Releaseに含まれる`SHA256SUMS.txt`は、ダウンロードした配布ファイルが破損・改変していないか確認するための上級者向け情報です。通常のインストールには不要です。

## 開発者向け

Node.js 22を推奨します。

```bash
npm ci
npm run dev:desktop  # Mac/PC版
npm run dev:mobile   # モバイル版
npm test
```

デスクトップ配布版のビルドには、GitHub Actions側のOAuth設定が必要です。[GitHub Releases版のOAuth設定](docs/desktop-release-oauth.md)を参照してください。

- [GitHub・Vercel公開手順](docs/github-vercel-deployment.md)
- [GitHub Releasesによるデスクトップ版配布ガイド](docs/github-electron-release.md)
- [デスクトップ版の署名・公証ガイド](docs/desktop-code-signing-guide.md)

## 使用技術

Next.js、React、Electron、localForage / IndexedDB、Tiptap、KaTeXを使用しています。依存パッケージの正確なバージョンは`package-lock.json`で管理しています。一般利用者がインストール時に追加パッケージを用意する必要はありません。

## 利用条件

ソースコードのライセンス条件は現在整備中です。利用・再配布条件は各Releaseの案内に従ってください。
