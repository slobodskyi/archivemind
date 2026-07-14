import type { CanvasPoint, Photo, PhotoGroup, PhotoSource } from "@/types";
import { COUNTRY_LATLON, GROUPS, SOURCES } from "./mock-data";
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

// ── Helpers (verbatim) ──────────────────────────────────────────────────────

export function hash(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return h;
}

export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Deterministic quadratic-bezier control point, offset to one side of the
 *  straight line by `str` × the line's own length — no Math.random. */
export function mkBez(sx: number, sy: number, ex: number, ey: number, seed: number, str: number): string {
  const dx = ex - sx,
    dy = ey - sy,
    len = Math.sqrt(dx * dx + dy * dy) || 1;
  const side = (seed % 2 === 0 ? 1 : -1) * (0.18 + (seed % 7) * 0.025);
  const cpx = (sx + ex) / 2 + (-dy / len) * len * side * str,
    cpy = (sy + ey) / 2 + (dx / len) * len * side * str;
  return `M ${sx.toFixed(1)},${sy.toFixed(1)} Q ${cpx.toFixed(1)},${cpy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
}

// ── Neural view: source gallery ─────────────────────────────────────────────
// One tile per connected source — retained for a possible future connector browser.
// content. No connecting lines. Tiles start scattered (deterministic
// golden-angle spiral, no Math.random) and can be dragged anywhere — a
// per-key override then wins over the scattered default. Folders/files within
// a source are no longer drilled into on canvas — double-clicking a source
// tile opens the Finder-style browser sidebar instead (see
// components/sidebar/SourceBrowserSidebar.tsx and groupBySourceFolder below).

export interface GalleryOverrides {
  source: Record<string, { x: number; y: number }>;
  asset: Record<string, CanvasPoint>;
  map: Record<string, CanvasPoint>;
  topic: Record<string, CanvasPoint>;
}

export const EMPTY_GALLERY_OVERRIDES: GalleryOverrides = { source: {}, asset: {}, map: {}, topic: {} };

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
  // Only sources that actually hold files become hubs — with real data the
  // canvas shows the archive as it is, not the full connector catalog.
  const keys = (Object.keys(SOURCES) as PhotoSource[]).filter((k) => (bySrc[k] ?? 0) > 0);
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

// ── Project canvas: direct asset gallery ───────────────────────────────────

const ASSET_TILE_LONG_EDGE = 148;
const ASSET_CELL_W = 184;
const ASSET_CELL_H = 176;
const ASSET_GRID_COLS = 6;
const ASSET_GRID_X = 80;
const ASSET_GRID_Y = 90;

function assetTileSize(photo: Pick<Photo, "w" | "h">): { w: number; h: number } {
  const sourceW = Number.isFinite(photo.w) && photo.w > 0 ? photo.w : 4;
  const sourceH = Number.isFinite(photo.h) && photo.h > 0 ? photo.h : 3;
  const aspect = sourceW / sourceH;
  if (aspect >= 1) {
    return { w: ASSET_TILE_LONG_EDGE, h: Math.max(88, Math.round(ASSET_TILE_LONG_EDGE / aspect)) };
  }
  return { w: Math.max(88, Math.round(ASSET_TILE_LONG_EDGE * aspect)), h: ASSET_TILE_LONG_EDGE };
}

function positionsBounds(pos: Record<string, TilePos>): Bounds {
  const values = Object.values(pos);
  if (values.length === 0) return { xl: 0, yt: 0, xr: 1000, yb: 700 };
  return {
    xl: Math.min(...values.map((p) => p.x)),
    yt: Math.min(...values.map((p) => p.y)),
    xr: Math.max(...values.map((p) => p.x + p.w)),
    yb: Math.max(...values.map((p) => p.y + p.h)),
  };
}

/**
 * Direct file layout for a project. The API returns newest-first, so reversing
 * makes new uploads append without moving existing default positions.
 * Overrides store centers so a later real preview/aspect ratio keeps the
 * user's drop/drag anchor stable.
 */
export function assetGallery(
  photos: readonly Pick<Photo, "id" | "w" | "h">[],
  overrides: Readonly<Record<string, CanvasPoint>>,
): { pos: Record<string, TilePos>; bounds: Bounds } {
  const pos: Record<string, TilePos> = {};
  [...photos].reverse().forEach((photo, index) => {
    const size = assetTileSize(photo);
    const col = index % ASSET_GRID_COLS;
    const row = Math.floor(index / ASSET_GRID_COLS);
    const defaultCenter = {
      x: ASSET_GRID_X + col * ASSET_CELL_W + ASSET_CELL_W / 2 + (hash(photo.id + "x") % 11) - 5,
      y: ASSET_GRID_Y + row * ASSET_CELL_H + ASSET_CELL_H / 2 + (hash(photo.id + "y") % 11) - 5,
    };
    const center = overrides[photo.id] ?? defaultCenter;
    pos[photo.id] = {
      x: center.x - size.w / 2,
      y: center.y - size.h / 2,
      w: size.w,
      h: size.h,
      cx: center.x,
      cy: center.y,
    };
  });
  return { pos, bounds: positionsBounds(pos) };
}

/** Centers a small grid of newly dropped assets around the pointer anchor. */
export function droppedAssetCenters(ids: readonly string[], anchor: CanvasPoint): Record<string, CanvasPoint> {
  if (ids.length === 0) return {};
  const cols = Math.min(4, Math.ceil(Math.sqrt(ids.length)));
  const rows = Math.ceil(ids.length / cols);
  const startX = anchor.x - ((cols - 1) * ASSET_CELL_W) / 2;
  const startY = anchor.y - ((rows - 1) * ASSET_CELL_H) / 2;
  return Object.fromEntries(
    ids.map((id, index) => {
      const row = Math.floor(index / cols);
      const rowStart = row * cols;
      const rowCount = Math.min(cols, ids.length - rowStart);
      const centeredRowX = anchor.x - ((rowCount - 1) * ASSET_CELL_W) / 2;
      return [
        id,
        {
          x: rowCount === cols ? startX + (index % cols) * ASSET_CELL_W : centeredRowX + (index - rowStart) * ASSET_CELL_W,
          y: startY + row * ASSET_CELL_H,
        },
      ];
    }),
  );
}

/** Strict rectangle intersection: touching an edge alone is not a hit. */
export function hitTestTiles(pos: Readonly<Record<string, TilePos>>, bounds: Bounds): string[] {
  return Object.entries(pos)
    .filter(([, tile]) =>
      tile.x < bounds.xr &&
      tile.x + tile.w > bounds.xl &&
      tile.y < bounds.yb &&
      tile.y + tile.h > bounds.yt,
    )
    .map(([id]) => id);
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

/** Shared scale/pan solve — same math the neural gallery, timeline, map, and topic fits all use. */
export function fitBounds(bounds: Bounds, rect: Rect): Transform {
  const leftPad = 24,
    pad = 60,
    top = 70,
    bottom = 104;
  const bw = Math.max(bounds.xr - bounds.xl, 1),
    bh = Math.max(bounds.yb - bounds.yt, 1);
  const availW = Math.max(1, rect.width - leftPad - pad * 2),
    availH = Math.max(1, rect.height - top - bottom);
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

/** Default zoom everywhere is 75% — Timeline's fixed column-grid transform
 *  uses it directly; neural/map/topic (real content bounds) apply it as a cap
 *  via fitCapped in useWorkspace, not here. */
export const DEFAULT_ZOOM = 0.75;

/** Only the neural asset grid (and map/topic clouds) resolve bounds this way
 *  — Timeline is a column grid with its own fixed fit transform below. */
export function fitView(view: ViewMode, rect: Rect): Transform {
  if (view === "timeline") {
    return { scale: DEFAULT_ZOOM, tx: 24 + 20, ty: 100 };
  }
  return fitBounds({ xl: 0, yt: 0, xr: 1000, yb: 700 }, rect);
}

// ── Timeline: real-capture-date month columns ───────────────────────────────
// Fixed-width columns, each header-labeled with its month + file count, tiles
// packed tightly against the header in a 2-per-row grid with small
// deterministic jitter. Map and Topic used to share this column layout too
// (ADR 0017) but moved to freeform clusters below (ADR 0018).

const COL_W = 340;
const COL_GAP = 40;
const TILE_MIN = 64;
const TILE_MAX = 96;
const TOP_Y = 4;
const MIN_CELL = 116;
const PER_ROW = Math.floor(COL_W / MIN_CELL); // 2

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `exif.dateTaken` is always `"YYYY-MM-DD HH:mm"` (lib/assets.ts's toExifData) —
 *  never absent, so an unparseable value only happens for malformed test data. */
function capturedAt(photo: Photo): Date {
  const d = new Date(photo.exif.dateTaken.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

export function monthOf(photo: Photo): string {
  const d = capturedAt(photo);
  return `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
}

