import path from "node:path";
import type { NextConfig } from "next";

// Monorepo: the repo root holds the single pnpm lockfile; point Turbopack and
// output file tracing there so Next doesn't misinfer the workspace root.
const monorepoRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  turbopack: {
    root: monorepoRoot,
  },
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: ["@archivemind/shared"],
  async headers() {
    return [
      {
        source: "/p/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
