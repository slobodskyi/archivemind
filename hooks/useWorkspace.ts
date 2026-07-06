"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaptionStyle, Language, Photo, PhotoGroup, Tool, ViewMode } from "@/types";
import {
  computeLayout,
  fitView,
  onFitTransform,
  onZoomResetTransform,
  type Layout,
} from "@/lib/layout";
import { EXIF_BLOCK, makeFilename } from "@/lib/mock-data";

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface ImpState {
  open: boolean;
  at: "rail" | "toolbar";
}

interface BulkOps {
  captions: boolean;
  tags: boolean;
  timeline: boolean;
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
  photos: Photo[];
  selectedIds: string[];
  hoveredId: string | null;
  bookmarks: string[];
  marquee: Marquee | null;
  drawerId: string | null;
  drawerLang: Language;
  drawerStyle: CaptionStyle;
  copyLabel: string;
  bulkOps: BulkOps;
  bulkLangs: string[];
  bulkStyle: CaptionStyle;
  proc: ProcState;
  toast: { show: boolean; text: string };
  imp: ImpState;
  search: boolean;
  /** True while a canvas pan drag is active (drives the grabbing cursor). */
  panning: boolean;
  /** True while a card drag is in progress (drives whether tile position transitions are disabled). */
  cardDragging: boolean;
}

interface FullRect {
  left: number;
  top: number;
  width: number;
  height: number;
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
      mode: "card";
      id: string;
      dragIds: string[];
      orig: Record<string, { x: number; y: number }>;
      sx: number;
      sy: number;
      moved: boolean;
      shift: boolean;
    }
  | null;

const DEFAULT_RECT: FullRect = { left: 0, top: 0, width: 1000, height: 700 };
const UPLOAD_GROUPS: PhotoGroup[] = ["rescue", "aid", "urban", "street"];
const UPLOAD_SEEDS = ["am-new1", "am-new2", "am-new3", "am-new4"];
const UPLOAD_SIZES: [number, number][] = [
  [236, 158],
  [210, 260],
  [252, 168],
  [224, 150],
];

export interface Workspace {
  scale: number;
  tx: number;
  ty: number;
  tool: Tool;
  view: ViewMode;
  photos: Photo[];
  selectedIds: Set<string>;
  bookmarks: Set<string>;
  hoveredId: string | null;
  drawerId: string | null;
  drawerLang: Language;
  drawerStyle: CaptionStyle;
  copyLabel: string;
  toast: { show: boolean; text: string };
  layout: Layout;
  zoomPct: string;
  canvasTransform: string;
  canvasCursor: string;
  marquee: { show: boolean; left: number; top: number; width: number; height: number };
  drawerPhoto: Photo | null;
  /** CSS transition shorthand for tile position/size — disabled while actively dragging in canvas view. */
  tileTransition: string;
  isCanvas: boolean;
  isTimelineView: boolean;
  isMapView: boolean;
  isSmartView: boolean;
  setCanvasRef: (el: HTMLDivElement | null) => void;
  onCanvasDown: (e: React.PointerEvent) => void;
  onCardDown: (e: React.PointerEvent, id: string) => void;
  setHover: (id: string | null) => void;
  toggleBookmark: (id: string) => void;
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
  setView: (v: ViewMode) => void;
  runAINav: () => void;

  // Search
  search: boolean;
  openSearch: () => void;
  closeSearch: () => void;

  // Import
  impOpen: boolean;
  impAt: "rail" | "toolbar";
  railAdd: () => void;
  addToolbar: () => void;
  doUpload: () => void;
  closeImport: () => void;

