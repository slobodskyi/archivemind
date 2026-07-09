import type { StickyNote } from "@/lib/layout";
import { CloseIcon } from "@/components/icons/icons";

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
            background: note.color,
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
              fontSize: 12.5,
              lineHeight: 1.4,
              padding: "0 10px 10px",
            }}
          />
        </div>
      ))}
    </>
  );
}
