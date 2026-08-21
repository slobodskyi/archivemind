/** "N selected — Restore · Delete permanently · Clear", the same idiom the
 *  canvas action bar uses. It exists because the bulk endpoints have accepted
 *  500 ids since ADR 0033 while the Trash sent them one at a time: restoring a
 *  batch delete meant clicking Restore forty times. */
export default function TrashSelectionBar({
  count,
  allSelected,
  onSelectAll,
  onRestore,
  onPurge,
  onClear,
}: {
  count: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onRestore: () => void;
  onPurge: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;

  const btn = (color: string, border: boolean): React.CSSProperties => ({
    height: 26,
    padding: "0 10px",
    background: "transparent",
    color,
    border: border ? "1px solid var(--bd)" : 0,
    borderRadius: 2,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: ".03em",
    cursor: "pointer",
    fontFamily: "inherit",
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 12,
        padding: "8px 10px",
        background: "var(--bg-s)",
        border: "1px solid var(--bdh)",
        borderRadius: 2,
      }}
    >
      <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--t1)" }}>
        {count} selected
      </span>
      {!allSelected && (
        <button style={btn("var(--t2)", false)} onClick={onSelectAll}>
          Select all
        </button>
      )}
      <div style={{ flex: 1 }} />
      <button style={btn("var(--ac)", true)} onClick={onRestore}>
        Restore
      </button>
      <button style={btn("var(--red)", true)} onClick={onPurge}>
        Delete permanently
      </button>
      <button style={btn("var(--t3)", false)} onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
