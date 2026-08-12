"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { navProgressStart } from "@/components/nav/TopProgressBar";
import { useJobProgress } from "@/hooks/useJobProgress";
import { ASSET_LABELS, topicsResponseSchema } from "@archivemind/shared";
import type {
  AssetLabel,
  CanvasAnnotation,
  CanvasGroup,
  EditRecipe,
  LabelNames,
  NoteAnnotation,
  NoteFontSize,
  NoteStroke,
  PatchAnnotationRequest,
  PatchAssetExifRequest,
  TrashedAsset,
  TopicSummary,
} from "@archivemind/shared";
import { getCaptionRow } from "@/lib/format";
import { filterByLabel, type LabelFilter } from "@/lib/labels";
import { toggleChecklistLine } from "@/lib/notes";
import { planAiRun, type CaptionJobSpec } from "@/lib/ai-ops";
import { cloudErrorCopy } from "@/lib/drive-errors";
import { photoSrc } from "@/lib/img";
import type {
  CaptionStyle,
  CanvasPoint,
  CanvasUploadPreview,
  ChatMessage,
  ChatResult,
  FactStatus,
  Language,
  Photo,
  PhotoSource,
  Project,
  ProjectKey,
  Tool,
  UploadBatchResult,
  UploadBatchStart,
  ViewMode,
} from "@/types";
import {
  appendClusterAnchor,
  assetGallery,
  centerAtScale,
  fitBounds,
  DEFAULT_ZOOM,
  droppedAssetCenters,
  EMPTY_GALLERY_OVERRIDES,
  hitTestTiles,
  nudgeOffOverlap,
  packGrid,
  positionsBounds,
  readingOrder,
  minimapLayout as computeMinimapLayout,
  STICKY_NOTE_COLORS,
  timelineAxisLayout as computeTimelineLayout,
  topicAnchorOf,
  topicCloudLayout as computeTopicLayout,
  type Bounds,
  type CanvasOverride,
  type CloudLayout,
  type Frame,
  type GalleryOverrides,
  type MinimapLayout,
  type Rect,
  type StickyNote,
  type TilePos,
} from "@/lib/layout";
import type { SearchResponse } from "@archivemind/shared";
import { CHAT_GREETING } from "@/lib/chat";
import { clusterTopicKey } from "@/lib/topics";
import { committedTopicDropKey, topicDropTargetAt } from "@/lib/topic-drag";

const PROJECT_COLORS = ["#5b9bff", "#ff7a5c", "#4fd1c5", "#c084fc", "#ffd166", "#39ff6a"];
/** Stable empty tile→cloud map (Canvas / all-files mode) so the value identity
 *  doesn't change each render and defeat ProjectAssetView's memo. */
const EMPTY_TILE_CLOUD: Record<string, string> = {};
/** A brief hover distinguishes an intentional semantic drop from a tile merely
 * crossing another cloud during free-position dragging. */
const TOPIC_DROP_DWELL_MS = 240;

/** Per-project canvas arrangement (tile drags, frames, sticky notes) is kept in
 *  localStorage so it survives leaving and re-opening the project (ADR 0022).
 *  Positions are UI-only, so the browser is the right home — no backend/schema. */
const CANVAS_STORE_PREFIX = "archivemind:canvas:";
const canvasStoreKey = (projectId: string) => `${CANVAS_STORE_PREFIX}${projectId}`;
/** Copy/Paste clipboard — asset ids waiting to be linked into another project.
 *  Not per-project (the whole point is to cross between them) and not in React
 *  state, because navigating to the target project remounts the workspace. */
const CLIPBOARD_KEY = "am:clipboard:assets";
/** Saved arrangements from a different version are discarded on load — their
 *  coordinates were laid out against clouds that no longer exist. v2: everything
 *  saved by the design-branch DEMO_CLOUDS builds (fake Poland/Italy/topic clouds). */
const CANVAS_STORE_VERSION = 2;

/** Per-folder on-canvas geometry + collapse state, keyed by server group id.
 *  Client-only (ADR 0022): the server owns which assets are in the folder, the
 *  browser owns where the folder box sits and whether it's collapsed. Additive
 *  to the persisted blob — pre-folder saves simply lack it. */
export interface GroupGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed: boolean;
}

/** Collapsed-folder tile footprint (content-space px). */
export const FOLDER_TILE_W = 152;
export const FOLDER_TILE_H = 118;

/** The rect a tile's center must land inside to join a folder: the collapsed
 *  tile's box, or the whole expanded rect. */
export function folderHitRect(geom: GroupGeom): { x: number; y: number; w: number; h: number } {
  return geom.collapsed
    ? { x: geom.x, y: geom.y, w: FOLDER_TILE_W, h: FOLDER_TILE_H }
    : { x: geom.x, y: geom.y, w: geom.w, h: geom.h };
}

/** A stable default spot for a folder that has no client geometry yet (created
 *  in another session/device). Deterministic (id hash) so it doesn't jump. */
export function defaultFolderGeom(id: string): GroupGeom {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return {
    x: 48 + (h % 6) * 184,
    y: 48 + ((h >> 4) % 4) * 156,
    w: FOLDER_TILE_W,
    h: FOLDER_TILE_H,
    collapsed: true,
  };
}

/** Render model for one folder on the canvas (FolderOverlay). */
export interface FolderModel {
  id: string;
  name: string;
  count: number;
  /** Up to 3 presigned member thumbs peeking out of the collapsed folder tile. */
  previews: string[];
  /** Every member (thumb + filename) — the Finder-style popup lists these. */
  items: { id: string; filename: string; src?: string }[];
  geom: GroupGeom;
}

/** The bound "Group" sets in the current scope, as plain member-id arrays — the
 *  shape the selection logic below wants. Derived from the server groups rather
 *  than stored: a bound set is membership, and membership is the server's
 *  (migration 20260805000002). Only the geometry stays client-side. */
function boundGroupsOf(groups: CanvasGroup[]): string[][] {
  return groups.filter((g) => g.kind === "group").map((g) => g.members);
}

/** The bound "Group" set that contains `id`, or null. */
function tileGroupOf(id: string, groups: string[][]): string[] | null {
  return groups.find((g) => g.includes(id)) ?? null;
}

/** Expand a selection so any bound group with at least one selected member is
 *  pulled in whole — this is what makes a group select / move / act as a unit. */
function expandBoundGroups(ids: string[], groups: string[][]): string[] {
  if (groups.length === 0) return ids;
  const out = new Set(ids);
  for (const g of groups) if (g.some((m) => out.has(m))) for (const m of g) out.add(m);
  return Array.from(out);
}

interface PersistedCanvas {
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

/** The shape a sticky note had while it lived in localStorage: a raw hex colour
 *  and no font size. Kept solely so the one-time adoption can read an old save
 *  — do not widen it, and do not use it for anything new. */
interface LegacyStickyNote {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
}

/** The four hexes `STICKY_NOTE_COLORS` used to hold, mapped onto the seven
 *  ADR 0040 colours they became. Anything else (hand-edited storage, a build
 *  that shipped a fifth) falls back to yellow rather than dropping the note. */
const LEGACY_NOTE_COLORS: Record<string, AssetLabel> = {
  "#ffe066": "yellow",
  "#ff9eb8": "red",
  "#8ecdf7": "blue",
  "#a8e6a1": "green",
};

export type SidebarViewMode = "pile" | "list" | "gallery";

/** A real project (issue #17), fetched server-side and threaded into the
 * canvas for the header dropdown, add-to-project popovers, and labels. */
export interface ProjectOption {
  id: string;
  name: string;
  count: number;
}

/** A persisted Topic cloud that can receive an explicit user assignment. */
export interface TopicOption {
  id: string;
  label: string;
  color?: string;
  manual?: boolean;
  pinned?: boolean;
}

interface TopicTarget {
  id: string;
  label: string;
}

interface TopicPhotoState {
  id: string;
  group: Photo["group"];
  manualClusterId: string | null;
  topicId: string | null;
  topicKey: string;
}

function topicPhotoState(photo: Photo): TopicPhotoState {
  return {
    id: photo.id,
    group: photo.group,
    manualClusterId: photo.manualClusterId ?? null,
    topicId: photo.topicId ?? null,
    topicKey: photo.topicKey ?? photo.group,
  };
}

function withTopicState(photo: Photo, topic: Omit<TopicPhotoState, "id">): Photo {
  return { ...photo, ...topic };
}

/** Deterministic accent color per project id (stable across renders). */
function projectColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PROJECT_COLORS[h % PROJECT_COLORS.length];
}

/** Looks up a real project's label/color by id. */
function resolveProjectMeta(key: string, projects: ProjectOption[]): { label: string; color: string } {
  const found = projects.find((p) => p.id === key);
  return found ? { label: found.name, color: projectColor(found.id) } : { label: key, color: "var(--t3)" };
}

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface ImpState {
  open: boolean;
}

/** The two AI operations that actually exist as job types (`jobTypeSchema`).
 *  A third, "Detect & group faces", used to sit beside them in the panel with
 *  no job type, no worker handler and no effect — a checkbox that promised a
 *  feature. It's gone rather than shipped as a lie. */
interface BulkOps {
  captions: boolean;
  tags: boolean;
}

interface ProcState {
  active: boolean;
  label: string;
  pct: number;
}

/** Undo/redo checkpoint — everything the frame tool, node drags, and
 * gallery/timeline/map/topic tile drags can mutate. */
interface Snapshot {
  frames: Frame[];
  stickyNotes: StickyNote[];
  galleryOverrides: GalleryOverrides;
}


interface WorkspaceState {
  scale: number;
  tx: number;
  ty: number;
  tool: Tool;
  view: ViewMode;
  chatOpen: boolean;
  chatMsgs: ChatMessage[];
  chatInput: string;
  acctOpen: boolean;
  projOpen: boolean;
  addProjOpen: boolean;
  helpOpen: boolean;
  imp: ImpState;
  galleryOverrides: GalleryOverrides;
  /** Projects created at runtime via the source browser sidebar's "New project" flow. */
  customProjects: Project[];
  /** Source browser sidebar (Finder-style, opened by double-clicking a source tile in Neural view). */
  sidebarTabs: PhotoSource[];
  sidebarActiveTab: PhotoSource | null;
  sidebarSelectedIds: string[];
  sidebarSearchText: string;
  sidebarAddOpen: boolean;
  sidebarViewMode: SidebarViewMode;
  projCurrent: ProjectKey | "all";
  photos: Photo[];
  /** Temporary local previews; canonical assets remain server-authoritative. */
  uploadPreviews: CanvasUploadPreview[];
  terminalIngestJobs: Record<string, "done" | "failed" | "canceled">;
  selectedIds: string[];
  hoveredId: string | null;
  marquee: Marquee | null;
  drawerId: string | null;
  /** Asset id being edited in the image editor (ADR 0030), or null. */
  editorId: string | null;
  drawerLang: Language;
  drawerStyle: CaptionStyle;
  copyLabel: string;
  bulkOps: BulkOps;
  bulkLangs: Language[];
  bulkStyle: CaptionStyle;
  bulkPanelOpen: boolean;
  proc: ProcState;
  /** Assets covered by the AI job currently running — drives the per-tile
   *  "working" badge, so a photo shows its own progress instead of only the
   *  one global bar at the bottom of the canvas. */
  aiBusyIds: string[];
  toast: { show: boolean; text: string; actionLabel?: string; onAction?: () => void };
  /** True while a canvas pan drag is active (drives the grabbing cursor). */
  panning: boolean;
  /** True while Space is held: a transient pan mode layered over the hand tool,
   *  so the selected tool is never mutated and resumes on release. Not persisted. */
  spacePan: boolean;
  frames: Frame[];
  /** Canvas groups — folders + artboards (ADR 0034). Server owns membership +
   *  name + order + settings; the on-canvas geometry lives in the localStorage
   *  groupGeom bucket (ADR 0022 holds — positions stay client-side). */
  groups: CanvasGroup[];
  /** Per-group on-canvas geometry + collapse state, keyed by server group id.
   *  Client-only (persisted with the rest of the canvas arrangement). */
  groupGeom: Record<string, GroupGeom>;
  /** How many files sit on the Copy clipboard, so Paste can say so and hide
   *  itself when there is nothing to paste. Hydrated from localStorage on mount
   *  — the clipboard outlives this component by design. */
  clipboardCount: number;
  /** Per-tile stacking order (ADR 0022 client geometry) — the delta added to a
   *  tile's resting z-index by "Bring to front / Send to back". Default 0. */
  tileZ: Record<string, number>;
  /** Folder whose Finder-style popup is open (double-click a folder), or null. */
  openFolderId: string | null;
  stickyNotes: StickyNote[];
  /** The open Workspace's file ids, or null when none is open (ADR 0044). Held
   *  in state rather than a ref because `activeTilePositions` reads it from the
   *  same state object the render does — the geometry seam and the render seam
   *  must never disagree about which photos exist. */
  boardScope: ReadonlySet<string> | null;
  /** Content-space preview rect while the frame tool is actively drawing. */
  frameDraftRect: { x: number; y: number; w: number; h: number } | null;
  history: Snapshot[];
  future: Snapshot[];
  zoomMenuOpen: boolean;
  /** True briefly after a view/sort switch, while every tile reflows to its new
   *  position and the viewport re-fits — gates the CSS glide (never on during
   *  drag/pan, which must stay 1:1 with the pointer). */
  tilesAnimating: boolean;
  /** Cloud whose label was clicked — it stays prominent while the others fade
   *  (grouping views only). Null = nothing focused. */
  focusedCloudKey: string | null;
  /** Selection parked in the bulk-delete ConfirmModal (ADR 0033); null = closed. */
  confirmDeleteIds: string[] | null;
  /** In-workspace Trash panel (ADR 0033). trashAssets null = not yet loaded. */
  trashOpen: boolean;
  trashAssets: TrashedAsset[] | null;
  /** Export-to-PDF dialog (ADR 0035). exportIds = the assets it will export
   *  (a frame's content, or the current selection). */
  exportOpen: boolean;
  exportIds: string[];
  /** Colour labels (migration 20260808000001). The filter HIDES tiles, it never
   *  moves them: every layout still runs over the full photo set, so filtering
   *  cannot reflow an arrangement, change what an artboard contains, or alter
   *  what an export picks up. Only what is drawn (and what a marquee can grab)
   *  narrows. */
  labelFilter: LabelFilter;
  /** The workspace's seven colour names, defaults with renames applied. */
  labelNames: LabelNames;
  /** Left-toolbar filter popover. */
  /** Action-bar "apply a colour to the selection" popover. */
  labelMenuOpen: boolean;
}

// Transient per-pointer-move drag session (source's mutable `this.drag`).
type DragSession =
  | { mode: "pan"; sx: number; sy: number; otx: number; oty: number }
  | {
      mode: "marquee";
      startContent: { x: number; y: number };
      dx0: number;
      dy0: number;
      x1: number;
      y1: number;
      moved: boolean;
      assetPositions: Record<string, TilePos> | null;
      initialSelection: string[];
      additive: boolean;
    }
  | {
      mode: "gallery";
      kind: "source" | "asset" | "map" | "topic" | "timeline";
      key: string;
      sx: number;
      sy: number;
      orig: { x: number; y: number };
      moved: boolean;
      historyPushed: boolean;
      // When the grabbed tile is part of a multi-selection, the whole selection
      // moves together: each selected tile's original center, captured at
      // pointer-down and translated by the same (dx,dy). Null = single-tile drag.
      groupCenters: Record<string, { x: number; y: number }> | null;
      // Topic only (ADR 0038): the cloud each dragged tile belonged to when the
      // drag started, stamped onto the override so a later re-cluster can tell
      // that the coordinate is stale. Captured ONCE here rather than recomputed
      // in move(), which runs per pointer event on top of a full re-pack.
      anchors: Record<string, string> | null;
    }
  | {
      // Dragging a cloud's label moves every tile in that cloud together; a
      // click (no move) focuses the cloud instead (ADR 0024).
      mode: "cloudDrag";
      cloudKey: string;
      bucket: "map" | "topic" | "timeline";
      sx: number;
      sy: number;
      origCenters: Record<string, { x: number; y: number }>;
      moved: boolean;
      historyPushed: boolean;
      anchors: Record<string, string> | null;
    }
  | {
      mode: "sticky";
      id: string;
      sx: number;
      sy: number;
      orig: { x: number; y: number };
      moved: boolean;
    }
  | {
      // Corner handle. Its own mode rather than a flag on "sticky": the two
      // write different columns (x/y vs w/h) and so PATCH different fields on
      // release, and a resize must never move the note's origin.
      mode: "stickyResize";
      id: string;
      sx: number;
      sy: number;
      orig: { w: number; h: number };
      moved: boolean;
    }
  | {
      mode: "frameDraw";
      startContent: { x: number; y: number };
      endContent: { x: number; y: number };
      dx0: number;
      dy0: number;
      x1: number;
      y1: number;
      moved: boolean;
    }
  | {
      // Dragging inside the minimap pans the viewport continuously. The
      // content↔minimap mapping (origin/off/mscale) and the minimap element's
      // screen rect are snapshotted at pointer-down (they don't change while the
      // content stays put), and grabDx/grabDy hold the content-space offset from
      // the pointer to the viewport center so grabbing the box doesn't jump it.
      mode: "minimap";
      rectLeft: number;
      rectTop: number;
      originX: number;
      originY: number;
      offX: number;
      offY: number;
      mscale: number;
      grabDx: number;
      grabDy: number;
    }
  | null;

const DEFAULT_RECT = { left: 0, top: 0, width: 1000, height: 700 };

/** Bulk deletes of this size and up confirm first (ADR 0033): the undo toast
 *  is enough insurance for a stray click on 3 files, not for "select all". */
const BULK_DELETE_CONFIRM_AT = 8;
/** Undo toasts outlive plain ones — reading + deciding + clicking takes time. */
const UNDO_TOAST_MS = 6500;

/** Touch gestures on the canvas. A finger is imprecise and has no right button,
 *  so these mirror what every tablet canvas app already trained people to do:
 *  hold to get the menu the mouse gets from right-click, tap twice to open. */
const LONG_PRESS_MS = 480;
/** Movement past this (in CSS px) turns a hold into a drag and cancels the menu.
 *  Generous on purpose: a finger resting on glass drifts a few px on its own. */
const LONG_PRESS_SLOP = 10;
/** Double-tap window for opening a tile — the touch counterpart of dblclick,
 *  which cannot be used here because the pointerdown handlers preventDefault
 *  (and so suppress the compatibility mouse events dblclick is built from). */
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP = 24;
export interface ProjectListItem {
  key: ProjectKey;
  label: string;
  color: string;
  count: number;
  active: boolean;
}

/** The active label filter applied to a computed position map: hidden tiles
 *  lose their entry, everything else keeps the exact coordinate it already had.
 *  Positions are never recomputed for a filter — that is the whole contract
 *  (see WorkspaceState.labelFilter), and it is why filtering cannot disturb an
 *  arrangement, an artboard's contents or an export. */
function visibleTilePositions(
  positions: Record<string, TilePos>,
  photos: readonly Photo[],
  filter: LabelFilter,
): Record<string, TilePos> {
  if (!filter) return positions;
  const visible = new Set(filterByLabel(photos, filter).map((p) => p.id));
  // A pending upload holds a position before it has a Photo row. It cannot
  // answer a colour filter, but it is unlabelled by definition, so "none" keeps
  // it — a file dropped while triaging the untriaged must not vanish.
  const known = new Set(photos.map((p) => p.id));
  const next: Record<string, TilePos> = {};
  for (const [id, tile] of Object.entries(positions)) {
    if (visible.has(id) || (filter === "none" && !known.has(id))) next[id] = tile;
  }
  return next;
}

function projectCanvasItems(
  photos: readonly Photo[],
  previews: readonly CanvasUploadPreview[],
): Array<Pick<Photo, "id" | "w" | "h">> {
  const canonicalIds = new Set(photos.map((photo) => photo.id));
  const pending = previews
    .filter((preview) => !preview.assetId || !canonicalIds.has(preview.assetId))
    .map((preview) => ({
      id: preview.assetId ?? preview.clientId,
      w: preview.width,
      h: preview.height,
    }));
  // assetGallery reverses newest-first API order before assigning cells. Treat
  // optimistic uploads as the newest records so existing defaults never move.
  return [...pending, ...photos];
}

