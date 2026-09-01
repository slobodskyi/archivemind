"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import type Supercluster from "supercluster";
import "maplibre-gl/dist/maplibre-gl.css";
import { boundsOf, formatCount, markerSize, mosaicCells, type GeoPoint } from "@/lib/geo";
import {
  buildClusterIndex,
  coverThumbs,
  MAX_ZOOM,
  type ClusterProps,
  type PointProps,
} from "@/lib/geo-cluster";
import { applyArchiveMindTheme, BASEMAP_STYLE_URL } from "@/lib/map-style";

/** The Map view's actual map (ADR 0027). Browser-only — MapLibre touches
 *  `window` at import time — so it is reached exclusively through
 *  GeoMapPane's dynamic(ssr:false) boundary.
 *
 *  Markers are DOM elements rather than a symbol layer because each one is a
 *  photo thumbnail with our tile chrome; at the counts clustering produces
 *  (tens on screen, never thousands) that is the cheaper and far more
 *  controllable option. */

interface GeoMapCanvasProps {
  points: readonly GeoPoint[];
  selectedIds: ReadonlySet<string>;
  onOpenAsset: (assetId: string) => void;
  onSelectAssets: (assetIds: string[]) => void;
}

export default function GeoMapCanvas({ points, selectedIds, onOpenAsset, onSelectAssets }: GeoMapCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  /** Which supercluster index the live markers were built from. */
  const builtFromRef = useRef<Supercluster<PointProps, ClusterProps> | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Photos sharing one spot can't be split by zooming — they get a panel. */
  const [stack, setStack] = useState<GeoPoint[] | null>(null);

  const index = useMemo(() => buildClusterIndex(points), [points]);

  const pointsById = useMemo(() => new Map(points.map((p) => [p.assetId, p])), [points]);

  /** Rebuilds the visible marker set from the current viewport. Reconciles
   *  against what is already on the map so panning doesn't churn every DOM
   *  node — only genuinely new keys are created. */
  const syncMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    // A cluster id means nothing across two indexes, and previews arrive after
    // the first paint — reusing a marker built from the old index kept its
    // blank plate forever once the thumbnail finally landed.
    if (builtFromRef.current !== index) {
      for (const marker of markersRef.current.values()) marker.remove();
      markersRef.current.clear();
      builtFromRef.current = index;
    }
    const b = map.getBounds();
    const zoom = Math.round(map.getZoom());
    const features = index.getClusters([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], zoom);

    const live = new Set<string>();
    for (const feature of features) {
      const [lng, lat] = feature.geometry.coordinates;
      // supercluster's return type is a bare union; only an `in` guard narrows
      // it, and with explicit generics (rather than the default AnyProps index
      // signature this repo's no-`any` rule forbids) TS enforces that.
      const props = feature.properties;
      const cluster = "cluster" in props ? props : null;
      const point = "cluster" in props ? null : props;
      const key = cluster ? `c${cluster.cluster_id}` : `p${point?.assetId}`;
      live.add(key);

      const existing = markersRef.current.get(key);
      if (existing) {
        existing.setLngLat([lng, lat]);
        continue;
      }

      const el = buildMarkerElement({
        count: cluster ? cluster.point_count : 1,
        // Newest first — the mosaic reads top-left to bottom-right.
        thumbs: cluster ? coverThumbs(cluster.cover, points) : [point?.thumb],
        selected: point != null && selectedIds.has(point.assetId),
      });

      el.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!cluster) {
          if (point) onOpenAsset(point.assetId);
          return;
        }
        const clusterId = cluster.cluster_id;
        const expansion = index.getClusterExpansionZoom(clusterId);
        // A cluster that can't be split — every photo at the same coordinates,
        // or already at max zoom — would otherwise swallow clicks silently.
        if (expansion > MAX_ZOOM || expansion <= Math.round(map.getZoom())) {
          const leaves = index.getLeaves(clusterId, Infinity);
          setStack(
            leaves
              .map((leaf) => pointsById.get(leaf.properties.assetId))
              .filter((p): p is GeoPoint => p != null),
          );
          return;
        }
        map.easeTo({ center: [lng, lat], zoom: expansion, duration: 480 });
      });

      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([lng, lat])
        .addTo(map);
      markersRef.current.set(key, marker);
    }

    for (const [key, marker] of markersRef.current) {
      if (!live.has(key)) {
        marker.remove();
        markersRef.current.delete(key);
      }
    }
  }, [index, points, pointsById, selectedIds, onOpenAsset]);

  // Style is fetched rather than passed by URL so it can be recoloured before
  // the first paint; handing MapLibre the URL shows a frame of stock styling.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const markers = markersRef.current;

    void (async () => {
      let style: StyleSpecification;
      try {
        const res = await fetch(BASEMAP_STYLE_URL);
        if (!res.ok) throw new Error(`basemap ${res.status}`);
        style = applyArchiveMindTheme((await res.json()) as StyleSpecification);
      } catch {
        if (!disposed) setFailed(true);
        return;
      }
      if (disposed) return;

      const map = new maplibregl.Map({
        container: host,
        style,
        center: [30.5234, 50.4501],
        zoom: 3,
        maxZoom: MAX_ZOOM,
        attributionControl: { compact: true },
        maplibreLogo: false,
        // A photo map has no use for tilt or rotation, and both make the
        // thumbnails harder to read.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        renderWorldCopies: false,
      });
      mapRef.current = map;
      // `touchZoomRotate: false` used to sit in the options above, for the same
      // no-rotation reason — but that handler owns pinch-to-ZOOM as well, so it
      // left a geographic map on a tablet with no gesture to zoom it at all.
      // Keep the handler and disable only its rotation half.
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

      map.once("load", () => {
        if (disposed) return;
        setReady(true);
      });
      map.on("moveend", () => !disposed && syncMarkers());
      map.on("click", () => setStack(null));
    })();

    return () => {
      disposed = true;
      for (const marker of markers.values()) marker.remove();
      markers.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Constructed once; point/selection changes flow through syncMarkers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Frame the archive once the map is up, and again whenever the set of
  // plottable photos changes (switching project, an ingest finishing).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const bounds = boundsOf(points);
    if (bounds) {
      map.fitBounds(
        [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ],
        { padding: 96, maxZoom: 14, duration: 0 },
      );
    }
    syncMarkers();
  }, [ready, points, syncMarkers]);

  // Selection is painted on existing nodes rather than by rebuilding them.
  useEffect(() => {
    if (!ready) return;
    for (const [key, marker] of markersRef.current) {
      if (!key.startsWith("p")) continue;
      const el = marker.getElement();
      const plate = el.querySelector<HTMLElement>("[data-plate]");
      if (plate) paintSelection(plate, selectedIds.has(key.slice(1)));
    }
  }, [ready, selectedIds]);

  if (failed) {
    return (
      <div style={paneEmpty}>
        <div style={emptyTitle}>Map unavailable</div>
        <div style={emptySub}>The basemap could not be loaded. Check the connection and try again.</div>
      </div>
    );
  }

  return (
    <>
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
      {stack && stack.length > 0 && (
        <StackPanel
          stack={stack}
          onOpenAsset={onOpenAsset}
          onSelectAssets={onSelectAssets}
          onClose={() => setStack(null)}
        />
      )}
    </>
  );
}

