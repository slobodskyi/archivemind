import { useRef, useState } from "react";
import type { Frame } from "@/lib/layout";
import { CloseIcon } from "@/components/icons/icons";

type Handle = "nw" | "ne" | "sw" | "se";

interface FrameOverlayProps {
  frames: Frame[];
  /** How many tiles sit inside each frame (positional) — header badge. */
  counts: Record<string, number>;
  /** The selected artboard (its contents == the selection) — gets a green
   *  outline, the same cue a selected tile shows. */
  selectedFrameId: string | null;
  draft: { x: number; y: number; w: number; h: number } | null;
  /** Canvas zoom, to convert screen-space drag deltas into content space. */
  scale: number;
  onSelectFrame: (id: string) => void;
  onDeleteFrame: (id: string) => void;
  onRenameFrame: (id: string, label: string) => void;
  /** ＋ on a content-pack artboard — create a new file of `format` from the pack. */
  onCreateFile: (id: string, format: string) => void;
  onBeginMove: (id: string) => void;
  onBeginResize: (id: string, handle: Handle) => void;
  onGestureMove: (dx: number, dy: number) => void;
  onEndGesture: () => void;
}

const DRAG_THRESHOLD = 3;

/** The ＋ menu's offer (ADR 0043). Text + PDF now; more as the backend generator
 *  grows. The `format` string is what reaches `onCreateFile` (and, later, the
 *  generate endpoint). */
const FILE_TYPES: { format: string; label: string }[] = [
  { format: "text", label: "Text file" },
  { format: "pdf", label: "PDF document" },
];

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

const HANDLE_CURSOR: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
};

/** Artboards (frames): a labelled region that acts as one unit (ADR 0034/0035).
 *  The header selects/exports/deletes the whole artboard and is the move handle;
 *  corner handles resize it. Move translates and resize scales the contained
 *  tiles' positions so nothing inside is ever left behind. */
