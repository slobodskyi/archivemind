import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  // Workspace package ships TS source — bundle it so dist/ is self-contained.
  noExternal: ["@archivemind/shared"],
});