function canPreviewLocally(file: File): boolean {
  if (["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(file.type)) return true;
  return /\.(?:jpe?g|png|webp|gif|avif)$/i.test(file.name);
}

/** Keep a large drop from asking the browser to retain and decode hundreds of
 * full-size local blobs at once. Tiles beyond this cap still appear immediately
 * with their filename placeholder and reconcile to the server preview normally. */
const MAX_LOCAL_UPLOAD_PREVIEWS_PER_BATCH = 50;

export interface Workspace {
  scale: number;
  tx: number;
  ty: number;
  tool: Tool;
  view: ViewMode;
  projCurrent: ProjectKey | "all";
  photos: Photo[];
  projectPhotos: Photo[];
  /** `projectPhotos` narrowed by the colour-label filter — the render list. */
  visiblePhotos: Photo[];
  uploadPreviews: CanvasUploadPreview[];
  /** `uploadPreviews` minus the ones the filter is hiding. */
  visiblePreviews: CanvasUploadPreview[];
  projectAssetPositions: Record<string, TilePos>;
  selectedIds: Set<string>;
  hoveredId: string | null;
  drawerId: string | null;
  drawerLang: Language;
  drawerStyle: CaptionStyle;
  copyLabel: string;
  toast: { show: boolean; text: string; actionLabel?: string; onAction?: () => void };
  canvasWidth: number;
  galleryOverrides: GalleryOverrides;
  gridSize: number;
  gridPos: string;
  gridOpacity: number;
  zoomPct: string;
  canvasTransform: string;
  canvasCursor: string;
  marquee: { show: boolean; left: number; top: number; width: number; height: number };
  drawerPhoto: Photo | null;
  isNeural: boolean;
  isTimelineView: boolean;
  isMapView: boolean;
  isSenseView: boolean;
  showViewTabs: boolean;
  showAddToProject: boolean;
  /** Legacy workspace recovery grid; it is not part of primary navigation. */
  allFilesMode: boolean;
  projectMode: boolean;
  setCanvasRef: (el: HTMLDivElement | null) => void;
  onCanvasDown: (e: React.PointerEvent) => void;
  onGalleryNodeDown: (
    e: React.PointerEvent,
    kind: "source",
    key: string,
    origCenter: { x: number; y: number },
  ) => void;
  /** One tile-drag handler for every view — free-position drag into the active
   *  view's own override bucket (ADR 0022). */
  onTileDown: (
    e: React.PointerEvent,
    id: string,
    origCenter: CanvasPoint,
  ) => void;
  setHover: (id: string | null) => void;
  openDrawer: (id: string) => void;
  closeDrawer: () => void;
  navDrawer: (dir: number) => void;
  deletePhoto: (id: string) => void;
  /** Bulk-delete confirmation gate (ADR 0033): a selection of
   *  ≥ BULK_DELETE_CONFIRM_AT waits in the modal; smaller ones soft-delete
   *  straight away behind the undo toast. */
  confirmDeleteCount: number;
  confirmDeleteNow: () => void;
  cancelConfirmDelete: () => void;
  /** Right-click "Move to Trash" — the selection when one exists, else the
   *  tile under the cursor. */
  deleteFromContext: () => void;
  /** Image editor (ADR 0030). */
  editorOpen: boolean;
  editorPhoto: Photo | null;
  editBusy: boolean;
  openEditor: (id: string) => void;
  closeEditor: () => void;
  saveEdit: (recipe: EditRecipe) => void;
  resetEdit: (id: string) => void;
  setLang: (l: Language) => void;
  setStyle: (s: CaptionStyle) => void;
  copyCap: (text: string) => void;
  regen: () => void;
  saveCaption: (text: string) => void;
  /** Persist a manual Metadata/EXIF correction for the drawer's photo. */
  saveExif: (patch: PatchAssetExifRequest) => void;
  /** Restore what ingest extracted, dropping every manual correction. */
  revertExif: () => void;
  /** Confirm / un-confirm one extracted fact (feeds the caption prompt). */
  setFactStatus: (factId: string, status: "confirmed" | "likely") => void;
  genSingle: (id: string) => void;
  toolSelect: () => void;
  toolHand: () => void;
  toolFrame: () => void;
  onFit: () => void;
  onZoomReset: () => void;
  setView: (v: ViewMode) => void;

  // Frames (Figma-style canvas regions). A frame + its content acts as one unit:
  // select all inside, export it to PDF, or delete it (rect + content).
  frames: Frame[];
  frameDraft: { x: number; y: number; w: number; h: number } | null;
  frameCounts: Record<string, number>;
  deleteFrame: (id: string) => void;
  deleteFrameWithContent: (id: string) => void;
  renameFrame: (id: string, label: string) => void;
  selectFrame: (id: string) => void;
  exportFrame: (id: string) => void;
  beginFrameMove: (id: string) => void;
  beginFrameResize: (id: string, handle: "nw" | "ne" | "sw" | "se") => void;
  frameGestureMove: (dx: number, dy: number) => void;
  endFrameGesture: () => void;

  // Folders (ADR 0034) — server-backed grouping, client-side geometry
  folders: FolderModel[];
  /** Open a folder's Finder-style popup (double-click). */
  openFolder: (id: string) => void;
  /** Close the folder popup. */
  closeFolder: () => void;
  /** The folder whose popup is open, or null. */
  openFolderId: string | null;
  /** Drag a member out of a folder dropdown onto the Canvas at (clientX, clientY). */
  dropMemberOnCanvas: (folderId: string, assetId: string, clientX: number, clientY: number) => void;
  renameGroup: (id: string, name: string) => void;
  deleteGroup: (id: string) => void;
  moveGroup: (id: string, dx: number, dy: number) => void;

  // Selection actions (bottom action bar + right-click menu)
  deleteSelected: () => void;
  copyFiles: () => void;
  /** Link the copied files into the project being viewed. */
  pasteFiles: () => void;
  /** Files waiting on the clipboard — drives the Paste entry. */
  clipboardCount: number;
  exportFiles: () => void;
  /** Open the Export-to-PDF dialog for an explicit asset set (ADR 0035). */
  openExportFor: (ids: string[]) => void;
  exportOpen: boolean;
  exportIds: string[];
  closeExport: () => void;
  /** Bind the selection into a move-/edit-together set (client-only, no folder). */
  groupFiles: () => void;
  /** Dissolve every bound group the selection touches. */
  ungroupSelection: () => void;
  /** True when the selection overlaps a bound group (drives Group ↔ Ungroup). */
  selectionHasGroup: boolean;
  /** Tile stacking order — context-menu layer actions + the map tiles read. */
  bringToFront: () => void;
  bringForward: () => void;
  sendBackward: () => void;
  sendToBack: () => void;
  tileZ: Record<string, number>;
  /** Wrap the selection in a real folder (ADR 0034) — collapsible tile + popup. */
  folderFiles: () => void;
  /** Re-arrange the Canvas into a clean grid (selection-aware). */
  tidyUp: () => void;
  /** Drop the sorting view's drag overrides so tiles glide back into their
   *  packed clouds / date columns (selection-aware). Topic, Timeline + LABELS. */
  regroupClouds: () => void;
  /** True when the active sorting view has drags to undo — the Regroup button
   *  is dead otherwise. */
  canRegroup: boolean;
  /** Re-run the workspace's semantic clustering now (ADR 0038). Zero credits. */
  recluster: () => void;
  /** Rename one Topic cloud (ADR 0038); null clusterId clouds aren't renameable. */
  renameCloud: (clusterId: string, label: string) => void;
  /** Persisted Topic destinations in the workspace, including clouds not
   * represented in the currently open project. */
  topicOptions: TopicOption[];
  /** Effective stored topic shared by the selection, or null for mixed/
   * heuristic selections. */
  selectedTopicId: string | null;
  /** At least one selected asset currently carries a human override. */
  canReturnSelectionToAi: boolean;
  /** A create/move/reset mutation is waiting on the server. */
  topicMutationBusy: boolean;
  moveSelectionToTopic: (topicId: string) => void;
  createTopicFromSelection: (label: string) => void;
  returnSelectionToAi: () => void;
  /** Explicit semantic drop target armed after the pointer dwells over a
   * different Topic cloud. Null keeps ordinary free-position drag semantics. */
  topicDropTargetKey: string | null;
  addToNewArtboard: () => void;
  addToExistingArtboard: (frameId: string) => void;

  // Right-click grid menu
  contextMenu: { x: number; y: number; targetId: string | null } | null;
  openContextMenu: (x: number, y: number, targetId: string | null) => void;
  closeContextMenu: () => void;

  // Sticky notes
  stickyNotes: StickyNote[];
  addStickyNote: () => void;
  onStickyDown: (e: React.PointerEvent, id: string, orig: { x: number; y: number }) => void;
  onStickyResizeDown: (e: React.PointerEvent, id: string, orig: { w: number; h: number }) => void;
  updateStickyText: (id: string, text: string) => void;
  setStickyColor: (id: string, color: AssetLabel) => void;
  setStickyFontSize: (id: string, fontSize: NoteFontSize) => void;
  /** Tick/untick one `[ ]` line from the rendered body, no editor involved. */
  toggleStickyCheck: (id: string, lineIndex: number) => void;
  /** Replace a note's freehand drawing (ADR 0041 as amended — ink lives ON the
   *  note now). Persists the whole `body` (text + strokes together) so a text
   *  save can't wipe the drawing or vice versa; pushes history so Cmd+Z reaches
   *  it, the same way an erase used to be one undo step. */
  setStickyStrokes: (id: string, strokes: NoteStroke[]) => void;
  deleteStickyNote: (id: string) => void;

  // Undo / redo
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  // Zoom dropdown
  zoomMenuOpen: boolean;
  toggleZoomMenu: () => void;
  closeZoomMenu: () => void;
  setZoomPct: (pct: number) => void;

  // Minimap
  minimap: MinimapLayout;
  onMinimapDown: (e: React.PointerEvent<HTMLDivElement>) => void;

  // Layout constants (no left sidebar anymore)
  contentLeft: number;
  drawerRight: number;
  /** Combined right-panel offset for the minimap so it never sits under an
   * open chat, source browser, or photo drawer. */
  minimapRight: number;

  extractExif: () => void;

  // Chat
  chatOpen: boolean;
  chatMsgs: ChatMessage[];
  chatInput: string;
  toggleChat: () => void;
  closeChat: () => void;
  sendChat: (text?: string) => void;
  selectSearchResults: (ids: string[]) => void;
  onChatInput: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onChatKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;

  // Project / account dropdowns
  acctOpen: boolean;
  projOpen: boolean;
  projLabel: string;
  projectList: ProjectListItem[];
  openAcct: () => void;
  closeAcct: () => void;
  openProj: () => void;
  closeProj: () => void;
  selectProject: (k: ProjectKey) => void;
  goHome: () => void;

  // Add to project
  addProjOpen: boolean;
  toggleAddProj: () => void;
  closeAddProj: () => void;
  addToProject: (key: ProjectKey) => void;
  createNewProject: () => void;

  // Legacy source browser sidebar (not part of primary navigation)
  sidebarOpen: boolean;
  sidebarTabs: PhotoSource[];
  sidebarActiveTab: PhotoSource | null;
  sidebarSelectedIds: Set<string>;
  sidebarSearchText: string;
  sidebarAddOpen: boolean;
  openSourceTab: (source: PhotoSource) => void;
  closeSourceTab: (source: PhotoSource) => void;
  setSidebarActiveTab: (source: PhotoSource) => void;
  closeSidebar: () => void;
  toggleSidebarFile: (id: string) => void;
  toggleSidebarGroup: (ids: string[]) => void;
  setSidebarSearch: (text: string) => void;
  toggleSidebarAddOpen: () => void;
  closeSidebarAddOpen: () => void;
  sidebarAddToProject: (key: string) => void;
  sidebarCreateProject: () => void;
  sidebarViewMode: SidebarViewMode;
  setSidebarViewMode: (mode: SidebarViewMode) => void;

  // Help
  helpOpen: boolean;
  openHelp: () => void;
  closeHelp: () => void;

  // Import
  impOpen: boolean;
  addToolbar: () => void;
  closeImport: () => void;
  onUploadBatchStart: (batch: UploadBatchStart) => void;
  onUploadBatchSettled: (result: UploadBatchResult) => void;

  // Trash panel (ADR 0033)
  trashOpen: boolean;
  trashAssets: TrashedAsset[] | null;
  openTrash: () => void;
  closeTrash: () => void;
  toggleTrash: () => void;
  restoreFromTrash: (ids: string[]) => void;
  purgeFromTrash: (ids: string[]) => void;

  // Grouping views (Timeline / Map / Topic) are the same canvas as Canvas, just
  // sorted — `activePositions` is the current view's tile layout and `cloudDecor`
  // is its backdrop/edges/labels (null on the unsorted Canvas). `tilesAnimating`
  // gates the reflow glide when a sort changes (ADR 0022).
  activePositions: Record<string, TilePos>;
  cloudDecor: CloudLayout | null;
  tilesAnimating: boolean;
  /** Cloud focus (ADR 0024): the focused cloud's key, the tile→cloud map used to
   *  fade the rest, and the label pointer-down handler (drag whole cloud / click
   *  to focus). */
  focusedCloudKey: string | null;
  tileCloud: Record<string, string>;
  onCloudLabelDown: (e: React.PointerEvent, cloudKey: string) => void;

  // Colour labels (migration 20260808000001) — assign from the context menu /
  // action bar / drawer / right-click menu; the same control filters when there
  // is no selection to mark (ADR 0040, amended).
  labelNames: LabelNames;
  labelFilter: LabelFilter;
  labelMenuOpen: boolean;
  setLabelFilter: (filter: LabelFilter) => void;
  clearLabelFilter: () => void;
  toggleLabelMenu: () => void;
  closeLabelMenu: () => void;
  /** Apply/clear a colour on the selection, or on `fallbackId` when nothing is
   *  selected (the right-clicked tile). */
  labelSelection: (label: AssetLabel | null, fallbackId?: string | null) => void;
  /** One photo, ignoring the selection — the drawer's picker. */
  labelOne: (id: string, label: AssetLabel | null) => void;
  renameLabel: (label: AssetLabel, name: string) => void;

  // Bulk AI
  bulkPanelOpen: boolean;
  toggleBulkPanel: () => void;
  bulkShow: boolean;
  bulkIdle: boolean;
  /** Exactly the ids `runBulk` will act on — the panel plans its button text
   *  from these, so label and work share one input. */
  bulkSelectedIds: string[];
  bulkThumbs: { src: string; ml: number }[];
  bulkOps: BulkOps;
  bulkLangs: Language[];
  bulkStyle: CaptionStyle;
  proc: ProcState;
  /** Assets in the running AI job — per-tile "working" state. */
  aiBusyIds: Set<string>;
  toggleBulkCaptions: () => void;
  toggleBulkTags: () => void;
  toggleBulkLang: (l: Language) => void;
  setBulkStyle: (s: CaptionStyle) => void;
  clearSelection: () => void;
  runBulk: () => void;
  /** Analyze a single asset (tile badge). */
  analyzePhoto: (id: string) => void;

  flashToast: (text: string, action?: { label: string; onAction: () => void }) => void;
}

/** A `canvas_annotations` row of kind 'note' (ADR 0041) → the canvas's own note
 *  shape. Takes the narrowed type rather than the union: the discriminant is
 *  what guarantees `body.text` exists, and widening the parameter would put that
 *  guarantee back in the caller's hands. */
/** The photos this canvas lays out. A Workspace (board) narrows the canvas to
 *  its own files, and — unlike the colour-label filter, which HIDES tiles while
 *  leaving every position intact — a board is a different canvas: its files pack
 *  as if the others were not there.
 *
 *  That difference is why the scope is applied HERE, at the seam every layout
 *  reads, instead of at the render seam `visibleTilePositions` where the filter
 *  lives. `activeTilePositions` (geometry: drags, folder drops, artboard
 *  membership, export order) and the rendered positions must be computed from
 *  the same set, or a drag moves a tile to a coordinate nobody can see. */
function canvasPhotos(photos: readonly Photo[], scope: ReadonlySet<string> | null): Photo[] {
  return scope ? photos.filter((p) => scope.has(p.id)) : [...photos];
}

function annotationToNote(a: NoteAnnotation): StickyNote {
  return {
    id: a.id,
    x: a.x,
    y: a.y,
    w: a.w,
    h: a.h,
    text: a.body.text,
    strokes: a.body.strokes,
    color: a.color,
    fontSize: a.style.fontSize,
  };
}

/** A note that exists on the canvas but not yet in the database — the window
 *  between the click and the INSERT coming back. Prefixed rather than flagged so
 *  every network path can recognise one from the id alone: PATCHing or DELETEing
 *  a `tmp-` id would be a 400 against a row that has no uuid yet. */
const TMP_NOTE_PREFIX = "tmp-";
const isTmpNote = (id: string) => id.startsWith(TMP_NOTE_PREFIX);

/** Text is saved on a debounce — a PATCH per keystroke would be one request per
 *  character on a note somebody is actually writing in. Long enough to batch a
 *  sentence, short enough that a browser closed mid-thought keeps it. */
const NOTE_TEXT_SAVE_MS = 700;

/** Resize bounds. The floor is a usability one — below it the header strip and
 *  its controls stop fitting — and sits well inside the schema's own 40..4000,
 *  so the server never has to reject a drag the UI allowed. */
const NOTE_MIN_SIZE = 120;
const NOTE_MAX_SIZE = 4000;
const clampNoteSize = (v: number) => Math.min(NOTE_MAX_SIZE, Math.max(NOTE_MIN_SIZE, Math.round(v)));

export function useWorkspace(
  initialPhotos: Photo[],
  workspaceId: string,
  initialProjects: ProjectOption[],
  currentProjectId: string,
  initialGroups: CanvasGroup[],
  initialLabelNames: LabelNames,
  initialAnnotations: CanvasAnnotation[],
  /** The open Workspace's asset ids, or null for "no board open" (ADR 0044). */
  boardScopeIds: readonly string[] | null = null,
): Workspace {
  const router = useRouter();
  const [state, setStateRaw] = useState<WorkspaceState>({
    // Start at the 75% default so the first paint matches every view's fit,
    // even in the brief window before tryFit centers on the real content (ADR 0022).
    scale: DEFAULT_ZOOM,
    tx: 200,
    ty: 120,
    tool: "select",
    view: "neural",
    chatOpen: false,
    chatMsgs: [{ role: "assistant", text: CHAT_GREETING }],
    chatInput: "",
    acctOpen: false,
    projOpen: false,
    addProjOpen: false,
    helpOpen: false,
    imp: { open: false },
    galleryOverrides: EMPTY_GALLERY_OVERRIDES,
    customProjects: [],
    projCurrent: currentProjectId,
    sidebarTabs: [],
    sidebarActiveTab: null,
    sidebarSelectedIds: [],
    sidebarSearchText: "",
    sidebarAddOpen: false,
    sidebarViewMode: "list",
    photos: initialPhotos,
    uploadPreviews: [],
    terminalIngestJobs: {},
    selectedIds: [],
    hoveredId: null,
    marquee: null,
    drawerId: null,
    editorId: null,
    drawerLang: "EN",
    drawerStyle: "Agency",
    copyLabel: "Copy",
    // Both on by default, so the panel's primary action is the same
    // "Analyze & caption" the drawer offers on a single photo. The checkboxes
    // exist for the two genuinely separate cases — re-captioning in another
    // language without paying to re-analyze, and bulk-analyzing purely to make
    // an archive searchable — not as a choice the user must make every time.
    bulkOps: { captions: true, tags: true },
    bulkLangs: ["EN"],
    bulkStyle: "Agency",
    bulkPanelOpen: false,
    proc: { active: false, label: "", pct: 0 },
    aiBusyIds: [],
    toast: { show: false, text: "" },
    panning: false,
    spacePan: false,
    frames: [],
    groups: initialGroups,
    groupGeom: {},
    tileZ: {},
    clipboardCount: 0,
    openFolderId: null,
    // Server-backed since ADR 0041 — the Server Component read them, so the
    // first paint already has them and there is no post-mount fetch flicker.
    stickyNotes: initialAnnotations
      .filter((a): a is NoteAnnotation => a.kind === "note")
      .map(annotationToNote),
    boardScope: null,
    frameDraftRect: null,
    history: [],
    future: [],
    zoomMenuOpen: false,
    tilesAnimating: false,
    focusedCloudKey: null,
    confirmDeleteIds: null,
    trashOpen: false,
    trashAssets: null,
    exportOpen: false,
    exportIds: [],
    labelFilter: null,
    labelNames: initialLabelNames,
    labelMenuOpen: false,
  });

  // Right-click menu on the grid — a lightweight overlay, kept out of the main
  // reducer state since it never needs undo/persist and closes on any action.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; targetId: string | null } | null>(null);
  const [topicMutationBusy, setTopicMutationBusyState] = useState(false);
  const [topicCatalog, setTopicCatalog] = useState<TopicSummary[]>([]);
  const topicMutationBusyRef = useRef(false);
  const setTopicMutationBusy = useCallback((busy: boolean) => {
    topicMutationBusyRef.current = busy;
    setTopicMutationBusyState(busy);
  }, []);
  const [topicDropTargetKey, setTopicDropTargetKey] = useState<string | null>(null);

  // Mirror of committed state, kept current for window-level event handlers.
  const stateRef = useRef(state);
  const dragRef = useRef<DragSession>(null);
  /** Touch bookkeeping for the canvas (tablets/phones). The desktop paths above
   *  assume exactly one pointer: `move`/`up` read a single `dragRef` session, so
   *  a second finger used to restart the drag from its own origin and the first
   *  finger lifting used to end it. Everything a finger can do that a mouse
   *  cannot — pinch, two-finger pan, long-press, double-tap — is arbitrated
   *  here, in ONE place, rather than by teaching each drag handler about it.
   *  `suppress` swallows the rest of a gesture once it has been claimed by a
   *  pinch or a long-press, and clears only when every finger is off the glass. */
  const touchRef = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    primary: number | null;
    pinch: { dist: number; cx: number; cy: number; scale: number; tx: number; ty: number } | null;
    longPress: ReturnType<typeof setTimeout> | null;
    longPressAt: { x: number; y: number } | null;
    suppress: boolean;
    lastTap: { id: string; at: number; x: number; y: number } | null;
  }>({
    pointers: new Map(),
    primary: null,
    pinch: null,
    longPress: null,
    longPressAt: null,
    suppress: false,
    lastTap: null,
  });
  const canvasElRef = useRef<HTMLDivElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** One debounced text save per note (ADR 0041) — keyed by id, because two
   *  notes can be edited in the same window and a single shared timer would let
   *  the second one's keystrokes cancel the first one's save. */
  const noteTextTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /** The layout the canvas currently renders (committed post-render) — read by
   *  pointer-down handlers so they never recompute a pack/edge pass. */
  const cloudDecorRef = useRef<CloudLayout | null>(null);
  /** Semantic Topic drop is armed only after a short dwell. Candidate and
   * armed target live in refs because pointermove must read them without
   * waiting for React to commit a render. */
  const topicDropRef = useRef<{
    candidateKey: string | null;
    targetKey: string | null;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ candidateKey: null, targetKey: null, timer: null });
  const activeJobId = useRef<string | null>(null);
  /** Queued second leg of an "analyze, then caption" run. The two are separate
   *  job types and captions read the facts analyze writes, so they can't be one
   *  job — this fires the caption leg when the analyze leg reports done. */
  const followUpCaption = useRef<CaptionJobSpec | null>(null);
  const objectUrlsRef = useRef(new Map<string, string>());

  // Patch helper that also advances stateRef so sequential reads see fresh data.
  const setState = useCallback((
    patch: Partial<WorkspaceState> | ((previous: WorkspaceState) => Partial<WorkspaceState>),
  ) => {
    setStateRaw((prev) => {
      const resolved = typeof patch === "function" ? patch(prev) : patch;
      const next = { ...prev, ...resolved };
      stateRef.current = next;
      return next;
    });
  }, []);

  // Fresh server data (router.refresh after an upload / analyze / add-to-project)
  // syncs in place. The page key used to include photo counts, so every refresh
  // remounted the whole workspace — resetting pan/zoom/view/selection mid-work.
  // Documented React pattern: adjust state during render when a prop changes.
  const [syncedPhotos, setSyncedPhotos] = useState(initialPhotos);
  if (syncedPhotos !== initialPhotos) {
    setSyncedPhotos(initialPhotos);
    const ids = new Set(initialPhotos.map((p) => p.id));
    const canonical = new Map(initialPhotos.map((photo) => [photo.id, photo]));
    const uploadPreviews = state.uploadPreviews.flatMap((preview): CanvasUploadPreview[] => {
      if (!preview.assetId) return [preview];
      const photo = canonical.get(preview.assetId);
      if (photo?.src) return [];
      if (preview.stage === "error") return [preview];
      const terminal = preview.jobId ? state.terminalIngestJobs[preview.jobId] : undefined;
      if (!terminal) return [preview];
      if (terminal === "done") {
        if (!photo) return [];
        return [{ ...preview, stage: "ready", message: "Preview unavailable" }];
      }
      return [{ ...preview, stage: "error", message: `Processing ${terminal}` }];
    });
    setState({
      photos: initialPhotos,
      uploadPreviews,
      selectedIds: state.selectedIds.filter((id) => ids.has(id)),
      sidebarSelectedIds: state.sidebarSelectedIds.filter((id) => ids.has(id)),
      drawerId: state.drawerId && ids.has(state.drawerId) ? state.drawerId : null,
      hoveredId: state.hoveredId && ids.has(state.hoveredId) ? state.hoveredId : null,
    });
  }

  const rect = useCallback(() => {
    return canvasElRef.current
      ? canvasElRef.current.getBoundingClientRect()
      : DEFAULT_RECT;
  }, []);

  const toContent = useCallback(
    (cx: number, cy: number) => {
      const r = rect();
      const s = stateRef.current;
      return { x: (cx - r.left - s.tx) / s.scale, y: (cy - r.top - s.ty) / s.scale };
    },
    [rect],
  );

  const clearTopicDropTarget = useCallback(() => {
    const current = topicDropRef.current;
    if (current.timer) clearTimeout(current.timer);
    const changed = current.candidateKey !== null || current.targetKey !== null;
    topicDropRef.current = { candidateKey: null, targetKey: null, timer: null };
    if (changed) setTopicDropTargetKey(null);
  }, []);

  const armTopicDropTarget = useCallback(
    (key: string | null) => {
      const current = topicDropRef.current;
      if (key === current.candidateKey) return;
      if (current.timer) clearTimeout(current.timer);
      topicDropRef.current = { candidateKey: key, targetKey: null, timer: null };
      if (current.targetKey !== null) setTopicDropTargetKey(null);
      if (!key) return;
      const timer = setTimeout(() => {
        if (topicDropRef.current.candidateKey !== key) return;
        topicDropRef.current = { candidateKey: key, targetKey: key, timer: null };
        setTopicDropTargetKey(key);
      }, TOPIC_DROP_DWELL_MS);
      topicDropRef.current.timer = timer;
    },
    [],
  );

  const flashToast = useCallback(
    (text: string, action?: { label: string; onAction: () => void }) => {
      setState({
        toast: { show: true, text, actionLabel: action?.label, onAction: action?.onAction },
      });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(
        () => setState({ toast: { show: false, text: "" } }),
        // An action needs reading + deciding + clicking; plain confirmations don't.
        action ? UNDO_TOAST_MS : 3200,
      );
    },
    [setState],
  );

  const scheduleTopicAnimationEnd = useCallback(() => {
    if (animTimer.current) clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setState({ tilesAnimating: false }), 470);
  }, [setState]);

  const applyTopicTargetLocally = useCallback(
    (ids: readonly string[], target: TopicTarget | null, consumeDragHistory = false) => {
      const idSet = new Set(ids);
      setState((previous) => {
        const topicOverrides = { ...previous.galleryOverrides.topic };
        for (const id of idSet) delete topicOverrides[id];
        return {
          photos: previous.photos.map((photo) => {
            if (!idSet.has(photo.id)) return photo;
            return target
              ? withTopicState(photo, {
                  group: target.label,
                  manualClusterId: target.id,
                  topicId: target.id,
                  topicKey: clusterTopicKey(target.id),
                })
              : withTopicState(photo, {
                  group: photo.autoTopicLabel ?? photo.group,
                  manualClusterId: null,
                  topicId: photo.autoClusterId ?? null,
                  topicKey: photo.autoTopicKey ?? photo.group,
                });
          }),
          galleryOverrides: { ...previous.galleryOverrides, topic: topicOverrides },
          history: consumeDragHistory ? previous.history.slice(0, -1) : previous.history,
          future: consumeDragHistory ? [] : previous.future,
          focusedCloudKey: null,
          tilesAnimating: true,
        };
      });
      scheduleTopicAnimationEnd();
    },
    [scheduleTopicAnimationEnd, setState],
  );

  const restoreTopicStateLocally = useCallback(
    (before: readonly TopicPhotoState[], topicOverrides: Record<string, CanvasOverride>) => {
      const byId = new Map(before.map((photo) => [photo.id, photo]));
      setState((previous) => ({
        photos: previous.photos.map((photo) => {
          const snapshot = byId.get(photo.id);
          return snapshot
            ? withTopicState(photo, {
                group: snapshot.group,
                manualClusterId: snapshot.manualClusterId,
                topicId: snapshot.topicId,
                topicKey: snapshot.topicKey,
              })
            : photo;
        }),
        galleryOverrides: { ...previous.galleryOverrides, topic: { ...topicOverrides } },
        focusedCloudKey: null,
        tilesAnimating: true,
      }));
      scheduleTopicAnimationEnd();
    },
    [scheduleTopicAnimationEnd, setState],
  );

  const writeTopicAssignments = useCallback(async (assetIds: readonly string[], clusterId: string | null) => {
    const response = await fetch("/api/topics/assignments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds, clusterId }),
    });
    if (response.ok) return;
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? String(response.status));
  }, []);

  const restoreTopicAssignmentsOnServer = useCallback(
    async (before: readonly TopicPhotoState[]) => {
      const groups = new Map<string | null, string[]>();
      for (const photo of before) {
        const key = photo.manualClusterId;
        const ids = groups.get(key) ?? [];
        ids.push(photo.id);
        groups.set(key, ids);
      }
      const results = await Promise.allSettled(
        [...groups].map(([clusterId, ids]) => writeTopicAssignments(ids, clusterId)),
      );
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) throw failed.reason;
    },
    [writeTopicAssignments],
  );

  const persistTopicAssignment = useCallback(
    async (
      ids: readonly string[],
      target: TopicTarget | null,
      options?: { beforeTopicOverrides?: Record<string, CanvasOverride>; consumeDragHistory?: boolean },
    ) => {
      if (topicMutationBusyRef.current) {
        flashToast("A topic change is already being saved");
        return;
      }
      const idSet = new Set(ids);
      const current = stateRef.current;
      const before = current.photos.filter((photo) => idSet.has(photo.id)).map(topicPhotoState);
      if (before.length === 0) return;
      if (target && before.every((photo) => photo.manualClusterId === target.id)) return;
      if (!target && before.every((photo) => photo.manualClusterId === null)) return;

      const beforeOverrides = { ...(options?.beforeTopicOverrides ?? current.galleryOverrides.topic) };
      setTopicMutationBusy(true);
      applyTopicTargetLocally(before.map((photo) => photo.id), target, options?.consumeDragHistory ?? false);
      try {
        await writeTopicAssignments(before.map((photo) => photo.id), target?.id ?? null);
        router.refresh();
        const count = before.length;
        const message = target
          ? `Moved ${count} ${count === 1 ? "file" : "files"} to ${target.label}`
          : `Returned ${count} ${count === 1 ? "file" : "files"} to AI`;
        flashToast(message, {
          label: "Undo",
          onAction: () => {
            restoreTopicStateLocally(before, beforeOverrides);
            setTopicMutationBusy(true);
            void restoreTopicAssignmentsOnServer(before)
              .then(() => {
                router.refresh();
                flashToast("Topic change undone");
              })
              .catch(() => {
                router.refresh();
                flashToast("Couldn't undo that topic change — refresh to see the saved state");
              })
              .finally(() => setTopicMutationBusy(false));
          },
        });
      } catch {
        restoreTopicStateLocally(before, beforeOverrides);
        // A lost response is ambiguous: the RPC may have committed even though
        // fetch rejected. Restore immediately for continuity, then let the
        // server read settle the truth instead of leaving a split-brain canvas.
        router.refresh();
        flashToast("Couldn't confirm that topic change — refreshing the saved state");
      } finally {
        setTopicMutationBusy(false);
      }
    },
    [
      applyTopicTargetLocally,
      flashToast,
      restoreTopicAssignmentsOnServer,
      restoreTopicStateLocally,
      router,
      setTopicMutationBusy,
      writeTopicAssignments,
    ],
  );

  const createTopicForAssets = useCallback(
    async (label: string, ids: readonly string[]) => {
      const trimmed = label.trim();
      if (!trimmed || ids.length === 0) return;
      if (topicMutationBusyRef.current) {
        flashToast("A topic change is already being saved");
        return;
      }
      const idSet = new Set(ids);
      const current = stateRef.current;
      const before = current.photos.filter((photo) => idSet.has(photo.id)).map(topicPhotoState);
      if (before.length === 0) return;
      const beforeOverrides = { ...current.galleryOverrides.topic };

      setTopicMutationBusy(true);
      try {
        const response = await fetch("/api/topics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: trimmed, assetIds: before.map((photo) => photo.id) }),
        });
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          topic?: TopicTarget;
        } | null;
        if (!response.ok || !body?.topic) throw new Error(body?.error ?? String(response.status));

        const target = body.topic;
        setTopicCatalog((previous) => [
          ...previous.filter((topic) => topic.id !== target.id),
          { id: target.id, label: target.label, origin: "manual" },
        ]);
        applyTopicTargetLocally(before.map((photo) => photo.id), target);
        router.refresh();
        const count = before.length;
        flashToast(`Created ${target.label} with ${count} ${count === 1 ? "file" : "files"}`, {
          label: "Undo",
          onAction: () => {
            restoreTopicStateLocally(before, beforeOverrides);
            setTopicMutationBusy(true);
            void fetch(`/api/topics/${target.id}`, { method: "DELETE" })
              .then((deleteResponse) => {
                if (!deleteResponse.ok) throw new Error(String(deleteResponse.status));
                setTopicCatalog((previous) => previous.filter((topic) => topic.id !== target.id));
                return restoreTopicAssignmentsOnServer(before);
              })
              .then(() => {
                router.refresh();
                flashToast("New topic removed");
              })
              .catch(() => {
                router.refresh();
                flashToast("Couldn't undo that topic creation — refresh to see the saved state");
              })
              .finally(() => setTopicMutationBusy(false));
          },
        });
      } catch {
        // The create RPC is atomic but the response can still be lost after
        // commit. A refresh reveals the resulting manual topic/assignments if
        // that happened; if it did not, the current selection simply remains.
        router.refresh();
        flashToast("Couldn't confirm topic creation — refreshing the saved state");
      } finally {
        setTopicMutationBusy(false);
      }
    },
    [
      applyTopicTargetLocally,
      flashToast,
      restoreTopicAssignmentsOnServer,
      restoreTopicStateLocally,
      router,
      setTopicCatalog,
      setTopicMutationBusy,
    ],
  );

  // Real data is already scoped by the route (getPhotos(projectId)), so the
  // canvas shows every photo the server returned — no client-side project filter.
  /** Kept as the one place a "which photos are on this canvas" rule lives; the
   *  route already scopes by project, so a Workspace (ADR 0044) is the only
   *  narrowing left. Reads `state.boardScope`, not the prop, so it can never
   *  disagree with `canvasPhotos` — see that helper for why one source matters. */
  // The open Workspace, mirrored into state so `activeTilePositions` reads the
  // same scope the render did. Keyed on the id list's contents, not its identity:
  // `useBoards` rebuilds the array on every board edit.
  const boardScopeKey = boardScopeIds ? boardScopeIds.join(",") : null;
  useEffect(() => {
    setState({ boardScope: boardScopeKey === null ? null : new Set(boardScopeKey.split(",").filter(Boolean)) });
  }, [boardScopeKey, setState]);

  const filteredPhotos = useCallback(
    (photos: Photo[]) => {
      const scope = state.boardScope;
      return scope ? photos.filter((p) => scope.has(p.id)) : photos;
    },
    [state.boardScope],
  );

  /** Fire-and-forget PATCH of one note (ADR 0041). A failure is reported once,
   *  in the toast, and the local state is deliberately NOT rolled back: yanking
   *  a sentence out from under someone mid-note to satisfy the server is worse
   *  than a stale row. Defined up here because undo/redo needs it. */
  const patchNote = useCallback(
    (id: string, patch: PatchAnnotationRequest) => {
      if (isTmpNote(id)) return; // no row yet; the create carries the current state
      void fetch(`/api/annotations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
        .then((res) => {
          if (!res.ok) flashToast("Note not saved");
        })
        .catch(() => flashToast("Note not saved"));
    },
    [flashToast],
  );

  /** Undo/redo restores a whole state snapshot, and notes are in it — but a note
   *  is a row now, not local state, so the snapshot alone would leave Cmd+Z
   *  silently disagreeing with the database until the next reload. Diff the two
   *  lists and make the server match.
   *
   *  A note the undo brings BACK cannot keep its uuid: that row was deleted, so
   *  it is re-inserted and the new id adopted in place. Nothing user-visible
   *  changes — it is the same note, at the same place, saying the same thing. */
  const reconcileNotes = useCallback(
    (before: StickyNote[], after: StickyNote[]) => {
      const beforeById = new Map(before.map((n) => [n.id, n]));
      const afterById = new Map(after.map((n) => [n.id, n]));

      for (const gone of before) {
        if (afterById.has(gone.id) || isTmpNote(gone.id)) continue;
        void fetch(`/api/annotations/${gone.id}`, { method: "DELETE" }).catch(() => {
          flashToast("Note not deleted");
        });
      }

      for (const now of after) {
        const prev = beforeById.get(now.id);
        if (prev) {
          const moved = prev.x !== now.x || prev.y !== now.y || prev.w !== now.w || prev.h !== now.h;
          const restyled =
            prev.text !== now.text ||
            prev.color !== now.color ||
            prev.fontSize !== now.fontSize ||
            prev.strokes !== now.strokes;
          if (moved || restyled) {
            patchNote(now.id, {
              x: now.x,
              y: now.y,
              w: now.w,
              h: now.h,
              color: now.color,
              body: { text: now.text, strokes: now.strokes },
              style: { fontSize: now.fontSize },
            });
          }
          continue;
        }
        void fetch("/api/annotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "note",
            projectId: currentProjectId === "all" ? null : currentProjectId,
            x: now.x,
            y: now.y,
            w: now.w,
            h: now.h,
            color: now.color,
            body: { text: now.text, strokes: now.strokes },
            style: { fontSize: now.fontSize },
          }),
        })
          .then(async (res) => {
            if (!res.ok) throw new Error(String(res.status));
            const saved = annotationToNote(await res.json());
            setState({
              stickyNotes: stateRef.current.stickyNotes.map((m) =>
                m.id === now.id ? { ...m, id: saved.id } : m,
              ),
            });
          })
          .catch(() => flashToast("Note not restored"));
      }
    },
    [patchNote, currentProjectId, setState, flashToast],
  );

  // ── Undo / redo ──────────────────────────────────────────────────────────

  const snapshot = useCallback((s: WorkspaceState): Snapshot => ({
    frames: s.frames,
    stickyNotes: s.stickyNotes,
    galleryOverrides: s.galleryOverrides,
  }), []);

  const pushHistory = useCallback(() => {
    const s = stateRef.current;
    const hist = s.history.slice(-49);
    hist.push(snapshot(s));
    setState({ history: hist, future: [] });
  }, [setState, snapshot]);

  const undo = useCallback(() => {
    if (topicMutationBusyRef.current) {
      flashToast("Wait for the current topic change to finish");
      return;
    }
    const s = stateRef.current;
    if (!s.history.length) return;
    const hist = s.history.slice();
    const prev = hist.pop() as Snapshot;
    const future = s.future.slice();
    future.push(snapshot(s));
    setState({ ...prev, history: hist, future });
    reconcileNotes(s.stickyNotes, prev.stickyNotes);
  }, [setState, snapshot, reconcileNotes, flashToast]);

  const redo = useCallback(() => {
    if (topicMutationBusyRef.current) {
      flashToast("Wait for the current topic change to finish");
      return;
    }
    const s = stateRef.current;
    if (!s.future.length) return;
    const future = s.future.slice();
    const next = future.pop() as Snapshot;
    const hist = s.history.slice();
    hist.push(snapshot(s));
    setState({ ...next, history: hist, future });
    reconcileNotes(s.stickyNotes, next.stickyNotes);
  }, [setState, snapshot, reconcileNotes, flashToast]);

  /** Canonical-photo tile positions for whichever view is active — the single
   *  source both the renderer and marquee hit-testing read, so selection and
   *  tile layout stay identical across Canvas / Timeline / Map / Topic. */
  const activeTilePositions = useCallback(
    (s: WorkspaceState): Record<string, TilePos> => {
      const scoped = canvasPhotos(s.photos, s.boardScope);
      const all =
        s.view === "timeline"
          ? computeTimelineLayout(scoped, s.galleryOverrides.timeline).tiles
          : s.view === "sense"
            ? computeTopicLayout(scoped, s.galleryOverrides.topic, s.frames).tiles
            : assetGallery(projectCanvasItems(scoped, s.uploadPreviews), s.galleryOverrides.asset).pos;
      // Deliberately NOT filtered. This is the geometry seam — artboard
      // membership, folder drops, frame move/resize, Tidy up, the delete-time
      // position freeze and the export's reading order all read it, and every
      // one of them is about where tiles ARE, not about what is currently drawn.
      // A label filter that reached in here would quietly drop hidden tiles out
      // of an artboard's export and let a delete reflow the tiles nobody could
      // see. The filter is applied only where it belongs: what is rendered
      // (`activePositions`), what a marquee can grab, and what Fit frames.
      return all;
    },
    [],
  );

  const openDrawer = useCallback(
    (id: string) => {
      const s = stateRef.current;
      setState({
        drawerId: id,
        drawerLang: "EN",
        drawerStyle: (s.photos.find((p) => p.id === id)?.captionStyle as CaptionStyle) || "Agency",
        copyLabel: "Copy",
        // The photo drawer and the source browser sidebar are both right-side
        // panels — never show both at once.
        sidebarTabs: [],
        sidebarActiveTab: null,
        sidebarAddOpen: false,
      });
    },
    [setState],
  );

  // ── Pan / zoom ────────────────────────────────────────────────────────────

  /** True while a pinch or long-press owns the gesture, or while a second finger
   *  is down. Every pointer-down entry point on the canvas checks this so a
   *  two-finger gesture can't also start a marquee/tile drag underneath itself. */
  const gestureClaimed = useCallback(
    () => touchRef.current.suppress || touchRef.current.pointers.size > 1,
    [],
  );

  const wheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const s = stateRef.current;
      const r = rect(),
        cx = e.clientX - r.left,
        cy = e.clientY - r.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const ns = Math.min(4, Math.max(0.05, s.scale * factor));
      const px = (cx - s.tx) / s.scale,
        py = (cy - s.ty) / s.scale;
      setState({ scale: ns, tx: cx - px * ns, ty: cy - py * ns });
    },
    [rect, setState],
  );

  /** Start a pan drag session (shared by the hand tool, Space-hold, and the tile
   *  handlers when Space is down). Reads live tx/ty from stateRef. */
  const startPan = useCallback(
    (e: React.PointerEvent) => {
      const s = stateRef.current;
      dragRef.current = { mode: "pan", sx: e.clientX, sy: e.clientY, otx: s.tx, oty: s.ty };
      setState({ panning: true });
    },
    [setState],
  );

  const onCanvasDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if (gestureClaimed()) return;
      const s = stateRef.current;
      const patch: Partial<WorkspaceState> = {};
      if (s.imp.open) patch.imp = { open: false };
      if (s.acctOpen) patch.acctOpen = false;
      if (s.projOpen) patch.projOpen = false;
      if (s.focusedCloudKey) patch.focusedCloudKey = null; // click empty canvas clears cloud focus
      if (Object.keys(patch).length) setState(patch);
      const r = rect();
      // Every view behaves like Canvas now (ADR 0022): the frame and select
      // (marquee) tools work in all four, and only the hand tool pans on a
      // background drag. Marquee hit-tests against the active view's own tile
      // positions so it selects whatever is on screen, sorted or not.
      // Space-hold pans over anything, so it takes precedence over the frame and
      // select tools; the hand tool pans too.
      if (s.tool === "frame" && !s.spacePan) {
        const c = toContent(e.clientX, e.clientY);
        const dx0 = e.clientX - r.left,
          dy0 = e.clientY - r.top;
        dragRef.current = {
          mode: "frameDraw",
          startContent: c,
          endContent: c,
          dx0,
          dy0,
          x1: dx0,
          y1: dy0,
          moved: false,
        };
        setState({
          marquee: { x0: dx0, y0: dy0, x1: dx0, y1: dy0 },
          frameDraftRect: { x: c.x, y: c.y, w: 0, h: 0 },
        });
      } else if (s.tool === "hand" || s.spacePan) {
        startPan(e);
      } else {
        const c = toContent(e.clientX, e.clientY);
        const dx0 = e.clientX - r.left,
          dy0 = e.clientY - r.top;
        // Marquee hit-tests canonical photos ONLY. The Canvas position map also
        // carries pending upload previews (keyed by "<batchId>:<index>" client
        // ids) so they render — but those must never enter selectedIds: every
        // selection consumer (bulk jobs, add-to-project, Delete) sends the ids
        // to APIs that validate them as asset UUIDs and reject the whole batch.
        // …and only what a label filter is currently showing: a marquee must
        // never sweep up a tile the canvas is hiding.
        const canonicalIds = new Set(filterByLabel(s.photos, s.labelFilter).map((p) => p.id));
        const assetPositions: Record<string, TilePos> = {};
        for (const [id, tile] of Object.entries(activeTilePositions(s))) {
          if (canonicalIds.has(id)) assetPositions[id] = tile;
        }
        dragRef.current = {
          mode: "marquee",
          startContent: c,
          dx0,
          dy0,
          x1: dx0,
          y1: dy0,
          moved: false,
          assetPositions,
          initialSelection: s.selectedIds,
          additive: e.shiftKey || e.metaKey || e.ctrlKey,
        };
        setState({ marquee: { x0: dx0, y0: dy0, x1: dx0, y1: dy0 } });
      }
    },
    [rect, toContent, setState, activeTilePositions, startPan, gestureClaimed],
  );

  const onGalleryNodeDown = useCallback(
    (e: React.PointerEvent, kind: "source", key: string, origCenter: { x: number; y: number }) => {
      e.stopPropagation();
      pushHistory();
      dragRef.current = {
        mode: "gallery",
        kind,
        key,
        sx: e.clientX,
        sy: e.clientY,
        orig: origCenter,
        moved: false,
        historyPushed: true,
        groupCenters: null,
        anchors: null, // source nodes are not a Topic cloud — nothing to anchor
      };
    },
    [pushHistory],
  );

  /** The Topic cloud each of `ids` currently sits in (ADR 0038) — stamped onto
   *  the override at drop time so a later re-cluster can recognise a coordinate
   *  that no longer belongs to the tile's cloud. Keyed on the stored cluster id
   *  where there is one, so relabelling and renaming a cloud both leave the
   *  user's arrangement alone; only genuinely changing cloud invalidates it. */
  const topicAnchorsFor = useCallback((s: WorkspaceState, ids: readonly string[]): Record<string, string> => {
    const byId = new Map(s.photos.map((p) => [p.id, p]));
    const out: Record<string, string> = {};
    for (const id of ids) {
      const photo = byId.get(id);
      if (photo) out[id] = topicAnchorOf(photo);
    }
    return out;
  }, []);

  /** Shared by Canvas asset tiles and Map/Topic cloud tiles — select-on-down
   *  (with the same additive/shift-click semantics), then a free-position
   *  drag session keyed to whichever override bucket `kind` names. */
  const onGalleryAssetDown = useCallback(
    (
      kind: "asset" | "map" | "topic" | "timeline",
      e: React.PointerEvent,
      id: string,
      origCenter: CanvasPoint,
    ) => {
      if (e.button !== 0) return;
      if (gestureClaimed()) return;
      e.preventDefault();
      e.stopPropagation();
      clearTopicDropTarget();
      if (kind === "topic" && topicMutationBusyRef.current) {
        flashToast("Wait for the current topic change to finish");
        return;
      }
      // Touch: a second tap on the same tile opens it, the way a double-click
      // does with a mouse. This cannot be a `dblclick` handler — the
      // preventDefault above suppresses the compatibility mouse events that
      // dblclick is synthesised from, so on a tablet it never fires at all.
      // The first tap has already run this handler and selected the tile, so
      // returning early here leaves that selection standing.
      if (e.pointerType !== "mouse") {
        const prev = touchRef.current.lastTap;
        const isSecond =
          prev?.id === id &&
          e.timeStamp - prev.at < DOUBLE_TAP_MS &&
          Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_SLOP;
        touchRef.current.lastTap = { id, at: e.timeStamp, x: e.clientX, y: e.clientY };
        if (isSecond) {
          touchRef.current.lastTap = null;
          // The capture listener armed a hold on this same press; opening the
          // drawer means the press is spent, so the menu must not still fire.
          if (touchRef.current.longPress) {
            clearTimeout(touchRef.current.longPress);
            touchRef.current.longPress = null;
          }
          dragRef.current = null;
          openDrawer(id);
          return;
        }
      }
      const s = stateRef.current;
      // Space-hold pans even when the press starts on a tile (tiles stopPropagation,
      // so the canvas root never sees it) — hand off to a pan drag and bail.
      if (s.spacePan) {
        startPan(e);
        return;
      }
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      // A bound "Group" (ADR 0022) acts as one tile: grabbing any member selects
      // (and later drags) the whole set. `members` is the group or just the tile.
      const members = tileGroupOf(id, boundGroupsOf(s.groups)) ?? [id];
      let selectedIds: string[];
      if (additive) {
        // Toggle the whole group in/out, not the single tile it was grabbed by.
        const selection = new Set(s.selectedIds);
        const allIn = members.every((m) => selection.has(m));
        if (allIn) members.forEach((m) => selection.delete(m));
        else members.forEach((m) => selection.add(m));
        selectedIds = Array.from(selection);
      } else {
        // Keep an existing multi-selection if this tile is already part of it
        // (so you can drag it), otherwise select just this tile / its group.
        selectedIds = s.selectedIds.includes(id) ? s.selectedIds : members;
      }
      // Any partially-selected group (e.g. one member caught by a marquee) is
      // completed here so actions and the group-drag below cover the whole set.
      selectedIds = expandBoundGroups(selectedIds, boundGroupsOf(s.groups));
      setState({ selectedIds, drawerId: null });
      // Group move: grabbing any member of a multi-selection drags the whole set
      // by one delta (Figma/Miro semantics). Capture every selected tile's center
      // now, from the active view's layout; a single-tile drag stays groupCenters
      // = null and moves only the grabbed key.
      let groupCenters: Record<string, { x: number; y: number }> | null = null;
      if (selectedIds.length > 1 && selectedIds.includes(id)) {
        const tiles = activeTilePositions(s);
        groupCenters = {};
        for (const gid of selectedIds) {
          const t = tiles[gid];
          if (t) groupCenters[gid] = { x: t.cx, y: t.cy };
        }
      }
      dragRef.current = {
        mode: "gallery",
        kind,
        key: id,
        sx: e.clientX,
        sy: e.clientY,
        orig: origCenter,
        moved: false,
        historyPushed: false,
        groupCenters,
        anchors:
          kind === "topic" ? topicAnchorsFor(s, groupCenters ? Object.keys(groupCenters) : [id]) : null,
      };
    },
    [
      setState,
      activeTilePositions,
      startPan,
      topicAnchorsFor,
      gestureClaimed,
      openDrawer,
      clearTopicDropTarget,
      flashToast,
    ],
  );
  /** One tile-drag entry point for every view — routes to the override bucket
   *  that matches the active sort, so a tile stays where you drop it within the
   *  view you dropped it in (and Canvas keeps its own unsorted positions). */
  const onTileDown = useCallback(
    (e: React.PointerEvent, id: string, origCenter: CanvasPoint) => {
      const v = stateRef.current.view;
      const kind =
        v === "timeline" ? "timeline" : v === "map" ? "map" : v === "sense" ? "topic" : "asset";
      onGalleryAssetDown(kind, e, id, origCenter);
    },
    [onGalleryAssetDown],
  );

  /** Pointer-down on a cloud's label (ADR 0024): a drag moves the whole cloud (all
   *  its tiles) together into the active view's override bucket; a click without
   *  a drag focuses that cloud so the others fade. Reads the layout the canvas
   *  is already rendering (via cloudDecorRef) — the layouts are deterministic,
   *  so recomputing here would burn a full pack/edge pass for identical output. */
  const onCloudLabelDown = useCallback(
    (e: React.PointerEvent, cloudKey: string) => {
      if (e.button !== 0) return;
      if (gestureClaimed()) return;
      e.preventDefault();
      e.stopPropagation();
      const s = stateRef.current;
      if (s.spacePan) {
        startPan(e);
        return;
      }
      const bucket =
        s.view === "timeline" ? "timeline" : s.view === "sense" ? "topic" : null;
      const layout = cloudDecorRef.current;
      if (!bucket || !layout) return;
      const origCenters: Record<string, { x: number; y: number }> = {};
      for (const id of Object.keys(layout.tiles)) {
        if (layout.tileCloud[id] === cloudKey) origCenters[id] = { x: layout.tiles[id].cx, y: layout.tiles[id].cy };
      }
      dragRef.current = {
        mode: "cloudDrag",
        cloudKey,
        bucket,
        sx: e.clientX,
        sy: e.clientY,
        origCenters,
        moved: false,
        historyPushed: false,
        anchors: bucket === "topic" ? topicAnchorsFor(s, Object.keys(origCenters)) : null,
      };
    },
    [startPan, topicAnchorsFor, gestureClaimed],
  );

  const onStickyDown = useCallback(
    (e: React.PointerEvent, id: string, orig: { x: number; y: number }) => {
      e.stopPropagation();
      if (gestureClaimed()) return;
      if (stateRef.current.spacePan) {
        startPan(e);
        return;
      }
      pushHistory();
      dragRef.current = { mode: "sticky", id, sx: e.clientX, sy: e.clientY, orig, moved: false };
    },
    [pushHistory, startPan, gestureClaimed],
  );

  const onStickyResizeDown = useCallback(
    (e: React.PointerEvent, id: string, orig: { w: number; h: number }) => {
      e.stopPropagation();
      if (gestureClaimed()) return;
      pushHistory();
      dragRef.current = { mode: "stickyResize", id, sx: e.clientX, sy: e.clientY, orig, moved: false };
    },
    [pushHistory, gestureClaimed],
  );

  // ── Sticky notes: server-backed (ADR 0041) ─────────────────────────────────
  // Every mutation is optimistic — the canvas updates immediately and the row
  // follows — because a note is typed into and dragged around, and a round trip
  // in either path would be felt. The reconciliation that costs something is
  // the create: the id only exists after the INSERT returns, so the note lives
  // under a `tmp-` id until then and anything that happens to it in that window
  // (typing, dragging, deleting) has to survive the swap.

  /** Flush a pending debounced text save immediately (before a delete, or on
   *  unmount) so the last keystrokes aren't dropped by the timer never firing. */
  const flushNoteText = useCallback(
    (id: string) => {
      const timer = noteTextTimers.current.get(id);
      if (!timer) return;
      clearTimeout(timer);
      noteTextTimers.current.delete(id);
      const note = stateRef.current.stickyNotes.find((n) => n.id === id);
      if (note) patchNote(id, { body: { text: note.text, strokes: note.strokes } });
    },
    [patchNote],
  );

  const addStickyNote = useCallback(() => {
    const s = stateRef.current;
    const r = rect();
    const cx = (r.width / 2 - s.tx) / s.scale;
    const cy = (r.height / 2 - s.ty) / s.scale;
    const w = 180,
      h = 160;
    const tmpId = TMP_NOTE_PREFIX + Date.now();
    const note: StickyNote = {
      id: tmpId,
      x: cx - w / 2,
      y: cy - h / 2,
      w,
      h,
      text: "",
      strokes: [],
      color: STICKY_NOTE_COLORS[s.stickyNotes.length % STICKY_NOTE_COLORS.length],
      fontSize: "m",
    };
    pushHistory();
    setState({ stickyNotes: [...s.stickyNotes, note] });

    void fetch("/api/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "note",
        projectId: currentProjectId === "all" ? null : currentProjectId,
        x: note.x,
        y: note.y,
        w: note.w,
        h: note.h,
        color: note.color,
        body: { text: "", strokes: [] },
        style: { fontSize: note.fontSize },
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const saved = annotationToNote(await res.json());
        const local = stateRef.current.stickyNotes.find((n) => n.id === tmpId);
        // Dismissed while the insert was in flight — the row exists now and
        // nothing on screen points at it, so undo the create rather than
        // orphaning it.
        if (!local) {
          void fetch(`/api/annotations/${saved.id}`, { method: "DELETE" });
          return;
        }
        // Keep whatever was typed or dragged in the meantime; take only the id.
        const merged: StickyNote = { ...local, id: saved.id };
        setState({
          stickyNotes: stateRef.current.stickyNotes.map((n) => (n.id === tmpId ? merged : n)),
        });
        // A pending debounce was keyed to the temp id and can never fire now.
        const pending = noteTextTimers.current.get(tmpId);
        if (pending) {
          clearTimeout(pending);
          noteTextTimers.current.delete(tmpId);
        }
        const diverged =
          merged.text !== "" || merged.strokes.length > 0 || merged.x !== note.x || merged.y !== note.y;
        if (diverged) {
          patchNote(merged.id, {
            x: merged.x,
            y: merged.y,
            body: { text: merged.text, strokes: merged.strokes },
          });
        }
      })
      .catch(() => {
        // Nothing was stored, so leaving the card on screen would promise a
        // persistence that isn't there.
        setState({ stickyNotes: stateRef.current.stickyNotes.filter((n) => n.id !== tmpId) });
        flashToast("Could not create the note");
      });
  }, [rect, pushHistory, setState, currentProjectId, patchNote, flashToast]);

  const updateStickyText = useCallback(
    (id: string, text: string) => {
      setState({ stickyNotes: stateRef.current.stickyNotes.map((n) => (n.id === id ? { ...n, text } : n)) });
      const pending = noteTextTimers.current.get(id);
      if (pending) clearTimeout(pending);
      noteTextTimers.current.set(
        id,
        setTimeout(() => {
          noteTextTimers.current.delete(id);
          // Full body: text and strokes share one jsonb column, so a text-only
          // patch would parse as `{ text, strokes: [] }` and wipe the drawing.
          const note = stateRef.current.stickyNotes.find((n) => n.id === id);
          patchNote(id, { body: { text, strokes: note?.strokes ?? [] } });
        }, NOTE_TEXT_SAVE_MS),
      );
    },
    [setState, patchNote],
  );

  /** Replace a note's drawing (ADR 0041 as amended — the pencil lives on the
   *  note now). Strokes save immediately rather than on the text debounce: a
   *  lifted pen is a finished, discrete edit, the way a picked colour is. The
   *  PATCH carries the whole body, so a note being typed and drawn on at once
   *  keeps both halves — text and strokes share one jsonb column, and a
   *  strokes-only patch would parse as `{ text: "", strokes }`. */
  const setStickyStrokes = useCallback(
    (id: string, strokes: NoteStroke[]) => {
      const note = stateRef.current.stickyNotes.find((n) => n.id === id);
      if (!note) return;
      pushHistory();
      setState({
        stickyNotes: stateRef.current.stickyNotes.map((n) => (n.id === id ? { ...n, strokes } : n)),
      });
      patchNote(id, { body: { text: note.text, strokes } });
    },
    [pushHistory, setState, patchNote],
  );

  /** Colour and font size are single discrete choices, so they save immediately
   *  — there is no equivalent of "still typing" to debounce, and a picked swatch
   *  that stayed unsaved for 700 ms would be the one change a user reloads to
   *  check. History is pushed so Cmd+Z reaches them like every other note edit;
   *  `reconcileNotes` is what makes that undo hit the server too. */
  const setStickyColor = useCallback(
    (id: string, color: AssetLabel) => {
      const note = stateRef.current.stickyNotes.find((n) => n.id === id);
      if (!note || note.color === color) return;
      pushHistory();
      setState({ stickyNotes: stateRef.current.stickyNotes.map((n) => (n.id === id ? { ...n, color } : n)) });
      patchNote(id, { color });
    },
    [pushHistory, setState, patchNote],
  );

  const setStickyFontSize = useCallback(
    (id: string, fontSize: NoteFontSize) => {
      const note = stateRef.current.stickyNotes.find((n) => n.id === id);
      if (!note || note.fontSize === fontSize) return;
      pushHistory();
      setState({
        stickyNotes: stateRef.current.stickyNotes.map((n) => (n.id === id ? { ...n, fontSize } : n)),
      });
      patchNote(id, { style: { fontSize } });
    },
    [pushHistory, setState, patchNote],
  );

  /** Tick a `[ ]` line straight from the rendered body, without opening the
   *  editor. Goes through the same debounce as typing: ticking three boxes in a
   *  row is one PATCH, and it cannot race the text save for the same note. */
  const toggleStickyCheck = useCallback(
    (id: string, lineIndex: number) => {
      const note = stateRef.current.stickyNotes.find((n) => n.id === id);
      if (!note) return;
      const text = toggleChecklistLine(note.text, lineIndex);
      if (text === note.text) return; // stale index — the text moved under the click
      pushHistory();
      updateStickyText(id, text);
    },
    [pushHistory, updateStickyText],
  );

  const deleteStickyNote = useCallback(
    (id: string) => {
      pushHistory();
      // Drop the debounce rather than flushing it — the note is going away, and
      // a PATCH landing after the DELETE is a 404 and a toast about nothing.
      const pending = noteTextTimers.current.get(id);
      if (pending) {
        clearTimeout(pending);
        noteTextTimers.current.delete(id);
      }
      setState({ stickyNotes: stateRef.current.stickyNotes.filter((n) => n.id !== id) });
      // A temp id has no row yet; the in-flight create sees the note is gone
      // from state and deletes what it just inserted.
      if (isTmpNote(id)) return;
      void fetch(`/api/annotations/${id}`, { method: "DELETE" })
        .then((res) => {
          if (!res.ok) flashToast("Note not deleted");
        })
        .catch(() => flashToast("Note not deleted"));
    },
    [pushHistory, setState, flashToast],
  );

  /** Two-finger pinch: zoom AND pan in one pass. The content point that sat
   *  under the midpoint when the pinch began is pinned to wherever the midpoint
   *  is now — which makes moving both fingers together a pan and spreading them
   *  a zoom, with no separate branch for either. Same anchor-a-point-and-solve
   *  math as `wheel`, just with the midpoint standing in for the cursor. */
  const applyPinch = useCallback(() => {
    const t = touchRef.current;
    const p = t.pinch;
    if (!p) return;
    const [a, b] = Array.from(t.pointers.values());
    if (!a || !b) return;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (dist < 1 || p.dist < 1) return;
    const r = rect();
    const ns = Math.min(4, Math.max(0.05, (p.scale * dist) / p.dist));
    // The pinned content point, from the state captured at pinch start.
    const px = (p.cx - r.left - p.tx) / p.scale;
    const py = (p.cy - r.top - p.ty) / p.scale;
    const cx = (a.x + b.x) / 2 - r.left;
    const cy = (a.y + b.y) / 2 - r.top;
    setState({ scale: ns, tx: cx - px * ns, ty: cy - py * ns });
  }, [rect, setState]);

  const move = useCallback(
    (e: PointerEvent) => {
      const t = touchRef.current;
      const tracked = t.pointers.get(e.pointerId);
      if (tracked) {
        tracked.x = e.clientX;
        tracked.y = e.clientY;
        // A hold that turns into a drag is a drag, not a menu.
        if (
          t.longPress &&
          t.longPressAt &&
          Math.hypot(e.clientX - t.longPressAt.x, e.clientY - t.longPressAt.y) > LONG_PRESS_SLOP
        ) {
          clearTimeout(t.longPress);
          t.longPress = null;
        }
        if (t.pinch) {
          applyPinch();
          return;
        }
        // A gesture already claimed by pinch/long-press, or a second finger that
        // arrived while one drag was running: both must stay out of `dragRef`,
        // which holds exactly one session started by exactly one pointer.
        if (t.suppress || (t.primary !== null && e.pointerId !== t.primary)) return;
      }
      const d = dragRef.current;
      if (!d) return;
      const s = stateRef.current;
      if (d.mode === "pan") {
        setState({
          tx: d.otx + (e.clientX - d.sx),
          ty: d.oty + (e.clientY - d.sy),
        });
      } else if (d.mode === "gallery") {
        if (Math.abs(e.clientX - d.sx) > 3 || Math.abs(e.clientY - d.sy) > 3) {
          d.moved = true;
          if (!d.historyPushed) {
            pushHistory();
            d.historyPushed = true;
          }
        }
        if (!d.moved) return;
        const dx = (e.clientX - d.sx) / s.scale,
          dy = (e.clientY - d.sy) / s.scale;
        const bucket = { ...s.galleryOverrides[d.kind] };
        // `anchors` is non-null only on Topic (ADR 0038); every other bucket
        // writes a bare point exactly as before.
        const put = (id: string, x: number, y: number) => {
          const cloud = d.anchors?.[id];
          bucket[id] = cloud === undefined ? { x, y } : { x, y, cloud };
        };
        if (d.groupCenters) {
          for (const gid of Object.keys(d.groupCenters)) {
            put(gid, d.groupCenters[gid].x + dx, d.groupCenters[gid].y + dy);
          }
        } else {
          put(d.key, d.orig.x + dx, d.orig.y + dy);
        }
        setState({
          galleryOverrides: { ...s.galleryOverrides, [d.kind]: bucket },
        });
        if (d.kind === "topic" && !topicMutationBusyRef.current) {
          const draggedIds = d.groupCenters ? Object.keys(d.groupCenters) : [d.key];
          const layout = cloudDecorRef.current;
          const target = layout
            ? topicDropTargetAt(layout, toContent(e.clientX, e.clientY), draggedIds)
            : null;
          armTopicDropTarget(target?.key ?? null);
        } else {
          clearTopicDropTarget();
        }
      } else if (d.mode === "cloudDrag") {
        // Timeline's whole-cloud drag is VERTICAL-only (ADR 0024): the label,
        // tick and band are pinned to the date column and every tile's x is
        // clamped into it, so horizontal movement could only smear raw x
        // overrides past the clamp — a saturating write that permanently
        // collapses the day's grid once re-anchored. Vertical drag threshold
        // only, too, so a horizontal wiggle on a date label stays a click
        // (focus) instead of silently overriding the whole day.
        const timelineBucket = d.bucket === "timeline";
        const movedNow = timelineBucket
          ? Math.abs(e.clientY - d.sy) > 3
          : Math.abs(e.clientX - d.sx) > 3 || Math.abs(e.clientY - d.sy) > 3;
        if (movedNow) {
          d.moved = true;
          if (!d.historyPushed) {
            pushHistory();
            d.historyPushed = true;
          }
        }
        if (!d.moved) return;
        const dx = timelineBucket ? 0 : (e.clientX - d.sx) / s.scale,
          dy = (e.clientY - d.sy) / s.scale;
        const bucketOv = { ...s.galleryOverrides[d.bucket] };
        for (const id of Object.keys(d.origCenters)) {
          const cloud = d.anchors?.[id];
          const moved = { x: d.origCenters[id].x + dx, y: d.origCenters[id].y + dy };
          bucketOv[id] = cloud === undefined ? moved : { ...moved, cloud };
        }
        setState({ galleryOverrides: { ...s.galleryOverrides, [d.bucket]: bucketOv } });
      } else if (d.mode === "sticky") {
        if (Math.abs(e.clientX - d.sx) > 2 || Math.abs(e.clientY - d.sy) > 2) d.moved = true;
        const dx = (e.clientX - d.sx) / s.scale,
          dy = (e.clientY - d.sy) / s.scale;
        setState({
          stickyNotes: s.stickyNotes.map((n) =>
            n.id === d.id ? { ...n, x: d.orig.x + dx, y: d.orig.y + dy } : n,
          ),
        });
      } else if (d.mode === "stickyResize") {
        if (Math.abs(e.clientX - d.sx) > 2 || Math.abs(e.clientY - d.sy) > 2) d.moved = true;
        const dx = (e.clientX - d.sx) / s.scale,
          dy = (e.clientY - d.sy) / s.scale;
        setState({
          stickyNotes: s.stickyNotes.map((n) =>
            n.id === d.id
              ? {
                  ...n,
                  w: clampNoteSize(d.orig.w + dx),
                  h: clampNoteSize(d.orig.h + dy),
                }
              : n,
          ),
        });
      } else if (d.mode === "marquee") {
        const r = rect();
        d.x1 = e.clientX - r.left;
        d.y1 = e.clientY - r.top;
        if (Math.abs(d.x1 - d.dx0) > 4 || Math.abs(d.y1 - d.dy0) > 4) d.moved = true;
        const current = toContent(e.clientX, e.clientY);
        const bounds: Bounds = {
          xl: Math.min(d.startContent.x, current.x),
          yt: Math.min(d.startContent.y, current.y),
          xr: Math.max(d.startContent.x, current.x),
          yb: Math.max(d.startContent.y, current.y),
        };
        const hits = d.assetPositions ? hitTestTiles(d.assetPositions, bounds) : [];
        const selection = d.additive
          ? Array.from(new Set([...d.initialSelection, ...hits]))
          : hits;
        setState({
          marquee: { x0: d.dx0, y0: d.dy0, x1: d.x1, y1: d.y1 },
          // A group half-inside the marquee is grabbed whole — it's one unit.
          selectedIds: expandBoundGroups(selection, boundGroupsOf(s.groups)),
        });
      } else if (d.mode === "frameDraw") {
        const r = rect();
        d.x1 = e.clientX - r.left;
        d.y1 = e.clientY - r.top;
        if (Math.abs(d.x1 - d.dx0) > 4 || Math.abs(d.y1 - d.dy0) > 4) d.moved = true;
        d.endContent = toContent(e.clientX, e.clientY);
        const xl = Math.min(d.startContent.x, d.endContent.x),
          yt = Math.min(d.startContent.y, d.endContent.y);
        const w = Math.abs(d.endContent.x - d.startContent.x),
          h = Math.abs(d.endContent.y - d.startContent.y);
        setState({
          marquee: { x0: d.dx0, y0: d.dy0, x1: d.x1, y1: d.y1 },
          frameDraftRect: { x: xl, y: yt, w, h },
        });
      } else if (d.mode === "minimap") {
        const mx = e.clientX - d.rectLeft,
          my = e.clientY - d.rectTop;
        const cx = d.originX + (mx - d.offX) / d.mscale;
        const cy = d.originY + (my - d.offY) / d.mscale;
        const rr = rect();
        const targetX = cx - d.grabDx,
          targetY = cy - d.grabDy;
        setState({ tx: rr.width / 2 - targetX * s.scale, ty: rr.height / 2 - targetY * s.scale });
      }
    },
    [
      rect,
      toContent,
      setState,
      pushHistory,
      applyPinch,
      armTopicDropTarget,
      clearTopicDropTarget,
    ],
  );

  /** After a Canvas tile drag, reconcile folder membership (ADR 0034): a tile
   *  dropped inside a folder joins it (server enforces single-membership; we
   *  mirror it optimistically), one dragged out of its folder leaves. Folders
   *  are a neural-view concept, so this only runs for `kind === "asset"` drags.
   *  Fire-and-forget: the server is re-read on the next refresh, so a failed
   *  fetch just reverts on reload rather than blocking the drag. */
  const syncFolderMembership = useCallback(
    (draggedIds: string[]) => {
      const s = stateRef.current;
      const folders = s.groups.filter((g) => g.kind === "folder");
      if (folders.length === 0 || draggedIds.length === 0) return;
      const positions = activeTilePositions(s);

      const move = (assetId: string, fromId: string | null, toId: string | null) =>
        setState((prev) => ({
          groups: prev.groups.map((g) => {
            if (g.id === fromId) return { ...g, members: g.members.filter((m) => m !== assetId) };
            if (g.id === toId && !g.members.includes(assetId)) return { ...g, members: [...g.members, assetId] };
            return g;
          }),
        }));

      for (const assetId of draggedIds) {
        const tile = positions[assetId];
        if (!tile) continue;
        const target =
          folders.find((f) => {
            const r = folderHitRect(s.groupGeom[f.id] ?? defaultFolderGeom(f.id));
            return tile.cx >= r.x && tile.cx <= r.x + r.w && tile.cy >= r.y && tile.cy <= r.y + r.h;
          }) ?? null;
        const current = folders.find((f) => f.members.includes(assetId)) ?? null;
        if (target?.id === current?.id) continue;

        if (target) {
          move(assetId, current?.id ?? null, target.id);
          void fetch(`/api/canvas-groups/${target.id}/assets`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assetIds: [assetId] }),
          }).catch(() => {});
        } else if (current) {
          move(assetId, current.id, null);
          void fetch(`/api/canvas-groups/${current.id}/assets`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assetIds: [assetId] }),
          }).catch(() => {});
        }
      }
    },
    [activeTilePositions, setState],
  );

  const up = useCallback((e: PointerEvent) => {
    const t = touchRef.current;
    if (t.pointers.delete(e.pointerId)) {
      if (t.longPress) {
        clearTimeout(t.longPress);
        t.longPress = null;
      }
      const wasPrimary = e.pointerId === t.primary;
      // A gesture that pinch or long-press already claimed has no drag session
      // left to finish (both null `dragRef` when they take over), and lifting
      // one finger out of a pinch must not hand the canvas back to the finger
      // still on the glass — that would resume a stale session and jump the
      // view. Such a gesture ends only when the last finger leaves.
      const claimed = t.pinch !== null || t.suppress;
      t.pinch = null;
      if (t.pointers.size === 0) {
        t.primary = null;
        t.suppress = false;
        t.longPressAt = null;
      } else if (claimed) {
        t.suppress = true;
      }
      if (claimed) return;
      // A secondary finger lifting is not the end of the primary's drag.
      if (!wasPrimary) return;
    }
    const d = dragRef.current;
    if (!d) {
      clearTopicDropTarget();
      return;
    }
    dragRef.current = null;
    if (d.mode === "pan") {
      setState({ panning: false });
    } else if (d.mode === "sticky") {
      // Persist the drop, not the drag: move() already updated local state on
      // every pointermove, and PATCHing those would be a request per frame.
      if (d.moved) {
        const note = stateRef.current.stickyNotes.find((n) => n.id === d.id);
        if (note) patchNote(note.id, { x: note.x, y: note.y });
      }
    } else if (d.mode === "stickyResize") {
      if (d.moved) {
        const note = stateRef.current.stickyNotes.find((n) => n.id === d.id);
        if (note) patchNote(note.id, { w: note.w, h: note.h });
      }
    } else if (d.mode === "cloudDrag") {
      // A click (no drag) on a label toggles focus on that cloud.
      if (!d.moved) {
        const s = stateRef.current;
        setState({ focusedCloudKey: s.focusedCloudKey === d.cloudKey ? null : d.cloudKey });
      }
    } else if (d.mode === "marquee") {
      if (!d.moved) {
        setState({
          selectedIds: d.additive ? d.initialSelection : [],
          drawerId: null,
        });
      }
      setState({ marquee: null });
    } else if (d.mode === "frameDraw") {
      setState({ marquee: null, frameDraftRect: null });
      if (d.moved) {
        const s = stateRef.current;
        const startC = d.startContent;
        const endC = d.endContent ?? startC;
        const xl = Math.min(startC.x, endC.x),
          xr = Math.max(startC.x, endC.x);
        const yt = Math.min(startC.y, endC.y),
          yb = Math.max(startC.y, endC.y);
        pushHistory();
        const n = s.frames.length + 1;
        setState({
          frames: [
            ...s.frames,
            {
              id: "frame" + Date.now(),
              x: xl,
              y: yt,
              w: Math.max(40, xr - xl),
              h: Math.max(40, yb - yt),
              label: "Frame " + n,
            },
          ],
          tool: "select",
        });
      } else {
        setState({ tool: "select" });
      }
    } else if (d.mode === "gallery") {
      // A cancelled pointer never authorises a workspace-wide write. The tile
      // may keep the positional nudge already rendered by pointermove, but only
      // an actual pointerup can turn an armed highlight into membership.
      const armedTopicKey =
        d.kind === "topic" ? committedTopicDropKey(e.type, topicDropRef.current.targetKey) : null;
      clearTopicDropTarget();
      if (d.moved && d.kind === "topic" && armedTopicKey) {
        const s = stateRef.current;
        const layout = cloudDecorRef.current;
        const target = layout?.clouds.find((cloud) => cloud.key === armedTopicKey);
        if (layout && target) {
          const draggedIds = d.groupCenters ? Object.keys(d.groupCenters) : [d.key];
          const lastHistory = d.historyPushed ? s.history[s.history.length - 1] : undefined;
          const beforeTopicOverrides = lastHistory?.galleryOverrides.topic ?? s.galleryOverrides.topic;
          const options = {
            beforeTopicOverrides,
            consumeDragHistory: d.historyPushed,
          };

          if (!target.clusterId) return;
          void persistTopicAssignment(
            draggedIds,
            { id: target.clusterId, label: target.label },
            options,
          );
          return;
        }
      }
      // Anti-full-occlusion (Canvas only): a single tile dropped near-exactly on
      // another cascades off so a sliver of the one underneath always shows. Free
      // overlap is still allowed — this only prevents a 100% cover. Group moves
      // keep their internal arrangement, and the sorted views own their tile
      // positions, so both are left alone. History was already pushed at drag
      // start, so the nudge is part of the same undo step.
      if (d.moved && !d.groupCenters && d.kind === "asset") {
        const s = stateRef.current;
        const positions = activeTilePositions(s);
        const dropped = positions[d.key];
        if (dropped) {
          const others = Object.entries(positions)
            .filter(([id]) => id !== d.key)
            .map(([, tile]) => ({ x: tile.cx, y: tile.cy }));
          const resolved = nudgeOffOverlap({ x: dropped.cx, y: dropped.cy }, others);
          if (resolved.x !== dropped.cx || resolved.y !== dropped.cy) {
            setState({
              galleryOverrides: {
                ...s.galleryOverrides,
                asset: { ...s.galleryOverrides.asset, [d.key]: resolved },
              },
            });
          }
        }
      }
      // Folder membership follows the drop (ADR 0034) — Canvas tiles only.
      if (d.moved && d.kind === "asset") {
        syncFolderMembership(d.groupCenters ? Object.keys(d.groupCenters) : [d.key]);
      }
    }
  }, [
    setState,
    pushHistory,
    activeTilePositions,
    syncFolderMembership,
    patchNote,
    clearTopicDropTarget,
    persistTopicAssignment,
  ]);

  // ── Simple actions ──────────────────────────────────────────────────────

  const setHover = useCallback((id: string | null) => setState({ hoveredId: id }), [setState]);
  const closeDrawer = useCallback(() => setState({ drawerId: null }), [setState]);
  const setLang = useCallback((l: Language) => setState({ drawerLang: l }), [setState]);
  const setStyle = useCallback((st: CaptionStyle) => setState({ drawerStyle: st }), [setState]);
  const toolSelect = useCallback(() => setState({ tool: "select" }), [setState]);
  const toolHand = useCallback(() => setState({ tool: "hand" }), [setState]);
  const toolFrame = useCallback(
    () => setState({ tool: stateRef.current.tool === "frame" ? "select" : "frame" }),
    [setState],
  );
  const deleteFrame = useCallback(
    (id: string) => {
      pushHistory();
      setState({ frames: stateRef.current.frames.filter((f) => f.id !== id) });
    },
    [pushHistory, setState],
  );
  const renameFrame = useCallback(
    (id: string, label: string) => {
      setState({ frames: stateRef.current.frames.map((f) => (f.id === id ? { ...f, label } : f)) });
    },
    [setState],
  );
  const clearSelection = useCallback(() => setState({ selectedIds: [] }), [setState]);

  const navDrawer = useCallback(
    (dir: number) => {
      const s = stateRef.current;
      const i = s.photos.findIndex((p) => p.id === s.drawerId);
      if (i < 0) return;
      openDrawer(s.photos[(i + dir + s.photos.length) % s.photos.length].id);
    },
    [openDrawer],
  );

  // ── AI runner ─────────────────────────────────────────────────────────────
  // Every AI entry point in the app (tile badge, action bar, bulk panel, drawer,
  // context menu) funnels through these two. Before this, three call sites each
  // built their own fetch with their own copy and their own idea of which job
  // type to send — which is how the drawer's "Generate caption" ended up
  // enqueueing `analyze` and never writing a caption.

  /** POST one job and adopt it as the tracked job. Returns false on failure. */
  const enqueueJob = useCallback(
    async (body: Record<string, unknown>, label: string, assetIds: string[]) => {
      try {
        const resp = await fetch("/api/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(String(resp.status));
        const { jobId } = (await resp.json()) as { jobId: string };
        activeJobId.current = jobId;
        setState({ proc: { active: true, label, pct: 5 }, aiBusyIds: assetIds });
        return true;
      } catch {
        activeJobId.current = null;
        followUpCaption.current = null;
        setState({ proc: { active: false, label: "", pct: 0 }, aiBusyIds: [] });
        return false;
      }
    },
    [setState],
  );

  /** "Re-cluster" (ADR 0038) — recompute the workspace's Topic clouds now.
   *
   *  Costs no credits: the worker's cluster handler is pure CPU over embeddings
   *  analyze already stored and makes no Gemini call. It shares `activeJobId`
   *  with the AI runs anyway, because the worker has one lane for every job type
   *  and workspace — but it says so in its own words rather than borrowing the
   *  paid-work copy. */
  const recluster = useCallback(async () => {
    if (activeJobId.current) {
      flashToast("A job is already running — wait for it to finish");
      return;
    }
    setState({ proc: { active: true, label: "Regrouping topics…", pct: 3 }, aiBusyIds: [] });
    try {
      const resp = await fetch("/api/topics/recluster", { method: "POST" });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? String(resp.status));
      }
      const { jobId } = (await resp.json()) as { jobId: string };
      activeJobId.current = jobId;
      setState({ proc: { active: true, label: "Regrouping topics…", pct: 5 } });
    } catch (err) {
      activeJobId.current = null;
      setState({ proc: { active: false, label: "", pct: 0 } });
      flashToast(
        err instanceof Error && err.message === "cluster_in_flight"
          ? "Topics are already being regrouped"
          : "Couldn't start regrouping — try again",
      );
    }
  }, [flashToast, setState]);

  /** Rename one Topic cloud (ADR 0038). The stable cluster id remains the
   *  canvas key; the refresh only re-derives the display label. Positional
   *  overrides therefore survive unchanged. */
  const renameCloud = useCallback(
    async (clusterId: string, label: string) => {
      const trimmed = label.trim();
      if (!trimmed) return;
      try {
        const resp = await fetch(`/api/topics/${clusterId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ label: trimmed }),
        });
        if (!resp.ok) throw new Error(String(resp.status));
        setTopicCatalog((previous) =>
          previous.map((topic) => (topic.id === clusterId ? { ...topic, label: trimmed } : topic)),
        );
        setState({ focusedCloudKey: null });
        router.refresh();
      } catch {
        flashToast("Couldn't rename that topic — try again");
      }
    },
    [flashToast, router, setState, setTopicCatalog],
  );

  const moveSelectionToTopic = useCallback(
    (topicId: string) => {
      const cloud = cloudDecorRef.current?.clouds.find((candidate) => candidate.clusterId === topicId);
      const catalogTopic = topicCatalog.find((candidate) => candidate.id === topicId);
      const label = cloud?.label ?? catalogTopic?.label;
      if (!label) {
        flashToast("That topic isn't available on this canvas");
        return;
      }
      void persistTopicAssignment(stateRef.current.selectedIds, { id: topicId, label });
    },
    [flashToast, persistTopicAssignment, topicCatalog],
  );

  const createTopicFromSelection = useCallback(
    (label: string) => {
      const ids = stateRef.current.selectedIds.slice();
      if (ids.length === 0) {
        flashToast("Select files to create a topic");
        return;
      }
      void createTopicForAssets(label, ids);
    },
    [createTopicForAssets, flashToast],
  );

  const returnSelectionToAi = useCallback(() => {
    const ids = stateRef.current.selectedIds.slice();
    if (ids.length === 0) {
      flashToast("Select files to return to AI grouping");
      return;
    }
    void persistTopicAssignment(ids, null);
  }, [flashToast, persistTopicAssignment]);

  // ── Colour labels ─────────────────────────────────────────────────────────

  /** Apply (or clear) a colour on a set of assets. Optimistic and undoable, like
   *  the bulk delete: the dots change instantly, the request follows, and the
   *  toast's Undo restores each photo's PREVIOUS colour — not "no colour",
   *  which would silently erase whatever the selection already carried.
   *
   *  Undo is one request per distinct previous colour (at most eight), because
   *  the route sets one colour per call. That is still bounded and beats
   *  round-tripping per photo. */
  const applyLabel = useCallback(
    (ids: readonly string[], label: AssetLabel | null) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      const before = stateRef.current.photos.filter((p) => idSet.has(p.id));
      if (before.length === 0) return;
      // Nothing to do — every target already carries this colour. Says so rather
      // than firing a write whose result is indistinguishable from a no-op.
      if (before.every((p) => (p.label ?? null) === label)) return;
      const previous = new Map(before.map((p) => [p.id, p.label ?? null]));

      const write = (targets: string[], value: AssetLabel | null) =>
        fetch("/api/assets/label", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: targets, label: value }),
        }).then((resp) => {
          if (!resp.ok) throw new Error(String(resp.status));
        });

      const paint = (value: (id: string) => AssetLabel | null) =>
        setState((prev) => ({
          photos: prev.photos.map((p) => (idSet.has(p.id) ? { ...p, label: value(p.id) } : p)),
        }));

      paint(() => label);

      const undo = () => {
        paint((id) => previous.get(id) ?? null);
        setState({ toast: { show: false, text: "" } });
        const byPrevious = new Map<AssetLabel | "none", string[]>();
        for (const [id, prev] of previous) {
          const key = prev ?? "none";
          byPrevious.set(key, [...(byPrevious.get(key) ?? []), id]);
        }
        Promise.all([...byPrevious].map(([key, group]) => write(group, key === "none" ? null : key)))
          .then(() => router.refresh())
          .catch(() => flashToast("Couldn't undo that — refresh to see the real state"));
      };

      write([...ids], label)
        .then(() => {
          const name = label ? stateRef.current.labelNames[label] : null;
          const what = ids.length > 1 ? `${ids.length} files` : "File";
          flashToast(name ? `${what} marked ${name}` : `${what} unmarked`, { label: "Undo", onAction: undo });
          router.refresh();
        })
        .catch(() => {
          // Put the old colours back — an optimistic dot that never persisted is
          // worse than no dot at all, because the next reload silently loses it.
          paint((id) => previous.get(id) ?? null);
          flashToast("Couldn't save that label — try again");
        });
    },
    [flashToast, router, setState],
  );

  /** The label pickers all funnel through here: the selection when there is one,
   *  otherwise the single tile the context menu was opened on — the same
   *  selection-first rule Move to Trash follows. */
  const labelSelection = useCallback(
    (label: AssetLabel | null, fallbackId?: string | null) => {
      const s = stateRef.current;
      const ids = s.selectedIds.length > 0 ? s.selectedIds : fallbackId ? [fallbackId] : [];
      setState({ labelMenuOpen: false });
      setContextMenu(null);
      applyLabel(ids, label);
    },
    [applyLabel, setState],
  );

  /** The drawer's picker: this photo and only this photo. It deliberately does
   *  NOT honour the canvas selection — the drawer shows one photo, and a live
   *  selection behind it must not swallow a click made on that photo's own row. */
  const labelOne = useCallback(
    (id: string, label: AssetLabel | null) => applyLabel([id], label),
    [applyLabel],
  );

  /** Filtering only hides tiles (see WorkspaceState.labelFilter), so a selection
   *  made before the filter would keep acting on photos nobody can see — and
   *  "Move 40 to Trash" on an empty-looking canvas is exactly the kind of
   *  surprise this app should not have. Narrow the selection to what survives. */
  const setLabelFilter = useCallback(
    (filter: LabelFilter) => {
      const s = stateRef.current;
      const next = s.labelFilter === filter ? null : filter;
      const visible = new Set(filterByLabel(s.photos, next).map((p) => p.id));
      setState({
        labelFilter: next,
        selectedIds: s.selectedIds.filter((id) => visible.has(id)),
        focusedCloudKey: null,
        tilesAnimating: true,
      });
      if (animTimer.current) clearTimeout(animTimer.current);
      animTimer.current = setTimeout(() => setState({ tilesAnimating: false }), 470);
    },
    [setState],
  );

  const clearLabelFilter = useCallback(() => setLabelFilter(null), [setLabelFilter]);
  // Always opens now (ADR 0040, amended). It used to refuse with an empty
  // selection — correct back when the row only ever marked photos, and wrong
  // once the same row filters the canvas when there is nothing to mark: an
  // empty selection is precisely when the filter is the useful half.
  const toggleLabelMenu = useCallback(
    () => setState((prev) => ({ labelMenuOpen: !prev.labelMenuOpen })),
    [setState],
  );
  const closeLabelMenu = useCallback(() => setState({ labelMenuOpen: false }), [setState]);

  /** Rename a colour for the whole workspace — "Red" is a colour, "Rejected" is
   *  a workflow. Optimistic like the topic rename it mirrors; an empty name
   *  resets to the default. */
  const renameLabel = useCallback(
    async (label: AssetLabel, name: string) => {
      const trimmed = name.trim().slice(0, 40);
      const before = stateRef.current.labelNames;
      try {
        const resp = await fetch("/api/labels", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ label, name: trimmed }),
        });
        if (!resp.ok) throw new Error(String(resp.status));
        const { names } = (await resp.json()) as { names: LabelNames };
        setState({ labelNames: names });
      } catch {
        setState({ labelNames: before });
        flashToast("Couldn't rename that label — try again");
      }
    },
    [flashToast, setState],
  );

  /** The one way to start AI work. The plan (which jobs, in what order) comes
   *  from `planAiRun`, the same function the panel uses to label its button. */
  const runAi = useCallback(
    async (assetIds: string[], ops: BulkOps, langs: Language[], style: CaptionStyle) => {
      if (activeJobId.current) {
        // Used to be a silent `return` — the button simply did nothing and the
        // user had no way to tell a busy queue from a broken button.
        flashToast("An AI job is already running — wait for it to finish");
        return;
      }
      const plan = planAiRun(assetIds, ops, langs, style);
      if (plan.blocked) {
        flashToast(plan.cta);
        return;
      }
      const n = assetIds.length;
      setState({
        proc: { active: true, label: `Queueing ${n} ${n === 1 ? "photo" : "photos"}…`, pct: 3 },
        aiBusyIds: assetIds,
      });

      if (plan.analyze) {
        // Captions ride along as the follow-up leg so they see the facts this
        // analyze is about to write.
        followUpCaption.current = plan.caption;
        const ok = await enqueueJob({ type: "analyze", ...plan.analyze }, "Analyzing…", assetIds);
        if (!ok) flashToast("Analyze failed to start — try again");
        return;
      }

      const ok = await enqueueJob({ type: "caption", ...plan.caption }, "Writing captions…", assetIds);
      if (!ok) flashToast("Caption failed to start — try again");
    },
    [setState, flashToast, enqueueJob],
  );

  const copyCap = useCallback(
    async (text: string) => {
      // The visible caption (incl. any unsaved edit) is copied from the drawer;
      // only claim "Copied" after the clipboard write actually succeeds — a
      // false "Copied" made users paste stale clipboard content elsewhere.
      const caption = text.trim();
      if (!caption) return;
      try {
        await navigator.clipboard.writeText(caption);
      } catch {
        flashToast("Couldn't copy — select the caption and copy manually");
        return;
      }
      setState({ copyLabel: "Copied" });
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setState({ copyLabel: "Copy" }), 1400);
    },
    [setState, flashToast],
  );

  /** Regenerate the visible caption (drawer lang × style) via a real caption
   *  job (#14). An edited caption asks first, then clears is_edited — the
   *  worker skips edited units otherwise. */
  const regen = useCallback(async () => {
    const s = stateRef.current;
    const photo = s.photos.find((p) => p.id === s.drawerId);
    if (!photo) return;
    if (activeJobId.current) {
      flashToast("An AI job is already running — wait for it to finish");
      return;
    }
    const row = getCaptionRow(photo, s.drawerLang, s.drawerStyle);
    if (row?.edited) {
      if (!window.confirm("This caption was edited by hand. Regenerate and overwrite it?")) return;
      const reset = await fetch(`/api/captions/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resetEdited: true }),
      });
      if (!reset.ok) {
        flashToast("Could not unlock the caption — try again");
        return;
      }
    }
    await runAi([photo.id], { captions: true, tags: false }, [s.drawerLang], s.drawerStyle);
  }, [flashToast, runAi]);

  /** Record a human verdict on one extracted fact.
   *
   *  Confirmed facts are the only user-supplied ground truth the caption prompt
   *  quotes (`caption.ts` selects `status = 'confirmed'`), so this is an AI
   *  input, not a bookkeeping flag — which is why the drawer confirms facts one
   *  at a time and the old blanket "Confirm facts" button is gone.
   *
   *  Optimistic: the dot changes immediately and reverts if the PATCH fails. No
   *  router.refresh on success — the server payload already agrees, and a
   *  refresh mid-review would re-render the list under the user's cursor. */
  const setFactStatus = useCallback(
    async (factId: string, status: "confirmed" | "likely") => {
      const uiStatus = status === "confirmed" ? ("confirmed" as const) : ("pending" as const);
      const patchFact = (next: FactStatus | null) =>
        setState((prev) => ({
          photos: prev.photos.map((p) =>
            p.facts.some((f) => f.id === factId)
              ? {
                  ...p,
                  facts: p.facts.map((f) =>
                    f.id === factId ? { ...f, status: next ?? f.status } : f,
                  ),
                }
              : p,
          ),
        }));
      const previous = stateRef.current.photos
        .flatMap((p) => p.facts)
        .find((f) => f.id === factId)?.status;
      patchFact(uiStatus);
      try {
        const resp = await fetch(`/api/facts/${factId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (!resp.ok) throw new Error(String(resp.status));
      } catch {
        if (previous) patchFact(previous);
        flashToast("Couldn't save that — try again");
      }
    },
    [setState, flashToast],
  );

  /** Persist a drawer caption edit — PATCH stamps is_edited=true (spec §8.3),
   *  so bulk regeneration never silently clobbers it. */
  const saveCaption = useCallback(
    async (text: string) => {
      const s = stateRef.current;
      const photo = s.photos.find((p) => p.id === s.drawerId);
      const row = photo ? getCaptionRow(photo, s.drawerLang, s.drawerStyle) : null;
      if (!row) {
        flashToast("Nothing to save yet — regenerate a caption first");
        return;
      }
      const resp = await fetch(`/api/captions/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (resp.ok) {
        flashToast("Caption saved");
        router.refresh();
      } else {
        flashToast("Save failed — try again");
      }
    },
    [flashToast, router],
  );

  /** Save a manual Metadata/EXIF correction for the open photo (migration
   *  20260805000001). The route writes asset_exif's own columns, so a corrected
   *  date really does move the tile on the Timeline and a corrected camera
   *  really does answer that search filter — which is why this refreshes rather
   *  than patching one drawer field in place. */
  const saveExif = useCallback(
    async (patch: PatchAssetExifRequest) => {
      const id = stateRef.current.drawerId;
      if (!id) return;
      const resp = await fetch(`/api/assets/${id}/exif`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (resp.ok) {
        flashToast("Metadata saved");
        router.refresh();
      } else {
        flashToast("Couldn't save the metadata — try again");
      }
    },
    [flashToast, router],
  );

  /** Drop every manual correction and restore what ingest extracted. */
  const revertExif = useCallback(async () => {
    const id = stateRef.current.drawerId;
    if (!id) return;
    const resp = await fetch(`/api/assets/${id}/exif`, { method: "DELETE" });
    if (resp.ok) {
      flashToast("Metadata reverted to the file's own values");
      router.refresh();
    } else {
      flashToast("Couldn't revert the metadata — try again");
    }
  }, [flashToast, router]);

  /** Real soft-delete (spec §12 / ADR 0033: status='deleted', the DB stamps
   *  deleted_at, the worker purges after 30 days). Bulk-first: one POST moves
   *  the whole selection, and the undo toast brings it back with one POST too.
   *  Optimistic — tiles vanish immediately; failure reconciles from the server. */
  const deletePhotos = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      // Snapshot the removed tiles WITH their indexes so undo can splice them
      // back in place instantly, without waiting for the server round-trip.
      const removed = stateRef.current.photos
        .map((photo, index) => ({ photo, index }))
        .filter(({ photo }) => idSet.has(photo.id));
      if (removed.length === 0) return;
      // Make deletion LOCAL. assetGallery lays the Canvas out by array index
      // (lib/layout.ts), so dropping a tile renumbers every non-overridden tile
      // after it — the survivors visibly reflow. Pin each survivor that has no
      // override yet to its current center so nothing moves; the removed tile
      // just leaves a gap. Record the keys we add so undo strips exactly them
      // (restoring the pristine default grid); Tidy up is the way back to the
      // default layout for good. Only affects the neural Canvas (Timeline/Topic
      // read their own override buckets).
      const before = stateRef.current;
      const neuralPos = activeTilePositions({ ...before, view: "neural" });
      const frozen: Record<string, CanvasPoint> = {};
      for (const p of before.photos) {
        if (idSet.has(p.id)) continue;
        if (before.galleryOverrides.asset[p.id]) continue;
        const tile = neuralPos[p.id];
        if (tile) frozen[p.id] = { x: tile.cx, y: tile.cy };
      }
      const frozenKeys = Object.keys(frozen);
      setState((prev) => ({
        photos: prev.photos.filter((p) => !idSet.has(p.id)),
        selectedIds: prev.selectedIds.filter((x) => !idSet.has(x)),
        drawerId: prev.drawerId && idSet.has(prev.drawerId) ? null : prev.drawerId,
        galleryOverrides: frozenKeys.length
          ? { ...prev.galleryOverrides, asset: { ...prev.galleryOverrides.asset, ...frozen } }
          : prev.galleryOverrides,
      }));
      const undo = () => {
        setState((prev) => {
          const photos = [...prev.photos];
          for (const { photo, index } of removed) {
            if (photos.some((p) => p.id === photo.id)) continue;
            photos.splice(Math.min(index, photos.length), 0, photo);
          }
          // Strip only the freeze THIS delete added, so the restored tile and its
          // neighbours fall back to their default cells (a user's own prior drags
          // are left untouched).
          const asset = { ...prev.galleryOverrides.asset };
          for (const key of frozenKeys) delete asset[key];
          return {
            photos,
            galleryOverrides: { ...prev.galleryOverrides, asset },
            toast: { show: false, text: "" },
          };
        });
        fetch("/api/assets/restore", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids }),
        })
          .then((resp) => {
            if (!resp.ok) throw new Error(String(resp.status));
            router.refresh();
          })
          .catch(() => {
            flashToast("Could not restore — try again");
            router.refresh();
          });
      };
      fetch("/api/assets/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      })
        .then((resp) => {
          if (!resp.ok) throw new Error(String(resp.status));
          flashToast(
            removed.length === 1 ? "Moved to Trash" : `${removed.length} files moved to Trash`,
            { label: "Undo", onAction: undo },
          );
        })
        .catch(() => {
          flashToast("Could not delete — try again");
          router.refresh();
        });
    },
    [setState, flashToast, router, activeTilePositions],
  );

  /** Single-tile / drawer delete — the same bulk pipeline, one id. */
  const deletePhoto = useCallback((id: string) => deletePhotos([id]), [deletePhotos]);

  /** Delete with a guardrail (ADR 0033): small selections soft-delete straight
   *  away behind the undo toast; ≥ BULK_DELETE_CONFIRM_AT waits in the modal. */
  const requestDeletePhotos = useCallback(
    (ids: string[]) => {
      if (ids.length >= BULK_DELETE_CONFIRM_AT) setState({ confirmDeleteIds: ids });
      else deletePhotos(ids);
    },
    [setState, deletePhotos],
  );

  const confirmDeleteNow = useCallback(() => {
    const ids = stateRef.current.confirmDeleteIds;
    setState({ confirmDeleteIds: null });
    if (ids) deletePhotos(ids);
  }, [setState, deletePhotos]);

  const cancelConfirmDelete = useCallback(
    () => setState({ confirmDeleteIds: null }),
    [setState],
  );

  /** Drawer's single-photo "Analyze & caption" — analyze chained into caption.
   *  The button used to be labelled "Generate caption" while enqueueing only
   *  `analyze`, which writes tags/facts/embeddings and never a caption: the
   *  photo came back tagged and captionless, and the real caption trigger was
   *  hiding under the word "Regenerate". Now the label and the work match. */
  const genSingle = useCallback(
    (id: string) => {
      const s = stateRef.current;
      void runAi([id], { captions: true, tags: true }, [s.drawerLang], s.drawerStyle);
    },
    [runAi],
  );

  /** Tile badge / action bar: analyze only, for whatever is selected. Captions
   *  stay an explicit choice — they cost a call per language. */
  const analyzeIds = useCallback(
    (ids: string[]) => {
      void runAi(ids, { captions: false, tags: true }, [], stateRef.current.bulkStyle);
    },
    [runAi],
  );

  /** One photo, straight from its tile badge. Stable identity so the memoized
   *  ProjectAssetView doesn't re-render every tile on each parent render. */
  const analyzePhoto = useCallback((id: string) => analyzeIds([id]), [analyzeIds]);

  // ── Image editor (ADR 0030) ──────────────────────────────────────────────
  const openEditor = useCallback((id: string) => setState({ editorId: id }), [setState]);
  const closeEditor = useCallback(() => setState({ editorId: null }), [setState]);

  /** Enqueue a non-destructive edit (crop/rotate/straighten/flip). The worker
   *  renders fresh edited previews from the original medium; progress + the
   *  refresh that swaps them in ride the shared job pipeline (useJobProgress). */
  const saveEdit = useCallback(
    async (recipe: EditRecipe) => {
      const s = stateRef.current;
      const id = s.editorId;
      if (!id) return;
      // Edits share the single-job lock with the AI runs, so say so rather than
      // dropping the click — same reason the AI buttons stopped failing silently.
      if (activeJobId.current) {
        flashToast("A job is already running — wait for it to finish");
        return;
      }
      setState({ editorId: null, proc: { active: true, label: "Queueing edit…", pct: 3 } });
      try {
        const resp = await fetch(`/api/assets/${id}/edit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ recipe }),
        });
        if (!resp.ok) throw new Error(String(resp.status));
        const { jobId } = (await resp.json()) as { jobId: string };
        activeJobId.current = jobId;
        setState({ proc: { active: true, label: "Rendering edit…", pct: 5 } });
      } catch {
        setState({ proc: { active: false, label: "", pct: 0 } });
        flashToast("Edit failed to start — try again");
      }
    },
    [setState, flashToast],
  );

  /** Reset (ADR 0030): drop the edit row — the untouched originals were never
   *  overwritten, so the views snap back on refresh. No worker round-trip. */
  const resetEdit = useCallback(
    (id: string) => {
      fetch(`/api/assets/${id}/edit`, { method: "DELETE" })
        .then((resp) => {
          if (!resp.ok) throw new Error(String(resp.status));
          flashToast("Edit reverted");
          router.refresh();
        })
        .catch(() => flashToast("Could not revert — try again"));
    },
    [flashToast, router],
  );

  const neuralGalleryFor = useCallback(
    (
      photos: Photo[],
      overrides: GalleryOverrides,
      previews: CanvasUploadPreview[] = [],
    ): { pos: Record<string, TilePos>; bounds: Bounds } =>
      assetGallery(projectCanvasItems(photos, previews), overrides.asset),
    [],
  );

  /** Every view opens at a fixed DEFAULT_ZOOM (75%), centered on its content —
   *  the same default zoom across Canvas / Timeline / Map / Topic (ADR 0022), so
   *  a big archive no longer shrinks to 40–60% on one view and 75% on another.
   *  Content larger than the viewport at 75% simply overflows and pans. */
  const fitDefaultZoom = useCallback((bounds: Bounds, r: Rect) => centerAtScale(bounds, r, DEFAULT_ZOOM), []);

  /** A layout's bounds, narrowed to what is actually on screen while a label
   *  filter is on. Unfiltered it returns the layout's own bounds untouched —
   *  which matters for Timeline, whose bounds deliberately stretch past the
   *  tiles to keep the axis line and its date labels in frame (ADR 0024). */
  const visibleBounds = useCallback(
    (layout: { tiles: Record<string, TilePos>; bounds: Bounds }, photos: readonly Photo[], filter: LabelFilter) =>
      filter ? positionsBounds(visibleTilePositions(layout.tiles, photos, filter)) : layout.bounds,
    [],
  );

  const computeFit = useCallback(
    (
      view: ViewMode,
      allPhotos: Photo[],
      overrides: GalleryOverrides,
      previews: CanvasUploadPreview[],
    ) => {
      const r = rect();
      const s = stateRef.current;
      const frames = s.frames;
      const fit = (layout: { tiles: Record<string, TilePos>; bounds: Bounds }) =>
        fitDefaultZoom(visibleBounds(layout, allPhotos, s.labelFilter), r);
      if (view === "neural") {
        const gallery = neuralGalleryFor(allPhotos, overrides, previews);
        return fit({ tiles: gallery.pos, bounds: gallery.bounds });
      }
      if (view === "sense") return fit(computeTopicLayout(allPhotos, overrides.topic, frames));
      return fit(computeTimelineLayout(allPhotos, overrides.timeline));
    },
    [rect, neuralGalleryFor, fitDefaultZoom, visibleBounds],
  );

  const doFit = useCallback(() => {
    const s = stateRef.current;
    setState(computeFit(s.view, canvasPhotos(s.photos, s.boardScope), s.galleryOverrides, s.uploadPreviews));
  }, [setState, computeFit]);

  /** The Fit button: zoom so EVERY tile fits the viewport (fitBounds solves for a
   *  best-fit scale, capped at ~1.05), unlike the fixed-75% view-switch default —
   *  users expect "Fit" to frame the whole archive, not just recenter. Map owns
   *  its own camera. Glides via tilesAnimating. */
  const doFitContent = useCallback(() => {
    const s = stateRef.current;
    if (s.view === "map") return;
    const r = rect();
    const neural = () => {
      const gallery = neuralGalleryFor(canvasPhotos(s.photos, s.boardScope), s.galleryOverrides, s.uploadPreviews);
      return { tiles: gallery.pos, bounds: gallery.bounds };
    };
    const layout =
      s.view === "sense"
        ? computeTopicLayout(canvasPhotos(s.photos, s.boardScope), s.galleryOverrides.topic, s.frames)
        : s.view === "timeline"
          ? computeTimelineLayout(canvasPhotos(s.photos, s.boardScope), s.galleryOverrides.timeline)
          : neural();
    setState({ ...fitBounds(visibleBounds(layout, canvasPhotos(s.photos, s.boardScope), s.labelFilter), r), tilesAnimating: true });
    if (animTimer.current) clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setState({ tilesAnimating: false }), 470);
  }, [rect, setState, neuralGalleryFor, visibleBounds]);

  const setZoomPct = useCallback(
    (pct: number) => {
      const s = stateRef.current;
      const r = rect(),
        cx = r.width / 2,
        cy = r.height / 2,
        ns = pct / 100;
      const px = (cx - s.tx) / s.scale,
        py = (cy - s.ty) / s.scale;
      setState({ scale: ns, tx: cx - px * ns, ty: cy - py * ns, zoomMenuOpen: false });
    },
    [rect, setState],
  );

  const setView = useCallback(
    (v: ViewMode) => {
      const s = stateRef.current;
      if (v === s.view) return;
      // Turn on the glide, then re-fit and re-sort in the same commit so the
      // tiles and the viewport animate together — the sort feels like the page
      // reflowing in place, not a page swap (ADR 0022). Selection is kept: a tile
      // stays selected as it flies to its new cluster.
      setState({
        view: v,
        marquee: null,
        bulkPanelOpen: false,
        tilesAnimating: true,
        focusedCloudKey: null,
        // View changes retire the right-side source browser so it cannot
        // overlap the AI chat panel that lives in the same slot.
        sidebarTabs: [],
        sidebarActiveTab: null,
        sidebarSelectedIds: [],
        sidebarSearchText: "",
        sidebarAddOpen: false,
        ...computeFit(v, canvasPhotos(s.photos, s.boardScope), s.galleryOverrides, s.uploadPreviews),
      });
      if (animTimer.current) clearTimeout(animTimer.current);
      animTimer.current = setTimeout(() => setState({ tilesAnimating: false }), 470);
    },
    [setState, computeFit],
  );

  // ── Selection actions (bottom action bar + right-click menu) ───────────────
  // Delete is real (bulk soft-delete + undo, ADR 0033); the rest are stubs
  // pending their backends, matching the app's "coming soon" pattern.

  const deleteSelected = useCallback(() => {
    const ids = stateRef.current.selectedIds.slice();
    if (ids.length === 0) return flashToast("Select files to delete");
    requestDeletePhotos(ids);
    setContextMenu(null);
  }, [requestDeletePhotos, flashToast]);

  /** Right-click "Move to Trash": the selection when one exists, else the tile
   *  under the cursor (the menu's targetId). */
  const deleteFromContext = useCallback(() => {
    const s = stateRef.current;
    const ids =
      s.selectedIds.length > 0
        ? s.selectedIds.slice()
        : contextMenu?.targetId
          ? [contextMenu.targetId]
          : [];
    setContextMenu(null);
    if (ids.length > 0) requestDeletePhotos(ids);
  }, [contextMenu, requestDeletePhotos]);

  /** Copy: park the selection on a clipboard that Paste reads in another
   *  project. Deliberately NOT a duplicate — `assets` is deduped by a UNIQUE
   *  index on content_hash, so a second row over the same bytes cannot exist,
   *  and it would be the wrong idea anyway: an asset is one shot, and putting it
   *  in two projects is what `project_assets` (M:N) is for. So Copy + Paste is a
   *  *link*, which is also why Duplicate could be removed in favour of it.
   *
   *  localStorage, not React state: the point is to paste somewhere ELSE, and
   *  navigating to another project remounts the workspace. */
  const copyFiles = useCallback(() => {
    const s = stateRef.current;
    setContextMenu(null);
    const ids = expandBoundGroups(s.selectedIds.slice(), boundGroupsOf(s.groups));
    if (ids.length === 0) return flashToast("Select files to copy");
    try {
      localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(ids));
    } catch {
      return flashToast("Couldn't copy — storage is unavailable");
    }
    setState({ clipboardCount: ids.length });
    flashToast(`Copied ${ids.length} ${ids.length === 1 ? "file" : "files"} — open another archive and paste`);
  }, [flashToast, setState]);

  /** Paste: link the clipboard's assets into the project being viewed. The
   *  route is idempotent (on-conflict ignore), so pasting twice is harmless and
   *  pasting a file that is already here is a no-op rather than an error. */
  const pasteFiles = useCallback(() => {
    const s = stateRef.current;
    setContextMenu(null);
    // 'all' is every asset in the workspace, not a project — there is no
    // membership row to add, so there is nothing "here" to paste into.
    if (s.projCurrent === "all") return flashToast("Open an archive to paste into");
    let ids: string[] = [];
    try {
      ids = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) ?? "[]") as string[];
    } catch {
      ids = [];
    }
    if (!Array.isArray(ids) || ids.length === 0) return flashToast("Nothing copied yet");
    void fetch(`/api/projects/${s.projCurrent}/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: ids }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ added: number }>) : Promise.reject(new Error("paste failed"))))
      .then(({ added }) => {
        // `added` counts the links actually created, so a re-paste honestly
        // reports 0 rather than claiming to have added what was already here.
        flashToast(
          added === 0
            ? "Those files are already in this archive"
            : `Pasted ${added} ${added === 1 ? "file" : "files"}`,
        );
        if (added > 0) router.refresh();
      })
      .catch(() => flashToast("Couldn't paste — try again"));
  }, [flashToast, router]);

  // ── Bound tile groups (the "Group" action) — no folder, no server ──────────

  /** "Group" action: bind the current selection into a move-/edit-together set.
   *  Unlike a folder (below) this creates no container and no server row — it is
   *  a client-only grouping so that clicking any member selects the whole set and
   *  dragging one drags all (see onGalleryAssetDown / the marquee). Re-grouping a
   *  selection that already spans other groups folds them in and drops the stale
   *  ones, so a tile only ever belongs to one group. */
  const groupFiles = useCallback(() => {
    const s = stateRef.current;
    setContextMenu(null);
    const ids = expandBoundGroups(s.selectedIds.slice(), boundGroupsOf(s.groups));
    if (ids.length < 2) return flashToast("Select at least two files to group");
    const projectId = s.projCurrent === "all" ? null : s.projCurrent;
    const idSet = new Set(ids);
    // Groups the new one absorbs. The route enforces single-membership per kind,
    // so their rows would be emptied anyway — deleting them keeps the server from
    // accumulating groups that still exist but hold nothing.
    const absorbed = s.groups.filter((g) => g.kind === "group" && g.members.some((m) => idSet.has(m)));
    const n = s.groups.filter((g) => g.kind === "group").length + 1;
    void fetch("/api/canvas-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "group", name: "Group " + n, projectId, assetIds: ids }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<CanvasGroup>) : Promise.reject(new Error("create failed"))))
      .then((group) => {
        setState((prev) => ({
          groups: [...prev.groups.filter((g) => !absorbed.some((a) => a.id === g.id)), group],
          selectedIds: ids,
        }));
        for (const g of absorbed) {
          void fetch(`/api/canvas-groups/${g.id}`, { method: "DELETE" }).catch(() => {});
        }
        flashToast(`Grouped ${ids.length} files — they now move and edit together`);
      })
      .catch(() => flashToast("Couldn't group those files"));
  }, [flashToast, setState]);

  /** "Ungroup": dissolve every bound group that the current selection touches.
   *  Optimistic — the tiles come apart at once and the DELETEs follow. */
  const ungroupSelection = useCallback(() => {
    const s = stateRef.current;
    setContextMenu(null);
    const sel = new Set(s.selectedIds);
    const hit = s.groups.filter((g) => g.kind === "group" && g.members.some((m) => sel.has(m)));
    if (hit.length === 0) return flashToast("Nothing grouped in the selection");
    setState({ groups: s.groups.filter((g) => !hit.some((h) => h.id === g.id)) });
    for (const g of hit) {
      void fetch(`/api/canvas-groups/${g.id}`, { method: "DELETE" }).catch(() => {});
    }
    flashToast("Ungrouped");
  }, [flashToast, setState]);

  /** True when the selection touches a bound group — drives the context-menu
   *  label (Group ↔ Ungroup) so one entry point covers both. */
  const selectionHasGroup = useMemo(() => {
    const sel = new Set(Array.from(state.selectedIds));
    return state.groups.some((g) => g.kind === "group" && g.members.some((m) => sel.has(m)));
  }, [state.selectedIds, state.groups]);

  // ── Tile stacking order (context-menu "Bring to front / Send to back") ──────

  /** Restack the selection (or the right-clicked tile). Front/back jump the tiles
   *  past the current max/min z-delta; forward/backward nudge by one. Persisted
   *  with the rest of the client geometry; PhotoTile adds the delta to its
   *  resting z-index. */
  const applyTileZ = useCallback(
    (mode: "front" | "back" | "forward" | "backward") => {
      const s = stateRef.current;
      setContextMenu(null);
      const ids =
        s.selectedIds.length > 0
          ? s.selectedIds.slice()
          : contextMenu?.targetId
            ? [contextMenu.targetId]
            : [];
      if (ids.length === 0) return;
      const cur = s.tileZ;
      const vals = Object.values(cur);
      const max = vals.length ? Math.max(0, ...vals) : 0;
      const min = vals.length ? Math.min(0, ...vals) : 0;
      const next = { ...cur };
      if (mode === "front") ids.forEach((id, i) => { next[id] = max + 1 + i; });
      else if (mode === "back") ids.forEach((id, i) => { next[id] = min - 1 - i; });
      else if (mode === "forward") ids.forEach((id) => { next[id] = (cur[id] ?? 0) + 1; });
      else ids.forEach((id) => { next[id] = (cur[id] ?? 0) - 1; });
      setState({ tileZ: next });
    },
    [contextMenu, setState],
  );
  const bringToFront = useCallback(() => applyTileZ("front"), [applyTileZ]);
  const sendToBack = useCallback(() => applyTileZ("back"), [applyTileZ]);
  const bringForward = useCallback(() => applyTileZ("forward"), [applyTileZ]);
  const sendBackward = useCallback(() => applyTileZ("backward"), [applyTileZ]);
  /** Open the Export-to-PDF dialog for an explicit set of assets (ADR 0035) — a
   *  frame's content, a folder, or the current selection. The dialog itself does
   *  the POST /api/exports + poll + download.
   *
   *  Page order is decided HERE, once, so all four entry points agree: the ids
   *  are put into the reading order of the layout the user is looking at. Every
   *  caller used to hand over its own incidental order (click order, marquee hit
   *  order, or `photos` = newest-first, which is the reverse of the default grid)
   *  and nothing downstream re-sorted — the route preserves the array and the
   *  worker re-imposes it, so whatever arrived became the page sequence. */
  const openExportFor = useCallback(
    (ids: string[]) => {
      setContextMenu(null);
      if (ids.length === 0) return flashToast("Nothing to export");
      const s = stateRef.current;
      // Timeline is a date axis: tiles straddle it but read left-to-right, so it
      // takes one band. The other views are 2D and band by row.
      const bandH = s.view === "timeline" ? Infinity : undefined;
      setState({ exportOpen: true, exportIds: readingOrder(ids, activeTilePositions(s), bandH) });
    },
    [activeTilePositions, flashToast, setState],
  );
  const exportFiles = useCallback(() => {
    openExportFor(stateRef.current.selectedIds.slice());
  }, [openExportFor]);
  const closeExport = useCallback(() => setState({ exportOpen: false }), [setState]);
  // ── Folders (ADR 0034) — server-backed grouping, client-side geometry ──────

  /** "Folder" action: wrap the current selection in a new folder. The server
   *  owns membership (single-folder-membership is enforced route-side); the
   *  browser owns the collapsed tile's spot, placed at the selection's center. */
  const folderFiles = useCallback(() => {
    const s = stateRef.current;
    const ids = s.selectedIds.slice();
    setContextMenu(null);
    if (ids.length === 0) return flashToast("Select files to put in a folder");
    const projectId = s.projCurrent === "all" ? null : s.projCurrent;
    const pos = activeTilePositions({ ...s, view: "neural" });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const p = pos[id];
      if (!p) continue;
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h);
    }
    const cx = Number.isFinite(minX) ? (minX + maxX) / 2 : 200;
    const cy = Number.isFinite(minY) ? (minY + maxY) / 2 : 200;
    const n = s.groups.filter((g) => g.kind === "folder").length + 1;
    void fetch("/api/canvas-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "folder", name: "Folder " + n, projectId, assetIds: ids }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<CanvasGroup>) : Promise.reject(new Error("create failed"))))
      .then((group) => {
        const geom: GroupGeom = {
          x: cx - FOLDER_TILE_W / 2,
          y: cy - FOLDER_TILE_H / 2,
          w: FOLDER_TILE_W,
          h: FOLDER_TILE_H,
          collapsed: true,
        };
        setState((prev) => ({
          groups: [...prev.groups, group],
          groupGeom: { ...prev.groupGeom, [group.id]: geom },
          selectedIds: [],
        }));
        flashToast(`Grouped ${ids.length} ${ids.length === 1 ? "file" : "files"} into "${group.name}"`);
      })
      .catch(() => flashToast("Couldn't create the folder"));
  }, [activeTilePositions, flashToast, setState]);

  /** Double-clicking a folder opens its Finder-style popup (the folder's members
   *  are hidden from the canvas while it stands in for them, ADR 0034); the popup
   *  is where you browse them. Replaces the old in-place grid expansion. */
  const openFolder = useCallback((id: string) => setState({ openFolderId: id }), [setState]);
  const closeFolder = useCallback(() => setState({ openFolderId: null }), [setState]);

  const renameGroup = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setState({ groups: stateRef.current.groups.map((g) => (g.id === id ? { ...g, name: trimmed } : g)) });
      void fetch(`/api/canvas-groups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      }).catch(() => {});
    },
    [setState],
  );

  const deleteGroup = useCallback(
    (id: string) => {
      const s = stateRef.current;
      const geom = { ...s.groupGeom };
      delete geom[id];
      setState({
        groups: s.groups.filter((g) => g.id !== id),
        groupGeom: geom,
        openFolderId: s.openFolderId === id ? null : s.openFolderId,
      });
      void fetch(`/api/canvas-groups/${id}`, { method: "DELETE" }).catch(() => {});
    },
    [setState],
  );

  /** Drag a member out of a folder's dropdown and drop it onto the Canvas: it
   *  leaves the folder (mirror of syncFolderMembership's grid→folder path) and
   *  lands where it was dropped. `clientX/Y` are screen coords from the drop. */
  const dropMemberOnCanvas = useCallback(
    (folderId: string, assetId: string, clientX: number, clientY: number) => {
      const center = toContent(clientX, clientY);
      pushHistory();
      setState((prev) => ({
        groups: prev.groups.map((g) =>
          g.id === folderId ? { ...g, members: g.members.filter((m) => m !== assetId) } : g,
        ),
        galleryOverrides: {
          ...prev.galleryOverrides,
          asset: { ...prev.galleryOverrides.asset, [assetId]: center },
        },
      }));
      void fetch(`/api/canvas-groups/${folderId}/assets`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds: [assetId] }),
      }).catch(() => {});
    },
    [toContent, pushHistory, setState],
  );

  /** Drag a folder box: shift its geometry; an expanded folder carries its
   *  member tiles along (their overrides shift by the same delta). Deltas arrive
   *  in content space from the overlay. */
  const moveGroup = useCallback(
    (id: string, dx: number, dy: number) => {
      const s = stateRef.current;
      const geom = s.groupGeom[id] ?? defaultFolderGeom(id);
      const next: GroupGeom = { ...geom, x: geom.x + dx, y: geom.y + dy };
      if (!geom.collapsed) {
        const folder = s.groups.find((g) => g.id === id);
        const asset = { ...s.galleryOverrides.asset };
        folder?.members.forEach((mid) => {
          const c = asset[mid];
          if (c) asset[mid] = { x: c.x + dx, y: c.y + dy };
        });
        setState({ groupGeom: { ...s.groupGeom, [id]: next }, galleryOverrides: { ...s.galleryOverrides, asset } });
      } else {
        setState({ groupGeom: { ...s.groupGeom, [id]: next } });
      }
    },
    [setState],
  );

  /** New function: wrap the current selection in an artboard (frame). Artboards
   *  live on the Workspace, so the bounding box is computed in neural (grid)
   *  coordinates and — if invoked from a sorting view — we switch back first so
   *  the frame lands where the tiles rest. */
  const addToNewArtboard = useCallback(() => {
    const s = stateRef.current;
    const ids = s.selectedIds;
    if (ids.length === 0) return flashToast("Select files to add to an artboard");
    const pos = activeTilePositions({ ...s, view: "neural" });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const p = pos[id];
      if (!p) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + p.h);
    }
    if (!Number.isFinite(minX)) return flashToast("Select files to add to an artboard");
    const pad = 28;
    pushHistory();
    const n = s.frames.length + 1;
    const frame = {
      id: "frame" + Date.now(),
      x: minX - pad,
      y: minY - pad,
      w: Math.max(40, maxX - minX + pad * 2),
      h: Math.max(40, maxY - minY + pad * 2),
      label: "Frame " + n,
    };
    if (s.view !== "neural") setView("neural");
    setState((prev) => ({ frames: [...prev.frames, frame] }));
    setContextMenu(null);
    flashToast(`Added ${ids.length} ${ids.length === 1 ? "file" : "files"} to a new artboard`);
  }, [activeTilePositions, pushHistory, setView, setState, flashToast]);

  /** New function: pack the current selection into an existing artboard by
   *  overriding each tile's Workspace center to a grid inside the frame bounds. */
  const addToExistingArtboard = useCallback((frameId: string) => {
    const s = stateRef.current;
    const ids = s.selectedIds;
    if (ids.length === 0) return flashToast("Select files to add to an artboard");
    const frame = s.frames.find((f) => f.id === frameId);
    if (!frame) return;
    const pos = activeTilePositions({ ...s, view: "neural" });
    const pad = 24, gap = 16, cell = 120;
    const cols = Math.max(1, Math.floor((frame.w - pad * 2 + gap) / (cell + gap)));
    pushHistory();
    const asset = { ...s.galleryOverrides.asset };
    ids.forEach((id, i) => {
      const p = pos[id];
      const w = p?.w ?? cell, h = p?.h ?? cell;
      const col = i % cols, row = Math.floor(i / cols);
      asset[id] = {
        x: frame.x + pad + col * (cell + gap) + w / 2,
        y: frame.y + pad + row * (cell + gap) + h / 2,
      };
    });
    if (s.view !== "neural") setView("neural");
    setState((prev) => ({ galleryOverrides: { ...prev.galleryOverrides, asset } }));
    setContextMenu(null);
    flashToast(`Added ${ids.length} ${ids.length === 1 ? "file" : "files"} to "${frame.label}"`);
  }, [activeTilePositions, pushHistory, setView, setState, flashToast]);

  // ── Frame (artboard) actions: treat the frame + its content as one unit ────

  /** The asset ids whose tiles currently sit inside a frame (positional — a
   *  frame has no stored membership; ADR 0034). */
  const frameContentIds = useCallback(
    (frame: Frame): string[] => {
      const s = stateRef.current;
      const pos = activeTilePositions({ ...s, view: "neural" });
      return s.photos
        .filter((p) => {
          const t = pos[p.id];
          return t && t.cx >= frame.x && t.cx <= frame.x + frame.w && t.cy >= frame.y && t.cy <= frame.y + frame.h;
        })
        .map((p) => p.id);
    },
    [activeTilePositions],
  );

  /** Select everything inside a frame — the normal action bar then operates on
   *  the whole artboard. */
  const selectFrame = useCallback(
    (frameId: string) => {
      const s = stateRef.current;
      const frame = s.frames.find((f) => f.id === frameId);
      if (!frame) return;
      if (s.view !== "neural") setView("neural");
      setState({ selectedIds: frameContentIds(frame) });
    },
    [frameContentIds, setView, setState],
  );

  /** Export a whole artboard's content to PDF (ADR 0035). */
  const exportFrame = useCallback(
    (frameId: string) => {
      const frame = stateRef.current.frames.find((f) => f.id === frameId);
      if (frame) openExportFor(frameContentIds(frame));
    },
    [frameContentIds, openExportFor],
  );

  /** Delete a frame AND its content — the photos go to Trash through the normal
   *  soft-delete flow (undo toast + bulk-confirm ≥8, ADR 0033); the rect is
   *  removed either way. */
  const deleteFrameWithContent = useCallback(
    (frameId: string) => {
      const s = stateRef.current;
      const frame = s.frames.find((f) => f.id === frameId);
      if (!frame) return;
      const ids = frameContentIds(frame);
      pushHistory();
      setState({ frames: s.frames.filter((f) => f.id !== frameId) });
      if (ids.length > 0) requestDeletePhotos(ids);
      else flashToast("Removed empty artboard");
    },
    [frameContentIds, pushHistory, setState, requestDeletePhotos, flashToast],
  );

  // Move / resize an artboard while its content rides along (the user's ask:
  // "не втрачалось те що всередині"). Content is captured positionally at gesture
  // start, then translated (move) or scaled about the fixed corner (resize), so
  // nothing inside is left behind. Cumulative deltas arrive in content space.
  const frameGesture = useRef<{
    id: string;
    mode: "move" | "resize";
    handle: "nw" | "ne" | "sw" | "se";
    orig: Frame;
    content: { id: string; cx: number; cy: number }[];
  } | null>(null);

  const beginFrameMove = useCallback(
    (id: string) => {
      const s = stateRef.current;
      const frame = s.frames.find((f) => f.id === id);
      if (!frame) return;
      const pos = activeTilePositions({ ...s, view: "neural" });
      const content = frameContentIds(frame).map((cid) => ({ id: cid, cx: pos[cid]?.cx ?? 0, cy: pos[cid]?.cy ?? 0 }));
      pushHistory();
      frameGesture.current = { id, mode: "move", handle: "se", orig: { ...frame }, content };
    },
    [activeTilePositions, frameContentIds, pushHistory],
  );

  const beginFrameResize = useCallback(
    (id: string, handle: "nw" | "ne" | "sw" | "se") => {
      const s = stateRef.current;
      const frame = s.frames.find((f) => f.id === id);
      if (!frame) return;
      const pos = activeTilePositions({ ...s, view: "neural" });
      const content = frameContentIds(frame).map((cid) => ({ id: cid, cx: pos[cid]?.cx ?? 0, cy: pos[cid]?.cy ?? 0 }));
      pushHistory();
      frameGesture.current = { id, mode: "resize", handle, orig: { ...frame }, content };
    },
    [activeTilePositions, frameContentIds, pushHistory],
  );

  const frameGestureMove = useCallback(
    (dx: number, dy: number) => {
      const g = frameGesture.current;
      if (!g) return;
      const s = stateRef.current;
      const asset = { ...s.galleryOverrides.asset };
      let nf: Frame;
      if (g.mode === "move") {
        nf = { ...g.orig, x: g.orig.x + dx, y: g.orig.y + dy };
        for (const c of g.content) asset[c.id] = { x: c.cx + dx, y: c.cy + dy };
      } else {
        const MIN = 80;
        const west = g.handle === "nw" || g.handle === "sw";
        const north = g.handle === "nw" || g.handle === "ne";
        const w = Math.max(MIN, west ? g.orig.w - dx : g.orig.w + dx);
        const h = Math.max(MIN, north ? g.orig.h - dy : g.orig.h + dy);
        const x = west ? g.orig.x + (g.orig.w - w) : g.orig.x;
        const y = north ? g.orig.y + (g.orig.h - h) : g.orig.y;
        nf = { ...g.orig, x, y, w, h };
        // Scale content about the corner that stays put, so it keeps its
        // relative place inside the resized frame (never falls out).
        const anchorX = west ? g.orig.x + g.orig.w : g.orig.x;
        const anchorY = north ? g.orig.y + g.orig.h : g.orig.y;
        const sxr = w / g.orig.w;
        const syr = h / g.orig.h;
        for (const c of g.content) {
          asset[c.id] = { x: anchorX + (c.cx - anchorX) * sxr, y: anchorY + (c.cy - anchorY) * syr };
        }
      }
      setState({
        frames: s.frames.map((f) => (f.id === g.id ? nf : f)),
        galleryOverrides: { ...s.galleryOverrides, asset },
      });
    },
    [setState],
  );

  const endFrameGesture = useCallback(() => {
    frameGesture.current = null;
  }, []);

  /** "Tidy up" (issue #3): snap the Canvas grid back to order, with the same
   *  glide a view switch uses. Selection ≥ 2 packs just those tiles into an even
   *  grid where they already sit (Figma-style, selection-first); selection ≤ 1
   *  resets the whole asset bucket to assetGallery's deterministic default grid —
   *  except tiles that live inside an artboard (their override is what holds them
   *  there), so a tidy-all never ejects framed work. Undoable via pushHistory;
   *  neural-view only (the bottom action bar that hosts it is neural-only). */
  const tidyUp = useCallback(() => {
    const s = stateRef.current;
    const pos = activeTilePositions({ ...s, view: "neural" });
    let nextAsset: Record<string, CanvasPoint>;
    if (s.selectedIds.length >= 2) {
      nextAsset = { ...s.galleryOverrides.asset, ...packGrid(s.selectedIds, pos) };
    } else {
      if (Object.keys(s.galleryOverrides.asset).length === 0) return; // already the default grid
      const keep: Record<string, CanvasPoint> = {};
      for (const [id, center] of Object.entries(s.galleryOverrides.asset)) {
        const t = pos[id];
        const inFrame = t
          ? s.frames.some((f) => t.cx >= f.x && t.cx <= f.x + f.w && t.cy >= f.y && t.cy <= f.y + f.h)
          : true; // not in the current layout — keep its override defensively
        if (inFrame) keep[id] = center;
      }
      nextAsset = keep;
    }
    pushHistory();
    setState({ galleryOverrides: { ...s.galleryOverrides, asset: nextAsset }, tilesAnimating: true });
    if (animTimer.current) clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setState({ tilesAnimating: false }), 470);
    setContextMenu(null);
  }, [activeTilePositions, pushHistory, setState]);

  /** "Regroup" (ADR 0038) — Tidy up's counterpart for the sorting views: drop
   *  the drag overrides so the tiles glide back into their packed clouds (or
   *  their date columns on Timeline).
   *
   *  It has to exist because the clouds are recomputed server-side while the
   *  coordinates are not: analyze re-clusters, a photo changes cloud, and the
   *  arrangement the user built stops describing anything. The stale-anchor
   *  rule handles that automatically now, but a user who has simply pulled a
   *  view apart by hand still needs a way back — and there was none: the bottom
   *  action bar that hosts Tidy up is Canvas-only, and `tidyUp` writes the
   *  `asset` bucket, so pointing it at Topic would silently rearrange Canvas.
   *
   *  Selection ≥ 2 regroups only those tiles (Figma-style, selection-first, the
   *  same rule Tidy up follows); otherwise the whole bucket resets. */
  const regroupClouds = useCallback(() => {
    const s = stateRef.current;
    const bucketKey =
      s.view === "timeline" ? "timeline" : s.view === "sense" ? "topic" : null;
    if (!bucketKey) return;
    const current = s.galleryOverrides[bucketKey];
    let next: Record<string, CanvasOverride>;
    if (s.selectedIds.length >= 2) {
      next = { ...current };
      for (const id of s.selectedIds) delete next[id];
      if (Object.keys(next).length === Object.keys(current).length) return; // nothing was moved
    } else {
      if (Object.keys(current).length === 0) return; // already the packed default
      next = {};
    }
    pushHistory();
    setState({
      galleryOverrides: { ...s.galleryOverrides, [bucketKey]: next },
      focusedCloudKey: null,
      tilesAnimating: true,
    });
    if (animTimer.current) clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setState({ tilesAnimating: false }), 470);
    setContextMenu(null);
  }, [pushHistory, setState]);

  /** Open the grid context menu at the cursor. A right-click on an unselected
   *  tile selects it first (matching desktop file-manager behaviour) so the menu
   *  acts on what you clicked. */
  const openContextMenu = useCallback((x: number, y: number, targetId: string | null) => {
    if (targetId && !stateRef.current.selectedIds.includes(targetId)) {
      setState({ selectedIds: [targetId], drawerId: null });
    }
    setContextMenu({ x, y, targetId });
  }, [setState]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Fit once on first mount, but only after the canvas has a real size — a
  // zero-size rect (background tab / not-yet-painted) would produce a bad fit.
  // Every view opens centered at the fixed 75% default; oversized content
  // overflows and pans — there is no fit-to-content pass anymore (ADR 0022).
  const didFitRef = useRef(false);
  const tryFit = useCallback(() => {
    if (didFitRef.current) return true;
    const r = rect();
    if (r.width > 0 && r.height > 0) {
      const s = stateRef.current;
      const bounds = neuralGalleryFor(canvasPhotos(s.photos, s.boardScope), s.galleryOverrides, s.uploadPreviews).bounds;
      setState(fitDefaultZoom(bounds, r));
      didFitRef.current = true;
      return true;
    }
    return false;
  }, [rect, setState, neuralGalleryFor, fitDefaultZoom]);

  // ── Chat = Smart Search (#16) — the assistant's answers ARE search results ─

  const chatBusy = useRef(false);

  /** Swap the trailing "Searching…" placeholder for the real answer. */
  const patchLastChatMsg = useCallback(
    (text: string, results?: ChatResult[]) => {
      const msgs = stateRef.current.chatMsgs.slice();
      msgs[msgs.length - 1] = { role: "assistant", text, ...(results?.length ? { results } : {}) };
      setState({ chatMsgs: msgs });
    },
    [setState],
  );

  const sendChat = useCallback(
    async (text?: string) => {
      const s = stateRef.current;
      const t = (typeof text === "string" ? text : s.chatInput || "").trim();
      if (!t || chatBusy.current) return;
      chatBusy.current = true;
      setState({
        chatMsgs: [...s.chatMsgs, { role: "user", text: t }, { role: "assistant", text: "Searching your archive…" }],
        chatInput: "",
      });
      try {
        const qs = new URLSearchParams({ q: t });
        if (currentProjectId !== "all") qs.set("projectId", currentProjectId);
        const resp = await fetch(`/api/search?${qs.toString()}`);
        if (!resp.ok) throw new Error(String(resp.status));
        const data = (await resp.json()) as SearchResponse;

        const byId = new Map(stateRef.current.photos.map((p) => [p.id, p]));
        const results: ChatResult[] = data.results.map((r) => {
          const p = byId.get(r.assetId);
          return {
            assetId: r.assetId,
            src: p ? photoSrc(p, 76, 76) : undefined,
            filename: p?.filename ?? "outside this view",
            tier: r.tier,
            matchedTags: r.matchedTags,
            matchedPlace: r.matchedPlace,
            matchedText: r.matchedText,
          };
        });

        // Honest filter note (ADR 0029/0031): name only what actually filtered
        // or matched a result — never the parsed wish-list. Dates/places/EXIF
        // genuinely filter in SQL; tags and description text only rank, so they
        // appear only when a returned result carries the match.
        const filters: string[] = [];
        if (data.parsed.date_from || data.parsed.date_to)
          filters.push(`dates ${data.parsed.date_from ?? "…"} – ${data.parsed.date_to ?? "…"}`);
        if (data.parsed.place_terms.length) filters.push(`place: ${data.parsed.place_terms.join(", ")}`);
        if (data.parsed.camera_terms.length) filters.push(`camera: ${data.parsed.camera_terms.join(", ")}`);
        if (data.parsed.iso_min || data.parsed.iso_max)
          filters.push(`ISO ${data.parsed.iso_min ?? "…"}–${data.parsed.iso_max ?? "…"}`);
        if (data.parsed.aperture) filters.push(`aperture ${data.parsed.aperture}`);
        const hitTags = [...new Set(results.flatMap((r) => r.matchedTags))];
        if (hitTags.length) filters.push(`tagged: ${hitTags.join(", ")}`);
        if (results.some((r) => r.matchedText)) filters.push("in description");
        const filterNote = filters.length ? ` (${filters.join("; ")})` : "";

        const strong = results.filter((r) => r.tier === "strong").length;
        const weak = results.length - strong;
        patchLastChatMsg(
          results.length
            ? `${strong} best match${strong === 1 ? "" : "es"}${filterNote}${weak ? ` — plus ${weak} more distant below` : ""}. Tap a thumb to open it.`
            // Names a real affordance: the ✨ badge sits on every unanalyzed
            // tile. The old copy pointed at an "Analyze with AI" button that
            // did not exist anywhere in the UI.
            : `No matches${filterNote}. Only analyzed photos are searchable — click the ✨ badge on a photo to analyze it, or try different wording.`,
          results,
        );
      } catch {
        patchLastChatMsg("Search is unavailable right now — try again in a moment.");
      } finally {
        chatBusy.current = false;
      }
    },
    [setState, patchLastChatMsg, currentProjectId],
  );

  /** Chat's "Select N results": select the matches that are on this canvas. */
  const selectSearchResults = useCallback(
    (ids: string[]) => {
      const loaded = new Set(stateRef.current.photos.map((p) => p.id));
      const found = ids.filter((id) => loaded.has(id));
      setState({ selectedIds: found });
      flashToast(found.length ? `${found.length} photo(s) selected` : "Results are outside this view");
    },
    [setState, flashToast],
  );

  const onChatInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => setState({ chatInput: e.target.value }),
    [setState],
  );

  const onChatKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    },
    [sendChat],
  );

  const toggleChat = useCallback(
    () => setState({ chatOpen: !stateRef.current.chatOpen, acctOpen: false, projOpen: false }),
    [setState],
  );
  const closeChat = useCallback(() => setState({ chatOpen: false }), [setState]);

  // ── Zoom dropdown ────────────────────────────────────────────────────────

  const toggleZoomMenu = useCallback(
    () => setState({ zoomMenuOpen: !stateRef.current.zoomMenuOpen, acctOpen: false, projOpen: false }),
    [setState],
  );
  const closeZoomMenu = useCallback(() => setState({ zoomMenuOpen: false }), [setState]);

  // ── Account / project dropdowns ─────────────────────────────────────────

  const openAcct = useCallback(
    () => setState({ acctOpen: !stateRef.current.acctOpen, projOpen: false, zoomMenuOpen: false }),
    [setState],
  );
  const closeAcct = useCallback(() => setState({ acctOpen: false }), [setState]);
  const openProj = useCallback(
    () => setState({ projOpen: !stateRef.current.projOpen, acctOpen: false, zoomMenuOpen: false }),
    [setState],
  );
  const closeProj = useCallback(() => setState({ projOpen: false }), [setState]);

  // Real projects are routes (issue #17): switching navigates; the server
  // refetches the scoped assets and the workspace remounts.
  const selectProject = useCallback(
    (k: ProjectKey) => {
      setState({ projOpen: false });
      if (k === currentProjectId) return; // already here — a push would be a no-op reload
      navProgressStart();
      router.push(`/projects/${k}`);
    },
    [setState, router, currentProjectId],
  );

  const goHome = useCallback(() => {
    navProgressStart();
    router.push("/");
  }, [router]);

  // ── Add to project ───────────────────────────────────────────────────────

  const toggleAddProj = useCallback(
    () => setState({ addProjOpen: !stateRef.current.addProjOpen }),
    [setState],
  );
  const closeAddProj = useCallback(() => setState({ addProjOpen: false }), [setState]);

  /** Links the given asset ids into a real project (issue #17). Shared by the
   * canvas selection's "ADD" button and the source browser sidebar's button. */
  const commitAddToProject = useCallback(
    async (key: string, ids: string[]) => {
      const n = ids.length;
      if (!n) return;
      const label = resolveProjectMeta(key, initialProjects).label;
      try {
        const resp = await fetch(`/api/projects/${key}/assets`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assetIds: ids }),
        });
        if (!resp.ok) throw new Error(String(resp.status));
        flashToast(`${n} file${n === 1 ? "" : "s"} added to ${label}`);
        router.refresh();
      } catch {
        flashToast("Add to project failed — try again");
      }
    },
    [flashToast, router, initialProjects],
  );

  /** Creates a real project from the given asset ids and navigates into it.
   * Returns the new project id (or null on failure / empty selection). */
  const commitCreateProject = useCallback(
    async (ids: string[]): Promise<string | null> => {
      const n = ids.length;
      if (!n) return null;
      try {
        const resp = await fetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: `Untitled project ${initialProjects.length + 1}` }),
        });
        if (!resp.ok) throw new Error(String(resp.status));
        const { id } = (await resp.json()) as { id: string };
        await fetch(`/api/projects/${id}/assets`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assetIds: ids }),
        });
        flashToast(`${n} file${n === 1 ? "" : "s"} added to new project`);
        return id;
      } catch {
        flashToast("Create project failed — try again");
        return null;
      }
    },
    [flashToast, initialProjects],
  );

  const addToProject = useCallback(
    (key: ProjectKey) => {
      const ids = stateRef.current.selectedIds.slice();
      setState({ addProjOpen: false, selectedIds: [] });
      void commitAddToProject(key, ids);
    },
    [commitAddToProject, setState],
  );

  const createNewProject = useCallback(() => {
    const ids = stateRef.current.selectedIds.slice();
    setState({ addProjOpen: false, selectedIds: [] });
    void commitCreateProject(ids).then((id) => {
      if (!id) return;
      navProgressStart();
      router.push(`/projects/${id}`);
    });
  }, [commitCreateProject, setState, router]);

  // ── Source browser sidebar (Finder-style, All My Files) ─────────────────

  const openSourceTab = useCallback(
    (source: PhotoSource) => {
      const s = stateRef.current;
      const tabs = s.sidebarTabs.includes(source) ? s.sidebarTabs : [...s.sidebarTabs, source];
      setState({ sidebarTabs: tabs, sidebarActiveTab: source, drawerId: null });
    },
    [setState],
  );

  const closeSourceTab = useCallback(
    (source: PhotoSource) => {
      const s = stateRef.current;
      const tabs = s.sidebarTabs.filter((t) => t !== source);
      const active = s.sidebarActiveTab === source ? (tabs[tabs.length - 1] ?? null) : s.sidebarActiveTab;
      setState({ sidebarTabs: tabs, sidebarActiveTab: active });
    },
    [setState],
  );

  const setSidebarActiveTab = useCallback(
    (source: PhotoSource) => setState({ sidebarActiveTab: source }),
    [setState],
  );

  const closeSidebar = useCallback(
    () =>
      setState({
        sidebarTabs: [],
        sidebarActiveTab: null,
        sidebarSelectedIds: [],
        sidebarSearchText: "",
        sidebarAddOpen: false,
      }),
    [setState],
  );

  const toggleSidebarFile = useCallback(
    (id: string) => {
      const s = stateRef.current;
      const sel = s.sidebarSelectedIds.slice();
      const i = sel.indexOf(id);
      if (i >= 0) sel.splice(i, 1);
      else sel.push(id);
      setState({ sidebarSelectedIds: sel });
    },
    [setState],
  );

  const toggleSidebarGroup = useCallback(
    (ids: string[]) => {
      const s = stateRef.current;
      const selSet = new Set(s.sidebarSelectedIds);
      const allSelected = ids.length > 0 && ids.every((id) => selSet.has(id));
      if (allSelected) ids.forEach((id) => selSet.delete(id));
      else ids.forEach((id) => selSet.add(id));
      setState({ sidebarSelectedIds: Array.from(selSet) });
    },
    [setState],
  );

  const setSidebarSearch = useCallback((text: string) => setState({ sidebarSearchText: text }), [setState]);

  const toggleSidebarAddOpen = useCallback(
    () => setState({ sidebarAddOpen: !stateRef.current.sidebarAddOpen }),
    [setState],
  );
  const closeSidebarAddOpen = useCallback(() => setState({ sidebarAddOpen: false }), [setState]);

  const sidebarAddToProject = useCallback(
    (key: string) => {
      const ids = stateRef.current.sidebarSelectedIds.slice();
      setState({
        sidebarAddOpen: false,
        sidebarSelectedIds: [],
        sidebarTabs: [],
        sidebarActiveTab: null,
        sidebarSearchText: "",
      });
      void commitAddToProject(key, ids).then(() => {
        navProgressStart();
        router.push(`/projects/${key}`);
      });
    },
    [commitAddToProject, setState, router],
  );

  const setSidebarViewMode = useCallback(
    (mode: SidebarViewMode) => setState({ sidebarViewMode: mode }),
    [setState],
  );

  const sidebarCreateProject = useCallback(() => {
    const ids = stateRef.current.sidebarSelectedIds.slice();
    setState({
      sidebarAddOpen: false,
      sidebarSelectedIds: [],
      sidebarTabs: [],
      sidebarActiveTab: null,
      sidebarSearchText: "",
    });
    void commitCreateProject(ids).then((id) => {
      if (!id) return;
      navProgressStart();
      router.push(`/projects/${id}`);
    });
  }, [commitCreateProject, setState, router]);

  // ── Search / Help ────────────────────────────────────────────────────────

  const openHelp = useCallback(() => setState({ helpOpen: true }), [setState]);
  const closeHelp = useCallback(() => setState({ helpOpen: false }), [setState]);

  // ── Import ───────────────────────────────────────────────────────────────

  const addToolbar = useCallback(() => {
    setState({ imp: { open: !stateRef.current.imp.open } });
  }, [setState]);
  const closeImport = useCallback(() => setState({ imp: { open: false } }), [setState]);

  // ── Trash panel (ADR 0033) ────────────────────────────────────────────────
  // Quick in-workspace access to trashed assets so a mistaken delete can be
  // undone without leaving the canvas (the homepage Trash view is the other
  // entry point). Restore brings the asset back onto the canvas.
  const openTrash = useCallback(() => {
    // Right-side panel — retire the others that live in the same slot.
    setState({
      trashOpen: true,
      trashAssets: null,
      drawerId: null,
      chatOpen: false,
      sidebarTabs: [],
      sidebarActiveTab: null,
      sidebarAddOpen: false,
    });
    fetch("/api/assets?scope=trash")
      .then((resp) => (resp.ok ? resp.json() : Promise.reject(new Error(String(resp.status)))))
      .then((data: { assets: TrashedAsset[] }) => {
        if (stateRef.current.trashOpen) setState({ trashAssets: data.assets });
      })
      .catch(() => {
        if (stateRef.current.trashOpen) setState({ trashAssets: [] });
      });
  }, [setState]);

  const closeTrash = useCallback(() => setState({ trashOpen: false }), [setState]);

  // The toolbar button toggles the panel; openTrash stays a pure open so the
  // restore/purge error retries can reload the list without closing it.
  const toggleTrash = useCallback(() => {
    if (stateRef.current.trashOpen) closeTrash();
    else openTrash();
  }, [closeTrash, openTrash]);

  const restoreFromTrash = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const idSet = new Set(ids);
      setState((prev) => ({ trashAssets: prev.trashAssets?.filter((a) => !idSet.has(a.id)) ?? null }));
      fetch("/api/assets/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      })
        .then((resp) => {
          if (!resp.ok) throw new Error(String(resp.status));
          flashToast(ids.length === 1 ? "Photo restored" : `${ids.length} photos restored`);
          router.refresh(); // bring the restored asset(s) back onto the canvas
        })
        .catch(() => {
          flashToast("Could not restore — try again");
          openTrash(); // reload the list so the failed row reappears
        });
    },
    [setState, flashToast, router, openTrash],
  );

  const purgeFromTrash = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const many = ids.length > 1;
      const ok = window.confirm(
        many
          ? `Delete ${ids.length} photos permanently? This can’t be undone.`
          : "Delete this photo permanently? This can’t be undone.",
      );
      if (!ok) return;
      const idSet = new Set(ids);
      setState((prev) => ({ trashAssets: prev.trashAssets?.filter((a) => !idSet.has(a.id)) ?? null }));
      fetch("/api/assets/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      })
        .then((resp) => {
          if (!resp.ok) throw new Error(String(resp.status));
          flashToast(many ? `${ids.length} photos deleted permanently` : "Photo deleted permanently");
        })
        .catch(() => {
          flashToast("Could not delete — try again");
          openTrash();
        });
    },
    [setState, flashToast, openTrash],
  );

  const onUploadBatchStart = useCallback(
    (batch: UploadBatchStart) => {
      const s = stateRef.current;
      if (s.projCurrent === "all") return;
      const existingByClientId = new Map(s.uploadPreviews.map((preview) => [preview.clientId, preview]));
      const incomingFilesByClientId = new Map(
        batch.files.map((item) => [`${batch.batchId}:${item.inputIndex}`, item]),
      );
      const incomingClientIds = new Set(batch.files.map((item) => `${batch.batchId}:${item.inputIndex}`));
      const newFiles = batch.files.filter(
        (item) => !existingByClientId.has(`${batch.batchId}:${item.inputIndex}`),
      );
      const newClientIds = newFiles.map((item) => `${batch.batchId}:${item.inputIndex}`);

      // A retry reuses the original batch/id pair. Revoke any stale URL before
      // replacing it, and count the other live URLs so this batch never retains
      // more than the local-preview cap at once.
      const retainedPreviewCount = s.uploadPreviews.filter(
        (preview) =>
          preview.batchId === batch.batchId &&
          preview.localUrl !== null &&
          !incomingClientIds.has(preview.clientId),
      ).length;
      let previewSlots = Math.max(0, MAX_LOCAL_UPLOAD_PREVIEWS_PER_BATCH - retainedPreviewCount);
      const localUrls = new Map<string, string | null>();
      for (const item of batch.files) {
        const clientId = `${batch.batchId}:${item.inputIndex}`;
        const previousUrl = objectUrlsRef.current.get(clientId);
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        objectUrlsRef.current.delete(clientId);
        const localUrl = previewSlots > 0 && canPreviewLocally(item.file)
          ? URL.createObjectURL(item.file)
          : null;
        if (localUrl) {
          previewSlots -= 1;
          objectUrlsRef.current.set(clientId, localUrl);
        }
        localUrls.set(clientId, localUrl);
      }

      // A freshly dropped file has no capture date / topic to sort by, so it can
      // only live on the Canvas. If the drop landed in a sorted view the pointer
      // was over the Timeline/Topic layout — a meaningless grid anchor — so append
      // the batch as a neat cluster just below the existing Canvas content and
      // snap to Canvas (below). In Canvas, cluster around the real drop point.
      const droppedIntoSortedView = newFiles.length > 0 && s.view !== "neural";
      let centers: Record<string, CanvasPoint> = {};
      if (newFiles.length > 0) {
        const r = rect();
        const clientPoint = batch.clientPoint ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        const anchor = droppedIntoSortedView
          ? appendClusterAnchor(
            neuralGalleryFor(canvasPhotos(s.photos, s.boardScope), s.galleryOverrides, s.uploadPreviews).bounds,
            newClientIds.length,
          )
          : toContent(clientPoint.x, clientPoint.y);
        centers = droppedAssetCenters(newClientIds, anchor);
      }
      const previews = newFiles.map((item): CanvasUploadPreview => {
        const clientId = `${batch.batchId}:${item.inputIndex}`;
        return {
          clientId,
          batchId: batch.batchId,
          inputIndex: item.inputIndex,
          assetId: null,
          jobId: null,
          filename: item.file.name,
          mime: item.file.type || "application/octet-stream",
          localUrl: localUrls.get(clientId) ?? null,
          center: centers[clientId],
          width: 4,
          height: 3,
          stage: "uploading",
          message: null,
        };
      });
      setState((previous) => ({
        uploadPreviews: [
          ...previous.uploadPreviews.map((preview): CanvasUploadPreview => {
            if (!incomingClientIds.has(preview.clientId)) return preview;
            const item = incomingFilesByClientId.get(preview.clientId);
            if (!item) return preview;
            return {
              ...preview,
              filename: item.file.name,
              mime: item.file.type || "application/octet-stream",
              localUrl: localUrls.get(preview.clientId) ?? null,
              stage: "uploading",
              message: null,
            };
          }),
          ...previews,
        ],
        galleryOverrides: {
          ...previous.galleryOverrides,
          asset: { ...previous.galleryOverrides.asset, ...centers },
        },
      }));
      // Snap to Canvas so the dropped cluster is what the user sees; the setState
      // above already committed the previews to stateRef, so setView's re-fit
      // includes them and frames the new batch.
      if (droppedIntoSortedView) setView("neural");
      // Seed the real aspect ASAP: previews start at a 4:3 placeholder, so without
      // this the tile visibly jumps to the photo's true shape only when the
      // processed asset lands (seconds later). Measuring the already-loaded local
      // bytes now settles the tile to its real aspect within a frame or two, and
      // the canonical asset (same dimensions) then arrives with no further reflow.
      const previewsToProbe = [
        ...previews,
        ...s.uploadPreviews
          .filter(
            (preview) =>
              incomingClientIds.has(preview.clientId) &&
              preview.width === 4 &&
              preview.height === 3,
          )
          .map((preview) => ({ ...preview, localUrl: localUrls.get(preview.clientId) ?? null })),
      ];
      for (const preview of previewsToProbe) {
        const localUrl = preview.localUrl;
        if (!localUrl) continue;
        const clientId = preview.clientId;
        const probe = new window.Image();
        probe.onload = () => {
          const w = probe.naturalWidth,
            h = probe.naturalHeight;
          if (w > 0 && h > 0) {
            setState((prev) => ({
              uploadPreviews: prev.uploadPreviews.map((p) =>
                p.clientId === clientId ? { ...p, width: w, height: h } : p,
              ),
            }));
          }
        };
        probe.src = localUrl;
      }
    },
    [rect, setState, toContent, neuralGalleryFor, setView],
  );

  const onUploadBatchSettled = useCallback(
    (result: UploadBatchResult) => {
      if (stateRef.current.projCurrent === "all") return;
      const attempted = new Set(result.attemptedIndexes);
      const uploaded = new Map(result.uploaded.map((item) => [item.inputIndex, item]));
      const failed = new Set(result.failedIndexes);
      const linkFailed = new Set(result.projectLinkFailedIndexes);
      const errorClientIds = stateRef.current.uploadPreviews
        .filter((preview) =>
          preview.batchId === result.batchId &&
          attempted.has(preview.inputIndex) &&
          (failed.has(preview.inputIndex) ||
            linkFailed.has(preview.inputIndex) ||
            !uploaded.has(preview.inputIndex)),
        )
        .map((preview) => preview.clientId);
      for (const clientId of errorClientIds) {
        const url = objectUrlsRef.current.get(clientId);
        if (url) URL.revokeObjectURL(url);
        objectUrlsRef.current.delete(clientId);
      }
      setState((previous) => {
        const assetOverrides = { ...previous.galleryOverrides.asset };
        const uploadPreviews = previous.uploadPreviews.map((preview): CanvasUploadPreview => {
          if (preview.batchId !== result.batchId || !attempted.has(preview.inputIndex)) return preview;
          const uploadedFile = uploaded.get(preview.inputIndex);
          if (!uploadedFile || failed.has(preview.inputIndex)) {
            return { ...preview, localUrl: null, stage: "error", message: "Upload failed" };
          }
          const center = assetOverrides[preview.clientId] ?? preview.center;
          delete assetOverrides[preview.clientId];
          assetOverrides[uploadedFile.assetId] = center;
          const couldNotLink = linkFailed.has(preview.inputIndex);
          return {
            ...preview,
            assetId: uploadedFile.assetId,
            jobId: uploadedFile.jobId,
            center,
            localUrl: couldNotLink ? null : preview.localUrl,
            stage: couldNotLink ? "error" : "processing",
            message: couldNotLink ? "Uploaded, but couldn’t add to this project" : null,
          };
        });
        return {
          uploadPreviews,
          galleryOverrides: { ...previous.galleryOverrides, asset: assetOverrides },
          history: [],
          future: [],
        };
      });
    },
    [setState],
  );

  // ── Misc toolbar actions ────────────────────────────────────────────────

  const extractExif = useCallback(
    // EXIF is already read during ingest (worker) — this button never did work.
    // Tell the truth instead of faking a completion toast for a no-op.
    () => flashToast("EXIF is read automatically when files are imported"),
    [flashToast],
  );

  // ── Bulk AI ──────────────────────────────────────────────────────────────

  const toggleBulkCaptions = useCallback(
    () => setState({ bulkOps: { ...stateRef.current.bulkOps, captions: !stateRef.current.bulkOps.captions } }),
    [setState],
  );
  const toggleBulkTags = useCallback(
    () => setState({ bulkOps: { ...stateRef.current.bulkOps, tags: !stateRef.current.bulkOps.tags } }),
    [setState],
  );
  const toggleBulkLang = useCallback(
    (l: Language) => {
      const s = stateRef.current;
      const has = s.bulkLangs.includes(l);
      const next = has ? s.bulkLangs.filter((x) => x !== l) : [...s.bulkLangs, l];
      setState({ bulkLangs: next });
    },
    [setState],
  );
  const setBulkStyleAction = useCallback((st: CaptionStyle) => setState({ bulkStyle: st }), [setState]);

  const toggleBulkPanel = useCallback(() => {
    const s = stateRef.current;
    if (!s.selectedIds.length) {
      flashToast("Select files first");
      return;
    }
    setState({ bulkPanelOpen: !s.bulkPanelOpen });
  }, [setState, flashToast]);

  /** Run the panel's checked operations over the selection (spec §8.2, #12).
   *  Used to hardcode `type: "analyze"` and ignore every control in the panel
   *  it belongs to — the caption checkbox, language chips and style toggle all
   *  rendered above a button that could not act on them. */
  const runBulk = useCallback(() => {
    const s = stateRef.current;
    // Canvas selection when present; otherwise the source-browser selection —
    // with real data the sidebar is where multi-select lives (issue #12).
    const ids = (s.selectedIds.length ? s.selectedIds : s.sidebarSelectedIds).slice();
    void runAi(ids, s.bulkOps, s.bulkLangs, s.bulkStyle);
  }, [runAi]);

  /** Drawer/tile entry points name the op explicitly rather than inheriting the
   *  panel's checkboxes — a photo-level button must not change meaning because
   *  of a toggle the user set somewhere else. */

  useJobProgress(workspaceId, (job) => {
    if (job.type === "ingest") {
      if (job.status !== "done" && job.status !== "failed" && job.status !== "canceled") return;
      const terminalStatus = job.status;
      if (stateRef.current.terminalIngestJobs[job.id]) return;
      if (terminalStatus !== "done") {
        for (const preview of stateRef.current.uploadPreviews) {
          if (preview.jobId !== job.id) continue;
          const url = objectUrlsRef.current.get(preview.clientId);
          if (url) URL.revokeObjectURL(url);
          objectUrlsRef.current.delete(preview.clientId);
        }
      }
      setState((previous) => ({
        terminalIngestJobs: { ...previous.terminalIngestJobs, [job.id]: terminalStatus },
        ...(terminalStatus !== "done"
          ? { uploadPreviews: previous.uploadPreviews.map((preview) =>
            preview.jobId === job.id
              ? { ...preview, localUrl: null, stage: "error", message: (cloudErrorCopy(job.error) ?? job.error) ?? `Processing ${terminalStatus}` }
              : preview,
          ) }
          : {}),
      }));
      // #119: make a dropped file impossible to miss.
      // - Wholly-failed / canceled: the tile-error map above only reaches
      //   drag-drop uploads (they carry a jobId on their preview); cloud picks
      //   create no previews, so without a toast an all-failed Drive/Dropbox
      //   import would be completely silent. Toast the first-party copy.
      // - Partial 'done': some files landed, but the "N failed / N missing"
      //   the worker wrote to progress_label must surface too.
      if (terminalStatus !== "done") {
        flashToast(cloudErrorCopy(job.error) ?? "Some files couldn't be imported");
      } else if (/\b(failed|missing)\b/.test(job.progress_label ?? "")) {
        flashToast(job.progress_label ?? "Some files couldn't be imported");
      }
      router.refresh();
      return;
    }
    // A cluster job (ADR 0028) arrives two ways now. Enqueued by the analyze
    // tail it is not activeJobId, stays silent, and only refreshes on 'done' so
    // the stable semantic labels reach the Topic view this session — without
    // that, the user sees heuristic clouds until they navigate away and back.
    // Triggered by the user's own Re-cluster button (ADR 0038) it IS tracked,
    // and drives the same progress UI every other job does.
    if (job.type === "cluster") {
      const tracked = job.id === activeJobId.current;
      if (tracked && (job.status === "queued" || job.status === "running")) {
        setState({
          proc: {
            active: true,
            label: job.progress_label ?? "Regrouping topics…",
            pct: Math.max(5, job.progress),
          },
        });
      }
      if (job.status === "done" || job.status === "failed" || job.status === "canceled") {
        if (tracked) {
          activeJobId.current = null;
          setState({ proc: { active: false, label: "", pct: 0 }, aiBusyIds: [] });
          // Surface the worker's own words rather than inventing "Topics
          // regrouped": the sub-MIN_CLUSTER_ASSETS path also completes as
          // 'done', reporting "Too few analyzed assets to cluster (N)" — and
          // having just dropped the workspace's clusters, a cheerful success
          // toast there would be a lie.
          flashToast(
            job.status === "done"
              ? (job.progress_label ?? "Topics regrouped")
              : "Regrouping topics failed — try again",
          );
        }
        if (job.status === "done") router.refresh();
      }
      return;
    }
    // Edit jobs (ADR 0030) render fast — locally, no external API — so the
    // "done" broadcast can land BEFORE saveEdit even records activeJobId (unlike
    // the multi-second analyze/caption). Refresh on ANY edit completing (like
    // cluster), independent of activeJobId, so the swapped-in edited previews
    // appear without a manual reload; the tracked branch still drives the
    // progress bar + toast.
    if (job.type === "edit") {
      const tracked = job.id === activeJobId.current;
      if (job.status === "running" || job.status === "queued") {
        if (tracked) {
          setState({
            proc: { active: true, label: job.progress_label ?? "Rendering edit…", pct: Math.max(5, job.progress) },
          });
        }
        return;
      }
      if (tracked) {
        activeJobId.current = null;
        setState({ proc: { active: false, label: "", pct: 0 } });
        flashToast(
          job.status === "done"
            ? "Image edited"
            : `Edit ${job.status}${job.error ? ` — ${cloudErrorCopy(job.error) ?? job.error}` : ""}`,
        );
      }
      if (job.status === "done") router.refresh();
      return;
    }
    // Exports are followed by the dialog's own poll, not activeJobId — but if the
    // dialog is gone (tab reloaded mid-render, or the component unmounted) the
    // finished PDF had no way of reaching anyone: the jobId lived only in that
    // closure and there is no export history. The broadcast is workspace-scoped,
    // so it still arrives after a reload; turn it into a toast that can download.
    if (job.type === "export") {
      if (job.status !== "done" || stateRef.current.exportOpen) return;
      void (async () => {
        try {
          const r = await fetch(`/api/exports?jobId=${job.id}`);
          if (!r.ok) return;
          const { url } = (await r.json()) as { url: string | null };
          if (!url) return;
          flashToast("Your PDF is ready", { label: "Download", onAction: () => window.open(url, "_blank", "noopener") });
        } catch {
          // no toast beats a broken one
        }
      })();
      return;
    }
    if (job.id !== activeJobId.current) return;
    if (job.status === "running" || job.status === "queued") {
      setState({
        proc: {
          active: true,
          label: job.progress_label ?? "Analyzing…",
          pct: Math.max(5, job.progress),
        },
      });
      return;
    }
    activeJobId.current = null;

    // Second leg of an "analyze, then caption" run: the analyze that just
    // finished wrote the facts the caption prompt reads, so hand straight over
    // without dropping the selection or the progress bar.
    const followUp = followUpCaption.current;
    followUpCaption.current = null;
    if (followUp && job.status === "done" && job.type === "analyze") {
      router.refresh(); // tags/facts land now; captions follow
      setState({ proc: { active: true, label: "Writing captions…", pct: 5 } });
      void enqueueJob(
        { type: "caption", assetIds: followUp.assetIds, langs: followUp.langs, style: followUp.style },
        "Writing captions…",
        followUp.assetIds,
      ).then((ok) => {
        if (!ok) flashToast("Photos analyzed, but captions failed to start — try Regenerate");
      });
      return;
    }

    setState({
      proc: { active: false, label: "", pct: 0 },
      aiBusyIds: [],
      selectedIds: [],
      sidebarSelectedIds: [],
      bulkPanelOpen: false,
    });
    if (job.status === "done") {
      flashToast(
        job.type === "caption"
          ? `${job.total_items ?? 0} caption(s) generated`
          : `${job.total_items ?? 0} photo(s) analyzed`,
      );
      router.refresh(); // pulls fresh tags/facts/captions into the server payload
    } else {
      const verb = job.type === "caption" ? "Caption" : "Analyze";
      flashToast(`${verb} ${job.status}${job.error ? ` — ${cloudErrorCopy(job.error) ?? job.error}` : ""}`);
    }
  });

  // ── Lifecycle: listeners + initial fit ────────────────────────────────────

  const [canvasHeight, setCanvasHeight] = useState(700);
  // Mirrors DEFAULT_RECT.width — read during render (e.g. the minimap) instead
  // of calling rect()/canvasElRef.current directly, which the refs lint rule
  // forbids outside event handlers and effects.
  const [canvasWidth, setCanvasWidth] = useState(DEFAULT_RECT.width);

  const setCanvasRef = useCallback((el: HTMLDivElement | null) => {
    canvasElRef.current = el;
  }, []);

  // The AI panel is a mode over a selection, not a window of its own — so it
  // ends when the selection does. `bulkPanelOpen` used to latch: dismissing the
  // panel by clicking empty canvas cleared selectedIds (the panel disappeared,
  // because bulkShow ANDs the two) but left the flag true, so selecting any
  // next photo sprang the panel straight back open — the user clicked a tile
  // expecting its details and got the AI dialog. Covers every path that empties
  // the selection, not just clearSelection().
  useEffect(() => {
    if (state.bulkPanelOpen && state.selectedIds.length === 0) {
      setState({ bulkPanelOpen: false });
    }
  }, [state.bulkPanelOpen, state.selectedIds.length, setState]);

  useEffect(() => {
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    const el = canvasElRef.current;
    if (el) el.addEventListener("wheel", wheel, { passive: false });

    // Touch arbitration for the canvas, bound natively in the CAPTURE phase so
    // it sees a press before React's own handlers do — including presses on
    // tiles and cloud labels, which stopPropagation and so never reach the
    // canvas root's onPointerDown. That ordering is what lets a second finger
    // cancel an already-armed drag, and lets a double-tap or a hold take the
    // press away from the drag handlers entirely.
    const touch = touchRef.current;
    const onCaptureDown = (e: PointerEvent) => {
      const t = touch;
      // A primary pointer is by definition the start of a fresh gesture, so it
      // is also the moment to drop anything stale. Without this, a pointerup
      // the window never saw (mouse released outside the browser, a touch the
      // OS took for a system gesture) would leave a phantom finger in the map
      // and turn the NEXT single press into a two-pointer pinch.
      if (e.isPrimary) {
        clearTopicDropTarget();
        if (t.longPress) clearTimeout(t.longPress);
        t.pointers.clear();
        t.pinch = null;
        t.longPress = null;
        t.longPressAt = null;
        t.suppress = false;
        t.primary = null;
      }
      t.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (t.pointers.size === 1) {
        t.primary = e.pointerId;
        // Editable targets inside the canvas — the sticky-note body, the Topic
        // cloud's rename input — keep the platform's own hold gesture: on touch
        // that is how you place a caret and select a word, and stealing it for
        // the canvas menu would make those fields unusable.
        //
        // `[data-note-surface]` covers the note's RENDERED body, which is a plain
        // div (it only becomes a textarea once you tap into it) and would
        // otherwise fail all three checks below — so a hold anywhere on a note
        // would open the canvas menu on top of it. Matched with closest(),
        // because the press usually lands on a line or a checkbox inside it.
        const target = e.target as HTMLElement | null;
        const editable =
          !!target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable ||
            target.closest("[data-note-surface]") !== null);
        if (e.pointerType !== "mouse" && !editable) {
          // Hold = right-click. iOS Safari does not deliver a usable
          // `contextmenu` from a long press, so without this the menu — and
          // with it Paste, Ungroup and the whole layer order, which live
          // nowhere else — is unreachable on a tablet.
          t.longPressAt = { x: e.clientX, y: e.clientY };
          t.longPress = setTimeout(() => {
            const c = touchRef.current;
            c.longPress = null;
            if (c.pointers.size !== 1 || !c.longPressAt) return;
            c.suppress = true;
            dragRef.current = null;
            clearTopicDropTarget();
            setState({ marquee: null, frameDraftRect: null, panning: false });
            // targetId null: the menu acts on the selection, and the press that
            // started this hold has already selected whatever it landed on.
            openContextMenu(c.longPressAt.x, c.longPressAt.y, null);
          }, LONG_PRESS_MS);
        }
      } else if (t.pointers.size === 2) {
        if (t.longPress) {
          clearTimeout(t.longPress);
          t.longPress = null;
        }
        // Take the gesture away from whatever the first finger armed. Anything
        // it already moved stays where it is — undo covers a stray nudge, and
        // reverting here would fight the user's own correction.
        dragRef.current = null;
        clearTopicDropTarget();
        const s = stateRef.current;
        const [a, b] = Array.from(t.pointers.values());
        t.suppress = true;
        t.pinch = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
          scale: s.scale,
          tx: s.tx,
          ty: s.ty,
        };
        setState({ marquee: null, frameDraftRect: null, panning: false });
      }
    };
    if (el) el.addEventListener("pointerdown", onCaptureDown, true);
    let ro: ResizeObserver | undefined;
    const syncSize = () => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      setCanvasHeight(r.height || 700);
      setCanvasWidth(r.width || DEFAULT_RECT.width);
    };
    const raf = requestAnimationFrame(() => {
      tryFit();
      syncSize();
      if (el && typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => {
          tryFit();
          syncSize();
        });
        ro.observe(el);
      }
    });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (el) {
        el.removeEventListener("wheel", wheel);
        el.removeEventListener("pointerdown", onCaptureDown, true);
      }
      if (touch.longPress) clearTimeout(touch.longPress);
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
    };
    // Handlers are stable (useCallback with ref-backed reads); run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** One-time hand-off of notes written before ADR 0041 (localStorage) to the
   *  server. Runs only when this scope has NO server notes: the same stale blob
   *  sitting on a second device must not re-post what the first already
   *  uploaded, and an empty server side is the only honest evidence that these
   *  notes were never handed over. Nothing is deleted locally until every POST
   *  has succeeded, so a failure just means it retries on the next load. */
  const adoptLegacyNotes = useCallback(
    async (legacy: LegacyStickyNote[]) => {
      if (stateRef.current.stickyNotes.length > 0) return;
      const projectId = currentProjectId === "all" ? null : currentProjectId;
      const created: StickyNote[] = [];
      for (const old of legacy) {
        try {
          const res = await fetch("/api/annotations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: "note",
              projectId,
              x: old.x,
              y: old.y,
              w: old.w,
              h: old.h,
              color: LEGACY_NOTE_COLORS[old.color?.toLowerCase()] ?? "yellow",
              body: { text: old.text ?? "" },
              style: { fontSize: "m" },
            }),
          });
          if (!res.ok) return;
          created.push(annotationToNote(await res.json()));
        } catch {
          return;
        }
      }
      setState({ stickyNotes: created });
      try {
        const raw = localStorage.getItem(canvasStoreKey(currentProjectId));
        if (!raw) return;
        const blob = JSON.parse(raw) as PersistedCanvas;
        delete blob.stickyNotes;
        localStorage.setItem(canvasStoreKey(currentProjectId), JSON.stringify(blob));
      } catch {
        // The notes are on the server either way; a leftover key is harmless
        // because the guard above short-circuits once the scope is non-empty.
      }
    },
    [currentProjectId, setState],
  );

  // ── Persist canvas arrangement per project (ADR 0022) ──────────────────────
  // Load once on mount (before the rAF fit reads bounds), so tile drags, frames
  // and folder boxes are exactly where they were left. localStorage only — this
  // is UI state, never a backend concern.
  //
  // Sticky notes USED to ride along here and no longer do (ADR 0041): a note's
  // position is its content, not a view preference, so the whole note lives in
  // canvas_annotations and arrives via the Server Component. Notes saved by an
  // older build are still read below — once, to hand them to the server.
  useEffect(() => {
    // The clipboard is workspace-wide and outlives this mount, so it is read
    // back before the 'all'-scope guard below — Copy on the workspace canvas has
    // to survive the navigation into the project you mean to paste it into.
    try {
      const clip = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) ?? "[]") as string[];
      if (Array.isArray(clip) && clip.length > 0) setState({ clipboardCount: clip.length });
    } catch {
      // corrupt clipboard — Paste will report it as empty
    }
    if (currentProjectId === "all") return;
    try {
      const raw = localStorage.getItem(canvasStoreKey(currentProjectId));
      if (!raw) return;
      const saved = JSON.parse(raw) as PersistedCanvas;
      if (saved.v !== CANVAS_STORE_VERSION) return; // stale layout generation — start clean
      // `collapsed: false` is no longer reachable — the in-place expansion this
      // flag drove was replaced by the folder's dropdown, so nothing can clear it
      // again. A save from before that change can still carry it, and three
      // readers below still branch on it: folderHitRect would keep the old
      // expanded rect as a now-INVISIBLE drop target (tiles dropped anywhere in
      // it silently join the folder), foldedNeuralPos would leave the members on
      // the canvas beside the folder tile that stands in for them, and moveGroup
      // would drag them along. Normalise on load rather than bumping the store
      // version, which would throw away every project's arrangement.
      const groupGeom = Object.fromEntries(
        Object.entries(saved.groupGeom ?? {}).map(([id, g]) => [id, { ...g, collapsed: true }]),
      );
      setState({
        galleryOverrides: { ...EMPTY_GALLERY_OVERRIDES, ...(saved.galleryOverrides ?? {}) },
        frames: saved.frames ?? [],
        groupGeom,
        tileZ: saved.tileZ ?? {},
      });
      if (saved.stickyNotes?.length) void adoptLegacyNotes(saved.stickyNotes);
    } catch {
      // corrupt JSON or storage unavailable (private mode) — start clean
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced save whenever the arrangement changes — dragging fires overrides
  // on every pointermove, so a 400 ms debounce keeps writes off the drag path.
  useEffect(() => {
    if (currentProjectId === "all") return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(
          canvasStoreKey(currentProjectId),
          JSON.stringify({
            v: CANVAS_STORE_VERSION,
            galleryOverrides: state.galleryOverrides,
            frames: state.frames,
            groupGeom: state.groupGeom,
            tileZ: state.tileZ,
          } satisfies PersistedCanvas),
        );
      } catch {
        // over quota / unavailable — arrangement just won't persist this time
      }
    }, 400);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [currentProjectId, state.galleryOverrides, state.frames, state.groupGeom, state.tileZ]);

  // Flush the latest arrangement on unmount too, so navigating away right after
  // a drag (before the debounce fires) still saves it. Note text has its own
  // debounce against the server and is flushed here for the same reason —
  // closing the tab mid-sentence must not be how a note loses its last words.
  useEffect(() => {
    const timers = noteTextTimers.current;
    return () => {
      for (const id of [...timers.keys()]) flushNoteText(id);
      if (currentProjectId === "all") return;
      try {
        const s = stateRef.current;
        localStorage.setItem(
          canvasStoreKey(currentProjectId),
          JSON.stringify({
            v: CANVAS_STORE_VERSION,
            galleryOverrides: s.galleryOverrides,
            frames: s.frames,
            groupGeom: s.groupGeom,
            tileZ: s.tileZ,
          } satisfies PersistedCanvas),
        );
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+C / +V. A canvas that offers Copy only from a menu is a canvas
      // people will assume is broken, so both live on the keyboard too — but
      // never while typing, where they must stay the browser's own text
      // copy/paste, and never with a dialog open over the canvas.
      if ((e.metaKey || e.ctrlKey) && (e.key === "c" || e.key === "v")) {
        const t = e.target as HTMLElement | null;
        const isTyping = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
        const s = stateRef.current;
        if (isTyping || s.exportOpen) return;
        if (e.key === "c") {
          if (s.selectedIds.length === 0) return;
          e.preventDefault();
          copyFiles();
        } else {
          if (s.clipboardCount === 0) return;
          e.preventDefault();
          pasteFiles();
        }
        return;
      }
      // Colour labels on the number row: 1–7 apply, 0 clears. Bare digits, not
      // Cmd/Ctrl+digit — that combination switches browser tabs, so the macOS
      // shortcut cannot be copied here. Lightroom uses bare digits for exactly
      // this too. Selection-only: with nothing selected there is no target, and
      // a stray keypress must never silently paint the whole canvas.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key >= "0" && e.key <= "7" && e.key.length === 1) {
        const t = e.target as HTMLElement | null;
        const isTyping = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
        const s = stateRef.current;
        if (isTyping || s.exportOpen || s.editorId || s.selectedIds.length === 0) return;
        e.preventDefault();
        const index = Number(e.key);
        applyLabel(s.selectedIds, index === 0 ? null : ASSET_LABELS[index - 1]);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const target = e.target as HTMLElement | null;
        const isTyping = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
        const s = stateRef.current;
        // The export dialog operates on the selection, so a stray Backspace
        // there would trash the very photos being exported — and the route then
        // 404s with a generic error that gives no hint the keypress did it.
        if (s.exportOpen) return;
        if (!isTyping && s.selectedIds.length > 0) {
          e.preventDefault();
          // Same guardrail as the action bar: big selections confirm first —
          // a stray keypress with "select all" active must not empty a project.
          requestDeletePhotos(s.selectedIds);
        }
        return;
      }
      if (e.key !== "Escape") return;
      const s = stateRef.current;
      if (s.imp.open) return; // ImportModal owns Esc while open (upload-aware)
      if (s.exportOpen) return; // ExportDialog owns Esc while open (useDialog)
      // The label pickers are the shallowest thing on screen — Esc closes them
      // before it reaches the drawer or a panel underneath.
      if (s.labelMenuOpen) closeLabelMenu();
      else if (s.drawerId) closeDrawer();
      else if (s.helpOpen) closeHelp();
      else if (s.chatOpen) closeChat();
      else if (s.trashOpen) closeTrash();
      else if (s.sidebarTabs.length) closeSidebar();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    closeDrawer,
    closeHelp,
    closeChat,
    closeTrash,
    closeSidebar,
    requestDeletePhotos,
    copyFiles,
    pasteFiles,
    applyLabel,
    closeLabelMenu,
  ]);

  // Hold Space to pan (Figma/Miro/Photoshop): a transient mode layered over the
  // hand-tool path, so the selected tool is never mutated and simply resumes on
  // release. Ignore autorepeat and text-entry focus; preventDefault stops the
  // browser's page-scroll-on-space. A window blur clears it so a missed keyup
  // (alt-tab mid-hold) can't strand pan mode.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      // Space is preventDefault'ed for canvas pan, which also stops it
      // activating a focused button inside a modal dialog.
      if (stateRef.current.exportOpen) return;
      e.preventDefault();
      if (!stateRef.current.spacePan) setState({ spacePan: true });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && stateRef.current.spacePan) setState({ spacePan: false });
    };
    const onBlur = () => {
      if (stateRef.current.spacePan) setState({ spacePan: false });
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [setState]);

  useEffect(() => {
    const activeClientIds = new Set(state.uploadPreviews.map((preview) => preview.clientId));
    for (const [clientId, url] of objectUrlsRef.current) {
      if (activeClientIds.has(clientId)) continue;
      URL.revokeObjectURL(url);
      objectUrlsRef.current.delete(clientId);
    }
  }, [state.uploadPreviews]);

  useEffect(() => {
    const objectUrls = objectUrlsRef.current;
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      if (animTimer.current) clearTimeout(animTimer.current);
      if (topicDropRef.current.timer) clearTimeout(topicDropRef.current.timer);
      for (const url of objectUrls.values()) URL.revokeObjectURL(url);
      objectUrls.clear();
    };
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────

  const neuralGalleryPos = useMemo(
    () =>
      neuralGalleryFor(
        canvasPhotos(state.photos, state.boardScope),
        state.galleryOverrides,
        state.uploadPreviews,
      ).pos,
    [state.photos, state.boardScope, state.galleryOverrides, state.uploadPreviews, neuralGalleryFor],
  );

  // Folders (ADR 0034) hide their members while collapsed — the folder tile
  // stands in for them. Neural view only (folders don't touch Timeline/Topic/Map
  // in v1), so this post-processes the Canvas grid, not the cloud sorts.
  const foldedNeuralPos = useMemo(() => {
    const folders = state.groups.filter((g) => g.kind === "folder");
    if (folders.length === 0) return neuralGalleryPos;
    const pos = { ...neuralGalleryPos };
    for (const f of folders) {
      const geom = state.groupGeom[f.id] ?? defaultFolderGeom(f.id);
      if (geom.collapsed) for (const m of f.members) delete pos[m];
    }
    return pos;
  }, [neuralGalleryPos, state.groups, state.groupGeom]);

  // Render model for the FolderOverlay: resolved geometry + up-to-3 member thumbs.
  const folderModels = useMemo<FolderModel[]>(() => {
    const byId = new Map(state.photos.map((p) => [p.id, p]));
    return state.groups
      .filter((g) => g.kind === "folder")
      .map((g) => {
        const items = g.members
          .map((m) => byId.get(m))
          .filter((p): p is Photo => Boolean(p))
          .map((p) => ({ id: p.id, filename: p.filename, src: p.src }));
        return {
          id: g.id,
          name: g.name,
          count: g.members.length,
          previews: items.map((i) => i.src).filter((s): s is string => Boolean(s)).slice(0, 3),
          items,
          geom: state.groupGeom[g.id] ?? defaultFolderGeom(g.id),
        };
      });
  }, [state.groups, state.groupGeom, state.photos]);

  // How many tiles currently sit inside each frame (positional) — the header
  // badge + a guard for the "export/delete this artboard" actions. Frames are
  // few and photos ≤500, so the O(frames×photos) scan is cheap.
  const frameCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of state.frames) {
      let n = 0;
      for (const p of state.photos) {
        const t = neuralGalleryPos[p.id];
        if (t && t.cx >= f.x && t.cx <= f.x + f.w && t.cy >= f.y && t.cy <= f.y + f.h) n++;
      }
      counts[f.id] = n;
    }
    return counts;
  }, [state.frames, state.photos, neuralGalleryPos]);

  const selectedIds = useMemo(() => new Set(state.selectedIds), [state.selectedIds]);
  const aiBusyIds = useMemo(() => new Set(state.aiBusyIds), [state.aiBusyIds]);

  const marquee = state.marquee
    ? {
        show: true,
        left: Math.min(state.marquee.x0, state.marquee.x1),
        top: Math.min(state.marquee.y0, state.marquee.y1),
        width: Math.abs(state.marquee.x1 - state.marquee.x0),
        height: Math.abs(state.marquee.y1 - state.marquee.y0),
      }
    : { show: false, left: 0, top: 0, width: 0, height: 0 };

  const drawerPhoto = state.drawerId
    ? state.photos.find((p) => p.id === state.drawerId) ?? null
    : null;

  const editorPhoto = state.editorId
    ? state.photos.find((p) => p.id === state.editorId) ?? null
    : null;

  const isNeural = state.view === "neural";
  const isTimelineView = state.view === "timeline" && state.projCurrent !== "all";
  const isMapView = state.view === "map" && state.projCurrent !== "all";
  const isSenseView = state.view === "sense" && state.projCurrent !== "all";
  const showViewTabs = state.projCurrent !== "all";
  const allFilesMode = state.projCurrent === "all";
  const projectMode = !allFilesMode;
  // Selection + add-to-project work the same in every project view now, not just
  // Canvas — the views differ only in how tiles are sorted (ADR 0022).
  const showAddToProject = projectMode && selectedIds.size > 0;

  // The canvas contains only the current project's files, but Topic membership
  // is workspace-wide. Load the durable catalog so “Move to…” can also target a
  // cloud that happens to have no member in this project. If the additive
  // migration is still rolling out, visible canvas clouds remain a safe
  // fallback and the write route will report the unavailable feature.
  useEffect(() => {
    if (!isSenseView) return;
    const controller = new AbortController();
    let active = true;
    void fetch("/api/topics", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const parsed = topicsResponseSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("invalid topic catalog");
        if (active) setTopicCatalog(parsed.data.topics);
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          // Visible layout topics are merged below, so a transient catalog read
          // failure need not interrupt the canvas with a toast.
          setTopicCatalog([]);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [isSenseView, state.proc.active]);

  const projectPhotos = useMemo(
    () => filteredPhotos(state.photos),
    [state.photos, filteredPhotos],
  );

  /** What the canvas actually draws. Every layout above runs over
   *  `projectPhotos` (the full set) so a filter can never move a tile; this is
   *  the render list, and a tile it omits simply has no position to draw at. */
  const visiblePhotos = useMemo(
    () => filterByLabel(projectPhotos, state.labelFilter),
    [projectPhotos, state.labelFilter],
  );

  /** Upload previews minus the ones whose asset the filter is hiding. Without
   *  this, a file that finished ingesting while a filter was on would reappear
   *  as a "pending" tile: ProjectAssetView treats a preview as pending when its
   *  assetId is missing from the photo list it was given, and a filtered-out
   *  photo is exactly that. A preview with no assetId yet is still uploading and
   *  always shows. */
  const visiblePreviews = useMemo(() => {
    if (!state.labelFilter) return state.uploadPreviews;
    const visible = new Set(visiblePhotos.map((p) => p.id));
    const known = new Set(projectPhotos.map((p) => p.id));
    return state.uploadPreviews.filter(
      (preview) => !preview.assetId || visible.has(preview.assetId) || !known.has(preview.assetId),
    );
  }, [state.uploadPreviews, state.labelFilter, visiblePhotos, projectPhotos]);

  /** Per-colour tallies for the filter strip, over the photos on this canvas. */

  const projectList: ProjectListItem[] = useMemo(
    () =>
      initialProjects.map((p) => ({
        key: p.id,
        label: p.name,
        color: projectColor(p.id),
        count: p.count,
        active: state.projCurrent === p.id,
      })),
    [initialProjects, state.projCurrent],
  );

  const projLabel =
    state.projCurrent === "all" ? "Projects" : resolveProjectMeta(state.projCurrent, initialProjects).label;

  const sidebarOpen = state.sidebarTabs.length > 0;
  const sidebarSelectedIds = useMemo(() => new Set(state.sidebarSelectedIds), [state.sidebarSelectedIds]);

  // Each grouping layout is computed only while its view is active — the cloud
  // pack + tag-edge pass is the expensive part of a render, and running all
  // three on every photos/overrides/frames change tripled that cost for
  // nothing (only one decor layer can be on screen).
  const timelineLayoutResult = useMemo(
    () => (isTimelineView ? computeTimelineLayout(projectPhotos, state.galleryOverrides.timeline) : null),
    [isTimelineView, projectPhotos, state.galleryOverrides.timeline],
  );

  const topicLayoutResult = useMemo(
    () => (isSenseView ? computeTopicLayout(projectPhotos, state.galleryOverrides.topic, state.frames) : null),
    [isSenseView, projectPhotos, state.galleryOverrides.topic, state.frames],
  );

  // Also surfaces while a job runs — with sidebar-triggered analyzes the
  // panel is the progress indicator even without a canvas selection.
  // Canvas selection when present; otherwise the source-browser selection —
  // must stay in lockstep with runBulk, which reads the same pair.
  const bulkSelectedIds = state.selectedIds.length ? state.selectedIds : state.sidebarSelectedIds;
  const bulkShow = (state.bulkPanelOpen && selectedIds.size > 0) || state.proc.active;
  const bulkThumbs = useMemo(() => {
    const set = selectedIds;
    const sel = state.photos.filter((p) => set.has(p.id)).slice(0, 4);
    return sel.map((p, i) => ({ src: photoSrc(p, 60, 60), ml: i === 0 ? 0 : -9 }));
  }, [state.photos, selectedIds]);

  const frameDraft = state.frameDraftRect;

  // The active view's canonical-photo positions (Canvas grid or a cloud sort),
  // plus the cloud backdrop/edges/labels for the grouping views. Both drive one
  // persistent tile set so switching a sort just reflows the same tiles.
  // Map is excluded on purpose: it is no longer a cloud sort of the canvas
  // tiles but a real geographic map rendered over them (ADR 0027).
  const cloudDecor: CloudLayout | null = isTimelineView
    ? timelineLayoutResult
    : isSenseView
      ? topicLayoutResult
      : null;
  // Filter applied here and nowhere else on the render path: the layouts above
  // keep every tile's real coordinate, and what is hidden simply loses its
  // entry, so clearing the filter puts everything back exactly where it was.
  const activePositions = useMemo(
    () => visibleTilePositions(cloudDecor ? cloudDecor.tiles : foldedNeuralPos, projectPhotos, state.labelFilter),
    [cloudDecor, foldedNeuralPos, projectPhotos, state.labelFilter],
  );

  /** The decor the canvas draws. Under a label filter, a cloud with nothing
   *  visible left in it must not keep painting its name and backdrop over empty
   *  canvas, and the tag web goes too: half of every relation is hidden, so the
   *  lines that remained would assert connections to tiles that aren't there.
   *  `tiles` stays whole — dragging a cloud by its label still moves the cloud,
   *  including the members the filter is hiding. */
  const decor: CloudLayout | null = useMemo(() => {
    if (!cloudDecor || !state.labelFilter) return cloudDecor;
    const live = new Set<string>();
    for (const id of Object.keys(activePositions)) {
      const key = cloudDecor.tileCloud[id];
      if (key) live.add(key);
    }
    return { ...cloudDecor, clouds: cloudDecor.clouds.filter((c) => live.has(c.key)), edges: [] };
  }, [cloudDecor, state.labelFilter, activePositions]);

  const topicOptions = useMemo<TopicOption[]>(() => {
    const options = new Map<string, TopicOption>(
      topicCatalog.map((topic) => [
        topic.id,
        {
          id: topic.id,
          label: topic.label,
          manual: topic.origin === "manual",
        },
      ]),
    );
    for (const cloud of topicLayoutResult?.clouds ?? []) {
      if (!cloud.clusterId) continue;
      options.set(cloud.clusterId, {
        ...options.get(cloud.clusterId),
        id: cloud.clusterId,
        label: cloud.label,
        color: cloud.color,
      });
    }
    return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [topicCatalog, topicLayoutResult]);

  const selectedTopicId = useMemo(() => {
    if (state.selectedIds.length === 0) return null;
    const byId = new Map(state.photos.map((photo) => [photo.id, photo]));
    const first = byId.get(state.selectedIds[0])?.topicId ?? null;
    if (!first) return null;
    return state.selectedIds.every((id) => byId.get(id)?.topicId === first) ? first : null;
  }, [state.photos, state.selectedIds]);

  const canReturnSelectionToAi = useMemo(() => {
    if (state.selectedIds.length === 0) return false;
    const selected = new Set(state.selectedIds);
    return state.photos.some((photo) => selected.has(photo.id) && Boolean(photo.manualClusterId));
  }, [state.photos, state.selectedIds]);

  // Committed after every render so pointer-down handlers (onCloudLabelDown)
  // read the exact layout the canvas is showing instead of recomputing it.
  useEffect(() => {
    cloudDecorRef.current = decor;
  }, [decor]);

  // A focused cloud can disappear under the user (photo deleted, topics
  // re-derived on refresh, timeline day emptied, a filter hiding it). A key
  // that matches no current cloud must not dim the entire canvas — it reads as
  // no focus.
  const focusedCloudKey =
    state.focusedCloudKey && decor?.clouds.some((c) => c.key === state.focusedCloudKey)
      ? state.focusedCloudKey
      : null;

  const canUndo = state.history.length > 0;
  const canRedo = state.future.length > 0;

  const contentLeft = 20;
  const drawerRight = state.chatOpen ? 320 : 0;
  // Minimap has to clear every right-side panel, not just the chat: source
  // browser sidebar (380) and photo drawer (410) both live in the same slot.
  const sidebarOpenForMinimap = state.sidebarTabs.length > 0;
  const minimapRight =
    drawerRight +
    (sidebarOpenForMinimap ? 380 : 0) +
    (state.drawerId ? 410 : 0) +
    (state.trashOpen ? 360 : 0);

  // Minimap dots are derived from exactly what the canvas renders (ADR 0022):
  // the active view's canonical tile centers, plus any pending uploads (which
  // render at the neutral grid in every view). Using activePositions — the same
  // map ProjectAssetView draws — guarantees the minimap can't drift from the grid.
  const minimapPoints = useMemo(() => {
    const pts = Object.values(activePositions).map((t) => ({ x: t.cx, y: t.cy }));
    for (const preview of state.uploadPreviews) {
      const id = preview.assetId ?? preview.clientId;
      if (activePositions[id]) continue;
      const p = neuralGalleryPos[id];
      if (p) pts.push({ x: p.cx, y: p.cy });
    }
    return pts;
  }, [activePositions, state.uploadPreviews, neuralGalleryPos]);

  const minimap = useMemo(
    () =>
      computeMinimapLayout(minimapPoints, state.scale, state.tx, state.ty, {
        width: canvasWidth,
        height: canvasHeight,
      }),
    [minimapPoints, state.scale, state.tx, state.ty, canvasWidth, canvasHeight],
  );

  const onMinimapDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!minimap.show) return;
      const s = stateRef.current;
      const rectEl = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rectEl.left,
        my = e.clientY - rectEl.top;
      const cx = minimap.originX + (mx - minimap.offX) / minimap.mscale;
      const cy = minimap.originY + (my - minimap.offY) / minimap.mscale;
      const rr = rect();
      // Grab the viewport box in place (no jump); grab empty minimap space to
      // recenter there first, then track. Continuous panning is handled by the
      // window-level move() via this minimap drag session.
      const vpCenterX = (rr.width / 2 - s.tx) / s.scale;
      const vpCenterY = (rr.height / 2 - s.ty) / s.scale;
      const insideVp =
        mx >= minimap.vp.x &&
        mx <= minimap.vp.x + minimap.vp.w &&
        my >= minimap.vp.y &&
        my <= minimap.vp.y + minimap.vp.h;
      const grabDx = insideVp ? cx - vpCenterX : 0;
      const grabDy = insideVp ? cy - vpCenterY : 0;
      dragRef.current = {
        mode: "minimap",
        rectLeft: rectEl.left,
        rectTop: rectEl.top,
        originX: minimap.originX,
        originY: minimap.originY,
        offX: minimap.offX,
        offY: minimap.offY,
        mscale: minimap.mscale,
        grabDx,
        grabDy,
      };
      const targetX = cx - grabDx,
        targetY = cy - grabDy;
      setState({ tx: rr.width / 2 - targetX * s.scale, ty: rr.height / 2 - targetY * s.scale });
    },
    [minimap, rect, setState],
  );

  const zoomPct = Math.round(state.scale * 100) + "%";

  return {
    scale: state.scale,
    tx: state.tx,
    ty: state.ty,
    tool: state.tool,
    view: state.view,
    projCurrent: state.projCurrent,
    photos: state.photos,
    projectPhotos,
    uploadPreviews: state.uploadPreviews,
    projectAssetPositions: neuralGalleryPos,
    selectedIds,
    hoveredId: state.hoveredId,
    drawerId: state.drawerId,
    drawerLang: state.drawerLang,
    drawerStyle: state.drawerStyle,
    copyLabel: state.copyLabel,
    toast: state.toast,
    canvasWidth,
    galleryOverrides: state.galleryOverrides,
    gridSize: Math.max(4, 40 * state.scale),
    gridPos: `${state.tx}px ${state.ty}px`,
    gridOpacity: 1,
    zoomPct,
    canvasTransform: `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`,
    canvasCursor: state.panning
      ? "grabbing"
      : state.tool === "hand" || state.spacePan
        ? "grab"
        : "default",
    marquee,
    drawerPhoto,
    isNeural,
    isTimelineView,
    isMapView,
    isSenseView,
    showViewTabs,
    showAddToProject,
    allFilesMode,
    projectMode,
    setCanvasRef,
    onCanvasDown,
    onGalleryNodeDown,
    onTileDown,
    setHover,
    openDrawer,
    closeDrawer,
    navDrawer,
    deletePhoto,
    confirmDeleteCount: state.confirmDeleteIds?.length ?? 0,
    confirmDeleteNow,
    cancelConfirmDelete,
    deleteFromContext,
    editorOpen: state.editorId != null,
    editorPhoto,
    editBusy: state.proc.active,
    openEditor,
    closeEditor,
    saveEdit,
    resetEdit,
    setLang,
    setStyle,
    copyCap,
    regen,
    saveCaption,
    saveExif,
    revertExif,
    setFactStatus,
    genSingle,
    toolSelect,
    toolHand,
    toolFrame,
    onFit: doFitContent,
    onZoomReset: doFit,
    setView,

    frames: state.frames,
    frameDraft,
    frameCounts,
    deleteFrame,
    deleteFrameWithContent,
    renameFrame,
    selectFrame,
    exportFrame,
    beginFrameMove,
    beginFrameResize,
    frameGestureMove,
    endFrameGesture,

    folders: folderModels,
    openFolder,
    closeFolder,
    openFolderId: state.openFolderId,
    dropMemberOnCanvas,
    renameGroup,
    deleteGroup,
    moveGroup,

    deleteSelected,
    copyFiles,
    pasteFiles,
    clipboardCount: state.clipboardCount,
    exportFiles,
    openExportFor,
    exportOpen: state.exportOpen,
    exportIds: state.exportIds,
    closeExport,
    groupFiles,
    ungroupSelection,
    selectionHasGroup,
    bringToFront,
    bringForward,
    sendBackward,
    sendToBack,
    tileZ: state.tileZ,
    folderFiles,
    tidyUp,
    regroupClouds,
    canRegroup:
      (isSenseView && Object.keys(state.galleryOverrides.topic).length > 0) ||
      (isTimelineView && Object.keys(state.galleryOverrides.timeline).length > 0),
    recluster,
    renameCloud,
    topicOptions,
    selectedTopicId,
    canReturnSelectionToAi,
    topicMutationBusy,
    moveSelectionToTopic,
    createTopicFromSelection,
    returnSelectionToAi,
    topicDropTargetKey,
    addToNewArtboard,
    addToExistingArtboard,

    contextMenu,
    openContextMenu,
    closeContextMenu,

    stickyNotes: state.stickyNotes,
    addStickyNote,
    onStickyDown,
    onStickyResizeDown,
    setStickyColor,
    setStickyFontSize,
    toggleStickyCheck,
    setStickyStrokes,
    updateStickyText,
    deleteStickyNote,

    canUndo,
    canRedo,
    undo,
    redo,

    zoomMenuOpen: state.zoomMenuOpen,
    toggleZoomMenu,
    closeZoomMenu,
    setZoomPct,

    minimap,
    onMinimapDown,

    contentLeft,
    drawerRight,
    minimapRight,

    extractExif,

    chatOpen: state.chatOpen,
    chatMsgs: state.chatMsgs,
    chatInput: state.chatInput,
    toggleChat,
    closeChat,
    sendChat,
    selectSearchResults,
    onChatInput,
    onChatKey,

    acctOpen: state.acctOpen,
    projOpen: state.projOpen,
    projLabel,
    projectList,
    openAcct,
    closeAcct,
    openProj,
    closeProj,
    selectProject,
    goHome,

    addProjOpen: state.addProjOpen,
    toggleAddProj,
    closeAddProj,
    addToProject,
    createNewProject,

    sidebarOpen,
    sidebarTabs: state.sidebarTabs,
    sidebarActiveTab: state.sidebarActiveTab,
    sidebarSelectedIds,
    sidebarSearchText: state.sidebarSearchText,
    sidebarAddOpen: state.sidebarAddOpen,
    openSourceTab,
    closeSourceTab,
    setSidebarActiveTab,
    closeSidebar,
    toggleSidebarFile,
    toggleSidebarGroup,
    setSidebarSearch,
    toggleSidebarAddOpen,
    closeSidebarAddOpen,
    sidebarAddToProject,
    sidebarCreateProject,
    sidebarViewMode: state.sidebarViewMode,
    setSidebarViewMode,


    helpOpen: state.helpOpen,
    openHelp,
    closeHelp,

    impOpen: state.imp.open,
    addToolbar,
    closeImport,
    onUploadBatchStart,
    onUploadBatchSettled,

    trashOpen: state.trashOpen,
    trashAssets: state.trashAssets,
    openTrash,
    closeTrash,
    toggleTrash,
    restoreFromTrash,
    purgeFromTrash,

    activePositions,
    cloudDecor: decor,
    tilesAnimating: state.tilesAnimating,
    focusedCloudKey,
    tileCloud: decor?.tileCloud ?? EMPTY_TILE_CLOUD,
    onCloudLabelDown,

    labelNames: state.labelNames,
    labelFilter: state.labelFilter,
    labelMenuOpen: state.labelMenuOpen,
    setLabelFilter,
    clearLabelFilter,
    toggleLabelMenu,
    closeLabelMenu,
    labelSelection,
    labelOne,
    renameLabel,
    visiblePhotos,
    visiblePreviews,

    bulkPanelOpen: state.bulkPanelOpen,
    toggleBulkPanel,
    bulkShow,
    bulkIdle: !state.proc.active,
    bulkSelectedIds,
    bulkThumbs,
    bulkOps: state.bulkOps,
    bulkLangs: state.bulkLangs,
    bulkStyle: state.bulkStyle,
    proc: state.proc,
    aiBusyIds,
    toggleBulkCaptions,
    toggleBulkTags,
    toggleBulkLang,
    setBulkStyle: setBulkStyleAction,
    clearSelection,
    runBulk,
    analyzePhoto,

    flashToast,
  };
}
