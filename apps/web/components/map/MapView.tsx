"use client";

import dynamic from "next/dynamic";
import type { Photo } from "@/types";
import type { MapApi } from "./MapCanvas";

const MapCanvas = dynamic(() => import("./MapCanvas"), { ssr: false });

interface MapViewProps {
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

export default function MapView(props: MapViewProps) {
  return <MapCanvas {...props} />;
}
