"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useJobProgress } from "@/hooks/useJobProgress";
import { photoSrc } from "@/lib/img";
import type {
  CaptionStyle,
  ChatMessage,
  Language,
  Photo,
  PhotoSource,
  Project,
  ProjectKey,
  Tool,
  ViewMode,
} from "@/types";
import {
  centerAtScale,
  EMPTY_GALLERY_OVERRIDES,
  fitView,
  minimapLayout as computeMinimapLayout,
  senseBubbles as computeSenseBubbles,
  senseExpandLayout as computeSenseExpand,
  sourcesGallery,
  STICKY_NOTE_COLORS,
  timelineLayout as computeTimelineLayout,
  type Bounds,
  type ExpandOverlay,
  type Frame,
  type GalleryOverrides,
  type MinimapLayout,
  type SenseBubble,
  type StickyNote,
  type TilePos,
  type TimelineLayout,
} from "@/lib/layout";
import { PROJECTS_META } from "@/lib/mock-data";
import { CHAT_FALLBACK_REPLY, CHAT_GREETING, CHAT_REPLIES } from "@/lib/chat";
import type { MapApi } from "@/components/map/MapCanvas";

const DEFAULT_ZOOM = 0.75;
const NEW_PROJECT_COLORS = ["#5b9bff", "#ff7a5c", "#4fd1c5", "#c084fc", "#ffd166"];

/** Looks up a project's label/color across both the 3 seed projects and any
 * user-created ones (created at runtime, so they can't live in the static
 * PROJECTS_META table). */
