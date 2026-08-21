import { ASSET_LABELS, type AssetLabel, type LabelNames } from "@archivemind/shared";
import { LABEL_COLORS } from "@/lib/labels";

interface LabelSwatchRowProps {
  names: LabelNames;
  /** The colour the target already carries: a label when every target shares
   *  one, `"mixed"` when they disagree, null when none is set. Drives the ring
   *  only — clicking is always an absolute set, never a per-photo toggle, so a
   *  mixed selection resolves to one colour instead of flipping each photo. */
  current: AssetLabel | "mixed" | null;
  onPick: (label: AssetLabel | null) => void;
  /** Can the target be left with NO colour? Governs both the ✕ and clicking the
   *  active swatch — for a photo, unlabelling is a real state and both do it.
   *  A sticky note (ADR 0041) always has a colour, so it passes false and a
   *  click on the current swatch is inert rather than a hidden way to break the
   *  invariant. */
  clearable?: boolean;
  /** Filter mode only: an extra swatch for "the photos carrying no colour at
   *  all" — the untriaged pile. It is deliberately NOT the ✕: the ✕ clears the
   *  filter and shows everything, this one narrows to the unmarked. Both are
   *  reachable because both are things you ask for, and collapsing them is how
   *  the untriaged pile becomes impossible to look at. */
  none?: { active: boolean; onPick: () => void };
  size?: number;
}

/** The seven colours in one row, macOS Finder's tag strip. The primary way a
 *  label gets applied — in the right-click menu, the action bar and the drawer,
 *  always the same object so the gesture is learned once. */
export default function LabelSwatchRow({
  names,
  current,
  onPick,
  clearable = true,
  none,
  size = 16,
}: LabelSwatchRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 4px" }}>
      {ASSET_LABELS.map((label) => {
        const active = current === label;
        return (
          <button
            key={label}
            type="button"
            // Clicking the colour a photo already has removes it — the same
            // toggle Finder has, and the reason Escape isn't needed to undo a
            // misclick. Where there is no "no colour" to fall back to, the
            // click is simply a no-op.
            onClick={() => onPick(active ? (clearable ? null : label) : label)}
            title={names[label]}
            aria-label={active && clearable ? `Remove ${names[label]}` : `Mark ${names[label]}`}
            aria-pressed={active}
            style={{
              display: "flex",
              width: size,
              height: size,
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              border: `1px solid ${active ? "var(--t1)" : "transparent"}`,
              borderRadius: "50%",
              background: "transparent",
              cursor: "pointer",
              // The ring sits OUTSIDE the dot rather than recolouring it, so the
              // swatch stays a true sample of the colour it applies.
              boxShadow: active ? `0 0 0 1px rgba(0,0,0,.9) inset` : "none",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: size - 6,
                height: size - 6,
                borderRadius: "50%",
                background: LABEL_COLORS[label],
              }}
            />
          </button>
        );
      })}
      {none && (
        <button
          type="button"
          onClick={none.onPick}
          title="No label"
          aria-label="Show only photos with no label"
          aria-pressed={none.active}
          style={{
            display: "flex",
            width: size,
            height: size,
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            border: `1px solid ${none.active ? "var(--t1)" : "transparent"}`,
            borderRadius: "50%",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          {/* A hollow ring, not a grey dot: grey is the `gray` label, a real
              choice someone made, and absence must not look like it. */}
          <span
            aria-hidden="true"
            style={{
              width: size - 6,
              height: size - 6,
              borderRadius: "50%",
              border: "1px dashed var(--t3)",
            }}
          />
        </button>
      )}
      {clearable && (
        <>
          <span style={{ width: 1, height: size - 4, background: "var(--bd)" }} />
          <button
            type="button"
            // Always active: it is also the way to dismiss the label menu, so
            // greying it out when there is no colour to clear (the common case
            // on an unlabelled tile) left the menu with no working close. Clear
            // when there is something to clear; otherwise it is a harmless
            // no-op that still closes the menu through the caller's onPick.
            onClick={() => (none?.active ? none.onPick() : onPick(null))}
            title={none ? "Show everything" : "No label"}
            aria-label={none ? "Clear the colour filter" : "Remove label"}
            style={{
              display: "flex",
              width: size,
              height: size,
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              border: 0,
              borderRadius: "50%",
              background: "transparent",
              color: "var(--t2)",
              cursor: "pointer",
            }}
          >
            <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
              <path d="M5 5l14 14M19 5 5 19" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
