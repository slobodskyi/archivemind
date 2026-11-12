/** Fullscreen photo viewer (ADR 0054) — the pure half: where the photo sits on
 *  the stage at every zoom, and which photo ←/→ goes to. Deterministic, no DOM,
 *  so the invariants that make a viewer feel right (the point under the cursor
 *  stays under the cursor; a zoomed photo can never be dragged off-screen; a
 *  fitted photo is never cropped) are unit-tested rather than eyeballed.
 *
 *  Coordinates. The stage is the full-viewport area the photo is drawn in, in
 *  CSS px with its origin at the stage's top-left. `box` is the photo's size at
 *  z = 1 ("fit": contained in the stage minus `pad`). A camera places the photo
 *  at `tx, ty` with size `box × z`, so a point `c` inside the box (0..box.w)
 *  lands on screen at `t + c·z` — the same model `solvePinch` (lib/pinch.ts)
 *  solves, which is why a two-finger gesture can hand it a camera directly. */

export interface Size {
  w: number;
  h: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ViewerCam {
  /** Zoom relative to fit: 1 = the whole photo, contained. */
  z: number;
  tx: number;
  ty: number;
}

export interface ZoomRange {
  min: number;
  max: number;
  /** Where a double-click / the zoom button goes from fit: 1:1 with the loaded
   *  pixels when that is a real magnification, else a fixed 2×. */
  detail: number;
}

/** Below this width the chrome is compact and the photo runs edge to edge. */
export const VIEWER_COMPACT_W = 760;

/** Room kept clear at fit: the top bar's height above, a margin elsewhere, so
 *  no bar or edge ever covers part of a fitted photo — the drawer's cropped
 *  preview is exactly what this surface exists to fix. */
export function viewerInsets(stage: Size): Insets {
  return stage.w < VIEWER_COMPACT_W
    ? { top: 48, right: 0, bottom: 0, left: 0 }
    : { top: 56, right: 24, bottom: 24, left: 24 };
}

/** The photo's size at z = 1: contained in the padded stage. A 1024 px preview
 *  on a large screen is scaled UP to fill it — contain, never crop. */
export function fitBox(content: Size, stage: Size, pad: Insets): Size {
  const aw = Math.max(1, stage.w - pad.left - pad.right);
  const ah = Math.max(1, stage.h - pad.top - pad.bottom);
  if (!(content.w > 0 && content.h > 0)) return { w: aw, h: ah };
  const s = Math.min(aw / content.w, ah / content.h);
  return { w: content.w * s, h: content.h * s };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** One axis. Smaller than the stage: held at the padded centre (pulled inside
 *  the stage once it outgrows the padding), not draggable. Larger: free, but
 *  no edge may come inside the stage — the photo can't be lost off-screen. The
 *  two branches agree at size === stage, so zooming through it never jumps. */
function clampAxis(t: number, size: number, stage: number, padLo: number, padHi: number): number {
  if (size <= stage) return clamp(padLo + (stage - padLo - padHi - size) / 2, 0, stage - size);
  return clamp(t, stage - size, 0);
}

export function clampCam(cam: ViewerCam, box: Size, stage: Size, pad: Insets, range?: ZoomRange): ViewerCam {
  const z = range ? clamp(cam.z, range.min, range.max) : cam.z;
  return {
    z,
    tx: clampAxis(cam.tx, box.w * z, stage.w, pad.left, pad.right),
    ty: clampAxis(cam.ty, box.h * z, stage.h, pad.top, pad.bottom),
  };
}

export function fitCam(box: Size, stage: Size, pad: Insets): ViewerCam {
  return clampCam({ z: 1, tx: 0, ty: 0 }, box, stage, pad);
}

/** Zoom to `z` keeping the photo point under (px, py) — stage coordinates —
 *  under it. Clamped, so near an edge the point drifts only as far as the
 *  photo's own edge forces it. */
export function zoomAt(
  cam: ViewerCam,
  z: number,
  px: number,
  py: number,
  box: Size,
  stage: Size,
  pad: Insets,
  range: ZoomRange,
): ViewerCam {
  const nz = clamp(z, range.min, range.max);
  const cx = (px - cam.tx) / cam.z;
  const cy = (py - cam.ty) / cam.z;
  return clampCam({ z: nz, tx: px - cx * nz, ty: py - cy * nz }, box, stage, pad, range);
}

/** Double-click / double-tap: fit ⇄ detail, anchored on the clicked point. */
export function toggleZoom(
  cam: ViewerCam,
  px: number,
  py: number,
  box: Size,
  stage: Size,
  pad: Insets,
  range: ZoomRange,
): ViewerCam {
  return isZoomed(cam)
    ? fitCam(box, stage, pad)
    : zoomAt(cam, range.detail, px, py, box, stage, pad, range);
}

export function isZoomed(cam: ViewerCam): boolean {
  return cam.z > 1.001;
}

/** The z at which one loaded image pixel is one DEVICE pixel — "100%" the way
 *  Lightroom and Photoshop mean it on a retina screen. On a 2× display a 1024
 *  px preview is already past 100% at fit, which is the honest answer. */
export function nativeZoom(box: Size, natural: Size, dpr: number): number {
  if (!(natural.w > 0 && box.w > 0)) return 1;
  return natural.w / (box.w * (dpr > 0 ? dpr : 1));
}

export function zoomRange(native: number): ZoomRange {
  return { min: 1, max: Math.max(4, native * 2), detail: Math.max(2, native) };
}

export function zoomPercent(z: number, native: number): number {
  return Math.round((z / (native > 0 ? native : 1)) * 100);
}

/** One wheel event → a zoom multiplier. The canvas's own 0.0015 per pixel for
 *  a mouse wheel; a trackpad pinch arrives as a ctrl-wheel with tiny deltas and
 *  gets a steeper curve, or spreading two fingers barely moves the photo.
 *  Line/page delta modes (Firefox) are normalised to pixels first. */
export function wheelZoomFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-px * (ctrlKey ? 0.01 : 0.0015));
}

