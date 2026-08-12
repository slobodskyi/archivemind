interface InfiniteGridProps {
  gridSize?: number;
  gridPos?: string;
  gridOpacity?: number;
  /** `lines` inside an open Workspace, `dots` over the whole project (ADR 0044).
   *  The grid states the SCOPE, not the activity — a narrowed canvas is
   *  otherwise indistinguishable from a full one. Same cell size either way, so
   *  entering a Workspace doesn't change the sense of scale.
   *
   *  Note that neither pattern is a snap target: the background cell is 40 units
   *  while tiles pack on 184×176 and are deliberately jittered off it
   *  (`assetGallery`). This is signage, not alignment. */
  variant?: "dots" | "lines";
}

const LINES =
  "linear-gradient(rgba(255,255,255,0.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.035) 1px,transparent 1px)";
/** A dot at each cell corner — a 1.4px radial dab, same cadence as the lines. */
const DOTS = "radial-gradient(rgba(255,255,255,0.08) 1.4px, transparent 1.6px)";

export default function InfiniteGrid({
  gridSize = 40,
  gridPos = "200px 120px",
  gridOpacity = 1,
  variant = "lines",
}: InfiniteGridProps) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        opacity: gridOpacity,
        backgroundImage: variant === "dots" ? DOTS : LINES,
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: gridPos,
      }}
    />
  );
}
