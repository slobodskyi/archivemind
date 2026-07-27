import { memo } from "react";

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
 *  Deliberately narrow: two buttons, ≤ 46 px tall at bottom:20 so `BulkAiPanel`
 *  (hardcoded to bottom:78) still clears it, and z-index 35 like every other
 *  canvas bar — `lib/ui.ts` reserves 0–35 for canvas internals, and anything
 *  higher would paint over the chat and trash panels. */
interface SortingActionBarProps {
  /** Topic gets Re-cluster; Timeline's day columns are not clustered. */
  showRecluster: boolean;
  /** There is something to regroup — no drag overrides means no-op. */
  canRegroup: boolean;
  /** A job is already in flight; the worker has one lane for all of them. */
  busy: boolean;
  /** ≥ 2 selected regroups only those, matching Tidy up's selection-first rule. */
  selCount: number;
  onRegroup: () => void;
  onRecluster: () => void;
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
  canRegroup,
  busy,
  selCount,
  onRegroup,
  onRecluster,
}: SortingActionBarProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 20,
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
      <Btn
        title={selCount >= 2 ? `Regroup ${selCount} selected` : "Regroup — snap tiles back into their clouds"}
        disabled={!canRegroup}
        onClick={onRegroup}
      >
        <RegroupGlyph />
      </Btn>
      {showRecluster && (
        <>
          <span style={{ width: 1, height: 20, background: "var(--bd)", margin: "0 3px" }} />
          <Btn
            title={busy ? "A job is already running" : "Re-cluster topics (free — no AI credits)"}
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
