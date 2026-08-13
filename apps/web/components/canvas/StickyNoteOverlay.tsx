import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AssetLabel, LabelNames, NoteFontSize, NoteStroke } from "@archivemind/shared";
import type { StickyNote } from "@/lib/layout";
import { noteSurface } from "@/lib/labels";
import {
  parseInline,
  parseNoteLines,
  toggleInlineMark,
  toggleLineStyle,
  type LineStyle,
  type NoteLine,
} from "@/lib/notes";
import NoteToolsPanel, { type NoteMode } from "@/components/canvas/NoteToolsPanel";
import NoteInkLayer from "@/components/canvas/NoteInkLayer";
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
  onSetStrokes: (id: string, strokes: NoteStroke[]) => void;
  onDelete: (id: string) => void;
}

/** The three steps of `NoteStyle.fontSize`. Sizes, not a scale factor, so the
 *  middle one stays exactly the 12.5px this note has always been. */
const FONT_SIZES: Record<NoteFontSize, number> = { s: 11, m: 12.5, l: 15 };
/** Cycle order for the panel's one text-size button. Three steps is few enough
 *  that cycling beats a picker, and it wraps so there is no dead end at either
 *  extreme. */
const FONT_STEPS: readonly NoteFontSize[] = ["s", "m", "l"];
const HEADER_H = 18;
const INK = "rgba(0,0,0,.78)";
/** Nib steps in the ink layer's 0..1000 virtual units (see NoteInkLayer). */
const THICKNESS = [8, 16, 30];

