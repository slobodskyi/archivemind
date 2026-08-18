"use client";

import { memo } from "react";
import type { AssetLabel, LabelNames } from "@archivemind/shared";
import type { LabelFilter } from "@/lib/labels";
import LabelBarControl from "@/components/labels/LabelBarControl";
import TopicMembershipMenu, {
  type TopicMembershipMenuProps,
} from "@/components/toolbar/TopicMembershipMenu";

/** Membership controls are optional so Timeline keeps its narrow bar. Topic
 * supplies this object once its persisted manual-assignment layer is available.
 * `selectionCount` comes from the bar's existing prop. */
export type SortingTopicMembershipProps = Omit<TopicMembershipMenuProps, "selectionCount">;

/** Bottom action bar for the SORTING views (Topic / Timeline / Map) and for the
 *  all-files grid — ADR 0038, extended by ADR 0040's amendment.
 *
 *  The Canvas has had `WorkspaceActionBar` since #3, but it is gated on
 *  `view === "neural"`, so Topic and Timeline shipped with no layout controls
 *  at all: once you dragged a tile there was no way back short of dragging it
 *  home. Widening that gate would have been wrong twice over — its Copy /
 *  Duplicate / Export / Group buttons act on a selection these views don't
 *  frame, and its "Tidy up" writes the `asset` bucket, so on Topic it would
 *  silently rearrange the Canvas instead.
 *
 *  Deliberately narrow: layout controls plus Topic's explicit membership menu,
 *  42 px tall at bottom:72 — it sits ABOVE `ViewSwitcher` (a 42px strip at
 *  bottom:20), and `BulkAiPanel` (bottom:124) clears both. The two strips share
 *  their padding, gap, radius and button size on purpose; they are one piece of
 *  bottom chrome in two rows. z-index 35 matches every other canvas bar — `lib/ui.ts`
 *  reserves 0–35 for canvas internals, and anything higher would paint over
 *  the chat and trash panels. */
export interface SortingActionBarProps {
  /** Topic gets Re-cluster; Timeline's day columns are not clustered. */
  showRecluster: boolean;
  /** Regroup acts on an override bucket, and Map has none (its positions come
   *  from EXIF, not from drags) — nor does the read-only all-files grid. */
  showRegroup: boolean;
  /** `ViewSwitcher` is on screen below this bar, so it sits one row up. False in
   *  all-files, where there is no switcher and the gap would just be dead space. */
  aboveSwitcher: boolean;
  /** There is something to regroup — no drag overrides means no-op. */
  canRegroup: boolean;
  /** A job is already in flight; the worker has one lane for all of them. */
  busy: boolean;
  /** ≥ 2 selected regroups only those, matching Tidy up's selection-first rule. */
  selCount: number;
  onRegroup: () => void;
  onRecluster: () => void;
  /** Explicit semantic grouping actions for Topic only. The canvas may call
   * the same mutations after an intentional dwell-and-drop target. */
  topicMembership?: SortingTopicMembershipProps;
  /** Colour-label control — marks the selection, or filters when there is none.
   *  Present on every view this bar appears on, including Map and all-files:
   *  the filter is a lens on the photo set, not on one arrangement of it. */
  labelNames: LabelNames;
  labelMenuOpen: boolean;
  selectionLabel: AssetLabel | "mixed" | null;
  labelFilter: LabelFilter;
  onToggleLabelMenu: () => void;
  onPickLabel: (label: AssetLabel | null) => void;
  onSetFilter: (filter: LabelFilter) => void;
}

const gp = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/* Snap back into place: four photo-tile-shaped cells snapping into an even
   grid — the same glyph the Workspace bar's "Tidy up" carries, because the two
   are the same gesture (drop the manual drags, let the tiles re-pack). */
const RegroupGlyph = () => (
  <svg {...gp}>
    <rect x="3" y="4" width="8" height="6" rx="1" />
    <rect x="13" y="4" width="8" height="6" rx="1" />
    <rect x="3" y="14" width="8" height="6" rx="1" />
    <rect x="13" y="14" width="8" height="6" rx="1" />
  </svg>
);

/* Re-cluster: the counter-clockwise refresh glyph (lucide refresh-ccw). Drawn
   30% smaller than the bar's other glyphs — the four arcs read as busier than a
   single-shape icon at the same box, so it needs less room to feel equal. */
const ReclusterGlyph = () => (
  <svg {...gp} width={11} height={11}>
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
    <path d="M16 16h5v5" />
  </svg>
);