function monthSortValue(key: string): number {
  const [abbr, yearStr] = key.split(" ");
  return parseInt(yearStr, 10) * 12 + MONTH_ABBR.indexOf(abbr);
}

export interface ColumnTilePos {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Which column this tile belongs to — lets a generic renderer clamp drag
   *  bounds without re-deriving the bucket key from the photo. */
  columnKey: string;
}

export interface LayoutColumn {
  key: string;
  /** Header text — usually equal to `key` (month, country); Topic prettifies
   *  its raw group id via GROUPS[key].label. */
  label: string;
  x: number;
  colH: number;
  count: number;
}

export interface ColumnGridLayout {
  columns: LayoutColumn[];
  tiles: Record<string, ColumnTilePos>;
  colWidth: number;
  colGap: number;
}

/** Shared column-packing math: given photos already bucketed by key (with a
 *  chosen column order and per-column sort), lay out fixed-width columns and
 *  pack each bucket's tiles tightly against the header. */
function buildColumnGrid(
  byBucket: Record<string, Photo[]>,
  orderedKeys: string[],
  labelOf: (key: string) => string,
  overrides: Record<string, { x: number; y: number }>,
): ColumnGridLayout {
  const columns: LayoutColumn[] = [];
  const tiles: Record<string, ColumnTilePos> = {};

  orderedKeys.forEach((key, ki) => {
    const items = byBucket[key];
    const rows = Math.max(1, Math.ceil(items.length / PER_ROW));
    // Pack rows tightly against the header instead of stretching to fill the
    // viewport — columns with few photos used to leave a big gap up top;
    // vertical scroll (not viewport-stretching) now handles tall columns.
    const colH = rows * MIN_CELL;
    const colX = ki * (COL_W + COL_GAP);
    columns.push({ key, label: labelOf(key), x: colX, colH, count: items.length });

    const cellW = COL_W / PER_ROW;
    const cellH = colH / rows;
    const jitterX = Math.max(4, cellW * 0.14);
    const jitterY = Math.max(4, cellH * 0.14);

    items.forEach((p, i) => {
      const col = i % PER_ROW;
      const row = Math.floor(i / PER_ROW);
      const cx = colX + col * cellW + cellW / 2;
      const h1 = hash(p.id);
      const h2 = hash(p.id) >>> 4;
      const jx = (h1 % Math.round(jitterX * 2)) - jitterX;
      // Top-anchor the tile within its row cell (small nonnegative jitter) so
      // row 0 packs tightly against the sticky header instead of being
      // center-aligned inside a 116 px cell.
      const jy = h2 % Math.round(jitterY);
      const w = TILE_MIN + (hash(p.id + "w") % (TILE_MAX - TILE_MIN));
      const h = Math.round(w * (p.h / p.w));
      let bx = cx + jx - w / 2;
      let by = TOP_Y + row * cellH + jy;
      if (overrides[p.id]) {
        bx = overrides[p.id].x;
        by = overrides[p.id].y;
      }
      tiles[p.id] = { x: bx, y: by, w, h, columnKey: key };
    });
  });

  return { columns, tiles, colWidth: COL_W, colGap: COL_GAP };
}