export default function StickyNoteOverlay({
  notes,
  labelNames,
  onDragStart,
  onResizeStart,
  onTextChange,
  onColorChange,
  onFontSizeChange,
  onToggleCheck,
  onSetStrokes,
  onDelete,
}: StickyNoteOverlayProps) {
  // Which note is active (its tools panel is showing). Pure UI — never workspace
  // state, so it neither survives a reload nor reaches the server. Draw settings
  // (colour, nib, eraser) are a chosen pen and stay put as you move between
  // notes; the mode resets to text each time a note is picked up.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<NoteMode>("text");
  const [drawColor, setDrawColor] = useState<AssetLabel>("gray");
  const [thicknessIdx, setThicknessIdx] = useState(1);
  const [eraser, setEraser] = useState(false);

  const activate = (id: string) => {
    setActiveId((cur) => {
      if (cur !== id) {
        setMode("text");
        setEraser(false);
      }
      return id;
    });
  };

  // A press anywhere outside every note deactivates. Capture phase, pointerdown:
  // the canvas starts pans/marquees on pointerdown, so waiting for click would
  // leave the panel up through a pan that began on empty canvas.
  useEffect(() => {
    if (!activeId) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setActiveId(null);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-note-surface]") || target?.closest("[data-note-options]")) return;
      setActiveId(null);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
    };
  }, [activeId]);

  return (
    <>
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          labelNames={labelNames}
          active={activeId === note.id}
          mode={mode}
          drawColor={drawColor}
          thickness={THICKNESS[thicknessIdx]}
          eraser={eraser}
          onActivate={() => activate(note.id)}
          onModeChange={(m) => {
            setMode(m);
            if (m === "text") setEraser(false);
          }}
          onDrawColorChange={setDrawColor}
          onCycleThickness={() => setThicknessIdx((i) => (i + 1) % THICKNESS.length)}
          onToggleEraser={() => setEraser((v) => !v)}
          onDragStart={onDragStart}
          onResizeStart={onResizeStart}
          onTextChange={onTextChange}
          onColorChange={onColorChange}
          onFontSizeChange={onFontSizeChange}
          onToggleCheck={onToggleCheck}
          onSetStrokes={onSetStrokes}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

interface NoteCardProps extends Omit<StickyNoteOverlayProps, "notes"> {
  note: StickyNote;
  active: boolean;
  mode: NoteMode;
  drawColor: AssetLabel;
  thickness: number;
  eraser: boolean;
  onActivate: () => void;
  onModeChange: (mode: NoteMode) => void;
  onDrawColorChange: (color: AssetLabel) => void;
  onCycleThickness: () => void;
  onToggleEraser: () => void;
}

function NoteCard({
  note,
  labelNames,
  active,
  mode,
  drawColor,
  thickness,
  eraser,
  onActivate,
  onModeChange,
  onDrawColorChange,
  onCycleThickness,
  onToggleEraser,
  onDragStart,
  onResizeStart,
  onTextChange,
  onColorChange,
  onFontSizeChange,
  onToggleCheck,
  onSetStrokes,
  onDelete,
}: NoteCardProps) {
  const [hovered, setHovered] = useState(false);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const fontSize = FONT_SIZES[note.fontSize];
  const editing = active && mode === "text";
  // Restore a selection after a formatting edit reflows the controlled value.
  const pendingSel = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    if (!editing) return;
    const el = textarea.current;
    if (!el) return;
    if (pendingSel.current) {
      // Refocus as well: a formatting button that slipped the focus guard would
      // otherwise leave the restored selection invisible and the next keystroke
      // landing nowhere.
      el.focus();
      el.setSelectionRange(pendingSel.current.start, pendingSel.current.end);
      pendingSel.current = null;
      return;
    }
  });

  // Focus the textarea when text mode is (re)entered; land the caret at the end.
  useLayoutEffect(() => {
    if (!editing) return;
    const el = textarea.current;
    if (!el) return;
    el.focus();
    if (document.activeElement !== el) return;
    if (el.selectionStart === el.selectionEnd && el.selectionStart === 0) {
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const applyLineStyle = (style: LineStyle) => {
    const el = textarea.current;
    if (!el) return;
    const r = toggleLineStyle(el.value, el.selectionStart, el.selectionEnd, style);
    pendingSel.current = { start: r.selStart, end: r.selEnd };
    onTextChange(note.id, r.text);
  };
  const applyInline = (marker: "**" | "~~") => {
    const el = textarea.current;
    if (!el) return;
    const r = toggleInlineMark(el.value, el.selectionStart, el.selectionEnd, marker);
    pendingSel.current = { start: r.selStart, end: r.selEnd };
    onTextChange(note.id, r.text);
  };

  return (
    <div
      // Marks the whole card for the canvas's long-press guard and the overlay's
      // outside-press deactivator: the rendered body is a plain div, so without
      // this a hold on a note opens the canvas context menu on top of it.
      data-note-surface=""
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDownCapture={onActivate}
      style={{
        position: "absolute",
        left: note.x,
        top: note.y,
        width: note.w,
        height: note.h,
        background: noteSurface(note.color),
        borderRadius: 2,
        boxShadow: active ? "0 12px 34px rgba(0,0,0,.45)" : "0 10px 28px rgba(0,0,0,.35)",
        outline: active ? "1px solid rgba(0,0,0,.25)" : "none",
        display: "flex",
        flexDirection: "column",
        zIndex: active ? 16 : 15,
      }}
    >
      <div
        onPointerDown={(e) => onDragStart(e, note.id, { x: note.x, y: note.y })}
        style={{
          height: HEADER_H,
          flex: "0 0 auto",
          cursor: "grab",
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          padding: "0 3px",
        }}
      >
        <HeaderButton
          onClick={() => onDelete(note.id)}
          label="Delete note"
          glyph={<CloseIcon width={10} height={10} strokeWidth={2.2} />}
        />
      </div>

      {active && (
        <NoteToolsPanel
          color={note.color}
          labelNames={labelNames}
          onColorChange={(c) => onColorChange(note.id, c)}
          mode={mode}
          onModeChange={onModeChange}
          onLineStyle={applyLineStyle}
          onInlineMark={applyInline}
          fontSize={note.fontSize}
          onCycleFontSize={() =>
            onFontSizeChange(note.id, FONT_STEPS[(FONT_STEPS.indexOf(note.fontSize) + 1) % FONT_STEPS.length])
          }
          drawColor={drawColor}
          onDrawColorChange={onDrawColorChange}
          thickness={thickness}
          onCycleThickness={onCycleThickness}
          eraser={eraser}
          onToggleEraser={onToggleEraser}
        />
      )}

      {/* Body: the text (editable in text mode, rendered otherwise) with the ink
          layer stacked over it. The ink captures pointers only in draw mode, so
          text stays clickable underneath it the rest of the time. */}
      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {editing ? (
          <textarea
            ref={textarea}
            className="am-sticky-note"
            value={note.text}
            // No hint over a drawing: the note is already saying something, and
            // the placeholder would print itself across the middle of it.
            placeholder={note.strokes.length > 0 ? undefined : "Type a note…"}
            onChange={(e) => onTextChange(note.id, e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              resize: "none",
              border: 0,
              outline: "none",
              background: "transparent",
              color: INK,
              fontFamily: "inherit",
              fontSize,
              lineHeight: 1.4,
              padding: "0 10px 10px",
              userSelect: "text",
              WebkitUserSelect: "text",
              touchAction: "auto",
            }}
          />
        ) : (
          <NoteBody
            note={note}
            fontSize={fontSize}
            // In pencil mode the body is just a backdrop for the drawing — the
            // "Type a note…" hint would sit under the pen, so it's suppressed.
            // Once there ARE strokes it stays suppressed in every mode: an empty
            // `text` no longer means an empty note, and "Type a note…" printed
            // through a drawing reads as a rendering fault.
            showPlaceholder={!(active && mode === "draw") && note.strokes.length === 0}
            onEdit={onActivate}
            onToggleCheck={onToggleCheck}
          />
        )}
        <NoteInkLayer
          strokes={note.strokes}
          active={active && mode === "draw"}
          eraser={eraser}
          color={drawColor}
          size={thickness}
          onCommit={(strokes) => onSetStrokes(note.id, strokes)}
        />
      </div>

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
          opacity: hovered ? 0.55 : 0,
          transition: "opacity .12s",
          zIndex: 2,
        }}
      >
        <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="rgba(0,0,0,.8)" strokeWidth={1.4} strokeLinecap="round">
          <path d="M15 7 7 15M15 12l-3 3" />
        </svg>
      </button>
    </div>
  );
}

