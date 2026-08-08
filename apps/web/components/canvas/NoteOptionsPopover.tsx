import type { AssetLabel, LabelNames, NoteFontSize } from "@archivemind/shared";
import LabelSwatchRow from "@/components/labels/LabelSwatchRow";

interface NoteOptionsPopoverProps {
  color: AssetLabel;
  fontSize: NoteFontSize;
  /** The workspace's seven colour names — a note's swatch row shows the same
   *  words the label swatch row does, because it is the same vocabulary. */
  labelNames: LabelNames;
  /** Distance from the card's top edge; the note's header height. */
  top: number;
  onColorChange: (color: AssetLabel) => void;
  onFontSizeChange: (fontSize: NoteFontSize) => void;
}

const FONT_STEPS: { key: NoteFontSize; label: string }[] = [
  { key: "s", label: "S" },
  { key: "m", label: "M" },
  { key: "l", label: "L" },
];

/** A sticky note's colour + size controls (ADR 0041), in the app's own dark menu
 *  chrome rather than printed on the paper: seven swatches and three steps on a
 *  180px card would leave no room for the note. */
export default function NoteOptionsPopover({
  color,
  fontSize,
  labelNames,
  top,
  onColorChange,
  onFontSizeChange,
}: NoteOptionsPopoverProps) {
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: 2,
        top,
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 5px",
        background: "rgba(18,18,18,.97)",
        border: "1px solid var(--bd)",
        borderRadius: 2,
        backdropFilter: "blur(20px)",
        boxShadow: "0 20px 60px rgba(0,0,0,.7)",
        zIndex: 16,
      }}
    >
      <LabelSwatchRow
        names={labelNames}
        current={color}
        // A note always has a colour — there is no unset state to offer, and
        // clicking the current swatch is inert rather than a way to end up with
        // a colourless note.
        clearable={false}
        onPick={(picked) => picked && onColorChange(picked)}
        size={14}
      />
      <span style={{ width: 1, height: 12, background: "var(--bd)" }} />
      {FONT_STEPS.map((step) => (
        <button
          key={step.key}
          type="button"
          onClick={() => onFontSizeChange(step.key)}
          aria-pressed={fontSize === step.key}
          title={`Font size ${step.label}`}
          style={{
            width: 18,
            height: 16,
            padding: 0,
            border: 0,
            borderRadius: 2,
            background: fontSize === step.key ? "var(--bd)" : "transparent",
            color: fontSize === step.key ? "var(--t1)" : "var(--t2)",
            fontSize: 10,
            cursor: "pointer",
          }}
        >
          {step.label}
        </button>
      ))}
    </div>
  );
}
