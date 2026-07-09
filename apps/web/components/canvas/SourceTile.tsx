import type { TilePos } from "@/lib/layout";
import { hexA } from "@/lib/layout";

interface SourceTileProps {
  abbr: string;
  label: string;
  color: string;
  count: number;
  pos: TilePos;
  onOpen: () => void;
  onDragStart: (e: React.PointerEvent, origCenter: { x: number; y: number }) => void;
}

export default function SourceTile({ abbr, label, color, count, pos, onOpen, onDragStart }: SourceTileProps) {
  return (
    <div
      onPointerDown={(e) => onDragStart(e, { x: pos.cx, y: pos.cy })}
      onDoubleClick={onOpen}
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        width: pos.w,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 9,
        cursor: "grab",
        userSelect: "none",
        zIndex: 28,
      }}
    >
      <div
        style={{
          width: 62,
          height: 62,
          borderRadius: 999,
          background: "var(--bg-el)",
          border: `2px solid ${color}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `0 0 0 12px ${hexA(color, 0.12)}, 0 0 40px ${hexA(color, 0.3)}`,
          animation: "amPulse 2.8s ease-in-out infinite",
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, color, letterSpacing: "0.03em", fontFamily: "inherit" }}>
          {abbr}
        </span>
      </div>
      <div
        style={{
          background: "rgba(6,6,6,.96)",
          border: "1px solid rgba(255,255,255,.09)",
          padding: "5px 12px",
          borderRadius: 2,
          backdropFilter: "blur(10px)",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: "0.06em", whiteSpace: "nowrap", fontFamily: "inherit" }}>
          {label}
        </div>
        <div style={{ fontSize: 10.5, color: "var(--t2b)", textAlign: "center", letterSpacing: "0.04em", marginTop: 2 }}>
          {count} FILES
        </div>
      </div>
    </div>
  );
}
