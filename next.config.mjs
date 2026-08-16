import withPWAInit from "@ducanh2912/next-pwa";
import path from "node:path";

const appTarget = process.env.APP_TARGET === "mobile" ? "mobile" : "desktop";
const targetModule = (desktopPath, mobilePath) => path.resolve(process.cwd(), appTarget === "mobile" ? mobilePath : desktopPath);

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development" || appTarget === "desktop",
  register: true,
  skipWaiting: true,
  reloadOnOnline: false, // PREVENT AUTO RELOAD ON RECONNECT
  // Exclude images from being precached (public folder scan)
  publicExcludes: ["!assets/images/**/*"],
  workboxOptions: {
    runtimeCaching: [
      {
        // Cache images when they are loaded
        urlPattern: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/assets/images/"),
        handler: "CacheFirst",
        options: {
          cacheName: "question-images",
          expiration: {
            maxEntries: 500,
            maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
          },
        },
      },
      {
        // 外部の認証・クラウドAPI応答は端末キャッシュに保存しない。
        urlPattern: ({ sameOrigin, url }) => sameOrigin && !url.pathname.startsWith("/api/"),
        handler: "NetworkFirst",
        options: {
          cacheName: "offline-cache-v2",
          expiration: {
            maxEntries: 200,
          },
        },
      },
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.RADEXAM_NEXT_DIST_DIR || ".next",
  output: appTarget === "desktop" ? "standalone" : undefined,
  env: {
    NEXT_PUBLIC_APP_TARGET: appTarget,
  },
  async headers() {
    const scriptSources = [
      "'self'",
      "'unsafe-inline'",
      "https://accounts.google.com",
      ...(process.env.NODE_ENV === "development" ? ["'unsafe-eval'"] : []),
    ];
    const contentSecurityPolicy = [
      "default-src 'self'",
      `script-src ${scriptSources.join(" ")}`,
      "script-src-attr 'none'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://login.microsoftonline.com https://graph.microsoft.com https://*.1drv.com https://*.onedrive.com https://onedrive.live.com https://*.onedrive.live.com https://*.storage.live.com https://*.livefilestore.com https://*.microsoftpersonalcontent.com https://*.sharepoint.com https://*.sharepoint-df.com",
      "frame-src https://accounts.google.com https://login.microsoftonline.com",
      "media-src 'self' blob:",
      "manifest-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ');
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: contentSecurityPolicy },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
        { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
      ],
    }];
  },
  webpack(config) {
    config.resolve.alias["@target/admin"] = targetModule("src/app/admin/AdminDesktop.js", "src/app/admin/AdminMobile.js");
    config.resolve.alias["@target/usage"] = targetModule("src/app/usage/UsageDesktop.js", "src/app/usage/UsageMobile.js");
    config.resolve.alias["@target/pdf-clipper"] = targetModule("src/components/PdfClipper.js", "src/components/mobile/DisabledPdfClipper.js");
    config.resolve.alias["@target/structured-legend-editor"] = targetModule("src/components/StructuredLegendEditor.js", "src/components/mobile/DisabledStructuredLegendEditor.js");
    return config;
  },
};

export default withPWA(nextConfig);
