import LegalPage from '@/components/LegalPage';

export const metadata = {
    title: 'お問い合わせ | RadExam',
    description: 'RadExamへの不具合報告、ご質問、ご要望の窓口です。',
};

export default function ContactPage() {
    return (
        <LegalPage
            eyebrow="CONTACT"
            title="お問い合わせ"
            lead="不具合報告、ご質問、機能のご要望は、RadExamのGitHubリポジトリで受け付けます。"
        >
            <section>
                <h2>通常のお問い合わせ</h2>
                <p>GitHub Issuesからお問い合わせください。公開されている既存の報告を確認したうえで、新しいIssueを作成できます。</p>
                <p><a href="https://github.com/ywurij/RadExam/issues" target="_blank" rel="noreferrer">RadExamのIssuesを開く</a></p>
            </section>

            <section>
                <h2>報告に含める情報</h2>
                <ul>
                    <li>利用している版（macOS、Windows、iPhone/iPad、Android）</li>
                    <li>RadExamのバージョン</li>
                    <li>問題が起きるまでの操作と、表示されたエラー</li>
                    <li>再現に必要な範囲の画面画像</li>
                </ul>
            </section>

            <section>
                <h2>公開しないでください</h2>
                <p>Issueは公開されます。氏名、メールアドレス、OAuthトークン、クライアントシークレット、試験PDF、著作権上公開できない問題文、クラウドファイルのURLなどを投稿しないでください。</p>
            </section>

            <section>
                <h2>セキュリティ上の問題</h2>
                <p>未公開の脆弱性はIssueへ投稿せず、GitHubの非公開報告機能をご利用ください。</p>
                <p><a href="https://github.com/ywurij/RadExam/security/advisories/new" target="_blank" rel="noreferrer">脆弱性を非公開で報告する</a></p>
            </section>

            <section>
                <h2>対応について</h2>
                <p>個人開発のため、回答や修正に時間がかかる場合があります。すべてのご要望への対応や回答期限を保証するものではありません。</p>
            </section>
        </LegalPage>
    );
}
