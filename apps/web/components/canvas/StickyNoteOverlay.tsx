import type { StickyNote } from "@/lib/layout";
import { noteSurface } from "@/lib/labels";
import { CloseIcon } from "@/components/icons/icons";

/** The three steps of `NoteStyle.fontSize`. Sizes, not a scale factor, so the
 *  middle one stays exactly the 12.5px this note has always been. */
const FONT_SIZES = { s: 11, m: 12.5, l: 15 } as const;

interface StickyNoteOverlayProps {
  notes: StickyNote[];
  onDragStart: (e: React.PointerEvent, id: string, orig: { x: number; y: number }) => void;
  onTextChange: (id: string, text: string) => void;
  onDelete: (id: string) => void;
}

export default function StickyNoteOverlay({ notes, onDragStart, onTextChange, onDelete }: StickyNoteOverlayProps) {
  return (
    <>
      {notes.map((note) => (
        <div
          key={note.id}
          style={{
            position: "absolute",
            left: note.x,
            top: note.y,
            width: note.w,
            height: note.h,
            background: noteSurface(note.color),
            borderRadius: 2,
            boxShadow: "0 10px 28px rgba(0,0,0,.35)",
            display: "flex",
            flexDirection: "column",
            zIndex: 15,
          }}
        >
          <div
            onPointerDown={(e) => onDragStart(e, note.id, { x: note.x, y: note.y })}
            style={{
              height: 18,
              flex: "0 0 auto",
              cursor: "grab",
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              padding: "0 3px",
            }}
          >
            <button
              onClick={() => onDelete(note.id)}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Delete note"
              style={{
                display: "flex",
                width: 16,
                height: 16,
                alignItems: "center",
                justifyContent: "center",
                border: 0,
                borderRadius: 2,
                background: "transparent",
                color: "rgba(0,0,0,.5)",
                cursor: "pointer",
              }}
            >
              <CloseIcon width={10} height={10} strokeWidth={2.2} />
            </button>
          </div>
          <textarea
            className="am-sticky-note"
            value={note.text}
            placeholder="Type a note…"
            onChange={(e) => onTextChange(note.id, e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              flex: 1,
              resize: "none",
              border: 0,
              outline: "none",
              background: "transparent",
              color: "rgba(0,0,0,.78)",
              fontFamily: "inherit",
              fontSize: FONT_SIZES[note.fontSize],
              lineHeight: 1.4,
              padding: "0 10px 10px",
              // Re-enable text selection: the canvas surface sets user-select:none,
              // and a note body must stay selectable/editable underneath it.
              userSelect: "text",
              WebkitUserSelect: "text",
              // Same for touch — the canvas sets touch-action:none for its own
              // gestures, which would otherwise take scrolling and caret
              // placement away from a note long enough to overflow.
              touchAction: "auto",
            }}
          />
        </div>
      ))}
    </>
  );
}
