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
  runtimeCaching: [
    {
      // Cache images when they are loaded
      urlPattern: ({ url }) => url.pathname.startsWith("/assets/images/"),
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
      // Cache other static assets (standard Next.js pattern)
      urlPattern: /^https?.*/,
      handler: "NetworkFirst",
      options: {
        cacheName: "offlineCache",
        expiration: {
          maxEntries: 200,
        },
      },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_TARGET: appTarget,
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
