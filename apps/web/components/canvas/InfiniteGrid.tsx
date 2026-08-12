interface InfiniteGridProps {
  gridSize?: number;
  gridPos?: string;
  gridOpacity?: number;
  /** `lines` on Canvas — the surface you arrange files on, where a ruled grid
   *  reads as something to line tiles up against. `dots` on the sorting views
   *  (Timeline / Topic), where the arrangement is computed and a ruled grid
   *  would promise a snap that isn't there. Same cell size either way, so
   *  switching views doesn't change the sense of scale. */
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
