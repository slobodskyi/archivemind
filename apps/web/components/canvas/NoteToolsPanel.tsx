import { useEffect, useRef, useState } from "react";
import type { AssetLabel, LabelNames, NoteFontSize } from "@archivemind/shared";
import type { LineStyle } from "@/lib/notes";
import { LABEL_COLORS } from "@/lib/labels";
import LabelSwatchRow from "@/components/labels/LabelSwatchRow";
import {
  BoldIcon,
  BulletListIcon,
  EraserToolIcon,
  InkToolIcon,
  NumberedListIcon,
  StrikethroughIcon,
  TitleIcon,
  TypeIcon,
} from "@/components/icons/icons";

export type NoteMode = "text" | "draw";

const FONT_LABEL: Record<NoteFontSize, string> = { s: "small", m: "medium", l: "large" };
/** The glyph in the button samples the size it sets, within what a 34px slot holds. */
const FONT_GLYPH: Record<NoteFontSize, number> = { s: 10, m: 13, l: 16 };

interface NoteToolsPanelProps {
  /** The note's paper colour. */
  color: AssetLabel;
  labelNames: LabelNames;
  onColorChange: (color: AssetLabel) => void;
  mode: NoteMode;
  onModeChange: (mode: NoteMode) => void;
  // Text formatting — operate on the note's textarea selection.
  onLineStyle: (style: LineStyle) => void;
  onInlineMark: (marker: "**" | "~~") => void;
  /** Body text size — three steps, the middle one the 12.5px a note always was.
   *  A whole-note property (it is `style.fontSize`, not a mark in the body), so
   *  it cycles on one button instead of joining the per-line marks above. */
  fontSize: NoteFontSize;
  onCycleFontSize: () => void;
  // Drawing.
  drawColor: AssetLabel;
  onDrawColorChange: (color: AssetLabel) => void;
  thickness: number;
  onCycleThickness: () => void;
  eraser: boolean;
  onToggleEraser: () => void;
}

/** The sticky note's tools, pinned to its left edge (ADR 0041 — drawing folded
 *  onto the note). One vertical strip: paper colour, a type/pencil mode toggle,
 *  then the tools for the active mode — text formatting in type mode, pen colour
 *  / nib / eraser in pencil mode. The app's dark menu chrome, not printed on the
 *  paper, so it never eats the note. */
