import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.VITRION_DIST_DIR || ".next",
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/clinical-api/:path*", destination: "http://127.0.0.1:8001/api/:path*" }];
  },
  async headers() {
    return [{ source: "/clinical-api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] }, {
      source: "/cases", headers: [{ key: "Cache-Control", value: "no-store" }],
    }, {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default nextConfig;