/** A released one-finger drag at fit: +1 next (swiped left), -1 previous, 0 a
 *  drag that was not decisively horizontal. */
export function swipeDirection(dx: number, dy: number, threshold = 60): -1 | 0 | 1 {
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

/** Keep the photo point at the stage centre when the stage resizes (browser
 *  fullscreen, a rotated iPad) — the zoom level relative to fit is kept, and
 *  what you were looking at stays in front of you. */
export function resizeCam(
  cam: ViewerCam,
  before: { box: Size; stage: Size },
  after: { box: Size; stage: Size; pad: Insets; range: ZoomRange },
): ViewerCam {
  const u = (before.stage.w / 2 - cam.tx) / (before.box.w * cam.z);
  const v = (before.stage.h / 2 - cam.ty) / (before.box.h * cam.z);
  const next = {
    z: cam.z,
    tx: after.stage.w / 2 - u * after.box.w * cam.z,
    ty: after.stage.h / 2 - v * after.box.h * cam.z,
  };
  return clampCam(next, after.box, after.stage, after.pad, after.range);
}

// ── Sequence ─────────────────────────────────────────────────────────────────

export interface ViewerSequence {
  ids: string[];
  start: string;
}

/** What ←/→ walks, decided once on open. Two or more selected photos, opened
 *  on one of them (or on none in particular), walk just the selection — the
 *  "compare these frames" case. Anything else walks the whole visible order.
 *  `order` is the current view's reading order (hidden tiles already out);
 *  a start that is not in it still opens, at the head of the sequence. */
export function viewerSequence(
  order: readonly string[],
  selected: readonly string[],
  startId: string | null,
): ViewerSequence | null {
  const chosen = new Set(selected);
  const sel = order.filter((id) => chosen.has(id));
  if (sel.length >= 2 && (startId == null || chosen.has(startId))) {
    const start = startId != null && sel.includes(startId) ? startId : sel[0];
    return { ids: sel, start };
  }
  const start = startId ?? sel[0] ?? null;
  if (start == null) return null;
  return { ids: order.includes(start) ? [...order] : [start, ...order], start };
}

/** The drawer's ←/→: the photo `dir` steps to, and the selection the canvas
 *  shows after it (null = leave it as it is). The rule the viewer applies when
 *  it closes: two or more selected photos that include the drawer's are walked
 *  as a set, in reading order, and kept whole — the set someone built is not
 *  theirs to lose to an arrow. Anything else walks the whole order and the
 *  selection moves with the drawer, so the green outline on the canvas is
 *  always on the photo the drawer is showing. `order` must contain `current`. */
export function drawerStep(
  order: readonly string[],
  selected: readonly string[],
  current: string,
  dir: number,
): { id: string; selectedIds: string[] | null } | null {
  const chosen = new Set(selected);
  const set = order.filter((id) => chosen.has(id));
  const walkingSet = set.length >= 2 && chosen.has(current);
  const id = stepSequence(walkingSet ? set : order, current, dir);
  if (!id) return null;
  return { id, selectedIds: walkingSet ? null : [id] };
}

/** The next id `dir` steps away, wrapping like the drawer's ←/→ does, skipping
 *  ids that no longer exist. Null when nothing else is left. */
export function stepSequence(
  ids: readonly string[],
  current: string,
  dir: number,
  alive?: ReadonlySet<string>,
): string | null {
  const n = ids.length;
  const i = ids.indexOf(current);
  if (n === 0 || i < 0 || dir === 0) return null;
  const step = dir > 0 ? 1 : -1;
  for (let k = 1; k < n; k++) {
    const id = ids[(((i + step * k) % n) + n) % n];
    if (!alive || alive.has(id)) return id;
  }
  return null;
}

/** After photos are removed (Delete inside the viewer): the sequence minus
 *  them, and where the viewer goes — forward if anything is left there, else
 *  back, else nowhere (the viewer closes). */
export function viewerAfterRemoval(
  ids: readonly string[],
  current: string | null,
  removed: ReadonlySet<string>,
): { ids: string[]; current: string | null } {
  const rest = ids.filter((id) => !removed.has(id));
  if (current == null || !removed.has(current)) return { ids: rest, current };
  const i = ids.indexOf(current);
  const after = ids.slice(i + 1).find((id) => !removed.has(id));
  const before = [...ids.slice(0, Math.max(0, i))].reverse().find((id) => !removed.has(id));
  return { ids: rest, current: after ?? before ?? null };
}
