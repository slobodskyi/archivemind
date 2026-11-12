import type { CSSProperties } from "react";

/** The `/s/{token}` page's own controls — shared by the file grid, its filter
 *  row and the lightbox so the three read as one surface. */

export const MONO = "var(--font-space-mono), var(--font-mono-cy), monospace";

export const shareButton: CSSProperties = {
  minHeight: 40,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  padding: "0 12px",
  border: "1px solid var(--bdh)",
  borderRadius: 2,
  background: "rgba(8,8,8,.78)",
  color: "var(--t1)",
  fontFamily: MONO,
  fontSize: 10,
  fontWeight: 700,
  textDecoration: "none",
  cursor: "pointer",
};

export const sharePrimaryButton: CSSProperties = {
  ...shareButton,
  borderColor: "var(--ac)",
  background: "var(--ac)",
  color: "#050505",
};

/** A filter chip: quiet until pressed, then outlined in the accent. */
export function shareChip(pressed: boolean): CSSProperties {
  return {
    minHeight: 30,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "0 10px",
    border: `1px solid ${pressed ? "var(--ac)" : "var(--bd)"}`,
    borderRadius: 2,
    background: pressed ? "rgba(57,255,106,.08)" : "transparent",
    color: pressed ? "var(--t1)" : "var(--t2)",
    fontFamily: MONO,
    fontSize: 9.5,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}
