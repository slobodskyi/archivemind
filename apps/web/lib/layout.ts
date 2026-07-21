import type { CanvasPoint, Photo, PhotoGroup, PhotoSource } from "@/types";
import { GROUPS, SOURCES } from "./mock-data";

/**
 * Pure, deterministic layout algorithms — no randomness anywhere; every
 * position is a function of the input photos plus user drag overrides.
 * Part original mockup ports (asset grid, scatter, minimap), part new code:
 * the cloud canvas (ADR 0022) and the timeline date axis (ADR 0024).
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
  timeline: Record<string, CanvasPoint>;
}

export const EMPTY_GALLERY_OVERRIDES: GalleryOverrides = { source: {}, asset: {}, map: {}, topic: {}, timeline: {} };

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

/** Default zoom everywhere is 75% — every view opens *centered at this fixed
 *  scale* (fitDefaultZoom in useWorkspace → centerAtScale); oversized content
 *  overflows and pans (ADR 0022). Not a cap: nothing shrinks below it. */
export const DEFAULT_ZOOM = 0.75;

// ── Timeline: real-capture-date grouping ────────────────────────────────────
// Timeline groups photos by their exact capture *day*; the horizontal axis
// layout below (timelineAxisLayout) lays those days out as evenly-spaced,
// labeled date columns (ADR 0024).

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `exif.dateTaken` is always `"YYYY-MM-DD HH:mm"` (lib/assets.ts's toExifData) —
 *  never absent, so an unparseable value only happens for malformed data. The
 *  fallback is LOCAL midnight Jan 1 1970 (not `new Date(0)` = UTC midnight):
 *  dayKeyOf reads local getters, so the UTC epoch would bucket as 1969-12-31
 *  in any timezone west of UTC. Local-midnight keys "1970-01-01" everywhere. */
function capturedAt(photo: Photo): Date {
  const d = new Date(photo.exif.dateTaken.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? new Date(1970, 0, 1) : d;
}

/** Sortable day key "YYYY-MM-DD" from a photo's capture date. */
function dayKeyOf(photo: Photo): string {
  const d = capturedAt(photo);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "YYYY-MM-DD" → the on-axis label "DD/MM/YYYY". */
function dayLabel(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

// ── Timeline / Map / Topic: freeform clusters ("clouds") connected by lines ─
// Each cluster ("cloud") is a group of photo tiles packed together, labeled on
// its colored backdrop. Connecting lines are REAL relations (ADR 0022): two
// files are linked iff they share at least one AI tag (`photo.tags`, written by
// the analyze job). Same-cloud links render in the cloud's color, slightly
// stronger the more tags the pair shares; links across clouds render as a
// gradient blending both clouds' colors, one strongest representative link per
// pair of clouds so the canvas never becomes a tangle. Unanalyzed (untagged)
// files simply have no lines — the web itself shows what AI has processed. A
// tile dropped onto an artboard (frame) is detached from the web — its lines
// are removed (ADR 0022). Tiles are freely draggable — a drag override simply
// wins over the packed position, and those overrides persist per project
// (ADR 0022).

export interface CloudNode {
  key: string;
  label: string;
  color: string;
  count: number;
  /** Label anchor: top-center of the cloud's *current* tile bbox (override-aware),
   *  so the label sits on the colored backdrop above the tiles — visible, and
   *  always tracking the group as its files move (ADR 0022). */
  labelX: number;
  labelY: number;
  /** Bounding box of the cloud's current tiles, for the blurred backdrop blob
   *  that visually groups them (ADR 0022). */
  bx: number;
  by: number;
  bw: number;
  bh: number;
}

export interface CloudEdge {
  id: string;
  d: string;
  /** Same-cloud edges always carry strokeStart === strokeEnd (solid color).
   *  Cross-cloud edges carry each cloud's color — usually distinct (rendered
   *  as a gradient) but the 6-color hash palette CAN collide, so equal colors
   *  do NOT imply same-cloud; classify by the id prefix (`tag-` vs `x-`). */
  strokeStart: string;
  strokeEnd: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  op: number;
  w: number;
  /** The cloud a same-cloud (tag) edge belongs to; undefined for cross-cloud
   *  bridges. Lets the renderer keep the focused cloud's lines bright and fade
   *  the rest only halfway (ADR 0024). */
  cloudKey?: string;
}

export interface CloudLayout {
  clouds: CloudNode[];
  tiles: Record<string, TilePos>;
  edges: CloudEdge[];
  bounds: Bounds;
  /** Which cloud each tile belongs to (tile id → cloud key) — lets the renderer
   *  fade non-focused clouds and drag a whole cloud by its label (ADR 0024). */
  tileCloud: Record<string, string>;
  /** Present only for the Timeline view: a horizontal date axis to draw, with a
   *  tick at each cloud's `labelX`. Map/Topic leave this undefined. */
  axis?: { y: number; x1: number; x2: number };
}

export const UNSORTED_CLOUD_KEY = "Unsorted";
const UNSORTED_CLOUD_COLOR = "#8a8f98";

/** Cap 1 (ADR 0022): a tag attached to more linkable files than this is treated
 *  as ambient vocabulary, not a relation, and draws no lines. Keeps candidate
 *  pairs bounded even when Gemini stamps a near-universal tag on the archive. */
export const TAG_LINK_MEMBER_CAP = 24;
/** Cap 2 (ADR 0022): per-file budget of same-cloud links (strongest kept, a
 *  link survives if either endpoint keeps it) — bounds edges at O(n), not O(n²). */
export const SAME_CLOUD_LINKS_PER_FILE = 4;

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


function topicCloudColor(key: string): string {
  if (key === UNSORTED_CLOUD_KEY) return UNSORTED_CLOUD_COLOR;
  // Mock seed groups keep their curated GROUPS colors; real tag-derived
  // topics (ADR 0023) are arbitrary strings and hash into the shared palette.
  return GROUPS[key as PhotoGroup]?.color ?? MAP_CLOUD_COLORS[hash(key) % MAP_CLOUD_COLORS.length];
}

/** A stable color per Timeline date key, drawn from the same palette Map uses. */
function timelineCloudColor(key: string): string {
  return MAP_CLOUD_COLORS[hash(key) % MAP_CLOUD_COLORS.length];
}

function buildCloudLayout(
  photos: readonly Photo[],
  primaryOf: (p: Photo) => string,
  colorOf: (key: string) => string,
  labelOf: (key: string) => string,
  overrides: Record<string, CanvasPoint>,
  /** Frames (artboards) on the canvas — any tile whose center lands inside one
   *  is detached from the connecting-line web (ADR 0022). */
  frames: readonly Frame[],
): CloudLayout {
  const byPrimary: Record<string, Photo[]> = {};
  photos.forEach((p) => {
    const k = primaryOf(p);
    (byPrimary[k] = byPrimary[k] || []).push(p);
  });
  // Largest cluster first (name tie-break) — packs the dominant cloud centrally.
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
    // Label anchor + backdrop bbox are derived from the *live* tile positions
    // (override-aware), not the fixed macro hub — so both track the group as
    // its files are dragged and never strand (ADR 0022).
    let xl = Infinity,
      yt = Infinity,
      xr = -Infinity,
      yb = -Infinity;
    items.forEach((p) => {
      const pt = overrides[p.id] ?? packed[p.id];
      const size = assetTileSize(p);
      tiles[p.id] = { x: pt.x - size.w / 2, y: pt.y - size.h / 2, w: size.w, h: size.h, cx: pt.x, cy: pt.y };
      tileCluster[p.id] = k;
      xl = Math.min(xl, pt.x - size.w / 2);
      yt = Math.min(yt, pt.y - size.h / 2);
      xr = Math.max(xr, pt.x + size.w / 2);
      yb = Math.max(yb, pt.y + size.h / 2);
    });
    clouds.push({
      key: k,
      label: labelOf(k),
      color: colorOf(k),
      count: items.length,
      labelX: (xl + xr) / 2,
      labelY: yt,
      bx: xl,
      by: yt,
      bw: xr - xl,
      bh: yb - yt,
    });
  });

  const edges: CloudEdge[] = [];

  // A file dropped onto an artboard (frame) is detached from the web — its
  // connecting lines are removed so it reads as pulled out of the cluster.
  const detached = new Set<string>();
  if (frames.length) {
    for (const id of Object.keys(tiles)) {
      const t = tiles[id];
      if (frames.some((f) => t.cx >= f.x && t.cx <= f.x + f.w && t.cy >= f.y && t.cy <= f.y + f.h)) {
        detached.add(id);
      }
    }
  }

  // Edges are real relations (ADR 0022): a pair of files is linked when it
  // shares a *discriminative* AI tag. An inverted index (tag → linkable photo
  // ids) turns that into candidate pairs; counting how many tags each pair
  // shares drives the line's weight. Untagged (unanalyzed) and artboard-
  // detached files never enter the index, so they have no lines — by design,
  // not by omission. Two caps keep the web O(n) instead of O(n²) — real data
  // routinely concentrates in one big cloud (Map's inert country, ADR 0018; a
  // dominant Topic when one theme covers most of a project), so without them a
  // common tag at the 500-asset read limit means ~125k SVG paths and a frozen
  // tab:
  const byTag: Record<string, string[]> = {};
  photos.forEach((p) => {
    if (detached.has(p.id) || !p.tags) return;
    // De-dupe per photo: the same tag NAME can be two DB rows (unique key is
    // name+category, and re-analyze can drift the category), and a duplicate
    // here would fabricate self-pairs and double-count pair weights.
    for (const tag of new Set(p.tags)) (byTag[tag] = byTag[tag] || []).push(p.id);
  });
  // Pair key is id-ordered so (a,b) and (b,a) accumulate into one entry; Map
  // iteration is insertion-ordered, so edge order stays deterministic.
  const sharedTags = new Map<string, { a: string; b: string; n: number }>();
  Object.values(byTag).forEach((ids) => {
    // Cap 1: a tag attached to more files than this is ambient vocabulary
    // ("photo", the archive's home city…), not a relation — linking every
    // pair it touches would draw a quadratic number of lines that say nothing.
    if (ids.length > TAG_LINK_MEMBER_CAP) return;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        const key = `${a}|${b}`;
        const entry = sharedTags.get(key);
        if (entry) entry.n += 1;
        else sharedTags.set(key, { a, b, n: 1 });
      }
    }
  });

  // Cross-cloud pairs reduce to the strongest link per pair of clouds (most
  // shared tags, id-ordered tie-break) so inter-cloud relations read as one
  // clear bridge, not a tangle. Same-cloud pairs get Cap 2 below.
  const samePairs: { a: string; b: string; n: number }[] = [];
  const strongestCross = new Map<string, { a: string; b: string; n: number }>();
  sharedTags.forEach((pair) => {
    const clusterA = tileCluster[pair.a],
      clusterB = tileCluster[pair.b];
    if (clusterA === clusterB) {
      samePairs.push(pair);
      return;
    }
    const key = clusterA < clusterB ? `${clusterA}|${clusterB}` : `${clusterB}|${clusterA}`;
    const current = strongestCross.get(key);
    if (
      !current ||
      pair.n > current.n ||
      (pair.n === current.n && `${pair.a}|${pair.b}` < `${current.a}|${current.b}`)
    ) {
      strongestCross.set(key, pair);
    }
  });

  // Cap 2: each file keeps only its strongest same-cloud links (most shared
  // tags, id-ordered tie-break); a link survives if either endpoint keeps it.
  // Total same-cloud edges are therefore ≤ SAME_CLOUD_LINKS_PER_FILE × n while
  // the strongest relations — the ones worth reading — always stay visible.
  const byNode: Record<string, { a: string; b: string; n: number }[]> = {};
  samePairs.forEach((pair) => {
    (byNode[pair.a] = byNode[pair.a] || []).push(pair);
    (byNode[pair.b] = byNode[pair.b] || []).push(pair);
  });
  const kept = new Set<string>();
  Object.values(byNode).forEach((list) => {
    [...list]
      .sort((x, y) => y.n - x.n || (`${x.a}|${x.b}` < `${y.a}|${y.b}` ? -1 : 1))
      .slice(0, SAME_CLOUD_LINKS_PER_FILE)
      .forEach((pair) => kept.add(`${pair.a}|${pair.b}`));
  });
  samePairs.forEach(({ a, b, n }) => {
    if (!kept.has(`${a}|${b}`)) return;
    const ta = tiles[a],
      tb = tiles[b];
    const color = colorOf(tileCluster[a]);
    edges.push({
      id: `tag-${a}-${b}`,
      d: mkBez(ta.cx, ta.cy, tb.cx, tb.cy, hash(a + b), 0.32),
      strokeStart: color,
      strokeEnd: color,
      x1: ta.cx,
      y1: ta.cy,
      x2: tb.cx,
      y2: tb.cy,
      op: Math.min(0.16 + (n - 1) * 0.05, 0.34),
      w: 1.1,
      cloudKey: tileCluster[a],
    });
  });
  strongestCross.forEach(({ a, b }) => {
    const ta = tiles[a],
      tb = tiles[b];
    const colorA = colorOf(tileCluster[a]),
      colorB = colorOf(tileCluster[b]);
    edges.push({
      id: `x-${a}-${b}`,
      d: mkBez(ta.cx, ta.cy, tb.cx, tb.cy, hash(a + b), 0.46),
      strokeStart: colorA,
      strokeEnd: colorB,
      x1: ta.cx,
      y1: ta.cy,
      x2: tb.cx,
      y2: tb.cy,
      op: 0.45,
      w: 2,
    });
  });

  return { clouds, tiles, edges, tileCloud: tileCluster, bounds: positionsBounds(tiles) };
}

