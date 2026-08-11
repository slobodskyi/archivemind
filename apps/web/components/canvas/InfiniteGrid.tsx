interface InfiniteGridProps {
  gridSize?: number;
  gridPos?: string;
  gridOpacity?: number;
  /** `dots` for the sorting/browse views, `lines` for the (Stage-2) workspace
   *  canvas — the two surfaces read differently on purpose. Same cell size. */
  variant?: "dots" | "lines";
}

const LINES =
  "linear-gradient(rgba(255,255,255,0.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.035) 1px,transparent 1px)";
/** A dot at each cell corner — a 1.5px radial dab, same cadence as the lines. */
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
