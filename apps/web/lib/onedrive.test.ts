import { describe, expect, it } from "vitest";
import {
  ONEDRIVE_CHILD_SELECT,
  displayPath,
  isSafeSkipToken,
  skipTokenFromNextLink,
  sortBrowseEntries,
  toBrowseEntry,
  type BrowseEntry,
} from "./onedrive";

const entry = (over: Partial<BrowseEntry>): BrowseEntry => ({
  driveId: "d1",
  itemId: "i1",
  name: "x",
  isFolder: false,
  sizeBytes: null,
  mimeType: null,
  childCount: null,
  path: null,
  ...over,
});

describe("onedrive browse shaping (ADR 0047)", () => {
  it("asks for the facets we use and not the download URL", () => {
    expect(ONEDRIVE_CHILD_SELECT).toContain("folder");
    expect(ONEDRIVE_CHILD_SELECT).toContain("photo");
    expect(ONEDRIVE_CHILD_SELECT).toContain("parentReference");
    // The pre-authenticated URL expires in minutes and the browser has no use
    // for it — resolving one per row would be a wasted field on 200 items.
    expect(ONEDRIVE_CHILD_SELECT).not.toContain("downloadUrl");
  });

  it("maps a file and a folder, keeping the drive scope", () => {
    const file = toBrowseEntry(
      {
        id: "item1",
        name: "DSC01.jpg",
        size: 1234,
        file: { mimeType: "image/jpeg" },
        parentReference: { driveId: "driveX", path: "/drive/root:/Photos" },
      },
      null,
    );
    expect(file).toMatchObject({
      driveId: "driveX",
      itemId: "item1",
      isFolder: false,
      sizeBytes: 1234,
      mimeType: "image/jpeg",
      path: "/Photos",
    });

    const folder = toBrowseEntry(
      { id: "f1", name: "2024", folder: { childCount: 812 }, parentReference: { driveId: "driveX" } },
      null,
    );
    expect(folder).toMatchObject({ isFolder: true, childCount: 812, sizeBytes: null });
  });

  it("drops rows it cannot address", () => {
    // no id
    expect(toBrowseEntry({ name: "x", parentReference: { driveId: "d" } }, null)).toBeNull();
    // no drive scope anywhere: an item id alone is not an identity
    expect(toBrowseEntry({ id: "i", name: "x" }, null)).toBeNull();
    // ...but the caller's known drive is a valid fallback
    expect(toBrowseEntry({ id: "i", name: "x" }, "d1")?.driveId).toBe("d1");
  });

  it("survives a nameless item rather than dropping it", () => {
    expect(toBrowseEntry({ id: "i", parentReference: { driveId: "d" } }, null)?.name).toBe("(untitled)");
  });

  it("sorts folders first, then names naturally", () => {
    const sorted = sortBrowseEntries([
      entry({ itemId: "b", name: "b.jpg" }),
      entry({ itemId: "f2", name: "Zebra", isFolder: true }),
      entry({ itemId: "a", name: "a10.jpg" }),
      entry({ itemId: "f1", name: "Alps", isFolder: true }),
      entry({ itemId: "a2", name: "a2.jpg" }),
    ]);
    expect(sorted.map((e) => e.name)).toEqual(["Alps", "Zebra", "a2.jpg", "a10.jpg", "b.jpg"]);
  });

  it("decodes the human half of an API path", () => {
    expect(displayPath("/drive/root:/Photos/2024")).toBe("/Photos/2024");
    expect(displayPath("/drive/root:")).toBe("/");
    expect(displayPath("/drives/abc/root:/A%20B")).toBe("/A B");
    // malformed percent-escapes must not throw
    expect(displayPath("/drive/root:/100%")).toBe("/100%");
    expect(displayPath(undefined)).toBeNull();
  });

  it("extracts only the skiptoken from a nextLink, never the URL", () => {
    expect(
      skipTokenFromNextLink("https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=ABC123"),
    ).toBe("ABC123");
    expect(skipTokenFromNextLink("not a url")).toBeNull();
    expect(skipTokenFromNextLink(undefined)).toBeNull();
  });

  it("bounds a skiptoken before it is echoed back into a Graph query", () => {
    expect(isSafeSkipToken("ABC123-_~.")).toBe(true);
    expect(isSafeSkipToken("")).toBe(false);
    expect(isSafeSkipToken("x".repeat(2049))).toBe(false);
    // nothing that could restructure the query string or the URL
    expect(isSafeSkipToken("a&$top=1")).toBe(false);
    expect(isSafeSkipToken("a#b")).toBe(false);
    expect(isSafeSkipToken("a b")).toBe(false);
    expect(isSafeSkipToken("a?b")).toBe(false);
  });
});