/** Topic: clouds are `photo.group` — for real assets a tag-derived topic
 *  (ADR 0023) labeled by its own key (the tag name; `Other`/`Unsorted` for the
 *  buckets); only retired mock seed groups still resolve through GROUPS.
 *  Lines are shared-AI-tag relations (ADR 0022). */
export function topicCloudLayout(
  photos: readonly Photo[],
  topicOverrides: Record<string, CanvasPoint>,
  frames: readonly Frame[] = [],
): CloudLayout {
  return buildCloudLayout(
    photos,
    (p) => p.group,
    topicCloudColor,
    (key) => GROUPS[key as PhotoGroup]?.label ?? key,
    topicOverrides,
    frames,
  );
}

// Timeline is a real horizontal date axis (ADR 0024): every distinct capture
// *day* is a fixed, evenly-spaced column with its own "DD/MM/YYYY" label on
// the axis. That day's files fill a grid centered on the label and split above
// *and* below the axis line (so even 500–1000 files from one day stay in that
// day's column, growing up and down symmetrically), each day keeping its
// colored cloud band pinned behind it. No connecting lines here — the axis and
// the per-day bands carry the structure; the tag web lives in Map/Topic.
const TL_LEFT = 160;
const TL_AXIS_Y = 0;
const TL_DATE_GAP = 420; // fixed horizontal spacing between date labels (equal for all)
const TL_COLS = 3; // files per row within one day's column
const TL_CELL_W = 128;
const TL_CELL_H = 136;
const TL_AXIS_GAP = 50; // clear half-band around the axis for the line + label

