"use client";

import dynamic from "next/dynamic";
import type { Photo } from "@/types";

const MapCanvas = dynamic(() => import("./MapCanvas"), { ssr: false });

interface PreviewItem {
  src: string;
  onClick: () => void;
}

interface MapViewProps {
  photos: Photo[];
  contentLeft: number;
  onOpenPreview: (kind: "map", key: string, items: PreviewItem[]) => void;
  onClosePreview: () => void;
  onOpenDrawer: (id: string) => void;
}

export default function MapView(props: MapViewProps) {
  return <MapCanvas {...props} />;
}
