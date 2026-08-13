## RadExam デスクトップ版

このReleaseは、macOS版とWindows版の配布候補を確認するためのドラフトです。

### ファイル

- `RadExam-*-mac-arm64.dmg` / `.zip`: Apple Silicon Mac
- `RadExam-*-mac-x64.dmg` / `.zip`: Intel Mac
- `RadExam-Setup-*-windows-x64.exe`: Windows NSISインストーラー
- `RadExam-Portable-*-windows-x64.exe`: Windows Portable版
- `RadExam-v*-sbom.cdx.json`: 使用パッケージを記録したCycloneDX SBOM
- `SHA256SUMS.txt`: 配布ファイルのSHA-256チェックサム

### 公開前の注意

現在のmacOS版は証明書なしのad-hoc署名で、公証されていません。Windows版もコード署名されていません。一般公開する場合は、少なくとも次のいずれかを行ってください。

1. macOSをDeveloper IDで署名・公証し、Windowsをコード署名する。
2. macOS版がad-hoc署名・未公証、Windows版が署名なしであることと、OSの警告画面から起動する手順をRelease本文へ明記する。

macOS版の初回起動時は、FinderでアプリをControlキーを押しながらクリックして「開く」を選ぶか、「システム設定」→「プライバシーとセキュリティ」から「このまま開く」を選んでください。

ドラフトを公開する前に、GitHubから成果物をダウンロードし、macOSとWindows 11の実機で起動、PDF取り込み、演習、編集、バックアップ移行を再確認してください。
