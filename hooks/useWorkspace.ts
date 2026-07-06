"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CaptionStyle,
  ChatMessage,
  Language,
  Photo,
  ProjectKey,
  Tool,
  ViewMode,
} from "@/types";
import {
  EMPTY_OVERRIDES,
  fitView,
  layoutNeural,
  senseBubbles as computeSenseBubbles,
  senseExpandLayout as computeSenseExpand,
  timelineLayout as computeTimelineLayout,
  type ExpandOverlay,
  type NeuralLayout,
  type NodeOverrides,
  type SenseBubble,
  type TimelineLayout,
} from "@/lib/layout";
import { PROJECTS_META } from "@/lib/mock-data";
import { CHAT_FALLBACK_REPLY, CHAT_GREETING, CHAT_REPLIES } from "@/lib/chat";

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface PreviewItem {
  src: string;
  onClick: () => void;
}

interface ImpState {
  open: boolean;
  at: "rail" | "toolbar";
}

interface PreviewState {
  open: boolean;
  kind: "map" | "sense" | null;
  key: string | null;
  items: PreviewItem[];
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

interface WorkspaceState {
  scale: number;
  tx: number;
  ty: number;
  tool: Tool;
  view: ViewMode;
  sidebarExpanded: boolean;
  chatOpen: boolean;
  chatMsgs: ChatMessage[];
  chatInput: string;
  acctOpen: boolean;
  projOpen: boolean;
  addProjOpen: boolean;
  search: boolean;
  helpOpen: boolean;
  imp: ImpState;
  preview: PreviewState;
  expanded: { kind: "sense" | "map" | null; key: string | null };
  expandOverrides: Record<string, { x: number; y: number }>;
  projCurrent: ProjectKey | "all";
  photos: Photo[];
  selectedIds: string[];
  hoveredId: string | null;
  marquee: Marquee | null;
  drawerId: string | null;
  drawerLang: Language;
  drawerStyle: CaptionStyle;
  copyLabel: string;
  nodeOverrides: NodeOverrides;
  tlOverrides: Record<string, { x: number; y: number }>;
  bulkOps: BulkOps;
  bulkLangs: string[];
  bulkStyle: CaptionStyle;
  proc: ProcState;
  toast: { show: boolean; text: string };
  /** True while a canvas pan drag is active (drives the grabbing cursor). */
  panning: boolean;
}

interface TlBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// Transient per-pointer-move drag session (source's mutable `this.drag`).
type DragSession =
  | { mode: "pan"; sx: number; sy: number; otx: number; oty: number; lockY: boolean }
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
      mode: "node";
      kind: "hub" | "folder" | "file";
      key: string;
      sx: number;
      sy: number;
      orig: { x: number; y: number };
      moved: boolean;
    }
  | {
      mode: "click";
      id: string;
      sx: number;
      sy: number;
      moved: boolean;
      shift: boolean;
      ctrl: boolean;
      origFile?: { x: number; y: number };
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
  sidebarExpanded: boolean;
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
  neuralLayout: NeuralLayout;
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
  setCanvasRef: (el: HTMLDivElement | null) => void;
  onCanvasDown: (e: React.PointerEvent) => void;
  onCardDown: (e: React.PointerEvent, id: string) => void;
  onNodeDown: (
    e: React.PointerEvent,
    kind: "hub" | "folder",
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
  onFit: () => void;
  onZoomReset: () => void;
  toggleSidebar: () => void;
  setView: (v: ViewMode) => void;

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

  // Preview modal
  previewOpen: boolean;
  previewTitle: string;
  previewItems: PreviewItem[];
  openPreview: (kind: "map" | "sense", key: string, items: PreviewItem[]) => void;
  closePreview: () => void;

  // Expand overlays (sense / map marker drill-down)
  expanded: { kind: "sense" | "map" | null; key: string | null };
  senseExpand: ExpandOverlay | null;
  toggleSenseExpand: (key: string) => void;
  closeExpand: () => void;
  onExpandFileDown: (e: React.PointerEvent, id: string, x: number, y: number, space: "canvas" | "map") => void;

  // Timeline
  timelineLayout: TimelineLayout;
  onTlDown: (e: React.PointerEvent, id: string, orig: { x: number; y: number }, bounds: TlBounds) => void;

  // Sense
  senseBubbles: SenseBubble[];

  // Bulk AI
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

export function useWorkspace(initialPhotos: Photo[]): Workspace {
  const [state, setStateRaw] = useState<WorkspaceState>({
    scale: 1,
    tx: 200,
    ty: 120,
    tool: "select",
    view: "neural",
    sidebarExpanded: false,
    chatOpen: false,
    chatMsgs: [{ role: "assistant", text: CHAT_GREETING }],
    chatInput: "",
    acctOpen: false,
    projOpen: false,
    addProjOpen: false,
    search: false,
    helpOpen: false,
    imp: { open: false, at: "rail" },
    preview: { open: false, kind: null, key: null, items: [] },
    expanded: { kind: null, key: null },
    expandOverrides: {},
    projCurrent: "all",
    photos: initialPhotos,
    selectedIds: [],
    hoveredId: null,
    marquee: null,
    drawerId: null,
    drawerLang: "EN",
    drawerStyle: "Agency",
    copyLabel: "Copy",
    nodeOverrides: EMPTY_OVERRIDES,
    tlOverrides: {},
    bulkOps: { captions: true, tags: true, faces: false },
    bulkLangs: ["EN"],
    bulkStyle: "Agency",
    proc: { active: false, label: "", pct: 0 },
    toast: { show: false, text: "" },
    panning: false,
  });

  // Mirror of committed state, kept current for window-level event handlers.
  const stateRef = useRef(state);
  const dragRef = useRef<DragSession>(null);
  const canvasElRef = useRef<HTMLDivElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bulkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const bulkTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ── Pan / zoom ────────────────────────────────────────────────────────────

  const wheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const s = stateRef.current;
      if (s.view === "timeline") {
        setState({ tx: s.tx - e.deltaY - e.deltaX });
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
      if (s.imp.open) patch.imp = { ...s.imp, open: false };
      if (s.acctOpen) patch.acctOpen = false;
      if (s.projOpen) patch.projOpen = false;
      if (Object.keys(patch).length) setState(patch);
      const r = rect();
      if (s.tool === "hand" || s.view !== "neural") {
        dragRef.current = {
          mode: "pan",
          sx: e.clientX,
          sy: e.clientY,
          otx: s.tx,
          oty: s.ty,
          lockY: s.view === "timeline",
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

  const onCardDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      e.stopPropagation();
      if (stateRef.current.imp.open) {
        setState({ imp: { ...stateRef.current.imp, open: false } });
      }
      dragRef.current = {
        mode: "click",
        id,
        sx: e.clientX,
        sy: e.clientY,
        moved: false,
        shift: e.shiftKey,
        ctrl: e.ctrlKey || e.metaKey,
      };
    },
    [setState],
  );

  const onNodeDown = useCallback(
    (
      e: React.PointerEvent,
      kind: "hub" | "folder",
      key: string,
      origCenter: { x: number; y: number },
    ) => {
      e.stopPropagation();
      e.preventDefault();
      dragRef.current = {
        mode: "node",
        kind,
        key,
        sx: e.clientX,
        sy: e.clientY,
        orig: origCenter,
        moved: false,
      };
    },
    [],
  );

  const onTlDown = useCallback(
    (e: React.PointerEvent, id: string, orig: { x: number; y: number }, bounds: TlBounds) => {
      e.stopPropagation();
      dragRef.current = { mode: "tl", id, sx: e.clientX, sy: e.clientY, orig, bounds, moved: false };
    },
    [],
  );

  const onExpandFileDown = useCallback(
    (e: React.PointerEvent, id: string, x: number, y: number, space: "canvas" | "map") => {
      e.stopPropagation();
      e.preventDefault();
      dragRef.current = { mode: "expandFile", id, sx: e.clientX, sy: e.clientY, orig: { x, y }, space, moved: false };
    },
    [],
  );

  const move = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const s = stateRef.current;
      if (d.mode === "pan") {
        setState({
          tx: d.otx + (e.clientX - d.sx),
          ty: d.lockY ? d.oty : d.oty + (e.clientY - d.sy),
        });
      } else if (d.mode === "node") {
        if (Math.abs(e.clientX - d.sx) > 2 || Math.abs(e.clientY - d.sy) > 2) d.moved = true;
        const dx = (e.clientX - d.sx) / s.scale,
          dy = (e.clientY - d.sy) / s.scale;
        const nx = d.orig.x + dx,
          ny = d.orig.y + dy;
        const ov: NodeOverrides = {
          hub: { ...s.nodeOverrides.hub },
          folder: { ...s.nodeOverrides.folder },
          file: { ...s.nodeOverrides.file },
        };
        ov[d.kind][d.key] = { x: nx, y: ny };
        setState({ nodeOverrides: ov });
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
      } else if (d.mode === "click") {
        if (Math.abs(e.clientX - d.sx) > 3 || Math.abs(e.clientY - d.sy) > 3) d.moved = true;
        if (d.moved && s.view === "neural") {
          const dx = (e.clientX - d.sx) / s.scale,
            dy = (e.clientY - d.sy) / s.scale;
          if (!d.origFile) {
            const { pos } = layoutNeural(s.photos, s.nodeOverrides);
            const pp = pos[d.id];
            if (pp) d.origFile = { x: pp.cx, y: pp.cy };
          }
          if (d.origFile) {
            const ov: NodeOverrides = {
              hub: { ...s.nodeOverrides.hub },
              folder: { ...s.nodeOverrides.folder },
              file: { ...s.nodeOverrides.file },
            };
            ov.file[d.id] = { x: d.origFile.x + dx, y: d.origFile.y + dy };
            setState({ nodeOverrides: ov });
          }
        }
      } else if (d.mode === "marquee") {
        const r = rect();
        d.x1 = e.clientX - r.left;
        d.y1 = e.clientY - r.top;
        if (Math.abs(d.x1 - d.dx0) > 4 || Math.abs(d.y1 - d.dy0) > 4) d.moved = true;
        const c1 = toContent(e.clientX, e.clientY);
        const a = d.startContent,
          b = c1;
        const xl = Math.min(a.x, b.x),
          xr = Math.max(a.x, b.x),
          yt = Math.min(a.y, b.y),
          yb = Math.max(a.y, b.y);
        const { pos } = layoutNeural(s.photos, s.nodeOverrides);
        const hit = s.photos
          .filter((p) => {
            const pp = pos[p.id];
            return pp && pp.x < xr && pp.x + pp.w > xl && pp.y < yb && pp.y + pp.h > yt;
          })
          .map((p) => p.id);
        setState({ marquee: { x0: d.dx0, y0: d.dy0, x1: d.x1, y1: d.y1 }, selectedIds: hit });
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
    } else if (d.mode === "click") {
      if (!d.moved) {
        const s = stateRef.current;
        if (d.shift || d.ctrl) {
          const sel = s.selectedIds.slice();
          const i = sel.indexOf(d.id);
          if (i >= 0) sel.splice(i, 1);
          else sel.push(d.id);
          setState({ selectedIds: sel });
        } else {
          openDrawer(d.id);
        }
      }
    } else if (d.mode === "marquee") {
      if (!d.moved) setState({ selectedIds: [], drawerId: null });
      setState({ marquee: null });
    }
  }, [setState, openDrawer]);

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
  const closeDrawer = useCallback(() => setState({ drawerId: null }), [setState]);
  const setLang = useCallback((l: Language) => setState({ drawerLang: l }), [setState]);
  const setStyle = useCallback((st: CaptionStyle) => setState({ drawerStyle: st }), [setState]);
  const toolSelect = useCallback(() => setState({ tool: "select" }), [setState]);
  const toolHand = useCallback(() => setState({ tool: "hand" }), [setState]);
  const toggleSidebar = useCallback(
    () => setState({ sidebarExpanded: !stateRef.current.sidebarExpanded }),
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

  const doFit = useCallback(() => {
    const s = stateRef.current;
    const photosForFit = filteredPhotos(s.photos, s.projCurrent);
    const fit = fitView(s.view, photosForFit, s.nodeOverrides, rect(), s.sidebarExpanded, s.chatOpen);
    setState(fit);
  }, [rect, setState, filteredPhotos]);

  const setView = useCallback(
    (v: ViewMode) => {
      setState({ view: v, marquee: null, selectedIds: [], expanded: { kind: null, key: null }, expandOverrides: {} });
      setTimeout(() => {
        const s = stateRef.current;
        const photosForFit = filteredPhotos(s.photos, s.projCurrent);
        const fit = fitView(v, photosForFit, s.nodeOverrides, rect(), s.sidebarExpanded, s.chatOpen);
        setState(fit);
      }, 0);
    },
    [setState, rect, filteredPhotos],
  );

  // Fit once on first mount, but only after the canvas has a real size — a
  // zero-size rect (background tab / not-yet-painted) would produce a bad fit.
  const didFitRef = useRef(false);
  const tryFit = useCallback(() => {
    if (didFitRef.current) return true;
    const r = rect();
    if (r.width > 0 && r.height > 0) {
      doFit();
      didFitRef.current = true;
      return true;
    }
    return false;
  }, [rect, doFit]);

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

  // ── Account / project dropdowns ─────────────────────────────────────────

  const openAcct = useCallback(
    () => setState({ acctOpen: !stateRef.current.acctOpen, projOpen: false }),
    [setState],
  );
  const closeAcct = useCallback(() => setState({ acctOpen: false }), [setState]);
  const openProj = useCallback(
    () => setState({ projOpen: !stateRef.current.projOpen, acctOpen: false }),
    [setState],
  );
  const closeProj = useCallback(() => setState({ projOpen: false }), [setState]);

  const selectProject = useCallback(
    (k: ProjectKey | "all") => {
      const view: ViewMode = k === "all" ? "neural" : "timeline";
      setState({ projCurrent: k, projOpen: false, view, selectedIds: [], expanded: { kind: null, key: null }, expandOverrides: {} });
      setTimeout(() => {
        const s = stateRef.current;
        const photosForFit = filteredPhotos(s.photos, k);
        const fit = fitView(view, photosForFit, s.nodeOverrides, rect(), s.sidebarExpanded, s.chatOpen);
        setState(fit);
      }, 0);
    },
    [setState, rect, filteredPhotos],
  );

  // ── Add to project ───────────────────────────────────────────────────────

  const toggleAddProj = useCallback(
    () => setState({ addProjOpen: !stateRef.current.addProjOpen }),
    [setState],
  );
  const closeAddProj = useCallback(() => setState({ addProjOpen: false }), [setState]);

  const addToProject = useCallback(
    (key: ProjectKey) => {
      const s = stateRef.current;
      const n = s.selectedIds.length;
      const label = PROJECTS_META[key].label;
      const selectedSet = new Set(s.selectedIds);
      const photos = s.photos.map((p) => (selectedSet.has(p.id) ? { ...p, project: key } : p));
      setState({ photos, addProjOpen: false, selectedIds: [] });
      flashToast(`${n} file${n === 1 ? "" : "s"} added to ${label}`);
    },
    [setState, flashToast],
  );

  const createNewProject = useCallback(() => {
    const s = stateRef.current;
    const n = s.selectedIds.length;
    setState({ addProjOpen: false, selectedIds: [] });
    flashToast(`${n} file${n === 1 ? "" : "s"} added to new project`);
  }, [setState, flashToast]);

  // ── Search / Help ────────────────────────────────────────────────────────

  const openSearch = useCallback(() => setState({ search: true }), [setState]);
  const closeSearch = useCallback(() => setState({ search: false }), [setState]);
  const openHelp = useCallback(() => setState({ helpOpen: true }), [setState]);
  const closeHelp = useCallback(() => setState({ helpOpen: false }), [setState]);

  // ── Import ───────────────────────────────────────────────────────────────

  const addToolbar = useCallback(() => {
    const s = stateRef.current;
    setState({ imp: { open: !(s.imp.open && s.imp.at === "toolbar"), at: "toolbar" } });
  }, [setState]);
  const doUpload = useCallback(() => {
    setState({ imp: { ...stateRef.current.imp, open: false } });
    flashToast("4 files imported");
  }, [setState, flashToast]);
  const closeImport = useCallback(
    () => setState({ imp: { ...stateRef.current.imp, open: false } }),
    [setState],
  );

  // ── Preview modal ────────────────────────────────────────────────────────

  const openPreview = useCallback(
    (kind: "map" | "sense", key: string, items: PreviewItem[]) =>
      setState({ preview: { open: true, kind, key, items } }),
    [setState],
  );
  const closePreview = useCallback(
    () => setState({ preview: { open: false, kind: null, key: null, items: [] } }),
    [setState],
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

  const finishBulk = useCallback(
    (ids: string[]) => {
      const s = stateRef.current;
      const idSet = new Set(ids);
      let updated = 0;
      const photos = s.photos.map((p): Photo => {
        if (idSet.has(p.id) && !p.processed) {
          updated++;
          return {
            ...p,
            processed: true,
            status: "Likely",
            captionKey: "gen",
            tags: ["kyiv", "documentary", "street", "2026"],
            facts: [
              { text: "Location: confirmed via GPS", status: "confirmed" },
              { text: "Date: confirmed via EXIF", status: "confirmed" },
              { text: "People: verification pending", status: "pending" },
            ],
          };
        }
        return p;
      });
      setState({ photos, proc: { active: false, label: "", pct: 0 } });
      flashToast(`${ids.length} photos captioned · ${updated * 4} tags added`);
    },
    [setState, flashToast],
  );

  const runBulk = useCallback(() => {
    const s = stateRef.current;
    const ids = s.selectedIds.slice();
    const total = ids.length;
    if (!total) return;
    let i = 0;
    setState({ proc: { active: true, label: `Captioning 1 of ${total}…`, pct: 6 } });
    if (bulkTimer.current) clearInterval(bulkTimer.current);
    const tickMs = Math.max(180, 1700 / total);
    bulkTimer.current = setInterval(() => {
      i++;
      if (i > total) {
        if (bulkTimer.current) clearInterval(bulkTimer.current);
        setState({ proc: { active: true, label: "Detecting tags…", pct: 92 } });
        if (bulkTimeout.current) clearTimeout(bulkTimeout.current);
        bulkTimeout.current = setTimeout(() => finishBulk(ids), 480);
        return;
      }
      setState({
        proc: { active: true, label: `Captioning ${i} of ${total}…`, pct: Math.round(6 + (i / total) * 80) },
      });
    }, tickMs);
  }, [setState, finishBulk]);

  // ── Lifecycle: listeners + initial fit ────────────────────────────────────

  const [canvasHeight, setCanvasHeight] = useState(700);

  const setCanvasRef = useCallback((el: HTMLDivElement | null) => {
    canvasElRef.current = el;
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    const el = canvasElRef.current;
    if (el) el.addEventListener("wheel", wheel, { passive: false });
    let ro: ResizeObserver | undefined;
    const raf = requestAnimationFrame(() => {
      tryFit();
      if (el) setCanvasHeight(el.getBoundingClientRect().height || 700);
      if (el && typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => {
          tryFit();
          setCanvasHeight(el.getBoundingClientRect().height || 700);
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
      else if (s.preview.open) closePreview();
      else if (s.expanded.kind) closeExpand();
      else if (s.chatOpen) closeChat();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDrawer, closeSearch, closeHelp, closePreview, closeExpand, closeChat]);

  useEffect(() => {
    return () => {
      if (bulkTimer.current) clearInterval(bulkTimer.current);
      if (bulkTimeout.current) clearTimeout(bulkTimeout.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────

  const neuralLayout = useMemo(
    () => layoutNeural(state.photos, state.nodeOverrides),
    [state.photos, state.nodeOverrides],
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
  const showAddToProject = isNeural && selectedIds.size > 0;

  const projectPhotos = useMemo(
    () => filteredPhotos(state.photos, state.projCurrent),
    [state.photos, state.projCurrent, filteredPhotos],
  );

  const projectList: ProjectListItem[] = useMemo(
    () =>
      PROJECT_KEYS.map((k) => ({
        key: k,
        label: PROJECTS_META[k].label,
        color: PROJECTS_META[k].color,
        count: state.photos.filter((p) => p.project === k).length,
        active: state.projCurrent === k,
      })),
    [state.photos, state.projCurrent],
  );

  const projLabel =
    state.projCurrent === "all" ? "All my files" : PROJECTS_META[state.projCurrent].label;

  const timelineLayoutResult = useMemo(
    () => computeTimelineLayout(projectPhotos, state.tlOverrides, canvasHeight),
    [projectPhotos, state.tlOverrides, canvasHeight],
  );

  const senseBubblesResult = useMemo(() => computeSenseBubbles(projectPhotos), [projectPhotos]);
  const senseExpand = useMemo(
    () =>
      state.expanded.kind === "sense" && state.expanded.key
        ? computeSenseExpand(senseBubblesResult, state.expanded.key, state.expandOverrides)
        : null,
    [state.expanded, state.expandOverrides, senseBubblesResult],
  );

  const bulkShow = isTimelineView && selectedIds.size > 0;
  const bulkThumbs = useMemo(() => {
    const set = selectedIds;
    const sel = state.photos.filter((p) => set.has(p.id)).slice(0, 4);
    return sel.map((p, i) => ({ src: `https://picsum.photos/seed/${p.seed}/60/60`, ml: i === 0 ? 0 : -9 }));
  }, [state.photos, selectedIds]);

  return {
    scale: state.scale,
    tx: state.tx,
    ty: state.ty,
    tool: state.tool,
    view: state.view,
    sidebarExpanded: state.sidebarExpanded,
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
    neuralLayout,
    gridSize: Math.max(4, 40 * state.scale),
    gridPos: `${state.tx}px ${state.ty}px`,
    gridOpacity: isMapView ? 0 : 1,
    zoomPct: Math.round(state.scale * 100) + "%",
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
    setCanvasRef,
    onCanvasDown,
    onCardDown,
    onNodeDown,
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
    onFit: doFit,
    onZoomReset: doFit,
    toggleSidebar,
    setView,

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

    previewOpen: state.preview.open,
    previewTitle: state.preview.key ?? "",
    previewItems: state.preview.items,
    openPreview,
    closePreview,

    timelineLayout: timelineLayoutResult,
    onTlDown,

    senseBubbles: senseBubblesResult,
    senseExpand,
    expanded: state.expanded,
    toggleSenseExpand,
    closeExpand,
    onExpandFileDown,

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
