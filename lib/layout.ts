import type { Photo, PhotoGroup, PhotoSource } from "@/types";
import { GROUPS, PROJECTS_META, SOURCES } from "./mock-data";
import type { ViewMode } from "@/types";

/**
 * Pure, deterministic layout algorithms ported verbatim from the source.
 * No randomness anywhere — every position is a function of the fixed mock data
 * plus user drag overrides.
 */

export interface NodeOverrides {
  hub: Record<string, { x: number; y: number }>;
  folder: Record<string, { x: number; y: number }>;
  file: Record<string, { x: number; y: number }>;
}

export const EMPTY_OVERRIDES: NodeOverrides = { hub: {}, folder: {}, file: {} };

export interface TilePos {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export interface HubNode {
  key: string;
  x: number;
  y: number;
  color: string;
  glow: string;
  label: string;
  abbr: string;
  count: number;
}

export interface FolderNode {
  key: string;
  x: number;
  y: number;
  count: number;
  label: string;
  source: string;
  bg: string;
  tabBg: string;
  shadow: string;
}

export interface EdgePath {
  d: string;
  stroke: string;
  op: number;
  w: number;
}

export interface NeuralOverlay {
  hubs: HubNode[];
  folders: FolderNode[];
  hubEdges: EdgePath[];
  folderEdges: EdgePath[];
  looseEdges: EdgePath[];
}

export interface NeuralLayout {
  pos: Record<string, TilePos>;
  overlay: NeuralOverlay;
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

export function folderKey(p: Photo): string | null {
  return hash(p.id) % 3 === 0 ? null : p.source + "_" + p.project;
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

const FGRADS = [
  "linear-gradient(140deg,#7bc4ff,#3a6fff)",
  "linear-gradient(140deg,#ff9a7c,#ff4a3c)",
  "linear-gradient(140deg,#7ee8df,#22b8c8)",
  "linear-gradient(140deg,#d4a4ff,#8840e0)",
  "linear-gradient(140deg,#ffe08a,#ffb400)",
  "linear-gradient(140deg,#7ee8c8,#5be0a0)",
];
const FTABS = [
  "rgba(44,90,220,.8)",
  "rgba(220,58,44,.8)",
  "rgba(28,164,180,.8)",
  "rgba(128,72,210,.8)",
  "rgba(200,148,0,.8)",
  "rgba(44,180,128,.8)",
];
const FSHADOWS = [
  "rgba(58,111,255,.35)",
  "rgba(255,74,60,.35)",
  "rgba(42,179,192,.35)",
  "rgba(144,96,224,.35)",
  "rgba(255,180,0,.35)",
  "rgba(91,224,160,.35)",
];

const HUBPOS: Record<PhotoSource, { x: number; y: number }> = {
  gdrive: { x: 700, y: 720 },
  icloud: { x: 1750, y: 260 },
  dropbox: { x: 2650, y: 760 },
};

// ── Neural layout (verbatim algorithm) ──────────────────────────────────────

export function layoutNeural(
  photos: Photo[],
  overrides: NodeOverrides = EMPTY_OVERRIDES,
): NeuralLayout {
  const pos: Record<string, TilePos> = {};
  const hubEdges: EdgePath[] = [];
  const folderEdges: EdgePath[] = [];
  const looseEdges: EdgePath[] = [];
  const hubs: HubNode[] = [];
  const folders: FolderNode[] = [];
  const OV = overrides || EMPTY_OVERRIDES;

  const bySrc: Record<string, Photo[]> = {};
  photos.forEach((p) => {
    (bySrc[p.source] = bySrc[p.source] || []).push(p);
  });

  (Object.keys(SOURCES) as PhotoSource[]).forEach((src) => {
    let hub = HUBPOS[src];
    if (OV.hub[src]) hub = OV.hub[src];
    const meta = SOURCES[src];
    const members = bySrc[src] || [];
    hubs.push({
      key: src,
      x: hub.x,
      y: hub.y,
      color: meta.color,
      glow: hexA(meta.color, 0.12),
      label: meta.label,
      abbr: meta.abbr,
      count: members.length,
    });
    const byFolder: Record<string, Photo[]> = {};
    const loose: Photo[] = [];
    members.forEach((p) => {
      const fk = folderKey(p);
      if (fk) (byFolder[fk] = byFolder[fk] || []).push(p);
      else loose.push(p);
    });
    const folderKeys = Object.keys(byFolder);
    const nSlots = folderKeys.length + (loose.length ? 1 : 0);
    let slot = 0;
    const RF = 300;
    folderKeys.forEach((fk, fi) => {
      const ang = -Math.PI / 2 + (slot / Math.max(nSlots, 1)) * Math.PI * 2;
      slot++;
      let fx = hub.x + Math.cos(ang) * RF,
        fy = hub.y + Math.sin(ang) * RF;
      if (OV.folder[fk]) {
        fx = OV.folder[fk].x;
        fy = OV.folder[fk].y;
      }
      const fmembers = byFolder[fk];
      const proj = fmembers[0].project;
      const gi = hash(fk) % FGRADS.length;
      folders.push({
        key: fk,
        x: fx - 54,
        y: fy - 40,
        count: fmembers.length,
        label: PROJECTS_META[proj] ? PROJECTS_META[proj].label.split(" ")[0] : "Files",
        source: meta.abbr,
        bg: FGRADS[gi],
        tabBg: FTABS[gi],
        shadow: FSHADOWS[gi],
      });
      hubEdges.push({
        d: mkBez(hub.x, hub.y, fx, fy, fi * 7 + hash(fk), 0.22),
        stroke: meta.color,
        op: 0.4,
        w: 1.3,
      });
      const n = fmembers.length,
        RFI = n > 3 ? 130 : 92;
      fmembers.forEach((p, i) => {
        const fang = ang + (-0.9 + (i / Math.max(n - 1, 1)) * 1.8);
        const w = 96,
          h = Math.round((p.h * w) / p.w);
        let px = fx + Math.cos(fang) * RFI,
          py = fy + Math.sin(fang) * RFI;
        if (OV.file[p.id]) {
          px = OV.file[p.id].x;
          py = OV.file[p.id].y;
        }
        pos[p.id] = { x: px - w / 2, y: py - h / 2, w, h, cx: px, cy: py };
        folderEdges.push({
          d: mkBez(fx, fy, px, py, hash(p.id), 0.18),
          stroke: "rgba(236,238,232,.4)",
          op: 0.3,
          w: 0.8,
        });
      });
    });
    if (loose.length) {
      const ang0 = -Math.PI / 2 + (slot / Math.max(nSlots, 1)) * Math.PI * 2;
      const n = loose.length,
        RL = 230;
      loose.forEach((p, i) => {
        const ang = ang0 + (-0.5 + (i / Math.max(n - 1, 1)) * 1.0);
        const w = 100,
          h = Math.round((p.h * w) / p.w);
        let px = hub.x + Math.cos(ang) * RL,
          py = hub.y + Math.sin(ang) * RL;
        if (OV.file[p.id]) {
          px = OV.file[p.id].x;
          py = OV.file[p.id].y;
        }
        pos[p.id] = { x: px - w / 2, y: py - h / 2, w, h, cx: px, cy: py };
        looseEdges.push({
          d: mkBez(hub.x, hub.y, px, py, hash(p.id), 0.16),
          stroke: meta.color,
          op: 0.28,
          w: 0.9,
        });
      });
    }
  });
  return { pos, overlay: { hubs, folders, hubEdges, folderEdges, looseEdges } };
}

// ── Fit-to-content (verbatim) ───────────────────────────────────────────────

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

export function viewBounds(
  view: ViewMode,
  photos: Photo[],
  overrides: NodeOverrides = EMPTY_OVERRIDES,
): Bounds {
  if (view === "neural") {
    const { pos } = layoutNeural(photos, overrides);
    const ids = Object.keys(pos);
    if (!ids.length) return { xl: 0, yt: 0, xr: 1000, yb: 700 };
    return {
      xl: Math.min(...ids.map((i) => pos[i].x), 400),
      yt: Math.min(...ids.map((i) => pos[i].y), 400),
      xr: Math.max(...ids.map((i) => pos[i].x + pos[i].w)),
      yb: Math.max(...ids.map((i) => pos[i].y + pos[i].h)),
    };
  }
  if (view === "timeline") return { xl: 0, yt: 0, xr: 60 + MONTH_COUNT * 380, yb: 900 };
  if (view === "map") return { xl: 0, yt: 0, xr: 1200, yb: 700 };
  if (view === "sense") return { xl: 0, yt: 0, xr: 1200, yb: 900 };
  return { xl: 0, yt: 0, xr: 1000, yb: 700 };
}

export function fitView(
  view: ViewMode,
  photos: Photo[],
  overrides: NodeOverrides,
  rect: Rect,
  sidebarExpanded: boolean,
  chatOpen: boolean,
): Transform {
  const sbW = sidebarExpanded ? 220 : 52;
  const chW = chatOpen ? 320 : 0;
  const leftPad = sbW + chW;
  if (view === "timeline") {
    return { scale: 1, tx: leftPad + 20, ty: 100 };
  }
  const { xl, yt, xr, yb } = viewBounds(view, photos, overrides);
  const pad = 60,
    top = 70,
    bottom = 104;
  const bw = Math.max(xr - xl, 1),
    bh = Math.max(yb - yt, 1);
  const availW = rect.width - leftPad - pad * 2,
    availH = rect.height - top - bottom;
  const sc = Math.min(availW / bw, availH / bh, 1.05);
  return {
    scale: sc,
    tx: leftPad + pad + (availW - bw * sc) / 2 - xl * sc,
    ty: top + (availH - bh * sc) / 2 - yt * sc,
  };
}

// ── Timeline view: month columns + deterministic scattered tiles ───────────

export const MONTH_LIST = ["Feb 2026", "Mar 2026", "Apr 2026", "May 2026", "Jun 2026", "Jul 2026"];

const COL_W = 340;
const COL_GAP = 40;
const TILE_MIN = 64;
const TILE_MAX = 96;
const TOP_Y = 16;
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
  availableHeight: number,
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
    const colH = Math.max(availableHeight - TOP_Y - 20, rows * MIN_CELL);
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
