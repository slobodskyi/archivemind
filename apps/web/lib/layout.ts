import type { Photo, PhotoGroup, PhotoSource } from "@/types";
import { GROUPS, SOURCES } from "./mock-data";
import type { ViewMode } from "@/types";

/**
 * Pure, deterministic layout algorithms ported verbatim from the source.
 * No randomness anywhere — every position is a function of the fixed mock data
 * plus user drag overrides.
 */

export interface Frame {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export interface StickyNote {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
}

export const STICKY_NOTE_COLORS = ["#ffe066", "#ff9eb8", "#8ecdf7", "#a8e6a1"];

export interface TilePos {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export interface EdgePath {
  d: string;
  stroke: string;
  op: number;
  w: number;
}

// ── Helpers (verbatim) ──────────────────────────────────────────────────────

export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function hash(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return h;
}

export function mkBez(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  seed: number,
  str: number,
): string {
  const dx = ex - sx,
    dy = ey - sy,
    len = Math.sqrt(dx * dx + dy * dy) || 1;
  const side = (seed % 2 === 0 ? 1 : -1) * (0.18 + (seed % 7) * 0.025);
  const cpx = (sx + ex) / 2 + (-dy / len) * len * side * str,
    cpy = (sy + ey) / 2 + (dx / len) * len * side * str;
  return (
    "M " + sx.toFixed(1) + "," + sy.toFixed(1) +
    " Q " + cpx.toFixed(1) + "," + cpy.toFixed(1) +
    " " + ex.toFixed(1) + "," + ey.toFixed(1)
  );
}

// ── Neural view: source gallery ─────────────────────────────────────────────
// One tile per connected source — the persistent "All my files" canvas
// content. No connecting lines. Tiles start scattered (deterministic
// golden-angle spiral, no Math.random) and can be dragged anywhere — a
// per-key override then wins over the scattered default. Folders/files within
// a source are no longer drilled into on canvas — double-clicking a source
// tile opens the Finder-style browser sidebar instead (see
// components/sidebar/SourceBrowserSidebar.tsx and groupBySourceFolder below).

export interface GalleryOverrides {
  source: Record<string, { x: number; y: number }>;
}

export const EMPTY_GALLERY_OVERRIDES: GalleryOverrides = { source: {} };

export interface GalleryTile {
  key: string;
  label: string;
  count: number;
  pos: TilePos;
}

export interface SourceGalleryTile extends GalleryTile {
  key: PhotoSource;
  abbr: string;
  color: string;
}

export interface SourceFolderGroup {
  key: string;
  label: string;
  photos: Photo[];
}

/** Groups one source's photos by their real `folder` field, for the Finder-style
 * source browser sidebar (one entry per folder, sorted alphabetically). */
export function groupBySourceFolder(photos: Photo[], source: PhotoSource): SourceFolderGroup[] {
  const byFolder: Record<string, Photo[]> = {};
  photos.forEach((p) => {
    if (p.source !== source) return;
    (byFolder[p.folder] = byFolder[p.folder] || []).push(p);
  });
  return Object.keys(byFolder)
    .sort()
    .map((k) => ({ key: k, label: k, photos: byFolder[k] }));
}

const SCATTER_GOLDEN_ANGLE = 2.39996;
const SCATTER_CX = 500;
const SCATTER_CY = 380;

/** Deterministic golden-angle spiral scatter, overridable per key by drag. */
function scatterLayout(
  items: { key: string; w: number; h: number }[],
  overrides: Record<string, { x: number; y: number }>,
): { pos: Record<string, TilePos>; bounds: Bounds } {
  const pos: Record<string, TilePos> = {};
  items.forEach(({ key, w, h }, i) => {
    const ov = overrides[key];
    let x: number, y: number;
    if (ov) {
      // Overrides store the dragged tile's center (matches onGalleryNodeDown/onCardDown's origCenter).
      x = ov.x - w / 2;
      y = ov.y - h / 2;
    } else {
      const angle = i * SCATTER_GOLDEN_ANGLE;
      const radius = 70 + i * 62 + (hash(key) % 50);
      const jx = (hash(key + "jx") % 60) - 30;
      const jy = (hash(key + "jy") % 60) - 30;
      // Math.cos/sin aren't required to be correctly rounded, so Node (SSR)
      // and the browser can differ by 1 ULP — enough to change the serialized
      // inline-style string and trip React's hydration diff. Snap to 0.01px so
      // both engines agree exactly; everything downstream (tile centers,
      // bounds, minimap dots) is exact IEEE arithmetic on these values.
      x = Math.round((SCATTER_CX + Math.cos(angle) * radius + jx - w / 2) * 100) / 100;
      y = Math.round((SCATTER_CY + Math.sin(angle) * radius + jy - h / 2) * 100) / 100;
    }
    pos[key] = { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
  });
  const vals = Object.values(pos);
  const bounds: Bounds = vals.length
    ? {
        xl: Math.min(...vals.map((p) => p.x)),
        yt: Math.min(...vals.map((p) => p.y)),
        xr: Math.max(...vals.map((p) => p.x + p.w)),
        yb: Math.max(...vals.map((p) => p.y + p.h)),
      }
    : { xl: 0, yt: 0, xr: 1000, yb: 700 };
  return { pos, bounds };
}

const SOURCE_TILE_W = 140;
const SOURCE_TILE_H = 110;

/** One tile per connected source. */
export function sourcesGallery(
  photos: Photo[],
  overrides: Record<string, { x: number; y: number }>,
): { tiles: SourceGalleryTile[]; pos: Record<string, TilePos>; bounds: Bounds } {
  const bySrc: Partial<Record<PhotoSource, number>> = {};
  photos.forEach((p) => {
    bySrc[p.source] = (bySrc[p.source] ?? 0) + 1;
  });
  const keys = Object.keys(SOURCES) as PhotoSource[];
  const { pos, bounds } = scatterLayout(
    keys.map((k) => ({ key: k, w: SOURCE_TILE_W, h: SOURCE_TILE_H })),
    overrides,
  );
  const tiles: SourceGalleryTile[] = keys.map((k) => ({
    key: k,
    label: SOURCES[k].label,
    abbr: SOURCES[k].abbr,
    color: SOURCES[k].color,
    count: bySrc[k] ?? 0,
    pos: pos[k],
  }));
  return { tiles, pos, bounds };
}

// ── Fit-to-content ───────────────────────────────────────────────────────────

export interface Bounds {
  xl: number;
  yt: number;
  xr: number;
  yb: number;
}

export interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

export interface Rect {
  width: number;
  height: number;
}

const MONTH_COUNT = 6;

export function viewBounds(view: ViewMode): Bounds {
  if (view === "timeline") return { xl: 0, yt: 0, xr: 60 + MONTH_COUNT * 380, yb: 900 };
  if (view === "map") return { xl: 0, yt: 0, xr: 1200, yb: 700 };
  if (view === "sense") return { xl: 0, yt: 0, xr: 1200, yb: 900 };
  return { xl: 0, yt: 0, xr: 1000, yb: 700 };
}

/** Shared scale/pan solve — same math the neural gallery, timeline, map, and sense fits all use. */
export function fitBounds(bounds: Bounds, rect: Rect): Transform {
  const leftPad = 24,
    pad = 60,
    top = 70,
    bottom = 104;
  const bw = Math.max(bounds.xr - bounds.xl, 1),
    bh = Math.max(bounds.yb - bounds.yt, 1);
  const availW = rect.width - leftPad - pad * 2,
    availH = rect.height - top - bottom;
  const sc = Math.min(availW / bw, availH / bh, 1.05);
  return {
    scale: sc,
    tx: leftPad + pad + (availW - bw * sc) / 2 - bounds.xl * sc,
    ty: top + (availH - bh * sc) / 2 - bounds.yt * sc,
  };
}

/** Centers `bounds` in `rect` at a fixed scale, instead of solving for a best-fit scale. */
export function centerAtScale(bounds: Bounds, rect: Rect, scale: number): Transform {
  const bw = bounds.xr - bounds.xl,
    bh = bounds.yb - bounds.yt;
  return {
    scale,
    tx: (rect.width - bw * scale) / 2 - bounds.xl * scale,
    ty: (rect.height - bh * scale) / 2 - bounds.yt * scale,
  };
}

export function fitView(view: ViewMode, rect: Rect): Transform {
  if (view === "timeline") {
    return { scale: 1, tx: 24 + 20, ty: 100 };
  }
  return fitBounds(viewBounds(view), rect);
}

// ── Timeline view: month columns + deterministic scattered tiles ───────────

export const MONTH_LIST = ["Feb 2026", "Mar 2026", "Apr 2026", "May 2026", "Jun 2026", "Jul 2026"];

const COL_W = 340;
const COL_GAP = 40;
const TILE_MIN = 64;
const TILE_MAX = 96;
const TOP_Y = 8;
const MIN_CELL = 116;
const PER_ROW = Math.floor(COL_W / MIN_CELL); // 2

export function monthOf(photo: Photo): string {
  return MONTH_LIST[hash(photo.id) % MONTH_LIST.length];
}

export interface TimelineTilePos {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TimelineMonthColumn {
  key: string;
  x: number;
  colH: number;
  count: number;
}

export interface TimelineLayout {
  months: TimelineMonthColumn[];
  tiles: Record<string, TimelineTilePos>;
  colWidth: number;
  colGap: number;
}

export function timelineLayout(
  photos: Photo[],
  tlOverrides: Record<string, { x: number; y: number }>,
): TimelineLayout {
  const byMonth: Record<string, Photo[]> = {};
  MONTH_LIST.forEach((m) => (byMonth[m] = []));
  photos.forEach((p) => byMonth[monthOf(p)].push(p));
  MONTH_LIST.forEach((m) => byMonth[m].sort((a, b) => hash(a.id + m) - hash(b.id + m)));

  const months: TimelineMonthColumn[] = [];
  const tiles: Record<string, TimelineTilePos> = {};

  MONTH_LIST.forEach((m, mi) => {
    const items = byMonth[m];
    const rows = Math.max(1, Math.ceil(items.length / PER_ROW));
    // Pack rows tightly against the header instead of stretching to fill the
    // viewport — months with few photos used to leave a big gap up top;
    // vertical scroll (not viewport-stretching) now handles tall columns.
    const colH = rows * MIN_CELL;
    const colX = mi * (COL_W + COL_GAP);
    months.push({ key: m, x: colX, colH, count: items.length });

    const cellW = COL_W / PER_ROW;
    const cellH = colH / rows;
    const jitterX = Math.max(4, cellW * 0.14);
    const jitterY = Math.max(4, cellH * 0.14);

    items.forEach((p, i) => {
      const col = i % PER_ROW;
      const row = Math.floor(i / PER_ROW);
      const cx = colX + col * cellW + cellW / 2;
      const cy = TOP_Y + row * cellH + cellH / 2;
      const h1 = hash(p.id);
      const h2 = hash(p.id) >>> 4;
      const jx = (h1 % Math.round(jitterX * 2)) - jitterX;
      const jy = (h2 % Math.round(jitterY * 2)) - jitterY;
      const w = TILE_MIN + (hash(p.id + "w") % (TILE_MAX - TILE_MIN));
      const h = Math.round(w * (p.h / p.w));
      let bx = cx + jx - w / 2;
      let by = cy + jy - h / 2;
      if (tlOverrides[p.id]) {
        bx = tlOverrides[p.id].x;
        by = tlOverrides[p.id].y;
      }
      tiles[p.id] = { x: bx, y: by, w, h };
    });
  });

  return { months, tiles, colWidth: COL_W, colGap: COL_GAP };
}

// ── Sense view: circle-pack bubbles clustered by group ──────────────────────

export interface SenseBubble {
  key: PhotoGroup;
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  count: number;
  items: Photo[];
}

const GOLDEN_ANGLE = 2.39996;
const PACK_ITERATIONS = 500;
const PACK_CENTER_PULL = 0.012;

/** Deterministic circle-packing relaxation — no Math.random anywhere. */
export function packCircles(
  items: { key: string; r: number }[],
  cx: number,
  cy: number,
): Record<string, { x: number; y: number }> {
  const nodes = items.map((it, i) => {
    const angle = i * GOLDEN_ANGLE;
    const radius = 40 + i * 6;
    return { key: it.key, r: it.r, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
  for (let iter = 0; iter < PACK_ITERATIONS; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i],
          b = nodes[j];
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const minDist = a.r + b.r;
        if (dist < minDist) {
          const overlap = (minDist - dist) / 2;
          const ux = dx / dist,
            uy = dy / dist;
          a.x -= ux * overlap;
          a.y -= uy * overlap;
          b.x += ux * overlap;
          b.y += uy * overlap;
        }
      }
    }
    nodes.forEach((n) => {
      n.x += (cx - n.x) * PACK_CENTER_PULL;
      n.y += (cy - n.y) * PACK_CENTER_PULL;
    });
  }
  const result: Record<string, { x: number; y: number }> = {};
  nodes.forEach((n) => (result[n.key] = { x: n.x, y: n.y }));
  return result;
}

export function senseBubbles(photos: Photo[]): SenseBubble[] {
  const byGroup: Partial<Record<PhotoGroup, Photo[]>> = {};
  photos.forEach((p) => {
    (byGroup[p.group] = byGroup[p.group] || []).push(p);
  });
  const groupKeys = Object.keys(byGroup) as PhotoGroup[];
  const sized = groupKeys.map((g) => ({
    key: g,
    size: Math.min(190, Math.max(88, 70 + (byGroup[g]?.length ?? 0) * 16)),
  }));
  const positions = packCircles(
    sized.map((s) => ({ key: s.key, r: s.size / 2 })),
    620,
    460,
  );
  return sized.map((s) => ({
    key: s.key,
    x: positions[s.key].x,
    y: positions[s.key].y,
    size: s.size,
    color: GROUPS[s.key].color,
    label: GROUPS[s.key].label,
    count: byGroup[s.key]?.length ?? 0,
    items: byGroup[s.key] ?? [],
  }));
}

// ── Expand overlays (Sense topic / Map marker drill-down) ────────────────────
// Files fan out from a bubble/marker toward free space, connected by thin
// Bezier edges. Shared shape so Sense (canvas space) and Map (screen space)
// render identically. Deterministic: no Math.random — curve seeded on id hash.

export interface ExpandFile {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;
}

export interface ExpandOverlay {
  edges: EdgePath[];
  files: ExpandFile[];
}

/**
 * Fan `items` out from an origin, spread ±0.9rad around `ang`, at radius `R`.
 * `ex,ey` is the edge origin on the bubble/marker surface. `overrides` lets a
 * dragged file pin to an absolute position. Pure — same inputs, same output.
 */
export function fanOut(
  items: Photo[],
  originX: number,
  originY: number,
  ang: number,
  R: number,
  ex: number,
  ey: number,
  fileW: number,
  stroke: string,
  op: number,
  overrides: Record<string, { x: number; y: number }>,
): ExpandOverlay {
  const n = items.length;
  const edges: EdgePath[] = [];
  const files: ExpandFile[] = [];
  items.forEach((p, i) => {
    const fang = ang + (n > 1 ? -0.9 + (i / (n - 1)) * 1.8 : 0);
    const w = fileW;
    const h = Math.round((p.h * w) / p.w);
    const fx0 = originX + Math.cos(fang) * R;
    const fy0 = originY + Math.sin(fang) * R;
    const ov = overrides[p.id];
    const fx = ov ? ov.x + w / 2 : fx0;
    const fy = ov ? ov.y + h / 2 : fy0;
    files.push({ id: p.id, x: fx - w / 2, y: fy - h / 2, w, h, src: `https://picsum.photos/seed/${p.seed}/200/200` });
    edges.push({ d: mkBez(ex, ey, fx, fy, hash(p.id), 0.18), stroke, op, w: 1 });
  });
  return { edges, files };
}

/** Sense topic drill-down: files fan out from a bubble, away from the pack centroid. */
export function senseExpandLayout(
  bubbles: SenseBubble[],
  key: string,
  overrides: Record<string, { x: number; y: number }>,
): ExpandOverlay | null {
  const node = bubbles.find((b) => b.key === key);
  if (!node || bubbles.length === 0) return null;
  let cxAll = 0;
  let cyAll = 0;
  bubbles.forEach((b) => {
    cxAll += b.x;
    cyAll += b.y;
  });
  cxAll /= bubbles.length;
  cyAll /= bubbles.length;
  const dx0 = node.x - cxAll;
  const dy0 = node.y - cyAll;
  const ang = Math.abs(dx0) < 0.01 && Math.abs(dy0) < 0.01 ? -Math.PI / 2 : Math.atan2(dy0, dx0);
  const R = node.size / 2 + 92;
  const ex = node.x + Math.cos(ang) * (node.size / 2);
  const ey = node.y + Math.sin(ang) * (node.size / 2);
  return fanOut(node.items, node.x, node.y, ang, R, ex, ey, 96, node.color, 0.35, overrides);
}

/**
 * Map marker drill-down. `cp` is the clicked marker's container point and
 * `otherCps` the other markers' — files fan away from their centroid (toward
 * free space). Screen space, so the caller recomputes on map pan/zoom.
 */
export function mapExpandLayout(
  items: Photo[],
  cp: { x: number; y: number },
  otherCps: { x: number; y: number }[],
  markerSize: number,
  overrides: Record<string, { x: number; y: number }>,
): ExpandOverlay {
  let cxAll = 0;
  let cyAll = 0;
  otherCps.forEach((o) => {
    cxAll += o.x;
    cyAll += o.y;
  });
  const cnt = otherCps.length;
  if (cnt) {
    cxAll /= cnt;
    cyAll /= cnt;
  }
  const dx0 = cp.x - cxAll;
  const dy0 = cp.y - cyAll;
  const ang = !cnt || (Math.abs(dx0) < 0.01 && Math.abs(dy0) < 0.01) ? -Math.PI / 2 : Math.atan2(dy0, dx0);
  const R = 118;
  const ex = cp.x + Math.cos(ang) * (markerSize / 2);
  const ey = cp.y + Math.sin(ang) * (markerSize / 2);
  return fanOut(items, cp.x, cp.y, ang, R, ex, ey, 88, "#39ff6a", 0.4, overrides);
}

// ── Minimap: orientation aid for pannable canvas views (not Map, which has
// its own navigation) ────────────────────────────────────────────────────

const MB_W = 180;
const MB_H = 120;
const MB_PAD = 8;

export interface MinimapLayout {
  show: boolean;
  dots: { x: number; y: number }[];
  vp: { x: number; y: number; w: number; h: number };
  /** Inverse-mapping params so a minimap click can be converted back to content coords. */
  originX: number;
  originY: number;
  mscale: number;
  offX: number;
  offY: number;
}

const EMPTY_MINIMAP: MinimapLayout = {
  show: false,
  dots: [],
  vp: { x: 0, y: 0, w: 0, h: 0 },
  originX: 0,
  originY: 0,
  mscale: 1,
  offX: 0,
  offY: 0,
};

export function minimapLayout(
  points: { x: number; y: number }[],
  scale: number,
  tx: number,
  ty: number,
  rect: Rect,
): MinimapLayout {
  if (!points.length) return EMPTY_MINIMAP;
  const xl = Math.min(...points.map((p) => p.x)),
    xr = Math.max(...points.map((p) => p.x));
  const yt = Math.min(...points.map((p) => p.y)),
    yb = Math.max(...points.map((p) => p.y));
  const bw = Math.max(xr - xl, 1),
    bh = Math.max(yb - yt, 1);
  const innerW = MB_W - MB_PAD * 2,
    innerH = MB_H - MB_PAD * 2;
  const mscale = Math.min(innerW / bw, innerH / bh);
  const offX = MB_PAD + (innerW - bw * mscale) / 2,
    offY = MB_PAD + (innerH - bh * mscale) / 2;
  const toMini = (cx: number, cy: number) => ({
    x: offX + (cx - xl) * mscale,
    y: offY + (cy - yt) * mscale,
  });
  const dots = points.map((p) => toMini(p.x, p.y));
  const vpX0 = -tx / scale,
    vpY0 = -ty / scale;
  const vpX1 = (rect.width - tx) / scale,
    vpY1 = (rect.height - ty) / scale;
  const tl = toMini(vpX0, vpY0),
    br = toMini(vpX1, vpY1);
  // Inset by the viewport box's own border width so it never sits flush against
  // the minimap's overflow:hidden edge — otherwise the border's outer half-pixel
  // gets clipped and the right/bottom edge appears to vanish.
  const VP_BORDER = 1.5;
  const cx0 = Math.max(VP_BORDER, Math.min(MB_W - VP_BORDER, tl.x)),
    cy0 = Math.max(VP_BORDER, Math.min(MB_H - VP_BORDER, tl.y));
  const cx1 = Math.max(VP_BORDER, Math.min(MB_W - VP_BORDER, br.x)),
    cy1 = Math.max(VP_BORDER, Math.min(MB_H - VP_BORDER, br.y));
  const vp = { x: cx0, y: cy0, w: Math.max(2, cx1 - cx0), h: Math.max(2, cy1 - cy0) };
  return { show: true, dots, vp, originX: xl, originY: yt, mscale, offX, offY };
}
