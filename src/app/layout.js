import "./globals.css";
import CloudSyncLifecycle from "@/components/CloudSyncLifecycle";
import AppPrivacyLockBoundary from "@/components/AppPrivacyLockBoundary";

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
  const themeInitialization = `(function(){try{var p=localStorage.getItem('radexam_theme_preference');if(!['system','light','dark'].includes(p))p='system';var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var t=p==='system'?(d?'dark':'light'):p;document.documentElement.dataset.themePreference=p;document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;document.documentElement.dataset.appPrivacyLock=localStorage.getItem('radexam_app_privacy_lock_v1')?'locked':'unlocked';}catch(e){document.documentElement.dataset.theme='light';}})();`;
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInitialization }} />
        <AppPrivacyLockBoundary>
          <CloudSyncLifecycle />
          {children}
        </AppPrivacyLockBoundary>
      </body>
    </html>
  );
}