function resolveProjectMeta(key: string, custom: Project[]): { label: string; color: string } {
  const seed = PROJECTS_META[key];
  if (seed) return seed;
  const found = custom.find((p) => p.key === key);
  if (found) return { label: found.label, color: found.color };
  return { label: key, color: "var(--t3)" };
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

/** Undo/redo checkpoint — everything the frame tool, node drags, timeline
 * drags, and expand-file drags can mutate. */
interface Snapshot {
  frames: Frame[];
  stickyNotes: StickyNote[];
  tlOverrides: Record<string, { x: number; y: number }>;
  expandOverrides: Record<string, { x: number; y: number }>;
  galleryOverrides: GalleryOverrides;
  photos: Photo[];
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
  expanded: { kind: "sense" | "map" | null; key: string | null };
  expandOverrides: Record<string, { x: number; y: number }>;
  galleryOverrides: GalleryOverrides;
  /** Projects created at runtime via the source browser sidebar's "New project" flow. */
  customProjects: Project[];
  /** Source browser sidebar (Finder-style, opened by double-clicking a source tile in Neural view). */
  sidebarTabs: PhotoSource[];
  sidebarActiveTab: PhotoSource | null;
  sidebarSelectedIds: string[];
  sidebarSearchText: string;
  sidebarAddOpen: boolean;
  projCurrent: ProjectKey | "all";
  photos: Photo[];
  selectedIds: string[];
  hoveredId: string | null;
  marquee: Marquee | null;
  drawerId: string | null;
  drawerLang: Language;
  drawerStyle: CaptionStyle;
  copyLabel: string;
  tlOverrides: Record<string, { x: number; y: number }>;
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
  /** Real Leaflet zoom %, kept in sync via MapCanvas's onZoomChange while view === "map". */
  mapZoomPct: number;
}

interface TlBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
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
    }
  | {
      mode: "gallery";
      kind: "source";
      key: string;
      sx: number;
      sy: number;
      orig: { x: number; y: number };
      moved: boolean;
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
      mode: "tl";
      id: string;
      sx: number;
      sy: number;
      orig: { x: number; y: number };
      bounds: TlBounds;
      moved: boolean;
    }
  | {
      mode: "expandFile";
      id: string;
      sx: number;
      sy: number;
      orig: { x: number; y: number };
      space: "canvas" | "map";
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
const PROJECT_KEYS: ProjectKey[] = ["frontline", "travel", "client"];

export interface ProjectListItem {
  key: ProjectKey;
  label: string;
  color: string;
  count: number;
  active: boolean;
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
  /** "All my files" root — drives the trimmed toolbar and enables source double-click browsing. */
  allFilesMode: boolean;
  setCanvasRef: (el: HTMLDivElement | null) => void;
  onCanvasDown: (e: React.PointerEvent) => void;
  onGalleryNodeDown: (
    e: React.PointerEvent,
    kind: "source",
    key: string,
    origCenter: { x: number; y: number },
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

  // Map (Leaflet) imperative bridge for Fit/Zoom
  registerMapApi: (api: MapApi | null) => void;
  onMapZoomChange: (pct: number) => void;

  // Layout constants (no left sidebar anymore)
  contentLeft: number;
  drawerRight: number;

  extractExif: () => void;

  // Chat
  chatOpen: boolean;
  chatMsgs: ChatMessage[];
  chatInput: string;
  toggleChat: () => void;
  closeChat: () => void;
  sendChat: (text?: string) => void;
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
  selectProject: (k: ProjectKey | "all") => void;

  // Add to project
  addProjOpen: boolean;
  toggleAddProj: () => void;
  closeAddProj: () => void;
  addToProject: (key: ProjectKey) => void;
  createNewProject: () => void;

  // Source browser sidebar (Finder-style, All My Files)
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
  doUpload: () => void;
  closeImport: () => void;

  // Expand overlays (sense / map marker drill-down)
  expanded: { kind: "sense" | "map" | null; key: string | null };
  expandOverrides: Record<string, { x: number; y: number }>;
  senseExpand: ExpandOverlay | null;
  toggleSenseExpand: (key: string) => void;
  toggleMapExpand: (key: string) => void;
  closeExpand: () => void;
  onExpandFileDown: (e: React.PointerEvent, id: string, x: number, y: number, space: "canvas" | "map") => void;

  // Timeline
  timelineLayout: TimelineLayout;
  onTlDown: (e: React.PointerEvent, id: string, orig: { x: number; y: number }, bounds: TlBounds) => void;

  // Sense
  senseBubbles: SenseBubble[];

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

export function useWorkspace(initialPhotos: Photo[], workspaceId: string): Workspace {
  const router = useRouter();
  const [state, setStateRaw] = useState<WorkspaceState>({
    scale: 1,
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
    expanded: { kind: null, key: null },
    expandOverrides: {},
    galleryOverrides: EMPTY_GALLERY_OVERRIDES,
    customProjects: [],
    sidebarTabs: [],
    sidebarActiveTab: null,
    sidebarSelectedIds: [],
    sidebarSearchText: "",
    sidebarAddOpen: false,
    projCurrent: "all",
    photos: initialPhotos,
    selectedIds: [],
    hoveredId: null,
    marquee: null,
    drawerId: null,
    drawerLang: "EN",
    drawerStyle: "Agency",
    copyLabel: "Copy",
    tlOverrides: {},
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
    mapZoomPct: 100,
  });

  // Mirror of committed state, kept current for window-level event handlers.
  const stateRef = useRef(state);
  const dragRef = useRef<DragSession>(null);
  const canvasElRef = useRef<HTMLDivElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeJobId = useRef<string | null>(null);
  const mapApiRef = useRef<MapApi | null>(null);

  // Patch helper that also advances stateRef so sequential reads see fresh data.
  const setState = useCallback((patch: Partial<WorkspaceState>) => {
    setStateRaw((prev) => {
      const next = { ...prev, ...patch };
      stateRef.current = next;
      return next;
    });
  }, []);

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

  const filteredPhotos = useCallback((photos: Photo[], proj: ProjectKey | "all") => {
    return proj === "all" ? photos : photos.filter((p) => p.project === proj);
  }, []);

  // ── Undo / redo ──────────────────────────────────────────────────────────

  const snapshot = useCallback((s: WorkspaceState): Snapshot => ({
    frames: s.frames,
    stickyNotes: s.stickyNotes,
    tlOverrides: s.tlOverrides,
    expandOverrides: s.expandOverrides,
    galleryOverrides: s.galleryOverrides,
    photos: s.photos,
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

  const registerMapApi = useCallback((api: MapApi | null) => {
    mapApiRef.current = api;
  }, []);
  const onMapZoomChange = useCallback((pct: number) => setState({ mapZoomPct: pct }), [setState]);

  // ── Pan / zoom ────────────────────────────────────────────────────────────

  const wheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const s = stateRef.current;
      if (s.view === "timeline") {
        setState({ tx: s.tx - e.deltaX, ty: s.ty - e.deltaY });
        return;
      }
      const r = rect(),
        cx = e.clientX - r.left,
        cy = e.clientY - r.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const ns = Math.min(4, Math.max(0.2, s.scale * factor));
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
      if (s.tool === "frame" && s.view !== "map") {
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
      } else if (s.tool === "hand" || s.view !== "neural") {
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
        };
        setState({ marquee: { x0: dx0, y0: dy0, x1: dx0, y1: dy0 } });
      }
    },
    [rect, toContent, setState],
  );

  const onGalleryNodeDown = useCallback(
    (e: React.PointerEvent, kind: "source", key: string, origCenter: { x: number; y: number }) => {
      e.stopPropagation();
      pushHistory();
      dragRef.current = { mode: "gallery", kind, key, sx: e.clientX, sy: e.clientY, orig: origCenter, moved: false };
    },
    [pushHistory],
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

  const onTlDown = useCallback(
    (e: React.PointerEvent, id: string, orig: { x: number; y: number }, bounds: TlBounds) => {
      e.stopPropagation();
      pushHistory();
      dragRef.current = { mode: "tl", id, sx: e.clientX, sy: e.clientY, orig, bounds, moved: false };
    },
    [pushHistory],
  );

  const onExpandFileDown = useCallback(
    (e: React.PointerEvent, id: string, x: number, y: number, space: "canvas" | "map") => {
      e.stopPropagation();
      e.preventDefault();
      pushHistory();
      dragRef.current = { mode: "expandFile", id, sx: e.clientX, sy: e.clientY, orig: { x, y }, space, moved: false };
    },
    [pushHistory],
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
      } else if (d.mode === "tl") {
        if (Math.abs(e.clientX - d.sx) > 2 || Math.abs(e.clientY - d.sy) > 2) d.moved = true;
        const dx = (e.clientX - d.sx) / s.scale,
          dy = (e.clientY - d.sy) / s.scale;
        let nx = d.orig.x + dx,
          ny = d.orig.y + dy;
        nx = Math.min(d.bounds.maxX, Math.max(d.bounds.minX, nx));
        ny = Math.min(d.bounds.maxY, Math.max(d.bounds.minY, ny));
        setState({ tlOverrides: { ...s.tlOverrides, [d.id]: { x: nx, y: ny } } });
      } else if (d.mode === "expandFile") {
        if (Math.abs(e.clientX - d.sx) > 2 || Math.abs(e.clientY - d.sy) > 2) d.moved = true;
        const div = d.space === "canvas" ? s.scale : 1;
        const dx = (e.clientX - d.sx) / div,
          dy = (e.clientY - d.sy) / div;
        setState({ expandOverrides: { ...s.expandOverrides, [d.id]: { x: d.orig.x + dx, y: d.orig.y + dy } } });
      } else if (d.mode === "gallery") {
        if (Math.abs(e.clientX - d.sx) > 2 || Math.abs(e.clientY - d.sy) > 2) d.moved = true;
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
        // Neural view no longer has individually selectable file tiles on
        // canvas (browsing/selection now happens in the source browser
        // sidebar), so there's nothing left to marquee-hit-test here.
        setState({ marquee: { x0: d.dx0, y0: d.dy0, x1: d.x1, y1: d.y1 }, selectedIds: [] });
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
    [rect, toContent, setState],
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
    } else if (d.mode === "tl") {
      if (!d.moved) {
        const s = stateRef.current;
        const sel = s.selectedIds.slice();
        const i = sel.indexOf(d.id);
        if (i >= 0) sel.splice(i, 1);
        else sel.push(d.id);
        setState({ selectedIds: sel });
      }
    } else if (d.mode === "marquee") {
      if (!d.moved) setState({ selectedIds: [], drawerId: null });
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
  const closeExpand = useCallback(
    () => setState({ expanded: { kind: null, key: null }, expandOverrides: {} }),
    [setState],
  );
  const toggleSenseExpand = useCallback(
    (key: string) => {
      const s = stateRef.current;
      if (s.expanded.kind === "sense" && s.expanded.key === key) closeExpand();
      else setState({ expanded: { kind: "sense", key }, expandOverrides: {} });
    },
    [setState, closeExpand],
  );
  const toggleMapExpand = useCallback(
    (key: string) => {
      const s = stateRef.current;
      if (s.expanded.kind === "map" && s.expanded.key === key) closeExpand();
      else setState({ expanded: { kind: "map", key }, expandOverrides: {} });
    },
    [setState, closeExpand],
  );
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

  const regen = useCallback(() => flashToast("Caption regenerated"), [flashToast]);

  const deletePhoto = useCallback(
    (id: string) => {
      const s = stateRef.current;
      setState({
        photos: s.photos.filter((p) => p.id !== id),
        selectedIds: s.selectedIds.filter((x) => x !== id),
        drawerId: s.drawerId === id ? null : s.drawerId,
      });
    },
    [setState],
  );

  const genSingle = useCallback(
    (id: string) => {
      const s = stateRef.current;
      const photos = s.photos.map((p): Photo =>
        p.id !== id
          ? p
          : {
              ...p,
              processed: true,
              status: "Likely",
              captionKey: "gen",
              captionStyle: "Agency",
              chip: "Scene from the Kyiv frontline archive…",
              tags: ["kyiv", "documentary", "street", "2026"],
              facts: [
                { text: "Location: confirmed via GPS", status: "confirmed" },
                { text: "Date: confirmed via EXIF", status: "confirmed" },
                { text: "People: verification pending", status: "pending" },
              ],
            },
      );
      setState({ photos });
      flashToast("1 photo captioned · 4 tags added");
    },
    [setState, flashToast],
  );

  const neuralGalleryFor = useCallback(
    (photos: Photo[], overrides: GalleryOverrides): { pos: Record<string, TilePos>; bounds: Bounds } =>
      sourcesGallery(photos, overrides.source),
    [],
  );

  const computeFit = useCallback(
    (view: ViewMode, allPhotos: Photo[], overrides: GalleryOverrides) => {
      const r = rect();
      if (view === "neural") {
        // Always center at the fixed default zoom rather than solving for a
        // best-fit scale — Fit/Zoom-reset should land on the same 75% as the
        // initial view, not a computed (and often near-105%) fit-to-content.
        return centerAtScale(neuralGalleryFor(allPhotos, overrides).bounds, r, DEFAULT_ZOOM);
      }
      return fitView(view, r);
    },
    [rect, neuralGalleryFor],
  );

  const doFit = useCallback(() => {
    const s = stateRef.current;
    if (s.view === "map" && mapApiRef.current) {
      mapApiRef.current.fitWorld();
      return;
    }
    setState(computeFit(s.view, s.photos, s.galleryOverrides));
  }, [setState, computeFit]);

  const setZoomPct = useCallback(
    (pct: number) => {
      const s = stateRef.current;
      if (s.view === "map" && mapApiRef.current) {
        mapApiRef.current.setZoomPct(pct);
      } else {
        const r = rect(),
          cx = r.width / 2,
          cy = r.height / 2,
          ns = pct / 100;
        const px = (cx - s.tx) / s.scale,
          py = (cy - s.ty) / s.scale;
        setState({ scale: ns, tx: cx - px * ns, ty: cy - py * ns });
      }
      setState({ zoomMenuOpen: false });
    },
    [rect, setState],
  );

  const setView = useCallback(
    (v: ViewMode) => {
      setState({
        view: v,
        marquee: null,
        selectedIds: [],
        expanded: { kind: null, key: null },
        expandOverrides: {},
        bulkPanelOpen: false,
      });
      setTimeout(() => {
        if (v === "map" && mapApiRef.current) return;
        const s = stateRef.current;
        setState(computeFit(v, s.photos, s.galleryOverrides));
      }, 0);
    },
    [setState, computeFit],
  );

  // Fit once on first mount, but only after the canvas has a real size — a
  // zero-size rect (background tab / not-yet-painted) would produce a bad fit.
  // The initial view defaults to a fixed 70% zoom rather than a computed
  // best-fit scale; subsequent viewand navigation still fit-to-content.
  const didFitRef = useRef(false);
  const tryFit = useCallback(() => {
    if (didFitRef.current) return true;
    const r = rect();
    if (r.width > 0 && r.height > 0) {
      const s = stateRef.current;
      const bounds = neuralGalleryFor(s.photos, s.galleryOverrides).bounds;
      setState(centerAtScale(bounds, r, DEFAULT_ZOOM));
      didFitRef.current = true;
      return true;
    }
    return false;
  }, [rect, setState, neuralGalleryFor]);

  // ── Chat ─────────────────────────────────────────────────────────────────

  const sendChat = useCallback(
    (text?: string) => {
      const s = stateRef.current;
      const t = (typeof text === "string" ? text : s.chatInput || "").trim();
      if (!t) return;
      const reply = CHAT_REPLIES[t] || CHAT_FALLBACK_REPLY;
      setState({
        chatMsgs: [...s.chatMsgs, { role: "user", text: t }, { role: "assistant", text: reply }],
        chatInput: "",
      });
    },
    [setState],
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

  const selectProject = useCallback(
    (k: ProjectKey | "all") => {
      const view: ViewMode = k === "all" ? "neural" : "timeline";
      setState({
        projCurrent: k,
        projOpen: false,
        view,
        selectedIds: [],
        expanded: { kind: null, key: null },
        expandOverrides: {},
        bulkPanelOpen: false,
      });
      setTimeout(() => {
        const s = stateRef.current;
        setState(computeFit(view, s.photos, s.galleryOverrides));
      }, 0);
    },
    [setState, computeFit],
  );

  // ── Add to project ───────────────────────────────────────────────────────

  const toggleAddProj = useCallback(
    () => setState({ addProjOpen: !stateRef.current.addProjOpen }),
    [setState],
  );
  const closeAddProj = useCallback(() => setState({ addProjOpen: false }), [setState]);

  /** Stamps `project: key` onto the given photo ids. Shared by the canvas
   * selection's "ADD" button and the source browser sidebar's own button. */
  const commitAddToProject = useCallback(
    (key: string, ids: string[]) => {
      const s = stateRef.current;
      const n = ids.length;
      if (!n) return;
      const label = resolveProjectMeta(key, s.customProjects).label;
      const idSet = new Set(ids);
      const photos = s.photos.map((p) => (idSet.has(p.id) ? { ...p, project: key } : p));
      setState({ photos });
      flashToast(`${n} file${n === 1 ? "" : "s"} added to ${label}`);
    },
    [setState, flashToast],
  );

  /** Creates a brand-new project from the given photo ids and returns its
   * generated key (or null if there was nothing to add). */
  const commitCreateProject = useCallback(
    (ids: string[]) => {
      const s = stateRef.current;
      const n = ids.length;
      if (!n) return null;
      const key = `proj_${Date.now()}`;
      const label = `Untitled project ${s.customProjects.length + 1}`;
      const color = NEW_PROJECT_COLORS[s.customProjects.length % NEW_PROJECT_COLORS.length];
      const project: Project = { key, label, color, count: n };
      const idSet = new Set(ids);
      const photos = s.photos.map((p) => (idSet.has(p.id) ? { ...p, project: key } : p));
      setState({ photos, customProjects: [...s.customProjects, project] });
      flashToast(`${n} file${n === 1 ? "" : "s"} added to ${label}`);
      return key;
    },
    [setState, flashToast],
  );

  const addToProject = useCallback(
    (key: ProjectKey) => {
      const s = stateRef.current;
      commitAddToProject(key, s.selectedIds);
      setState({ addProjOpen: false, selectedIds: [] });
    },
    [commitAddToProject, setState],
  );

  const createNewProject = useCallback(() => {
    const s = stateRef.current;
    const ids = s.selectedIds;
    setState({ addProjOpen: false, selectedIds: [] });
    const key = commitCreateProject(ids);
    if (key) selectProject(key);
  }, [commitCreateProject, setState, selectProject]);

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
      const s = stateRef.current;
      commitAddToProject(key, s.sidebarSelectedIds);
      setState({
        sidebarAddOpen: false,
        sidebarSelectedIds: [],
        sidebarTabs: [],
        sidebarActiveTab: null,
        sidebarSearchText: "",
      });
      selectProject(key);
    },
    [commitAddToProject, setState, selectProject],
  );

  const sidebarCreateProject = useCallback(() => {
    const s = stateRef.current;
    const ids = s.sidebarSelectedIds;
    setState({
      sidebarAddOpen: false,
      sidebarSelectedIds: [],
      sidebarTabs: [],
      sidebarActiveTab: null,
      sidebarSearchText: "",
    });
    const key = commitCreateProject(ids);
    if (key) selectProject(key);
  }, [commitCreateProject, setState, selectProject]);

  // ── Search / Help ────────────────────────────────────────────────────────

  const openSearch = useCallback(() => setState({ search: true }), [setState]);
  const closeSearch = useCallback(() => setState({ search: false }), [setState]);
  const openHelp = useCallback(() => setState({ helpOpen: true }), [setState]);
  const closeHelp = useCallback(() => setState({ helpOpen: false }), [setState]);

  // ── Import ───────────────────────────────────────────────────────────────

  const addToolbar = useCallback(() => {
    setState({ imp: { open: !stateRef.current.imp.open } });
  }, [setState]);
  const doUpload = useCallback(() => {
    setState({ imp: { open: false } });
    flashToast("4 files imported");
  }, [setState, flashToast]);
  const closeImport = useCallback(() => setState({ imp: { open: false } }), [setState]);

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
      flashToast(`${job.total_items ?? 0} photo(s) analyzed`);
      router.refresh(); // pulls fresh tags/facts into the server payload
    } else {
      flashToast(`Analyze ${job.status}${job.error ? ` — ${job.error}` : ""}`);
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
      if (el) el.removeEventListener("wheel", wheel);
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
    };
    // Handlers are stable (useCallback with ref-backed reads); run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const s = stateRef.current;
      if (s.drawerId) closeDrawer();
      else if (s.search) closeSearch();
      else if (s.helpOpen) closeHelp();
      else if (s.expanded.kind) closeExpand();
      else if (s.chatOpen) closeChat();
      else if (s.sidebarTabs.length) closeSidebar();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDrawer, closeSearch, closeHelp, closeExpand, closeChat, closeSidebar]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────

  const neuralGalleryPos = useMemo(
    () => neuralGalleryFor(state.photos, state.galleryOverrides).pos,
    [state.photos, state.galleryOverrides, neuralGalleryFor],
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
  const showAddToProject = isNeural && selectedIds.size > 0;

  const projectPhotos = useMemo(
    () => filteredPhotos(state.photos, state.projCurrent),
    [state.photos, state.projCurrent, filteredPhotos],
  );

  const projectList: ProjectListItem[] = useMemo(() => {
    const seeded = PROJECT_KEYS.map((k) => ({
      key: k,
      label: PROJECTS_META[k].label,
      color: PROJECTS_META[k].color,
      count: state.photos.filter((p) => p.project === k).length,
      active: state.projCurrent === k,
    }));
    const custom = state.customProjects.map((p) => ({
      key: p.key,
      label: p.label,
      color: p.color,
      count: state.photos.filter((ph) => ph.project === p.key).length,
      active: state.projCurrent === p.key,
    }));
    return [...seeded, ...custom];
  }, [state.photos, state.projCurrent, state.customProjects]);

  const projLabel =
    state.projCurrent === "all" ? "All my files" : resolveProjectMeta(state.projCurrent, state.customProjects).label;

  const sidebarOpen = state.sidebarTabs.length > 0;
  const sidebarSelectedIds = useMemo(() => new Set(state.sidebarSelectedIds), [state.sidebarSelectedIds]);

  const timelineLayoutResult = useMemo(
    () => computeTimelineLayout(projectPhotos, state.tlOverrides),
    [projectPhotos, state.tlOverrides],
  );

  const senseBubblesResult = useMemo(() => computeSenseBubbles(projectPhotos), [projectPhotos]);
  const senseExpand = useMemo(
    () =>
      state.expanded.kind === "sense" && state.expanded.key
        ? computeSenseExpand(senseBubblesResult, state.expanded.key, state.expandOverrides)
        : null,
    [state.expanded, state.expandOverrides, senseBubblesResult],
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

  const canUndo = state.history.length > 0;
  const canRedo = state.future.length > 0;

  const contentLeft = 20;
  const drawerRight = state.chatOpen ? 320 : 0;

  const minimapPoints = useMemo(() => {
    if (isMapView) return [];
    if (isNeural) return Object.values(neuralGalleryPos).map((p) => ({ x: p.cx, y: p.cy }));
    if (isTimelineView) {
      return Object.values(timelineLayoutResult.tiles).map((t) => ({ x: t.x + t.w / 2, y: t.y + t.h / 2 }));
    }
    if (isSenseView) return senseBubblesResult.map((b) => ({ x: b.x, y: b.y }));
    return [];
  }, [isMapView, isNeural, isTimelineView, isSenseView, neuralGalleryPos, timelineLayoutResult, senseBubblesResult]);

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

  const zoomPct = isMapView ? Math.round(state.mapZoomPct) + "%" : Math.round(state.scale * 100) + "%";

  return {
    scale: state.scale,
    tx: state.tx,
    ty: state.ty,
    tool: state.tool,
    view: state.view,
    projCurrent: state.projCurrent,
    photos: state.photos,
    projectPhotos,
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
    gridOpacity: isMapView ? 0 : 1,
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
    setCanvasRef,
    onCanvasDown,
    onGalleryNodeDown,
    setHover,
    openDrawer,
    closeDrawer,
    navDrawer,
    deletePhoto,
    setLang,
    setStyle,
    copyCap,
    regen,
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

    registerMapApi,
    onMapZoomChange,

    contentLeft,
    drawerRight,

    extractExif,

    chatOpen: state.chatOpen,
    chatMsgs: state.chatMsgs,
    chatInput: state.chatInput,
    toggleChat,
    closeChat,
    sendChat,
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

    search: state.search,
    openSearch,
    closeSearch,

    helpOpen: state.helpOpen,
    openHelp,
    closeHelp,

    impOpen: state.imp.open,
    addToolbar,
    doUpload,
    closeImport,

    timelineLayout: timelineLayoutResult,
    onTlDown,

    senseBubbles: senseBubblesResult,
    senseExpand,
    expanded: state.expanded,
    expandOverrides: state.expandOverrides,
    toggleSenseExpand,
    toggleMapExpand,
    closeExpand,
    onExpandFileDown,

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