export default function NoteToolsPanel({
  color,
  labelNames,
  onColorChange,
  mode,
  onModeChange,
  onLineStyle,
  onInlineMark,
  fontSize,
  onCycleFontSize,
  drawColor,
  onDrawColorChange,
  thickness,
  onCycleThickness,
  eraser,
  onToggleEraser,
}: NoteToolsPanelProps) {
  // Which swatch flyout is open, if any. Closes on pick or outside press.
  const [picker, setPicker] = useState<"note" | "draw" | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!picker) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setPicker(null);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [picker]);

  return (
    <div
      ref={ref}
      // Same marker the old popover used, so the canvas's own dismiss/long-press
      // guards treat a press in here as operating the note, not leaving it.
      data-note-options=""
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        right: "100%",
        top: 0,
        marginRight: 6,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        padding: "4px 3px",
        background: "rgba(18,18,18,.97)",
        border: "1px solid var(--bd)",
        borderRadius: 2,
        backdropFilter: "blur(20px)",
        boxShadow: "0 20px 60px rgba(0,0,0,.7)",
        zIndex: 17,
      }}
    >
      {/* Paper colour */}
      <div style={{ position: "relative" }}>
        <PanelButton label="Note colour" onClick={() => setPicker((p) => (p === "note" ? null : "note"))} active={picker === "note"}>
          <Dot color={LABEL_COLORS[color]} ring />
        </PanelButton>
        {picker === "note" && (
          <Flyout>
            <LabelSwatchRow
              names={labelNames}
              current={color}
              clearable={false}
              size={14}
              onPick={(picked) => {
                if (picked) onColorChange(picked);
                setPicker(null);
              }}
            />
          </Flyout>
        )}
      </div>

      <Divider />

      {/* Mode toggle */}
      <PanelButton label="Type" onClick={() => onModeChange("text")} active={mode === "text"}>
        <TypeIcon width={15} height={15} />
      </PanelButton>
      <PanelButton label="Draw" onClick={() => onModeChange("draw")} active={mode === "draw"}>
        <InkToolIcon width={15} height={15} />
      </PanelButton>

      <Divider />

      {mode === "text" ? (
        <>
          <PanelButton label="Regular" onClick={() => onLineStyle("regular")}>
            <span style={{ fontSize: 12, fontWeight: 400, lineHeight: 1 }}>Aa</span>
          </PanelButton>
          <PanelButton label="Bold" onClick={() => onInlineMark("**")}>
            <BoldIcon width={14} height={14} />
          </PanelButton>
          <PanelButton label="Title" onClick={() => onLineStyle("title")}>
            <TitleIcon width={15} height={15} />
          </PanelButton>
          <PanelButton label="Strikethrough" onClick={() => onInlineMark("~~")}>
            <StrikethroughIcon width={15} height={15} />
          </PanelButton>
          <PanelButton label="Bullet list" onClick={() => onLineStyle("bullet")}>
            <BulletListIcon width={15} height={15} />
          </PanelButton>
          <PanelButton label="Numbered list" onClick={() => onLineStyle("numbered")}>
            <NumberedListIcon width={15} height={15} />
          </PanelButton>
          <PanelButton label={`Text size — ${FONT_LABEL[fontSize]}`} onClick={onCycleFontSize}>
            <span style={{ fontSize: FONT_GLYPH[fontSize], fontWeight: 400, lineHeight: 1 }}>A</span>
          </PanelButton>
        </>
      ) : (
        <>
          <div style={{ position: "relative" }}>
            <PanelButton label="Pen colour" onClick={() => setPicker((p) => (p === "draw" ? null : "draw"))} active={picker === "draw"}>
              <Dot color={LABEL_COLORS[drawColor]} ring />
            </PanelButton>
            {picker === "draw" && (
              <Flyout>
                <LabelSwatchRow
                  names={labelNames}
                  current={drawColor}
                  clearable={false}
                  size={14}
                  onPick={(picked) => {
                    if (picked) onDrawColorChange(picked);
                    setPicker(null);
                  }}
                />
              </Flyout>
            )}
          </div>
          <PanelButton label="Nib thickness" onClick={onCycleThickness}>
            <Dot color="var(--t1)" size={Math.max(5, Math.min(15, thickness * 0.5))} />
          </PanelButton>
          <PanelButton label="Eraser" onClick={onToggleEraser} active={eraser}>
            <EraserToolIcon width={15} height={15} />
          </PanelButton>
        </>
      )}
    </div>
  );
}

function PanelButton({
  label,
  onClick,
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Keep the note's textarea focused and its selection intact: a plain button
      // press blurs the textarea, so by the time a formatting handler reads the
      // caret it has collapsed (and line styles would hit the wrong line). The
      // click still fires — only the focus steal is cancelled.
      onMouseDown={(e) => e.preventDefault()}
      title={label}
      aria-label={label}
      aria-pressed={active}
      style={{
        display: "flex",
        width: 26,
        height: 24,
        alignItems: "center",
        justifyContent: "center",
        border: 0,
        borderRadius: 2,
        background: active ? "var(--bd)" : "transparent",
        color: active ? "var(--t1)" : "var(--t2)",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span style={{ width: 16, height: 1, background: "var(--bd)", margin: "1px 0" }} />;
}

function Dot({ color, size = 11, ring = false }: { color: string; size?: number; ring?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: "0 0 auto",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        border: ring ? "1px solid rgba(255,255,255,.35)" : "none",
      }}
    />
  );
}

/** The swatch picker, opening to the LEFT of the strip (which itself sits left of
 *  the note), so it never covers the note it configures. */
function Flyout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        right: "100%",
        top: 0,
        marginRight: 6,
        background: "rgba(18,18,18,.97)",
        border: "1px solid var(--bd)",
        borderRadius: 2,
        backdropFilter: "blur(20px)",
        boxShadow: "0 20px 60px rgba(0,0,0,.7)",
      }}
    >
      {children}
    </div>
  );
}
