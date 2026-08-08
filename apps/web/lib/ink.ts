import type { InkPoint } from "@archivemind/shared";

/** Freehand ink geometry (ADR 0041) — pure, deterministic, no `Math.random`,
 *  the same rule `lib/layout.ts` lives under.
 *
 *  A stroke arrives as raw pointer samples, is simplified, and is stored as
 *  points relative to its own bounding box. Rendering turns those back into SVG
 *  path data. Capture and render both go through here so a stroke can never be
 *  drawn from one reading of its points and hit-tested against another. */

/** Ramer–Douglas–Peucker. A Pencil at 120 Hz produces several hundred samples
 *  for a stroke the eye reads as one curve; most of them sit on a line between
 *  their neighbours and cost bytes on every load forever. Tolerance is in canvas
 *  units, so it is scale-independent — simplifying in screen space would make
 *  the same gesture store more points when zoomed in. */
export function simplifyStroke(points: InkPoint[], tolerance = 0.6): InkPoint[] {
  if (points.length <= 2) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // Iterative, not recursive: a long stroke recursed per segment can blow the
  // stack, and this runs on pointerup where a crash loses the stroke.
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    let worst = 0;
    let worstIndex = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(points[i], points[first], points[last]);
      if (d > worst) {
        worst = d;
        worstIndex = i;
      }
    }
    if (worstIndex !== -1 && worst > tolerance) {
      keep[worstIndex] = 1;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

function perpendicularDistance(p: InkPoint, a: InkPoint, b: InkPoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  // Degenerate segment (the stroke doubled back onto its start): fall back to
  // plain distance from the point, or every sample reads as distance NaN.
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / Math.sqrt(len2);
}

export interface StrokeBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The stroke's bounding box in canvas coordinates — this becomes the row's
 *  x/y/w/h, which is what makes an ink annotation's geometry mean the same
 *  thing a note's does: the extent of the thing itself. */
export function strokeBounds(points: InkPoint[]): StrokeBounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Shift absolute samples into the box's own frame, so the row can later be
 *  moved by patching x/y instead of rewriting every point. */
export function toRelative(points: InkPoint[], origin: { x: number; y: number }): InkPoint[] {
  return points.map(([x, y, p]) => [round(x - origin.x), round(y - origin.y), round(p, 100)] as InkPoint);
}

const round = (v: number, factor = 10) => Math.round(v * factor) / factor;

/** Centripetal Catmull-Rom through the points, emitted as cubic beziers — the
 *  standard way to get a curve that passes through every sample without the
 *  overshoot a uniform spline gives on the sharp direction changes handwriting
 *  is full of. A polyline would show every simplified corner as a visible kink. */
export function strokePath(points: InkPoint[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    // A tap. Rendered as a zero-length segment so the round linecap draws a dot;
    // an empty path would silently swallow it.
    const [x, y] = points[0];
    return `M ${f(x)},${f(y)} L ${f(x)},${f(y)}`;
  }

  let d = `M ${f(points[0][0])},${f(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}

const f = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);

/** How many pressure bands a stroke is split into when rendered. Real
 *  variable-width ink is an outline polygon; this is the cheap approximation —
 *  contiguous runs of similar pressure become their own constant-width path, so
 *  a Pencil stroke visibly thickens and thins for a handful of extra nodes
 *  instead of one node per sample. */
export const PRESSURE_BANDS = 4;

/** Pressure 0 means the device didn't report any (a mouse, or a pen that
 *  doesn't sense it) — treat it as a normal press rather than a zero-width
 *  line, which is what a literal reading would draw. */
export function bandOf(pressure: number): number {
  const p = pressure > 0 ? pressure : 0.5;
  return Math.min(PRESSURE_BANDS - 1, Math.floor(p * PRESSURE_BANDS));
}

/** Width in canvas units for a band, at a given nib size. The floor keeps the
 *  lightest band visible: a stroke that vanishes where the hand lifted reads as
 *  a rendering bug, not as delicacy. */
export function bandWidth(band: number, size: number): number {
  const t = (band + 1) / PRESSURE_BANDS;
  return Math.max(0.5, size * (0.35 + 0.65 * t));
}

export interface StrokeSegment {
  band: number;
  points: InkPoint[];
}

/** Split a stroke into contiguous same-band runs, each overlapping its
 *  neighbour by one point so the rendered paths join with no gap at the seam. */
export function pressureSegments(points: InkPoint[]): StrokeSegment[] {
  if (points.length === 0) return [];
  const segments: StrokeSegment[] = [];
  let current: StrokeSegment = { band: bandOf(points[0][2]), points: [points[0]] };
  for (let i = 1; i < points.length; i++) {
    const band = bandOf(points[i][2]);
    if (band === current.band) {
      current.points.push(points[i]);
      continue;
    }
    current.points.push(points[i]); // shared seam point
    segments.push(current);
    current = { band, points: [points[i]] };
  }
  segments.push(current);
  return segments;
}

/** Distance from a point to a stroke's polyline — the eraser's hit test.
 *  Against the simplified points, not the curve: the difference is under the
 *  eraser radius everywhere, and testing the real bezier would cost a solve per
 *  segment on every pointermove of an erase drag. */
export function distanceToStroke(points: InkPoint[], x: number, y: number): number {
  let best = Infinity;
  if (points.length === 1) return Math.hypot(x - points[0][0], y - points[0][1]);
  for (let i = 0; i < points.length - 1; i++) {
    const d = distanceToSegment(x, y, points[i], points[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

function distanceToSegment(x: number, y: number, a: InkPoint, b: InkPoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(x - a[0], y - a[1]);
  // Clamped projection: without the clamp, a point beyond either end measures
  // to the infinite line and an eraser would delete strokes it never touched.
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}
