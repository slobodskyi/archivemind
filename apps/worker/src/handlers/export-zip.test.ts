import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { ZIP_MAX_TOTAL_BYTES, artboardSettingsSchema } from "@archivemind/shared";
import type { ExportRow } from "./export";

const getObjectBuffer = vi.fn(async (key: string) => Buffer.from(`bytes of ${key}`));
vi.mock("../services/r2", () => ({ getObjectBuffer: (key: string) => getObjectBuffer(key) }));

const { assertUnderBudget, buildReadme, planZip, renderSingleFile, singleFileArtifact } = await import("./export-zip");

/** Shapes the DB rows renderZip reads. `original_key: null` = a Drive-linked
 *  asset, whose original was never copied into R2 (ADR 0025). */
const row = (over: Partial<Parameters<typeof planZip>[0][number]> = {}) => ({
  asset_id: "a1",
  title: "DSC_0001.NEF",
  original_key: "ws/originals/x/DSC_0001.NEF",
  byte_size: 25_000_000,
  medium_key: "ws/previews/x/medium.webp",
  ...over,
});

describe("planZip — originals", () => {
  it("ships the original and counts its real size", () => {
    const plan = planZip([row()], "originals");
    expect(plan.entries).toEqual([
      {
        assetId: "a1",
        key: "ws/originals/x/DSC_0001.NEF",
        name: "DSC_0001.NEF",
        bytes: 25_000_000,
        substituted: false,
      },
    ]);
    expect(plan.knownBytes).toBe(25_000_000);
    expect(plan.missing).toEqual([]);
  });

  it("substitutes the preview for a Drive-linked asset and flags it", () => {
    // The point of the README: the recipient is TOLD, rather than handed a
    // 1024px file named .NEF and left to discover it.
    const plan = planZip([row({ original_key: null })], "originals");
    expect(plan.entries[0].substituted).toBe(true);
    expect(plan.entries[0].key).toBe("ws/previews/x/medium.webp");
    // Renamed to .webp — shipping preview bytes under a .NEF name would lie.
    expect(plan.entries[0].name).toBe("DSC_0001.webp");
    // asset_previews stores no size (only r2_key/width/height), so a preview
    // contributes nothing to the pre-flight sum — the running total during the
    // fetch is what bounds it. Inventing a `byte_size` on that table is exactly
    // the bug that shipped and broke every ZIP export in production.
    expect(plan.knownBytes).toBe(0);
  });

  it("reports an asset with neither an original nor a preview instead of shipping nothing", () => {
    const plan = planZip([row({ original_key: null, medium_key: null })], "originals");
    expect(plan.entries).toEqual([]);
    expect(plan.missing).toEqual(["DSC_0001.NEF"]);
  });
});

describe("planZip — web", () => {
  it("uses the preview even when an original exists", () => {
    const plan = planZip([row()], "web");
    expect(plan.entries[0].key).toBe("ws/previews/x/medium.webp");
    expect(plan.entries[0].name).toBe("DSC_0001.webp");
    // Not a substitution: web-size is what was asked for.
    expect(plan.entries[0].substituted).toBe(false);
    expect(plan.knownBytes).toBe(0); // previews have no stored size
  });
});

