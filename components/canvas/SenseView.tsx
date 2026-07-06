import { hexA, type SenseBubble } from "@/lib/layout";

interface SenseViewProps {
  bubbles: SenseBubble[];
  onOpenBubble: (bubble: SenseBubble) => void;
}

export default function SenseView({ bubbles, onOpenBubble }: SenseViewProps) {
  return (
    <>
      {bubbles.map((sb) => {
        const fontSize = Math.max(11, Math.min(15, sb.size / 12));
        return (
          <div
            key={sb.key}
            onDoubleClick={() => onOpenBubble(sb)}
            className="am-bubble"
            style={{
              position: "absolute",
              left: sb.x,
              top: sb.y,
              transform: "translate(-50%,-50%)",
              width: sb.size,
              height: sb.size,
              borderRadius: 999,
              background: hexA(sb.color, 0.12),
              border: `1.5px solid ${sb.color}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              boxShadow: `0 0 0 10px ${hexA(sb.color, 0.08)}, 0 10px 32px rgba(0,0,0,.4)`,
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
    </>
  );
}
