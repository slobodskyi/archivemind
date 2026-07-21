import { describe, expect, it } from "vitest";
import { chunkImportItems, IMPORT_CHUNK_SIZE } from "./drive-import";

/** The regression this pins: upload-client CAPS at 500 and drops the rest —
 *  the import path must CHUNK instead, losing nothing (review finding on the
 *  original plan, which wrongly claimed a reusable loop existed). */
describe("chunkImportItems", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("splits on exact boundaries and drops nothing", () => {
    for (const n of [0, 1, 499, 500, 501, 1000, 1001, 2750]) {
      const chunks = chunkImportItems(items(n));
      expect(chunks.flat()).toHaveLength(n);
      expect(chunks.flat()).toEqual(items(n)); // order preserved
      for (const c of chunks) expect(c.length).toBeLessThanOrEqual(IMPORT_CHUNK_SIZE);
      expect(chunks.length).toBe(Math.ceil(n / IMPORT_CHUNK_SIZE));
    }
  });

  it("respects a custom size", () => {
    expect(chunkImportItems(items(5), 2).map((c) => c.length)).toEqual([2, 2, 1]);
  });
});
