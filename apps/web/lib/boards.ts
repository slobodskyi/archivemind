import type { AssetLabel, Board } from "@archivemind/shared";

/** Workspace helpers (ADR 0044). The entity itself now lives in the `boards`
 *  table and reaches the client through `lib/boards-server.ts` + `/api/boards`;
 *  what is left here is the pure colour rule and the one-time adoption of the
 *  `localStorage` boards that shipped before the table existed. */

const STORE_PREFIX = "archivemind:boards:";
const storeKey = (projectId: string) => `${STORE_PREFIX}${projectId}`;

/** New workspaces cycle through these, so the first few are visibly different
 *  colours without anyone having to pick. */
export const BOARD_COLORS: readonly AssetLabel[] = ["blue", "green", "yellow", "purple", "red", "orange", "gray"];

/** The colour a new workspace gets: the first unused one, else cycle by count so
 *  two made back-to-back never look identical. Pure — no `Math.random` here. */
export function nextBoardColor(existing: readonly Board[]): AssetLabel {
  const used = new Set(existing.map((b) => b.color));
  const free = BOARD_COLORS.find((c) => !used.has(c));
  return free ?? BOARD_COLORS[existing.length % BOARD_COLORS.length];
}

/** One workspace as the pre-table client stored it. Only `name`, `color` and
 *  `assetIds` are adopted — the note/folder/artboard lists are deliberately
 *  dropped, because ownership is a `board_id` column on those rows now and
 *  re-pointing them would mean a PATCH per object for data that existed in one
 *  browser for a matter of hours. Those objects fall back to belonging to the
 *  project canvas, which is a defined state, not a loss. */
export interface LegacyBoard {
  name: string;
  color: AssetLabel;
  assetIds: string[];
}

/** Read (and only read) any workspaces this browser saved before the table
 *  existed. Returns [] for anything unparseable: a hand-edited or half-written
 *  blob must not stop the canvas from loading. */
export function readLegacyBoards(projectId: string): LegacyBoard[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storeKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (b): b is { name: string; color: string; assetIds: unknown[] } =>
          !!b &&
          typeof (b as { name?: unknown }).name === "string" &&
          typeof (b as { color?: unknown }).color === "string" &&
          Array.isArray((b as { assetIds?: unknown }).assetIds),
      )
      .map((b) => ({
        name: b.name,
        color: (BOARD_COLORS as readonly string[]).includes(b.color) ? (b.color as AssetLabel) : "blue",
        assetIds: b.assetIds.filter((id): id is string => typeof id === "string"),
      }));
  } catch {
    return [];
  }
}

/** Forget this project's legacy blob. Called only after every board in it has
 *  been created on the server, so a failed adoption is retried on the next load
 *  rather than silently dropped. */
export function clearLegacyBoards(projectId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storeKey(projectId));
  } catch {
    // Private mode — nothing was persisted to clear.
  }
}
