import { EMPTY_GALLERY_OVERRIDES, type Frame, type GalleryOverrides, type GroupGeom } from "./layout";

/** The canvas arrangement — where tiles were dragged, where folder boxes sit,
 *  which tiles were brought to front — is UI state, so it lives in the browser
 *  and not in the schema (ADR 0022). What this module owns is the one thing that
 *  was wrong about that: the *scope* a saved arrangement belongs to.
 *
 *  One blob per **scope**, and a scope is a project **plus the open Workspace**
 *  (ADR 0044 as amended). Project and workspace re-pack the same tiles over
 *  different sets — ten photos among four hundred — so one shared bucket meant
 *  arranging a workspace re-arranged the project canvas it was carved out of,
 *  which ADR 0044 shipped as a known consequence and this closes.
 *
 *  The project's own key is deliberately UNCHANGED (`archivemind:canvas:{id}`),
 *  so every arrangement saved before workspaces existed loads exactly where it
 *  is; a workspace gets a suffixed key of its own and therefore starts as a
 *  clean grid, which is the same "a workspace re-packs" rule the fit already
 *  follows. */
const CANVAS_STORE_PREFIX = "archivemind:canvas:";

/** Saved arrangements from a different version are discarded on load — their
 *  coordinates were laid out against clouds that no longer exist. v2: everything
 *  saved by the design-branch DEMO_CLOUDS builds (fake Poland/Italy/topic clouds).
 *  Note that per-scope keys did NOT bump this: an old blob is still a valid
 *  arrangement of the project canvas, and throwing every one away to introduce a
 *  second scope would be a regression dressed as a migration. */
export const CANVAS_STORE_VERSION = 2;

/** The storage key for one canvas scope. `boardId === null` is the project
 *  canvas ("All files" within the project) and keeps the pre-Workspace key. */
export function canvasStoreKey(projectId: string, boardId: string | null): string {
  return boardId
    ? `${CANVAS_STORE_PREFIX}${projectId}:b:${boardId}`
    : `${CANVAS_STORE_PREFIX}${projectId}`;
}

/** The shape a sticky note had while it lived in localStorage: a raw hex colour
 *  and no font size. Kept solely so the one-time adoption can read an old save
 *  (ADR 0041) — do not widen it, and do not use it for anything new. */
export interface LegacyStickyNote {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
}

export interface PersistedCanvas {
  v?: number;
  galleryOverrides?: Partial<GalleryOverrides>;
  frames?: Frame[];
  groupGeom?: Record<string, GroupGeom>;
  /** Per-tile stacking-order deltas — client-only, additive to older saves. */
  tileZ?: Record<string, number>;
  /** Written by builds before ADR 0041 only. Notes live in canvas_annotations
   *  now; this key is read once, uploaded, and deleted. Never written again. */
  stickyNotes?: LegacyStickyNote[];
}

/** Everything one scope's arrangement consists of — the slice of canvas state
 *  that is loaded, saved and swapped as a unit when the scope changes. */
export interface CanvasArrangement {
  galleryOverrides: GalleryOverrides;
  frames: Frame[];
  groupGeom: Record<string, GroupGeom>;
  tileZ: Record<string, number>;
}

/** Raw read of one scope's blob. Returns null for "nothing usable here" —
 *  missing, unparseable, or written by an older layout generation — so every
 *  caller treats those three the same way: start clean. */
export function readCanvasStore(key: string): PersistedCanvas | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as PersistedCanvas;
    if (saved.v !== CANVAS_STORE_VERSION) return null;
    return saved;
  } catch {
    // corrupt JSON or storage unavailable (private mode) — start clean
    return null;
  }
}

/** The arrangement a saved blob describes, normalised and gap-filled. `null` in
 *  (nothing saved, or nothing usable) gives a scope nobody has arranged yet: a
 *  clean grid, no folder box moved, no stacking delta. Built fresh every call, so
 *  a caller that loads one scope can never mutate another's defaults.
 *
 *  `collapsed: false` is no longer reachable — the in-place expansion that flag
 *  drove was replaced by the folder's dropdown, so nothing can clear it again. A
 *  save from before that change can still carry it, and three readers still
 *  branch on it: `folderHitRect` would keep the old expanded rect as a now-
 *  INVISIBLE drop target (tiles dropped anywhere in it silently join the
 *  folder), `foldedNeuralPos` would leave the members on the canvas beside the
 *  folder tile that stands in for them, and `moveGroup` would drag them along.
 *  Normalised on load rather than by bumping the store version, which would
 *  throw away every project's arrangement. */
export function canvasArrangement(saved: PersistedCanvas | null): CanvasArrangement {
  return {
    galleryOverrides: { ...EMPTY_GALLERY_OVERRIDES, ...(saved?.galleryOverrides ?? {}) },
    frames: saved?.frames ?? [],
    groupGeom: Object.fromEntries(
      Object.entries(saved?.groupGeom ?? {}).map(([id, geom]) => [id, { ...geom, collapsed: true }]),
    ),
    tileZ: saved?.tileZ ?? {},
  };
}

/** Save one scope's arrangement. Writes only the arrangement plus the version —
 *  a legacy `stickyNotes` key is dropped, which is exactly what ADR 0041's
 *  one-time adoption wants: the notes are rows now.
 *
 *  Silent on failure (over quota, storage unavailable): an arrangement that
 *  cannot be persisted is not a reason to interrupt someone mid-drag. */
export function writeCanvasStore(key: string, arrangement: CanvasArrangement): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ v: CANVAS_STORE_VERSION, ...arrangement } satisfies PersistedCanvas),
    );
  } catch {
    // over quota / unavailable — the arrangement just won't persist this time
  }
}

/** Move from one canvas scope to another: the scope being LEFT is written under
 *  its own key, and the incoming one is returned.
 *
 *  One function because the order is the correctness argument. The arrangement on
 *  screen may be newer than what is saved — the caller debounces writes, and a
 *  scope switch right after a drag is exactly when that matters — so it has to be
 *  flushed *before* the incoming blob replaces it in state. Getting this backwards
 *  loses the arrangement of whichever scope you just left. */
export function switchCanvasScope(
  from: string,
  to: string,
  leaving: CanvasArrangement,
): CanvasArrangement {
  writeCanvasStore(from, leaving);
  return canvasArrangement(readCanvasStore(to));
}

/** Drop the legacy `stickyNotes` key from a blob, once its notes have been
 *  handed to `canvas_annotations` (ADR 0041). Rewrites nothing else: the
 *  arrangement in that blob is still the one on screen. */
export function dropLegacyNotes(key: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return;
    const blob = JSON.parse(raw) as PersistedCanvas;
    delete blob.stickyNotes;
    window.localStorage.setItem(key, JSON.stringify(blob));
  } catch {
    // The notes are on the server either way; a leftover key is harmless because
    // the adoption is guarded on the scope having no server notes.
  }
}
