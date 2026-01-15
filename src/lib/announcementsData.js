export const ANNOUNCEMENTS = [
    {
        id: '2',
        date: '2026-01-16',
        title: 'オフライン機能の強化 (自動ダウンロード)',
        content: `・試験（Radiologyなど）を選択すると、自動的に画像がダウンロードされるようになりました。\n・一度ダウンロードすれば、オフライン環境でも新しい問題の画像が表示されます。\n・ダウンロードはバックグラウンドで行われるため、待ち時間なく演習を開始できます。\n・手動ダウンロードボタン (📥) も各試験カードに残しています。`
    },
    {
        id: '1',
        date: '2026-01-12',
        title: '解説の入力不具合を修正',
        content: `・解説入力時に、前の問題の解説が残ってしまう不具合を修正しました。\n・ダークモード時の表示崩れを修正しました。`
    }
];

export const getLatestAnnouncementId = () => {
    if (ANNOUNCEMENTS.length === 0) return null;
    return ANNOUNCEMENTS[0].id; // Assuming sorted by newest first
};
