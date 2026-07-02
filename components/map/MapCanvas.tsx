"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Photo } from "@/types";
import { COUNTRY_LATLON } from "@/lib/mock-data";

interface PreviewItem {
  src: string;
  onClick: () => void;
}

interface MapCanvasProps {
  photos: Photo[];
  contentLeft: number;
  onOpenPreview: (kind: "map", key: string, items: PreviewItem[]) => void;
  onClosePreview: () => void;
  onOpenDrawer: (id: string) => void;
}

export default function MapCanvas({
  photos,
  contentLeft,
  onOpenPreview,
  onClosePreview,
  onOpenDrawer,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const propsRef = useRef({ onOpenPreview, onClosePreview, onOpenDrawer });
  useEffect(() => {
    propsRef.current = { onOpenPreview, onClosePreview, onOpenDrawer };
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      maxBounds: [
        [-85, -180],
        [85, 180],
      ],
      maxBoundsViscosity: 1.0,
    });
    map.setView([30, 15], 2);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      noWrap: true,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    mapRef.current = map;

    const fitWorldNoGap = () => {
      const bounds = L.latLngBounds([-85, -180], [85, 180]);
      const z = map.getBoundsZoom(bounds, true);
      map.setMinZoom(z);
    };
    const onResize = () => {
      map.invalidateSize();
      fitWorldNoGap();
    };
    window.addEventListener("resize", onResize);
    const t = setTimeout(() => {
      map.invalidateSize();
      fitWorldNoGap();
    }, 60);

    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const byCountry: Record<string, Photo[]> = {};
    photos.forEach((p) => {
      const c = COUNTRY_LATLON[p.country] ? p.country : "Ukraine";
      (byCountry[c] = byCountry[c] || []).push(p);
    });

    Object.keys(byCountry).forEach((country) => {
      const latlon = COUNTRY_LATLON[country];
      if (!latlon) return;
      const items = byCountry[country];
      const size = Math.min(56, Math.max(28, 22 + items.length * 6));
      const icon = L.divIcon({
        className: "am-marker",
        html: `<div style="width:${size}px;height:${size}px;border-radius:999px;background:rgba(57,255,106,.16);border:1.5px solid var(--ac);display:flex;align-items:center;justify-content:center;color:var(--ac);font-size:12px;font-weight:700;font-family:var(--font-space-mono),monospace;">${items.length}</div>`,
        iconSize: [size, size],
      });
      const marker = L.marker([latlon[0], latlon[1]], { icon }).addTo(map);
      marker.on("dblclick", () => {
        propsRef.current.onOpenPreview(
          "map",
          country,
          items.map((p) => ({
            src: `https://picsum.photos/seed/${p.seed}/200/200`,
            onClick: () => {
              propsRef.current.onClosePreview();
              propsRef.current.onOpenDrawer(p.id);
            },
          })),
        );
      });
      markersRef.current.push(marker);
    });
  }, [photos]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        left: contentLeft,
        top: 52,
        right: 0,
        bottom: 0,
        zIndex: 2,
        background: "var(--bg)",
      }}
    />
  );
}
