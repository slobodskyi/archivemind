import {
  adoptContentDraft,
  listContentDrafts,
  parseContentDraft,
  type ContentDraft,
} from "./content-drafts";

/** Server mirror for browser-local drafts (ADR 0045 amendment).
 *
 * Deliberately a layer BESIDE `content-drafts.ts` rather than a rewrite of it.
 * That module stays a synchronous `localStorage` store because the editor saves
 * on a debounce while somebody is typing: making the save path async would make
 * every keystroke's persistence contingent on a network round trip, and losing
 * the network would be worse than today rather than better. So the browser
 * writes locally first and mirrors here, and the mirror is what survives a
 * cleared browser.
 *
 * Conflicts resolve on the draft's own `version`, not on a timestamp: two tabs
 * can save inside one clock tick, and the editor holds the whole document, so
 * an older envelope would silently undo the newer one's paragraphs. */

interface StoredDraftRow {
  version: number;
  updatedAt: string;
  draft: ContentDraft;
}

export type DraftPushResult = "saved" | "stale" | "unauthorized" | "failed";

function parseRows(value: unknown): StoredDraftRow[] {
  if (typeof value !== "object" || value === null || !("drafts" in value)) return [];
  const rows = (value as { drafts: unknown }).drafts;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const { version, updatedAt, draft } = row as Record<string, unknown>;
    const parsed = parseContentDraft(draft);
    if (!parsed || typeof version !== "number" || typeof updatedAt !== "string") return [];
    return [{ version, updatedAt, draft: parsed }];
  });
}

/** Fetch this Workspace's durable drafts and reconcile them into the browser.
 *  A draft the server holds at an equal-or-newer version replaces the local
 *  copy; a local draft that is ahead (or that the server has never seen) is
 *  pushed up. Returns the reconciled list, or null when the server could not be
 *  reached at all — the caller then keeps showing what the browser has. */
export async function syncContentDrafts(boardId: string): Promise<ContentDraft[] | null> {
  let remote: StoredDraftRow[];
  try {
    const response = await fetch(`/api/content-drafts?boardId=${encodeURIComponent(boardId)}`);
    if (!response.ok) return null;
    remote = parseRows(await response.json());
  } catch {
    return null;
  }

  const remoteById = new Map(remote.map((row) => [row.draft.id, row]));
  const local = listContentDrafts(boardId);
  const localById = new Map(local.map((draft) => [draft.id, draft]));

  // Take everything the server holds that this browser lacks or has older.
  for (const row of remote) {
    const mine = localById.get(row.draft.id);
    if (!mine || mine.version < row.draft.version) adoptContentDraft(boardId, row.draft);
  }

  // Push everything this browser holds that the server lacks or has older.
  // This is also the one-time adoption path for drafts written before the
  // table existed: they have no server row at all, so they upload as-is.
  await Promise.all(
    local
      .filter((draft) => {
        const theirs = remoteById.get(draft.id);
        return !theirs || theirs.draft.version < draft.version;
      })
      .map((draft) => pushContentDraft(boardId, draft)),
  );

  return listContentDrafts(boardId);
}

/** Mirror one draft. Failure is deliberately quiet at the call site: the local
 *  save already succeeded, so the user has lost nothing and the next sync will
 *  carry it up. */
export async function pushContentDraft(boardId: string, draft: ContentDraft): Promise<DraftPushResult> {
  try {
    const response = await fetch("/api/content-drafts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boardId, draft }),
    });
    if (response.status === 401) return "unauthorized";
    if (!response.ok) return "failed";
    const body: unknown = await response.json().catch(() => null);
    const stale = typeof body === "object" && body !== null && (body as { stale?: unknown }).stale === true;
    return stale ? "stale" : "saved";
  } catch {
    return "failed";
  }
}

/** Soft-delete the durable copy. Kept soft so an Undo restores the same draft
 *  id — a publication already made from it refers to the draft by that id. */
export async function deleteContentDraftOnServer(boardId: string, draftId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/content-drafts?boardId=${encodeURIComponent(boardId)}&draftId=${encodeURIComponent(draftId)}`,
      { method: "DELETE" },
    );
    return response.ok;
  } catch {
    return false;
  }
}
