import type { CSSProperties } from "react";

interface SegmentedTrackProps<T extends string> {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  /** id of the visible label element (aria-labelledby). */
  labelledBy?: string;
  disabled?: boolean;
  style?: CSSProperties;
}

/** The recessed one-of-N track (PhotoDrawer's caption picker, ExportDialog's
 *  language/style rows) as a component, so a form never falls back to a native
 *  <select> for a handful of options: the track is the group, the raised
 *  segment is the answer. For open-ended or long lists a different control is
 *  the right call — this is for 2–4 named choices. */
export default function SegmentedTrack<T extends string>({
  value,
  options,
  onChange,
  labelledBy,
  disabled = false,
  style,
}: SegmentedTrackProps<T>) {
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      style={{ display: "flex", gap: 2, padding: 2, background: "var(--bg-in)", borderRadius: 2, ...style }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            style={{
              flex: 1,
              minWidth: 0,
              height: 28,
              border: 0,
              borderRadius: 2,
              fontSize: 11.5,
              fontFamily: "inherit",
              cursor: disabled ? "default" : "pointer",
              opacity: disabled ? 0.5 : 1,
              background: active ? "var(--bg-el)" : "transparent",
              color: active ? "var(--t1)" : "var(--t2b)",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
