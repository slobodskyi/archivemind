export interface ScreenPoint {
  x: number;
  y: number;
}

export interface PointerSample {
  clientX: number;
  clientY: number;
}

export interface CoalescedPointerSample extends PointerSample {
  getCoalescedEvents?: () => PointerSample[];
}

export interface PinchSnapshot {
  dist: number;
  cx: number;
  cy: number;
  scale: number;
  tx: number;
  ty: number;
}

export interface PinchCamera {
  scale: number;
  tx: number;
  ty: number;
}

/** Browsers may batch several high-frequency pointer samples into one event.
 *  The last coalesced sample is the freshest position and keeps both fingers
 *  on the same animation-frame clock instead of rendering an older coordinate. */
export function latestPointerPosition(event: CoalescedPointerSample): ScreenPoint {
  const samples = event.getCoalescedEvents?.();
  const latest = samples?.length ? samples[samples.length - 1] : event;
  return { x: latest.clientX, y: latest.clientY };
}

/** Solve a two-finger gesture from the immutable camera captured at its start.
 *  The content point below the original midpoint stays below the live midpoint,
 *  so spreading zooms and moving both fingers together pans without drift. */
export function solvePinch(
  snapshot: PinchSnapshot,
  a: ScreenPoint,
  b: ScreenPoint,
  rect: { left: number; top: number },
  minScale = 0.05,
  maxScale = 4,
): PinchCamera | null {
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  if (dist < 1 || snapshot.dist < 1 || snapshot.scale <= 0) return null;

  const scale = Math.min(maxScale, Math.max(minScale, (snapshot.scale * dist) / snapshot.dist));
  const contentX = (snapshot.cx - rect.left - snapshot.tx) / snapshot.scale;
  const contentY = (snapshot.cy - rect.top - snapshot.ty) / snapshot.scale;
  const midpointX = (a.x + b.x) / 2 - rect.left;
  const midpointY = (a.y + b.y) / 2 - rect.top;
  const camera = {
    scale,
    tx: midpointX - contentX * scale,
    ty: midpointY - contentY * scale,
  };

  return Object.values(camera).every(Number.isFinite) ? camera : null;
}