describe("planZip — names and sizes", () => {
  it("disambiguates identical filenames from different assets", () => {
    const plan = planZip(
      [
        row({ asset_id: "a1", original_key: "k1" }),
        row({ asset_id: "a2", original_key: "k2" }),
      ],
      "originals",
    );
    expect(plan.entries.map((e) => e.name)).toEqual(["DSC_0001.NEF", "DSC_0001 (2).NEF"]);
  });

  it("falls back to the asset id when there is no title", () => {
    const plan = planZip([row({ title: null })], "originals");
    expect(plan.entries[0].name).toBe("a1");
  });

  it("reads bigint byte_size arriving as a string from pg", () => {
    // node-postgres returns bigint as text; a naive sum would concatenate.
    const plan = planZip(
      [row({ byte_size: "3000000" }), row({ asset_id: "a2", original_key: "k2", byte_size: "4000000" })],
      "originals",
    );
    expect(plan.knownBytes).toBe(7_000_000);
  });

  it("treats an unknown size as zero rather than NaN", () => {
    const plan = planZip([row({ byte_size: null })], "originals");
    expect(plan.knownBytes).toBe(0);
    expect(Number.isNaN(plan.knownBytes)).toBe(false);
  });

  it("keeps the caller's page order", () => {
    const plan = planZip(
      [
        row({ asset_id: "z", title: "z.jpg", original_key: "kz" }),
        row({ asset_id: "a", title: "a.jpg", original_key: "ka" }),
      ],
      "originals",
    );
    expect(plan.entries.map((e) => e.assetId)).toEqual(["z", "a"]);
  });
});

const RIGHTS = {
  creator: "O. Slobodskyi",
  credit: "Photo: O. Slobodskyi / Reuters",
  copyright_notice: "(c) 2026 O. Slobodskyi",
  usage_terms: "Editorial use only.",
};

describe("buildReadme", () => {
  it("is absent when nothing is off AND the workspace has no rights set", () => {
    expect(buildReadme(planZip([row()], "originals"), "originals")).toBeNull();
    expect(buildReadme(planZip([row()], "originals"), "originals", null)).toBeNull();
  });

  it("is written for a perfect bundle when rights exist — the client needs them", () => {
    // A PDF carries the credit in its footer and the copyright on its cover; a
    // ZIP had nowhere to put either, so a client received photographs with no
    // statement of who owns them.
    const note = buildReadme(planZip([row()], "originals"), "originals", RIGHTS);
    expect(note).toContain("Creator: O. Slobodskyi");
    expect(note).toContain("Credit: Photo: O. Slobodskyi / Reuters");
    expect(note).toContain("Copyright: (c) 2026 O. Slobodskyi");
    expect(note).toContain("Usage terms: Editorial use only.");
  });

  it("omits the fields the workspace left empty rather than printing blank labels", () => {
    const note = buildReadme(planZip([row()], "originals"), "originals", {
      ...RIGHTS,
      credit: null,
      usage_terms: "   ",
    });
    expect(note).toContain("Creator:");
    expect(note).not.toContain("Credit:");
    expect(note).not.toContain("Usage terms:");
  });

  it("puts the rights above the delivery notes", () => {
    const plan = planZip([row({ original_key: null })], "originals");
    const note = buildReadme(plan, "originals", RIGHTS) ?? "";
    expect(note.indexOf("Creator:")).toBeLessThan(note.indexOf("Google Drive"));
  });

  it("names every substituted file and says why", () => {
    const plan = planZip([row({ original_key: null })], "originals");
    const note = buildReadme(plan, "originals");
    expect(note).toContain("DSC_0001.webp");
    expect(note).toContain("Google Drive");
    expect(note).toContain("1024px");
  });

  it("names files that could not be included at all", () => {
    const plan = planZip([row({ original_key: null, medium_key: null })], "originals");
    expect(buildReadme(plan, "originals")).toContain("DSC_0001.NEF");
  });

  it("states the web-size case plainly even with nothing missing", () => {
    const plan = planZip([row()], "web");
    // No substitution and nothing missing, but the recipient should still know
    // these are previews — so a note is warranted... only if something else is
    // off. With a clean web bundle the subtitle in the dialog already said so.
    expect(buildReadme(plan, "web")).toBeNull();
    const withMissing = planZip([row(), row({ asset_id: "a2", medium_key: null })], "web");
    expect(buildReadme(withMissing, "web")).toContain("1024px preview");
  });
});

