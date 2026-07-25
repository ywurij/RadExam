## RadExam デスクトップ版

このReleaseは、macOS版とWindows版の配布候補を確認するためのドラフトです。

### ファイル

- `RadExam-*-mac-arm64.dmg` / `.zip`: Apple Silicon Mac
- `RadExam-*-mac-x64.dmg` / `.zip`: Intel Mac
- `RadExam-Setup-*-windows-x64.exe`: Windows NSISインストーラー
- `RadExam-Portable-*-windows-x64.exe`: Windows Portable版
- `SHA256SUMS.txt`: 配布ファイルのSHA-256チェックサム

### 公開前の注意

現在の自動ビルド成果物はコード署名されていません。一般公開する場合は、少なくとも次のいずれかを行ってください。

1. macOSをDeveloper IDで署名・公証し、Windowsをコード署名する。
2. 署名なしであることと、OSの警告画面から起動する手順をRelease本文へ明記する。

ドラフトを公開する前に、GitHubから成果物をダウンロードし、macOSとWindows 11の実機で起動、PDF取り込み、演習、編集、バックアップ移行を再確認してください。
