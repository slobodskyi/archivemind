import { useRef, useState } from "react";
import type { Frame } from "@/lib/layout";
import { CloseIcon } from "@/components/icons/icons";

type Handle = "nw" | "ne" | "sw" | "se";

interface FrameOverlayProps {
  frames: Frame[];
  /** How many tiles sit inside each frame (positional) — header badge. */
  counts: Record<string, number>;
  draft: { x: number; y: number; w: number; h: number } | null;
  /** Canvas zoom, to convert screen-space drag deltas into content space. */
  scale: number;
  onSelectFrame: (id: string) => void;
  onExportFrame: (id: string) => void;
  onDeleteFrame: (id: string) => void;
  onRenameFrame: (id: string, label: string) => void;
  /** "Connect" the artboard into a content pack (ADR 0043). */
  onConnect: (id: string) => void;
  /** ＋ on a connected artboard — create a new file of `format` from the pack. */
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
  draft,
  scale,
  onSelectFrame,
  onExportFrame,
  onDeleteFrame,
  onRenameFrame,
  onConnect,
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

            {/* Connect → content pack (ADR 0043). Before connecting: a Connect
                pill. After: a ＋ that opens a file-type menu (stubbed). */}
            {fr.connected ? (
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
            ) : (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onConnect(fr.id);
                }}
                title="Connect these files into a content pack"
                aria-label="Connect artboard"
                style={{ ...btn, width: "auto", padding: "0 6px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em" }}
              >
                CONNECT
              </button>
            )}

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

          {/* Corner resize handles — content scales with the frame. */}
          {(["nw", "ne", "sw", "se"] as Handle[]).map((h) => (
            <div key={h} onPointerDown={(e) => beginPointer(e, fr.id, "resize", h)} style={handleStyle(h)} />
          ))}
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
