import { memo } from "react";
import { hexA, type CloudLayout } from "@/lib/layout";

/** Extra margin the blurred backdrop blob extends past each cloud's tile bbox. */
const BLOB_PAD = 60;

interface CloudDecorProps {
  layout: CloudLayout;
  /** The colored clouds (blobs) render immediately with the grouping so the
   *  backdrop appears the same instant the tiles start reflowing (ADR 0022). Only
   *  the connecting lines wait for `edgesReady` — they're drawn between final
   *  tile centers, so showing them mid-glide would leave lines floating to empty
   *  space; they fade in once the tiles have settled. */
  edgesReady: boolean;
}

/** Backdrop for the grouping views (Timeline / Map / Topic): the blurred faded
 *  color cloud behind each group and the connecting lines. Rendered *behind* the
 *  photo tiles; the labels render on top via CloudLabels. Tiles themselves are
 *  drawn by the shared ProjectAssetView so they persist (and animate) across
 *  every view (ADR 0022). */
function CloudDecor({ layout, edgesReady }: CloudDecorProps) {
  return (
    <>
      {/* Blurred faded backdrop per cloud — sized to the group's live tile bbox
          so it tracks the files as they're dragged. Shown immediately (no fade)
          so the color cloud loads together with the grouping. */}
      {layout.clouds.map((c) => (
        <div
          key={`blob-${c.key}`}
          style={{
            position: "absolute",
            left: c.bx - BLOB_PAD,
            top: c.by - BLOB_PAD,
            width: c.bw + BLOB_PAD * 2,
            height: c.bh + BLOB_PAD * 2,
            borderRadius: "50%",
            background: `radial-gradient(closest-side, ${hexA(c.color, 0.22)}, ${hexA(c.color, 0)})`,
            filter: "blur(28px)",
            pointerEvents: "none",
          }}
        />
      ))}

      <svg style={{ position: "absolute", left: 0, top: 0, width: 1600, height: 1100, overflow: "visible", pointerEvents: "none", opacity: edgesReady ? 1 : 0, transition: "opacity .3s ease" }}>
        <defs>
          {layout.edges
            .filter((e) => e.strokeStart !== e.strokeEnd)
            .map((e) => (
              <linearGradient key={e.id} id={`cloud-grad-${e.id}`} gradientUnits="userSpaceOnUse" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}>
                <stop offset="0%" stopColor={e.strokeStart} />
                <stop offset="100%" stopColor={e.strokeEnd} />
              </linearGradient>
            ))}
        </defs>
        {layout.edges.map((e) => (
          <path
            key={e.id}
            d={e.d}
            stroke={e.strokeStart === e.strokeEnd ? e.strokeStart : `url(#cloud-grad-${e.id})`}
            strokeWidth={e.w}
            strokeOpacity={e.op}
            strokeLinecap="round"
            fill="none"
          />
        ))}
      </svg>
    </>
  );
}

/** The cloud group labels (month / country / topic), rendered *on top* of the
 *  tiles and anchored to the top-center of each cloud's backdrop so they stay
 *  attached to the colored cloud and never sit hidden under the files. Shown
 *  immediately with the backdrop (ADR 0022). */
function CloudLabelsBase({ layout }: { layout: CloudLayout }) {
  return (
    <>
      {layout.clouds.map((c) => (
        <div
          key={`label-${c.key}`}
          style={{
            position: "absolute",
            left: c.labelX,
            top: c.labelY - 34,
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "0.05em",
            color: c.color,
            textShadow: `0 0 12px ${hexA(c.color, 0.55)}, 0 1px 3px rgba(0,0,0,0.7)`,
            pointerEvents: "none",
          }}
        >
          {c.label.toUpperCase()}
        </div>
      ))}
    </>
  );
}

export const CloudLabels = memo(CloudLabelsBase);
export default memo(CloudDecor);