describe("assertUnderBudget", () => {
  it("allows a bundle at or under the ceiling", () => {
    expect(() => assertUnderBudget(0)).not.toThrow();
    expect(() => assertUnderBudget(ZIP_MAX_TOTAL_BYTES)).not.toThrow();
  });

  it("refuses above it with a size the dialog can show", () => {
    // A refusal the user can act on beats an OOM — which is a SIGKILL, so the
    // handler's catch never runs, failOrRetryJob never fires, and reapStaleJobs
    // requeues the poison job every ~15 minutes forever.
    expect(() => assertUnderBudget(ZIP_MAX_TOTAL_BYTES + 1)).toThrow(/^export_too_large:/);
    expect(() => assertUnderBudget(3 * 1024 ** 3)).toThrow("export_too_large:3.0GB");
  });
});

describe("singleFileArtifact", () => {
  it("names the file by its own extension, lowercased, with a type a browser knows", () => {
    expect(singleFileArtifact("IMG_2041.HEIC")).toEqual({ ext: "heic", contentType: "image/heic" });
    expect(singleFileArtifact("portrait.jpeg")).toEqual({ ext: "jpeg", contentType: "image/jpeg" });
    expect(singleFileArtifact("x.webp")).toEqual({ ext: "webp", contentType: "image/webp" });
  });

  it("ships camera RAW and anything unknown as octet-stream rather than guessing", () => {
    expect(singleFileArtifact("DSC_0001.NEF")).toEqual({ ext: "nef", contentType: "application/octet-stream" });
  });

  it("refuses a name it cannot store under, so the ZIP carries that file instead", () => {
    for (const name of ["IMG 2041", "photo.", "evil.jp/g", "notes.абв", "file.abcdefghijk"]) {
      expect(singleFileArtifact(name)).toBeNull();
    }
  });
});

describe("renderSingleFile", () => {
  /** The byte query's answer for one asset; `original_key: null` = Drive/OneDrive. */
  const poolWith = (over: Partial<Parameters<typeof planZip>[0][number]> = {}) =>
    ({ query: vi.fn(async () => ({ rows: [row(over)] })) }) as unknown as pg.Pool;
  const only = { asset_id: "a1", title: "DSC_0001.NEF", medium_key: null } as ExportRow;
  const opts = (zipContents: "originals" | "web") => artboardSettingsSchema.parse({ format: "zip", zipContents });

  it("returns the original itself under its own extension — no archive, README or CSV", async () => {
    getObjectBuffer.mockClear();
    const out = await renderSingleFile(poolWith({ title: "IMG_2041.HEIC", original_key: "ws/originals/x/IMG_2041.HEIC" }), only, opts("originals"));
    expect(out).toEqual({ body: Buffer.from("bytes of ws/originals/x/IMG_2041.HEIC"), ext: "heic", contentType: "image/heic" });
    expect(getObjectBuffer).toHaveBeenCalledTimes(1);
  });

  it("gives a Drive-linked photo its web-size preview, as the ZIP would", async () => {
    const out = await renderSingleFile(poolWith({ original_key: null }), only, opts("originals"));
    expect(out).toMatchObject({ ext: "webp", contentType: "image/webp" });
    expect(out?.body.toString()).toBe("bytes of ws/previews/x/medium.webp");
  });

  it("gives the preview for web-size even when an original exists", async () => {
    const out = await renderSingleFile(poolWith(), only, opts("web"));
    expect(out).toMatchObject({ ext: "webp", contentType: "image/webp" });
  });

  it("hands back to the ZIP, without fetching, when the file has no extension", async () => {
    getObjectBuffer.mockClear();
    expect(await renderSingleFile(poolWith({ title: "IMG 2041" }), only, opts("originals"))).toBeNull();
    expect(getObjectBuffer).not.toHaveBeenCalled();
  });

  it("fails as export_empty when nothing is stored for the photo", async () => {
    await expect(renderSingleFile(poolWith({ original_key: null, medium_key: null }), only, opts("originals"))).rejects.toThrow(
      "export_empty",
    );
  });
});