  // Bulk AI
  bulkShow: boolean;
  bulkIdle: boolean;
  bulkCount: number;
  bulkThumbs: { src: string; ml: number }[];
  bulkOps: BulkOps;
  bulkLangs: string[];
  bulkStyle: CaptionStyle;
  proc: ProcState;
  toggleOp: (k: keyof BulkOps) => void;
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
    view: "canvas",
    photos: initialPhotos,
    // Intentional non-empty demo default — matches the source mockup exactly.
    selectedIds: ["e", "g", "j"],
    hoveredId: null,
    bookmarks: [],
    marquee: null,
    drawerId: null,
    drawerLang: "EN",
    drawerStyle: "Agency",
    copyLabel: "Copy",
    bulkOps: { captions: true, tags: true, timeline: false, faces: false },
    bulkLangs: ["EN"],
    bulkStyle: "Agency",
    proc: { active: false, label: "", pct: 0 },
    toast: { show: false, text: "" },
    imp: { open: false, at: "rail" },
    search: false,
    panning: false,
    cardDragging: false,
  });

  // Mirror of committed state, kept current for window-level event handlers.
  const stateRef = useRef(state);
  const dragRef = useRef<DragSession>(null);
  const canvasElRef = useRef<HTMLDivElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bulkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const bulkTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setState = useCallback((patch: Partial<WorkspaceState>) => {
    setStateRaw((prev) => {
      const next = { ...prev, ...patch };
      stateRef.current = next;
      return next;
    });
  }, []);

  const rect = useCallback((): FullRect => {
    return canvasElRef.current ? canvasElRef.current.getBoundingClientRect() : DEFAULT_RECT;
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

  // ── Pan / zoom ────────────────────────────────────────────────────────────

  const wheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const r = rect();
      const cx = e.clientX - r.left,
        cy = e.clientY - r.top;
      const s = stateRef.current;
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
      if (s.imp.open) setState({ imp: { ...s.imp, open: false } });
      const r = rect();
      if (s.view !== "canvas") {
        dragRef.current = { mode: "pan", sx: e.clientX, sy: e.clientY, otx: s.tx, oty: s.ty };
        setState({ panning: true });
        return;
      }
      if (s.tool === "hand") {
        dragRef.current = { mode: "pan", sx: e.clientX, sy: e.clientY, otx: s.tx, oty: s.ty };
        setState({ panning: true });
      } else {
        const c = toContent(e.clientX, e.clientY);
        const dx0 = e.clientX - r.left,
          dy0 = e.clientY - r.top;
        dragRef.current = { mode: "marquee", startContent: c, dx0, dy0, x1: dx0, y1: dy0, moved: false };
        setState({ marquee: { x0: dx0, y0: dy0, x1: dx0, y1: dy0 } });
      }
    },
    [rect, toContent, setState],
  );

  const onCardDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      e.stopPropagation();
      const s = stateRef.current;
      if (s.imp.open) setState({ imp: { ...s.imp, open: false } });
      const sel = s.selectedIds;
      const dragIds = sel.includes(id) ? sel.slice() : [id];
      const orig: Record<string, { x: number; y: number }> = {};
      s.photos.forEach((p) => {
        if (dragIds.includes(p.id)) orig[p.id] = { x: p.x, y: p.y };
      });
      dragRef.current = { mode: "card", id, dragIds, orig, sx: e.clientX, sy: e.clientY, moved: false, shift: e.shiftKey };
      setState({ cardDragging: true });
    },
    [setState],
  );

  const openDrawer = useCallback(
    (id: string) => {
      const s = stateRef.current;
      setState({
        drawerId: id,
        drawerLang: "EN",
        drawerStyle: s.photos.find((p) => p.id === id)?.captionStyle || "Agency",
        copyLabel: "Copy",
      });
    },
    [setState],
  );

  const move = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const s = stateRef.current;
      if (d.mode === "pan") {
        setState({ tx: d.otx + (e.clientX - d.sx), ty: d.oty + (e.clientY - d.sy) });
      } else if (d.mode === "card") {
        if (Math.abs(e.clientX - d.sx) > 3 || Math.abs(e.clientY - d.sy) > 3) d.moved = true;
        if (s.view === "canvas") {
          const dx = (e.clientX - d.sx) / s.scale,
            dy = (e.clientY - d.sy) / s.scale;
          const photos = s.photos.map((p): Photo =>
            d.dragIds.includes(p.id) ? { ...p, x: d.orig[p.id].x + dx, y: d.orig[p.id].y + dy, anim: "none" } : p,
          );
          setState({ photos });
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
        // Hit-tests against each photo's own base x/y/w/h (matches source exactly —
        // marquee selection is a canvas-view concept, not layout-aware).
        const hit = s.photos.filter((p) => p.x < xr && p.x + p.w > xl && p.y < yb && p.y + p.h > yt).map((p) => p.id);
        setState({ marquee: { x0: d.dx0, y0: d.dy0, x1: d.x1, y1: d.y1 }, selectedIds: hit });
      }
    },
    [rect, toContent, setState],
  );

  const up = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (d.mode === "pan") {
      setState({ panning: false });
    } else if (d.mode === "card") {
      setState({ cardDragging: false });
      if (!d.moved) {
        const s = stateRef.current;
        if (d.shift) {
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
  const closeDrawer = useCallback(() => setState({ drawerId: null }), [setState]);
  const setLang = useCallback((l: Language) => setState({ drawerLang: l }), [setState]);
  const setStyle = useCallback((st: CaptionStyle) => setState({ drawerStyle: st }), [setState]);
  const toolSelect = useCallback(() => setState({ tool: "select" }), [setState]);
  const toolHand = useCallback(() => setState({ tool: "hand" }), [setState]);
  const clearSelection = useCallback(() => setState({ selectedIds: [], marquee: null }), [setState]);

  const toggleBookmark = useCallback(
    (id: string) => {
      const s = stateRef.current;
      const b = s.bookmarks.slice();
      const i = b.indexOf(id);
      if (i >= 0) b.splice(i, 1);
      else b.push(id);
      setState({ bookmarks: b });
    },
    [setState],
  );

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
              chip: "Scene from the Kyiv frontline archive documenting civilian life…",
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

  // ── Fit / view switching ─────────────────────────────────────────────────

  const doFit = useCallback(() => {
    const s = stateRef.current;
    const fit = fitView(s.view, s.photos, rect());
    if (fit) setState(fit);
  }, [rect, setState]);

  const onFit = useCallback(() => {
    const t = onFitTransform(stateRef.current.photos, rect());
    if (t) setState(t);
  }, [rect, setState]);

  const onZoomReset = useCallback(() => {
    setState(onZoomResetTransform(rect()));
  }, [rect, setState]);

  const setView = useCallback(
    (v: ViewMode) => {
      const s = stateRef.current;
      const fit = fitView(v, s.photos, rect()) || {};
      setState({ view: v, marquee: null, selectedIds: v === "canvas" ? s.selectedIds : [], ...fit });
    },
    [setState, rect],
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

  // ── Search ───────────────────────────────────────────────────────────────

  const openSearch = useCallback(() => setState({ search: true }), [setState]);
  const closeSearch = useCallback(() => setState({ search: false }), [setState]);

  // ── Import ───────────────────────────────────────────────────────────────

  const railAdd = useCallback(() => {
    const s = stateRef.current;
    setState({ imp: { open: !(s.imp.open && s.imp.at === "rail"), at: "rail" } });
  }, [setState]);

  const addToolbar = useCallback(() => {
    const s = stateRef.current;
    setState({ imp: { open: !(s.imp.open && s.imp.at === "toolbar"), at: "toolbar" } });
  }, [setState]);

  const closeImport = useCallback(
    () => setState({ imp: { ...stateRef.current.imp, open: false } }),
    [setState],
  );

  const doUpload = useCallback(() => {
    const s = stateRef.current;
    const r = rect();
    const c0 = toContent(r.left + r.width * 0.5, r.top + r.height * 0.42);
    const news: Photo[] = UPLOAD_SEEDS.map((seed, i) => {
      const id = "n" + Date.now() + i;
      return {
        id,
        seed,
        w: UPLOAD_SIZES[i][0],
        h: UPLOAD_SIZES[i][1],
        x: c0.x + (i % 2) * 260 - 130 + i * 14,
        y: c0.y + Math.floor(i / 2) * 240 - 100,
        filename: makeFilename(id),
        processed: false,
        status: "Needs check",
        captionKey: null,
        captionStyle: "Agency",
        chip: null,
        tags: null,
        facts: [{ text: "Analyze to extract facts", status: "unknown" }],
        time: "06-19 " + (9 + i) + ":30",
        day: "Jun 19",
        group: UPLOAD_GROUPS[i % UPLOAD_GROUPS.length],
        // Source never sets a country for uploaded photos — the Map view's
        // fallback-to-Ukraine grouping covers this, preserved verbatim.
        country: "",
        exif: { ...EXIF_BLOCK },
        anim: "amFadeScale .4s cubic-bezier(.22,1,.36,1) both",
      };
    });
    setState({ photos: [...s.photos, ...news], imp: { ...s.imp, open: false } });
    flashToast(UPLOAD_SEEDS.length + " photos imported");
  }, [rect, toContent, setState, flashToast]);

  // ── Bulk AI ──────────────────────────────────────────────────────────────

  const toggleOp = useCallback(
    (k: keyof BulkOps) => {
      const s = stateRef.current;
      setState({ bulkOps: { ...s.bulkOps, [k]: !s.bulkOps[k] } });
    },
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
      let tagCount = 0;
      const photos = s.photos.map((p): Photo => {
        if (!idSet.has(p.id) || p.processed) return p;
        tagCount += 4;
        return {
          ...p,
          processed: true,
          status: "Likely",
          captionKey: "gen",
          captionStyle: "Agency",
          chip: "Scene from the Kyiv frontline archive documenting civilian life…",
          tags: ["kyiv", "documentary", "street", "2026"],
          facts: [
            { text: "Location: confirmed via GPS", status: "confirmed" },
            { text: "Date: confirmed via EXIF", status: "confirmed" },
            { text: "People: verification pending", status: "pending" },
          ],
        };
      });
      setState({ photos, proc: { active: false, label: "", pct: 0 } });
      flashToast(`${ids.length} photos captioned · ${tagCount} tags added`);
    },
    [setState, flashToast],
  );

  const runBulk = useCallback(() => {
    const s = stateRef.current;
    if (s.proc.active) return;
    const O = s.bulkOps;
    if (!O.captions && !O.tags && !O.timeline && !O.faces) {
      flashToast("Select an operation to run");
      return;
    }
    const ids = s.selectedIds.slice();
    if (!ids.length) return;
    const total = ids.length;
    setState({ proc: { active: true, label: `Captioning 1 of ${total}…`, pct: 6 }, drawerId: null });
    let i = 1;
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
  }, [setState, finishBulk, flashToast]);

  const runAINav = useCallback(() => {
    if (stateRef.current.selectedIds.length) runBulk();
    else flashToast("Select photos to analyze");
  }, [runBulk, flashToast]);

  // ── Lifecycle: listeners + initial fit ────────────────────────────────────

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
      if (el && typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => tryFit());
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
    return () => {
      if (bulkTimer.current) clearInterval(bulkTimer.current);
      if (bulkTimeout.current) clearTimeout(bulkTimeout.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────

  const layout = useMemo(() => computeLayout(state.view, state.photos), [state.view, state.photos]);

  const selectedIds = useMemo(() => new Set(state.selectedIds), [state.selectedIds]);
  const bookmarks = useMemo(() => new Set(state.bookmarks), [state.bookmarks]);

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

  const isCanvas = state.view === "canvas";
  const isTimelineView = state.view === "timeline";
  const isMapView = state.view === "map";
  const isSmartView = state.view === "smart";

  const tileTransition =
    state.cardDragging && isCanvas
      ? "none"
      : "left .55s cubic-bezier(.22,1,.36,1), top .55s cubic-bezier(.22,1,.36,1), width .55s cubic-bezier(.22,1,.36,1)";

  const bulkShow = selectedIds.size > 0 && !state.search;
  const bulkThumbs = useMemo(() => {
    const sel = state.photos.filter((p) => selectedIds.has(p.id)).slice(0, 4);
    return sel.map((p, i) => ({ src: `https://picsum.photos/seed/${p.seed}/60/60`, ml: i === 0 ? 0 : -9 }));
  }, [state.photos, selectedIds]);

  return {
    scale: state.scale,
    tx: state.tx,
    ty: state.ty,
    tool: state.tool,
    view: state.view,
    photos: state.photos,
    selectedIds,
    bookmarks,
    hoveredId: state.hoveredId,
    drawerId: state.drawerId,
    drawerLang: state.drawerLang,
    drawerStyle: state.drawerStyle,
    copyLabel: state.copyLabel,
    toast: state.toast,
    layout,
    zoomPct: Math.round(state.scale * 100) + "%",
    canvasTransform: `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`,
    canvasCursor: state.panning ? "grabbing" : state.tool === "hand" || state.view !== "canvas" ? "grab" : "default",
    marquee,
    drawerPhoto,
    tileTransition,
    isCanvas,
    isTimelineView,
    isMapView,
    isSmartView,
    setCanvasRef,
    onCanvasDown,
    onCardDown,
    setHover,
    toggleBookmark,
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
    onFit,
    onZoomReset,
    setView,
    runAINav,

    search: state.search,
    openSearch,
    closeSearch,

    impOpen: state.imp.open,
    impAt: state.imp.at,
    railAdd,
    addToolbar,
    doUpload,
    closeImport,

    bulkShow,
    bulkIdle: !state.proc.active,
    bulkCount: selectedIds.size,
    bulkThumbs,
    bulkOps: state.bulkOps,
    bulkLangs: state.bulkLangs,
    bulkStyle: state.bulkStyle,
    proc: state.proc,
    toggleOp,
    toggleBulkLang,
    setBulkStyle: setBulkStyleAction,
    clearSelection,
    runBulk,

    flashToast,
  };
}
