import { memo } from "react";
import { hexA, type CloudLayout } from "@/lib/layout";

/** Extra margin the blurred backdrop blob extends past each cloud's tile bbox. */
const BLOB_PAD = 60;
/** Opacity applied to clouds/tiles that aren't the focused one (click a label). */
const DIM = 0.22;

interface CloudDecorProps {
  layout: CloudLayout;
  /** The colored clouds (blobs) render immediately with the grouping so the
   *  backdrop appears the same instant the tiles start reflowing (ADR 0024). Only
   *  the connecting lines wait for `edgesReady` — they're drawn between final
   *  tile centers, so showing them mid-glide would leave lines floating to empty
   *  space; they fade in once the tiles have settled. */
  edgesReady: boolean;
  /** When a cloud's label is clicked it becomes the focus; every other cloud
   *  (backdrop + tiles + label) fades back so it stands out. */
  focusedCloudKey: string | null;
}

/** Backdrop for the grouping views (Timeline / Map / Topic): the blurred faded
 *  color cloud behind each group, the timeline date borders, and the connecting
 *  lines. Rendered *behind* the photo tiles; the labels render on top via
 *  CloudLabels. Tiles themselves are drawn by the shared ProjectAssetView so
 *  they persist (and animate) across every view (ADR 0022). */
function CloudDecor({ layout, edgesReady, focusedCloudKey }: CloudDecorProps) {
  const dimOf = (key: string) => (focusedCloudKey && key !== focusedCloudKey ? DIM : 1);
  // Timeline's day clouds are pinned bands, so paint them more strongly than
  // Map/Topic's soft blobs — they read as the column, not a faint haze.
  const isTimeline = !!layout.axis;
  const blobAlpha = isTimeline ? 0.42 : 0.22;
  const blobBlur = isTimeline ? 22 : 28;
  return (
    <>
      {/* Colored backdrop per cloud. On Map/Topic it hugs the live tile bbox; on
          Timeline it's a stronger band pinned to the date (ADR 0024). */}
      {layout.clouds.map((c) => (
        <div
          key={`blob-${c.key}`}
          style={{
            position: "absolute",
            left: c.bx - BLOB_PAD,
            top: c.by - BLOB_PAD,
            width: c.bw + BLOB_PAD * 2,
            height: c.bh + BLOB_PAD * 2,
            borderRadius: isTimeline ? 40 : "50%",
            background: `radial-gradient(closest-side, ${hexA(c.color, blobAlpha)}, ${hexA(c.color, 0)})`,
            filter: `blur(${blobBlur}px)`,
            opacity: dimOf(c.key),
            transition: "opacity .2s ease",
            pointerEvents: "none",
          }}
        />
      ))}

      {/* Timeline only: the horizontal date axis + a tick under each date label. */}
      {layout.axis && (
        <>
          <div
            style={{
              position: "absolute",
              left: layout.axis.x1,
              top: layout.axis.y,
              width: layout.axis.x2 - layout.axis.x1,
              height: 0,
              borderTop: "1px solid var(--bd)",
              pointerEvents: "none",
            }}
          />
          {layout.clouds.map((c) => (
            <div
              key={`tick-${c.key}`}
              style={{
                position: "absolute",
                left: c.labelX,
                top: layout.axis!.y - 4,
                width: 0,
                height: 9,
                borderLeft: `2px solid ${c.color}`,
                opacity: dimOf(c.key),
                transform: "translateX(-50%)",
                pointerEvents: "none",
              }}
            />
          ))}
        </>
      )}

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
            // When a cloud is focused, its own same-cloud lines stay bright;
            // everything else — other clouds' lines AND every cross-cloud
            // bridge (cloudKey is undefined on bridges, including the focused
            // cloud's own) — fades only halfway, so cross-cloud connections
            // stay readable (less faded than the inactive clouds themselves).
            opacity={focusedCloudKey && e.cloudKey !== focusedCloudKey ? 0.5 : 1}
            style={{ transition: "opacity .2s ease" }}
          />
        ))}
      </svg>
    </>
  );
}

interface CloudLabelsProps {
  layout: CloudLayout;
  focusedCloudKey: string | null;
  /** Pointer-down on a label: drag it to move the whole cloud, or click (no
   *  drag) to focus it and fade the rest (ADR 0024). */
  onCloudLabelDown: (e: React.PointerEvent, cloudKey: string) => void;
}

/** The cloud group labels (date / country / topic), rendered *on top* of the
 *  tiles. Draggable — grab a label to move its whole cloud — and clickable to
 *  focus that cloud (fades the others). Shown immediately with the backdrop. */
function CloudLabelsBase({ layout, focusedCloudKey, onCloudLabelDown }: CloudLabelsProps) {
  return (
    <>
      {layout.clouds.map((c) => {
        const dim = focusedCloudKey && c.key !== focusedCloudKey ? DIM : 1;
        return (
          <div
            key={`label-${c.key}`}
            onPointerDown={(e) => onCloudLabelDown(e, c.key)}
            style={{
              position: "absolute",
              left: c.labelX,
              top: c.labelY - 34,
              transform: "translateX(-50%)",
              padding: "3px 8px",
              whiteSpace: "nowrap",
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: c.color,
              textShadow: `0 0 12px ${hexA(c.color, 0.55)}, 0 1px 3px rgba(0,0,0,0.7)`,
              opacity: dim,
              transition: "opacity .2s ease",
              cursor: "grab",
              touchAction: "none",
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          >
            {c.label.toUpperCase()}
          </div>
        );
      })}
    </>
  );
}

export const CloudLabels = memo(CloudLabelsBase);
export default memo(CloudDecor);
