interface StepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Spoken name for the value, e.g. "Images". */
  label: string;
}

/** A bounded count as −/n/+ — the design system's answer to a native
 *  <input type="number"> whose spinners no theme can reach. The value is not
 *  free-typed on purpose: every count in the brief is clamped to a small
 *  known range, and two taps beat selecting text on a phone. */
export default function Stepper({ value, min, max, onChange, label }: StepperProps) {
  const stepButton = (glyph: string, next: number, disabled: boolean, name: string) => (
    <button
      type="button"
      aria-label={name}
      disabled={disabled}
      onClick={() => onChange(next)}
      style={{
        width: 30,
        height: 28,
        flex: "0 0 auto",
        border: 0,
        borderRadius: 2,
        background: "transparent",
        color: disabled ? "var(--tm)" : "var(--t2)",
        fontFamily: "inherit",
        fontSize: 14,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {glyph}
    </button>
  );
  return (
    <div
      role="group"
      aria-label={label}
      style={{ display: "flex", alignItems: "center", gap: 2, padding: 2, background: "var(--bg-in)", borderRadius: 2 }}
    >
      {stepButton("−", Math.max(min, value - 1), value <= min, `Fewer ${label.toLowerCase()}`)}
      <span
        role="status"
        style={{ flex: 1, minWidth: 0, textAlign: "center", color: "var(--t1)", fontSize: 12.5 }}
      >
        {value}
      </span>
      {stepButton("+", Math.min(max, value + 1), value >= max, `More ${label.toLowerCase()}`)}
    </div>
  );
}
