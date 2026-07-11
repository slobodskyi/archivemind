import { memo } from "react";
import { hexA, type SenseBubble, type ExpandOverlay } from "@/lib/layout";
import ExpandFileTile from "./ExpandFileTile";

interface SenseViewProps {
  bubbles: SenseBubble[];
  expandedKey: string | null;
  expand: ExpandOverlay | null;
  hoveredId: string | null;
  onToggle: (key: string) => void;
  onExpandFileDown: (e: React.PointerEvent, id: string, x: number, y: number, space: "canvas" | "map") => void;
  setHover: (id: string | null) => void;
  openDrawer: (id: string) => void;
  deletePhoto: (id: string) => void;
}

function SenseView({
  bubbles,
  expandedKey,
  expand,
  hoveredId,
  onToggle,
  onExpandFileDown,
  setHover,
  openDrawer,
  deletePhoto,
}: SenseViewProps) {
  return (
    <>
      {bubbles.map((sb) => {
        const fontSize = Math.max(11, Math.min(15, sb.size / 12));
        const active = sb.key === expandedKey;
        return (
          <div
            key={sb.key}
            onDoubleClick={() => onToggle(sb.key)}
            className="am-bubble"
            style={{
              position: "absolute",
              left: sb.x,
              top: sb.y,
              transform: "translate(-50%,-50%)",
              width: sb.size,
              height: sb.size,
              borderRadius: 999,
              background: hexA(sb.color, active ? 0.2 : 0.12),
              border: `1.5px solid ${sb.color}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              boxShadow: `0 0 0 10px ${hexA(sb.color, active ? 0.14 : 0.08)}, 0 10px 32px rgba(0,0,0,.4)`,
              gap: 4,
            }}
          >
            <span style={{ fontSize, fontWeight: 700, color: sb.color, letterSpacing: "0.02em", textAlign: "center", padding: "0 8px" }}>
              {sb.label}
            </span>
            <span style={{ fontSize: 11, color: "var(--t3)" }}>{sb.count} files</span>
          </div>
        );
      })}

      {expand && (
        <>
          <svg style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 900, overflow: "visible", pointerEvents: "none" }}>
            {expand.edges.map((e, i) => (
              <path key={`se${i}`} d={e.d} stroke={e.stroke} strokeWidth={e.w} strokeOpacity={e.op} strokeLinecap="round" fill="none" />
            ))}
          </svg>
          {expand.files.map((f) => (
            <ExpandFileTile
              key={f.id}
              file={f}
              hovered={f.id === hoveredId}
              onDown={(e) => onExpandFileDown(e, f.id, f.x, f.y, "canvas")}
              onEnter={() => setHover(f.id)}
              onLeave={() => setHover(null)}
              onOpen={(e) => {
                e.stopPropagation();
                openDrawer(f.id);
              }}
              onDelete={(e) => {
                e.stopPropagation();
                deletePhoto(f.id);
              }}
            />
          ))}
        </>
      )}
    </>
  );
}

export default memo(SenseView);
