import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AssetLabel, LabelNames, NoteFontSize } from "@archivemind/shared";
import type { StickyNote } from "@/lib/layout";
import { LABEL_COLORS, noteSurface } from "@/lib/labels";
import { parseNoteLines } from "@/lib/notes";
import NoteOptionsPopover from "@/components/canvas/NoteOptionsPopover";
import { CloseIcon } from "@/components/icons/icons";

interface StickyNoteOverlayProps {
  notes: StickyNote[];
  /** The workspace's seven colour names — a note's swatch row shows the same
   *  words the label swatch row does, because it is the same vocabulary. */
  labelNames: LabelNames;
  onDragStart: (e: React.PointerEvent, id: string, orig: { x: number; y: number }) => void;
  onResizeStart: (e: React.PointerEvent, id: string, orig: { w: number; h: number }) => void;
  onTextChange: (id: string, text: string) => void;
  onColorChange: (id: string, color: AssetLabel) => void;
  onFontSizeChange: (id: string, fontSize: NoteFontSize) => void;
  onToggleCheck: (id: string, lineIndex: number) => void;
  onDelete: (id: string) => void;
}

/** The three steps of `NoteStyle.fontSize`. Sizes, not a scale factor, so the
 *  middle one stays exactly the 12.5px this note has always been. */
const FONT_SIZES: Record<NoteFontSize, number> = { s: 11, m: 12.5, l: 15 };
const HEADER_H = 18;
const INK = "rgba(0,0,0,.78)";

export default function StickyNoteOverlay({
  notes,
  labelNames,
  onDragStart,
  onResizeStart,
  onTextChange,
  onColorChange,
  onFontSizeChange,
  onToggleCheck,
  onDelete,
}: StickyNoteOverlayProps) {
  // Which note is in text-edit mode, and which has its options open. Pure UI —
  // never workspace state, so neither survives a reload or reaches the server.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!menuId) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      setMenuId(null);
    };
    // Capture, and on pointerdown rather than click: the canvas starts drags on
    // pointerdown, so waiting for a click would leave the popover open through
    // a pan that began underneath it.
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
    };
  }, [menuId]);

  return (
    <>
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          labelNames={labelNames}
          editing={editingId === note.id}
          menuOpen={menuId === note.id}
          onEdit={() => setEditingId(note.id)}
          onStopEdit={() => setEditingId((cur) => (cur === note.id ? null : cur))}
          onToggleMenu={() => setMenuId((cur) => (cur === note.id ? null : note.id))}
          onDragStart={onDragStart}
          onResizeStart={onResizeStart}
          onTextChange={onTextChange}
          onColorChange={onColorChange}
          onFontSizeChange={onFontSizeChange}
          onToggleCheck={onToggleCheck}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

interface NoteCardProps extends Omit<StickyNoteOverlayProps, "notes"> {
  note: StickyNote;
  editing: boolean;
  menuOpen: boolean;
  onEdit: () => void;
  onStopEdit: () => void;
  onToggleMenu: () => void;
}

function NoteCard({
  note,
  labelNames,
  editing,
  menuOpen,
  onEdit,
  onStopEdit,
  onToggleMenu,
  onDragStart,
  onResizeStart,
  onTextChange,
  onColorChange,
  onFontSizeChange,
  onToggleCheck,
  onDelete,
}: NoteCardProps) {
  const [hovered, setHovered] = useState(false);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const fontSize = FONT_SIZES[note.fontSize];

  // Entering edit mode has to land the caret somewhere, and the click that got
  // us here landed on a div that no longer exists. End of text is the honest
  // choice for a note you are about to add a line to.
  useLayoutEffect(() => {
    if (!editing) return;
    const el = textarea.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  return (
    <div
      // Marks the whole card for the canvas's long-press guard: the rendered
      // body is a plain div, so without this a hold on a note opens the canvas
      // context menu on top of it (see useWorkspace's touch handler).
      data-note-surface=""
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
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
          height: HEADER_H,
          flex: "0 0 auto",
          cursor: "grab",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0 3px",
        }}
      >
        <HeaderButton
          onClick={onToggleMenu}
          label="Note options"
          active={menuOpen}
          // A filled dot in the note's own colour: the control and the thing it
          // changes are the same object, so there is nothing to read.
          //
          // LABEL_COLORS, not noteSurface: the paper tone IS the note's
          // background, so a dot painted in it is an invisible dot with a
          // hairline around it. The dot wants the full-strength swatch — the
          // same one the picker shows — for the same reason the picker does.
          glyph={
            <span
              aria-hidden="true"
              style={{
                // Without this the flex parent shrinks it to a 4px slit; the
                // width below is a wish, not a floor, on a flex item.
                flex: "0 0 auto",
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: LABEL_COLORS[note.color],
                border: "1px solid rgba(0,0,0,.45)",
              }}
            />
          }
        />
        <HeaderButton
          onClick={() => onDelete(note.id)}
          label="Delete note"
          glyph={<CloseIcon width={10} height={10} strokeWidth={2.2} />}
        />
      </div>

      {menuOpen && (
        <NoteOptionsPopover
          color={note.color}
          fontSize={note.fontSize}
          labelNames={labelNames}
          top={HEADER_H + 2}
          onColorChange={(color) => onColorChange(note.id, color)}
          onFontSizeChange={(size) => onFontSizeChange(note.id, size)}
        />
      )}

      {editing ? (
        <textarea
          ref={textarea}
          className="am-sticky-note"
          value={note.text}
          placeholder="Type a note…"
          onChange={(e) => onTextChange(note.id, e.target.value)}
          onBlur={onStopEdit}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            resize: "none",
            border: 0,
            outline: "none",
            background: "transparent",
            color: INK,
            fontFamily: "inherit",
            fontSize,
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
      ) : (
        <NoteBody note={note} fontSize={fontSize} onEdit={onEdit} onToggleCheck={onToggleCheck} />
      )}

      <button
        type="button"
        aria-label="Resize note"
        onPointerDown={(e) => onResizeStart(e, note.id, { w: note.w, h: note.h })}
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          width: 16,
          height: 16,
          padding: 0,
          border: 0,
          background: "transparent",
          cursor: "nwse-resize",
          // Hidden until the pointer is on the note: a permanent grip on every
          // note turns a wall of them into a wall of chrome.
          opacity: hovered ? 0.55 : 0,
          transition: "opacity .12s",
        }}
      >
        <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="rgba(0,0,0,.8)" strokeWidth={1.4} strokeLinecap="round">
          <path d="M15 7 7 15M15 12l-3 3" />
        </svg>
      </button>
    </div>
  );
}

