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
  /** Canvas objects MADE inside this workspace: sticky notes, folders and
   *  artboards. A photo is many-to-many (it lives in the project and can be in
   *  several workspaces), but a note is made in one place and belongs there, so
   *  these are plain owned lists.
   *
   *  They live here, in the board's own `localStorage` blob, rather than on the
   *  server rows they point at. A note could carry a `boardId` in its `style`
   *  jsonb with no migration — but that would sync a pointer to a workspace that
   *  exists in exactly one browser, leaving the note claiming membership in
   *  something no other device can find. Keeping the whole feature honestly
   *  local is the more coherent half-step; the real home is the `board_id`
   *  column ADR 0044 specs. */
  noteIds: string[];
  groupIds: string[];
  frameIds: string[];
}

/** The canvas objects a workspace can own. */
export type BoardObjectKind = "note" | "group" | "frame";

const OWNED_KEYS: Record<BoardObjectKind, "noteIds" | "groupIds" | "frameIds"> = {
  note: "noteIds",
  group: "groupIds",
  frame: "frameIds",
};

export function ownedKey(kind: BoardObjectKind): "noteIds" | "groupIds" | "frameIds" {
  return OWNED_KEYS[kind];
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
    return parsed
      .filter(
        (b): b is Board =>
          !!b &&
          typeof (b as Board).id === "string" &&
          typeof (b as Board).name === "string" &&
          typeof (b as Board).color === "string" &&
          Array.isArray((b as Board).assetIds),
      )
      // The owned-object lists were added after the first boards were saved, so
      // fill them rather than rejecting a blob that predates them.
      .map((b) => ({
        ...b,
        noteIds: Array.isArray(b.noteIds) ? b.noteIds : [],
        groupIds: Array.isArray(b.groupIds) ? b.groupIds : [],
        frameIds: Array.isArray(b.frameIds) ? b.frameIds : [],
      }));
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
