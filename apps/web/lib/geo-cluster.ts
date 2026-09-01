import Supercluster from "supercluster";
import { CLUSTER_COVER_LIMIT, mergeCoverIndices, type GeoPoint } from "./geo";

/** The Map view's clustering (ADR 0027). Kept out of `lib/geo.ts` because that
 *  module is imported by `GeoMapPane`, which is NOT lazily loaded — supercluster
 *  belongs in the same chunk as MapLibre, behind `GeoMapCanvas`'s
 *  `dynamic(ssr:false)` boundary. Browser-free, so it is unit-testable. */

export interface PointProps {
  assetId: string;
  thumb?: string;
  filename: string;
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
      properties: { assetId: p.assetId, thumb: p.thumb, filename: p.filename, idx },
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
    })),
  );
  return index;
}

/** The photos a cluster marker wears: cover first, then the prints behind it.
 *  A missing thumbnail stays `undefined` — previews arrive after the row. */
export function coverThumbs(
  cover: readonly number[],
  points: readonly GeoPoint[],
): (string | undefined)[] {
  return cover.slice(0, CLUSTER_COVER_LIMIT).map((i) => points[i]?.thumb);
}
