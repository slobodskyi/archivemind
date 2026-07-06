import type { Photo, ViewMode } from "@/types";
import { COUNTRIES, GROUPS } from "./mock-data";

/**
 * Pure, deterministic layout logic ported verbatim from the v2 source mockup
 * (docs/design/ArchiveMind-v2.dc.html, `computeLayout`/`fitView`/`onFit`/
 * `onZoomReset`). No randomness anywhere — every position is a function of
 * fixed mock data. See docs/decisions/0006-redesign-v2-full-replace.md.
 */

export interface TilePos {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TimelineTick {
  x: number;
  label: string;
}

export interface MapRegion {
  x: number;
  y: number;
  color: string;
  glow: string;
  label: string;
  count: number;
}

export interface MapLand {
  points: string;
  fill: string;
  stroke: string;
}

export interface EdgePath {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  op: number;
  w: number;
  dash?: string;
  anim?: string;
}

export interface SmartHub {
  x: number;
  y: number;
  color: string;
  glow: string;
  label: string;
  count: string;
}

/** Discriminated by isTimeline/isMap/isSmart; all-false/undefined means canvas view (no decoration). */
export interface LayoutOverlay {
  isTimeline?: boolean;
  tlTicks?: TimelineTick[];
  axisX0?: number;
  axisW?: number;

  isMap?: boolean;
  mapX?: number;
  mapY?: number;
  mapW?: number;
  mapH?: number;
  regions?: MapRegion[];
  lands?: MapLand[];

  isSmart?: boolean;
  hubs?: SmartHub[];

