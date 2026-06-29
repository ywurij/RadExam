import "./globals.css";

export const metadata = {
  title: "RadExam",
  description: "RadExam - Radiology Exam Practice",
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // Often used in PWA to prevent zooming issues on inputs, verify accessibility if strict.
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
      </body>
    </html>
  );
}