/** The body as it reads when the note is not being edited: line marks become
 *  real structure (checkboxes, titles, bullets, numbers) and bold/strike render
 *  inline. Clicking the text activates the note (and enters edit mode) —
 *  clicking a checkbox does not, because ticking something off is not editing. */
function NoteBody({
  note,
  fontSize,
  showPlaceholder,
  onEdit,
  onToggleCheck,
}: {
  note: StickyNote;
  fontSize: number;
  showPlaceholder: boolean;
  onEdit: () => void;
  onToggleCheck: (id: string, lineIndex: number) => void;
}) {
  const lines = parseNoteLines(note.text);

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onEdit}
      style={{
        position: "absolute",
        inset: 0,
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
        showPlaceholder ? <span style={{ opacity: 0.4 }}>Type a note…</span> : null
      ) : (
        lines.map((line) => <BodyLine key={line.index} line={line} noteId={note.id} fontSize={fontSize} onToggleCheck={onToggleCheck} />)
      )}
    </div>
  );
}

function BodyLine({
  line,
  noteId,
  fontSize,
  onToggleCheck,
}: {
  line: NoteLine;
  noteId: string;
  fontSize: number;
  onToggleCheck: (id: string, lineIndex: number) => void;
}) {
  if (line.kind === "checklist") {
    const checked = line.checked === true;
    return (
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={line.text || "Checklist item"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCheck(noteId, line.index);
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
            border: `1.4px solid rgba(0,0,0,${checked ? 0.75 : 0.45})`,
            borderRadius: 2,
            background: checked ? "rgba(0,0,0,.75)" : "transparent",
            cursor: "pointer",
          }}
        >
          {checked && (
            <svg width={fontSize - 4} height={fontSize - 4} viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8.5 6.5 12 13 4.5" />
            </svg>
          )}
        </button>
        <span style={{ opacity: checked ? 0.5 : 1, textDecoration: checked ? "line-through" : undefined }}>
          <Inline text={line.text} />
        </span>
      </div>
    );
  }

  if (line.kind === "title") {
    return (
      <div style={{ fontSize: Math.round(fontSize * 1.5), fontWeight: 700, lineHeight: 1.25, margin: "2px 0" }}>
        <Inline text={line.text} />
      </div>
    );
  }

  if (line.kind === "bullet" || line.kind === "numbered") {
    const marker = line.kind === "bullet" ? "•" : `${line.ordinal}.`;
    return (
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ flex: "0 0 auto", opacity: 0.7, minWidth: line.kind === "numbered" ? 14 : undefined }}>{marker}</span>
        <span>
          <Inline text={line.text} />
        </span>
      </div>
    );
  }

  return (
    <div>{line.text === "" ? " " : <Inline text={line.text} />}</div>
  );
}

/** Bold + strikethrough spans within one line. */
function Inline({ text }: { text: string }) {
  const spans = parseInline(text);
  return (
    <>
      {spans.map((span, i) => (
        <span
          key={i}
          style={{
            fontWeight: span.bold ? 700 : undefined,
            textDecoration: span.strike ? "line-through" : undefined,
          }}
        >
          {span.text}
        </span>
      ))}
    </>
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
