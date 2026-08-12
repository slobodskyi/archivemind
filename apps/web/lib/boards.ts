import type { AssetLabel } from "@archivemind/shared";

/** A **Workspace** (called a `board` in code to avoid colliding with the
 *  account-level tenant `workspace_id`). A named, colour-coded working set of
 *  files under a project — the thing that replaced artboards (ADR 0044). It is
 *  where you assemble selected files, work on them, create new ones and export;
 *  the sorting views (Canvas/Timeline/Topic/Map) are only for finding and
 *  selecting the files that go into one.
 *
 *  Client-only for now: persisted in `localStorage` keyed by project. The
 *  server-side `boards` table + the higher-level "these files are one connected
 *  project" analysis are Oleksandr's follow-up (ADR 0044). */
export interface Board {
  id: string;
  name: string;
  /** One of the seven ADR-0040 colours — the dot in the header browser. */
  color: AssetLabel;
  /** The asset ids that belong to this workspace (order = insertion). */
  assetIds: string[];
}

const STORE_PREFIX = "archivemind:boards:";
const storeKey = (projectId: string) => `${STORE_PREFIX}${projectId}`;

/** New boards cycle through these first, so the first few workspaces are visibly
 *  different colours without the user having to pick. */
export const BOARD_COLORS: readonly AssetLabel[] = ["blue", "green", "yellow", "purple", "red", "orange", "gray"];

export function loadBoards(projectId: string): Board[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storeKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Defensive: drop anything that isn't a well-formed board (a hand-edited or
    // older blob shouldn't crash the canvas).
    return parsed.filter(
      (b): b is Board =>
        !!b &&
        typeof (b as Board).id === "string" &&
        typeof (b as Board).name === "string" &&
        typeof (b as Board).color === "string" &&
        Array.isArray((b as Board).assetIds),
    );
  } catch {
    return [];
  }
}

export function saveBoards(projectId: string, boards: Board[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storeKey(projectId), JSON.stringify(boards));
  } catch {
    // Quota or private-mode — the boards just won't persist this session.
  }
}

/** The colour a new board gets: the first `BOARD_COLORS` entry not already in
 *  use, else cycle by count so two new boards never look identical back-to-back. */
export function nextBoardColor(existing: Board[]): AssetLabel {
  const used = new Set(existing.map((b) => b.color));
  const free = BOARD_COLORS.find((c) => !used.has(c));
  return free ?? BOARD_COLORS[existing.length % BOARD_COLORS.length];
}
