import type { MinimapLayout } from "@/lib/layout";

interface MinimapProps {
  minimap: MinimapLayout;
  onDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  /** Extra right offset (px) so the chat panel never covers the minimap. */
  right?: number;
}

export default function Minimap({ minimap, onDown, right = 0 }: MinimapProps) {
  if (!minimap.show) return null;
  return (
    <div
      onPointerDown={onDown}
      style={{
        position: "absolute",
        bottom: 20,
        right: 20 + right,
        width: 180,
        height: 120,
        background: "rgba(14,14,14,.92)",
        border: "1px solid var(--bdh)",
        borderRadius: 2,
        backdropFilter: "blur(16px)",
        boxShadow: "0 8px 32px rgba(0,0,0,.45)",
        zIndex: 35,
        overflow: "hidden",
        cursor: "grab",
        transition: "right .2s cubic-bezier(.22,1,.36,1)",
        touchAction: "none",
      }}
    >
      {minimap.dots.map((d, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: d.x - 2,
            top: d.y - 2,
            width: 4,
            height: 4,
            borderRadius: 1.5,
            background: "var(--t2)",
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
