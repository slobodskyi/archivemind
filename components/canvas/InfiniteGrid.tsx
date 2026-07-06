interface InfiniteGridProps {
  gridSize?: number;
  gridPos?: string;
  gridOpacity?: number;
}

export default function InfiniteGrid({
  gridSize = 40,
  gridPos = "200px 120px",
  gridOpacity = 1,
}: InfiniteGridProps) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        opacity: gridOpacity,
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.035) 1px,transparent 1px)",
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: gridPos,
      }}
    />
  );
}
