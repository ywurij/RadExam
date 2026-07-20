import "./globals.css";

const isMobile = process.env.NEXT_PUBLIC_APP_TARGET === "mobile";

export const metadata = {
  title: isMobile ? "RadExam Mobile" : "RadExam",
  description: isMobile ? "端末内で使える放射線科試験問題演習アプリ" : "放射線科専門医試験学習アプリ",
  manifest: "/manifest.json",
  applicationName: "RadExam",
  ...(isMobile ? { appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "RadExam",
  }, icons: {
    apple: "/assets/images/icon-192x192.png",
  }} : {}),
};

export const viewport = {
  themeColor: "#f8fafc",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>
        {children}
      </body>
    </html>
  );
}
