import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static", "archiver"],
  outputFileTracingIncludes: {
    "/api/session/[id]/complete": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/session/[id]/retry-email": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Content-Type", value: "application/manifest+json" }],
      },
    ];
  },
};

export default nextConfig;