/** Timeline: evenly-spaced date columns. Each distinct capture day gets a fixed
 *  x (equal gap between labels, independent of the real time between them); its
 *  files grid out from the axis, half above and half below, so a busy day grows
 *  symmetrically. Drag overrides win over the computed slot, like every view,
 *  but x is clamped into the tile's own day column — files can't cross dates. */
export function timelineAxisLayout(
  photos: readonly Photo[],
  timelineOverrides: Record<string, CanvasPoint>,
): CloudLayout {
  const items = [...photos];
  if (items.length === 0) {
    return { clouds: [], tiles: {}, edges: [], tileCloud: {}, bounds: { xl: 0, yt: 0, xr: 1000, yb: 700 } };
  }

  const byDay: Record<string, Photo[]> = {};
  items.forEach((p) => {
    const k = dayKeyOf(p);
    (byDay[k] = byDay[k] || []).push(p);
  });
  const dayKeys = Object.keys(byDay).sort(); // "YYYY-MM-DD" sorts chronologically

  const tiles: Record<string, TilePos> = {};
  const clouds: CloudNode[] = [];
  const tileCloud: Record<string, string> = {};

  dayKeys.forEach((k, di) => {
    const dateX = TL_LEFT + di * TL_DATE_GAP;
    // Fixed borders between dates: a dragged tile is clamped to its own day's
    // column (± half the gap), so files can't cross into an adjacent date.
    const colMinCx = dateX - TL_DATE_GAP / 2;
    const colMaxCx = dateX + TL_DATE_GAP / 2;
    // Chronological within the day, stable hash tiebreak. Odd counts put the
    // extra tile above so the axis stays clear.
    const day = byDay[k]
      .slice()
      .sort((a, b) => capturedAt(a).getTime() - capturedAt(b).getTime() || hash(a.id) - hash(b.id));
    const aboveCount = Math.ceil(day.length / 2);

    let xl = Infinity,
      yt = Infinity,
      xr = -Infinity,
      yb = -Infinity;
    day.forEach((p, i) => {
      const size = assetTileSize(p);
      const above = i < aboveCount;
      const li = above ? i : i - aboveCount;
      const col = li % TL_COLS;
      const row = Math.floor(li / TL_COLS);
      // Center each row on the date: a partial row (1–2 files) spreads around
      // dateX instead of left-filling the 3-slot grid — the tick always points
      // at the day's files, not at empty canvas.
      const halfCount = above ? aboveCount : day.length - aboveCount;
      const rowCount = Math.min(TL_COLS, halfCount - row * TL_COLS);
      const slotX = dateX + (col - (rowCount - 1) / 2) * TL_CELL_W;
      // Uniform rows keyed off the cell, not the tile, so rows align regardless
      // of each tile's aspect. Above grows up from the band, below grows down.
      const slotY = above
        ? TL_AXIS_Y - TL_AXIS_GAP - (row + 0.5) * TL_CELL_H
        : TL_AXIS_Y + TL_AXIS_GAP + (row + 0.5) * TL_CELL_H;
      const ov = timelineOverrides[p.id];
      // Clamp the (possibly dragged) x into this day's column; y is free.
      const cx = ov ? Math.min(colMaxCx - size.w / 2, Math.max(colMinCx + size.w / 2, ov.x)) : slotX;
      const cy = ov ? ov.y : slotY;
      const t: TilePos = { x: cx - size.w / 2, y: cy - size.h / 2, w: size.w, h: size.h, cx, cy };
      tiles[p.id] = t;
      tileCloud[p.id] = k;
      xl = Math.min(xl, t.x);
      yt = Math.min(yt, t.y);
      xr = Math.max(xr, t.x + t.w);
      yb = Math.max(yb, t.y + t.h);
    });

    // The colored cloud is pinned to the date: a fixed-width band centered on
    // the label's x (not the shifting file bbox), spanning the day's files.
    const bandW = TL_DATE_GAP - 40;
    clouds.push({
      key: k,
      label: dayLabel(k),
      color: timelineCloudColor(k),
      count: day.length,
      labelX: dateX, // labels are fixed on the axis at the evenly-spaced column
      labelY: TL_AXIS_Y,
      bx: dateX - bandW / 2,
      by: yt,
      bw: bandW,
      bh: yb - yt,
    });
  });

  const axis = {
    y: TL_AXIS_Y,
    x1: TL_LEFT - TL_DATE_GAP / 2,
    x2: TL_LEFT + (dayKeys.length - 1) * TL_DATE_GAP + TL_DATE_GAP / 2,
  };
  // Bounds cover the axis line, ticks and date labels on every side — not just
  // the top — so fit/centering keeps the axis with the tiles (e.g. a project of
  // single-photo days has no below-axis tiles at all).
  const bounds = positionsBounds(tiles);
  bounds.xl = Math.min(bounds.xl, axis.x1);
  bounds.xr = Math.max(bounds.xr, axis.x2);
  bounds.yt = Math.min(bounds.yt, TL_AXIS_Y - 44);
  bounds.yb = Math.max(bounds.yb, TL_AXIS_Y + 10);
  return { clouds, tiles, edges: [], tileCloud, bounds, axis };
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
