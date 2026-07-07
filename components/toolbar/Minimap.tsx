import type { MinimapLayout } from "@/lib/layout";

interface MinimapProps {
  minimap: MinimapLayout;
  onDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export default function Minimap({ minimap, onDown }: MinimapProps) {
  if (!minimap.show) return null;
  return (
    <div
      onPointerDown={onDown}
      style={{
        position: "absolute",
        bottom: 20,
        right: 20,
        width: 180,
        height: 120,
        background: "rgba(14,14,14,.92)",
        border: "1px solid var(--bdh)",
        borderRadius: 2,
        backdropFilter: "blur(16px)",
        boxShadow: "0 8px 32px rgba(0,0,0,.45)",
        zIndex: 35,
        overflow: "hidden",
        cursor: "pointer",
      }}
    >
      {minimap.dots.map((d, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: d.x,
            top: d.y,
            width: 2,
            height: 2,
            borderRadius: 999,
            background: "var(--t3)",
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          left: minimap.vp.x,
          top: minimap.vp.y,
          width: minimap.vp.w,
          height: minimap.vp.h,
          border: "1.5px solid var(--ac)",
          background: "rgba(57,255,106,.08)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