  edges?: EdgePath[];
}

export interface Layout {
  pos: Record<string, TilePos>;
  overlay: LayoutOverlay;
}

export interface Rect {
  width: number;
  height: number;
}

export interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

// ── Helpers (verbatim) ──────────────────────────────────────────────────────

export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Parses a photo's 'MM-DD HH:mm' display time into a sortable minute offset. */
export function timeMin(t: string): number {
  const parts = (t || "06-18 12:00").split(" ");
  const da = +parts[0].split("-")[1];
  const hm = parts[1].split(":");
  return (da * 24 + +hm[0]) * 60 + +hm[1];
}

/** Hand-coded inline SVG polygon points per country, for the Map view (no Leaflet/basemap). */
const LANDS: Record<string, string> = {
  "United Kingdom": "530,300 575,312 590,360 574,420 545,442 518,400 524,348",
  Sweden: "845,150 902,160 916,232 890,292 858,282 842,210",
  Germany: "768,430 852,424 878,480 846,527 784,521 758,476",
  Poland: "918,398 1022,393 1048,440 1010,477 938,472 912,436",
  France: "588,508 682,520 702,582 660,642 598,652 558,590",
  Ukraine: "1038,468 1182,463 1214,510 1170,552 1058,550 1028,506",
  Italy: "820,608 856,618 872,680 902,762 876,778 854,706 834,660",
  Spain: "428,708 562,703 602,760 560,812 438,817 408,766",
};

/** Hardcoded "related photos" cross-links shown as dashed lines in the Smart view. */
const SMART_CROSS_LINKS: [string, string][] = [
  ["a", "d"],
  ["b", "j"],
  ["d", "c"],
  ["e", "i"],
  ["h", "l"],
  ["f", "k"],
  ["a", "g"],
  ["j", "c"],
  ["e", "h"],
];

// ── computeLayout: one function per view, all photos as siblings on one canvas ──

export function computeLayout(view: ViewMode, photos: Photo[]): Layout {
  const pos: Record<string, TilePos> = {};
  let overlay: LayoutOverlay = {};

  if (view === "timeline") {
    const sorted = [...photos].sort((a, b) => timeMin(a.time) - timeMin(b.time));
    const tmin = Math.min(...sorted.map((p) => timeMin(p.time)));
    const tmax = Math.max(...sorted.map((p) => timeMin(p.time)));
    const X0 = 280,
      X1 = 1520,
      span = tmax - tmin || 1,
      tw = 150;
    const laneLast: number[] = [];
    sorted.forEach((p) => {
      const x = X0 + ((timeMin(p.time) - tmin) / span) * (X1 - X0);
      let lane = 0;
      while (laneLast[lane] !== undefined && laneLast[lane] > x - (tw + 18)) lane++;
      laneLast[lane] = x;
      const w = tw,
        h = Math.round((p.h * w) / p.w);
      pos[p.id] = { x, y: 350 + lane * 154, w, h };
    });
    const seen: Record<string, true> = {};
    const ticks: TimelineTick[] = [];
    sorted.forEach((p) => {
      const da = p.day || "Jun 18";
      if (seen[da] === undefined) {
        seen[da] = true;
        ticks.push({ x: X0 + ((timeMin(p.time) - tmin) / span) * (X1 - X0), label: da });
      }
    });
    overlay = { isTimeline: true, tlTicks: ticks, axisX0: X0, axisW: X1 - X0 };
  } else if (view === "map") {
    const MX0 = 250,
      MY0 = 150,
      MW = 1140,
      MH = 760;
    const byC: Record<string, Photo[]> = {};
    photos.forEach((p) => {
      const c = COUNTRIES[p.country] ? p.country : "Ukraine";
      (byC[c] = byC[c] || []).push(p);
    });
    const regions: MapRegion[] = [];
    const edges: EdgePath[] = [];
    const lands: MapLand[] = Object.keys(COUNTRIES).map((c) => ({
      points: LANDS[c] || "",
      fill: hexA(COUNTRIES[c].color, 0.1),
      stroke: hexA(COUNTRIES[c].color, 0.5),
    }));
    Object.keys(COUNTRIES).forEach((c) => {
      const meta = COUNTRIES[c];
      const members = byC[c] || [];
      const n = members.length;
      const cx = MX0 + meta.cx * MW,
        cy = MY0 + meta.cy * MH;
      regions.push({ x: cx, y: cy, color: meta.color, glow: hexA(meta.color, 0.16), label: c, count: n });
      members.forEach((p, i) => {
        const ang = -Math.PI / 2 + (i / Math.max(n, 1)) * Math.PI * 2;
        const R = n > 1 ? 74 : 0;
        const w = 98,
          h = Math.round((p.h * w) / p.w);
        const px = cx + Math.cos(ang) * R,
          py = cy + Math.sin(ang) * R - (n > 1 ? 0 : 48);
        pos[p.id] = { x: px - w / 2, y: py - h / 2, w, h };
        edges.push({ x1: cx, y1: cy, x2: px, y2: py, stroke: meta.color, op: 0.32, w: 1.2 });
      });
    });
    overlay = { isMap: true, mapX: MX0 - 26, mapY: MY0 - 40, mapW: MW + 52, mapH: MH + 80, regions, edges, lands };
  } else if (view === "smart") {
    const groups: Record<string, Photo[]> = {};
    photos.forEach((p) => {
      const g = GROUPS[p.group] ? p.group : "street";
      (groups[g] = groups[g] || []).push(p);
    });
    const hubs: SmartHub[] = [];
    const centers: Record<string, { x: number; y: number }> = {};
    Object.keys(GROUPS).forEach((g) => {
      const meta = GROUPS[g as keyof typeof GROUPS];
      const members = groups[g] || [];
      centers[g] = { x: meta.hx, y: meta.hy };
      hubs.push({ x: meta.hx, y: meta.hy, color: meta.color, glow: hexA(meta.color, 0.14), label: meta.label, count: members.length + " photos" });
      const n = members.length,
        R = n > 4 ? 215 : 175;
      members.forEach((p, i) => {
        const ang = -Math.PI / 2 + (i / Math.max(n, 1)) * Math.PI * 2;
        const w = 112,
          h = Math.round((p.h * w) / p.w);
        pos[p.id] = { x: meta.hx + Math.cos(ang) * R - w / 2, y: meta.hy + Math.sin(ang) * R - h / 2, w, h };
      });
    });
    const edges: EdgePath[] = [];
    photos.forEach((p) => {
      const g = GROUPS[p.group] ? p.group : "street";
      const c = centers[g],
        pp = pos[p.id];
      if (c && pp) edges.push({ x1: c.x, y1: c.y, x2: pp.x + pp.w / 2, y2: pp.y + pp.h / 2, stroke: GROUPS[g as keyof typeof GROUPS].color, op: 0.32, w: 1.4 });
    });
    SMART_CROSS_LINKS.forEach(([aId, bId]) => {
      const A = pos[aId],
        B = pos[bId];
      if (A && B)
        edges.push({
          x1: A.x + A.w / 2,
          y1: A.y + A.h / 2,
          x2: B.x + B.w / 2,
          y2: B.y + B.h / 2,
          stroke: "rgba(255,255,255,0.55)",
          op: 0.18,
          w: 1,
          dash: "4 7",
          anim: "amDash 1.8s linear infinite",
        });
    });
    overlay = { isSmart: true, edges, hubs };
  } else {
    // canvas — raw photo.x/y/w/h, directly drag-repositionable
    photos.forEach((p) => {
      pos[p.id] = { x: p.x, y: p.y, w: p.w, h: p.h };
    });
  }

  return { pos, overlay };
}

// ── fitView: on mount + on view switch ──────────────────────────────────────

export function fitView(view: ViewMode, photos: Photo[], rect: Rect): Transform | null {
  const { pos } = computeLayout(view, photos);
  const ids = Object.keys(pos);
  if (!ids.length) return null;
  let xl = Math.min(...ids.map((i) => pos[i].x));
  let yt = Math.min(...ids.map((i) => pos[i].y));
  const xr = Math.max(...ids.map((i) => pos[i].x + pos[i].w));
  const yb = Math.max(...ids.map((i) => pos[i].y + pos[i].h));
  if (view === "smart") {
    Object.values(GROUPS).forEach((g) => {
      xl = Math.min(xl, g.hx - 130);
      yt = Math.min(yt, g.hy - 130);
    });
  }
  if (view === "timeline") yt = Math.min(yt, 110);
  const pad = view === "canvas" ? 110 : 80,
    top = 66,
    bottom = 104;
  const bw = Math.max(xr - xl, 1),
    bh = Math.max(yb - yt, 1);
  const availW = rect.width - pad * 2,
    availH = rect.height - top - bottom;
  const s = Math.min(availW / bw, availH / bh, view === "canvas" ? 2 : 1.12);
  return { scale: s, tx: (rect.width - bw * s) / 2 - xl * s, ty: top + (availH - bh * s) / 2 - yt * s };
}

/** Bottom-toolbar "Fit" button — raw bounding box of photo.x/y/w/h, ignores computeLayout. */
export function onFitTransform(photos: Photo[], rect: Rect): Transform | null {
  if (!photos.length) return null;
  const xl = Math.min(...photos.map((p) => p.x)),
    yt = Math.min(...photos.map((p) => p.y));
  const xr = Math.max(...photos.map((p) => p.x + p.w)),
    yb = Math.max(...photos.map((p) => p.y + p.h));
  const pad = 120;
  const s = Math.min((rect.width - pad * 2) / (xr - xl), (rect.height - pad * 2) / (yb - yt), 2);
  return { scale: s, tx: (rect.width - (xr - xl) * s) / 2 - xl * s, ty: (rect.height - (yb - yt) * s) / 2 - yt * s + 10 };
}

/** Header/toolbar zoom-reset button — recenters at scale 1 around a fixed offset. */
export function onZoomResetTransform(rect: Rect): Transform {
  return { scale: 1, tx: rect.width / 2 - 740, ty: rect.height / 2 - 470 };
}
