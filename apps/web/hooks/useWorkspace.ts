"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { navProgressStart } from "@/components/nav/TopProgressBar";
import { useJobProgress } from "@/hooks/useJobProgress";
import { CAPTION_LANG_DB, CAPTION_STYLE_DB, getCaptionRow } from "@/lib/format";
import { photoSrc } from "@/lib/img";
import type {
  CaptionStyle,
  CanvasPoint,
  CanvasUploadPreview,
  ChatMessage,
  ChatResult,
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
  assetGallery,
  centerAtScale,
  droppedAssetCenters,
  EMPTY_GALLERY_OVERRIDES,
  hitTestTiles,
  mapCloudLayout as computeMapLayout,
  minimapLayout as computeMinimapLayout,
  STICKY_NOTE_COLORS,
  timelineCloudLayout as computeTimelineLayout,
  topicCloudLayout as computeTopicLayout,
  type Bounds,
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

const DEFAULT_ZOOM = 0.75;
const PROJECT_COLORS = ["#5b9bff", "#ff7a5c", "#4fd1c5", "#c084fc", "#ffd166", "#39ff6a"];

/** Per-project canvas arrangement (tile drags, frames, sticky notes) is kept in
 *  localStorage so it survives leaving and re-opening the project (edit #2).
 *  Positions are UI-only, so the browser is the right home — no backend/schema. */
const CANVAS_STORE_PREFIX = "archivemind:canvas:";
const canvasStoreKey = (projectId: string) => `${CANVAS_STORE_PREFIX}${projectId}`;

interface PersistedCanvas {
  galleryOverrides?: Partial<GalleryOverrides>;
  frames?: Frame[];
  stickyNotes?: StickyNote[];
}

export type SidebarViewMode = "pile" | "list" | "gallery";

/** A real project (issue #17), fetched server-side and threaded into the
 * canvas for the header dropdown, add-to-project popovers, and labels. */
export interface ProjectOption {
  id: string;
  name: string;
  count: number;
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

interface BulkOps {
  captions: boolean;
  tags: boolean;
  faces: boolean;
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
  search: boolean;
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
  drawerLang: Language;
  drawerStyle: CaptionStyle;
  copyLabel: string;
  bulkOps: BulkOps;
  bulkLangs: string[];
  bulkStyle: CaptionStyle;
  bulkPanelOpen: boolean;
  proc: ProcState;
  toast: { show: boolean; text: string };
  /** True while a canvas pan drag is active (drives the grabbing cursor). */
  panning: boolean;
  frames: Frame[];
  stickyNotes: StickyNote[];
  /** Content-space preview rect while the frame tool is actively drawing. */
  frameDraftRect: { x: number; y: number; w: number; h: number } | null;
  history: Snapshot[];
  future: Snapshot[];
  zoomMenuOpen: boolean;
  /** True briefly after a view/sort switch, while every tile reflows to its new
   *  position and the viewport re-fits — gates the CSS glide (never on during
   *  drag/pan, which must stay 1:1 with the pointer). */
  tilesAnimating: boolean;
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
      mode: "frameDraw";
      startContent: { x: number; y: number };
      endContent: { x: number; y: number };
      dx0: number;
      dy0: number;
      x1: number;
      y1: number;
      moved: boolean;
    }
  | null;

const DEFAULT_RECT = { left: 0, top: 0, width: 1000, height: 700 };
export interface ProjectListItem {
  key: ProjectKey;
  label: string;
  color: string;
  count: number;
  active: boolean;
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

export interface Workspace {
  scale: number;
  tx: number;
  ty: number;
  tool: Tool;
  view: ViewMode;
  projCurrent: ProjectKey | "all";
  photos: Photo[];
  projectPhotos: Photo[];
  uploadPreviews: CanvasUploadPreview[];
  projectAssetPositions: Record<string, TilePos>;
  selectedIds: Set<string>;
  hoveredId: string | null;
  drawerId: string | null;
  drawerLang: Language;
  drawerStyle: CaptionStyle;
  copyLabel: string;
  toast: { show: boolean; text: string };
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
  setLang: (l: Language) => void;
  setStyle: (s: CaptionStyle) => void;
  copyCap: () => void;
  regen: () => void;
  saveCaption: (text: string) => void;
  genSingle: (id: string) => void;
  toolSelect: () => void;
  toolHand: () => void;
  toolFrame: () => void;
  onFit: () => void;
  onZoomReset: () => void;
  setView: (v: ViewMode) => void;

  // Frames (Figma-style canvas regions)
  frames: Frame[];
  frameDraft: { x: number; y: number; w: number; h: number } | null;
  deleteFrame: (id: string) => void;
  renameFrame: (id: string, label: string) => void;

  // Sticky notes
  stickyNotes: StickyNote[];
  addStickyNote: () => void;
  onStickyDown: (e: React.PointerEvent, id: string, orig: { x: number; y: number }) => void;
  updateStickyText: (id: string, text: string) => void;
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

  // Search
  search: boolean;
  openSearch: () => void;
  closeSearch: () => void;

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

  // Grouping views (Timeline / Map / Topic) are the same canvas as Canvas, just
  // sorted — `activePositions` is the current view's tile layout and `cloudDecor`
  // is its backdrop/edges/labels (null on the unsorted Canvas). `tilesAnimating`
  // gates the reflow glide when a sort changes (ADR 0022).
  activePositions: Record<string, TilePos>;
  cloudDecor: CloudLayout | null;
  tilesAnimating: boolean;

  // Bulk AI
  bulkPanelOpen: boolean;
  toggleBulkPanel: () => void;
  bulkShow: boolean;
  bulkIdle: boolean;
  bulkCount: number;
  bulkThumbs: { src: string; ml: number }[];
  bulkOps: BulkOps;
  bulkLangs: string[];
  bulkStyle: CaptionStyle;
  proc: ProcState;
  toggleBulkCaptions: () => void;
  toggleBulkTags: () => void;
  toggleBulkFaces: () => void;
  toggleBulkLang: (l: string) => void;
  setBulkStyle: (s: CaptionStyle) => void;
  clearSelection: () => void;
  runBulk: () => void;

  flashToast: (text: string) => void;
}

export function useWorkspace(
  initialPhotos: Photo[],
  workspaceId: string,
  initialProjects: ProjectOption[],
  currentProjectId: string,
): Workspace {
  const router = useRouter();
  const [state, setStateRaw] = useState<WorkspaceState>({
    // Start at the 75% default so the first paint matches every view's fit,
    // even in the brief window before tryFit centers on the real content (edit #3).
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
    search: false,
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
    drawerLang: "EN",
    drawerStyle: "Agency",
    copyLabel: "Copy",
    bulkOps: { captions: true, tags: true, faces: false },
    bulkLangs: ["EN"],
    bulkStyle: "Agency",
    bulkPanelOpen: false,
    proc: { active: false, label: "", pct: 0 },
    toast: { show: false, text: "" },
    panning: false,
    frames: [],
    stickyNotes: [],
    frameDraftRect: null,
    history: [],
    future: [],
    zoomMenuOpen: false,
    tilesAnimating: false,
  });

  // Mirror of committed state, kept current for window-level event handlers.
  const stateRef = useRef(state);
  const dragRef = useRef<DragSession>(null);
  const canvasElRef = useRef<HTMLDivElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeJobId = useRef<string | null>(null);
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

  const flashToast = useCallback(
    (text: string) => {
      setState({ toast: { show: true, text } });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(
        () => setState({ toast: { show: false, text: "" } }),
        3200,
      );
    },
    [setState],
  );

  // Real data is already scoped by the route (getPhotos(projectId)), so the
  // canvas shows every photo the server returned — no client-side project filter.
  const filteredPhotos = useCallback((photos: Photo[]) => photos, []);

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
    const s = stateRef.current;
    if (!s.history.length) return;
    const hist = s.history.slice();
    const prev = hist.pop() as Snapshot;
    const future = s.future.slice();
    future.push(snapshot(s));
    setState({ ...prev, history: hist, future });
  }, [setState, snapshot]);

  const redo = useCallback(() => {
    const s = stateRef.current;
    if (!s.future.length) return;
    const future = s.future.slice();
    const next = future.pop() as Snapshot;
    const hist = s.history.slice();
    hist.push(snapshot(s));
    setState({ ...next, history: hist, future });
  }, [setState, snapshot]);

  /** Canonical-photo tile positions for whichever view is active — the single
   *  source both the renderer and marquee hit-testing read, so selection and
   *  tile layout stay identical across Canvas / Timeline / Map / Topic. */
  const activeTilePositions = useCallback(
    (s: WorkspaceState): Record<string, TilePos> => {
      if (s.view === "timeline") return computeTimelineLayout(s.photos, s.galleryOverrides.timeline, s.frames).tiles;
      if (s.view === "map") return computeMapLayout(s.photos, s.galleryOverrides.map, s.frames).tiles;
      if (s.view === "sense") return computeTopicLayout(s.photos, s.galleryOverrides.topic, s.frames).tiles;
      return assetGallery(projectCanvasItems(s.photos, s.uploadPreviews), s.galleryOverrides.asset).pos;
    },
    [],
  );

  // ── Pan / zoom ────────────────────────────────────────────────────────────

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

  const onCanvasDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const s = stateRef.current;
      const patch: Partial<WorkspaceState> = {};
      if (s.imp.open) patch.imp = { open: false };
      if (s.acctOpen) patch.acctOpen = false;
      if (s.projOpen) patch.projOpen = false;
      if (Object.keys(patch).length) setState(patch);
      const r = rect();
      // Every view behaves like Canvas now (ADR 0022): the frame and select
      // (marquee) tools work in all four, and only the hand tool pans on a
      // background drag. Marquee hit-tests against the active view's own tile
      // positions so it selects whatever is on screen, sorted or not.
      if (s.tool === "frame") {
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
      } else if (s.tool === "hand") {
        dragRef.current = {
          mode: "pan",
          sx: e.clientX,
          sy: e.clientY,
          otx: s.tx,
          oty: s.ty,
        };
        setState({ panning: true });
      } else {
        const c = toContent(e.clientX, e.clientY);
        const dx0 = e.clientX - r.left,
          dy0 = e.clientY - r.top;
        dragRef.current = {
          mode: "marquee",
          startContent: c,
          dx0,
          dy0,
          x1: dx0,
          y1: dy0,
          moved: false,
          assetPositions: activeTilePositions(s),
          initialSelection: s.selectedIds,
          additive: e.shiftKey || e.metaKey || e.ctrlKey,
        };
        setState({ marquee: { x0: dx0, y0: dy0, x1: dx0, y1: dy0 } });
      }
    },
    [rect, toContent, setState, activeTilePositions],
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
      };
    },
    [pushHistory],
  );

  /** Shared by Canvas asset tiles and Map/Topic cloud tiles — select-on-down
   *  (with the same additive/shift-click semantics), then a free-position
   *  drag session keyed to whichever override bucket `kind` names. */
  const onGalleryAssetDown = useCallback(
    (kind: "asset" | "map" | "topic" | "timeline", e: React.PointerEvent, id: string, origCenter: CanvasPoint) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const s = stateRef.current;
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      let selectedIds: string[];
      if (additive) {
        const selection = new Set(s.selectedIds);
        if (selection.has(id)) selection.delete(id);
        else selection.add(id);
        selectedIds = Array.from(selection);
      } else {
        selectedIds = s.selectedIds.includes(id) ? s.selectedIds : [id];
      }
      setState({ selectedIds, drawerId: null });
      dragRef.current = {
        mode: "gallery",
        kind,
        key: id,
        sx: e.clientX,
        sy: e.clientY,
        orig: origCenter,
        moved: false,
        historyPushed: false,
      };
    },
    [setState],
  );
  /** One tile-drag entry point for every view — routes to the override bucket
   *  that matches the active sort, so a tile stays where you drop it within the
   *  view you dropped it in (and Canvas keeps its own unsorted positions). */
  const onTileDown = useCallback(
    (e: React.PointerEvent, id: string, origCenter: CanvasPoint) => {
      const v = stateRef.current.view;
      const kind = v === "timeline" ? "timeline" : v === "map" ? "map" : v === "sense" ? "topic" : "asset";
      onGalleryAssetDown(kind, e, id, origCenter);
    },
    [onGalleryAssetDown],
  );

  const onStickyDown = useCallback(
    (e: React.PointerEvent, id: string, orig: { x: number; y: number }) => {
      e.stopPropagation();
      pushHistory();
      dragRef.current = { mode: "sticky", id, sx: e.clientX, sy: e.clientY, orig, moved: false };
    },
    [pushHistory],
  );

  const addStickyNote = useCallback(() => {
    const s = stateRef.current;
    const r = rect();
    const cx = (r.width / 2 - s.tx) / s.scale;
    const cy = (r.height / 2 - s.ty) / s.scale;
    const w = 180,
      h = 160;
    const note: StickyNote = {
      id: "note" + Date.now(),
      x: cx - w / 2,
      y: cy - h / 2,
      w,
      h,
      text: "",
      color: STICKY_NOTE_COLORS[s.stickyNotes.length % STICKY_NOTE_COLORS.length],
    };
    pushHistory();
    setState({ stickyNotes: [...s.stickyNotes, note] });
  }, [rect, pushHistory, setState]);

  const updateStickyText = useCallback(
    (id: string, text: string) => {
      setState({ stickyNotes: stateRef.current.stickyNotes.map((n) => (n.id === id ? { ...n, text } : n)) });
    },
    [setState],
  );

  const deleteStickyNote = useCallback(
    (id: string) => {
      pushHistory();
      setState({ stickyNotes: stateRef.current.stickyNotes.filter((n) => n.id !== id) });
    },
    [pushHistory, setState],
  );

  const move = useCallback(
    (e: PointerEvent) => {
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
        setState({
          galleryOverrides: {
            ...s.galleryOverrides,
            [d.kind]: { ...s.galleryOverrides[d.kind], [d.key]: { x: d.orig.x + dx, y: d.orig.y + dy } },
          },
        });
      } else if (d.mode === "sticky") {
        if (Math.abs(e.clientX - d.sx) > 2 || Math.abs(e.clientY - d.sy) > 2) d.moved = true;
        const dx = (e.clientX - d.sx) / s.scale,
          dy = (e.clientY - d.sy) / s.scale;
        setState({
          stickyNotes: s.stickyNotes.map((n) =>
            n.id === d.id ? { ...n, x: d.orig.x + dx, y: d.orig.y + dy } : n,
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
          selectedIds: selection,
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
      }
    },
    [rect, toContent, setState, pushHistory],
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

  const up = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (d.mode === "pan") {
      setState({ panning: false });
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
    }
  }, [setState, pushHistory]);

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

  const copyCap = useCallback(() => {
    setState({ copyLabel: "Copied" });
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setState({ copyLabel: "Copy" }), 1400);
  }, [setState]);

  /** Regenerate the visible caption (drawer lang × style) via a real caption
   *  job (#14). An edited caption asks first, then clears is_edited — the
   *  worker skips edited units otherwise. */
  const regen = useCallback(async () => {
    const s = stateRef.current;
    const photo = s.photos.find((p) => p.id === s.drawerId);
    if (!photo || activeJobId.current) return;
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
    setState({ proc: { active: true, label: "Queueing caption…", pct: 3 } });
    try {
      const resp = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "caption",
          assetIds: [photo.id],
          langs: [CAPTION_LANG_DB[s.drawerLang]],
          style: CAPTION_STYLE_DB[s.drawerStyle],
        }),
      });
      if (!resp.ok) throw new Error(String(resp.status));
      const { jobId } = (await resp.json()) as { jobId: string };
      activeJobId.current = jobId;
      setState({ proc: { active: true, label: "Waiting for worker…", pct: 5 } });
    } catch {
      setState({ proc: { active: false, label: "", pct: 0 } });
      flashToast("Caption failed to start — try again");
    }
  }, [setState, flashToast]);

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

  /** Real soft-delete (spec §12: user delete → assets.status='deleted'; R2
   *  derivatives purge is a background job, not this request). Optimistic —
   *  removes the tile immediately and reconciles from the server on failure. */
  const deletePhoto = useCallback(
    (id: string) => {
      // Functional update so deleting a multi-selection (a forEach of these in
      // one tick) composes instead of each call clobbering the last — otherwise
      // only one file would actually disappear per keypress.
      setState((prev) => ({
        photos: prev.photos.filter((p) => p.id !== id),
        selectedIds: prev.selectedIds.filter((x) => x !== id),
        drawerId: prev.drawerId === id ? null : prev.drawerId,
      }));
      fetch(`/api/assets/${id}`, { method: "DELETE" })
        .then((resp) => {
          if (!resp.ok) throw new Error(String(resp.status));
        })
        .catch(() => {
          flashToast("Could not delete — try again");
          router.refresh();
        });
    },
    [setState, flashToast, router],
  );

  /** Drawer's single-photo Analyze — a REAL analyze job. This was the last
   *  mock stamp left from the mockup (#59 fixed only the bulk path): it
   *  painted fake tags/facts/processed client-side without ever enqueueing,
   *  so photos looked analyzed while search had no embedding to find. Real
   *  tags/facts land via the job's Broadcast → router.refresh. */
  const genSingle = useCallback(
    async (id: string) => {
      if (activeJobId.current) return;
      setState({ proc: { active: true, label: "Queueing analyze…", pct: 3 } });
      try {
        const resp = await fetch("/api/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "analyze", assetIds: [id] }),
        });
        if (!resp.ok) throw new Error(String(resp.status));
        const { jobId } = (await resp.json()) as { jobId: string };
        activeJobId.current = jobId;
        setState({ proc: { active: true, label: "Waiting for worker…", pct: 5 } });
      } catch {
        setState({ proc: { active: false, label: "", pct: 0 } });
        flashToast("Analyze failed to start — try again");
      }
    },
    [setState, flashToast],
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
   *  the same default zoom across Canvas / Timeline / Map / Topic (edit #3), so
   *  a big archive no longer shrinks to 40–60% on one view and 75% on another.
   *  Content larger than the viewport at 75% simply overflows and pans. */
  const fitDefaultZoom = useCallback((bounds: Bounds, r: Rect) => centerAtScale(bounds, r, DEFAULT_ZOOM), []);

  const computeFit = useCallback(
    (
      view: ViewMode,
      allPhotos: Photo[],
      overrides: GalleryOverrides,
      previews: CanvasUploadPreview[],
    ) => {
      const r = rect();
      const frames = stateRef.current.frames;
      if (view === "neural") {
        const bounds = neuralGalleryFor(allPhotos, overrides, previews).bounds;
        return fitDefaultZoom(bounds, r);
      }
      if (view === "map") return fitDefaultZoom(computeMapLayout(allPhotos, overrides.map, frames).bounds, r);
      if (view === "sense") return fitDefaultZoom(computeTopicLayout(allPhotos, overrides.topic, frames).bounds, r);
      return fitDefaultZoom(computeTimelineLayout(allPhotos, overrides.timeline, frames).bounds, r);
    },
    [rect, neuralGalleryFor, fitDefaultZoom],
  );

  const doFit = useCallback(() => {
    const s = stateRef.current;
    setState(computeFit(s.view, s.photos, s.galleryOverrides, s.uploadPreviews));
  }, [setState, computeFit]);

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
        // View changes retire the right-side source browser so it cannot
        // overlap the AI chat panel that lives in the same slot.
        sidebarTabs: [],
        sidebarActiveTab: null,
        sidebarSelectedIds: [],
        sidebarSearchText: "",
        sidebarAddOpen: false,
        ...computeFit(v, s.photos, s.galleryOverrides, s.uploadPreviews),
      });
      if (animTimer.current) clearTimeout(animTimer.current);
      animTimer.current = setTimeout(() => setState({ tilesAnimating: false }), 470);
    },
    [setState, computeFit],
  );

  // Fit once on first mount, but only after the canvas has a real size — a
  // zero-size rect (background tab / not-yet-painted) would produce a bad fit.
  // Small canvases start at 75%; large project grids use a true fit so every
  // tile remains reachable without an initial manual zoom-out.
  const didFitRef = useRef(false);
  const tryFit = useCallback(() => {
    if (didFitRef.current) return true;
    const r = rect();
    if (r.width > 0 && r.height > 0) {
      const s = stateRef.current;
      const bounds = neuralGalleryFor(s.photos, s.galleryOverrides, s.uploadPreviews).bounds;
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
            matchedTags: r.matchedTags,
            matchedPlace: r.matchedPlace,
          };
        });

        const filters: string[] = [];
        if (data.parsed.date_from || data.parsed.date_to)
          filters.push(`dates ${data.parsed.date_from ?? "…"} – ${data.parsed.date_to ?? "…"}`);
        if (data.parsed.place_terms.length) filters.push(`place: ${data.parsed.place_terms.join(", ")}`);
        if (data.parsed.tag_terms.length) filters.push(`tags: ${data.parsed.tag_terms.join(", ")}`);
        const filterNote = filters.length ? ` (filters — ${filters.join("; ")})` : "";

        patchLastChatMsg(
          results.length
            ? `Found ${results.length} photo(s)${filterNote}. Tap a thumb to open it, or select them all on the canvas.`
            : `No matches${filterNote}. Only analyzed photos are searchable — run "Analyze with AI" first, or try different wording.`,
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

  const openSearch = useCallback(() => setState({ search: true }), [setState]);
  const closeSearch = useCallback(() => setState({ search: false }), [setState]);
  const openHelp = useCallback(() => setState({ helpOpen: true }), [setState]);
  const closeHelp = useCallback(() => setState({ helpOpen: false }), [setState]);

  // ── Import ───────────────────────────────────────────────────────────────

  const addToolbar = useCallback(() => {
    setState({ imp: { open: !stateRef.current.imp.open } });
  }, [setState]);
  const closeImport = useCallback(() => setState({ imp: { open: false } }), [setState]);

  const onUploadBatchStart = useCallback(
    (batch: UploadBatchStart) => {
      const s = stateRef.current;
      if (s.projCurrent === "all") return;
      const r = rect();
      const clientPoint = batch.clientPoint ?? {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
      };
      const anchor = toContent(clientPoint.x, clientPoint.y);
      const clientIds = batch.files.map((item) => `${batch.batchId}:${item.inputIndex}`);
      const centers = droppedAssetCenters(clientIds, anchor);
      const previews = batch.files.map((item): CanvasUploadPreview => {
        const clientId = `${batch.batchId}:${item.inputIndex}`;
        const localUrl = canPreviewLocally(item.file) ? URL.createObjectURL(item.file) : null;
        if (localUrl) objectUrlsRef.current.set(clientId, localUrl);
        return {
          clientId,
          batchId: batch.batchId,
          inputIndex: item.inputIndex,
          assetId: null,
          jobId: null,
          filename: item.file.name,
          mime: item.file.type || "application/octet-stream",
          localUrl,
          center: centers[clientId],
          width: 4,
          height: 3,
          stage: "uploading",
          message: null,
        };
      });
      setState((previous) => ({
        uploadPreviews: [...previous.uploadPreviews, ...previews],
        galleryOverrides: {
          ...previous.galleryOverrides,
          asset: { ...previous.galleryOverrides.asset, ...centers },
        },
      }));
    },
    [rect, setState, toContent],
  );

  const onUploadBatchSettled = useCallback(
    (result: UploadBatchResult) => {
      if (stateRef.current.projCurrent === "all") return;
      const uploaded = new Map(result.uploaded.map((item) => [item.inputIndex, item.assetId]));
      const failed = new Set(result.failedIndexes);
      const linkFailed = result.projectLink === "failed";
      const errorClientIds = stateRef.current.uploadPreviews
        .filter((preview) =>
          preview.batchId === result.batchId &&
          (linkFailed || !uploaded.has(preview.inputIndex) || failed.has(preview.inputIndex)),
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
          if (preview.batchId !== result.batchId) return preview;
          const assetId = uploaded.get(preview.inputIndex);
          if (!assetId || failed.has(preview.inputIndex)) {
            return { ...preview, localUrl: null, stage: "error", message: "Upload failed" };
          }
          const center = assetOverrides[preview.clientId] ?? preview.center;
          delete assetOverrides[preview.clientId];
          assetOverrides[assetId] = center;
          return {
            ...preview,
            assetId,
            jobId: result.jobId,
            center,
            localUrl: linkFailed ? null : preview.localUrl,
            stage: linkFailed ? "error" : "processing",
            message: linkFailed ? "Uploaded, but couldn’t add to this project" : null,
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
    () => flashToast(`EXIF extracted for ${stateRef.current.photos.length} files`),
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
  const toggleBulkFaces = useCallback(
    () => setState({ bulkOps: { ...stateRef.current.bulkOps, faces: !stateRef.current.bulkOps.faces } }),
    [setState],
  );
  const toggleBulkLang = useCallback(
    (l: string) => {
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

  // Real analyze (spec §8.2, issue #12): enqueue via POST /api/jobs; the
  // worker's progress streams back through the workspace Broadcast channel.
  const runBulk = useCallback(async () => {
    const s = stateRef.current;
    // Canvas selection when present; otherwise the source-browser selection —
    // with real data the sidebar is where multi-select lives (issue #12).
    const ids = (s.selectedIds.length ? s.selectedIds : s.sidebarSelectedIds).slice();
    if (!ids.length || activeJobId.current) return;
    setState({ proc: { active: true, label: `Queueing ${ids.length} photo(s)…`, pct: 3 } });
    try {
      const resp = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "analyze", assetIds: ids }),
      });
      if (!resp.ok) throw new Error(`jobs API ${resp.status}`);
      const { jobId } = (await resp.json()) as { jobId: string };
      activeJobId.current = jobId;
      setState({ proc: { active: true, label: "Waiting for worker…", pct: 5 } });
    } catch {
      setState({ proc: { active: false, label: "", pct: 0 } });
      flashToast("Analyze failed to start — try again");
    }
  }, [setState, flashToast]);

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
              ? { ...preview, localUrl: null, stage: "error", message: job.error ?? `Processing ${terminalStatus}` }
              : preview,
          ) }
          : {}),
      }));
      router.refresh();
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
    setState({
      proc: { active: false, label: "", pct: 0 },
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
      flashToast(`${verb} ${job.status}${job.error ? ` — ${job.error}` : ""}`);
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

  useEffect(() => {
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    const el = canvasElRef.current;
    if (el) el.addEventListener("wheel", wheel, { passive: false });
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
      if (el) el.removeEventListener("wheel", wheel);
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
    };
    // Handlers are stable (useCallback with ref-backed reads); run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist canvas arrangement per project (edit #2) ──────────────────────
  // Load once on mount (before the rAF fit reads bounds), so tile drags, frames
  // and sticky notes are exactly where they were left. localStorage only — this
  // is UI state, never a backend concern.
  useEffect(() => {
    if (currentProjectId === "all") return;
    try {
      const raw = localStorage.getItem(canvasStoreKey(currentProjectId));
      if (!raw) return;
      const saved = JSON.parse(raw) as PersistedCanvas;
      setState({
        galleryOverrides: { ...EMPTY_GALLERY_OVERRIDES, ...(saved.galleryOverrides ?? {}) },
        frames: saved.frames ?? [],
        stickyNotes: saved.stickyNotes ?? [],
      });
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
            galleryOverrides: state.galleryOverrides,
            frames: state.frames,
            stickyNotes: state.stickyNotes,
          } satisfies PersistedCanvas),
        );
      } catch {
        // over quota / unavailable — arrangement just won't persist this time
      }
    }, 400);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [currentProjectId, state.galleryOverrides, state.frames, state.stickyNotes]);

  // Flush the latest arrangement on unmount too, so navigating away right after
  // a drag (before the debounce fires) still saves it.
  useEffect(() => {
    return () => {
      if (currentProjectId === "all") return;
      try {
        const s = stateRef.current;
        localStorage.setItem(
          canvasStoreKey(currentProjectId),
          JSON.stringify({
            galleryOverrides: s.galleryOverrides,
            frames: s.frames,
            stickyNotes: s.stickyNotes,
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
      if (e.key === "Delete" || e.key === "Backspace") {
        const target = e.target as HTMLElement | null;
        const isTyping = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
        const s = stateRef.current;
        if (!isTyping && s.selectedIds.length > 0) {
          e.preventDefault();
          s.selectedIds.forEach((id) => deletePhoto(id));
        }
        return;
      }
      if (e.key !== "Escape") return;
      const s = stateRef.current;
      if (s.imp.open) return; // ImportModal owns Esc while open (upload-aware)
      if (s.drawerId) closeDrawer();
      else if (s.search) closeSearch();
      else if (s.helpOpen) closeHelp();
      else if (s.chatOpen) closeChat();
      else if (s.sidebarTabs.length) closeSidebar();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDrawer, closeSearch, closeHelp, closeChat, closeSidebar, deletePhoto]);

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
      for (const url of objectUrls.values()) URL.revokeObjectURL(url);
      objectUrls.clear();
    };
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────

  const neuralGalleryPos = useMemo(
    () => neuralGalleryFor(state.photos, state.galleryOverrides, state.uploadPreviews).pos,
    [state.photos, state.galleryOverrides, state.uploadPreviews, neuralGalleryFor],
  );

  const selectedIds = useMemo(() => new Set(state.selectedIds), [state.selectedIds]);

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

  const projectPhotos = useMemo(
    () => filteredPhotos(state.photos),
    [state.photos, filteredPhotos],
  );

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

  const timelineLayoutResult = useMemo(
    () => computeTimelineLayout(projectPhotos, state.galleryOverrides.timeline, state.frames),
    [projectPhotos, state.galleryOverrides.timeline, state.frames],
  );

  const mapLayoutResult = useMemo(
    () => computeMapLayout(projectPhotos, state.galleryOverrides.map, state.frames),
    [projectPhotos, state.galleryOverrides.map, state.frames],
  );

  const topicLayoutResult = useMemo(
    () => computeTopicLayout(projectPhotos, state.galleryOverrides.topic, state.frames),
    [projectPhotos, state.galleryOverrides.topic, state.frames],
  );

  // Also surfaces while a job runs — with sidebar-triggered analyzes the
  // panel is the progress indicator even without a canvas selection.
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
  const cloudDecor: CloudLayout | null = isTimelineView
    ? timelineLayoutResult
    : isMapView
      ? mapLayoutResult
      : isSenseView
        ? topicLayoutResult
        : null;
  const activePositions = cloudDecor ? cloudDecor.tiles : neuralGalleryPos;

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
    (state.drawerId ? 410 : 0);

  // Minimap dots are derived from exactly what the canvas renders (edit #3):
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
      setState({ tx: rr.width / 2 - cx * s.scale, ty: rr.height / 2 - cy * s.scale });
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
      : state.tool === "hand"
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
    setLang,
    setStyle,
    copyCap,
    regen,
    saveCaption,
    genSingle,
    toolSelect,
    toolHand,
    toolFrame,
    onFit: doFit,
    onZoomReset: doFit,
    setView,

    frames: state.frames,
    frameDraft,
    deleteFrame,
    renameFrame,

    stickyNotes: state.stickyNotes,
    addStickyNote,
    onStickyDown,
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

    search: state.search,
    openSearch,
    closeSearch,

    helpOpen: state.helpOpen,
    openHelp,
    closeHelp,

    impOpen: state.imp.open,
    addToolbar,
    closeImport,
    onUploadBatchStart,
    onUploadBatchSettled,

    activePositions,
    cloudDecor,
    tilesAnimating: state.tilesAnimating,

    bulkPanelOpen: state.bulkPanelOpen,
    toggleBulkPanel,
    bulkShow,
    bulkIdle: !state.proc.active,
    bulkCount: selectedIds.size,
    bulkThumbs,
    bulkOps: state.bulkOps,
    bulkLangs: state.bulkLangs,
    bulkStyle: state.bulkStyle,
    proc: state.proc,
    toggleBulkCaptions,
    toggleBulkTags,
    toggleBulkFaces,
    toggleBulkLang,
    setBulkStyle: setBulkStyleAction,
    clearSelection,
    runBulk,

    flashToast,
  };
}
