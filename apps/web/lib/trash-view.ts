import {
  TRASH_EXPIRING_SOON_DAYS,
  trashDaysLeft,
  type TrashFilterKey,
  type TrashItem,
} from "@archivemind/shared";

/** Pure presentation rules for the Trash (ADR 0049) — kept out of the
 *  components so the chip order, the copy and the "what does this restore to"
 *  answer are testable without a DOM. */

/** Chip order: files first (what a Trash is usually full of), containers after.
 *  A chip is only drawn when its count is non-zero, so the order is a ranking,
 *  not a layout. */
export const TRASH_CHIP_ORDER: readonly TrashFilterKey[] = [
  "photo",
  "pdf",
  "document",
  "other",
  "project",
  "workspace",
  "draft",
] as const;

const CHIP_LABELS: Record<TrashFilterKey, string> = {
  photo: "Photos",
  pdf: "PDFs",
  document: "Documents",
  other: "Other files",
  project: "Projects",
  workspace: "Workspaces",
  draft: "Drafts",
};

export interface TrashChip {
  key: TrashFilterKey;
  label: string;
  count: number;
}

/** The chips to draw, from the counts the server sent. Counts ignore the active
 *  type filter on purpose — a chip has to keep saying what picking it would
 *  find, or every chip but the selected one reads zero. */
export function trashChips(counts: Record<string, number>): TrashChip[] {
  return TRASH_CHIP_ORDER.filter((key) => (counts[key] ?? 0) > 0).map((key) => ({
    key,
    label: CHIP_LABELS[key],
    count: counts[key] ?? 0,
  }));
}

/** Stable identity for selection: two kinds could in principle share a uuid,
 *  and a Set of bare ids would then restore the wrong thing. */
export function trashItemKey(item: { kind: string; id: string }): string {
  return `${item.kind}:${item.id}`;
}

/** What it IS, in one word, for the list's type column. */
export function trashTypeLabel(item: Pick<TrashItem, "kind" | "assetKind">): string {
  if (item.kind !== "asset") {
    return { project: "Project", workspace: "Workspace", draft: "Draft" }[item.kind] ?? "Item";
  }
  switch (item.assetKind) {
    case "pdf":
      return "PDF";
    case "document":
      return "Document";
    case "other":
      return "File";
    default:
      return "Photo";
  }
}

/** Where Restore puts it back — the question a trash list exists to answer and
 *  the one the old one never did. */
export function trashLocationLabel(item: Pick<TrashItem, "kind" | "location">): string {
  if (item.kind === "project") return "Projects";
  if (item.location.length === 0) {
    return item.kind === "asset" ? "No project" : "—";
  }
  const [first, ...rest] = item.location;
  return rest.length > 0 ? `${first.name} +${rest.length}` : first.name;
}

/** How many files come back with it — meaningless for a photo, which IS one. */
export function trashCountLabel(item: Pick<TrashItem, "kind" | "count">): string | null {
  if (item.count == null) return null;
  return `${item.count} ${item.count === 1 ? "file" : "files"}`;
}

export interface TrashExpiry {
  label: string;
  daysLeft: number | null;
  /** Three days or fewer — drawn in red, the same threshold the in-canvas panel
   *  has always used and the homepage never did. */
  urgent: boolean;
}

export function trashExpiry(deletedAt: string | null | undefined): TrashExpiry {
  const daysLeft = trashDaysLeft(deletedAt);
  if (daysLeft == null) return { label: "In trash", daysLeft: null, urgent: false };
  const label =
    daysLeft === 0 ? "Removed today" : daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;
  return { label, daysLeft, urgent: daysLeft <= TRASH_EXPIRING_SOON_DAYS };
}

/** The destructive button's own copy. With a filter on it must name what it
 *  will actually delete: "Empty trash" over a list showing 3 of 300 is the
 *  footgun ADR 0049 closes. */
export function trashPurgeAllLabel(filtered: boolean, total: number): string {
  return filtered ? `Delete all (${total})` : "Empty trash";
}
