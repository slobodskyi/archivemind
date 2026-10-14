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
  // PostHog's endpoints end in slashes (`/e/`, `/s/`); a 308 to the slashless
  // path would turn every recording upload into a redirect (ADR 0050).
  skipTrailingSlashRedirect: true,
  // Same-origin reverse proxy to PostHog EU (ADR 0050): ad blockers drop
  // requests to posthog.com, which would lose recordings without an error.
  // proxy.ts excludes /ingest from its matcher — it runs BEFORE rewrites.
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: "https://eu-assets.i.posthog.com/static/:path*" },
      { source: "/ingest/array/:path*", destination: "https://eu-assets.i.posthog.com/array/:path*" },
      { source: "/ingest/:path*", destination: "https://eu.i.posthog.com/:path*" },
    ];
  },
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
