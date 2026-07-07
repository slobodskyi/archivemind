import type { Frame } from "@/lib/layout";
import { CloseIcon } from "@/components/icons/icons";

interface FrameOverlayProps {
  frames: Frame[];
  draft: { x: number; y: number; w: number; h: number } | null;
  onDeleteFrame: (id: string) => void;
}

export default function FrameOverlay({ frames, draft, onDeleteFrame }: FrameOverlayProps) {
  return (
    <>
      {frames.map((fr) => (
        <div
          key={fr.id}
          style={{
            position: "absolute",
            left: fr.x,
            top: fr.y,
            width: fr.w,
            height: fr.h,
            border: "1px solid var(--bdh)",
            background: "rgba(255,255,255,0.012)",
            zIndex: 0,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: -24,
              display: "flex",
              alignItems: "center",
              gap: 6,
              pointerEvents: "auto",
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--t3)", letterSpacing: "0.02em", whiteSpace: "nowrap" }}>
              {fr.label}
            </span>
            <button
              onClick={() => onDeleteFrame(fr.id)}
              title="Delete frame"
              aria-label="Delete frame"
              style={{
                display: "flex",
                width: 16,
                height: 16,
                alignItems: "center",
                justifyContent: "center",
                border: 0,
                borderRadius: 2,
                background: "var(--bg-el)",
                color: "var(--t3)",
                cursor: "pointer",
                opacity: 0.85,
              }}
            >
              <CloseIcon width={9} height={9} strokeWidth={2.4} />
            </button>
          </div>
        </div>
      ))}
      {draft && (
        <div
          style={{
            position: "absolute",
            left: draft.x,
            top: draft.y,
            width: draft.w,
            height: draft.h,
            border: "1.5px dashed var(--ac)",
            background: "rgba(57,255,106,.06)",
            zIndex: 0,
            pointerEvents: "none",
          }}
        />
      )}
    </>
  );
}
