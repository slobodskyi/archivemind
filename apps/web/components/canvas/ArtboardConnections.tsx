import { memo } from "react";
import type { ArtboardEdge } from "@/lib/layout";

interface ArtboardConnectionsProps {
  edges: ArtboardEdge[];
}

/** The all-to-all lines a "connected" artboard draws between its files (ADR
 *  0043) — the visual half of turning an artboard into a content pack. Sits
 *  inside the canvas's transformed content (so it pans/zooms with the tiles) and
 *  under them (the tiles are the nodes; the lines are the relationships). The
 *  logical pack — the AI reading every file and letting you generate a new one —
 *  is Oleksandr's backend; this is just the graph made visible.
 *
 *  A big fixed box rather than a 0×0 `overflow:visible` element, for the same
 *  reason InkOverlay uses one: a zero-sized SVG viewport paints nothing in
 *  Chrome. The inner translate puts canvas 0,0 back at the layer's middle. */
const REACH = 1_000_000;

function ArtboardConnectionsImpl({ edges }: ArtboardConnectionsProps) {
  if (edges.length === 0) return null;
  return (
    <svg
      style={{ position: "absolute", left: -REACH, top: -REACH, width: REACH * 2, height: REACH * 2, pointerEvents: "none", zIndex: 13 }}
      aria-hidden="true"
    >
      <g transform={`translate(${REACH} ${REACH})`}>
        {edges.map((e) => (
          <line
            key={e.id}
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
            stroke="var(--ac)"
            strokeWidth={1.4}
            strokeOpacity={0.5}
            strokeLinecap="round"
          />
        ))}
      </g>
    </svg>
  );
}

export default memo(ArtboardConnectionsImpl);
