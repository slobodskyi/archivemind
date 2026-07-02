import type { Photo, PhotoSource } from "@/types";
import { PROJECTS_META, SOURCES } from "./mock-data";
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
