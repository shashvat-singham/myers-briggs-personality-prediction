import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone so the Docker image can ship a server without
  // node_modules.
  //
  // Vercel must NOT get this: its builder produces its own trace manifests and
  // standalone mode suppresses them, so the deploy fails looking for
  // `.next/next-server.js.nft.json`. VERCEL=1 is set in their build container.
  output: process.env.VERCEL ? undefined : "standalone",

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "geolocation=(), microphone=(), camera=()",
          },
        ],
      },
      {
        // The sixteen profiles never change between deploys; they are fetched
        // by the result page at runtime, so a long cache is free latency.
        source: "/types/:file*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" },
        ],
      },
    ];
  },
};

export default nextConfig;
