"use client";

import dynamic from "next/dynamic";
import type { Photo } from "@/types";
import { geoPointsFromPhotos, missingLocationLabel } from "@/lib/geo";

/** The Map view's client boundary (ADR 0027).
 *
 *  MapLibre reads `window` at import time, so it can never be prerendered.
 *  `ssr: false` is only permitted inside a Client Component in Next 16, which
 *  is exactly what this file is for — it also keeps ~290 KB gzip of map code
 *  out of every other route, loaded only when someone opens the tab. */

const GeoMapCanvas = dynamic(() => import("./GeoMapCanvas"), {
  ssr: false,
  loading: () => <div style={{ position: "absolute", inset: 0, background: "var(--bg)" }} />,
});

interface GeoMapPaneProps {
  photos: Photo[];
  selectedIds: ReadonlySet<string>;
  onOpenAsset: (assetId: string) => void;
  onSelectAssets: (assetIds: string[]) => void;
}

export default function GeoMapPane({ photos, selectedIds, onOpenAsset, onSelectAssets }: GeoMapPaneProps) {
  const points = geoPointsFromPhotos(photos);
  const missing = missingLocationLabel(photos.length, points.length);

  return (
    <div style={{ position: "absolute", inset: "52px 0 0 0", zIndex: 5, background: "var(--bg)" }}>
      {points.length === 0 ? (
        <div style={empty}>
          <div style={emptyTitle}>Nothing to place on the map</div>
          <div style={emptySub}>
            {photos.length === 0
              ? "This project has no files yet."
              : "None of these files carry GPS coordinates. Messaging apps strip them, and most professional cameras never record them."}
          </div>
        </div>
      ) : (
        <>
          <GeoMapCanvas
            points={points}
            selectedIds={selectedIds}
            onOpenAsset={onOpenAsset}
            onSelectAssets={onSelectAssets}
          />
          {/* Says out loud what the map is NOT showing — without it, an
              archive of messenger-stripped photos looks simply empty. */}
          {missing && <div style={missingChip}>{missing}</div>}
        </>
      )}
    </div>
  );
}

const empty: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: "0 40px",
  textAlign: "center",
};
const emptyTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--t2)",
};
const emptySub: React.CSSProperties = { fontSize: 11.5, lineHeight: 1.5, color: "var(--t3)", maxWidth: 380 };
const missingChip: React.CSSProperties = {
  position: "absolute",
  left: 16,
  top: 16,
  height: 24,
  display: "flex",
  alignItems: "center",
  padding: "0 9px",
  background: "rgba(8,8,8,.82)",
  border: "1px solid var(--bd)",
  borderRadius: 2,
  color: "var(--t3)",
  fontSize: 10.5,
  letterSpacing: "0.03em",
  pointerEvents: "none",
  zIndex: 6,
};
