import { describe, expect, it } from "vitest";
import type { TrashItem } from "@archivemind/shared";
import {
  trashChips,
  trashCountLabel,
  trashExpiry,
  trashItemKey,
  trashLocationLabel,
  trashPurgeAllLabel,
  trashTypeLabel,
} from "./trash-view";

const item = (over: Partial<TrashItem> = {}): TrashItem => ({
  kind: "asset",
  id: "00000000-0000-0000-0000-000000000001",
  name: "IMG_4821.HEIC",
  assetKind: "photo",
  mime: "image/heic",
  thumb: null,
  color: null,
  bytes: 1024,
  count: null,
  location: [],
  deletedAt: new Date().toISOString(),
  deletedBy: null,
  expiresAt: null,
  ...over,
});

describe("trashChips", () => {
  it("draws a chip only for kinds actually in the trash", () => {
    expect(trashChips({ photo: 4, project: 1 }).map((c) => c.key)).toEqual(["photo", "project"]);
  });

  it("keeps files ahead of the containers they came out of", () => {
    const keys = trashChips({ draft: 1, project: 2, photo: 3, pdf: 1 }).map((c) => c.key);
    expect(keys).toEqual(["photo", "pdf", "project", "draft"]);
  });

  it("ignores a key the UI does not know", () => {
    expect(trashChips({ hologram: 9 })).toEqual([]);
  });
});

describe("trashTypeLabel", () => {
  it("names an asset by its own kind, so a PDF never reads as a photo", () => {
    expect(trashTypeLabel(item({ assetKind: "pdf" }))).toBe("PDF");
    expect(trashTypeLabel(item({ assetKind: "other" }))).toBe("File");
    expect(trashTypeLabel(item())).toBe("Photo");
  });

  it("names the container kinds directly", () => {
    expect(trashTypeLabel(item({ kind: "workspace", assetKind: null }))).toBe("Workspace");
    expect(trashTypeLabel(item({ kind: "draft", assetKind: null }))).toBe("Draft");
  });
});

describe("trashLocationLabel", () => {
  it("answers where Restore puts it back", () => {
    expect(trashLocationLabel(item({ location: [{ id: "p1", name: "Odesa 2026" }] }))).toBe("Odesa 2026");
  });

  it("counts the rest rather than truncating the list", () => {
    expect(
      trashLocationLabel(
        item({
          location: [
            { id: "p1", name: "Odesa 2026" },
            { id: "p2", name: "Client" },
            { id: "p3", name: "Archive" },
          ],
        }),
      ),
    ).toBe("Odesa 2026 +2");
  });

  it("says so when a photo belongs to no project", () => {
    expect(trashLocationLabel(item({ location: [] }))).toBe("No project");
  });
});

describe("trashExpiry", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  it("counts down from the deletion, not the expiry", () => {
    expect(trashExpiry(daysAgo(0)).label).toBe("30 days left");
    expect(trashExpiry(daysAgo(29)).label).toBe("1 day left");
  });

  it("turns urgent at three days, the threshold both surfaces already drew in red", () => {
    expect(trashExpiry(daysAgo(26)).urgent).toBe(false);
    expect(trashExpiry(daysAgo(27)).urgent).toBe(true);
  });

  it("does not promise a countdown it cannot compute", () => {
    expect(trashExpiry(null)).toEqual({ label: "In trash", daysLeft: null, urgent: false });
    expect(trashExpiry("not a date").daysLeft).toBeNull();
  });

  it("never counts below zero — an overdue row is due, not negative", () => {
    expect(trashExpiry(daysAgo(45))).toMatchObject({ daysLeft: 0, label: "Removed today" });
  });
});

describe("trashPurgeAllLabel", () => {
  it("names the number it will delete as soon as a filter is on", () => {
    expect(trashPurgeAllLabel(false, 312)).toBe("Empty trash");
    expect(trashPurgeAllLabel(true, 3)).toBe("Delete all (3)");
  });
});

describe("trashItemKey / trashCountLabel", () => {
  it("keys on kind AND id, so two kinds sharing a uuid cannot collide", () => {
    expect(trashItemKey({ kind: "asset", id: "x" })).not.toBe(trashItemKey({ kind: "draft", id: "x" }));
  });

  it("counts files only where a count means something", () => {
    expect(trashCountLabel(item({ kind: "project", count: 1 }))).toBe("1 file");
    expect(trashCountLabel(item({ count: null }))).toBeNull();
  });
});
