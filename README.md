# RadExam - 放射線科専門医試験学習アプリ

高度な学習機能と解説編集機能を備えた、専門医試験対策のためのWebアプリケーションです。
Next.js と Firebase を使用して構築されており、PC・タブレット・スマートフォンなどのクロスプラットフォームで使用可能です。

## 主な機能

### 1. スマートな問題演習
*   **高度なフィルタリング**:
    *   「不正解のみ」「お気に入り（★）のみ」といった条件で問題を絞り込み。
    *   複数の条件を「AND（かつ）」「OR（または）」で組み合わせ可能。
*   **自動レジューム（中断再開）**:
    *   演習を途中で閉じても、次回アクセス時に「前回の続き」から即座に再開できます。
    *   選択した条件や問題の並び順も保持されます。
*   **出題数制限**: 10問、50問など、隙間時間に合わせて出題数を選択可能。

### 2. 高機能な解説編集 (Rich Text Editor)
問題の解説を自分専用にカスタマイズできます。
*   **Tiptapエディタ採用**: 直感的な操作でリッチなテキストを作成。
*   **多機能フォーマット**:太字、色、リスト、テーブル（表）作成に対応。
*   **数式入力**: LaTeX記法（$E=mc^2$）をサポート。
*   **画像挿入**:
    *   Firebase Storageと連携し、ローカルの画像をアップロード可能。
    *   iPadやスマホから撮影した写真もそのまま挿入できます。
*   **変更の共有**: 編集した内容はクラウド（Firestore）に保存され、他の端末でも同期されます。

### 3. 学習管理
*   **ステータス管理**: 各問題に「正解」「不正解」「未回答」を記録。
*   **お気に入り**: 重要な問題や後で見直したい問題に★マークを付与。
*   **進捗同期**: ログインすれば、どの端末からアクセスしても学習状況が同期されます。

---

## 技術スタック
*   **Frontend**: Next.js 16 (App Router), React 19, Sass (CSS Modules)
*   **PWA**: オフライン対応（Service Worker）
*   **Editor**: Tiptap, KaTeX (Math), ProseMirror
*   **Backend**: Firebase (Authentication, Firestore, Storage)

---

## セットアップ手順

### 1. 環境構築
```bash
# 依存パッケージのインストール
npm install
```

### 2. 環境変数 (.env.local)
以下の内容でルートディレクトリに `.env.local` ファイルを作成し、Firebaseの設定情報を記述してください。

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

### 3. 起動
```bash
npm run dev
```
ブラウザで `http://localhost:3000` にアクセスします。

---

## デプロイ (Vercel)
本番環境として Vercel へのデプロイを推奨します。

1.  GitHubにコードをプッシュ。
2.  Vercelと連携し、リポジトリをインポート。
3.  Vercelの管理画面で上記の「環境変数」を設定。
4.  自動的にビルド・デプロイが完了し、URLが発行されます。

---

## ライセンス
Private / Personal Use Only
