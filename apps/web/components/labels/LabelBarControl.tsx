import type { AssetLabel, LabelNames } from "@archivemind/shared";
import type { LabelFilter } from "@/lib/labels";
import LabelSwatchRow from "@/components/labels/LabelSwatchRow";
import { LabelsIcon } from "@/components/icons/icons";

interface LabelBarControlProps {
  names: LabelNames;
  open: boolean;
  onToggle: () => void;
  /** How many files the bar's actions would act on. Zero flips the control from
   *  "mark these" to "show only those". */
  selCount: number;
  /** The colour the selection carries, or `"mixed"` — drives the ring in mark mode. */
  selectionLabel: AssetLabel | "mixed" | null;
  filter: LabelFilter;
  onPickLabel: (label: AssetLabel | null) => void;
  onSetFilter: (filter: LabelFilter) => void;
  /** Closes the popup. Separate from `onToggle` on purpose: in mark mode
   *  picking already closes the menu, so a toggle fired after it would reopen
   *  the thing the click was meant to dismiss. */
  onCloseMenu: () => void;
}

/** The colour-label control that lives on both bottom bars (ADR 0040, amended).
 *
 *  **Context-sensitive, because the two jobs never overlap.** With files
 *  selected the swatch row MARKS them, which is what it always did. With
 *  nothing selected it FILTERS the canvas to one colour — and an empty
 *  selection is exactly when "mark the selection" has nothing to do, so the
 *  slot is free. This is what replaced the left rail's `LabelFilterPanel`:
 *  marking already lived on the bar, and having the filter on the rail meant
 *  the one axis was operated from two opposite edges of the screen.
 *
 *  In filter mode the row also offers the untriaged pile (`"none"`) beside the
 *  ✕ that clears the filter — see `LabelSwatchRow`'s `none` for why the two are
 *  not the same button. That ✕ also CLOSES the popup, and needs `onCloseMenu`
 *  to do it: filtering does not close the menu the way marking does, so the row
 *  had nothing to borrow and the ✕ cleared the filter while leaving the popup
 *  open. */
export default function LabelBarControl({
  names,
  open,
  onToggle,
  selCount,
  selectionLabel,
  filter,
  onPickLabel,
  onSetFilter,
  onCloseMenu,
}: LabelBarControlProps) {
  const filtering = selCount === 0;
  // `"none"` is a filter state with no swatch to ring — the dedicated hollow
  // ring carries it instead, so the colour row shows nothing selected.
  const filterColour: AssetLabel | "mixed" | null = filter === "none" ? null : filter;

  const label = filtering
    ? filter !== null
      ? "Filter by colour — on"
      : "Filter by colour"
    : selCount >= 2
      ? `Label ${selCount} files`
      : "Label";

  return (
    // Deliberately NOT `position: relative`: the popup below is absolutely
    // positioned, so leaving this wrapper static makes it resolve against the
    // BAR instead of this 34px button — which is what centres the row over the
    // bar rather than hanging it off the button's left edge.
    <div style={{ display: "flex" }}>
      {open && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: "100%",
            marginBottom: 8,
            transform: "translateX(-50%)",
            padding: "4px 6px",
            background: "rgba(20,20,20,.96)",
            border: "1px solid var(--bd)",
            borderRadius: 2,
            backdropFilter: "blur(16px)",
            boxShadow: "0 8px 32px rgba(0,0,0,.45)",
          }}
        >
          <LabelSwatchRow
            names={names}
            current={filtering ? filterColour : selectionLabel}
            onPick={filtering ? (label) => onSetFilter(label) : onPickLabel}
            none={
              filtering
                ? { active: filter === "none", onPick: () => onSetFilter(filter === "none" ? null : "none") }
                : undefined
            }
            onDismiss={onCloseMenu}
            size={18}
          />
        </div>
      )}
      <button
        onClick={onToggle}
        className="am-tb tw-top"
        title={label}
        aria-label={filtering ? "Filter by colour" : "Label the selection"}
        aria-pressed={open}
        style={{
          display: "flex",
          width: 34,
          height: 34,
          alignItems: "center",
          justifyContent: "center",
          border: 0,
          borderRadius: 2,
          cursor: "pointer",
          background: "transparent",
          // Lit while a filter is on even with the row closed, so a canvas that
          // is hiding files can never look like an empty one.
          color: open || (filtering && filter !== null) ? "var(--ac)" : "var(--t2)",
        }}
      >
        <LabelsIcon width={16} height={16} />
        {/* Name-on-hover, matching the other bottom-bar buttons' styled hint. */}
        <span className="tip">{label}</span>
      </button>
    </div>
  );
}
