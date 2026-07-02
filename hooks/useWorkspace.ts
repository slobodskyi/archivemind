"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaptionStyle, Language, Photo, ProjectKey, Tool, ViewMode } from "@/types";
import {
  EMPTY_OVERRIDES,
  fitView,
  layoutNeural,
  type NeuralLayout,
  type NodeOverrides,
} from "@/lib/layout";

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface WorkspaceState {
  scale: number;
  tx: number;
  ty: number;
  tool: Tool;
  view: ViewMode;
  sidebarExpanded: boolean;
  chatOpen: boolean;
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
  toast: { show: boolean; text: string };
  /** True while a canvas pan drag is active (drives the grabbing cursor). */
  panning: boolean;
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
  | null;

const DEFAULT_RECT = { left: 0, top: 0, width: 1000, height: 700 };

export interface Workspace {
  scale: number;
  tx: number;
  ty: number;
  tool: Tool;
  view: ViewMode;
  sidebarExpanded: boolean;
  projCurrent: ProjectKey | "all";
  photos: Photo[];
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
    toast: { show: false, text: "" },
    panning: false,
  });

  // Mirror of committed state, kept current for window-level event handlers.
  const stateRef = useRef(state);
  const dragRef = useRef<DragSession>(null);
  const canvasElRef = useRef<HTMLDivElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const onCardDown = useCallback((e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    dragRef.current = {
      mode: "click",
      id,
      sx: e.clientX,
      sy: e.clientY,
      moved: false,
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
    };
  }, []);

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
  const closeDrawer = useCallback(() => setState({ drawerId: null }), [setState]);
  const setLang = useCallback((l: Language) => setState({ drawerLang: l }), [setState]);
  const setStyle = useCallback((st: CaptionStyle) => setState({ drawerStyle: st }), [setState]);
  const toolSelect = useCallback(() => setState({ tool: "select" }), [setState]);
  const toolHand = useCallback(() => setState({ tool: "hand" }), [setState]);
  const toggleSidebar = useCallback(
    () => setState({ sidebarExpanded: !stateRef.current.sidebarExpanded }),
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
    const fit = fitView(s.view, s.photos, s.nodeOverrides, rect(), s.sidebarExpanded, s.chatOpen);
    setState(fit);
  }, [rect, setState]);

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
      if (!tryFit() && el && typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => {
          if (tryFit() && ro) ro.disconnect();
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
      if (stateRef.current.drawerId) closeDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDrawer]);

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

  return {
    scale: state.scale,
    tx: state.tx,
    ty: state.ty,
    tool: state.tool,
    view: state.view,
    sidebarExpanded: state.sidebarExpanded,
    projCurrent: state.projCurrent,
    photos: state.photos,
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
    gridOpacity: 1,
    zoomPct: Math.round(state.scale * 100) + "%",
    canvasTransform: `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`,
    canvasCursor: state.panning
      ? "grabbing"
      : state.tool === "hand"
        ? "grab"
        : "default",
    marquee,
    drawerPhoto,
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
  };
}
