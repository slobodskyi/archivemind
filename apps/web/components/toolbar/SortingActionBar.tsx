"use client";

import { memo } from "react";
import type { AssetLabel, LabelNames } from "@archivemind/shared";
import type { LabelFilter } from "@/lib/labels";
import LabelSwatchRow from "@/components/labels/LabelSwatchRow";
import { LabelsIcon } from "@/components/icons/icons";
import TopicMembershipMenu, {
  type TopicMembershipMenuProps,
} from "@/components/toolbar/TopicMembershipMenu";

/** Membership controls are optional so Timeline / Labels keep their existing
 * narrow bar. Topic supplies this object once its persisted manual-assignment
 * layer is available. `selectionCount` comes from the bar's existing prop. */
export type SortingTopicMembershipProps = Omit<TopicMembershipMenuProps, "selectionCount">;

/** Bottom action bar for the SORTING views (Topic / Timeline) — ADR 0038.
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
 *  all ≤ 46 px tall at bottom:20 so `BulkAiPanel` (hardcoded to bottom:78)
 *  still clears it. z-index 35 matches every other canvas bar — `lib/ui.ts`
 *  reserves 0–35 for canvas internals, and anything higher would paint over
 *  the chat and trash panels. */
export interface SortingActionBarProps {
  /** Canvas / Timeline / Topic can Regroup (snap tiles back); Map can't. */
  showRegroup: boolean;
  /** Topic shows its membership editor; the other sorting views don't. */
  showRecluster: boolean;
  /** There is something to regroup — no drag overrides means no-op. */
  canRegroup: boolean;
  /** ≥ 2 selected regroups only those, matching Tidy up's selection-first rule. */
  selCount: number;
  onRegroup: () => void;
  /** Explicit semantic grouping actions for Topic only. The canvas may call
   * the same mutations after an intentional dwell-and-drop target. */
  topicMembership?: SortingTopicMembershipProps;
  /** Colour-label control — the same context-sensitive swatch the workspace bar
   *  has (ADR 0040). Organizing in a sorting view is exactly where you pick the
   *  files to mark, so it belongs here too: with a selection it labels, with none
   *  it filters. */
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


function Btn({
  title,
  disabled,
  active,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  active?: boolean;
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
        background: active ? "color-mix(in srgb,var(--ac) 12%,transparent)" : "transparent",
        color: active ? "var(--ac)" : "var(--t2)",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
      <span className="tip">{title}</span>
    </button>
  );
}

function SortingActionBar({
  showRegroup,
  showRecluster,
  canRegroup,
  selCount,
  onRegroup,
  topicMembership,
  labelNames,
  labelMenuOpen,
  selectionLabel,
  labelFilter,
  onToggleLabelMenu,
  onPickLabel,
  onSetFilter,
}: SortingActionBarProps) {
  const noSel = selCount === 0;
  const filterCurrent: AssetLabel | "mixed" | null = labelFilter === "none" ? null : labelFilter;
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        // Sits ABOVE the bottom view switcher (which owns bottom:20 centre).
        bottom: 66,
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
      {/* Colour-label control (ADR 0040) — labels the selection, or filters by
          colour when nothing is selected. */}
      {labelMenuOpen && (
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
            names={labelNames}
            current={noSel ? filterCurrent : selectionLabel}
            onPick={noSel ? onSetFilter : onPickLabel}
            size={18}
          />
        </div>
      )}
      <Btn
        title={noSel ? (labelFilter !== null ? "Filter by colour — on" : "Filter by colour") : selCount >= 2 ? `Label ${selCount}` : "Label"}
        active={labelMenuOpen || (noSel && labelFilter !== null)}
        onClick={onToggleLabelMenu}
      >
        <LabelsIcon width={16} height={16} />
      </Btn>

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
    </div>
  );
}

export default memo(SortingActionBar);