/** Timeline: columns are the distinct "Mon YYYY" months actually present in
 *  `photo.exif.dateTaken` (real EXIF capture time when the worker extracted
 *  one, otherwise the asset's upload time — never a placeholder), sorted
 *  chronologically. Supersedes the hash-bucketed placeholder documented as a
 *  preserved quirk in ADR 0003 — see ADR 0016. */
export function timelineLayout(
  photos: Photo[],
  tlOverrides: Record<string, { x: number; y: number }>,
): ColumnGridLayout {
  const byMonth: Record<string, Photo[]> = {};
  photos.forEach((p) => {
    const m = monthOf(p);
    (byMonth[m] = byMonth[m] || []).push(p);
  });
  const monthKeys = Object.keys(byMonth).sort((a, b) => monthSortValue(a) - monthSortValue(b));
  monthKeys.forEach((m) =>
    byMonth[m].sort((a, b) => capturedAt(a).getTime() - capturedAt(b).getTime() || hash(a.id + m) - hash(b.id + m)),
  );
  return buildColumnGrid(byMonth, monthKeys, (key) => key, tlOverrides);
}

// ── Map / Topic: freeform clusters ("clouds") connected by lines ───────────
// Each cluster ("cloud") is a group of photo tiles packed around a shared hub
// point, labeled above with the country/topic name, with every tile in the
// cloud connected to the hub by a line in that cloud's color. Photos that
// share the *other* dimension (e.g. two photos from different countries but
// the same topic, in Map view) get a direct line between them in a gradient
// blending both clouds' colors — "some files may have connections to files
// from different clouds." Unrecognized/unclassified photos land in one
// "Unsorted" cloud with no lines at all, in or out (ADR 0018). Tiles are
// freely draggable — a drag override simply wins over the packed position.

