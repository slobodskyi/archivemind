"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import type { Photo } from "@/types";
import { COUNTRY_LATLON } from "@/lib/mock-data";
import { mapExpandLayout, type ExpandOverlay } from "@/lib/layout";
import ExpandFileTile from "@/components/canvas/ExpandFileTile";

export interface MapApi {
  fitWorld: () => void;
  setZoomPct: (pct: number) => void;
  getZoomPct: () => number;
}

interface MapCanvasProps {
  photos: Photo[];
  contentLeft: number;
  drawerRight?: number;
  expanded: { kind: "sense" | "map" | null; key: string | null };
  expandOverrides: Record<string, { x: number; y: number }>;
  hoveredId: string | null;
  onToggleMapExpand: (key: string) => void;
  onCloseExpand: () => void;
  onExpandFileDown: (e: React.PointerEvent, id: string, x: number, y: number, space: "canvas" | "map") => void;
  setHover: (id: string | null) => void;
  openDrawer: (id: string) => void;
  deletePhoto: (id: string) => void;
  onMapReady?: (api: MapApi | null) => void;
  onZoomChange?: (pct: number) => void;
}

function markerSizeFor(count: number): number {
  return Math.min(56, Math.max(28, 22 + count * 6));
}

export default function MapCanvas({
  photos,
  contentLeft,
  drawerRight = 0,
  expanded,
  expandOverrides,
  hoveredId,
  onToggleMapExpand,
  onCloseExpand,
  onExpandFileDown,
  setHover,
  openDrawer,
  deletePhoto,
  onMapReady,
  onZoomChange,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  // The Leaflet map lives in state (not a ref) so the overlay can read its
  // container points during render without tripping the "no refs in render" rule.
  const [map, setMap] = useState<L.Map | null>(null);
  // Bump on every pan/zoom to force the overlay to recompute with fresh coords.
  const [, setMapTick] = useState(0);
  const worldFitZoomRef = useRef<number | null>(null);
  const propsRef = useRef({ onToggleMapExpand, onCloseExpand, onZoomChange });
  useEffect(() => {
    propsRef.current = { onToggleMapExpand, onCloseExpand, onZoomChange };
  });

  const byCountry = useMemo(() => {
    const m: Record<string, Photo[]> = {};
    photos.forEach((p) => {
      const c = COUNTRY_LATLON[p.country] ? p.country : "Ukraine";
      (m[c] = m[c] || []).push(p);
    });
    return m;
  }, [photos]);

  useEffect(() => {
    if (!containerRef.current) return;
    const m = L.map(containerRef.current, {
      maxBounds: [
        [-85, -180],
        [85, 180],
      ],
      maxBoundsViscosity: 1.0,
    });
    m.setView([30, 15], 2);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      noWrap: true,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(m);

    const getZoomPct = () =>
      Math.round(100 * Math.pow(2, m.getZoom() - (worldFitZoomRef.current ?? m.getZoom())));

    m.on("zoomend move", () => {
      setMapTick((t) => t + 1);
      propsRef.current.onZoomChange?.(getZoomPct());
    });
    m.on("click", () => propsRef.current.onCloseExpand());
    setMap(m);

    const fitWorldNoGap = () => {
      const bounds = L.latLngBounds([-85, -180], [85, 180]);
      const z = m.getBoundsZoom(bounds, true);
      worldFitZoomRef.current = z;
      m.setMinZoom(z);
      if (m.getZoom() < z) m.setView(m.getCenter(), z, { animate: false });
      propsRef.current.onZoomChange?.(getZoomPct());
    };
    const onResize = () => {
      m.invalidateSize();
      fitWorldNoGap();
    };
    window.addEventListener("resize", onResize);
    const t = setTimeout(() => {
      m.invalidateSize();
      fitWorldNoGap();
    }, 60);

    onMapReady?.({
      fitWorld: fitWorldNoGap,
      setZoomPct: (pct: number) => {
        const base = worldFitZoomRef.current ?? m.getZoom();
        m.setZoom(base + Math.log2(pct / 100));
      },
      getZoomPct,
    });

    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(t);
      onMapReady?.(null);
      m.remove();
      setMap(null);
    };
    // onMapReady is passed once at mount time by design (mirrors the single
    // setMapRef/canvasRef pattern used elsewhere in the workspace).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map) return;
    markersRef.current.forEach((mk) => mk.remove());
    markersRef.current = [];
    Object.keys(byCountry).forEach((country) => {
      const latlon = COUNTRY_LATLON[country];
      if (!latlon) return;
      const items = byCountry[country];
      const size = markerSizeFor(items.length);
      const icon = L.divIcon({
        className: "am-marker",
        html: `<div style="width:${size}px;height:${size}px;border-radius:999px;background:rgba(57,255,106,.16);border:1.5px solid var(--ac);display:flex;align-items:center;justify-content:center;color:var(--ac);font-size:12px;font-weight:700;font-family:var(--font-space-mono),monospace;">${items.length}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      const marker = L.marker([latlon[0], latlon[1]], { icon }).addTo(map);
      marker.on("click", (evt) => L.DomEvent.stopPropagation(evt));
      marker.on("dblclick", (evt) => {
        L.DomEvent.stopPropagation(evt);
        propsRef.current.onToggleMapExpand(country);
      });
      markersRef.current.push(marker);
    });
  }, [map, byCountry]);

  // Derive the drill-down overlay in screen (container) space during render.
  let overlay: ExpandOverlay | null = null;
  if (map && expanded.kind === "map" && expanded.key && byCountry[expanded.key]) {
    const key = expanded.key;
    const latlon = COUNTRY_LATLON[key];
    if (latlon) {
      const cp = map.latLngToContainerPoint([latlon[0], latlon[1]]);
      const otherCps = Object.keys(byCountry)
        .filter((k) => k !== key && COUNTRY_LATLON[k])
        .map((k) => {
          const p = map.latLngToContainerPoint([COUNTRY_LATLON[k][0], COUNTRY_LATLON[k][1]]);
          return { x: p.x, y: p.y };
        });
      overlay = mapExpandLayout(byCountry[key], { x: cp.x, y: cp.y }, otherCps, markerSizeFor(byCountry[key].length), expandOverrides);
    }
  }

  return (
    <div style={{ position: "absolute", left: contentLeft, top: 52, right: drawerRight, bottom: 0, zIndex: 2, background: "var(--bg)" }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0, zIndex: 1 }} />
      {overlay && (
        <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
          <svg style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
            {overlay.edges.map((e, i) => (
              <path key={`me${i}`} d={e.d} stroke={e.stroke} strokeWidth={e.w} strokeOpacity={e.op} strokeLinecap="round" fill="none" />
            ))}
          </svg>
          {overlay.files.map((f) => (
            <ExpandFileTile
              key={f.id}
              file={f}
              hovered={f.id === hoveredId}
              onDown={(e) => onExpandFileDown(e, f.id, f.x, f.y, "map")}
              onEnter={() => setHover(f.id)}
              onLeave={() => setHover(null)}
              onOpen={(e) => {
                e.stopPropagation();
                openDrawer(f.id);
              }}
              onDelete={(e) => {
                e.stopPropagation();
                deletePhoto(f.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
