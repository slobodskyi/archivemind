import { SparkleIcon } from "@/components/icons/icons";

interface CanvasAnalyzeActionProps {
  /** Photos selected on the canvas — the set `BulkAiPanel` will plan its run
   *  over. Read from the same `selectedIds` that gates the panel opening, so
   *  the badge cannot promise a batch the click refuses to open. */
  selectedCount: number;
  /** The panel is already open — the button reads as pressed rather than
   *  looking like a second, different way in. */
  open: boolean;
  onOpen: () => void;
}

/** The project canvas's AI action, in the slot a Workspace gives to EXPORT.
 *
 *  The two scopes ask opposite questions of the same tiles: inside a Workspace
 *  you are producing something (EXPORT), outside one you are still building the
 *  archive — and building it means analyzing what arrived. That entry point had
 *  no home out here: the Workspace action bar carries the ✨ button, but it is
 *  Workspace-gated, and the right-click menu's analyze item went with the menu
 *  trim, which left the per-tile badge (one photo at a time) as the only way to
 *  run AI on a project canvas.
 *
 *  It opens `BulkAiPanel` rather than running anything, deliberately: analysis
 *  costs a credit per photo, so the count, the operations and the call estimate
 *  have to be visible before the spend — the same rule every other AI entry
 *  point follows. The badge is the selection count, so the button says how big
 *  the batch is without opening it. */
export default function CanvasAnalyzeAction({ selectedCount, open, onOpen }: CanvasAnalyzeActionProps) {
  const live = selectedCount > 0;
  return (
    <button
      onClick={onOpen}
      // Deliberately not `disabled` with an empty selection: the click is what
      // explains the button ("Select files first"), and a control that cannot
      // answer why it is dead is worse than a dim one that can.
      aria-expanded={open}
      aria-label={live ? `Analyze ${selectedCount} selected with AI` : "Analyze with AI — select photos first"}
      title={
        live
          ? `Analyze with AI · ${selectedCount} selected`
          : "Select photos on the canvas to analyze them together"
      }
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        minWidth: 112,
        boxSizing: "border-box",
        height: 30,
        borderRadius: 2,
        padding: "0 10px",
        background: live ? "var(--ac)" : "var(--bd)",
        border: 0,
        color: live ? "#050505" : "var(--tm)",
        fontFamily: "inherit",
        fontSize: 11.5,
        fontWeight: 800,
        letterSpacing: ".04em",
        cursor: "pointer",
        // Pressed, not dimmed: the panel it toggles sits 500px away at the
        // bottom of the canvas, so the button has to say that clicking again
        // closes it. An inset ring does that without changing the footprint —
        // a width change here would shove the floated shell around.
        boxShadow: open && live ? "inset 0 0 0 2px rgba(5,5,5,.42)" : "none",
      }}
    >
      {/* The same sparkle every AI entry point wears (PhotoTile's badge, the
          action bar, the panel's own CTA) — the word alone would read as a
          report, not as a model run. */}
      <SparkleIcon width={12.5} height={12.5} />
      ANALYZE
      {live && (
        <span style={{ padding: "1px 5px", background: "rgba(5,5,5,.18)", borderRadius: 2, fontSize: 9.5, fontWeight: 800 }}>
          {selectedCount}
        </span>
      )}
    </button>
  );
}
