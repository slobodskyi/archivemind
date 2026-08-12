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
 *  all ≤ 46 px tall at bottom:66 — it sits ABOVE `ViewSwitcher` (bottom:20), and
 *  `BulkAiPanel` (bottom:124) clears both. z-index 35 matches every other canvas bar — `lib/ui.ts`
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

/* Regroup: scattered cells pulled back into a cluster. */
const RegroupGlyph = () => (
  <svg {...gp}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 3.5v3M12 17.3v3.2M3.5 12h3M17.3 12h3.2" />
    <path d="m6 6 2.2 2.2M18 6l-2.2 2.2M6 18l2.2-2.2M18 18l-2.2-2.2" />
  </svg>
);

/* Re-cluster: a refresh arc over grouped dots. */
const ReclusterGlyph = () => (
  <svg {...gp}>
    <path d="M20 12a8 8 0 1 1-2.4-5.7" />
    <path d="M20 3.5V7h-3.5" />
    <circle cx="10" cy="11" r="1.3" />
    <circle cx="14" cy="14" r="1.3" />
    <circle cx="9.5" cy="15" r="1.3" />
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
      style={{
        position: "absolute",
        left: "50%",
        // Stacks above ViewSwitcher (bottom:20) when it is showing.
        bottom: aboveSwitcher ? 66 : 20,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "6px 8px",
        background: "rgba(20,20,20,.92)",
        border: "1px solid var(--bd)",
        borderRadius: 2,
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
          <span style={{ width: 1, height: 20, background: "var(--bd)", margin: "0 3px" }} />
          <Btn
            title={selCount >= 2 ? `Regroup ${selCount} selected` : "Regroup — snap tiles back into their clouds"}
            disabled={!canRegroup}
            onClick={onRegroup}
          >
            <RegroupGlyph />
          </Btn>
        </>
      )}
      {showRecluster && topicMembership && selCount > 0 && (
        <>
          <span style={{ width: 1, height: 20, background: "var(--bd)", margin: "0 3px" }} />
          <TopicMembershipMenu {...topicMembership} selectionCount={selCount} />
        </>
      )}
      {showRecluster && (
        <>
          <span style={{ width: 1, height: 20, background: "var(--bd)", margin: "0 3px" }} />
          <Btn
            title={busy ? "A job is already running" : "Refresh AI grouping — manual moves stay (free)"}
            disabled={busy}
            onClick={onRecluster}
          >
            <ReclusterGlyph />
          </Btn>
        </>
      )}
    </div>
  );
}

export default memo(SortingActionBar);
