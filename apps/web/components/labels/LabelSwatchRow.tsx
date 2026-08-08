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
  /** Hides the ✕. The drawer shows it always; a menu row with nothing to clear
   *  would offer a dead button. */
  showClear?: boolean;
  size?: number;
}

/** The seven colours in one row, macOS Finder's tag strip. The primary way a
 *  label gets applied — in the right-click menu, the action bar and the drawer,
 *  always the same object so the gesture is learned once. */
export default function LabelSwatchRow({
  names,
  current,
  onPick,
  showClear = true,
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
            // misclick.
            onClick={() => onPick(active ? null : label)}
            title={names[label]}
            aria-label={active ? `Remove ${names[label]}` : `Mark ${names[label]}`}
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
      {showClear && (
        <>
          <span style={{ width: 1, height: size - 4, background: "var(--bd)" }} />
          <button
            type="button"
            onClick={() => onPick(null)}
            title="No label"
            aria-label="Remove label"
            disabled={current === null}
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
              cursor: current === null ? "default" : "pointer",
              opacity: current === null ? 0.35 : 1,
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