/** The photos-at-one-spot panel. Deliberately the same shape as the chat
 *  panel's search-result strip — same 38 px thumbs, same "select on canvas"
 *  hand-off — so the two read as one idea. */
function StackPanel({
  stack,
  onOpenAsset,
  onSelectAssets,
  onClose,
}: {
  stack: GeoPoint[];
  onOpenAsset: (id: string) => void;
  onSelectAssets: (ids: string[]) => void;
  onClose: () => void;
}) {
  return (
    <div style={stackPanel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--t3)" }}>
          {formatCount(stack.length)} {stack.length === 1 ? "file here" : "files here"}
        </span>
        <button onClick={onClose} aria-label="Close" style={stackClose}>
          ✕
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {stack.slice(0, 24).map((p) => (
          <button
            key={p.assetId}
            onClick={() => onOpenAsset(p.assetId)}
            title={p.filename}
            style={{
              width: 38,
              height: 38,
              padding: 0,
              border: "1px solid var(--bd)",
              borderRadius: 2,
              background: p.thumb ? `center/cover url(${p.thumb})` : "var(--bg-in)",
              cursor: "pointer",
            }}
          />
        ))}
        {stack.length > 24 && (
          <span style={{ alignSelf: "center", fontSize: 11, color: "var(--t3)" }}>+{stack.length - 24}</span>
        )}
      </div>
      <button onClick={() => onSelectAssets(stack.map((p) => p.assetId))} style={stackSelect}>
        Select {formatCount(stack.length)} on canvas
      </button>
    </div>
  );
}

function paintSelection(plate: HTMLElement, selected: boolean): void {
  plate.style.borderColor = selected ? "var(--ac2)" : "var(--bd)";
  plate.style.borderWidth = selected ? "2px" : "1px";
}

/** A CSS background for a thumbnail. Quoted, because a presigned URL is not
 *  guaranteed to be free of `url()`-hostile characters. */
function thumbBackground(thumb: string | undefined): string {
  return thumb ? `center/cover url("${thumb}")` : "var(--bg-in)";
}

/** The grid a mosaic of N photos is laid out on. Two and three split into ROWS
 *  rather than columns: a half-width cell crops a landscape photo — which most
 *  of an archive is — down to a vertical sliver of its middle, while a
 *  half-height one keeps the frame readable. Three is the asymmetric case: the
 *  newest takes the full-width top, rather than a 2×2 with a hole in it. */
function mosaicGrid(cells: number): string {
  if (cells <= 1) return "grid-template-columns:1fr;grid-template-rows:1fr;";
  if (cells === 2) return "grid-template-columns:1fr;grid-template-rows:1fr 1fr;";
  return "grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;";
}

/** Built imperatively: MapLibre wants a real DOM node, and keeping these off
 *  React's reconciler is what makes panning cheap. */
