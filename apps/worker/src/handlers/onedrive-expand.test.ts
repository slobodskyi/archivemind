import { beforeEach, describe, expect, it, vi } from "vitest";
import { ONEDRIVE_MAX_DEPTH, ONEDRIVE_MAX_ITEMS_PER_IMPORT } from "@archivemind/shared";
import type { OneDriveItem } from "../services/onedrive";

// Only the network call is stubbed; the error type, the gate and the caps all
// stay real, because they are what these tests are about.
vi.mock("../services/onedrive", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/onedrive")>();
  return { ...actual, listOneDriveChildren: vi.fn() };
});

const { listOneDriveChildren } = await import("../services/onedrive");
const { ThrottleGate, OneDriveFileError } = await import("../services/onedrive");
const {
  chunk,
  expandProgressLabel,
  folderPathOf,
  isImportableName,
  resolveMime,
  walkFolders,
} = await import("./onedrive-expand");

const mocked = vi.mocked(listOneDriveChildren);

const file = (id: string, name: string): OneDriveItem => ({
  id,
  name,
  size: 10,
  mimeType: null,
  isFolder: false,
  childCount: null,
  downloadUrl: null,
  path: "/drive/root:/Photos",
  photo: null,
  location: null,
});

const folder = (id: string, name: string): OneDriveItem => ({
  ...file(id, name),
  isFolder: true,
  childCount: 1,
});

/** Wire a tree: parent item id → its children. */
function tree(map: Record<string, OneDriveItem[]>) {
  mocked.mockImplementation(async function* (_driveId, itemId) {
    for (const child of map[itemId] ?? []) yield child;
  });
}

const expand = {
  connection_id: "8f7a1c2e-0000-4000-8000-1234567890ab",
  project_id: null,
  folders: [{ drive_id: "d1", item_id: "root", name: "Photos" }],
};

const run = () =>
  walkFolders({ expand, accessToken: "tok", gate: new ThrottleGate() });

beforeEach(() => mocked.mockReset());

describe("folder expansion (ADR 0047 D5)", () => {
  it("walks the whole tree, not just the top level", () => {
    // This is the entire value proposition over Drive: `drive.file` cannot
    // expand a picked folder, so if only top-level files landed, the feature
    // would be pointless.
    tree({
      root: [file("a", "a.jpg"), folder("sub", "2024")],
      sub: [file("b", "b.jpg"), folder("deep", "May")],
      deep: [file("c", "c.jpg")],
    });
    return run().then((out) => {
      expect(out.discovered.map((d) => d.name).sort()).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
      expect(out.foldersScanned).toBe(3);
    });
  });

  it("skips and COUNTS what it will not import", async () => {
    tree({ root: [file("a", "a.jpg"), file("z", "notes.txt"), file("y", "archive.zip"), file("p", "brief.pdf")] });
    const out = await run();
    // photos and PDFs are the archive's business; a stray .zip beside them is not
    expect(out.discovered.map((d) => d.name).sort()).toEqual(["a.jpg", "brief.pdf"]);
    // silently ignoring files is how an import looks like it lost something
    expect(out.skipped).toBe(2);
  });

  it("FAILS on the item cap instead of truncating", async () => {
    const many = Array.from({ length: ONEDRIVE_MAX_ITEMS_PER_IMPORT + 5 }, (_, i) =>
      file(`f${i}`, `f${i}.jpg`),
    );
    tree({ root: many });
    // A silent cut would read to the user as "OneDrive only had 5000 photos".
    await expect(run()).rejects.toThrow("onedrive_too_many_items");
  });

  it("FAILS on the depth cap rather than recursing forever", async () => {
    const deep: Record<string, OneDriveItem[]> = {};
    let id = "root";
    for (let i = 0; i <= ONEDRIVE_MAX_DEPTH + 2; i++) {
      const next = `lvl${i}`;
      deep[id] = [folder(next, next)];
      id = next;
    }
    tree(deep);
    await expect(run()).rejects.toThrow("onedrive_too_deep");
  });

  it("does not re-walk a folder it has already seen", async () => {
    // A shortcut pointing back up would otherwise loop inside the depth budget.
    tree({ root: [folder("loop", "loop")], loop: [folder("loop", "loop"), file("a", "a.jpg")] });
    const out = await run();
    expect(out.discovered).toHaveLength(1);
    expect(out.foldersScanned).toBe(2);
  });

  it("reports progress per folder, naming it", async () => {
    tree({ root: [folder("sub", "2024")], sub: [file("a", "a.jpg")] });
    const seen: string[] = [];
    await walkFolders({
      expand,
      accessToken: "tok",
      gate: new ThrottleGate(),
      onProgress: async (_folders, _files, name) => void seen.push(name),
    });
    // A bar that does not move for minutes reads as a hang.
    expect(seen).toContain("2024");
  });

  it("surfaces a scan failure as a first-party code", async () => {
    mocked.mockImplementation(async function* () {
      throw new OneDriveFileError("onedrive_folder_scan_failed", true);
      // eslint-disable-next-line no-unreachable
      yield file("x", "x.jpg");
    });
    await expect(run()).rejects.toThrow("onedrive_folder_scan_failed");
  });
});

describe("expansion helpers", () => {
  it("prefers the extension over Graph's MIME", () => {
    // Graph reports plenty of camera files as application/octet-stream.
    expect(resolveMime("DSC01.JPG", "application/octet-stream")).toBe("image/jpeg");
    expect(resolveMime("IMG.HEIC", null)).toBe("image/heic");
    // ...but takes Graph's answer for an extension we do not know
    expect(resolveMime("weird.xyz", "image/png")).toBe("image/png");
    expect(resolveMime("weird.xyz", null)).toBe("application/octet-stream");
  });

  it("imports photos and PDFs, including RAW by filename", () => {
    expect(isImportableName("a.jpg", null)).toBe(true);
    expect(isImportableName("brief.pdf", null)).toBe(true);
    // RAW has no useful MIME anywhere; Graph gives octet-stream and so does
    // our extension table — but the DECODER keys off the filename, so the file
    // must still come in. Graph's own MIME is what rescues it here.
    expect(isImportableName("shot.NEF", "image/x-nikon-nef")).toBe(true);
    expect(isImportableName("notes.txt", null)).toBe(false);
    expect(isImportableName("archive.zip", null)).toBe(false);
  });

  it("reduces an API path to its human half", () => {
    expect(folderPathOf({ ...file("i", "a.jpg"), path: "/drive/root:/Photos/2024" })).toBe("/Photos/2024");
    expect(folderPathOf({ ...file("i", "a.jpg"), path: "/drive/root:" })).toBe("/");
    expect(folderPathOf({ ...file("i", "a.jpg"), path: null })).toBeNull();
  });

  it("batches at the same 500 the import route accepts", () => {
    const items = Array.from({ length: 1201 }, (_, i) => i);
    const batches = chunk(items);
    expect(batches.map((b) => b.length)).toEqual([500, 500, 201]);
    // nothing dropped
    expect(batches.flat()).toHaveLength(1201);
  });

  it("summarises what the walk did", () => {
    expect(
      expandProgressLabel(
        { discovered: new Array(12).fill(null) as never[], skipped: 3, foldersScanned: 4 },
        { created: 10, linkedExisting: 2, jobIds: ["j"] },
      ),
    ).toBe("Found 12 file(s) in 4 folder(s) — 2 already imported — 3 unsupported skipped");
  });
});