export interface CloudNode {
  key: string;
  label: string;
  color: string;
  hubX: number;
  hubY: number;
  /** Bounding radius of this cloud's tiles, for placing the label above them. */
  radius: number;
  count: number;
}

export interface CloudEdge {
  id: string;
  d: string;
  /** Equal to strokeEnd for a same-cloud (hub) edge — a solid color. Distinct
   *  colors mean a cross-cloud edge, rendered as a gradient between them. */
  strokeStart: string;
  strokeEnd: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  op: number;
  w: number;
}

export interface CloudLayout {
  clouds: CloudNode[];
  tiles: Record<string, TilePos>;
  edges: CloudEdge[];
  bounds: Bounds;
}

export const UNSORTED_CLOUD_KEY = "Unsorted";
const UNSORTED_CLOUD_COLOR = "#8a8f98";

/** Fixed visual gutter enforced between every pair of tiles, on top of their
 *  own bounding-circle radius — this is what makes "same space between each
 *  other by default" true regardless of each tile's own aspect ratio. */
const CLOUD_TILE_GAP = 18;
const CLOUD_CANVAS_CX = 760;
const CLOUD_CANVAS_CY = 520;
/** Hexagonal-ish packing rarely exceeds ~75% density once center-pull
 *  relaxation settles with mixed tile sizes — dividing by this instead of 1
 *  gives the macro cluster circle enough room that packCircles doesn't have
 *  to fight for space (which is what caused overlap before). */
const CLOUD_PACK_DENSITY = 0.62;

/** A tile's own bounding-circle radius (half its diagonal) plus the fixed
 *  gutter — using the *actual* rendered size (not a guessed constant) is
 *  what guarantees packCircles never overlaps two real tile rectangles. */
function cloudTileRadius(photo: Pick<Photo, "w" | "h">): number {
  const size = assetTileSize(photo);
  return Math.hypot(size.w, size.h) / 2 + CLOUD_TILE_GAP;
}

/** Deterministic Prim's-algorithm minimum spanning tree over a set of
 *  points — connects every point with the shortest possible total line
 *  length and no separate "hub" node: every edge runs between two real
 *  points. O(n²), fine for the small clusters a project's photos form. */
function buildMst(points: { id: string; cx: number; cy: number }[]): [string, string][] {
  if (points.length < 2) return [];
  const edges: [string, string][] = [];
  const inTree = new Set([points[0].id]);
  const remaining = points.slice(1);
  while (remaining.length) {
    let bestDist = Infinity,
      bestFrom = "",
      bestIdx = -1;
    for (const a of points) {
      if (!inTree.has(a.id)) continue;
      for (let i = 0; i < remaining.length; i++) {
        const b = remaining[i];
        const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
        if (d < bestDist) {
          bestDist = d;
          bestFrom = a.id;
          bestIdx = i;
        }
      }
    }
    const chosen = remaining[bestIdx];
    edges.push([bestFrom, chosen.id]);
    inTree.add(chosen.id);
    remaining.splice(bestIdx, 1);
  }
  return edges;
}

