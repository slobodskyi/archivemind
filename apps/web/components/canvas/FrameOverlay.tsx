import { useState } from "react";
import type { Frame } from "@/lib/layout";
import { CloseIcon } from "@/components/icons/icons";

interface FrameOverlayProps {
  frames: Frame[];
  draft: { x: number; y: number; w: number; h: number } | null;
  onDeleteFrame: (id: string) => void;
  onRenameFrame: (id: string, label: string) => void;
}

export default function FrameOverlay({ frames, draft, onDeleteFrame, onRenameFrame }: FrameOverlayProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");

  const commitRename = () => {
    if (editingId) {
      const trimmed = draftLabel.trim();
      if (trimmed) onRenameFrame(editingId, trimmed);
    }
    setEditingId(null);
  };

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
            {editingId === fr.id ? (
              <input
                autoFocus
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  else if (e.key === "Escape") setEditingId(null);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--t1)",
                  letterSpacing: "0.02em",
                  background: "var(--bg-el)",
                  border: "1px solid var(--ac)",
                  borderRadius: 2,
                  padding: "1px 4px",
                  width: Math.max(60, draftLabel.length * 7),
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
            ) : (
              <span
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingId(fr.id);
                  setDraftLabel(fr.label);
                }}
                title="Double-click to rename"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--t3)",
                  letterSpacing: "0.02em",
                  whiteSpace: "nowrap",
                  cursor: "text",
                }}
              >
                {fr.label}
              </span>
            )}
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