export default function FrameOverlay({
  frames,
  counts,
  selectedFrameId,
  draft,
  scale,
  onSelectFrame,
  onDeleteFrame,
  onRenameFrame,
  onCreateFile,
  onBeginMove,
  onBeginResize,
  onGestureMove,
  onEndGesture,
}: FrameOverlayProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  // Which connected artboard has its ＋ "create file" menu open.
  const [menuFrameId, setMenuFrameId] = useState<string | null>(null);
  const gesture = useRef<{ id: string; mode: "move" | "resize"; handle: Handle; sx: number; sy: number; began: boolean } | null>(null);

  const commitRename = () => {
    if (editingId) {
      const trimmed = draftLabel.trim();
      if (trimmed) onRenameFrame(editingId, trimmed);
    }
    setEditingId(null);
  };

  const beginPointer = (e: React.PointerEvent, id: string, mode: "move" | "resize", handle: Handle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    gesture.current = { id, mode, handle, sx: e.clientX, sy: e.clientY, began: false };
    const onMove = (ev: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const sdx = ev.clientX - g.sx;
      const sdy = ev.clientY - g.sy;
      if (!g.began) {
        if (Math.abs(sdx) + Math.abs(sdy) < DRAG_THRESHOLD) return;
        g.began = true;
        if (g.mode === "move") onBeginMove(g.id);
        else onBeginResize(g.id, g.handle);
      }
      onGestureMove(sdx / scale, sdy / scale);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const g = gesture.current;
      gesture.current = null;
      if (!g) return;
      if (!g.began && g.mode === "move") onSelectFrame(g.id); // a click (no drag) selects
      else if (g.began) onEndGesture();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleStyle = (h: Handle): React.CSSProperties => ({
    position: "absolute",
    width: 12,
    height: 12,
    background: "var(--bg-el)",
    border: "1px solid var(--bdh)",
    borderRadius: 2,
    pointerEvents: "auto",
    cursor: HANDLE_CURSOR[h],
    ...(h === "nw" ? { left: -6, top: -6 } : {}),
    ...(h === "ne" ? { right: -6, top: -6 } : {}),
    ...(h === "sw" ? { left: -6, bottom: -6 } : {}),
    ...(h === "se" ? { right: -6, bottom: -6 } : {}),
  });

  return (
    <>
      {frames.map((fr) => {
        const selected = fr.id === selectedFrameId;
        return (
        <div
          key={fr.id}
          style={{
            position: "absolute",
            left: fr.x,
            top: fr.y,
            width: fr.w,
            height: fr.h,
            // Green outline when selected — the same cue a selected tile shows.
            border: selected ? "2px solid var(--ac)" : "1px solid var(--bdh)",
            // A visible panel fill (was near-transparent) so the board reads as a
            // real surface on the dark canvas — plus a faint green wash when
            // selected so the whole board reads as picked, not just its outline.
            // Sits at zIndex 0, below the tiles (zIndex ≥2), so it never covers a
            // photo.
            background: selected ? "color-mix(in srgb, var(--ac) 10%, rgba(255,255,255,0.05))" : "rgba(255,255,255,0.05)",
            boxShadow: selected ? "0 0 0 1px var(--ac)" : "none",
            zIndex: 0,
            pointerEvents: "none",
          }}
        >
          {/* Header: move handle + select (click) + rename (dbl-click) + actions. */}
          <div
            onPointerDown={(e) => {
              if (editingId !== fr.id) beginPointer(e, fr.id, "move", "se");
            }}
            style={{
              position: "absolute",
              left: 0,
              top: -24,
              display: "flex",
              alignItems: "center",
              gap: 5,
              pointerEvents: "auto",
              cursor: "grab",
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
                title="Drag to move · click to select · double-click to rename"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--t3)",
                  letterSpacing: "0.02em",
                  whiteSpace: "nowrap",
                  cursor: "grab",
                }}
              >
                {fr.label}
              </span>
            )}
            <span style={{ fontSize: 10, color: "var(--t3)", opacity: 0.8 }}>{counts[fr.id] ?? 0}</span>

            {/* An artboard with ≥2 files is automatically a content pack (ADR
                0043) — no Connect button, the analysis happens on file-add. The
                ＋ offers to create a new file synthesised from the pack. */}
            {(counts[fr.id] ?? 0) >= 2 && (
              <div style={{ position: "relative" }}>
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuFrameId((cur) => (cur === fr.id ? null : fr.id));
                  }}
                  title="Create a new file from this pack"
                  aria-label="Create a new file from this pack"
                  style={{ ...btn, background: "var(--ac)", color: "#050505", fontWeight: 700 }}
                >
                  ＋
                </button>
                {menuFrameId === fr.id && (
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{
                      position: "absolute",
                      top: "100%",
                      right: 0,
                      marginTop: 4,
                      display: "flex",
                      flexDirection: "column",
                      minWidth: 116,
                      padding: 4,
                      background: "rgba(18,18,18,.97)",
                      border: "1px solid var(--bd)",
                      borderRadius: 2,
                      backdropFilter: "blur(20px)",
                      boxShadow: "0 20px 60px rgba(0,0,0,.7)",
                      zIndex: 5,
                    }}
                  >
                    {FILE_TYPES.map((ft) => (
                      <button
                        key={ft.format}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuFrameId(null);
                          onCreateFile(fr.id, ft.format);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          height: 26,
                          padding: "0 8px",
                          border: 0,
                          borderRadius: 2,
                          background: "transparent",
                          color: "var(--t1)",
                          fontSize: 12,
                          fontFamily: "inherit",
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        {ft.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Export lives in the bottom action bar now, not on the artboard. */}
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

          {/* Corner resize handles — content scales with the frame. */}
          {(["nw", "ne", "sw", "se"] as Handle[]).map((h) => (
            <div key={h} onPointerDown={(e) => beginPointer(e, fr.id, "resize", h)} style={handleStyle(h)} />
          ))}
        </div>
        );
      })}
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
