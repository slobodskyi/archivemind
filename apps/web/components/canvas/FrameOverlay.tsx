import { useState } from "react";
import type { Frame } from "@/lib/layout";
import { CloseIcon } from "@/components/icons/icons";

interface FrameOverlayProps {
  frames: Frame[];
  /** How many tiles sit inside each frame (positional) — header badge. */
  counts: Record<string, number>;
  draft: { x: number; y: number; w: number; h: number } | null;
  onSelectFrame: (id: string) => void;
  onExportFrame: (id: string) => void;
  onDeleteFrame: (id: string) => void;
  onRenameFrame: (id: string, label: string) => void;
}

const btn: React.CSSProperties = {
  display: "flex",
  width: 18,
  height: 16,
  alignItems: "center",
  justifyContent: "center",
  border: 0,
  borderRadius: 2,
  background: "var(--bg-el)",
  color: "var(--t3)",
  cursor: "pointer",
  fontSize: 11,
  fontFamily: "inherit",
  padding: 0,
};

/** Artboards (frames) on the canvas. Beyond drawing a labelled region, a frame
 *  is now actionable as one unit (ADR 0034/0035): its header toolbar can select
 *  everything inside, export the whole artboard to PDF, or delete the frame +
 *  its content. Membership is positional — the tiles whose centers fall inside. */
export default function FrameOverlay({
  frames,
  counts,
  draft,
  onSelectFrame,
  onExportFrame,
  onDeleteFrame,
  onRenameFrame,
}: FrameOverlayProps) {
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
              gap: 5,
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
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectFrame(fr.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingId(fr.id);
                  setDraftLabel(fr.label);
                }}
                title="Click to select the artboard · double-click to rename"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--t3)",
                  letterSpacing: "0.02em",
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                {fr.label}
              </span>
            )}
            <span style={{ fontSize: 10, color: "var(--t3)", opacity: 0.8 }}>{counts[fr.id] ?? 0}</span>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onExportFrame(fr.id);
              }}
              title="Export artboard to PDF"
              aria-label="Export artboard to PDF"
              style={btn}
            >
              ↑
            </button>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDeleteFrame(fr.id);
              }}
              title="Delete artboard + its content"
              aria-label="Delete artboard and its content"
              style={btn}
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
