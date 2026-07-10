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
};

export default nextConfig;
