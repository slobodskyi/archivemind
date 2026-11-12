"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { latestPointerPosition, solvePinch, type PinchSnapshot, type ScreenPoint } from "@/lib/pinch";
import {
  clampCam,
  fitBox,
  fitCam,
  isZoomed,
  nativeZoom,
  resizeCam,
  swipeDirection,
  toggleZoom,
  viewerInsets,
  wheelZoomFactor,
  zoomAt,
  zoomPercent,
  zoomRange,
  type Insets,
  type Size,
  type ViewerCam,
  type ZoomRange,
} from "@/lib/viewer";

/** The canvas's own double-tap constants (useWorkspace) — one feel app-wide. */
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP = 24;
/** Movement that turns a press into a drag; below it a release is a tap. */
const DRAG_SLOP = 6;
/** Step for the + / − keys. */
const KEY_ZOOM_STEP = 1.5;

interface Geometry {
  stage: Size;
  pad: Insets;
  box: Size;
  native: number;
  range: ZoomRange;
}

type Gesture =
  | {
      kind: "pan" | "swipe";
      pointerType: string;
      start: ScreenPoint;
      cam: ViewerCam;
      moved: boolean;
      t0: number;
    }
  | { kind: "pinch"; snap: PinchSnapshot };

interface Options {
  stageRef: RefObject<HTMLDivElement | null>;
  /** The element sized and placed as the photo. Written directly, never through
   *  React state: a 120 Hz trackpad must not be 120 renders a second. */
  boxRef: RefObject<HTMLDivElement | null>;
  /** The zoom readout, written directly for the same reason. */
  labelRef: RefObject<HTMLElement | null>;
  /** Natural pixel size of the best image loaded so far (thumb → medium). */
  content: Size | null;
  /** The photo on screen — a new one always opens at fit. */
  resetKey: string;
  onSwipe: (dir: 1 | -1) => void;
  /** A single tap that turned out not to be half of a double tap (touch only). */
  onTap: () => void;
  /** The photo just left fit — the moment detail is wanted, which on touch is
   *  when the viewer reaches for the original. Fired from the gesture, never
   *  from a render. */
  onZoomIn?: () => void;
}

/** Pan / zoom / pinch / swipe for the fullscreen viewer (ADR 0054). The math is
 *  `lib/viewer.ts` and `lib/pinch.ts`; this is only the event plumbing. Writes
 *  are synchronous — pointer and wheel events already arrive at frame rate, and
 *  a rAF hop would freeze in a background tab for no gain. */
