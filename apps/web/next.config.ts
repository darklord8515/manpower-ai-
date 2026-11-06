import type { NextConfig } from "next";

// The browser only ever talks to this web app. `/api/*` is forwarded to the API, so the session
// cookie belongs to one site (no cross-site cookie rules) and the API address is a server setting.
const API_URL = process.env.API_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  // The dev-mode status pill covers the page footer in review screenshots.
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
