## RadExam デスクトップ版

放射線科専門医試験の問題登録・編集・演習に使えるMac/PC版です。

### v0.1.8の修正

- macOSのメニューバー左上にアプリ名ではなく実行ファイルのパスが表示される問題を修正しました。
- アプリ名を「RadExam」に統一し、内蔵サーバーの起動後も正しい名称を維持するようにしました。

### ダウンロードするファイル

- Apple Silicon Mac（M1以降）: `RadExam-*-macOS-Apple-Silicon.dmg`
- Intel Mac: `RadExam-*-macOS-Intel.dmg`
- Windows（推奨）: `RadExam-*-Windows-Installer-x64.exe`
- Windows（インストール不要）: `RadExam-*-Windows-Portable-x64.exe`

WindowsのInstaller版は通常利用向けで、スタートメニュー等へ登録されます。Portable版はインストールせず、そのEXEを置いた場所から起動したい場合に使用します。迷った場合はInstaller版を選んでください。

`SHA256SUMS.txt`は、ダウンロードしたファイルが破損・改変していないか確認するための上級者向け情報です。通常のインストールには使用しません。

### 初回起動時の注意

現在のmacOS版はAppleの公証なし、Windows版はコード署名なしです。このため、OSの警告が表示される場合があります。必ずこのGitHub Releaseから入手したファイルだけを使用してください。

- macOS: FinderでアプリをControlキーを押しながらクリックして「開く」を選ぶか、「システム設定」→「プライバシーとセキュリティ」から起動を許可します。
- Windows: Microsoft Defender SmartScreenが表示された場合は、配布元とファイル名を確認してから実行します。

データ移行・復旧に備え、更新前には「データ管理 / バックアップ」から`.radexam`バックアップを保存してください。