/** The body as it reads when nobody is typing in it: `[ ]` lines become real
 *  checkboxes, everything else is text. Clicking the text opens the editor —
 *  clicking a box does not, because ticking something off is not editing it. */
function NoteBody({
  note,
  fontSize,
  onEdit,
  onToggleCheck,
}: {
  note: StickyNote;
  fontSize: number;
  onEdit: () => void;
  onToggleCheck: (id: string, lineIndex: number) => void;
}) {
  const lines = parseNoteLines(note.text);

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onEdit}
      style={{
        flex: 1,
        overflowY: "auto",
        cursor: "text",
        color: INK,
        fontSize,
        lineHeight: 1.4,
        padding: "0 10px 10px",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        touchAction: "auto",
      }}
    >
      {note.text === "" ? (
        <span style={{ opacity: 0.4 }}>Type a note…</span>
      ) : (
        lines.map((line) =>
          line.checked === null ? (
            <div key={line.index}>{line.text === "" ? " " : line.text}</div>
          ) : (
            <div key={line.index} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <button
                type="button"
                role="checkbox"
                aria-checked={line.checked}
                aria-label={line.text || "Checklist item"}
                onClick={(e) => {
                  // Without this the card's own onClick would also fire and drop
                  // the user into the editor every time they tick something.
                  e.stopPropagation();
                  onToggleCheck(note.id, line.index);
                }}
                style={{
                  flex: "0 0 auto",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: fontSize,
                  height: fontSize,
                  marginTop: 1,
                  padding: 0,
                  border: `1.4px solid rgba(0,0,0,${line.checked ? 0.75 : 0.45})`,
                  borderRadius: 2,
                  background: line.checked ? "rgba(0,0,0,.75)" : "transparent",
                  cursor: "pointer",
                }}
              >
                {line.checked && (
                  <svg width={fontSize - 4} height={fontSize - 4} viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 8.5 6.5 12 13 4.5" />
                  </svg>
                )}
              </button>
              <span style={{ opacity: line.checked ? 0.5 : 1, textDecoration: line.checked ? "line-through" : "none" }}>
                {line.text}
              </span>
            </div>
          ),
        )
      )}
    </div>
  );
}

function HeaderButton({
  onClick,
  label,
  glyph,
  active = false,
}: {
  onClick: () => void;
  label: string;
  glyph: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // The header is the drag handle; a press on its buttons must not start one.
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={label}
      title={label}
      style={{
        display: "flex",
        width: 16,
        height: 16,
        alignItems: "center",
        justifyContent: "center",
        border: 0,
        borderRadius: 2,
        background: active ? "rgba(0,0,0,.12)" : "transparent",
        color: "rgba(0,0,0,.5)",
        cursor: "pointer",
      }}
    >
      {glyph}
    </button>
  );
}
