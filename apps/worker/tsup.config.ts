import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  // Workspace package ships TS source — bundle it so dist/ is self-contained.
  // kdbush is bundled too: it is 6 KB of pure JS, and inlining it keeps the
  // geo index from depending on how node_modules is laid out in the image.
  noExternal: ["@archivemind/shared", "kdbush"],
});