function Btn({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      // `disabled` on the Workspace bar is visual only; here it is real, because
      // both actions are cheap to fire by accident and one of them queues work.
      disabled={disabled}
      onClick={onClick}
      className="am-tb tw-top"
      title={title}
      aria-label={title}
      style={{
        display: "flex",
        width: 34,
        height: 34,
        alignItems: "center",
        justifyContent: "center",
        border: 0,
        borderRadius: 2,
        cursor: disabled ? "default" : "pointer",
        background: "transparent",
        color: "var(--t2)",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
      <span className="tip">{title}</span>
    </button>
  );
}

/* Hidden on a phone by `.am-bar-div`, where the bar wraps and a vertical rule
   would land mid-row. */
const Divider = () => (
  <span className="am-bar-div" style={{ width: 1, height: 20, background: "var(--bd)", margin: "0 3px" }} />
);

function SortingActionBar({
  showRecluster,
  showRegroup,
  aboveSwitcher,
  canRegroup,
  busy,
  selCount,
  onRegroup,
  onRecluster,
  topicMembership,
  labelNames,
  labelMenuOpen,
  selectionLabel,
  labelFilter,
  onToggleLabelMenu,
  onPickLabel,
  onSetFilter,
}: SortingActionBarProps) {
  return (
    <div
      // Below 760px the bar spans the width and wraps rather than overflowing
      // a centred row. The high/low pair mirrors the `bottom` below, because a
      // media query cannot read a prop — and on a phone both values also have
      // to clear the home indicator.
      className={`am-bar ${aboveSwitcher ? "am-bar-high" : "am-bar-low"}`}
      style={{
        position: "absolute",
        left: "50%",
        // Stacks above ViewSwitcher, whose strip is 42px tall at bottom:20 —
        // this clears it by the same 10px gap #213 verified. The `pointer:
        // coarse` override in globals.css keeps its own value for the 52px
        // touch strip.
        bottom: aboveSwitcher ? 72 : 20,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        // Padding/gap/radius match ViewSwitcher exactly, so the two stacked
        // strips are the same 42px height and read as one control surface
        // rather than two design systems. #213 called this out as a bug and
        // fixed it for touch only; desktop had kept 6px/8px padding, a 4px gap
        // and a 2px radius against the switcher's 3/3/3.
        gap: 3,
        padding: 3,
        background: "rgba(20,20,20,.92)",
        border: "1px solid var(--bd)",
        borderRadius: 3,
        backdropFilter: "blur(16px)",
        boxShadow: "0 8px 32px rgba(0,0,0,.45)",
        zIndex: 35,
      }}
    >
      <LabelBarControl
        names={labelNames}
        open={labelMenuOpen}
        onToggle={onToggleLabelMenu}
        selCount={selCount}
        selectionLabel={selectionLabel}
        filter={labelFilter}
        onPickLabel={onPickLabel}
        onSetFilter={onSetFilter}
      />
      {showRegroup && (
        <>
          <Divider />
          <Btn
            title={
              selCount >= 2
                ? `Snap ${selCount} selected back into place`
                : "Snap tiles back into place"
            }
            disabled={!canRegroup}
            onClick={onRegroup}
          >
            <RegroupGlyph />
          </Btn>
        </>
      )}
      {/* The two membership controls share one group, and the divider before
          them is what separates them from Regroup. They belong together and
          apart from it: both change what a file BELONGS to, workspace-wide and
          on the server, while Regroup only moves tiles in this one view. That
          distinction is the whole of ADR 0042, and the bar used to bury it by
          spacing all four controls identically — with two adjacent buttons
          whose labels ("Regroup" / "Refresh AI grouping") read as synonyms. */}
      {showRecluster && topicMembership && (
        <>
          <Divider />
          {/* Rendered even with an empty selection, where it is genuinely
              disabled and says so. Hiding it made the bar change width the
              moment you selected something, which slid Re-cluster out from
              under the cursor that was reaching for it. */}
          <TopicMembershipMenu {...topicMembership} selectionCount={selCount} />
        </>
      )}
      {showRecluster && (
        <Btn
          title={busy ? "A job is already running" : "Rebuild topics — your manual moves stay (free)"}
          disabled={busy}
          onClick={onRecluster}
        >
          <ReclusterGlyph />
        </Btn>
      )}
    </div>
  );
}

export default memo(SortingActionBar);