export function usePanZoom({ stageRef, boxRef, labelRef, content, resetKey, onSwipe, onTap, onZoomIn }: Options) {
  const cam = useRef<ViewerCam>({ z: 1, tx: 0, ty: 0 });
  const geo = useRef<Geometry | null>(null);
  const contentRef = useRef(content);
  const lastKey = useRef<string | null>(null);
  const lastAspect = useRef<number | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const zoomedRef = useRef(false);

  const pointers = useRef(new Map<number, ScreenPoint>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const tapTimer = useRef<number | null>(null);
  const callbacks = useRef({ onSwipe, onTap, onZoomIn });
  useEffect(() => {
    callbacks.current = { onSwipe, onTap, onZoomIn };
  });

  const apply = useCallback(
    (animate = false) => {
      const el = boxRef.current;
      const g = geo.current;
      if (!el || !g) return;
      const c = cam.current;
      el.style.transition = animate
        ? "left .2s cubic-bezier(.22,1,.36,1), top .2s cubic-bezier(.22,1,.36,1), width .2s cubic-bezier(.22,1,.36,1), height .2s cubic-bezier(.22,1,.36,1)"
        : "none";
      el.style.left = `${c.tx}px`;
      el.style.top = `${c.ty}px`;
      el.style.width = `${g.box.w * c.z}px`;
      el.style.height = `${g.box.h * c.z}px`;
      const z = isZoomed(c);
      if (labelRef.current) labelRef.current.textContent = z ? `${zoomPercent(c.z, g.native)}%` : "Fit";
      if (z !== zoomedRef.current) {
        zoomedRef.current = z;
        setZoomed(z);
        if (z) callbacks.current.onZoomIn?.();
      }
    },
    [boxRef, labelRef],
  );

  /** Re-measure the stage and re-derive fit. `reset` puts the photo back at
   *  fit; otherwise the zoom and the point at the centre are kept. */
  const layout = useCallback(
    (reset: boolean) => {
      const el = stageRef.current;
      const c = contentRef.current;
      if (!el || !c) return;
      const stage = { w: el.clientWidth, h: el.clientHeight };
      if (stage.w === 0 || stage.h === 0) return;
      const pad = viewerInsets(stage);
      const box = fitBox(c, stage, pad);
      const native = nativeZoom(box, c, window.devicePixelRatio || 1);
      const next: Geometry = { stage, pad, box, native, range: zoomRange(native) };
      const prev = geo.current;
      geo.current = next;
      cam.current =
        reset || !prev
          ? fitCam(box, stage, pad)
          : resizeCam(cam.current, prev, { box, stage, pad, range: next.range });
      apply();
    },
    [stageRef, apply],
  );

  // A new photo opens at fit. A better image of the SAME photo (thumb →
  // medium) keeps whatever zoom you are at — only a changed shape resets.
  useLayoutEffect(() => {
    contentRef.current = content;
    if (!content) return;
    const aspect = content.w / content.h;
    const reshaped = lastAspect.current == null || Math.abs(aspect / lastAspect.current - 1) > 0.02;
    const reset = lastKey.current !== resetKey || reshaped;
    lastKey.current = resetKey;
    lastAspect.current = aspect;
    layout(reset);
  }, [content, resetKey, layout]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => layout(false));
    ro.observe(el);
    return () => ro.disconnect();
  }, [stageRef, layout]);

  const zoomTo = useCallback(
    (z: number, px: number, py: number, animate = false) => {
      const g = geo.current;
      if (!g) return;
      cam.current = zoomAt(cam.current, z, px, py, g.box, g.stage, g.pad, g.range);
      apply(animate);
    },
    [apply],
  );

  // Wheel / trackpad: a native listener, because React's onWheel is passive
  // and could not stop ctrl-wheel from zooming the whole page instead.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo(cam.current.z * wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [stageRef, zoomTo]);

  useEffect(
    () => () => {
      if (tapTimer.current != null) window.clearTimeout(tapTimer.current);
    },
    [],
  );

  const toggleAt = useCallback(
    (px: number, py: number) => {
      const g = geo.current;
      if (!g) return;
      cam.current = toggleZoom(cam.current, px, py, g.box, g.stage, g.pad, g.range);
      apply(true);
    },
    [apply],
  );

  /** The zoom button: fit ⇄ detail around the middle of the screen. */
  const toggleCenter = useCallback(() => {
    const g = geo.current;
    if (g) toggleAt(g.stage.w / 2, g.stage.h / 2);
  }, [toggleAt]);

  /** + / − keys. */
  const zoomStep = useCallback(
    (dir: 1 | -1) => {
      const g = geo.current;
      if (!g) return;
      const factor = dir > 0 ? KEY_ZOOM_STEP : 1 / KEY_ZOOM_STEP;
      zoomTo(cam.current.z * factor, g.stage.w / 2, g.stage.h / 2, true);
    },
    [zoomTo],
  );

  const clearSwipeOffset = () => {
    if (boxRef.current) boxRef.current.style.transform = "";
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    try {
      // Keep receiving the drag when it leaves the stage. Throws for a pointer
      // the browser no longer considers active — never worth losing the press.
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const c = cam.current;
      clearSwipeOffset();
      gesture.current = {
        kind: "pinch",
        snap: { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, scale: c.z, tx: c.tx, ty: c.ty },
      };
    } else if (pointers.current.size === 1) {
      gesture.current = {
        kind: zoomedRef.current ? "pan" : "swipe",
        pointerType: e.pointerType,
        start: { x: e.clientX, y: e.clientY },
        cam: { ...cam.current },
        moved: false,
        t0: performance.now(),
      };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = latestPointerPosition(e.nativeEvent);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    const geom = geo.current;
    if (!g || !geom) return;
    if (g.kind === "pinch") {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const r = stageRef.current?.getBoundingClientRect();
      if (!r) return;
      const next = solvePinch(g.snap, a, b, r, geom.range.min, geom.range.max);
      if (!next) return;
      cam.current = clampCam({ z: next.scale, tx: next.tx, ty: next.ty }, geom.box, geom.stage, geom.pad, geom.range);
      apply();
      return;
    }
    const dx = p.x - g.start.x;
    const dy = p.y - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) > DRAG_SLOP) g.moved = true;
    if (!g.moved) return;
    if (g.kind === "pan") {
      cam.current = clampCam({ z: g.cam.z, tx: g.cam.tx + dx, ty: g.cam.ty + dy }, geom.box, geom.stage, geom.pad);
      apply();
    } else if (g.pointerType !== "mouse" && boxRef.current) {
      // A finger dragging a fitted photo shows where the swipe is going.
      boxRef.current.style.transform = `translateX(${dx}px)`;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch") {
      // Lifting one of two fingers hands the rest of the gesture to a pan, so
      // the photo doesn't stick until the other finger lifts too.
      const rest = [...pointers.current.values()][0];
      gesture.current = rest
        ? { kind: zoomedRef.current ? "pan" : "swipe", pointerType: e.pointerType, start: rest, cam: { ...cam.current }, moved: true, t0: 0 }
        : null;
      return;
    }
    if (pointers.current.size > 0) return;
    gesture.current = null;
    clearSwipeOffset();
    const dx = e.clientX - g.start.x;
    const dy = e.clientY - g.start.y;
    if (g.moved) {
      if (g.kind === "swipe" && g.pointerType !== "mouse") {
        const dir = swipeDirection(dx, dy);
        if (dir !== 0) callbacks.current.onSwipe(dir);
      }
      return;
    }
    const now = performance.now();
    if (now - g.t0 > 500) return; // a long press is not a tap
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return;
    const prev = lastTap.current;
    if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_SLOP) {
      lastTap.current = null;
      if (tapTimer.current != null) window.clearTimeout(tapTimer.current);
      tapTimer.current = null;
      toggleAt(e.clientX - r.left, e.clientY - r.top);
      return;
    }
    lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    if (g.pointerType !== "mouse") {
      if (tapTimer.current != null) window.clearTimeout(tapTimer.current);
      tapTimer.current = window.setTimeout(() => {
        tapTimer.current = null;
        callbacks.current.onTap();
      }, DOUBLE_TAP_MS);
    }
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      clearSwipeOffset();
    }
  };

  return {
    zoomed,
    toggleCenter,
    zoomStep,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
