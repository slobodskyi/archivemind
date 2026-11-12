import { useId } from "react";
import { SparkleIcon } from "@/components/icons/icons";

interface CanvasAnalyzeActionProps {
  /** Photos selected on the canvas — the set `BulkAiPanel` will plan its run
   *  over. Read from the same `selectedIds` that gates the panel opening, so
   *  the badge cannot promise a batch the click refuses to open. */
  selectedCount: number;
  /** The panel (or its no-selection intro) is already open — the button reads
   *  as pressed rather than looking like a second, different way in. */
  open: boolean;
  onOpen: () => void;
  /** Draw the hover explainer. Off while a right-hand panel (chat, Trash) is
   *  open: the explainer lives in the floated shell's stacking context, so
   *  those panels would cover it anyway. */
  explain?: boolean;
  /** Where focus goes back to when the intro this button opened closes itself
   *  (its Close / "Select on canvas" unmount the button that was pressed). */
  buttonRef?: React.Ref<HTMLButtonElement>;
}

/** AI ANALYZE — the project canvas's AI action, in the slot a Workspace gives
 *  to CREATE + DOWNLOAD.
 *
 *  The two scopes ask opposite questions of the same tiles: inside a Workspace
 *  you are producing something (CREATE, DOWNLOAD), outside one you are still
 *  building the archive — and building it means analyzing what arrived. That
 *  entry point had no home out here: the Workspace action bar carries the ✨
 *  button, but it is Workspace-gated, and the right-click menu's analyze item
 *  went with the menu trim, which left the per-tile badge (one photo at a
 *  time) as the only way to run AI on a project canvas.
 *
 *  It opens `BulkAiPanel` rather than running anything, deliberately: analysis
 *  costs a credit per photo, so the count, the operations and the call estimate
 *  have to be visible before the spend — the same rule every other AI entry
 *  point follows. The badge is the selection count, so the button says how big
 *  the batch is without opening it. With nothing selected the click opens the
 *  panel's intro instead of a dead-end toast: it says what AI writes and what
 *  it costs, and offers "Select N unanalyzed" — which only selects.
 *
 *  Hovering or focusing it shows the same explanation in short, credits
 *  included (1 per photo to analyze, +1 per caption language — usage.ts), so
 *  "AI" is never a word the user has to click to decode.
 *
 *  Purple with a ✨, never DOWNLOAD's green: the two share one slot and one
 *  shape, and when they also shared a colour nobody noticed the slot had
 *  changed jobs. Idle is a purple tint rather than the grey every other dead
 *  control wears — this one is waiting for a selection, not unavailable. */
export default function CanvasAnalyzeAction({ selectedCount, open, onOpen, explain = true, buttonRef }: CanvasAnalyzeActionProps) {
  const live = selectedCount > 0;
  const tipId = useId();
  const name = live ? `Analyze ${selectedCount} selected with AI` : "Analyze with AI";
  return (
    <button
      ref={buttonRef}
      onClick={onOpen}
      className="am-ai-explain-host"
      // Static copy and a count only.
      data-ph-unmask=""
      // Deliberately not `disabled` with an empty selection: the click opens
      // the panel's intro, which explains the button and offers a selection —
      // a control that cannot answer why it is dead is worse than one that can.
      aria-expanded={open}
      aria-label={name}
      // No `title`: the explainer is the tooltip, and two would stack.
      aria-describedby={explain ? tipId : undefined}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        minWidth: 112,
        boxSizing: "border-box",
        height: 30,
        borderRadius: 2,
        padding: "0 10px",
        background: live ? "var(--ai)" : "color-mix(in srgb,var(--ai) 14%,transparent)",
        border: 0,
        color: live ? "#050505" : "var(--ai)",
        fontFamily: "inherit",
        fontSize: 11.5,
        fontWeight: 800,
        letterSpacing: ".04em",
        cursor: "pointer",
        // Pressed, not dimmed: the panel it toggles sits 500px away at the
        // bottom of the canvas, so the button has to say that clicking again
        // closes it. An inset ring does that without changing the footprint —
        // a width change here would shove the floated shell around. The idle
        // tint gets a thin purple ring, since a dark ring vanishes on it.
        boxShadow: open
          ? live
            ? "inset 0 0 0 2px rgba(5,5,5,.42)"
            : "inset 0 0 0 1px color-mix(in srgb,var(--ai) 70%,transparent)"
          : "none",
      }}
    >
      <SparkleIcon width={12} height={12} strokeWidth={2} />
      <span>AI</span>
      {/* Hidden at 640px and below (globals.css); flex gap supplies the space,
          and a display:none child drops its gap too. */}
      <span className="am-analyze-word">ANALYZE</span>
      {live && (
        <span style={{ padding: "1px 5px", background: "rgba(5,5,5,.18)", borderRadius: 2, fontSize: 9.5, fontWeight: 800 }}>
          {selectedCount}
        </span>
      )}
      {explain && (
        <span id={tipId} role="tooltip" className="am-ai-explain">
          <span style={{ display: "block", color: "var(--t1)", fontWeight: 700, marginBottom: 3 }}>{name}</span>
          <span style={{ display: "block" }}>
            Tags, description, facts and captions for every photo — makes your archive searchable.
          </span>
          <span style={{ display: "block", marginTop: 4, color: "var(--t3)" }}>
            1 credit per photo to analyze, +1 per caption language. You see the count and cost before anything runs.
          </span>
        </span>
      )}
    </button>
  );
}