const CLOUD_GOLDEN_ANGLE = 2.39996;
const CLOUD_PACK_ITERATIONS = 500;
const CLOUD_PACK_CENTER_PULL = 0.012;

/** Deterministic circle-packing relaxation — no Math.random anywhere. */
export function packCircles(
  items: { key: string; r: number }[],
  cx: number,
  cy: number,
): Record<string, { x: number; y: number }> {
  const nodes = items.map((it, i) => {
    const angle = i * CLOUD_GOLDEN_ANGLE;
    const radius = 40 + i * 6;
    return { key: it.key, r: it.r, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
  for (let iter = 0; iter < CLOUD_PACK_ITERATIONS; iter++) {
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
      n.x += (cx - n.x) * CLOUD_PACK_CENTER_PULL;
      n.y += (cy - n.y) * CLOUD_PACK_CENTER_PULL;
    });
  }
  const result: Record<string, { x: number; y: number }> = {};
  nodes.forEach((n) => (result[n.key] = { x: n.x, y: n.y }));
  return result;
}

const MAP_CLOUD_COLORS = ["#39ff6a", "#5b9bff", "#ff7a5c", "#ffd166", "#c084fc", "#4fd1c5"];

function mapCloudColor(key: string): string {
  return key === UNSORTED_CLOUD_KEY ? UNSORTED_CLOUD_COLOR : MAP_CLOUD_COLORS[hash(key) % MAP_CLOUD_COLORS.length];
}

function topicCloudColor(key: string): string {
  return key === UNSORTED_CLOUD_KEY ? UNSORTED_CLOUD_COLOR : (GROUPS[key as PhotoGroup]?.color ?? UNSORTED_CLOUD_COLOR);
}

function buildCloudLayout(
  photos: readonly Photo[],
  primaryOf: (p: Photo) => string,
  secondaryOf: (p: Photo) => string,
  colorOf: (key: string) => string,
  labelOf: (key: string) => string,
  overrides: Record<string, CanvasPoint>,
): CloudLayout {
  const byPrimary: Record<string, Photo[]> = {};
  photos.forEach((p) => {
    const k = primaryOf(p);
    (byPrimary[k] = byPrimary[k] || []).push(p);
  });
  const primaryKeys = Object.keys(byPrimary).sort(
    (a, b) => byPrimary[b].length - byPrimary[a].length || a.localeCompare(b),
  );

  // Enclosing-circle estimate for N packed circles of known radii: the area
  // they need is sum(π·r²), so the enclosing radius is sqrt(that / density).
  const macroSized = primaryKeys.map((k) => {
    const sumR2 = byPrimary[k].reduce((acc, p) => acc + cloudTileRadius(p) ** 2, 0);
    return { key: k, r: Math.sqrt(sumR2 / CLOUD_PACK_DENSITY) + CLOUD_TILE_GAP };
  });
  const macroPos = packCircles(
    macroSized.map((s) => ({ key: s.key, r: s.r })),
    CLOUD_CANVAS_CX,
    CLOUD_CANVAS_CY,
  );

  const tiles: Record<string, TilePos> = {};
  const clouds: CloudNode[] = [];
  const tileCluster: Record<string, string> = {};

  primaryKeys.forEach((k) => {
    const items = byPrimary[k];
    const { x: hx, y: hy } = macroPos[k];
    const packed = packCircles(
      items.map((p) => ({ key: p.id, r: cloudTileRadius(p) })),
      hx,
      hy,
    );
    let maxDist = 0;
    items.forEach((p) => {
      const pt = overrides[p.id] ?? packed[p.id];
      const size = assetTileSize(p);
      tiles[p.id] = { x: pt.x - size.w / 2, y: pt.y - size.h / 2, w: size.w, h: size.h, cx: pt.x, cy: pt.y };
      tileCluster[p.id] = k;
      maxDist = Math.max(maxDist, Math.hypot(pt.x - hx, pt.y - hy) + Math.max(size.w, size.h) / 2);
    });
    clouds.push({
      key: k,
      label: labelOf(k),
      color: colorOf(k),
      hubX: hx,
      hubY: hy,
      radius: Math.max(70, maxDist + 24),
      count: items.length,
    });
  });

  const edges: CloudEdge[] = [];

  // File-to-file edges within each real cluster — a minimum spanning tree
  // over the tiles' own positions, so every line runs between two actual
  // files with no separate hub point anywhere (the Unsorted cloud gets none).
  primaryKeys.forEach((k) => {
    if (k === UNSORTED_CLOUD_KEY || byPrimary[k].length < 2) return;
    const color = colorOf(k);
    const points = byPrimary[k].map((p) => ({ id: p.id, cx: tiles[p.id].cx, cy: tiles[p.id].cy }));
    buildMst(points).forEach(([aId, bId]) => {
      const ta = tiles[aId],
        tb = tiles[bId];
      edges.push({
        id: `mst-${aId}-${bId}`,
        d: mkBez(ta.cx, ta.cy, tb.cx, tb.cy, hash(aId + bId), 0.42),
        strokeStart: color,
        strokeEnd: color,
        x1: ta.cx,
        y1: ta.cy,
        x2: tb.cx,
        y2: tb.cy,
        op: 0.32,
        w: 1.6,
      });
    });
  });

  // Cross-cloud edges: photos sharing the secondary key across ≥2 clusters —
  // one representative link per pair of clusters, not a full O(n²) tangle.
  const bySecondary: Record<string, Photo[]> = {};
  photos.forEach((p) => {
    if (tileCluster[p.id] === UNSORTED_CLOUD_KEY) return;
    const sk = secondaryOf(p);
    (bySecondary[sk] = bySecondary[sk] || []).push(p);
  });
  Object.values(bySecondary).forEach((items) => {
    const byCluster: Record<string, Photo[]> = {};
    items.forEach((p) => (byCluster[tileCluster[p.id]] = byCluster[tileCluster[p.id]] || []).push(p));
    const clusterKeys = Object.keys(byCluster);
    if (clusterKeys.length < 2) return;
    for (let i = 0; i < clusterKeys.length; i++) {
      const a = byCluster[clusterKeys[i]][0];
      const b = byCluster[clusterKeys[(i + 1) % clusterKeys.length]][0];
      if (a.id === b.id) continue;
      const ta = tiles[a.id],
        tb = tiles[b.id];
      const colorA = colorOf(tileCluster[a.id]),
        colorB = colorOf(tileCluster[b.id]);
      edges.push({
        id: `x-${a.id}-${b.id}`,
        d: mkBez(ta.cx, ta.cy, tb.cx, tb.cy, hash(a.id + b.id), 0.46),
        strokeStart: colorA,
        strokeEnd: colorB,
        x1: ta.cx,
        y1: ta.cy,
        x2: tb.cx,
        y2: tb.cy,
        op: 0.45,
        w: 2,
      });
      if (clusterKeys.length === 2) break; // wrap-around would just redraw the same pair
    }
  });

  return { clouds, tiles, edges, bounds: positionsBounds(tiles) };
}

/** Map: clouds are countries — real per-asset `country` data is still pending
 *  its own backend phase (ADR 0015/0016), so an unrecognized/default country
 *  lands in the Unsorted cloud rather than being silently mislabeled. Photos
 *  sharing a topic (`group`) across different countries get a cross-cloud
 *  gradient line. */
export function mapCloudLayout(photos: readonly Photo[], mapOverrides: Record<string, CanvasPoint>): CloudLayout {
  return buildCloudLayout(
    photos,
    (p) => (COUNTRY_LATLON[p.country] ? p.country : UNSORTED_CLOUD_KEY),
    (p) => p.group,
    mapCloudColor,
    (key) => key,
    mapOverrides,
  );
}

/** Topic: clouds are `photo.group`, labeled with its friendly name
 *  (GROUPS[key].label). Photos sharing a country across different topics get
 *  a cross-cloud gradient line. */
export function topicCloudLayout(photos: readonly Photo[], topicOverrides: Record<string, CanvasPoint>): CloudLayout {
  return buildCloudLayout(
    photos,
    (p) => p.group,
    (p) => (COUNTRY_LATLON[p.country] ? p.country : UNSORTED_CLOUD_KEY),
    topicCloudColor,
    (key) => GROUPS[key as PhotoGroup]?.label ?? key,
    topicOverrides,
  );
}

// ── Minimap: orientation aid for pannable canvas views ──────────────────────

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