function buildMarkerElement({
  count,
  thumbs,
  selected,
}: {
  count: number;
  /** Newest first — the mosaic fills top-left to bottom-right. */
  thumbs: readonly (string | undefined)[];
  selected: boolean;
}): HTMLElement {
  const size = markerSize(count);
  // MapLibre OWNS wrap.style.transform — it positions every marker by writing
  // `translate(-50%,-100%) translate(Xpx,Ypx)` onto the element it was handed.
  // Nothing else may touch it: a hover scale written here wipes the translate
  // and the marker snaps to the map container's origin until the next
  // setLngLat puts it back (which is why panning "fixed" it). Everything
  // visual therefore lives in `inner`, which is ours to transform.
  const wrap = document.createElement("div");
  wrap.style.cssText = `position:relative;width:${size}px;height:${size}px;cursor:pointer;`;

  const inner = document.createElement("div");
  // Grows from the pin's tip rather than its middle, so the marker stays on the
  // coordinate it is pointing at while it scales.
  inner.style.cssText =
    "position:absolute;inset:0;transform-origin:bottom center;transition:transform .15s;";
  wrap.appendChild(inner);

  // The tail is a rotated square, so its two visible edges are the same 1 px
  // hairline as the plate; the plate then covers its top half.
  const tail = document.createElement("div");
  tail.style.cssText =
    "position:absolute;bottom:-4px;left:50%;width:8px;height:8px;" +
    "transform:translateX(-50%) rotate(45deg);background:var(--bg-in);" +
    "border-right:1px solid var(--bd);border-bottom:1px solid var(--bd);";
  inner.appendChild(tail);

  // The plate is a grid of the cluster's newest photos rather than one cover:
  // a place is recognised by what is at it, and a stack of prints only ever
  // showed the top one. `box-sizing` matters here in a way it did not for a
  // single background — without it the border pushes the cells out of the tile.
  // The 1 px gaps are the plate's own background showing through, which is what
  // keeps two dark photographs from reading as one.
  const cells = mosaicCells(count);
  const plate = document.createElement("div");
  plate.dataset.plate = "";
  plate.style.cssText =
    `position:relative;box-sizing:border-box;width:100%;height:100%;` +
    `overflow:hidden;border-radius:3px;display:grid;gap:1px;` +
    mosaicGrid(cells) +
    `border:${selected ? "2px" : "1px"} solid ${selected ? "var(--ac2)" : "var(--bd)"};` +
    `background:var(--bg-in);` +
    // A resting shadow, unlike the canvas tiles: these float over a live
    // basemap and need to detach from it.
    `box-shadow:0 4px 14px rgba(0,0,0,.55);transition:box-shadow .15s;`;
  for (let i = 0; i < cells; i += 1) {
    const cell = document.createElement("div");
    cell.style.cssText =
      `background:${thumbBackground(thumbs[i])};` +
      // Three photos: the newest takes the full-width top row.
      (cells === 3 && i === 0 ? "grid-column:span 2;" : "");
    plate.appendChild(cell);
  }
  inner.appendChild(plate);

  wrap.addEventListener("pointerenter", () => {
    plate.style.boxShadow = "0 12px 28px rgba(0,0,0,.42), 0 0 0 1px rgba(255,255,255,.06)";
    inner.style.transform = "scale(1.06)";
  });
  wrap.addEventListener("pointerleave", () => {
    plate.style.boxShadow = "0 4px 14px rgba(0,0,0,.55)";
    inner.style.transform = "scale(1)";
  });

  if (count > 1) {
    const badge = document.createElement("span");
    badge.textContent = formatCount(count);
    badge.style.cssText =
      "position:absolute;top:-6px;right:-6px;display:flex;align-items:center;justify-content:center;" +
      "min-width:18px;height:18px;padding:0 5px;border:1px solid rgba(255,255,255,.12);border-radius:2px;" +
      "background:rgba(8,8,8,.82);color:var(--t1);font-size:9.5px;font-weight:700;line-height:1;" +
      "letter-spacing:.06em;font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none;";
    inner.appendChild(badge);
  }
  return wrap;
}

const paneEmpty: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  background: "var(--bg)",
};
const emptyTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--t2)",
};
const emptySub: React.CSSProperties = { fontSize: 11.5, color: "var(--t3)" };

const stackPanel: React.CSSProperties = {
  position: "absolute",
  left: 16,
  bottom: 16,
  width: 268,
  padding: 12,
  background: "var(--bg-sf)",
  border: "1px solid var(--bd)",
  borderRadius: 3,
  boxShadow: "0 16px 48px rgba(0,0,0,.5)",
  zIndex: 6,
};
const stackClose: React.CSSProperties = {
  width: 18,
  height: 18,
  padding: 0,
  border: 0,
  borderRadius: 2,
  background: "transparent",
  color: "var(--t3)",
  fontSize: 11,
  cursor: "pointer",
  fontFamily: "inherit",
};
const stackSelect: React.CSSProperties = {
  width: "100%",
  height: 28,
  marginTop: 10,
  border: "1px solid var(--bd)",
  borderRadius: 2,
  background: "var(--bg-in)",
  color: "var(--t2)",
  fontSize: 11,
  cursor: "pointer",
  fontFamily: "inherit",
};
