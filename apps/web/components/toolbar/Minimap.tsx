import { memo } from "react";
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
      // Hidden below 760px: 180×120 is half the width of a phone, it sat
      // directly on top of the bottom bars, and pinch-zoom plus Fit already
      // answer "where am I on this canvas" on touch.
      className="am-minimap"
      style={{
        position: "absolute",
        bottom: 20,
        // Bottom-LEFT: the full-height chat/drawer/trash panels all open on the
        // right, so anchoring here means the minimap is never covered — and no
        // dodge offset is needed the way it was on the right.
        left: 20,
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
        touchAction: "none",
      }}
    >
      <MinimapDots dots={minimap.dots} />
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

const MinimapDots = memo(function MinimapDots({ dots }: { dots: MinimapLayout["dots"] }) {
  return dots.map((d, i) => (
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
  ));
});
