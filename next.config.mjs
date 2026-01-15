import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
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
};

export default withPWA(nextConfig);
