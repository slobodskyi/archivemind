import Supercluster from "supercluster";
import type { AssetLabel } from "@archivemind/shared";
import { CLUSTER_COVER_LIMIT, mergeCoverIndices, type GeoPoint } from "./geo";

/** The Map view's clustering (ADR 0027). Kept out of `lib/geo.ts` because that
 *  module is imported by `GeoMapPane`, which is NOT lazily loaded — supercluster
 *  belongs in the same chunk as MapLibre, behind `GeoMapCanvas`'s
 *  `dynamic(ssr:false)` boundary. Browser-free, so it is unit-testable. */

export interface PointProps {
  assetId: string;
  thumb?: string;
  filename: string;
  label: AssetLabel | null;
  /** Position in the caller's newest-first array — see `cover` below. */
  idx: number;
}

export interface ClusterProps {
  /** Up to CLUSTER_COVER_LIMIT indices into the point array, ascending: the
   *  cluster's newest photos, which the marker wears as a cover plus the prints
   *  behind it. Indices rather than URLs, so the cluster tree doesn't carry a
   *  copy of every presigned thumbnail at every zoom level. */
  cover: number[];
}

/** Past this the basemap has no more detail to give and clusters should have
 *  resolved into individual photos. */
export const MAX_ZOOM = 17;
const CLUSTER_RADIUS = 64;

export function buildClusterIndex(points: readonly GeoPoint[]): Supercluster<PointProps, ClusterProps> {
  const index = new Supercluster<PointProps, ClusterProps>({
    radius: CLUSTER_RADIUS,
    maxZoom: MAX_ZOOM - 1,
    // `map` alone does NOTHING: supercluster only calls it when a `reduce` is
    // also present (its clustering loop is guarded by `if (reduce)`), so the
    // pair is what carries a cluster's cover photos up the tree. Shipping `map`
    // on its own is why every cluster marker used to paint an empty plate.
    map: (props) => ({ cover: [props.idx] }),
    // `accumulated` is a SHALLOW clone of a lower cluster's props, so its array
    // is shared with that cluster — assign a new one, never push into it.
    reduce: (accumulated, props) => {
      accumulated.cover = mergeCoverIndices(accumulated.cover, props.cover);
    },
  });
  index.load(
    points.map((p, idx) => ({
      type: "Feature" as const,
      properties: { assetId: p.assetId, thumb: p.thumb, filename: p.filename, label: p.label, idx },
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
    })),
  );
  return index;
}

/** One tile of a marker's mosaic: the photograph and, if a person marked it,
 *  its colour. A cell rather than a bare thumbnail because the colour label
 *  belongs to the PHOTO, and the mosaic shows photos — so the dot is drawn per
 *  cell instead of summarised for the cluster, which could only ever describe
 *  the four we carry rather than the hundreds we do not. */
export interface MarkerCell {
  /** Absent while previews are still being made. */
  thumb?: string;
  label: AssetLabel | null;
}

/** The photos a cluster marker tiles, newest first. A cover index with no
 *  point behind it yields an empty cell rather than being dropped: the mosaic's
 *  shape is decided by the cluster's SIZE, so silently shrinking it here would
 *  make a grid and its cell list disagree. */
export function coverCells(cover: readonly number[], points: readonly GeoPoint[]): MarkerCell[] {
  return cover.slice(0, CLUSTER_COVER_LIMIT).map((i) => {
    const p = points[i];
    return { thumb: p?.thumb, label: p?.label ?? null };
  });
}
